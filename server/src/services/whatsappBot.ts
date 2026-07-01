import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
  type Contact,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import { Server as SocketIOServer } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'
import QRCode from 'qrcode'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { log } from '../utils/logger'
import { delay, randomDelay } from '../utils/delay'
import { env } from '../config/env'
import { publishPost } from './metaGraph'

const prisma = new PrismaClient()
const AUTH_DIR = path.resolve(process.cwd(), '../auth_info_baileys')

let io: SocketIOServer | null = null
let currentSocket: WASocket | null = null
let isStarting = false
let reconnectAttempts = 0
let stopReconnecting = false
let latestQrDataUrl: string | null = null
let ownPhone: string | null = null
let ownLid: string | null = null
interface ContactEntry {
  id: string;
  lid?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  phoneNumber?: string;
}
const CONTACTS_FILE = path.join(AUTH_DIR, 'contacts.json')
let contactsArray: ContactEntry[] = []
function loadContactsFromDisk() {
  try {
    if (fs.existsSync(CONTACTS_FILE)) {
      contactsArray = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf-8'))
      log('info', 'whatsapp', `Loaded ${contactsArray.length} contacts from disk`)
    }
  } catch (err) {
    log('warn', 'whatsapp', 'Failed to load contacts from disk', { error: (err as Error).message })
  }
}
function saveContactsToDisk() {
  try {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contactsArray, null, 2), 'utf-8')
  } catch (err) {
    log('warn', 'whatsapp', 'Failed to save contacts to disk', { error: (err as Error).message })
  }
}
loadContactsFromDisk()
const MAX_RECONNECT_ATTEMPTS = 3

const threadTimestamps = new Map<string, number>()
const followupTimestamps = new Map<string, number>()
const MIN_THROTTLE_MS = 30000
const MIN_FOLLOWUP_THROTTLE_MS = 5000

const globalRateTimestamps: number[] = []
const MAX_GLOBAL_PER_MIN = 15
const MAX_GLOBAL_PER_HOUR = 60

function checkGlobalRate(): boolean {
  const now = Date.now()
  while (globalRateTimestamps.length && now - globalRateTimestamps[0] > 60000) globalRateTimestamps.shift()
  if (globalRateTimestamps.length >= MAX_GLOBAL_PER_MIN) return false
  const hourAgo = now - 3600000
  const hourCount = globalRateTimestamps.filter(t => t > hourAgo).length
  if (hourCount >= MAX_GLOBAL_PER_HOUR) return false
  globalRateTimestamps.push(now)
  return true
}

function realisticBrowser(): [string, string, string] {
  const browsers: [string, string, string][] = [
    ['Windows', 'Chrome', '131.0.6778'],
    ['Windows', 'Chrome', '130.0.6723'],
    ['macOS', 'Chrome', '131.0.6778'],
    ['Windows', 'Edge', '131.0.2903'],
  ]
  return browsers[Math.floor(Math.random() * browsers.length)]
}

export function cleanupAuthFolder(): { deleted: number; keptCreds: boolean } {
  if (!fs.existsSync(AUTH_DIR)) return { deleted: 0, keptCreds: false }
  let deleted = 0
  const files = fs.readdirSync(AUTH_DIR)
  for (const file of files) {
    if (file === 'creds.json' || file === 'contacts.json' || file === 'contact_groups.json' || file === 'imported_contacts.json') continue
    if (file.startsWith('app-state-sync-version-') || file.startsWith('app-state-sync-key-')) continue
    const keepPatterns = ['session-', 'sender-key-', 'identity-key-', 'device-list-', 'sender-key-status@broadcast-']
    if (keepPatterns.some((p) => file.startsWith(p))) continue
    try {
      fs.unlinkSync(path.join(AUTH_DIR, file))
      deleted++
    } catch {
      // skip locked files
    }
  }
  log('info', 'whatsapp', `Auth folder cleaned: ${deleted} files removed, creds.json preserved`)
  return { deleted, keptCreds: true }
}

export function clearCredentials(): { deleted: number } {
  if (!fs.existsSync(AUTH_DIR)) return { deleted: 0 }
  let deleted = 0
  const keep = new Set(['imported_contacts.json', 'contact_groups.json'])
  for (const file of fs.readdirSync(AUTH_DIR)) {
    if (keep.has(file)) continue
    try {
      fs.unlinkSync(path.join(AUTH_DIR, file))
      deleted++
    } catch {
      // skip
    }
  }
  log('info', 'whatsapp', `Credentials cleared: ${deleted} files removed, imported contacts and groups preserved`)
  return { deleted }
}

function emit(event: string, data: Record<string, unknown>): void {
  if (io) io.emit(event, data)
}

export function setSocketIO(serverIo: SocketIOServer): void {
  io = serverIo
}

export function getLatestQrDataUrl(): string | null {
  return latestQrDataUrl
}

export function getConnectionState(): {
  connected: boolean
  connecting: boolean
  attempt: number
  maxAttempts: number
  qrAvailable: boolean
} {
  return {
    connected: currentSocket?.user?.id ? true : false,
    connecting: isStarting,
    attempt: reconnectAttempts,
    maxAttempts: MAX_RECONNECT_ATTEMPTS,
    qrAvailable: latestQrDataUrl !== null,
  }
}

export async function getContacts(): Promise<ContactEntry[]> {
  const seen = new Map<string, ContactEntry>()
  for (const c of contactsArray) {
    if (!seen.has(c.id)) seen.set(c.id, c)
  }
  if (seen.size !== contactsArray.length) {
    const removed = contactsArray.length - seen.size
    contactsArray = Array.from(seen.values())
    saveContactsToDisk()
    log('info', 'whatsapp', `Deduplicated contacts on read: removed ${removed} duplicates`)
  }
  return contactsArray
}

export function clearContacts(): number {
  const count = contactsArray.length
  contactsArray = []
  saveContactsToDisk()
  log('info', 'whatsapp', `Cleared ${count} synced contacts`)
  return count
}

export function deleteContact(id: string): boolean {
  const idx = contactsArray.findIndex(c => c.id === id)
  if (idx === -1) return false
  contactsArray.splice(idx, 1)
  saveContactsToDisk()
  log('info', 'whatsapp', `Deleted synced contact: ${id}`)
  return true
}

export async function resyncContacts(): Promise<{ ok: boolean; count: number }> {
  if (!currentSocket?.user?.id) {
    return { ok: false, count: contactsArray.length }
  }
  try {
    const prevCount = contactsArray.length
    await (currentSocket as any).resyncAppState(['regular', 'regular_low'], true)
    log('info', 'whatsapp', 'Contacts resync triggered', { before: prevCount, after: contactsArray.length })
    return { ok: true, count: contactsArray.length }
  } catch (err) {
    log('warn', 'whatsapp', 'Contacts resync failed', { error: (err as Error).message })
    return { ok: false, count: contactsArray.length }
  }
}

// --- Imported Contacts (VCF) ---
const IMPORTED_CONTACTS_FILE = path.join(AUTH_DIR, 'imported_contacts.json')
let importedContacts: ContactEntry[] = []

function loadImportedContacts() {
  try {
    if (fs.existsSync(IMPORTED_CONTACTS_FILE)) {
      importedContacts = JSON.parse(fs.readFileSync(IMPORTED_CONTACTS_FILE, 'utf-8'))
      log('info', 'whatsapp', `Loaded ${importedContacts.length} imported contacts from disk`)
    }
  } catch (err) {
    log('warn', 'whatsapp', 'Failed to load imported contacts', { error: (err as Error).message })
  }
}

function saveImportedContacts() {
  try {
    fs.writeFileSync(IMPORTED_CONTACTS_FILE, JSON.stringify(importedContacts, null, 2), 'utf-8')
  } catch (err) {
    log('warn', 'whatsapp', 'Failed to save imported contacts', { error: (err as Error).message })
  }
}

loadImportedContacts()

export function getImportedContacts(): ContactEntry[] {
  return importedContacts
}

export function addImportedContact(name: string, phoneNumber: string): ContactEntry | null {
  const digits = phoneNumber.replace(/\D/g, '')
  if (!digits) return null
  const jid = digits + '@s.whatsapp.net'
  if (importedContacts.some(c => c.id === jid)) return null
  const contact: ContactEntry = { id: jid, name: name || undefined, phoneNumber: digits }
  importedContacts.push(contact)
  saveImportedContacts()
  log('info', 'whatsapp', `Added imported contact: ${name || digits}`)
  return contact
}

export function importVcf(vcfContent: string): { added: number } {
  let added = 0
  const vcards = vcfContent.split('BEGIN:VCARD')
  for (const vcard of vcards) {
    if (!vcard.includes('END:VCARD')) continue
    const nameMatch = vcard.match(/^FN[^:]*:(.+)$/m)
    const telMatch = vcard.match(/^TEL[^:]*:(.+)$/m)
    const name = nameMatch ? nameMatch[1].trim() : ''
    const tel = telMatch ? telMatch[1].trim() : ''
    if (!tel) continue
    const phoneDigits = tel.replace(/\D/g, '')
    if (!phoneDigits) continue
    const jid = phoneDigits + '@s.whatsapp.net'
    if (importedContacts.some(c => c.id === jid)) continue
    importedContacts.push({
      id: jid,
      name: name || undefined,
      phoneNumber: phoneDigits,
    })
    added++
  }
  if (added > 0) saveImportedContacts()
  log('info', 'whatsapp', `VCF import: ${added} contacts added${added > 0 ? `, total imported ${importedContacts.length}` : ''}`)
  return { added }
}

export function deleteImportedContact(id: string): boolean {
  const idx = importedContacts.findIndex(c => c.id === id)
  if (idx === -1) return false
  importedContacts.splice(idx, 1)
  saveImportedContacts()
  return true
}

export function clearImportedContacts(): number {
  const count = importedContacts.length
  importedContacts = []
  saveImportedContacts()
  return count
}

// --- Contact Groups ---
interface ContactGroup {
  id: string
  name: string
  memberJids: string[]
}

const GROUPS_FILE = path.join(AUTH_DIR, 'contact_groups.json')
let contactGroups: ContactGroup[] = []

function loadGroupsFromDisk() {
  try {
    if (fs.existsSync(GROUPS_FILE)) {
      contactGroups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'))
      log('info', 'whatsapp', `Loaded ${contactGroups.length} contact groups from disk`)
    }
  } catch (err) {
    log('warn', 'whatsapp', 'Failed to load contact groups from disk', { error: (err as Error).message })
  }
}

function saveGroupsToDisk() {
  try {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(contactGroups, null, 2), 'utf-8')
  } catch (err) {
    log('warn', 'whatsapp', 'Failed to save contact groups to disk', { error: (err as Error).message })
  }
}

loadGroupsFromDisk()

export function getContactGroups(): ContactGroup[] {
  return contactGroups
}

export function createContactGroup(name: string, memberJids: string[]): ContactGroup {
  const group: ContactGroup = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    memberJids,
  }
  contactGroups.push(group)
  saveGroupsToDisk()
  log('info', 'whatsapp', `Contact group created: "${name}" with ${memberJids.length} members`)
  return group
}

export function deleteContactGroup(id: string): boolean {
  const idx = contactGroups.findIndex(g => g.id === id)
  if (idx === -1) return false
  contactGroups.splice(idx, 1)
  saveGroupsToDisk()
  log('info', 'whatsapp', `Contact group deleted: ${id}`)
  return true
}

export function updateContactGroup(id: string, name: string, memberJids: string[]): ContactGroup | null {
  const idx = contactGroups.findIndex(g => g.id === id)
  if (idx === -1) return null
  contactGroups[idx] = { ...contactGroups[idx], name, memberJids }
  saveGroupsToDisk()
  log('info', 'whatsapp', `Contact group updated: "${name}" with ${memberJids.length} members`)
  return contactGroups[idx]
}

export async function sendTestMessage(): Promise<{ ok: boolean; error?: string }> {
  if (!currentSocket?.user?.id) {
    return { ok: false, error: 'WhatsApp not connected' }
  }
  const jid = '96170656517@s.whatsapp.net'
  try {
    await currentSocket.sendMessage(jid, { text: 'This is an automated text msg' })
    log('info', 'whatsapp', 'Test message sent', { to: jid })
    return { ok: true }
  } catch (err) {
    log('error', 'whatsapp', 'Failed to send test message', { error: (err as Error).message })
    return { ok: false, error: (err as Error).message }
  }
}

export function getWhatsAppStatus(_userId: string): boolean {
  return currentSocket?.user?.id ? true : false
}

export function getOwnProfile(): { ownPhone: string | null; ownLid: string | null } {
  return { ownPhone, ownLid }
}

export async function disconnectWhatsApp(userId: string): Promise<void> {
  stopReconnecting = true
  if (currentSocket) {
    currentSocket.end(new Error('User disconnected'))
    currentSocket = null
  }
  isStarting = false
  latestQrDataUrl = null

  await prisma.whatsAppSession.updateMany({
    where: { userId },
    data: { isConnected: false },
  })
}

export async function restartWhatsApp(serverIo: SocketIOServer): Promise<void> {
  stopReconnecting = false
  reconnectAttempts = 0
  isStarting = false
  latestQrDataUrl = null
  await initWhatsAppBot(serverIo)
}

function cleanupSocket(): void {
  if (currentSocket) {
    try {
      currentSocket.end(new Error('Cleanup'))
    } catch {
      // socket may already be closed
    }
    currentSocket = null
  }
}

function createProxyAgent(): import('https').Agent | undefined {
  const proxyUrl = env.WA_PROXY_URL
  if (!proxyUrl) return undefined
  try {
    const agent = new SocksProxyAgent(proxyUrl)
    log('info', 'whatsapp', `Using proxy: ${proxyUrl}`)
    return agent
  } catch (err) {
    log('error', 'whatsapp', `Invalid proxy URL "${proxyUrl}": ${(err as Error).message}`)
    return undefined
  }
}

export async function initWhatsAppBot(serverIo: SocketIOServer): Promise<void> {
  setSocketIO(serverIo)

  if (isStarting) {
    log('info', 'whatsapp', 'Already starting, skipping duplicate init')
    return
  }

  if (stopReconnecting) {
    log('warn', 'whatsapp', 'WhatsApp bot permanently stopped')
    emit('whatsapp:status', {
      state: 'stopped',
      message: 'WhatsApp logged out. Clear auth and restart.',
    })
    return
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log('warn', 'whatsapp', `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`)
    emit('whatsapp:status', {
      state: 'failed',
      message: `Could not connect after ${MAX_RECONNECT_ATTEMPTS} attempts. Click "Connect WhatsApp" to retry.`,
    })
    return
  }

  isStarting = true

  emit('whatsapp:status', {
    state: 'connecting',
    message: reconnectAttempts === 0
      ? 'Connecting to WhatsApp servers...'
      : `Reconnecting... attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`,
    attempt: reconnectAttempts,
    maxAttempts: MAX_RECONNECT_ATTEMPTS,
  })

  try {
    cleanupSocket()

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const proxyAgent = createProxyAgent()

    const sock = makeWASocket({
      auth: state,
      syncFullHistory: false,
      browser: realisticBrowser(),
      agent: proxyAgent as any,
    })

    currentSocket = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async (msg) => {
      if (msg.type !== 'notify') return
      for (const message of msg.messages) {
        await handleIncomingMessage(sock, message)
      }
    })

    function upsertContacts(contacts: Contact[]) {
      log('info', 'whatsapp', `upsertContacts called with ${contacts.length} contacts`, { sample: contacts.slice(0, 2) })
      const seen = new Map<string, ContactEntry>()
      for (const c of contacts) {
        if (seen.has(c.id)) continue
        seen.set(c.id, {
          id: c.id,
          lid: (c as any).lid,
          name: c.name,
          notify: c.notify,
          verifiedName: c.verifiedName,
          phoneNumber: c.phoneNumber,
        })
      }
      contactsArray = contactsArray.filter(c => !seen.has(c.id))
      for (const entry of seen.values()) {
        contactsArray.push(entry)
      }
      saveContactsToDisk()
      log('info', 'whatsapp', `Contacts upsert: added ${seen.size} new, total ${contactsArray.length}`)
    }

    sock.ev.on('contacts.upsert', (contacts) => {
      log('info', 'whatsapp', 'RAW contacts.upsert event', { count: contacts.length, first: contacts[0] })
      upsertContacts(contacts)
    })

    sock.ev.on('contacts.update', (updates) => {
      log('info', 'whatsapp', 'contacts.update event', { count: updates.length, first: updates[0] })
      for (const u of updates) {
        if (!u.id) continue
        const existing = contactsArray.find(c => c.id === u.id)
        if (existing) {
          if ((u as any).lid) existing.lid = (u as any).lid
        } else {
          contactsArray.push({
            id: u.id,
            lid: (u as any).lid,
            name: u.name,
            notify: u.notify,
            verifiedName: u.verifiedName,
          })
        }
      }
      saveContactsToDisk()
    })

    sock.ev.on('messaging-history.set', (data) => {
      log('info', 'whatsapp', `messaging-history.set event`, { chats: data.chats?.length, contacts: data.contacts?.length, messages: data.messages?.length, syncType: data.syncType })
      if (data.contacts?.length) {
        upsertContacts(data.contacts)
      }
    })

    sock.ev.on('messaging-history.status', (status) => {
      log('info', 'whatsapp', 'messaging-history.status', { status: status.status, syncType: status.syncType })
    })

    sock.ev.on('chats.upsert', (chats) => {
      log('info', 'whatsapp', 'chats.upsert', { count: chats.length })
    })

    sock.ev.on('connection.update', async (update) => {
      try {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          try {
            latestQrDataUrl = await QRCode.toDataURL(qr, {
              width: 400,
              margin: 2,
              color: { dark: '#111', light: '#fff' },
            })
            emit('whatsapp:qr', { qr: latestQrDataUrl })
            emit('whatsapp:status', {
              state: 'qr_ready',
              message: 'QR code ready. Scan with your WhatsApp app.',
            })
            log('info', 'whatsapp', 'QR code generated')
          } catch (err) {
            log('error', 'whatsapp', 'Failed to generate QR image', {
              error: (err as Error).message,
            })
          }
        }

        if (connection === 'open') {
          reconnectAttempts = 0
          isStarting = false
          latestQrDataUrl = null
          ownPhone = sock.user?.id ? normalizeJid(sock.user.id) : null
          ownLid = (sock.user as any)?.lid ? (sock.user as any).lid.replace(/(:\d+)?(@lid)?$/, '') : null
          log('info', 'whatsapp', 'WhatsApp connected successfully', { ownPhone, ownLid })

          // Resync contacts BEFORE emitting whatsapp:ready so contacts.upsert
          // events (which include lid ↔ phone mappings) are fully processed
          try {
            await (sock as any).resyncAppState(['regular', 'regular_low'], true)
            log('info', 'whatsapp', 'Startup contacts resync completed to populate lid fields')
          } catch (err) {
            log('warn', 'whatsapp', 'Startup contacts resync failed', { error: (err as Error).message })
          }

          emit('whatsapp:ready', { connected: true })
          emit('whatsapp:status', {
            state: 'connected',
            message: 'WhatsApp connected successfully.',
          })

          const phone = ownPhone
          if (phone) {
            try {
              const existing = await prisma.whatsAppSession.findFirst({
                where: { userId: 'default' },
              })
              if (existing) {
                await prisma.whatsAppSession.update({
                  where: { id: existing.id },
                  data: { isConnected: true, phone },
                })
              } else {
                await prisma.whatsAppSession.create({
                  data: { userId: 'default', phone, isConnected: true },
                })
              }
            } catch {
              // session tracking is best-effort
            }
          }
        }

        if (connection === 'close') {
          isStarting = false
          latestQrDataUrl = null
          const reasonCode = (lastDisconnect?.error as any)?.output?.statusCode
          const isLoggedOut = reasonCode === DisconnectReason.loggedOut
          if (reasonCode) {
            log('info', 'whatsapp', `WhatsApp connection closed with reason code: ${reasonCode}${reasonCode === 405 ? ' (connection rejected by server — try proxy or VPS)' : reasonCode === 403 ? ' (forbidden)' : reasonCode === 401 ? ' (unauthorized)' : ''}`)
          }

          emit('whatsapp:disconnected', { reason: String(reasonCode) })
          cleanupSocket()

          if (isLoggedOut) {
            log('warn', 'whatsapp', 'WhatsApp logged out. Stopping reconnection.')
            stopReconnecting = true
            emit('whatsapp:status', {
              state: 'logged_out',
              message: 'WhatsApp logged out from phone. Click "Connect WhatsApp" to re-link.',
            })
            return
          }

          if (!stopReconnecting && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++
            const waitMs = Math.min(2000 * Math.pow(3, reconnectAttempts - 1), 60000)
            const retryMessage = `Connection lost. Retrying in ${Math.round(waitMs / 1000)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
            log('info', 'whatsapp', retryMessage)

            emit('whatsapp:status', {
              state: 'reconnecting',
              message: retryMessage,
              attempt: reconnectAttempts,
              maxAttempts: MAX_RECONNECT_ATTEMPTS,
            })

            await delay(waitMs)
            await initWhatsAppBot(serverIo)
          } else if (!stopReconnecting) {
            emit('whatsapp:status', {
              state: 'failed',
              message: `Connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Click "Connect WhatsApp" to retry.`,
            })
          }
        }
      } catch (err) {
        log('error', 'whatsapp', 'Error in connection.update handler', {
          error: (err as Error).message,
          stack: (err as Error).stack,
        })
      }
    })

    log('info', 'whatsapp', 'WhatsApp bot initialized (async, waiting for connection)')
  } catch (err) {
    isStarting = false
    log('error', 'whatsapp', 'Failed to initialize WhatsApp bot', {
      error: (err as Error).message,
    })

    if (!stopReconnecting && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++
      const waitMs = Math.min(2000 * Math.pow(3, reconnectAttempts - 1), 60000)
      emit('whatsapp:status', {
        state: 'reconnecting',
        message: `Init failed. Retrying in ${Math.round(waitMs / 1000)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
        attempt: reconnectAttempts,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })
      await delay(waitMs)
      await initWhatsAppBot(serverIo)
    } else {
      emit('whatsapp:status', {
        state: 'failed',
        message: `Connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Click "Connect WhatsApp" to retry.`,
      })
    }
  }
}

function normalizeJid(jid: string): string {
  const num = jid.split(':')[0].split('@')[0]
  return num.startsWith('961') ? num.slice(3) : num
}

async function isAllowedSender(sock: any, sender: string, payload: any, isGroup = false, remoteJid = ''): Promise<boolean> {
  if (payload.contactJid) {
    const normSender = normalizeJid(sender)
    const normContact = normalizeJid(payload.contactJid)
    log('info', 'whatsapp', 'isAllowedSender contactJid', { sender, normSender, contactJid: payload.contactJid, normContact, ownPhone, ownLid })

    if (normSender === normContact) { log('info', 'whatsapp', 'isAllowedSender: direct match'); return true }

    if (isGroup && ownPhone && ownLid) {
      if (normSender === ownLid && normContact === ownPhone) { log('info', 'whatsapp', 'isAllowedSender: ownLid→ownPhone bridge'); return true }
      if (normSender === ownPhone && normContact === ownLid) { log('info', 'whatsapp', 'isAllowedSender: ownPhone→ownLid bridge'); return true }
    }

    // For individual chats, the remoteJid is the chat partner; if it matches the contact, allow
    if (!isGroup && normalizeJid(remoteJid) === normContact) { log('info', 'whatsapp', 'isAllowedSender: individual chat remoteJid matches contactJid'); return true }

    const contact = contactsArray.find(c =>
      normalizeJid(c.id) === normContact || (c.lid && normalizeJid(c.lid) === normContact) || c.id === payload.contactJid
    )
    if (contact) {
      if (normalizeJid(contact.id) === normSender) { log('info', 'whatsapp', 'isAllowedSender: contact forward match', { contactId: contact.id }); return true }
      if (contact.lid && normalizeJid(contact.lid) === normSender) { log('info', 'whatsapp', 'isAllowedSender: contact lid forward match', { contactId: contact.id, lid: contact.lid }); return true }
    }

    const senderContact = contactsArray.find(c =>
      (c.lid && normalizeJid(c.lid) === normSender) || normalizeJid(c.id) === normSender
    )
    if (senderContact) {
      if (normalizeJid(senderContact.id) === normContact) { log('info', 'whatsapp', 'isAllowedSender: reverse match', { contactId: senderContact.id }); return true }
      if (senderContact.lid && normalizeJid(senderContact.lid) === normContact) { log('info', 'whatsapp', 'isAllowedSender: reverse lid match', { contactId: senderContact.id, lid: senderContact.lid }); return true }
    }

    log('info', 'whatsapp', 'isAllowedSender contactJid: no match', { normSender, normContact })
    return false
  }
  if (payload.contactGroupId) {
    const group = contactGroups.find(g => g.id === payload.contactGroupId)
    if (!group) { log('info', 'whatsapp', 'isAllowedSender: group not found', { groupId: payload.contactGroupId }); return false }
    const normalizedSender = normalizeJid(sender)
    log('info', 'whatsapp', 'isAllowedSender contactGroupId', { sender, normalizedSender, groupId: payload.contactGroupId, memberJids: group.memberJids, ownPhone, ownLid, contactsCount: contactsArray.length })

    if (group.memberJids.some(m => normalizeJid(m) === normalizedSender)) { log('info', 'whatsapp', 'isAllowedSender: direct group member match'); return true }

    // If the message is from a group chat whose JID is a member of this contact group, allow all senders
    if (isGroup && group.memberJids.some(m => normalizeJid(m) === normalizeJid(remoteJid))) {
      log('info', 'whatsapp', 'isAllowedSender: group chat is member of contact group, allowing', { remoteJid })
      return true
    }

    // For individual chats, the remoteJid is the chat partner; if they're a member, allow
    if (!isGroup && group.memberJids.some(m => normalizeJid(m) === normalizeJid(remoteJid))) {
      log('info', 'whatsapp', 'isAllowedSender: individual chat remoteJid matches member', { remoteJid })
      return true
    }

    // Resolve LID ↔ PN using the server-side lidMapping (can trigger USync query)
    if (sender.endsWith('@lid')) {
      try {
        // Fast local lookup: try to get PN for the sender's LID
        const resolvedPn = await (sock as any).signalRepository?.lidMapping?.getPNForLID(normalizedSender)
        if (resolvedPn) {
          const resolvedNorm = normalizeJid(resolvedPn)
          log('info', 'whatsapp', 'isAllowedSender: lidMapping getPNForLID resolved', { normalizedSender, resolvedPn, resolvedNorm })
          if (group.memberJids.some(m => normalizeJid(m) === resolvedNorm)) {
            log('info', 'whatsapp', 'isAllowedSender: lidMapping member PN match')
            return true
          }
        }
      } catch (err) {
        log('warn', 'whatsapp', 'isAllowedSender: lidMapping getPNForLID error', { error: (err as Error).message })
      }
      // If local lookup failed, try iterating members with getLIDForPN (can trigger USync query)
      try {
        for (const memberJid of group.memberJids) {
          if (!memberJid.endsWith('@s.whatsapp.net') && !memberJid.endsWith('@lid')) continue
          const memberLid = await (sock as any).signalRepository?.lidMapping?.getLIDForPN(memberJid)
          if (memberLid) {
            const normalizedMemberLid = normalizeJid(memberLid)
            log('info', 'whatsapp', 'isAllowedSender: lidMapping getLIDForPN', { memberJid, memberLid, normalizedMemberLid, normalizedSender })
            if (normalizedMemberLid === normalizedSender) {
              log('info', 'whatsapp', 'isAllowedSender: lidMapping member LID match')
              return true
            }
          }
        }
      } catch (err) {
        log('warn', 'whatsapp', 'isAllowedSender: lidMapping getLIDForPN error', { error: (err as Error).message })
      }
    }

    const senderEntry = contactsArray.find(c =>
      (c.lid && normalizeJid(c.lid) === normalizedSender) || normalizeJid(c.id) === normalizedSender
    )
    log('info', 'whatsapp', 'isAllowedSender: senderEntry lookup', { found: !!senderEntry, entry: senderEntry ? { id: senderEntry.id, lid: senderEntry.lid, phoneNumber: senderEntry.phoneNumber } : null })
    if (senderEntry) {
      const contactIds = [normalizeJid(senderEntry.id)]
      if (senderEntry.lid) contactIds.push(normalizeJid(senderEntry.lid))
      if (senderEntry.phoneNumber) contactIds.push(normalizeJid(senderEntry.phoneNumber))
      log('info', 'whatsapp', 'isAllowedSender: contactIds', { contactIds, checkMember: group.memberJids.map(m => normalizeJid(m)) })
      if (group.memberJids.some(m => contactIds.includes(normalizeJid(m)))) { log('info', 'whatsapp', 'isAllowedSender: forward contacts bridge match'); return true }
    }

    for (const memberJid of group.memberJids) {
      const normMember = normalizeJid(memberJid)
      const memberEntry = contactsArray.find(c =>
        normalizeJid(c.id) === normMember ||
        (c.lid && normalizeJid(c.lid) === normMember) ||
        (c.phoneNumber && normalizeJid(c.phoneNumber) === normMember)
      )
      log('info', 'whatsapp', 'isAllowedSender: reverse memberEntry', { memberJid, normalizedMember: normMember, found: !!memberEntry, entry: memberEntry ? { id: memberEntry.id, lid: memberEntry.lid, phoneNumber: memberEntry.phoneNumber } : null })
      if (memberEntry) {
        const memberIds = [normalizeJid(memberEntry.id)]
        if (memberEntry.lid) memberIds.push(normalizeJid(memberEntry.lid))
        if (memberEntry.phoneNumber) memberIds.push(normalizeJid(memberEntry.phoneNumber))
        log('info', 'whatsapp', 'isAllowedSender: memberIds', { memberIds, normalizedSender })
        if (memberIds.includes(normalizedSender)) { log('info', 'whatsapp', 'isAllowedSender: reverse contacts bridge match'); return true }
      }
    }

    // ownLid bridge only applies when the group chat is a member of this contact group
    const groupJidNorm = normalizeJid(remoteJid)
    const isRelevantGroup = group.memberJids.some(m => normalizeJid(m) === groupJidNorm)
    if (isGroup && ownPhone && ownLid && isRelevantGroup) {
      log('info', 'whatsapp', 'isAllowedSender: ownPhone/ownLid bridge check', { normalizedSender, ownLid, ownPhone, membersNorm: group.memberJids.map(m => normalizeJid(m)) })
      if (normalizedSender === ownLid && group.memberJids.some(m => normalizeJid(m) === ownPhone)) { log('info', 'whatsapp', 'isAllowedSender: ownLid→ownPhone group bridge'); return true }
      if (normalizedSender === ownPhone && group.memberJids.some(m => normalizeJid(m) === ownLid)) { log('info', 'whatsapp', 'isAllowedSender: ownPhone→ownLid group bridge'); return true }
      // Fallback: ownPhone ends with the member JID (missing country code prefix)
      const phone = ownPhone
      const membersNorm = group.memberJids.map(m => normalizeJid(m))
      if (normalizedSender === ownLid && membersNorm.some(m => phone!.endsWith(m))) { log('info', 'whatsapp', 'isAllowedSender: ownLid→ownPhone suffix fallback'); return true }
    }

    log('info', 'whatsapp', 'isAllowedSender contactGroupId: no match')
    return false
  }
  return true
}

async function handleIncomingMessage(sock: WASocket, message: WAMessage): Promise<void> {
  try {
    const sender = message.key.remoteJid
    if (!sender || sender.includes('status@broadcast')) return
    const actualSender = message.key.participant || sender

    const textContent =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      ''

    // ── Handle fromMe messages → facebook_feed automation ──────────────
    if (message.key.fromMe) {
      const normSender = normalizeJid(sender)
      if (normSender !== ownPhone && normSender !== ownLid) return
      const fbRules = await prisma.automationRule.findMany({
        where: { isActive: true, platform: 'whatsapp', actionType: 'facebook_feed' },
      })
      if (fbRules.length === 0) return

      for (const rule of fbRules) {
        let payload: any
        try { payload = JSON.parse(rule.actionPayload) } catch { payload = {} }
        if (!await isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender)) continue

        const fbPage = await prisma.facebookPage.findFirst({ where: { userId: rule.userId } })
        if (!fbPage) continue

        try {
          const imageMsg = message.message?.imageMessage
          let content = textContent
          let mediaUrls: string[] | null = null

          if (imageMsg) {
            const buffer = await downloadMediaMessage(message, 'buffer', {})
            const fileName = `fb_${Date.now()}.jpg`
            const filePath = path.resolve(process.cwd(), 'uploads', fileName)
            fs.writeFileSync(filePath, buffer as Buffer)
            content = imageMsg.caption || textContent || ''
            mediaUrls = [`${env.FRONTEND_URL.replace(/:\d+$/, '')}:3001/uploads/${fileName}`]
            await publishPost(fbPage.pageId, content, mediaUrls, fbPage.accessToken)
          } else {
            const docMsg = message.message?.documentMessage
            if (docMsg) {
              content = `${docMsg.caption || textContent}\n\n${docMsg.fileName || 'document'}`
              await publishPost(fbPage.pageId, content, null, fbPage.accessToken)
            } else if (textContent) {
              content = textContent
              await publishPost(fbPage.pageId, content, null, fbPage.accessToken)
            }
          }

          await prisma.facebookPostLog.create({
            data: { userId: rule.userId, pageId: fbPage.pageId, content, mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null, status: 'success', ruleId: rule.id },
          })
          log('info', 'whatsapp', 'facebook_feed: post sent', { ruleId: rule.id, pageId: fbPage.pageId })
        } catch (err) {
          await prisma.facebookPostLog.create({
            data: { userId: rule.userId, pageId: fbPage.pageId, content: textContent || '', status: 'failed', error: (err as Error).message, ruleId: rule.id },
          })
          log('error', 'whatsapp', 'facebook_feed: post failed', { ruleId: rule.id, error: (err as Error).message })
        }
      }
      return
    }

    const listResponse = message.message?.listResponseMessage
    const interactiveResponse = message.message?.interactiveResponseMessage

    if (!textContent && !listResponse && !interactiveResponse) return

    // Resolve selected option ID from either native response or text menu reply
    let selectedId: string | undefined
    if (listResponse?.singleSelectReply?.selectedRowId) {
      selectedId = listResponse.singleSelectReply.selectedRowId
    } else if (interactiveResponse?.nativeFlowResponseMessage?.paramsJson) {
      try {
        const nfParams = JSON.parse(interactiveResponse.nativeFlowResponseMessage.paramsJson)
        selectedId = nfParams.id || nfParams.selectedRowId
      } catch { /* ignore parse errors */ }
    } else if (textContent) {
      // Text-based menu: check if the message is just a number matching an option index
      const trimmed = textContent.trim()
      const num = parseInt(trimmed, 10)
      log('info', 'whatsapp', 'Text menu handler', { textContent, trimmed, num, isNum: !isNaN(num) })
      if (!isNaN(num) && num > 0) {
        // Look up rules to find if this sender has an active interactive rule
        const rules = await prisma.automationRule.findMany({
          where: {
            isActive: true,
            platform: 'whatsapp',
            triggerType: 'keyword_comment',
          },
        })
        log('info', 'whatsapp', 'Text menu: rules found', { count: rules.length })
        for (const rule of rules) {
          let payload: any
          try { payload = JSON.parse(rule.actionPayload) } catch {
            log('info', 'whatsapp', 'Text menu: parse failed', { ruleId: rule.id, actionPayload: rule.actionPayload?.substring(0, 100) })
            continue
          }
          log('info', 'whatsapp', 'Text menu: rule payload', { ruleId: rule.id, interactive: payload.interactive, optionsCount: payload.options?.length })
          if (!payload.interactive || !payload.options) continue
          if (!await isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender)) {
            log('info', 'whatsapp', 'Text menu: sender not allowed for rule', { ruleId: rule.id, sender: actualSender })
            continue
          }
          const optionIndex = num - 1
          log('info', 'whatsapp', 'Text menu: checking option', { optionIndex, optionsLen: payload.options.length })
          if (optionIndex < payload.options.length) {
            selectedId = payload.options[optionIndex].id
            log('info', 'whatsapp', 'Text menu: selectedId set', { selectedId, ruleId: rule.id })
          }
          if (selectedId) break
        }
      }
    }

    if (selectedId) {
      log('info', 'whatsapp', 'Follow-up: selectedId present', { selectedId, sender })
      const rules = await prisma.automationRule.findMany({
        where: {
          isActive: true,
          platform: 'whatsapp',
          triggerType: 'keyword_comment',
        },
      })
      log('info', 'whatsapp', 'Follow-up: rules found', { count: rules.length })
      for (const rule of rules) {
        let payload: any
        try { payload = JSON.parse(rule.actionPayload) } catch {
          log('info', 'whatsapp', 'Follow-up: parse failed', { ruleId: rule.id })
          continue
        }
        if (!payload.interactive || !payload.options) {
          log('info', 'whatsapp', 'Follow-up: not interactive', { ruleId: rule.id })
          continue
        }
        if (!await isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender)) {
          log('info', 'whatsapp', 'Follow-up: sender not allowed for rule', { ruleId: rule.id, sender: actualSender })
          continue
        }
        const option = payload.options.find((o: any) => o.id === selectedId)
        log('info', 'whatsapp', 'Follow-up: option lookup', { ruleId: rule.id, found: !!option, hasReply: !!option?.reply })
        if (!option?.reply) continue
        const lastFollowup = followupTimestamps.get(sender) || 0
        if (Date.now() - lastFollowup < MIN_FOLLOWUP_THROTTLE_MS) {
          log('info', 'whatsapp', 'Follow-up: throttled', { ruleId: rule.id, sender })
          continue
        }
        try {
          await delay(randomDelay(1000, 3000))
          await Promise.race([
            sock.sendMessage(sender, { text: option.reply } as any),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Follow-up send timed out')), 15000)),
          ])
          followupTimestamps.set(sender, Date.now())
          log('info', 'whatsapp', 'Interactive follow-up sent', { ruleId: rule.id, sender, optionId: selectedId })
        } catch (err) {
          log('error', 'whatsapp', 'Failed to send interactive follow-up', { ruleId: rule.id, sender, error: (err as Error).message })
        }
      }
      return
    }

    if (!textContent) return

    const rules = await prisma.automationRule.findMany({
      where: {
        isActive: true,
        platform: 'whatsapp',
        triggerType: 'keyword_comment',
      },
    })

    for (const rule of rules) {
      const triggers = rule.triggerValue.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      if (!triggers.some(t => textContent.toLowerCase().includes(t))) continue

      const lastSent = threadTimestamps.get(sender) || 0
      const now = Date.now()
      if (now - lastSent < MIN_THROTTLE_MS) {
        log('info', 'whatsapp', 'Rate limited - skipping reply', { sender })
        continue
      }

      let payload: { replyText?: string; mediaUrl?: string; mediaUrls?: string[]; mediaType?: string; fileName?: string; caption?: string; interactive?: boolean; options?: Array<{ id: string; label: string; reply: string }>; contactJid?: string; contactGroupId?: string }
      try {
        payload = JSON.parse(rule.actionPayload)
      } catch {
        payload = { replyText: rule.actionPayload }
      }

      if (!await isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender)) {
        log('info', 'whatsapp', 'Main: sender not allowed for rule', { ruleId: rule.id, sender: actualSender })
        continue
      }

      function resolveMediaUrl(url: string): string {
        if (url.startsWith('http://') || url.startsWith('https://')) return url
        const localPath = url.startsWith('/uploads/')
          ? path.join(path.resolve(process.cwd(), 'uploads'), url.replace('/uploads/', ''))
          : path.resolve(url)
        if (fs.existsSync(localPath)) return localPath
        return url
      }

      function buildMediaContent(url: string): Record<string, unknown> {
        const mediaUrl = resolveMediaUrl(url)
        const caption = payload.caption || payload.replyText || ''
        switch (payload.mediaType) {
          case 'image':
            return { image: { url: mediaUrl }, caption }
          case 'audio':
            return { audio: { url: mediaUrl }, mimetype: 'audio/mp4' }
          case 'video':
            return { video: { url: mediaUrl }, caption }
          case 'document':
            return { document: { url: mediaUrl }, fileName: payload.fileName || 'document', caption }
          default:
            return { text: payload.replyText || 'Thanks for your message!' }
        }
      }

      const urls = payload.mediaUrls?.length ? payload.mediaUrls : (payload.mediaUrl ? [payload.mediaUrl] : [])

      try {
        if (!checkGlobalRate()) {
          log('warn', 'whatsapp', 'Global rate limit hit - skipping reply', { sender })
          continue
        }

        const typingDelay = randomDelay(3000, 8000)
        await delay(typingDelay)

        async function sendWithTimeout(jid: string, content: any, ms = 20000): Promise<void> {
          await Promise.race([
            sock.sendMessage(jid, content as any),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Send timed out after ' + ms + 'ms')), ms)),
          ])
        }

        if (payload.interactive && payload.options?.length) {
          // Build a text-based menu with numbered options
          const lines = [payload.replyText || 'Please choose an option:', '']
          payload.options.forEach((opt: any, i: number) => {
            lines.push(`${i + 1}. ${opt.label}`)
          })
          lines.push('', 'Reply with the number of your choice.')
          await sendWithTimeout(sender, { text: lines.join('\n') })
        } else if (urls.length && payload.mediaType && payload.mediaType !== 'none') {
          for (let i = 0; i < urls.length; i++) {
            const msg = buildMediaContent(urls[i])
            await sendWithTimeout(sender, msg)
            if (i < urls.length - 1) await delay(1000)
          }
        } else {
          await sendWithTimeout(sender, { text: payload.replyText || 'Thanks for your message!' })
        }

        threadTimestamps.set(sender, Date.now())

        log('info', 'whatsapp', 'Auto-reply sent', {
          ruleId: rule.id,
          sender,
          delay: typingDelay,
        })
      } catch (err) {
        log('error', 'whatsapp', 'Failed to send auto-reply', {
          ruleId: rule.id,
          sender,
          error: (err as Error).message,
        })
      }
    }
  } catch (err) {
    log('error', 'whatsapp', 'Unhandled error in handleIncomingMessage', { error: (err as Error).message })
  }
}
