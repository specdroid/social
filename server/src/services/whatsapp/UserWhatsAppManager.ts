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
import { log } from '../../utils/logger'
import { delay, randomDelay } from '../../utils/delay'
import { env } from '../../config/env'
import { publishPost } from '../metaGraph'
import { chatCompletion } from '../omniroute'
import { sendToContact, syncContactsAndDialogs, getChannels, getMyBots, getDialogs, getMessages, findChannelId, sendToChannel, signIn } from '../telegramClient'
import type { ContactEntry, CreateRuleWizard, ChannelSelection, ConnectionState } from './types'
import { matchAnyTrigger } from '../triggerMatch'

const prisma = new PrismaClient()
const MAX_RECONNECT_ATTEMPTS = 3
const WIZARD_TIMEOUT_MS = 5 * 60 * 1000
const MIN_THROTTLE_MS = 30000
const MIN_FOLLOWUP_THROTTLE_MS = 5000
const MAX_GLOBAL_PER_MIN = 15
const MAX_GLOBAL_PER_HOUR = 60

const NLM_BIN = process.env.NOTEBOOKLM_BIN || 'notebooklm'
let nlmQueue: Promise<any> = Promise.resolve()
function nlmRun(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(NLM_BIN, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}
function nlmJson(args: string[], timeout = 30000): Promise<any> {
  return nlmRun(args, timeout).then(out => { try { return JSON.parse(out) } catch { return out } })
}
function nlmSeq(notebookId: string | null, cmd: string[], timeout = 30000): Promise<any> {
  const id = notebookId
  const run = async () => {
    if (id) await nlmRun(['use', id], timeout)
    return nlmJson(cmd, timeout)
  }
  nlmQueue = nlmQueue.then(run, run)
  return nlmQueue
}
async function nlmFindNotebooks(query: string): Promise<Array<{ id: string; title: string; index: number }>> {
  const data = await nlmSeq(null, ['list', '--json'])
  const nbs = data?.notebooks || []
  const q = query.toLowerCase()
  return nbs.filter((nb: any) => (nb.title || '').toLowerCase().includes(q))
}

export class UserWhatsAppManager {
  readonly userId: string
  private sock: WASocket | null = null
  private isStarting = false
  private reconnectAttempts = 0
  private stopReconnecting = false
  private latestQrDataUrl: string | null = null
  private ownPhone: string | null = null
  private ownLid: string | null = null
  private pendingChannelSelection = new Map<string, ChannelSelection>()
  private createRuleWizards = new Map<string, CreateRuleWizard>()
  private threadTimestamps = new Map<string, number>()
  private followupTimestamps = new Map<string, number>()
  private globalRateTimestamps: number[] = []
  private io: SocketIOServer
  private authDir: string

  constructor(userId: string, io: SocketIOServer) {
    this.userId = userId
    this.io = io
    this.authDir = path.resolve(process.cwd(), `../auth_info_baileys/${userId}`)
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true })
    }
  }

  private emit(event: string, data: Record<string, unknown>): void {
    this.io.to(`user:${this.userId}`).emit(event, data)
  }

  private broadcast(event: string, data: Record<string, unknown>): void {
    this.io.emit(event, data)
  }

  private checkGlobalRate(): boolean {
    const now = Date.now()
    while (this.globalRateTimestamps.length && now - this.globalRateTimestamps[0] > 60000) this.globalRateTimestamps.shift()
    if (this.globalRateTimestamps.length >= MAX_GLOBAL_PER_MIN) return false
    const hourAgo = now - 3600000
    const hourCount = this.globalRateTimestamps.filter(t => t > hourAgo).length
    if (hourCount >= MAX_GLOBAL_PER_HOUR) return false
    this.globalRateTimestamps.push(now)
    return true
  }

  private realisticBrowser(): [string, string, string] {
    const browsers: [string, string, string][] = [
      ['Windows', 'Chrome', '131.0.6778'],
      ['Windows', 'Chrome', '130.0.6723'],
      ['macOS', 'Chrome', '131.0.6778'],
      ['Windows', 'Edge', '131.0.2903'],
    ]
    return browsers[Math.floor(Math.random() * browsers.length)]
  }

  private normalizeJid(jid: string): string {
    const num = jid.split(':')[0].split('@')[0]
    return num.startsWith('961') ? num.slice(3) : num
  }

  getConnectionState(): ConnectionState {
    return {
      connected: this.sock?.user?.id ? true : false,
      connecting: this.isStarting,
      attempt: this.reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      qrAvailable: this.latestQrDataUrl !== null,
    }
  }

  getQrDataUrl(): string | null {
    return this.latestQrDataUrl
  }

  getOwnProfile(): { ownPhone: string | null; ownLid: string | null } {
    return { ownPhone: this.ownPhone, ownLid: this.ownLid }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp bot not connected')
    await this.sock.sendMessage(jid, { text })
  }

  // ── Contact methods (DB-backed) ──

  async getContacts(): Promise<ContactEntry[]> {
    const rows = await prisma.whatsAppContact.findMany({ where: { userId: this.userId } })
    return rows.map(r => ({
      id: r.waJid,
      lid: r.lid || undefined,
      name: r.name || undefined,
      notify: r.notify || undefined,
      verifiedName: r.verifiedName || undefined,
      phoneNumber: r.phoneNumber || undefined,
    }))
  }

  async deleteContact(id: string): Promise<boolean> {
    const deleted = await prisma.whatsAppContact.deleteMany({ where: { userId: this.userId, waJid: id } })
    return deleted.count > 0
  }

  async clearContacts(): Promise<number> {
    const result = await prisma.whatsAppContact.deleteMany({ where: { userId: this.userId } })
    return result.count
  }

  async resyncContacts(): Promise<{ ok: boolean; count: number }> {
    if (!this.sock?.user?.id) {
      const contacts = await this.getContacts()
      return { ok: false, count: contacts.length }
    }
    try {
      await (this.sock as any).resyncAppState(['regular', 'regular_low'], true)
      const contacts = await this.getContacts()
      log('info', 'whatsapp', 'Contacts resync triggered', { userId: this.userId, count: contacts.length })
      return { ok: true, count: contacts.length }
    } catch (err) {
      const contacts = await this.getContacts()
      log('warn', 'whatsapp', 'Contacts resync failed', { userId: this.userId, error: (err as Error).message })
      return { ok: false, count: contacts.length }
    }
  }

  private async upsertContacts(contacts: Contact[]): Promise<void> {
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
    for (const entry of seen.values()) {
      await prisma.whatsAppContact.upsert({
        where: { userId_waJid: { userId: this.userId, waJid: entry.id } },
        update: {
          lid: entry.lid || null,
          name: entry.name || null,
          notify: entry.notify || null,
          verifiedName: entry.verifiedName || null,
          phoneNumber: entry.phoneNumber || null,
        },
        create: {
          userId: this.userId,
          waJid: entry.id,
          lid: entry.lid || null,
          name: entry.name || null,
          notify: entry.notify || null,
          verifiedName: entry.verifiedName || null,
          phoneNumber: entry.phoneNumber || null,
        },
      })
    }
  }

  async getWhatsAppGroups(): Promise<Array<{ jid: string; subject: string }>> {
    if (!this.sock?.user?.id) return []
    const groups = await this.sock.groupFetchAllParticipating().catch(() => ({} as Record<string, any>))
    return Object.entries(groups).map(([jid, meta]) => ({
      jid,
      subject: (meta as any).subject || jid,
    }))
  }

  // ── Imported contacts (DB-backed) ──

  async getImportedContacts(): Promise<ContactEntry[]> {
    const rows = await prisma.whatsAppImportedContact.findMany({ where: { userId: this.userId } })
    return rows.map(r => ({ id: r.waJid, name: r.name || undefined, phoneNumber: r.phoneNumber || undefined }))
  }

  async addImportedContact(name: string, phoneNumber: string): Promise<ContactEntry | null> {
    const digits = phoneNumber.replace(/\D/g, '')
    if (!digits) return null
    const jid = digits + '@s.whatsapp.net'
    const existing = await prisma.whatsAppImportedContact.findFirst({ where: { userId: this.userId, phoneNumber: digits } })
    if (existing) return null
    await prisma.whatsAppImportedContact.create({
      data: { userId: this.userId, waJid: jid, name: name || null, phoneNumber: digits },
    })
    return { id: jid, name: name || undefined, phoneNumber: digits }
  }

  async importVcf(vcfContent: string): Promise<{ added: number }> {
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
      const existing = await prisma.whatsAppImportedContact.findFirst({ where: { userId: this.userId, phoneNumber: phoneDigits } })
      if (existing) continue
      await prisma.whatsAppImportedContact.create({
        data: { userId: this.userId, waJid: jid, name: name || null, phoneNumber: phoneDigits },
      })
      added++
    }
    return { added }
  }

  async deleteImportedContact(id: string): Promise<boolean> {
    const deleted = await prisma.whatsAppImportedContact.deleteMany({ where: { userId: this.userId, waJid: id } })
    return deleted.count > 0
  }

  async clearImportedContacts(): Promise<number> {
    const result = await prisma.whatsAppImportedContact.deleteMany({ where: { userId: this.userId } })
    return result.count
  }

  // ── Contact groups (DB-backed) ──

  async getContactGroups(): Promise<Array<{ id: string; name: string; memberJids: string[] }>> {
    const rows = await prisma.whatsAppContactGroup.findMany({ where: { userId: this.userId } })
    return rows.map(r => ({ id: r.id, name: r.name, memberJids: JSON.parse(r.memberJids) }))
  }

  async createContactGroup(name: string, memberJids: string[]): Promise<{ id: string; name: string; memberJids: string[] }> {
    const created = await prisma.whatsAppContactGroup.create({
      data: { userId: this.userId, name, memberJids: JSON.stringify(memberJids) },
    })
    return { id: created.id, name: created.name, memberJids }
  }

  async updateContactGroup(id: string, name: string, memberJids: string[]): Promise<{ id: string; name: string; memberJids: string[] } | null> {
    const existing = await prisma.whatsAppContactGroup.findFirst({ where: { id, userId: this.userId } })
    if (!existing) return null
    const updated = await prisma.whatsAppContactGroup.update({
      where: { id: existing.id },
      data: { name, memberJids: JSON.stringify(memberJids) },
    })
    return { id: updated.id, name: updated.name, memberJids }
  }

  async deleteContactGroup(id: string): Promise<boolean> {
    const existing = await prisma.whatsAppContactGroup.findFirst({ where: { id, userId: this.userId } })
    if (!existing) return false
    await prisma.whatsAppContactGroup.delete({ where: { id: existing.id } })
    return true
  }

  // ── Auth cleanup ──

  async cleanupAuthFolder(): Promise<{ deleted: number; keptCreds: boolean }> {
    if (!fs.existsSync(this.authDir)) return { deleted: 0, keptCreds: false }
    let deleted = 0
    const files = fs.readdirSync(this.authDir)
    for (const file of files) {
      if (file === 'creds.json') continue
      if (file.startsWith('app-state-sync-version-') || file.startsWith('app-state-sync-key-')) continue
      const keepPatterns = ['session-', 'sender-key-', 'identity-key-', 'device-list-', 'sender-key-status@broadcast-']
      if (keepPatterns.some((p) => file.startsWith(p))) continue
      try {
        fs.unlinkSync(path.join(this.authDir, file))
        deleted++
      } catch { /* skip locked files */ }
    }
    log('info', 'whatsapp', `Auth folder cleaned for user ${this.userId}: ${deleted} files removed`)
    return { deleted, keptCreds: true }
  }

  async clearCredentials(): Promise<{ deleted: number }> {
    if (!fs.existsSync(this.authDir)) return { deleted: 0 }
    let deleted = 0
    for (const file of fs.readdirSync(this.authDir)) {
      try {
        fs.unlinkSync(path.join(this.authDir, file))
        deleted++
      } catch { /* skip */ }
    }
    log('info', 'whatsapp', `Credentials cleared for user ${this.userId}: ${deleted} files removed`)
    return { deleted }
  }

  async forceCleanAuth(): Promise<void> {
    if (this.sock) {
      try { this.sock.end(new Error('Force clean')) } catch { /* ignore */ }
      this.sock = null
    }
    this.stopReconnecting = true
    this.isStarting = false
    this.latestQrDataUrl = null
    this.ownPhone = null
    this.ownLid = null
    if (fs.existsSync(this.authDir)) {
      for (const file of fs.readdirSync(this.authDir)) {
        try { fs.unlinkSync(path.join(this.authDir, file)) } catch { /* skip */ }
      }
    }
    log('info', 'whatsapp', `Auth folder force cleaned for user ${this.userId}`)
  }

  async sendTestMessage(): Promise<{ ok: boolean; error?: string }> {
    if (!this.sock?.user?.id) return { ok: false, error: 'WhatsApp not connected' }
    const jid = '96170656517@s.whatsapp.net'
    try {
      await this.sock.sendMessage(jid, { text: 'This is an automated text msg' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  // ── Connection lifecycle ──

  async init(): Promise<void> {
    if (this.isStarting) return
    if (this.stopReconnecting) {
      this.emit('whatsapp:status', { state: 'stopped', message: 'WhatsApp logged out. Clear auth and restart.' })
      return
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit('whatsapp:status', { state: 'failed', message: `Could not connect after ${MAX_RECONNECT_ATTEMPTS} attempts.` })
      return
    }

    this.isStarting = true
    this.emit('whatsapp:status', {
      state: 'connecting',
      message: this.reconnectAttempts === 0
        ? 'Connecting to WhatsApp servers...'
        : `Reconnecting... attempt ${this.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`,
      attempt: this.reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
    })

    try {
      this.cleanupSocket()

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
      const proxyUrl = env.WA_PROXY_URL
      let proxyAgent: import('https').Agent | undefined
      if (proxyUrl) {
        try { proxyAgent = new SocksProxyAgent(proxyUrl) as any } catch { /* ignore */ }
      }

      const sock = makeWASocket({
        auth: state,
        syncFullHistory: false,
        browser: this.realisticBrowser(),
        agent: proxyAgent as any,
      })
      this.sock = sock

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('messages.upsert', async (msg) => {
        if (msg.type !== 'notify') return
        for (const message of msg.messages) {
          await this.handleIncomingMessage(sock, message)
        }
      })

      sock.ev.on('contacts.upsert', (contacts) => {
        this.upsertContacts(contacts)
      })

      sock.ev.on('contacts.update', async (updates) => {
        for (const u of updates) {
          if (!u.id) continue
          await prisma.whatsAppContact.upsert({
            where: { userId_waJid: { userId: this.userId, waJid: u.id } },
            update: { lid: (u as any).lid || null, name: u.name || null, notify: u.notify || null, verifiedName: u.verifiedName || null },
            create: { userId: this.userId, waJid: u.id, lid: (u as any).lid || null, name: u.name || null, notify: u.notify || null, verifiedName: u.verifiedName || null },
          })
        }
      })

      sock.ev.on('messaging-history.set', (data) => {
        if (data.contacts?.length) this.upsertContacts(data.contacts)
      })

      sock.ev.on('connection.update', async (update) => {
        try {
          const { connection, lastDisconnect, qr } = update

          if (qr) {
            try {
              this.latestQrDataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2, color: { dark: '#111', light: '#fff' } })
              this.emit('whatsapp:qr', { qr: this.latestQrDataUrl })
              this.emit('whatsapp:status', { state: 'qr_ready', message: 'QR code ready. Scan with your WhatsApp app.' })
            } catch (err) {
              log('error', 'whatsapp', 'Failed to generate QR image', { userId: this.userId, error: (err as Error).message })
            }
          }

          if (connection === 'open') {
            this.reconnectAttempts = 0
            this.isStarting = false
            this.latestQrDataUrl = null
            this.ownPhone = sock.user?.id ? this.normalizeJid(sock.user.id) : null
            this.ownLid = (sock.user as any)?.lid ? (sock.user as any).lid.replace(/(:\d+)?(@lid)?$/, '') : null
            log('info', 'whatsapp', 'WhatsApp connected', { userId: this.userId, ownPhone: this.ownPhone })

            try {
              await (sock as any).resyncAppState(['regular', 'regular_low'], true)
            } catch { /* ignore */ }

            this.emit('whatsapp:ready', { connected: true })
            this.emit('whatsapp:status', { state: 'connected', message: 'WhatsApp connected successfully.' })

            const phone = this.ownPhone
            if (phone) {
              try {
                const existing = await prisma.whatsAppSession.findUnique({ where: { userId: this.userId } })
                if (existing) {
                  await prisma.whatsAppSession.update({ where: { userId: this.userId }, data: { isConnected: true, phone } })
                } else {
                  await prisma.whatsAppSession.create({ data: { userId: this.userId, phone, isConnected: true } })
                }
              } catch { /* best-effort */ }
            }
          }

          if (connection === 'close') {
            this.isStarting = false
            this.latestQrDataUrl = null
            const reasonCode = (lastDisconnect?.error as any)?.output?.statusCode
            const isLoggedOut = reasonCode === DisconnectReason.loggedOut

            this.emit('whatsapp:disconnected', { reason: String(reasonCode) })
            this.cleanupSocket()

            if (isLoggedOut) {
              this.stopReconnecting = true
              this.emit('whatsapp:status', { state: 'logged_out', message: 'WhatsApp logged out from phone. Click "Connect WhatsApp" to re-link.' })
              await prisma.whatsAppSession.updateMany({ where: { userId: this.userId }, data: { isConnected: false } })
              return
            }

            if (!this.stopReconnecting && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              this.reconnectAttempts++
              const waitMs = Math.min(2000 * Math.pow(3, this.reconnectAttempts - 1), 60000)
              this.emit('whatsapp:status', {
                state: 'reconnecting',
                message: `Connection lost. Retrying in ${Math.round(waitMs / 1000)}s (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
                attempt: this.reconnectAttempts,
                maxAttempts: MAX_RECONNECT_ATTEMPTS,
              })
              await delay(waitMs)
              await this.init()
            } else if (!this.stopReconnecting) {
              this.emit('whatsapp:status', { state: 'failed', message: `Connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts.` })
            }
          }
        } catch (err) {
          log('error', 'whatsapp', 'Error in connection.update', { userId: this.userId, error: (err as Error).message })
        }
      })

      log('info', 'whatsapp', 'WhatsApp bot initialized', { userId: this.userId })
    } catch (err) {
      this.isStarting = false
      log('error', 'whatsapp', 'Failed to init WhatsApp', { userId: this.userId, error: (err as Error).message })

      if (!this.stopReconnecting && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++
        const waitMs = Math.min(2000 * Math.pow(3, this.reconnectAttempts - 1), 60000)
        this.emit('whatsapp:status', {
          state: 'reconnecting',
          message: `Init failed. Retrying in ${Math.round(waitMs / 1000)}s (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
          attempt: this.reconnectAttempts,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
        })
        await delay(waitMs)
        await this.init()
      } else {
        this.emit('whatsapp:status', { state: 'failed', message: `Connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts.` })
      }
    }
  }

  async cleanup(): Promise<void> {
    this.stopReconnecting = true
    if (this.sock) {
      try { this.sock.end(new Error('User disconnected')) } catch { /* ignore */ }
      this.sock = null
    }
    this.isStarting = false
    this.latestQrDataUrl = null
    this.ownPhone = null
    this.ownLid = null
    this.threadTimestamps.clear()
    this.followupTimestamps.clear()
    this.globalRateTimestamps.length = 0
    this.pendingChannelSelection.clear()
    this.createRuleWizards.clear()

    await prisma.whatsAppSession.updateMany({ where: { userId: this.userId }, data: { isConnected: false } })
  }

  private cleanupSocket(): void {
    if (this.sock) {
      try { this.sock.end(new Error('Cleanup')) } catch { /* ignore */ }
      this.sock = null
    }
  }

  private async isAllowedSender(sock: any, sender: string, payload: any, isGroup = false, remoteJid = '', allGroups?: Record<string, any>): Promise<boolean> {
    const contacts = await this.getContacts()
    const contactGroups = await this.getContactGroups()
    const normSender = this.normalizeJid(sender)
    let hasRestriction = false

    if (payload.contactJids?.length) {
      hasRestriction = true
      for (const jid of payload.contactJids) {
        const normContact = this.normalizeJid(jid)
        if (normSender === normContact) return true
        if (isGroup && this.ownPhone && this.ownLid) {
          if (normSender === this.ownLid && normContact === this.ownPhone) return true
          if (normSender === this.ownPhone && normContact === this.ownLid) return true
        }
        if (!isGroup && this.normalizeJid(remoteJid) === normContact) return true
        const contact = contacts.find(c => this.normalizeJid(c.id) === normContact || (c.lid && this.normalizeJid(c.lid) === normContact) || c.id === jid)
        if (contact) {
          if (this.normalizeJid(contact.id) === normSender) return true
          if (contact.lid && this.normalizeJid(contact.lid) === normSender) return true
        }
        const senderContact = contacts.find(c => (c.lid && this.normalizeJid(c.lid) === normSender) || this.normalizeJid(c.id) === normSender)
        if (senderContact) {
          if (this.normalizeJid(senderContact.id) === normContact) return true
          if (senderContact.lid && this.normalizeJid(senderContact.lid) === normContact) return true
        }
      }
    }

    if (payload.contactJid) {
      hasRestriction = true
      const normContact = this.normalizeJid(payload.contactJid)
      if (normSender === normContact) return true
      if (isGroup && this.ownPhone && this.ownLid) {
        if (normSender === this.ownLid && normContact === this.ownPhone) return true
        if (normSender === this.ownPhone && normContact === this.ownLid) return true
      }
      if (!isGroup && this.normalizeJid(remoteJid) === normContact) return true
      const contact = contacts.find(c => this.normalizeJid(c.id) === normContact || (c.lid && this.normalizeJid(c.lid) === normContact) || c.id === payload.contactJid)
      if (contact) {
        if (this.normalizeJid(contact.id) === normSender) return true
        if (contact.lid && this.normalizeJid(contact.lid) === normSender) return true
      }
      const senderContact = contacts.find(c => (c.lid && this.normalizeJid(c.lid) === normSender) || this.normalizeJid(c.id) === normSender)
      if (senderContact) {
        if (this.normalizeJid(senderContact.id) === normContact) return true
        if (senderContact.lid && this.normalizeJid(senderContact.lid) === normContact) return true
      }
    }

    if (payload.contactGroupIds?.length) {
      hasRestriction = true
      for (const groupId of payload.contactGroupIds) {
        const group = contactGroups.find(g => g.id === groupId)
        if (!group) continue
        if (group.memberJids.some(m => this.normalizeJid(m) === normSender)) return true
        if (isGroup && group.memberJids.some(m => this.normalizeJid(m) === this.normalizeJid(remoteJid))) return true
        if (!isGroup && group.memberJids.some(m => this.normalizeJid(m) === this.normalizeJid(remoteJid))) return true
        const senderEntry = contacts.find(c => (c.lid && this.normalizeJid(c.lid) === normSender) || this.normalizeJid(c.id) === normSender)
        if (senderEntry) {
          const contactIds = [this.normalizeJid(senderEntry.id)]
          if (senderEntry.lid) contactIds.push(this.normalizeJid(senderEntry.lid))
          if (senderEntry.phoneNumber) contactIds.push(this.normalizeJid(senderEntry.phoneNumber))
          if (group.memberJids.some(m => contactIds.includes(this.normalizeJid(m)))) return true
        }
      }
    }

    if (payload.contactGroupId) {
      hasRestriction = true
      const group = contactGroups.find(g => g.id === payload.contactGroupId)
      if (group) {
        if (group.memberJids.some(m => this.normalizeJid(m) === normSender)) return true
        if (isGroup && group.memberJids.some(m => this.normalizeJid(m) === this.normalizeJid(remoteJid))) return true
        if (!isGroup && group.memberJids.some(m => this.normalizeJid(m) === this.normalizeJid(remoteJid))) return true
        const senderEntry = contacts.find(c => (c.lid && this.normalizeJid(c.lid) === normSender) || this.normalizeJid(c.id) === normSender)
        if (senderEntry) {
          const contactIds = [this.normalizeJid(senderEntry.id)]
          if (senderEntry.lid) contactIds.push(this.normalizeJid(senderEntry.lid))
          if (senderEntry.phoneNumber) contactIds.push(this.normalizeJid(senderEntry.phoneNumber))
          if (group.memberJids.some(m => contactIds.includes(this.normalizeJid(m)))) return true
        }
        for (const memberJid of group.memberJids) {
          const normMember = this.normalizeJid(memberJid)
          const memberEntry = contacts.find(c => this.normalizeJid(c.id) === normMember || (c.lid && this.normalizeJid(c.lid) === normMember) || (c.phoneNumber && this.normalizeJid(c.phoneNumber) === normMember))
          if (memberEntry) {
            const memberIds = [this.normalizeJid(memberEntry.id)]
            if (memberEntry.lid) memberIds.push(this.normalizeJid(memberEntry.lid))
            if (memberEntry.phoneNumber) memberIds.push(this.normalizeJid(memberEntry.phoneNumber))
            if (memberIds.includes(normSender)) return true
          }
        }
      }
    }

    if (payload.savedGroupListNames?.length) {
      hasRestriction = true
      if (isGroup && allGroups) {
        const groupMeta = allGroups[remoteJid]
        const subject = (groupMeta as any)?.subject || ''
        for (const listName of payload.savedGroupListNames) {
          try {
            const savedList = await prisma.savedGroupList.findUnique({ where: { name_userId: { name: listName, userId: this.userId } } })
            if (!savedList) continue
            const groupNames: string[] = JSON.parse(savedList.groups)
            if (groupNames.some(g => g.toLowerCase().trim() === subject.toLowerCase().trim())) return true
          } catch { continue }
        }
      }
    }

    if (hasRestriction) return false
    return true
  }

  private async processCommands(
    sock: WASocket,
    sender: string,
    actualSender: string,
    textContent: string,
    message: WAMessage,
    allGroups: Record<string, any>,
    myJids: string[],
  ): Promise<boolean> {
    // ── Wizard ──
    if (this.createRuleWizards.has(sender)) {
      const wizard = this.createRuleWizards.get(sender)!
      if (Date.now() - wizard.createdAt > WIZARD_TIMEOUT_MS) {
        this.createRuleWizards.delete(sender)
        await sock.sendMessage(sender, { text: '⏰ Wizard timed out. Start again with `ws create rule <name>`.' })
        return true
      }
      const trimmed = textContent.trim().toLowerCase()
      if (trimmed === 'cancel' || trimmed === 'exit') {
        this.createRuleWizards.delete(sender)
        await sock.sendMessage(sender, { text: '❌ Wizard cancelled.' })
        return true
      }
      const parseCommaList = (raw: string): string[] => raw.split(/[,،]/).map(s => s.trim().replace(/\.\.\.$/, '').trim()).filter(Boolean)

      switch (wizard.step) {
        case 0: {
          const num = parseInt(trimmed, 10)
          if (isNaN(num) || num < 0 || num > 2) { await sock.sendMessage(sender, { text: '❌ Invalid. Choose 0 for Facebook, 1 for Instagram, 2 for WhatsApp.' }); return true }
          wizard.platform = num; wizard.step = 1
          await sock.sendMessage(sender, { text: '✏️ Trigger values? Send comma-separated, e.g. `price, السعر`' })
          return true
        }
        case 1: {
          const vals = parseCommaList(trimmed)
          if (vals.length === 0) { await sock.sendMessage(sender, { text: '❌ At least one trigger value is required.' }); return true }
          wizard.triggerValues = vals; wizard.step = 2
          await sock.sendMessage(sender, { text: '🎯 Trigger mode?\n\n0 — Beginning of sentence\n1 — Anywhere (exact word match)\n\nSend `0` or `1`' })
          return true
        }
        case 2: {
          const num = parseInt(trimmed, 10)
          if (isNaN(num) || num < 0 || num > 1) { await sock.sendMessage(sender, { text: '❌ Invalid. Choose 0 for Beginning, 1 for Anywhere.' }); return true }
          wizard.triggerMode = num; wizard.step = 3
          await sock.sendMessage(sender, { text: '📞 Contacts? Send phone numbers comma-separated, e.g. `70656517, 96176814597`\nOr send `-` for none.' })
          return true
        }
        case 3: {
          const raw = trimmed.replace(/^[-–—]+$/, '').trim()
          wizard.contactJids = raw ? raw.split(',').map(s => s.trim()).filter(Boolean).map(p => p.includes('@') ? p : p + '@s.whatsapp.net') : []
          wizard.step = 4
          await sock.sendMessage(sender, { text: '👥 Groups (Contact Groups or Group Lists)? Send names comma-separated.\nOr send `-` for none.' })
          return true
        }
        case 4: {
          const raw = trimmed.replace(/^[-–—]+$/, '').trim()
          const names = raw ? parseCommaList(raw) : []
          const resolvedContactGroupIds: string[] = []
          const resolvedContactGroupNames: string[] = []
          const resolvedSavedListNames: string[] = []
          const allSavedLists = await prisma.savedGroupList.findMany({ where: { userId: this.userId } })
          const allContactGroups = await this.getContactGroups()
          for (const name of names) {
            const cg = allContactGroups.find(g => g.name.toLowerCase() === name.toLowerCase())
            if (cg) { resolvedContactGroupIds.push(cg.id); resolvedContactGroupNames.push(cg.name); continue }
            const sl = allSavedLists.find(l => l.name.toLowerCase() === name.toLowerCase())
            if (sl) { resolvedSavedListNames.push(sl.name); continue }
            await sock.sendMessage(sender, { text: `❌ Group "${name}" not found.` })
            return true
          }
          wizard.contactGroupIds = resolvedContactGroupIds; wizard.contactGroupNames = resolvedContactGroupNames; wizard.savedGroupListNames = resolvedSavedListNames
          wizard.step = 5
          await sock.sendMessage(sender, { text: '💬 Your autoreply? Send the reply text' })
          return true
        }
        case 5: {
          if (!trimmed) { await sock.sendMessage(sender, { text: '❌ Reply text is required.' }); return true }
          wizard.replyText = trimmed; wizard.step = 6
          await sock.sendMessage(sender, { text: '🖼️ Media type? Choose:\n0 — Text only\n2 — Image\n3 — Video\n4 — Audio\n5 — Document' })
          return true
        }
        case 6: {
          const num = parseInt(trimmed, 10)
          if (isNaN(num) || ![0, 2, 3, 4, 5].includes(num)) { await sock.sendMessage(sender, { text: '❌ Invalid media type.' }); return true }
          wizard.mediaTypeCode = num
          const platformMap: Record<number, string> = { 0: 'facebook', 1: 'instagram', 2: 'whatsapp' }
          const mediaTypeMap: Record<number, string> = { 0: 'none', 2: 'image', 3: 'video', 4: 'audio', 5: 'document' }
          const platform = platformMap[wizard.platform!]
          const mediaType = mediaTypeMap[wizard.mediaTypeCode]
          const actionType = platform === 'facebook' ? 'facebook_feed' : 'send_dm'
          const base: Record<string, any> = { replyText: wizard.replyText }
          if (wizard.contactJids?.length) { base.contactJid = wizard.contactJids[0]; base.contactJids = wizard.contactJids }
          if (wizard.contactGroupIds?.length) { base.contactGroupId = wizard.contactGroupIds[0]; base.contactGroupIds = wizard.contactGroupIds }
          if (wizard.savedGroupListNames?.length) { base.savedGroupListNames = wizard.savedGroupListNames }
          const actionPayload = mediaType === 'none' ? JSON.stringify(base) : JSON.stringify({ ...base, mediaType, mediaUrls: [], caption: wizard.replyText })
          const triggerModeStr = wizard.triggerMode === 0 ? 'beginning' : 'anywhere'
          try {
            await prisma.automationRule.create({
              data: { userId: this.userId, name: wizard.name, platform, triggerType: 'keyword_comment', triggerValue: wizard.triggerValues!.join(', '), triggerMode: triggerModeStr, actionType, actionPayload },
            })
            await sock.sendMessage(sender, { text: `✅ Rule "${wizard.name}" created (trigger: ${triggerModeStr})` })
          } catch (err) { await sock.sendMessage(sender, { text: `❌ Failed: ${(err as Error).message}` }) }
          this.createRuleWizards.delete(sender)
          return true
        }
      }
      return true
    }

    // ── ws get groups ──
    if (/^ws get groups$/i.test(textContent.trim())) {
      const lines: string[] = []
      for (const [jid, meta] of Object.entries(allGroups)) {
        const m = meta as any
        const isAdmin = m.participants?.some((p: any) => myJids.includes(this.normalizeJid(p.id)) && p.admin)
        lines.push(`${m.subject} ${isAdmin ? '(admin)' : ''}`)
      }
      await sock.sendMessage(sender, { text: lines.length ? lines.join('\n') : 'No groups found' })
      return true
    }

    // ── ws get group lists ──
    if (/^ws get group lists( content)?$/i.test(textContent.trim())) {
      const showContent = /content$/i.test(textContent.trim())
      const lists = await prisma.savedGroupList.findMany({ where: { userId: this.userId }, orderBy: { createdAt: 'desc' } })
      if (lists.length === 0) { await sock.sendMessage(sender, { text: 'No saved group lists.' }); return true }
      const lines: string[] = []
      for (const l of lists) {
        const groups: string[] = JSON.parse(l.groups)
        lines.push(showContent ? `📁 *${l.name}*\n  ${groups.join('\n  ')}` : `📁 ${l.name}`)
      }
      await sock.sendMessage(sender, { text: lines.join('\n\n') })
      return true
    }

    // ── ws get rules ──
    if (/^ws get (all )?rules$/i.test(textContent.trim())) {
      const allMode = /all/i.test(textContent.trim())
      const rules = await prisma.automationRule.findMany({
        where: allMode ? { userId: this.userId, isActive: true } : { userId: this.userId, platform: 'whatsapp', isActive: true },
        orderBy: { name: 'asc' }, select: { name: true, platform: true, triggerType: true, triggerValue: true },
      })
      if (rules.length === 0) { await sock.sendMessage(sender, { text: 'No active rules.' }); return true }
      const lines = rules.map(r => `📋 *${r.name}* [${r.platform}] (${r.triggerType}: ${r.triggerValue})`)
      await sock.sendMessage(sender, { text: lines.join('\n') })
      return true
    }

    // ── ws get <rule> triggers ──
    const triggersMatch = textContent.match(/^ws get (.+?) triggers$/is)
    if (triggersMatch) {
      const ruleName = triggersMatch[1].trim()
      const rule = await prisma.automationRule.findFirst({ where: { userId: this.userId, name: ruleName, platform: 'whatsapp', isActive: true } })
      if (!rule) { await sock.sendMessage(sender, { text: `❌ Rule "${ruleName}" not found.` }); return true }
      const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim()).filter(Boolean)
      await sock.sendMessage(sender, { text: `📋 Triggers for *${ruleName}*:\n${triggers.map(t => `• ${t}`).join('\n')}` })
      return true
    }

    // ── -help ──
    if (/^-help$/i.test(textContent.trim())) {
      await sock.sendMessage(sender, {
        text: `📋 *Commands*\n\n🔹 *fb: content* — Post to Facebook Page\n🔹 *ws ai: prompt* — AI chat\n🔹 *ws verify telegram: code* — Verify Telegram login\n🔹 *-help* — Show help\n🔹 *ws create rule <name>* — Create automation rule\n🔹 *ws create <name> save <gr1, gr2>* — Save group list\n🔹 *ws get groups* — List WhatsApp groups\n🔹 *ws get rules* — List automation rules\n🔹 *ws gr1, gr2: content* — Forward to groups\n🔹 *ws list <name>: content* — Send to saved list\n🔹 *ws test <rule>: <trigger>* — Test rule\n🔹 *tel get channels* — List Telegram channels\n🔹 *tel <channel>: <content>* — Send to Telegram channel\n🔹 *tel get <channel> [limit] [time]* — Fetch messages\n🔹 *tel send <contact>: <message>* — Send Telegram msg`,
      })
      return true
    }

    // ── ws test rule ──
    const testMatch = textContent.match(/^ws\s+test\s+(.+?):\s*(.*)/is)
    if (testMatch) {
      const ruleName = testMatch[1].trim()
      const triggerValue = testMatch[2]?.trim() || ''
      const rule = await prisma.automationRule.findFirst({ where: { userId: this.userId, name: ruleName, isActive: true, platform: 'whatsapp' } })
      if (!rule) { await sock.sendMessage(sender, { text: `❌ Rule "${ruleName}" not found.` }); return true }
      const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim()).filter(Boolean)
      if (!matchAnyTrigger(triggerValue, triggers, rule.triggerMode || 'anywhere')) { await sock.sendMessage(sender, { text: `⚠️ Trigger "${triggerValue}" doesn't match rule triggers.` }); return true }
      let payload: any
      try { payload = JSON.parse(rule.actionPayload) } catch { payload = { replyText: rule.actionPayload } }
      const content = payload.replyText || ''
      if (content) await sock.sendMessage(sender, { text: content })
      await sock.sendMessage(sender, { text: `✅ Test executed for rule "${ruleName}"` })
      return true
    }

    // ── ws create rule ──
    const createRuleMatch = textContent.match(/^ws create rule (\S+)$/is)
    if (createRuleMatch) {
      const ruleName = createRuleMatch[1].trim()
      if (this.createRuleWizards.has(sender)) { await sock.sendMessage(sender, { text: '⚠️ Active wizard exists. Send `cancel` first.' }); return true }
      this.createRuleWizards.set(sender, { name: ruleName, step: 0, createdAt: Date.now() })
      await sock.sendMessage(sender, { text: `Let's create rule "${ruleName}".\n\n🌐 Platform? 0=Facebook, 1=Instagram, 2=WhatsApp\n(Send \`cancel\` to abort)` })
      return true
    }

    // ── ws delete rule ──
    const deleteRuleMatch = textContent.match(/^ws delete rule (.+)$/is)
    if (deleteRuleMatch) {
      const ruleName = deleteRuleMatch[1].trim()
      const rule = await prisma.automationRule.findFirst({ where: { userId: this.userId, name: ruleName } })
      if (!rule) { await sock.sendMessage(sender, { text: `❌ Rule "${ruleName}" not found.` }); return true }
      await prisma.automationRule.delete({ where: { id: rule.id } })
      await sock.sendMessage(sender, { text: `✅ Deleted rule "${ruleName}".` })
      return true
    }

    // ── ws create name save gr1, gr2 ──
    const createMatch = textContent.match(/^ws\s+create\s+(.+?)\s+save\s+(.+)/is)
    if (createMatch) {
      const listName = createMatch[1].trim()
      const groupNames = createMatch[2].split(',').map(s => s.trim()).filter(Boolean)
      if (!listName || groupNames.length === 0) return true
      await prisma.savedGroupList.upsert({
        where: { name_userId: { name: listName, userId: this.userId } },
        update: { groups: JSON.stringify(groupNames) },
        create: { name: listName, groups: JSON.stringify(groupNames), userId: this.userId },
      })
      await sock.sendMessage(sender, { text: `✅ Saved list "${listName}" (${groupNames.length} groups)` })
      return true
    }

    // ── ws delete list ──
    const deleteListMatch = textContent.match(/^ws delete(?: list)? (.+)$/is)
    if (deleteListMatch) {
      const listName = deleteListMatch[1].trim()
      const list = await prisma.savedGroupList.findUnique({ where: { name_userId: { name: listName, userId: this.userId } } })
      if (!list) { await sock.sendMessage(sender, { text: `❌ List "${listName}" not found.` }); return true }
      await prisma.savedGroupList.delete({ where: { id: list.id } })
      await sock.sendMessage(sender, { text: `✅ Deleted list "${listName}".` })
      return true
    }

    // ── ws list name: content ──
    const listMatch = textContent.match(/^ws\s+list\s+(.+?):\s*(.*)/is)
    if (listMatch) {
      const listName = listMatch[1].trim()
      const content = listMatch[2] || ''
      const hasMedia = !!(message.message?.imageMessage || message.message?.documentMessage)
      if (!content && !hasMedia) return true
      const savedList = await prisma.savedGroupList.findUnique({ where: { name_userId: { name: listName, userId: this.userId } } })
      if (!savedList) { await sock.sendMessage(sender, { text: `❌ List "${listName}" not found` }); return true }
      const groups: string[] = JSON.parse(savedList.groups)
      const results: string[] = []
      for (const gName of groups.map(s => s.toLowerCase())) {
        const waGroup = Object.entries(allGroups).find(([, meta]) => {
          const subject = (meta as any).subject?.toLowerCase() || ''
          return subject === gName && (meta as any).participants?.some((p: any) => myJids.includes(this.normalizeJid(p.id)) && p.admin)
        })
        if (!waGroup) { results.push(`❌ ${gName}: not found or not admin`); continue }
        try {
          if (message.message?.imageMessage) {
            const buffer = await downloadMediaMessage(message, 'buffer', {})
            await sock.sendMessage(waGroup[0], { image: buffer, caption: content } as any)
          } else if (message.message?.documentMessage) {
            const buffer = await downloadMediaMessage(message, 'buffer', {})
            await sock.sendMessage(waGroup[0], { document: buffer, caption: content, fileName: message.message.documentMessage.fileName || 'document' } as any)
          } else {
            await sock.sendMessage(waGroup[0], { text: content } as any)
          }
          results.push(`✅ ${gName}`)
        } catch (err) { results.push(`❌ ${gName}: ${(err as Error).message}`) }
      }
      await sock.sendMessage(sender, { text: results.join('\n') })
      return true
    }

    // ── ws ai: prompt ──
    const aiMatch = textContent.match(/^ws\s+ai\s*:\s*(.*)/is)
    if (aiMatch) {
      const prompt = aiMatch[1]?.trim()
      if (!prompt) { await sock.sendMessage(sender, { text: '❌ Usage: ws ai: <prompt>' }); return true }
      try {
        await sock.sendMessage(sender, { text: '🧠 Thinking...' })
        const reply = await chatCompletion([{ role: 'user', content: prompt }])
        const text = reply.length > 4000 ? reply.slice(0, 4000) + '...' : reply
        await sock.sendMessage(sender, { text: `🤖 *AI:*\n\n${text}` })
      } catch (err) { await sock.sendMessage(sender, { text: `❌ AI error: ${(err as Error).message}` }) }
      return true
    }

    // ── ws verify telegram : <code> ──
    const telVerifyMatch = textContent.match(/^ws\s+verify\s+telegram\s*:\s*(.*)/is)
    if (telVerifyMatch) {
      const code = telVerifyMatch[1]?.trim()
      if (!code) { await sock.sendMessage(sender, { text: '❌ Usage: ws verify telegram : <code>' }); return true }
      try {
        const result = await signIn(this.userId, code)
        if (result.passwordNeeded) {
          await sock.sendMessage(sender, { text: '🔑 2FA password required. Send: `ws verify telegram : <password>`' })
        } else {
          await sock.sendMessage(sender, { text: '✅ Telegram verified and connected!' })
        }
      } catch (err) { await sock.sendMessage(sender, { text: `❌ Telegram verify failed: ${(err as Error).message}` }) }
      return true
    }

    // ── ws group1, group2: content ──
    const wsMatch = textContent.match(/^ws\s+(.+?):\s*(.*)/is)
    if (wsMatch) {
      const groupNames = wsMatch[1].split(',').map(s => s.trim().toLowerCase())
      const content = wsMatch[2] || ''
      const hasMedia = !!(message.message?.imageMessage || message.message?.documentMessage)
      if (groupNames.length === 0 || (!content && !hasMedia)) return true
      const results: string[] = []
      for (const gName of groupNames) {
        const waGroup = Object.entries(allGroups).find(([, meta]) => {
          const subject = (meta as any).subject?.toLowerCase() || ''
          return subject === gName && (meta as any).participants?.some((p: any) => myJids.includes(this.normalizeJid(p.id)) && p.admin)
        })
        if (!waGroup) { results.push(`❌ ${gName}: not found or not admin`); continue }
        try {
          if (message.message?.imageMessage) {
            const buffer = await downloadMediaMessage(message, 'buffer', {})
            await sock.sendMessage(waGroup[0], { image: buffer, caption: content } as any)
          } else if (message.message?.documentMessage) {
            const buffer = await downloadMediaMessage(message, 'buffer', {})
            await sock.sendMessage(waGroup[0], { document: buffer, caption: content, fileName: message.message.documentMessage.fileName || 'document' } as any)
          } else {
            await sock.sendMessage(waGroup[0], { text: content } as any)
          }
          results.push(`✅ ${gName}`)
        } catch (err) { results.push(`❌ ${gName}: ${(err as Error).message}`) }
      }
      await sock.sendMessage(sender, { text: results.join('\n') })
      return true
    }

    // ── ws help ──
    if (/^ws\s+(help|-h)$/i.test(textContent.trim())) {
      await sock.sendMessage(sender, { text: '🔹 ws get groups\n🔹 ws get rules\n🔹 ws create rule <name>\n🔹 ws delete rule <name>\n🔹 ws create <name> save <gr1, gr2>\n🔹 ws delete list <name>\n🔹 ws list <name>: <content>\n🔹 ws <gr1, gr2>: <content>\n🔹 ws test <rule>: <trigger>\n🔹 ws ai: <prompt>\n🔹 ws verify telegram: <code>\n🔹 tel get channels\n🔹 tel <channel>: <content>' })
      return true
    }

    // ── ws notebooks ──
    if (/^ws\s+notebooks$/i.test(textContent.trim())) {
      try {
        const data = await nlmSeq(null, ['list', '--json'])
        const nbs = data?.notebooks || []
        if (nbs.length === 0) {
          await sock.sendMessage(sender, { text: '📚 No notebooks found.' })
        } else {
          const lines = nbs.map((nb: any, i: number) => `${i + 1}. *${nb.title}*`).join('\n')
          await sock.sendMessage(sender, { text: `📚 *Notebooks*\n\n${lines}` })
        }
      } catch (err: any) {
        await sock.sendMessage(sender, { text: `❌ Error listing notebooks: ${err.message}` })
      }
      return true
    }

    // ── ws notebook <name> chat [limit] ──
    const nbChatMatch = textContent.match(/^ws\s+notebook\s+(.+?)\s+chat(?:\s+(\d+))?$/i)
    if (nbChatMatch) {
      const query = nbChatMatch[1].trim()
      const limit = parseInt(nbChatMatch[2] || '10', 10)
      try {
        const matches = await nlmFindNotebooks(query)
        if (matches.length === 0) {
          await sock.sendMessage(sender, { text: `❌ No notebooks matching "${query}" found.` })
        } else if (matches.length > 1) {
          const list = matches.map((nb, i) => `${i + 1}. *${nb.title}*`).join('\n')
          await sock.sendMessage(sender, { text: `🔍 Multiple notebooks match "${query}":\n\n${list}\n\n_Reply with:_ ws notebook <exact name> chat ${limit}` })
        } else {
          const nb = matches[0]
          const histData = await nlmSeq(nb.id, ['history', '--json', '--show-all'], 60000)
          const pairs = histData?.qa_pairs || []
          const last = pairs.slice(-limit)
          if (last.length === 0) {
            await sock.sendMessage(sender, { text: `💬 No chat history in *${nb.title}*.` })
          } else {
            const lines = last.map((p: any, i: number) => {
              const q = (p.question || '').substring(0, 200)
              const a = (p.answer || '').substring(0, 200)
              return `*#${pairs.length - last.length + i + 1}*\n👤 ${q}\n🤖 ${a}`
            }).join('\n\n')
            await sock.sendMessage(sender, { text: `💬 *${nb.title}* (last ${last.length})\n\n${lines}` })
          }
        }
      } catch (err: any) {
        await sock.sendMessage(sender, { text: `❌ Error: ${err.message}` })
      }
      return true
    }

    // ── ws notebook <name> quizes ──
    const nbQuizMatch = textContent.match(/^ws\s+notebook\s+(.+?)\s+quizes?$/i)
    if (nbQuizMatch) {
      const query = nbQuizMatch[1].trim()
      try {
        const matches = await nlmFindNotebooks(query)
        if (matches.length === 0) {
          await sock.sendMessage(sender, { text: `❌ No notebooks matching "${query}" found.` })
        } else if (matches.length > 1) {
          const list = matches.map((nb, i) => `${i + 1}. *${nb.title}*`).join('\n')
          await sock.sendMessage(sender, { text: `🔍 Multiple notebooks match "${query}":\n\n${list}\n\n_Reply with:_ ws notebook <exact name> quizes` })
        } else {
          const nb = matches[0]
          const artData = await nlmSeq(nb.id, ['artifact', 'list', '--json'])
          const raw = Array.isArray(artData) ? artData : (artData?.artifacts || [])
          const quizes = raw.filter((a: any) => (a.type_id || a.type || '').replace(/_/g, '-').includes('quiz'))
          if (quizes.length === 0) {
            await sock.sendMessage(sender, { text: `📝 No quizzes found in *${nb.title}*.` })
          } else {
            const lines = quizes.map((a: any, i: number) => `${i + 1}. *${a.title || a.id || 'Untitled'}*`).join('\n')
            await sock.sendMessage(sender, { text: `📝 *Quizzes in ${nb.title}*\n\n${lines}` })
          }
        }
      } catch (err: any) {
        await sock.sendMessage(sender, { text: `❌ Error: ${err.message}` })
      }
      return true
    }

    // ── catch unrecognized ws ──
    if (/^ws\s+/i.test(textContent)) {
      await sock.sendMessage(sender, { text: '❌ Unknown ws command. Try: ws help' })
      return true
    }

    // ── tel get channels ──
    if (/^tel\s+get\s+channels$/i.test(textContent.trim())) {
      try {
        const channels = await getChannels()
        if (channels.length === 0) { await sock.sendMessage(sender, { text: '📢 No channels found.' }); return true }
        const lines = channels.map(c => `📢 *${c.name}*${c.canSend ? '' : ' 🔇'}`)
        await sock.sendMessage(sender, { text: `📢 *Telegram Channels (${channels.length})*\n\n${lines.join('\n')}` })
      } catch (err) { await sock.sendMessage(sender, { text: `❌ Error: ${(err as Error).message}` }) }
      return true
    }

    // ── tel get mybots ──
    if (/^tel\s+get\s+mybots$/i.test(textContent.trim())) {
      try {
        const bots = await getMyBots()
        if (bots.length === 0) { await sock.sendMessage(sender, { text: '🤖 No bots found.' }); return true }
        const lines = bots.map(b => `🤖 *${b.name}*${b.username ? ` (@${b.username})` : ''}`)
        await sock.sendMessage(sender, { text: `🤖 *My Bots (${bots.length})*\n\n${lines.join('\n')}` })
      } catch (err) { await sock.sendMessage(sender, { text: `❌ Error: ${(err as Error).message}` }) }
      return true
    }

    // ── tel get contacts ──
    if (/^tel\s+get\s+contacts$/i.test(textContent.trim())) {
      try {
        let contacts = await prisma.telegramContact.findMany({ where: { userId: this.userId }, orderBy: { name: 'asc' } })
        if (contacts.length === 0) {
          await sock.sendMessage(sender, { text: '🔄 Syncing from Telegram...' })
          await syncContactsAndDialogs(this.userId)
          contacts = await prisma.telegramContact.findMany({ where: { userId: this.userId }, orderBy: { name: 'asc' } })
        }
        if (contacts.length === 0) { await sock.sendMessage(sender, { text: '📇 No contacts found.' }); return true }
        const lines = contacts.map(c => `👤 *${c.name}*${c.phone ? ` (${c.phone})` : ''}${c.username ? ` @${c.username}` : ''}`)
        await sock.sendMessage(sender, { text: `📇 *Telegram Contacts (${contacts.length})*\n\n${lines.join('\n')}` })
      } catch (err) { await sock.sendMessage(sender, { text: `❌ Error: ${(err as Error).message}` }) }
      return true
    }

    // ── tel get <name> [limit] [time] ──
    const telGetChatMatch = textContent.match(/^tel\s+get\s+(.+?)(?:\s+(\d+))?(?:\s+time)?$/is)
    if (telGetChatMatch) {
      const channelName = telGetChatMatch[1].trim()
      const limit = telGetChatMatch[2] ? parseInt(telGetChatMatch[2], 10) : 15
      const showTime = /time$/i.test(textContent.trim())
      try {
        const dialogs = await getDialogs()
        const matches = dialogs.filter(d => d.name.toLowerCase().includes(channelName.toLowerCase()) && d.type === 'channel')
        if (matches.length === 0) { await sock.sendMessage(sender, { text: `❌ No channel matches "${channelName}".` }); return true }
        if (matches.length > 1) {
          const lines = matches.map((d, i) => `${i + 1}. *${d.name}*`)
          await sock.sendMessage(sender, { text: `🔍 Multiple matches:\n\n${lines.join('\n')}\n\nReply with the number.` })
          this.pendingChannelSelection.set(actualSender, { options: matches.map(d => ({ name: d.name, id: d.id })), limit, showTime })
          return true
        }
        const channel = matches[0]
        const msgs = await getMessages(channel.id, limit)
        if (msgs.length === 0) { await sock.sendMessage(sender, { text: `📭 No messages in *${channel.name}*.` }); return true }
        const lines = msgs.map(m => {
          const date = showTime ? new Date(m.date).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) + ' ' : ''
          return `• ${date}${m.out ? 'Me' : m.fromId.slice(0, 6)}: ${m.text || '(no text)'}`
        })
        await sock.sendMessage(sender, { text: `💬 *${channel.name}* (${msgs.length})\n\n${lines.join('\n')}` })
      } catch (err) { await sock.sendMessage(sender, { text: `❌ Error: ${(err as Error).message}` }) }
      return true
    }

    // ── tel send <contact>: <message> ──
    const telSendMatch = textContent.match(/^tel\s+send\s+(.+?)\s*:\s*(.*)/is)
    if (telSendMatch) {
      const contactName = telSendMatch[1].trim()
      const messageText = telSendMatch[2]?.trim() || ''
      try {
        let filePath: string | undefined
        if (message.message?.imageMessage || message.message?.documentMessage) {
          const buffer = await downloadMediaMessage(message, 'buffer', {})
          let ext = '.bin'
          if (message.message?.imageMessage) ext = '.jpg'
          else if (message.message?.documentMessage) ext = path.extname(message.message.documentMessage.fileName || 'file') || '.bin'
          const fpath = path.resolve(os.tmpdir(), `tel_${Date.now()}${ext}`)
          fs.writeFileSync(fpath, buffer)
          filePath = fpath
        }
        await sendToContact(this.userId, contactName, messageText, filePath)
        await sock.sendMessage(sender, { text: `✅ Sent to "${contactName}"` })
      } catch (err) { await sock.sendMessage(sender, { text: `❌ Telegram error: ${(err as Error).message}` }) }
      return true
    }

    // ── tel <channel>: <content> ── send to Telegram channel
    const telChannelMatch = textContent.match(/^tel\s+(.+?)\s*:\s*(.*)/is)
    if (telChannelMatch && !textContent.match(/^tel\s+(get|send)\s/i)) {
      const channelName = telChannelMatch[1].trim()
      const messageText = telChannelMatch[2]?.trim() || ''
      try {
        const channel = await findChannelId(channelName)
        if (!channel) { await sock.sendMessage(sender, { text: `❌ No channel matches "${channelName}". Use \`tel get channels\` to list.` }); return true }
        if (!channel.canSend) { await sock.sendMessage(sender, { text: `❌ You can't send messages to "${channel.name}".` }); return true }
        let filePath: string | undefined
        if (message.message?.imageMessage || message.message?.documentMessage) {
          const buffer = await downloadMediaMessage(message, 'buffer', {})
          let ext = '.bin'
          if (message.message?.imageMessage) ext = '.jpg'
          else if (message.message?.documentMessage) ext = path.extname(message.message.documentMessage.fileName || 'file') || '.bin'
          const fpath = path.resolve(os.tmpdir(), `tel_ch_${Date.now()}${ext}`)
          fs.writeFileSync(fpath, buffer)
          filePath = fpath
        }
        await sendToChannel(channel.id, messageText, filePath)
        await sock.sendMessage(sender, { text: `✅ Sent to channel "${channel.name}"` })
      } catch (err) { await sock.sendMessage(sender, { text: `❌ Telegram error: ${(err as Error).message}` }) }
      return true
    }

    // ── fb: content ──
    const fbPrefix = textContent.match(/^fb\s*:\s*(.*)/is)
    if (fbPrefix) {
      const fbContent = fbPrefix[1]
      const hasMedia = !!(message.message?.imageMessage || message.message?.documentMessage)
      if (!fbContent && !hasMedia) return true
      const fbPage = await prisma.facebookPage.findFirst({ where: { userId: this.userId } })
      if (!fbPage) { await sock.sendMessage(sender, { text: '❌ No Facebook page connected.' }); return true }
      try {
        let content = fbContent
        let mediaUrls: string[] | null = null
        if (message.message?.imageMessage) {
          const buffer = await downloadMediaMessage(message, 'buffer', {})
          const fileName = `fb_${Date.now()}.jpg`
          const filePath = path.resolve(process.cwd(), 'uploads', fileName)
          fs.writeFileSync(filePath, buffer as Buffer)
          content = message.message.imageMessage.caption || fbContent || ''
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
        await sock.sendMessage(sender, { text: `✅ Posted to *${fbPage.pageName || fbPage.pageId}*` })
      } catch (err) {
        await prisma.facebookPostLog.create({
          data: { userId: fbPage.userId, pageId: fbPage.pageId, content: fbContent || '', status: 'failed', error: (err as Error).message },
        })
        await sock.sendMessage(sender, { text: `❌ Page post failed: ${(err as Error).message}` })
      }
      return true
    }

    return false
  }

  async handleIncomingMessage(sock: WASocket, message: WAMessage): Promise<void> {
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

      let sharedAllGroups: Record<string, any> | undefined

      // ── fromMe messages ──
      if (message.key.fromMe) {
        const normSender = this.normalizeJid(actualSender)
        if (normSender !== this.ownPhone && normSender !== this.ownLid) return

        const trimmedNum = textContent.trim()
        const num = parseInt(trimmedNum, 10)
        if (!isNaN(num) && this.pendingChannelSelection.has(actualSender)) {
          const pending = this.pendingChannelSelection.get(actualSender)!
          if (num >= 1 && num <= pending.options.length) {
            const { options, limit, showTime } = pending
            this.pendingChannelSelection.delete(actualSender)
            const chosen = options[num - 1]
            try {
              const msgs = await getMessages(chosen.id, limit)
              if (msgs.length === 0) { await sock.sendMessage(sender, { text: `📭 No messages in *${chosen.name}*.` }) }
              else {
                const lines = msgs.map(m => {
                  const date = showTime ? new Date(m.date).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) + ' ' : ''
                  return `• ${date}${m.out ? 'Me' : m.fromId.slice(0, 6)}: ${m.text || '(no text)'}`
                })
                await sock.sendMessage(sender, { text: `💬 *${chosen.name}* (${msgs.length})\n\n${lines.join('\n')}` })
              }
            } catch (err) { await sock.sendMessage(sender, { text: `❌ Error: ${(err as Error).message}` }) }
            return
          }
        }

        sharedAllGroups = await sock.groupFetchAllParticipating().catch(() => ({} as Record<string, any>))
        const myJids = [this.normalizeJid(sock.user?.id || ''), this.ownLid].filter((x): x is string => !!x)
        const handled = await this.processCommands(sock, sender, actualSender, textContent, message, sharedAllGroups, myJids)
        if (handled) return
      }

      // ── Gateway ──
      if (sender.endsWith('@g.us') && textContent.trim()) {
        const normSender = this.normalizeJid(actualSender)
        const isOwner = normSender === this.ownPhone || normSender === this.ownLid
        let allowed = isOwner
        if (!allowed) {
          const allowedNum = await prisma.allowedNumber.findUnique({ where: { phone_userId: { phone: normSender, userId: this.userId } } }).catch(() => null)
          allowed = !!allowedNum
        }
        if (allowed) {
          sharedAllGroups = await sock.groupFetchAllParticipating().catch(() => ({} as Record<string, any>))
          const groupMeta = sharedAllGroups[sender]
          const groupName = (groupMeta as any)?.subject || ''
          if (groupName) {
            const allAllowedGrps = await prisma.allowedGroup.findMany({ where: { userId: this.userId } })
            const allowedGrp = allAllowedGrps.find(g => g.name.toLowerCase() === groupName.toLowerCase())
            if (allowedGrp) {
              const myJids = [this.normalizeJid(sock.user?.id || ''), this.ownLid].filter((x): x is string => !!x)
              const handled = await this.processCommands(sock, sender, actualSender, textContent, message, sharedAllGroups, myJids)
              if (handled) return
            }
          }
        }
      }

      const listResponse = message.message?.listResponseMessage
      const interactiveResponse = message.message?.interactiveResponseMessage
      if (!textContent && !listResponse && !interactiveResponse) return

      // ── Interactive responses ──
      let selectedId: string | undefined
      if (listResponse?.singleSelectReply?.selectedRowId) {
        selectedId = listResponse.singleSelectReply.selectedRowId
      } else if (interactiveResponse?.nativeFlowResponseMessage?.paramsJson) {
        try {
          const nfParams = JSON.parse(interactiveResponse.nativeFlowResponseMessage.paramsJson)
          selectedId = nfParams.id || nfParams.selectedRowId
        } catch { /* ignore */ }
      } else if (textContent) {
        const trimmed = textContent.trim()
        const num = parseInt(trimmed, 10)
        if (!isNaN(num) && num > 0) {
          const rules = await prisma.automationRule.findMany({ where: { userId: this.userId, isActive: true, platform: 'whatsapp', triggerType: 'keyword_comment' } })
          for (const rule of rules) {
            let payload: any
            try { payload = JSON.parse(rule.actionPayload) } catch { continue }
            if (!payload.interactive || !payload.options) continue
            if (!await this.isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender, sharedAllGroups)) continue
            const optionIndex = num - 1
            if (optionIndex < payload.options.length) { selectedId = payload.options[optionIndex].id }
            if (selectedId) break
          }
        }
      }

      if (selectedId) {
        const rules = await prisma.automationRule.findMany({ where: { userId: this.userId, isActive: true, platform: 'whatsapp', triggerType: 'keyword_comment' } })
        for (const rule of rules) {
          let payload: any
          try { payload = JSON.parse(rule.actionPayload) } catch { continue }
          if (!payload.interactive || !payload.options) continue
          if (!await this.isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender, sharedAllGroups)) continue
          const option = payload.options.find((o: any) => o.id === selectedId)
          if (!option?.reply) continue
          const lastFollowup = this.followupTimestamps.get(sender) || 0
          if (Date.now() - lastFollowup < MIN_FOLLOWUP_THROTTLE_MS) continue
          try {
            await delay(randomDelay(1000, 3000))
            await Promise.race([
              sock.sendMessage(sender, { text: option.reply } as any),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
            ])
            this.followupTimestamps.set(sender, Date.now())
          } catch { /* ignore */ }
        }
        return
      }

      if (!textContent) return

      // ── Main automation rules ──
      const rules = await prisma.automationRule.findMany({ where: { userId: this.userId, isActive: true, platform: 'whatsapp', triggerType: 'keyword_comment' } })
      for (const rule of rules) {
        const triggers = rule.triggerValue.split(/[,،]/).map(t => t.trim()).filter(Boolean)
        if (!matchAnyTrigger(textContent, triggers, rule.triggerMode || 'anywhere')) continue

        const lastSent = this.threadTimestamps.get(sender) || 0
        if (Date.now() - lastSent < MIN_THROTTLE_MS) continue

        let payload: any
        try { payload = JSON.parse(rule.actionPayload) } catch { payload = { replyText: rule.actionPayload } }

        if (!await this.isAllowedSender(sock, actualSender, payload, sender.endsWith('@g.us'), sender, sharedAllGroups)) continue

        const resolveMediaUrl = (url: string): string => {
          if (url.startsWith('http://') || url.startsWith('https://')) return url
          const localPath = url.startsWith('/uploads/') ? path.join(path.resolve(process.cwd(), 'uploads'), url.replace('/uploads/', '')) : path.resolve(url)
          return fs.existsSync(localPath) ? localPath : url
        }

        const buildMediaContent = (url: string): Record<string, unknown> => {
          const mediaUrl = resolveMediaUrl(url)
          const caption = payload.caption || payload.replyText || ''
          switch (payload.mediaType) {
            case 'image': return { image: { url: mediaUrl }, caption }
            case 'audio': return { audio: { url: mediaUrl }, mimetype: 'audio/mp4' }
            case 'video': return { video: { url: mediaUrl }, caption }
            case 'document': return { document: { url: mediaUrl }, fileName: payload.fileName || 'document', caption }
            default: return { text: payload.replyText || 'Thanks for your message!' }
          }
        }

        const urls = payload.mediaUrls?.length ? payload.mediaUrls : (payload.mediaUrl ? [payload.mediaUrl] : [])

        try {
          if (!this.checkGlobalRate()) continue
          await delay(randomDelay(3000, 8000))

          async function sendWithTimeout(jid: string, content: any, ms = 20000): Promise<void> {
            await Promise.race([
              sock.sendMessage(jid, content as any),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Send timed out')), ms)),
            ])
          }

          if (payload.interactive && payload.options?.length) {
            const lines = [payload.replyText || 'Please choose an option:', '']
            payload.options.forEach((opt: any, i: number) => { lines.push(`${i + 1}. ${opt.label}`) })
            lines.push('', 'Reply with the number of your choice.')
            await sendWithTimeout(sender, { text: lines.join('\n') })
          } else if (urls.length && payload.mediaType && payload.mediaType !== 'none') {
            for (let i = 0; i < urls.length; i++) {
              await sendWithTimeout(sender, buildMediaContent(urls[i]))
              if (i < urls.length - 1) await delay(1000)
            }
          } else {
            await sendWithTimeout(sender, { text: payload.replyText || 'Thanks for your message!' })
          }

          this.threadTimestamps.set(sender, Date.now())
        } catch { /* ignore */ }
      }
    } catch (err) {
      log('error', 'whatsapp', 'Error in handleIncomingMessage', { userId: this.userId, error: (err as Error).message })
    }
  }
}
