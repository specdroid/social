import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram'
import { computeCheck } from 'telegram/Password'
import { env } from '../config/env'
import { PrismaClient } from '@prisma/client'
import { Server as SocketIOServer } from 'socket.io'
import fs from 'fs'
import { log } from '../utils/logger'

const prisma = new PrismaClient()

let client: TelegramClient | null = null
let stringSession: StringSession | null = null
let loginPhone = ''
let loginPhoneCodeHash = ''
let io: SocketIOServer | null = null
let activeUserId: string | null = null

export interface TelegramStatus {
  connected: boolean
  phone: string | null
}

export interface DialogInfo {
  id: string
  name: string
  type: 'user' | 'group' | 'channel'
  unreadCount: number
  lastMessage: string | null
  date: string | null
  phone?: string
  canSend: boolean
}

export interface MessageInfo {
  id: number
  fromId: string
  text: string
  date: string
  out: boolean
  media: { type: string; caption?: string } | null
}

function getClient(): TelegramClient {
  if (!client) throw new Error('Telegram client not initialised')
  return client
}

async function loadSession(userId: string): Promise<string> {
  try {
    const record = await prisma.telegramSession.findUnique({ where: { userId } })
    return record?.session || ''
  } catch {
    return ''
  }
}

async function saveSession(userId: string, phone: string) {
  const sessionStr = stringSession?.save() || ''
  await prisma.telegramSession.upsert({
    where: { userId },
    update: { session: sessionStr, phone, isLoggedIn: true },
    create: { userId, session: sessionStr, phone, isLoggedIn: true },
  })
}

async function clearSession(userId: string) {
  await prisma.telegramSession.deleteMany({ where: { userId } })
}

export function setSocketIO(serverIo: SocketIOServer) {
  io = serverIo
}

function setupEventHandlers() {
  if (!client || !io) return
  client.addEventHandler((update: any) => {
    let message: any
    if (update instanceof Api.UpdateNewMessage) {
      message = update.message
    } else if (update instanceof Api.UpdateNewChannelMessage) {
      message = update.message
    } else {
      return
    }
    if (!message) return
    const chatId = message.peerId?.userId?.toString()
      || message.peerId?.channelId?.toString()
      || message.peerId?.chatId?.toString()
      || message.chatId?.toString()
    if (!chatId || !client) return
    ; (async () => {
      try {
        const me = await client!.getMe()
        const senderId = message.fromId?.userId?.toString()
          || message.fromId?.channelId?.toString()
          || message.fromId?.toString()
        const isOut = message.out || (senderId === me?.id?.toString())
        const msgInfo: MessageInfo = {
          id: message.id,
          fromId: isOut ? 'me' : (senderId || ''),
          text: message.message || '',
          date: new Date((message.date || 0) * 1000).toISOString(),
          out: isOut,
          media: message.media
            ? { type: message.media.className || 'unknown', caption: message.message || undefined }
            : null,
        }
        io?.emit('telegram:message', { chatId, message: msgInfo })
      } catch { /* ignore */ }
    })()
  })
}

export async function initClient(userId: string): Promise<void> {
  if (client) return
  activeUserId = userId
  const sessionStr = await loadSession(userId)
  stringSession = new StringSession(sessionStr)
  client = new TelegramClient(stringSession, env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    connectionRetries: 5,
  })
  await client.connect()
}

async function ensureReady(userId: string) {
  await initClient(userId)
  const c = getClient()
  try {
    await c.invoke(new Api.updates.GetState())
    setupEventHandlers()
  } catch {
    throw new Error('Telegram not authorised')
  }
}

export async function sendCode(userId: string, phone: string): Promise<void> {
  await initClient(userId)
  const c = getClient()

  try {
    await c.invoke(new Api.updates.GetState())
    const me = await c.getMe()
    await saveSession(userId, me?.phone || phone)
    setupEventHandlers()
    return
  } catch {
    // Not authorised – continue with phone login
  }

  const result = await c.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: env.TELEGRAM_API_ID,
      apiHash: env.TELEGRAM_API_HASH,
      settings: new Api.CodeSettings({}),
    })
  ) as Api.auth.SentCode

  loginPhone = phone
  loginPhoneCodeHash = result.phoneCodeHash
}

export async function signIn(userId: string, code: string): Promise<{ success: boolean; passwordNeeded: boolean }> {
  const c = getClient()
  if (!loginPhone || !loginPhoneCodeHash) {
    throw new Error('No login in progress. Call sendCode first.')
  }

  try {
    await c.invoke(
      new Api.auth.SignIn({
        phoneNumber: loginPhone,
        phoneCodeHash: loginPhoneCodeHash,
        phoneCode: code,
      })
    )

    const me = await c.getMe()
    await saveSession(userId, me?.phone || loginPhone)
    setupEventHandlers()
    loginPhone = ''
    loginPhoneCodeHash = ''
    return { success: true, passwordNeeded: false }
  } catch (err: any) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return { success: false, passwordNeeded: true }
    }
    throw err
  }
}

export async function checkPassword(userId: string, password: string): Promise<void> {
  const c = getClient()

  const passwordSrpResult = await c.invoke(new Api.account.GetPassword())
  const passwordSrpCheck = await computeCheck(passwordSrpResult, password) as any
  await c.invoke(new Api.auth.CheckPassword({ password: passwordSrpCheck }))

  const me = await c.getMe()
  await saveSession(userId, me?.phone || loginPhone)
  setupEventHandlers()
  loginPhone = ''
  loginPhoneCodeHash = ''
}

export async function getStatus(userId: string): Promise<TelegramStatus> {
  try {
    await initClient(userId)
    const c = getClient()
    await c.invoke(new Api.updates.GetState())
    const me = await c.getMe()
    setupEventHandlers()
    return { connected: true, phone: me?.phone || null }
  } catch {
    return { connected: false, phone: null }
  }
}

export async function disconnectClient(userId: string): Promise<void> {
  if (client) {
    try { client.disconnect() } catch { /* ignore */ }
    try { client.destroy() } catch { /* ignore */ }
    client = null
  }
  stringSession = null
  loginPhone = ''
  loginPhoneCodeHash = ''
  activeUserId = null
  await clearSession(userId)
}

export async function getDialogs(): Promise<DialogInfo[]> {
  await ensureReady(activeUserId || '')
  const c = getClient()
  const dialogs = await c.getDialogs({ limit: 100 })
  const result: DialogInfo[] = dialogs.map((d) => {
    const entity = d.entity as any
    const isChannel = entity?.className === 'Channel'
    const canSend = !isChannel || entity?.adminRights || entity?.creator
    return {
      id: d.id?.toString() || '',
      name: d.name || d.title || 'Unknown',
      type: (d.isUser ? 'user' : d.isGroup ? 'group' : 'channel') as DialogInfo['type'],
      unreadCount: d.unreadCount,
      lastMessage: d.message?.message || null,
      date: d.message?.date ? new Date((d.message.date) * 1000).toISOString() : null,
      phone: entity?.phone || undefined,
      canSend: !!canSend,
    }
  })
  return result.sort((a, b) => {
    if (a.type === 'channel' && b.type !== 'channel') return -1
    if (a.type !== 'channel' && b.type === 'channel') return 1
    if (a.type === 'channel' && b.type === 'channel') {
      if (a.canSend !== b.canSend) return a.canSend ? -1 : 1
      return a.name.localeCompare(b.name)
    }
    return 0
  })
}

export async function getMessages(chatId: string, limit = 50): Promise<MessageInfo[]> {
  await ensureReady(activeUserId || '')
  const c = getClient()
  const peerId = Number(chatId)
  const messages = await c.getMessages(peerId, { limit })
  const me = await c.getMe()
  const myId = me?.id?.toString()
  return messages.map((m) => {
    const senderId = (m.fromId as any)?.userId?.toString()
      || (m.fromId as any)?.channelId?.toString()
      || (m.fromId as any)?.toString()
      || ''
    const isOut = m.out || senderId === myId
    return {
      id: m.id,
      fromId: isOut ? 'me' : senderId,
      text: m.message || '',
      date: new Date((m.date || 0) * 1000).toISOString(),
      out: isOut,
      media: m.media
        ? { type: m.media.className || 'unknown', caption: m.message || undefined }
        : null,
    }
  }).reverse()
}

export async function sendMessage(chatId: string, text: string): Promise<void> {
  await ensureReady(activeUserId || '')
  const c = getClient()
  const peerId = Number(chatId)
  await c.sendMessage(peerId, { message: text })
}

export async function sendMedia(chatId: string, filePath: string, caption?: string): Promise<void> {
  await ensureReady(activeUserId || '')
  const c = getClient()
  const peerId = Number(chatId)
  try {
    await c.sendFile(peerId, { file: filePath, caption })
  } finally {
    try { fs.unlinkSync(filePath) } catch { /* ignore */ }
  }
}

export async function syncContactsAndDialogs(userId: string): Promise<{ contacts: number; conversations: number }> {
  await ensureReady(userId)
  const c = getClient()
  const dialogs = await c.getDialogs({ limit: 100 })
  let contactsCount = 0
  let conversationsCount = 0

  for (const d of dialogs) {
    const entity = d.entity as any
    const tgId = d.id?.toString()
    if (!tgId) continue

    await prisma.telegramConversation.upsert({
      where: { tgId_userId: { tgId, userId } },
      update: {
        name: d.name || d.title || 'Unknown',
        type: d.isUser ? 'user' : d.isGroup ? 'group' : 'channel',
        unreadCount: d.unreadCount,
        lastMessage: d.message?.message || null,
        lastMessageAt: d.message?.date ? new Date(d.message.date * 1000) : undefined,
        lastSyncAt: new Date(),
      },
      create: {
        tgId,
        userId,
        name: d.name || d.title || 'Unknown',
        type: d.isUser ? 'user' : d.isGroup ? 'group' : 'channel',
        unreadCount: d.unreadCount,
        lastMessage: d.message?.message || null,
        lastMessageAt: d.message?.date ? new Date(d.message.date * 1000) : null,
      },
    })
    conversationsCount++

    if (d.isUser && entity) {
      const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || d.name || 'Unknown'
      const phone = entity.phone || ''
      const username = entity.username || ''
      await prisma.telegramContact.upsert({
        where: { tgId_userId: { tgId, userId } },
        update: { name, phone, username, lastSyncAt: new Date() },
        create: { tgId, userId, name, phone, username },
      })
      contactsCount++
    }
  }

  log('info', 'telegram', 'Synced contacts and dialogs', { userId, contacts: contactsCount, conversations: conversationsCount })
  return { contacts: contactsCount, conversations: conversationsCount }
}

export async function findContactId(userId: string, name: string): Promise<string | null> {
  const lowered = name.toLowerCase().replace(/^@/, '')
  const contact = await prisma.telegramContact.findFirst({
    where: {
      userId,
      OR: [
        { name: { contains: lowered } },
        { phone: { contains: lowered } },
        { username: { contains: lowered } },
      ],
    },
  })
  if (contact) return contact.tgId
  const conv = await prisma.telegramConversation.findFirst({
    where: { userId, name: { contains: lowered } },
  })
  return conv?.tgId || null
}

export async function sendToContact(userId: string, contactName: string, text: string, filePath?: string): Promise<void> {
  const tgId = await findContactId(userId, contactName)
  if (!tgId) throw new Error(`Contact "${contactName}" not found. Sync contacts first.`)
  if (filePath) {
    await sendMedia(tgId, filePath, text || undefined)
  } else {
    await sendMessage(tgId, text)
  }
}

export async function findChannelId(name: string): Promise<{ id: string; name: string; canSend: boolean } | null> {
  const channels = await getChannels()
  const match = channels.find(c => c.name.toLowerCase() === name.toLowerCase())
  if (match) return match
  const partial = channels.find(c => c.name.toLowerCase().includes(name.toLowerCase()))
  return partial || null
}

export async function sendToChannel(channelId: string, text: string, filePath?: string): Promise<void> {
  await ensureReady(activeUserId || '')
  const c = getClient()
  const peerId = Number(channelId)
  if (filePath) {
    try {
      await c.sendFile(peerId, { file: filePath, caption: text || undefined })
    } finally {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
  } else {
    await c.sendMessage(peerId, { message: text })
  }
}

export async function getChannels(): Promise<Array<{ name: string; id: string; canSend: boolean }>> {
  const dialogs = await getDialogs()
  return dialogs
    .filter((d) => d.type === 'channel')
    .map((d) => ({ name: d.name, id: d.id, canSend: d.canSend }))
    .sort((a, b) => {
      if (a.canSend !== b.canSend) return a.canSend ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function getMyBots(): Promise<Array<{ name: string; username?: string }>> {
  await ensureReady(activeUserId || '')
  const c = getClient()
  const dialogs = await c.getDialogs({ limit: 100 })
  const bots: Array<{ name: string; username?: string }> = []
  for (const d of dialogs) {
    const entity = d.entity as any
    if (d.isUser && entity?.bot && entity?.botCanEdit) {
      const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || d.name || 'Unknown'
      bots.push({ name, username: entity.username || undefined })
    }
  }
  return bots
}
