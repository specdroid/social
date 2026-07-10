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
import os from 'os'
import { execFile } from 'child_process'
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
interface CreateRuleWizard {
  name: string
  platform?: number
  triggerValues?: string[]
  contactJids?: string[]
  contactGroupIds?: string[]
  contactGroupNames?: string[]
  savedGroupListNames?: string[]
  replyText?: string
  mediaTypeCode?: number
  step: number
  createdAt: number
}

const createRuleWizards = new Map<string, CreateRuleWizard>()
const WIZARD_TIMEOUT_MS = 5 * 60 * 1000

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

/** Send a text message to a WhatsApp JID using the active socket. */
export async function sendWhatsAppMessage(jid: string, text: string): Promise<void> {
  if (!currentSocket) throw new Error('WhatsApp bot not connected')
  await currentSocket.sendMessage(jid, { text })
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

export function forceCleanAuth(): void {
  if (currentSocket) {
    try {
      currentSocket.end(new Error('Force clean'))
    } catch {
      // ignore
    }
    currentSocket = null
  }
  stopReconnecting = true
  isStarting = false
  latestQrDataUrl = null
  ownPhone = null
  ownLid = null
  contactsArray = []
  if (fs.existsSync(AUTH_DIR)) {
    for (const file of fs.readdirSync(AUTH_DIR)) {
      try {
        fs.unlinkSync(path.join(AUTH_DIR, file))
      } catch {
        // skip locked files
      }
    }
  }
  log('info', 'whatsapp', 'Auth folder force cleaned — all files removed')
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

export async function getWhatsAppGroups(): Promise<Array<{ jid: string; subject: string }>> {
  if (!currentSocket?.user?.id) return []
  const groups = await currentSocket.groupFetchAllParticipating().catch(() => ({} as Record<string, any>))
  return Object.entries(groups).map(([jid, meta]) => ({
    jid,
    subject: (meta as any).subject || jid,
  }))
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
              const existing = await prisma.whatsAppSession.findFirst()
              if (existing) {
                await prisma.whatsAppSession.update({
                  where: { id: existing.id },
                  data: { isConnected: true, phone },
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

async function isAllowedSender(sock: any, sender: string, payload: any, isGroup = false, remoteJid = '', allGroups?: Record<string, any>): Promise<boolean> {
  const normSender = normalizeJid(sender)
  let hasRestriction = false

  // Check contactJids array (new format)
  if (payload.contactJids?.length) {
    hasRestriction = true
    for (const jid of payload.contactJids) {
      const normContact = normalizeJid(jid)
      log('info', 'whatsapp', 'isAllowedSender contactJids', { sender, normSender, jid, normContact, ownPhone, ownLid })

      if (normSender === normContact) { log('info', 'whatsapp', 'isAllowedSender: direct match'); return true }

      if (isGroup && ownPhone && ownLid) {
        if (normSender === ownLid && normContact === ownPhone) { log('info', 'whatsapp', 'isAllowedSender: ownLid→ownPhone bridge'); return true }
        if (normSender === ownPhone && normContact === ownLid) { log('info', 'whatsapp', 'isAllowedSender: ownPhone→ownLid bridge'); return true }
      }

      if (!isGroup && normalizeJid(remoteJid) === normContact) { log('info', 'whatsapp', 'isAllowedSender: individual chat remoteJid matches contactJid'); return true }

      const contact = contactsArray.find(c =>
        normalizeJid(c.id) === normContact || (c.lid && normalizeJid(c.lid) === normContact) || c.id === jid
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
    }
    log('info', 'whatsapp', 'isAllowedSender contactJids: no match', { normSender })
  }

  // Check single contactJid (legacy)
  if (payload.contactJid) {
    hasRestriction = true
    const normContact = normalizeJid(payload.contactJid)
    log('info', 'whatsapp', 'isAllowedSender contactJid', { sender, normSender, contactJid: payload.contactJid, normContact, ownPhone, ownLid })

    if (normSender === normContact) { log('info', 'whatsapp', 'isAllowedSender: direct match'); return true }

    if (isGroup && ownPhone && ownLid) {
      if (normSender === ownLid && normContact === ownPhone) { log('info', 'whatsapp', 'isAllowedSender: ownLid→ownPhone bridge'); return true }
      if (normSender === ownPhone && normContact === ownLid) { log('info', 'whatsapp', 'isAllowedSender: ownPhone→ownLid bridge'); return true }
    }

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
  }

  // Check contactGroupIds array (new format)
  if (payload.contactGroupIds?.length) {
    hasRestriction = true
    for (const groupId of payload.contactGroupIds) {
      const group = contactGroups.find(g => g.id === groupId)
      if (!group) { log('info', 'whatsapp', 'isAllowedSender: contactGroupIds group not found', { groupId }); continue }
      log('info', 'whatsapp', 'isAllowedSender contactGroupIds', { sender, normSender, groupId, groupName: group.name })

      if (group.memberJids.some(m => normalizeJid(m) === normSender)) { log('info', 'whatsapp', 'isAllowedSender: contactGroupIds direct member match'); return true }
      if (isGroup && group.memberJids.some(m => normalizeJid(m) === normalizeJid(remoteJid))) { log('info', 'whatsapp', 'isAllowedSender: contactGroupIds group chat match'); return true }
      if (!isGroup && group.memberJids.some(m => normalizeJid(m) === normalizeJid(remoteJid))) { log('info', 'whatsapp', 'isAllowedSender: contactGroupIds individual remoteJid match'); return true }

      if (sender.endsWith('@lid')) {
        try {
          const resolvedPn = await (sock as any).signalRepository?.lidMapping?.getPNForLID(normSender)
          if (resolvedPn) {
            const resolvedNorm = normalizeJid(resolvedPn)
            if (group.memberJids.some(m => normalizeJid(m) === resolvedNorm)) { log('info', 'whatsapp', 'isAllowedSender: contactGroupIds lidMapping PN match'); return true }
          }
        } catch { /* ignore */ }
        try {
          for (const memberJid of group.memberJids) {
            if (!memberJid.endsWith('@s.whatsapp.net') && !memberJid.endsWith('@lid')) continue
            const memberLid = await (sock as any).signalRepository?.lidMapping?.getLIDForPN(memberJid)
            if (memberLid && normalizeJid(memberLid) === normSender) { log('info', 'whatsapp', 'isAllowedSender: contactGroupIds lidMapping LID match'); return true }
          }
        } catch { /* ignore */ }
      }

      const senderEntry = contactsArray.find(c =>
        (c.lid && normalizeJid(c.lid) === normSender) || normalizeJid(c.id) === normSender
      )
      if (senderEntry) {
        const contactIds = [normalizeJid(senderEntry.id)]
        if (senderEntry.lid) contactIds.push(normalizeJid(senderEntry.lid))
        if (senderEntry.phoneNumber) contactIds.push(normalizeJid(senderEntry.phoneNumber))
        if (group.memberJids.some(m => contactIds.includes(normalizeJid(m)))) { log('info', 'whatsapp', 'isAllowedSender: contactGroupIds bridge match'); return true }
      }
    }
    log('info', 'whatsapp', 'isAllowedSender contactGroupIds: no match')
  }

  // Check single contactGroupId (legacy)
  if (payload.contactGroupId) {
    hasRestriction = true
    const group = contactGroups.find(g => g.id === payload.contactGroupId)
    if (!group) { log('info', 'whatsapp', 'isAllowedSender: group not found', { groupId: payload.contactGroupId }) }
    else {
      const normalizedSender = normSender
      log('info', 'whatsapp', 'isAllowedSender contactGroupId', { sender, normalizedSender, groupId: payload.contactGroupId, memberJids: group.memberJids, ownPhone, ownLid, contactsCount: contactsArray.length })

      if (group.memberJids.some(m => normalizeJid(m) === normalizedSender)) { log('info', 'whatsapp', 'isAllowedSender: direct group member match'); return true }
      if (isGroup && group.memberJids.some(m => normalizeJid(m) === normalizeJid(remoteJid))) { log('info', 'whatsapp', 'isAllowedSender: group chat is member of contact group, allowing', { remoteJid }); return true }
      if (!isGroup && group.memberJids.some(m => normalizeJid(m) === normalizeJid(remoteJid))) { log('info', 'whatsapp', 'isAllowedSender: individual chat remoteJid matches member', { remoteJid }); return true }

      if (sender.endsWith('@lid')) {
        try {
          const resolvedPn = await (sock as any).signalRepository?.lidMapping?.getPNForLID(normalizedSender)
          if (resolvedPn) {
            const resolvedNorm = normalizeJid(resolvedPn)
            if (group.memberJids.some(m => normalizeJid(m) === resolvedNorm)) { log('info', 'whatsapp', 'isAllowedSender: lidMapping member PN match'); return true }
          }
        } catch { /* ignore */ }
        try {
          for (const memberJid of group.memberJids) {
            if (!memberJid.endsWith('@s.whatsapp.net') && !memberJid.endsWith('@lid')) continue
            const memberLid = await (sock as any).signalRepository?.lidMapping?.getLIDForPN(memberJid)
            if (memberLid && normalizeJid(memberLid) === normalizedSender) { log('info', 'whatsapp', 'isAllowedSender: lidMapping member LID match'); return true }
          }
        } catch { /* ignore */ }
      }

      const senderEntry = contactsArray.find(c =>
        (c.lid && normalizeJid(c.lid) === normalizedSender) || normalizeJid(c.id) === normalizedSender
      )
      if (senderEntry) {
        const contactIds = [normalizeJid(senderEntry.id)]
        if (senderEntry.lid) contactIds.push(normalizeJid(senderEntry.lid))
        if (senderEntry.phoneNumber) contactIds.push(normalizeJid(senderEntry.phoneNumber))
        if (group.memberJids.some(m => contactIds.includes(normalizeJid(m)))) { log('info', 'whatsapp', 'isAllowedSender: forward contacts bridge match'); return true }
      }

      for (const memberJid of group.memberJids) {
        const normMember = normalizeJid(memberJid)
        const memberEntry = contactsArray.find(c =>
          normalizeJid(c.id) === normMember || (c.lid && normalizeJid(c.lid) === normMember) || (c.phoneNumber && normalizeJid(c.phoneNumber) === normMember)
        )
        if (memberEntry) {
          const memberIds = [normalizeJid(memberEntry.id)]
          if (memberEntry.lid) memberIds.push(normalizeJid(memberEntry.lid))
          if (memberEntry.phoneNumber) memberIds.push(normalizeJid(memberEntry.phoneNumber))
          if (memberIds.includes(normalizedSender)) { log('info', 'whatsapp', 'isAllowedSender: reverse contacts bridge match'); return true }
        }
      }

      const groupJidNorm = normalizeJid(remoteJid)
      const isRelevantGroup = group.memberJids.some(m => normalizeJid(m) === groupJidNorm)
      if (isGroup && ownPhone && ownLid && isRelevantGroup) {
        log('info', 'whatsapp', 'isAllowedSender: ownPhone/ownLid bridge check', { normalizedSender, ownLid, ownPhone, membersNorm: group.memberJids.map(m => normalizeJid(m)) })
        if (normalizedSender === ownLid && group.memberJids.some(m => normalizeJid(m) === ownPhone)) { log('info', 'whatsapp', 'isAllowedSender: ownLid→ownPhone group bridge'); return true }
        if (normalizedSender === ownPhone && group.memberJids.some(m => normalizeJid(m) === ownLid)) { log('info', 'whatsapp', 'isAllowedSender: ownPhone→ownLid group bridge'); return true }
        const phone = ownPhone
        const membersNorm = group.memberJids.map(m => normalizeJid(m))
        if (normalizedSender === ownLid && membersNorm.some(m => phone!.endsWith(m))) { log('info', 'whatsapp', 'isAllowedSender: ownLid→ownPhone suffix fallback'); return true }
      }

      log('info', 'whatsapp', 'isAllowedSender contactGroupId: no match')
    }
  }

  // Check savedGroupListNames — allow if current group matches any group in a saved list
  if (payload.savedGroupListNames?.length) {
    hasRestriction = true
    if (isGroup && allGroups) {
      const groupMeta = allGroups[remoteJid]
      const subject = (groupMeta as any)?.subject || ''
      for (const listName of payload.savedGroupListNames) {
        try {
          const savedList = await prisma.savedGroupList.findUnique({ where: { name: listName } })
          if (!savedList) { log('info', 'whatsapp', 'isAllowedSender: savedGroupList not found', { listName }); continue }
          const groupNames: string[] = JSON.parse(savedList.groups)
          log('info', 'whatsapp', 'isAllowedSender savedGroupListNames', { sender, normSender, listName, groupNames, subject })
          if (groupNames.some(g => g.toLowerCase().trim() === subject.toLowerCase().trim())) {
            log('info', 'whatsapp', 'isAllowedSender: savedGroupListNames match')
            return true
          }
        } catch { continue }
      }
    }
    log('info', 'whatsapp', 'isAllowedSender savedGroupListNames: no match', { isGroup, hasAllGroups: !!allGroups })
  }

  if (hasRestriction) {
    log('info', 'whatsapp', 'isAllowedSender: all checks failed')
    return false
  }
  return true
}

async function processCommands(
  sock: WASocket,
  sender: string,
  actualSender: string,
  textContent: string,
  message: WAMessage,
  allGroups: Record<string, any>,
  myJids: string[],
): Promise<boolean> {
  // ── Wizard: handle active create-rule wizard responses ──
  if (createRuleWizards.has(sender)) {
    const wizard = createRuleWizards.get(sender)!
    if (Date.now() - wizard.createdAt > WIZARD_TIMEOUT_MS) {
      createRuleWizards.delete(sender)
      await sock.sendMessage(sender, { text: '⏰ Wizard timed out. Start again with `ws create rule <name>`.' })
      return true
    }
    const trimmed = textContent.trim().toLowerCase()
    if (trimmed === 'cancel' || trimmed === 'exit') {
      createRuleWizards.delete(sender)
      await sock.sendMessage(sender, { text: '❌ Wizard cancelled.' })
      return true
    }

    const parseCommaList = (raw: string): string[] =>
      raw.split(/[,،]/).map(s => s.trim().replace(/\.\.\.$/, '').trim()).filter(Boolean)

    switch (wizard.step) {
      case 0: {
        const num = parseInt(trimmed, 10)
        if (isNaN(num) || num < 0 || num > 2) {
          await sock.sendMessage(sender, { text: '❌ Invalid. Choose 0 for Facebook, 1 for Instagram, 2 for WhatsApp.' })
          return true
        }
        wizard.platform = num
        wizard.step = 1
        await sock.sendMessage(sender, { text: '✏️ Trigger values? Send comma-separated, e.g. `price, السعر`' })
        return true
      }
      case 1: {
        const vals = parseCommaList(trimmed)
        if (vals.length === 0) {
          await sock.sendMessage(sender, { text: '❌ At least one trigger value is required. Send comma-separated values, e.g. `price, السعر`' })
          return true
        }
        wizard.triggerValues = vals
        wizard.step = 2
        await sock.sendMessage(sender, { text: '📞 Contacts? Send phone numbers comma-separated, e.g. `70656517, 96176814597`\nOr send `-` for none.' })
        return true
      }
      case 2: {
        const raw = trimmed.replace(/^[-–—]+$/, '').trim()
        wizard.contactJids = raw
          ? raw.split(',').map(s => s.trim().replace(/\.\.\.$/, '').trim()).filter(Boolean).map(p => p.includes('@') ? p : p + '@s.whatsapp.net')
          : []
        wizard.step = 3
        await sock.sendMessage(sender, { text: '👥 Groups (Contact Groups or Group Lists)? Send names comma-separated, e.g. `Test, school`\nOr send `-` for none.' })
        return true
      }
      case 3: {
        const raw = trimmed.replace(/^[-–—]+$/, '').trim()
        const names = raw ? parseCommaList(raw) : []
        const resolvedContactGroupIds: string[] = []
        const resolvedContactGroupNames: string[] = []
        const resolvedSavedListNames: string[] = []
        const allSavedLists = await prisma.savedGroupList.findMany()
        for (const name of names) {
          const cg = contactGroups.find(g => g.name.toLowerCase() === name.toLowerCase())
          if (cg) {
            resolvedContactGroupIds.push(cg.id)
            resolvedContactGroupNames.push(cg.name)
            continue
          }
          const sl = allSavedLists.find(l => l.name.toLowerCase() === name.toLowerCase())
          if (sl) {
            resolvedSavedListNames.push(sl.name)
            continue
          }
          const contactGroupNames = contactGroups.map(g => g.name).join(', ') || 'none'
          const savedListNames = allSavedLists.map(l => l.name).join(', ') || 'none'
          await sock.sendMessage(sender, { text: `❌ Group "${name}" not found. Available Contact Groups: ${contactGroupNames}\nAvailable Group Lists: ${savedListNames}` })
          return true
        }
        wizard.contactGroupIds = resolvedContactGroupIds
        wizard.contactGroupNames = resolvedContactGroupNames
        wizard.savedGroupListNames = resolvedSavedListNames
        wizard.step = 4
        await sock.sendMessage(sender, { text: '💬 Your autoreply? Send the reply text (no brackets needed)' })
        return true
      }
      case 4: {
        if (!trimmed) {
          await sock.sendMessage(sender, { text: '❌ Reply text is required.' })
          return true
        }
        wizard.replyText = trimmed
        wizard.step = 5
        await sock.sendMessage(sender, { text: '🖼️ Media type? Choose a number:\n0 — Text only\n2 — Image\n3 — Video\n4 — Audio\n5 — Document' })
        return true
      }
      case 5: {
        const num = parseInt(trimmed, 10)
        const validMedia = [0, 2, 3, 4, 5]
        if (isNaN(num) || !validMedia.includes(num)) {
          await sock.sendMessage(sender, { text: '❌ Invalid. Choose:\n0 — Text only\n2 — Image\n3 — Video\n4 — Audio\n5 — Document' })
          return true
        }
        wizard.mediaTypeCode = num

        // ── Create the rule ──
        const platformMap: Record<number, string> = { 0: 'facebook', 1: 'instagram', 2: 'whatsapp' }
        const mediaTypeMap: Record<number, string> = { 0: 'none', 2: 'image', 3: 'video', 4: 'audio', 5: 'document' }
        const platform = platformMap[wizard.platform!]
        const mediaType = mediaTypeMap[wizard.mediaTypeCode]
        const actionType = platform === 'facebook' ? 'facebook_feed' : 'send_dm'

        const base: Record<string, any> = { replyText: wizard.replyText }
        if (wizard.contactJids?.length) {
          base.contactJid = wizard.contactJids[0]
          base.contactJids = wizard.contactJids
        }
        if (wizard.contactGroupIds?.length) {
          base.contactGroupId = wizard.contactGroupIds[0]
          base.contactGroupIds = wizard.contactGroupIds
        }
        if (wizard.savedGroupListNames?.length) {
          base.savedGroupListNames = wizard.savedGroupListNames
        }
        let actionPayload: string
        switch (mediaType) {
          case 'none':
            actionPayload = JSON.stringify(base)
            break
          default:
            actionPayload = JSON.stringify({ ...base, mediaType, mediaUrls: [], caption: wizard.replyText })
            break
        }

        try {
          const user = await prisma.user.findFirst()
          if (!user) throw new Error('No user found in database')

          await prisma.automationRule.create({
            data: {
              userId: user.id,
              name: wizard.name,
              platform,
              triggerType: 'keyword_comment',
              triggerValue: wizard.triggerValues!.join(', '),
              actionType,
              actionPayload,
            },
          })

          const contactsStr = wizard.contactJids?.length ? wizard.contactJids.map(j => j.replace('@s.whatsapp.net', '')).join(', ') : 'none'
          const contactGroupStr = wizard.contactGroupNames?.length ? wizard.contactGroupNames.join(', ') : ''
          const savedListStr = wizard.savedGroupListNames?.length ? wizard.savedGroupListNames.join(', ') : ''
          const groupsStr = [contactGroupStr, savedListStr].filter(Boolean).join(', ') || 'none'
          await sock.sendMessage(sender, {
            text: `✅ Rule "${wizard.name}" created\nPlatform: ${platform}\nTriggers: ${wizard.triggerValues!.join(', ')}\nContacts: ${contactsStr}\nGroups: ${groupsStr}\nReply: ${wizard.replyText}\nMedia: ${mediaType}`,
          })
        } catch (err) {
          await sock.sendMessage(sender, { text: `❌ Failed to create rule: ${(err as Error).message}` })
        }
        createRuleWizards.delete(sender)
        return true
      }
    }
    return true
  }

  // ── ws get groups ──
  if (/^ws get groups\s+(-h|--help|-H)$/i.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws get groups*\n\nList all your WhatsApp groups with admin status.\n\n_Example:_ ws get groups` })
    return true
  }
  if (/^ws get groups$/i.test(textContent.trim())) {
    const lines: string[] = []
    for (const [jid, meta] of Object.entries(allGroups)) {
      const m = meta as any
      const isAdmin = m.participants?.some((p: any) => myJids.includes(normalizeJid(p.id)) && p.admin)
      const role = isAdmin ? '(admin)' : ''
      lines.push(`${m.subject} ${role}`)
    }
    await sock.sendMessage(sender, { text: lines.length ? lines.join('\n') : 'No groups found' })
    return true
  }

  // ── ws get group lists content / ws get group lists ──
  if (/^ws get group lists( content)?\s+(-h|--help|-H)$/i.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws get group lists*\n\nShow all saved group list names.\n\n_Example:_ ws get group lists\n\n📋 *ws get group lists content*\n\nShow all saved group lists with their groups.\n\n_Example:_ ws get group lists content` })
    return true
  }
  if (/^ws get group lists( content)?$/i.test(textContent.trim())) {
    const showContent = /content$/i.test(textContent.trim())
    const lists = await prisma.savedGroupList.findMany({ orderBy: { createdAt: 'desc' } })
    if (lists.length === 0) {
      await sock.sendMessage(sender, { text: 'No saved group lists.' })
      return true
    }
    const lines: string[] = []
    for (const l of lists) {
      const groups: string[] = JSON.parse(l.groups)
      if (showContent) {
        lines.push(`📁 *${l.name}*\n  ${groups.join('\n  ')}`)
      } else {
        lines.push(`📁 ${l.name}`)
      }
    }
    await sock.sendMessage(sender, { text: lines.join('\n\n') })
    return true
  }

  // ── ws get rules ──
  if (/^ws get (all )?rules\s+(-h|--help|-H)$/i.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws get rules*\n\nList all active WhatsApp automation rule names.\n\n_Example:_ ws get rules\n\n📋 *ws get all rules*\n\nList all active automation rules across all platforms.\n\n_Example:_ ws get all rules` })
    return true
  }
  if (/^ws get (all )?rules$/i.test(textContent.trim())) {
    const allMode = /all/i.test(textContent.trim())
    const rules = await prisma.automationRule.findMany({
      where: allMode ? { isActive: true } : { platform: 'whatsapp', isActive: true },
      orderBy: { name: 'asc' },
      select: { name: true, platform: true, triggerType: true, triggerValue: true },
    })
    if (rules.length === 0) {
      await sock.sendMessage(sender, { text: allMode ? 'No active automation rules.' : 'No active WhatsApp automation rules.' })
      return true
    }
    const lines = rules.map(r => `📋 *${r.name}* [${r.platform || '?'}] (${r.triggerType}: ${r.triggerValue})`)
    await sock.sendMessage(sender, { text: lines.join('\n') })
    return true
  }

  // ── ws get <rule name> triggers ──
  if (/^ws get .+? triggers\s+(-h|--help|-H)$/i.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws get <rule name> triggers*\n\nShow all trigger values for a specific rule.\n\n_Example:_ ws get welcome bot triggers` })
    return true
  }
  const triggersMatch = textContent.match(/^ws get (.+?) triggers$/is)
  if (triggersMatch) {
    const ruleName = triggersMatch[1].trim()
    const rule = await prisma.automationRule.findFirst({
      where: { name: ruleName, platform: 'whatsapp', isActive: true },
    })
    if (!rule) {
      await sock.sendMessage(sender, { text: `❌ Rule "${ruleName}" not found or inactive. Use \`ws create rule\` to create one.` })
      return true
    }
    const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim()).filter(Boolean)
    if (triggers.length === 0) {
      await sock.sendMessage(sender, { text: `⚠️ Rule "${ruleName}" has no triggers` })
      return true
    }
    const lines = triggers.map(t => `• ${t}`)
    await sock.sendMessage(sender, { text: `📋 Triggers for *${ruleName}*:\n${lines.join('\n')}` })
    return true
  }

  // ── -help ──
  if (/^-help$/i.test(textContent.trim())) {
    try {
      const resp = await fetch(`${env.FRONTEND_URL}/api/help`)
      const data = await resp.json() as { commands: Array<{ command: string; description: string; example: string }>; note: string }
      const lines: string[] = [
        '📋 *Commands*\n',
      ]
      for (const c of data.commands) {
        lines.push(
          `🔹 *${c.command}*\n${c.description}\n_Example:_ ${c.example}`
        )
      }
      lines.push(`\n💡 ${data.note}`)
      await sock.sendMessage(sender, { text: lines.join('\n\n') })
    } catch {
      await sock.sendMessage(sender, {
        text: `📋 *Available Commands*

🔹 *fb: content*
Post to your Facebook Page (API)
_Example:_ fb: Hello Page!

🔹 *ws fb post: content*
Post to your Facebook wall (browser). Attach an image or document to include media.
_Example:_ ws fb post: Hello Facebook!

🔹 *ws fb login*
Get the link to upload Facebook cookies
_Example:_ ws fb login

🔹 *-help*
Show this help
_Example:_ -help

🔹 *ws create rule name*
Start an interactive wizard to create an automation rule
The bot will ask for platform, triggers, contacts, groups, reply & media
_Example:_ ws create rule Motorcycle

🔹 *ws create name save gr1, gr2*
Save a named group list
_Example:_ ws create schools save exams, grade 7 a

🔹 *ws get group lists*
Show all saved group list names
_Example:_ ws get group lists

🔹 *ws get group lists content*
Show all saved group lists with their groups
_Example:_ ws get group lists content

🔹 *ws get groups*
List your WhatsApp groups with admin status
_Example:_ ws get groups

🔹 *ws gr1, gr2: content*
Send directly to specific groups (admin required)
_Example:_ ws my group: Hello!

🔹 *ws list name: content*
Send to groups in a saved list
_Example:_ ws list schools: Hello!

🔹 *ws test rule: trigger*
Test an automation rule
_Example:_ ws test welcome bot: hello

💡 Send commands as self-chat messages (message yourself)`,
      })
    }
    return true
  }

  // ── ws test [rule name]: trigger value ── test an automation rule ──
  if (/^ws\s+test\s+(.+?):\s*(.*)\s+(-h|--help|-H)$/is.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws test <rule name>: <trigger>*\n\nTest an automation rule by simulating a trigger word.\n\n_Example:_ ws test welcome bot: hello` })
    return true
  }
  const testMatch = textContent.match(/^ws\s+test\s+(.+?):\s*(.*)/is)
  if (testMatch) {
    const ruleName = testMatch[1].trim()
    const triggerValue = testMatch[2]?.trim() || ''
    if (!ruleName) return true

    try {
      const rule = await prisma.automationRule.findFirst({
        where: { name: ruleName, isActive: true, platform: 'whatsapp' },
      })
      if (!rule) {
        await sock.sendMessage(sender, { text: `❌ Rule "${ruleName}" not found or inactive. Use \`ws create rule\` to create one.` })
        return true
      }

      const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim().toLowerCase()).filter(Boolean)
      if (!triggers.some(t => triggerValue.toLowerCase().includes(t))) {
        await sock.sendMessage(sender, { text: `⚠️ Trigger value "${triggerValue}" does not match rule triggers: ${triggers.join(', ')}` })
        return true
      }

      let payload: any
      try { payload = JSON.parse(rule.actionPayload) } catch { payload = { replyText: rule.actionPayload } }

      const mediaUrls = payload.mediaUrls?.length ? payload.mediaUrls : (payload.mediaUrl ? [payload.mediaUrl] : [])
      const content: any = payload.replyText || ''

      if (payload.mediaType && mediaUrls.length > 0) {
        const url = mediaUrls[0]
        const caption = payload.caption || payload.replyText || ''
        switch (payload.mediaType) {
          case 'image':
            await sock.sendMessage(sender, { image: { url }, caption } as any)
            break
          case 'video':
            await sock.sendMessage(sender, { video: { url }, caption } as any)
            break
          case 'audio':
            await sock.sendMessage(sender, { audio: { url }, mimetype: 'audio/mp4' } as any)
            break
          case 'document':
            await sock.sendMessage(sender, { document: { url }, fileName: payload.fileName || 'document', caption } as any)
            break
        }
      } else if (payload.interactive && payload.options) {
        const list = {
          title: payload.title || 'Select an option',
          body: payload.body || 'Choose one:',
          footer: payload.footer || '',
          buttonText: payload.buttonText || 'Options',
          sections: [{
            title: 'Options',
            rows: payload.options.map((o: any, i: number) => ({ title: o.label, rowId: o.id || String(i), description: o.reply?.slice(0, 72) }))
          }]
        }
        await sock.sendMessage(sender, { interactive: { type: 'list', listMessage: list } } as any)
      } else if (content) {
        await sock.sendMessage(sender, { text: content } as any)
      }

      await sock.sendMessage(sender, { text: `✅ Test executed for rule "${ruleName}"` })
    } catch (err) {
      await sock.sendMessage(sender, { text: `❌ Test failed: ${(err as Error).message}` })
    }
    return true
  }

  // ── ws create rule <name> ── start wizard ──
  if (/^ws create rule\s+(-h|--help|-H)$/i.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws create rule <name>*\n\nStart an interactive wizard to create an automation rule. The bot will ask for platform, triggers, contacts, groups, reply & media.\n\n_Example:_ ws create rule Motorcycle\n\n💡 Append \`-h\` to any ws command for help.` })
    return true
  }
  const createRuleMatch = textContent.match(/^ws create rule (\S+)$/is)
  if (createRuleMatch) {
    const ruleName = createRuleMatch[1].trim()

    // Check if a wizard already exists
    if (createRuleWizards.has(sender)) {
      await sock.sendMessage(sender, { text: '⚠️ You already have an active wizard. Send `cancel` to abort, then start again.' })
      return true
    }

    createRuleWizards.set(sender, { name: ruleName, step: 0, createdAt: Date.now() })
    await sock.sendMessage(sender, {
      text: `Let's create rule "${ruleName}".\n\n🌐 Platform? Choose a number:\n0 — Facebook\n1 — Instagram\n2 — WhatsApp\n\n(Send \`cancel\` anytime to abort)`,
    })
    return true
  }

  // ── ws delete rule <rule name> ── delete an automation rule ──
  if (/^ws delete rule\s+(-h|--help|-H)$/i.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws delete rule <name>*\n\nDelete an automation rule by name.\n\n_Example:_ ws delete rule Motorcycle` })
    return true
  }
  const deleteRuleMatch = textContent.match(/^ws delete rule (.+)$/is)
  if (deleteRuleMatch) {
    const ruleName = deleteRuleMatch[1].trim()
    try {
      const rule = await prisma.automationRule.findFirst({ where: { name: ruleName } })
      if (!rule) {
        await sock.sendMessage(sender, { text: `❌ Rule "${ruleName}" not found.` })
        return true
      }
      await prisma.automationRule.delete({ where: { id: rule.id } })
      await sock.sendMessage(sender, { text: `✅ Deleted rule "${ruleName}".` })
    } catch (err) {
      await sock.sendMessage(sender, { text: `❌ Failed to delete rule: ${(err as Error).message}` })
    }
    return true
  }

  // ── ws create name save gr1, gr2, ... ── save a named group list ──
  if (/^ws\s+create\s+.+?\s+save\s+.+?\s+(-h|--help|-H)$/is.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws create <name> save <gr1>, <gr2>, ...*\n\nSave a named list of WhatsApp groups for reuse.\n\n_Example:_ ws create schools save exams, grade 7 a` })
    return true
  }
  const createMatch = textContent.match(/^ws\s+create\s+(?:'(.+?)'\s+save\s+\[(.+?)\]|(.+?)\s+save\s+(.+))/is)
  if (createMatch) {
    const listName = (createMatch[1] || createMatch[3]).trim()
    const groupsRaw = (createMatch[2] || createMatch[4])
    const groupNames = groupsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    if (!listName || groupNames.length === 0) return true
    try {
      await prisma.savedGroupList.upsert({
        where: { name: listName },
        update: { groups: JSON.stringify(groupNames) },
        create: { name: listName, groups: JSON.stringify(groupNames) },
      })
      await sock.sendMessage(sender, { text: `✅ Saved list "${listName}" (${groupNames.length} groups)\n${groupNames.join(', ')}` })
    } catch (err) {
      await sock.sendMessage(sender, { text: `❌ Failed to save list: ${(err as Error).message}` })
    }
    return true
  }

  // ── ws delete list <name> / ws delete <name> ── delete a saved group list ──
  if (/^ws delete(?: list)?\s+(-h|--help|-H)$/i.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws delete list <name>*\n\nDelete a saved group list by name.\n\n_Example:_ ws delete list schools` })
    return true
  }
  const deleteListMatch = textContent.match(/^ws delete(?: list)? (.+)$/is)
  if (deleteListMatch) {
    const listName = deleteListMatch[1].trim()
    try {
      const list = await prisma.savedGroupList.findUnique({ where: { name: listName } })
      if (!list) {
        await sock.sendMessage(sender, { text: `❌ List "${listName}" not found.` })
        return true
      }
      await prisma.savedGroupList.delete({ where: { id: list.id } })
      await sock.sendMessage(sender, { text: `✅ Deleted list "${listName}".` })
    } catch (err) {
      await sock.sendMessage(sender, { text: `❌ Failed to delete list: ${(err as Error).message}` })
    }
    return true
  }

  // ── ws list name: content ── send to groups in a saved list ──
  if (/^ws\s+list\s+.+?:\s*(.*)\s+(-h|--help|-H)$/is.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws list <name>: <content>*\n\nSend a message to all groups in a saved list.\n\n_Example:_ ws list schools: Hello everyone!` })
    return true
  }
  const listMatch = textContent.match(/^ws\s+list\s+(.+?):\s*(.*)/is)
  if (listMatch) {
    const listName = listMatch[1].trim()
    const content = listMatch[2] || ''
    const hasMedia = !!(message.message?.imageMessage || message.message?.documentMessage)
    if (!content && !hasMedia) return true

    const savedList = await prisma.savedGroupList.findUnique({ where: { name: listName } })
    if (!savedList) {
      await sock.sendMessage(sender, { text: `❌ List "${listName}" not found` })
      return true
    }
    const groupNames: string[] = JSON.parse(savedList.groups)
    const results: string[] = []

    for (const gName of groupNames.map((s) => s.toLowerCase())) {
      const waGroup = Object.entries(allGroups).find(([, meta]) => {
        const subject = (meta as any).subject?.toLowerCase() || ''
        if (subject !== gName) return false
        return (meta as any).participants?.some(
          (p: any) => myJids.includes(normalizeJid(p.id)) && p.admin
        )
      })
      if (!waGroup) {
        results.push(`❌ ${gName}: not found or not admin`)
        continue
      }
      const groupJid = waGroup[0]
      try {
        const imageMsg = message.message?.imageMessage
        if (imageMsg) {
          const buffer = await downloadMediaMessage(message, 'buffer', {})
          await sock.sendMessage(groupJid, { image: buffer, caption: content } as any)
        } else if (message.message?.documentMessage) {
          const buffer = await downloadMediaMessage(message, 'buffer', {})
          await sock.sendMessage(groupJid, { document: buffer, caption: content, fileName: message.message.documentMessage.fileName || 'document' } as any)
        } else {
          await sock.sendMessage(groupJid, { text: content } as any)
        }
        results.push(`✅ ${gName}`)
      } catch (err) {
        results.push(`❌ ${gName}: ${(err as Error).message}`)
      }
    }
    await sock.sendMessage(sender, { text: results.join('\n') })
    return true
  }

  // ── ws fb post: content / ws fb post : content ── post to Facebook wall via Selenium ──
  const wallPrefix = textContent.match(/^ws\s+fb\s+post\s*:\s*(.*)/is)
  if (wallPrefix) {
    const wallContent = wallPrefix[1]
    const wallHasMedia = !!(message.message?.imageMessage || message.message?.documentMessage)
    if (!wallContent && !wallHasMedia) return true

    try {
      const imageMsg = message.message?.imageMessage
      const docMsg = message.message?.documentMessage
      let content = wallContent
      let filePath: string | null = null

      if (imageMsg) {
        const buffer = await downloadMediaMessage(message, 'buffer', {}) as Buffer
        const fileName = `fb_${Date.now()}.jpg`
        const fpath = path.resolve(os.tmpdir(), fileName)
        fs.writeFileSync(fpath, buffer)
        filePath = fpath
        content = imageMsg.caption || wallContent || ''
      } else if (docMsg) {
        const buffer = await downloadMediaMessage(message, 'buffer', {}) as Buffer
        const ext = path.extname(docMsg.fileName || 'document') || '.bin'
        const fileName = `fb_${Date.now()}${ext}`
        const fpath = path.resolve(os.tmpdir(), fileName)
        fs.writeFileSync(fpath, buffer)
        filePath = fpath
        content = docMsg.caption || wallContent || ''
      }

      const scriptPath = path.resolve(process.cwd(), 'scripts', 'fb_post_to_wall.py')
      const args = ['--content', content]
      if (filePath) args.push('--file', filePath)

      const cookiesPath = path.resolve(process.cwd(), 'fb_cookies.txt')
      if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath)

      const venvPython = path.resolve(process.cwd(), 'venv', 'bin', 'python3')
      const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3'

      await sock.sendMessage(sender, { text: '🔄 Posting to Facebook wall via browser...' })

      try {
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(pythonBin, [scriptPath, ...args], { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) {
              const msg = (stderr || '').trim() || (stdout || '').trim() || err.message
              reject(new Error(msg))
            } else resolve(stdout)
          })
        })

        const lines = stdout.trim().split('\n').filter(l => l.trim())
        const lastLine = lines[lines.length - 1] || '{}'
        const result = JSON.parse(lastLine)
        if (result.success) {
          await sock.sendMessage(sender, { text: `✅ Posted to Facebook wall\n${content.slice(0, 200)}` })
          log('info', 'whatsapp', 'facebook_wall: post sent')
        } else {
          await sock.sendMessage(sender, { text: `❌ Wall post failed: ${result.error}` })
          log('error', 'whatsapp', 'facebook_wall: post failed', { error: result.error })
        }
      } finally {
        if (filePath) {
          try { fs.unlinkSync(filePath) } catch { /* ignore */ }
        }
      }
    } catch (err) {
      await sock.sendMessage(sender, { text: `❌ Wall post failed: ${(err as Error).message}` })
      log('error', 'whatsapp', 'facebook_wall: post error', { error: (err as Error).message })
    }
    return true
  }

  // ── ws group1, group2: content ── forward to WhatsApp group chats ──
  if (/^ws\s+(.+?):\s*(.*)\s+(-h|--help|-H)$/is.test(textContent.trim())) {
    await sock.sendMessage(sender, { text: `📋 *ws <group1>, <group2>: <content>*\n\nSend a message directly to specific WhatsApp groups (you must be admin).\n\n_Example:_ ws my group: Hello!` })
    return true
  }
  const wsMatch = textContent.match(/^ws\s+(.+?):\s*(.*)/is)
  if (wsMatch) {
    const groupNames = wsMatch[1].split(',').map((s) => s.trim().toLowerCase())
    const content = wsMatch[2] || ''
    const hasMedia = !!(message.message?.imageMessage || message.message?.documentMessage)
    if (groupNames.length === 0 || (!content && !hasMedia)) return true

    const results: string[] = []

    for (const gName of groupNames) {
      const waGroup = Object.entries(allGroups).find(([, meta]) => {
        const subject = (meta as any).subject?.toLowerCase() || ''
        if (subject !== gName) return false
        return (meta as any).participants?.some(
          (p: any) => myJids.includes(normalizeJid(p.id)) && p.admin
        )
      })
      if (!waGroup) {
        results.push(`❌ ${gName}: not found or not admin`)
        log('warn', 'whatsapp', 'whatsapp_groups: group not found or not admin', { gName })
        continue
      }
      const groupJid = waGroup[0]
      try {
        const imageMsg = message.message?.imageMessage
        if (imageMsg) {
          const buffer = await downloadMediaMessage(message, 'buffer', {})
          await sock.sendMessage(groupJid, { image: buffer, caption: content } as any)
        } else if (message.message?.documentMessage) {
          const buffer = await downloadMediaMessage(message, 'buffer', {})
          await sock.sendMessage(groupJid, { document: buffer, caption: content, fileName: message.message.documentMessage.fileName || 'document' } as any)
        } else {
          await sock.sendMessage(groupJid, { text: content } as any)
        }
        results.push(`✅ ${gName}`)
        log('info', 'whatsapp', 'whatsapp_groups: sent', { group: gName, jid: groupJid })
      } catch (err) {
        results.push(`❌ ${gName}: ${(err as Error).message}`)
        log('error', 'whatsapp', 'whatsapp_groups: send failed', { group: gName, jid: groupJid, error: (err as Error).message })
      }
    }
    await sock.sendMessage(sender, { text: results.join('\n') })
    return true
  }

  // ── ws help / ws -h ──
  if (/^ws\s+(-h|--help|-H|help)$/i.test(textContent.trim())) {
    try {
      const resp = await fetch(`${env.FRONTEND_URL}/api/help`)
      const data = await resp.json() as { commands: Array<{ command: string; description: string; example: string }>; note: string }
      const lines: string[] = ['📋 *Commands*\n']
      for (const c of data.commands) {
        lines.push(`🔹 *${c.command}*\n${c.description}\n_Example:_ ${c.example}`)
      }
      lines.push(`\n💡 ${data.note}`)
      await sock.sendMessage(sender, { text: lines.join('\n\n') })
    } catch {
      await sock.sendMessage(sender, { text: '❌ Could not load help. Try: -help' })
    }
    return true
  }

  // ── ws fb login ── link to cookies setup page ──
  if (/^ws fb login$/i.test(textContent.trim())) {
    const baseUrl = env.FRONTEND_URL.replace(/\/$/, '')
    await sock.sendMessage(sender, {
      text: `🔑 *Facebook Wall Post Setup*

Open this page in your browser for step-by-step instructions on how to export and upload your Facebook cookies:

${baseUrl}/facebook`,
    })
    return true
  }

  // ── catch unrecognized ws commands ──
  if (/^ws\s+/i.test(textContent)) {
    await sock.sendMessage(sender, { text: '❌ Unknown ws command. Try:\nws create name save gr1, gr2\nws list name: content\nws gr1, gr2: content\nws get groups' })
    return true
  }

  // ── fb: content / fb : content ── post to Facebook Page via Graph API ──
  const fbPrefix = textContent.match(/^fb\s*:\s*(.*)/is)
  if (fbPrefix) {
    const fbContent = fbPrefix[1]
    const hasMedia = !!(message.message?.imageMessage || message.message?.documentMessage)
    if (!fbContent && !hasMedia) return true

    const fbPage = await prisma.facebookPage.findFirst()
    if (!fbPage) {
      await sock.sendMessage(sender, { text: '❌ No Facebook page connected.' })
      log('warn', 'whatsapp', 'facebook_page: no page connected')
      return true
    }

    try {
      const imageMsg = message.message?.imageMessage
      let content = fbContent
      let mediaUrls: string[] | null = null

      if (imageMsg) {
        const buffer = await downloadMediaMessage(message, 'buffer', {})
        const fileName = `fb_${Date.now()}.jpg`
        const filePath = path.resolve(process.cwd(), 'uploads', fileName)
        fs.writeFileSync(filePath, buffer as Buffer)
        content = imageMsg.caption || fbContent || ''
        mediaUrls = [`${env.FRONTEND_URL.replace(/\/$/, '')}/uploads/${fileName}`]
        await publishPost(fbPage.pageId, content, mediaUrls, fbPage.accessToken)
      } else if (message.message?.documentMessage) {
        const doc = message.message.documentMessage
        content = `${doc.caption || fbContent}\n\n${doc.fileName || 'document'}`
        await publishPost(fbPage.pageId, content, null, fbPage.accessToken)
      } else {
        await publishPost(fbPage.pageId, content, null, fbPage.accessToken)
      }

      await prisma.facebookPostLog.create({
        data: { userId: fbPage.userId, pageId: fbPage.pageId, content, mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null, status: 'success' },
      })
      await sock.sendMessage(sender, { text: `✅ Posted to page *${fbPage.pageName || fbPage.pageId}*\n${content.slice(0, 200)}` })
      log('info', 'whatsapp', 'facebook_page: post sent', { pageId: fbPage.pageId })
    } catch (err) {
      await prisma.facebookPostLog.create({
        data: { userId: fbPage.userId, pageId: fbPage.pageId, content: fbContent || '', status: 'failed', error: (err as Error).message },
      })
      await sock.sendMessage(sender, { text: `❌ Page post failed: ${(err as Error).message}` })
      log('error', 'whatsapp', 'facebook_page: post failed', { error: (err as Error).message })
    }
    return true
  }
  return false
}

async function handleIncomingMessage(sock: WASocket, message: WAMessage): Promise<void> {
  try {
    const sender = message.key.remoteJid
    if (!sender || sender.includes('status@broadcast')) return
    const actualSender = message.key.participant || sender

    const textContent =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.imageMessage?.caption ||
      message.message?.videoMessage?.caption ||
      message.message?.documentMessage?.caption ||
      ''

    log('info', 'whatsapp', 'Incoming message', { sender, actualSender, fromMe: message.key.fromMe, text: textContent.slice(0, 100) })

    let sharedAllGroups: Record<string, any> | undefined

    // ── Handle fromMe messages → route by prefix ──────────────────────
    if (message.key.fromMe) {
      const normSender = normalizeJid(actualSender)
      if (normSender !== ownPhone && normSender !== ownLid) return

      sharedAllGroups = await sock.groupFetchAllParticipating().catch(() => ({} as Record<string, any>))
      const myJids = [normalizeJid(sock.user?.id || ''), ownLid].filter((x): x is string => !!x)

      const handled = await processCommands(sock, sender, actualSender, textContent, message, sharedAllGroups, myJids)
      if (handled) return
      // Not a command — fall through so automation rules can process trigger words
    }

    // ── Gateway: process commands from allowed numbers in allowed groups ──
    if (sender.endsWith('@g.us') && textContent.trim()) {
      const normSender = normalizeJid(actualSender)
      const isOwner = normSender === ownPhone || normSender === ownLid
      log('info', 'whatsapp', 'Gateway candidate', { normSender, isOwner })
      let allowed = isOwner
      if (!allowed) {
        try {
          const allowedNum = await prisma.allowedNumber.findUnique({ where: { phone: normSender } })
          allowed = !!allowedNum
          log('info', 'whatsapp', 'Gateway allowed number check', { phone: normSender, allowed })
        } catch { /* ignore */ }
      }
      if (allowed) {
        sharedAllGroups = await sock.groupFetchAllParticipating().catch(() => ({} as Record<string, any>))
        const groupMeta = sharedAllGroups[sender]
        const groupName = (groupMeta as any)?.subject || ''
        log('info', 'whatsapp', 'Gateway group check', { sender, groupName, foundInFetch: !!groupMeta })
        if (groupName) {
          try {
            const allAllowedGrps = await prisma.allowedGroup.findMany()
            const allowedGrp = allAllowedGrps.find(g => g.name.toLowerCase() === groupName.toLowerCase())
            log('info', 'whatsapp', 'Gateway allowed group check', { name: groupName, allowed: !!allowedGrp })
            if (allowedGrp) {
              const myJids = [normalizeJid(sock.user?.id || ''), ownLid].filter((x): x is string => !!x)
              const handled = await processCommands(sock, sender, actualSender, textContent, message, sharedAllGroups, myJids)
              if (handled) return
            }
          } catch { /* ignore */ }
        }
      }
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
          if (!await isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender, sharedAllGroups)) {
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
        if (!await isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender, sharedAllGroups)) {
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

    log('info', 'whatsapp', 'Main rules loop: rules found', { count: rules.length, sender, textContent: textContent.slice(0, 50) })
    for (const rule of rules) {
      const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim().toLowerCase()).filter(Boolean)
      log('info', 'whatsapp', 'Main rules loop: checking rule', { name: rule.name, triggerValue: rule.triggerValue, triggers, textContent: textContent.slice(0, 50) })
      if (!triggers.some(t => textContent.toLowerCase().includes(t))) {
        log('info', 'whatsapp', 'Main rules loop: trigger no match', { name: rule.name, triggers })
        continue
      }
      log('info', 'whatsapp', 'Main rules loop: trigger matched', { name: rule.name })

      const lastSent = threadTimestamps.get(sender) || 0
      const now = Date.now()
      if (now - lastSent < MIN_THROTTLE_MS) {
        log('info', 'whatsapp', 'Rate limited - skipping reply', { sender })
        continue
      }

      let payload: { replyText?: string; mediaUrl?: string; mediaUrls?: string[]; mediaType?: string; fileName?: string; caption?: string; interactive?: boolean; options?: Array<{ id: string; label: string; reply: string }>; contactJid?: string; contactGroupId?: string; contactJids?: string[]; contactGroupIds?: string[]; savedGroupListNames?: string[] }
      try {
        payload = JSON.parse(rule.actionPayload)
      } catch {
        payload = { replyText: rule.actionPayload }
      }

      if (!await isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender, sharedAllGroups)) {
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
