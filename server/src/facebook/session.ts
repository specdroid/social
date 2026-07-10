import type { BrowserContext } from 'playwright'
import { log } from '../utils/logger'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

interface StoredSession {
  cookies: any[]
  savedAt: number
}

function deriveKey(): Buffer {
  const secret = process.env.FB_SESSION_KEY || process.env.JWT_SECRET || 'default-fb-session-key-32chars!!'
  return crypto.createHash('sha256').update(secret).digest()
}

function encrypt(text: string): string {
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return iv.toString('hex') + ':' + encrypted + ':' + tag
}

function decrypt(encoded: string): string {
  const parts = encoded.split(':')
  const iv = Buffer.from(parts[0], 'hex')
  const encrypted = parts[1]
  const authTag = Buffer.from(parts[2], 'hex')
  const key = deriveKey()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

export class SessionManager {
  async saveCookies(context: BrowserContext, email: string): Promise<void> {
    try {
      const cookies = await context.cookies()
      const data: StoredSession = { cookies, savedAt: Date.now() }
      const encrypted = encrypt(JSON.stringify(data))
      await prisma.facebookSession.upsert({
        where: { email },
        update: { cookies: encrypted, updatedAt: new Date() },
        create: { email, cookies: encrypted },
      })
      log('info', 'meta_api', 'fb: session saved', { email, cookieCount: cookies.length })
    } catch (err) {
      log('warn', 'meta_api', 'fb: failed to save session', { error: (err as Error).message })
    }
  }

  async tryRestore(context: BrowserContext, email: string): Promise<boolean> {
    try {
      const row = await prisma.facebookSession.findUnique({ where: { email } })
      if (!row || !row.cookies) return false

      const parsed: StoredSession = JSON.parse(decrypt(row.cookies))
      if (!parsed.cookies || parsed.cookies.length === 0) return false

      await context.addCookies(parsed.cookies)
      log('info', 'meta_api', 'fb: session restored', { email, cookieCount: parsed.cookies.length })
      return true
    } catch (err) {
      log('warn', 'meta_api', 'fb: session restore failed', { error: (err as Error).message })
      return false
    }
  }

  async clearSession(email: string): Promise<void> {
    try {
      await prisma.facebookSession.delete({ where: { email } }).catch(() => {})
    } catch {}
  }
}
