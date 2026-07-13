import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram'
import { computeCheck } from 'telegram/Password'
import { env } from '../config/env'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

let client: TelegramClient | null = null
let stringSession: StringSession | null = null
let loginPhone = ''
let loginPhoneCodeHash = ''

export interface TelegramStatus {
  connected: boolean
  phone: string | null
}

function getClient(): TelegramClient {
  if (!client) throw new Error('Telegram client not initialised')
  return client
}

async function loadSession(): Promise<string> {
  try {
    const record = await prisma.telegramSession.findFirst()
    return record?.session || ''
  } catch {
    return ''
  }
}

async function saveSession(phone: string) {
  const sessionStr = stringSession?.save() || ''
  const existing = await prisma.telegramSession.findFirst()
  if (existing) {
    await prisma.telegramSession.update({
      where: { id: existing.id },
      data: { session: sessionStr, phone, isLoggedIn: true },
    })
  } else {
    await prisma.telegramSession.create({
      data: { session: sessionStr, phone, isLoggedIn: true },
    })
  }
}

async function clearSession() {
  await prisma.telegramSession.deleteMany()
}

export async function initClient(): Promise<void> {
  if (client) return
  const sessionStr = await loadSession()
  stringSession = new StringSession(sessionStr)
  client = new TelegramClient(stringSession, env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    connectionRetries: 5,
  })
  await client.connect()
}

export async function sendCode(phone: string): Promise<void> {
  await initClient()
  const c = getClient()

  try {
    await c.invoke(new Api.updates.GetState())
    const me = await c.getMe()
    await saveSession(me?.phone || phone)
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

export async function signIn(code: string): Promise<{ success: boolean; passwordNeeded: boolean }> {
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
    await saveSession(me?.phone || loginPhone)
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

export async function checkPassword(password: string): Promise<void> {
  const c = getClient()

  const passwordSrpResult = await c.invoke(new Api.account.GetPassword())
  const passwordSrpCheck = await computeCheck(passwordSrpResult, password) as any
  await c.invoke(new Api.auth.CheckPassword({ password: passwordSrpCheck }))

  const me = await c.getMe()
  await saveSession(me?.phone || loginPhone)
  loginPhone = ''
  loginPhoneCodeHash = ''
}

export async function getStatus(): Promise<TelegramStatus> {
  try {
    await initClient()
    const c = getClient()
    await c.invoke(new Api.updates.GetState())
    const me = await c.getMe()
    return { connected: true, phone: me?.phone || null }
  } catch {
    return { connected: false, phone: null }
  }
}

export async function disconnectClient(): Promise<void> {
  if (client) {
    try { client.disconnect() } catch { /* ignore */ }
    try { client.destroy() } catch { /* ignore */ }
    client = null
  }
  stringSession = null
  loginPhone = ''
  loginPhoneCodeHash = ''
  await clearSession()
}
