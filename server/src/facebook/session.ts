import type { BrowserContext } from 'playwright'
import { log } from '../utils/logger'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export class CookieManager {
  constructor(private dataDir: string) {}

  private filePath(email: string): string {
    const hash = crypto.createHash('md5').update(email).digest('hex')
    return path.join(this.dataDir, `fb_cookies_${hash}.json`)
  }

  async save(context: BrowserContext, email: string): Promise<void> {
    try {
      const cookies = await context.cookies()
      const fbCookies = cookies.filter(c => c.domain.includes('facebook.com'))
      const data = { cookies: fbCookies, savedAt: Date.now() }
      const file = this.filePath(email)
      const dir = path.dirname(file)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, JSON.stringify(data, null, 2))
      log('info', 'meta_api', `fb: saved ${fbCookies.length} cookies`, { file })
    } catch (err) {
      log('warn', 'meta_api', 'fb: failed to save cookies', { error: (err as Error).message })
    }
  }

  async tryRestore(context: BrowserContext, email: string): Promise<boolean> {
    try {
      const file = this.filePath(email)
      if (!fs.existsSync(file)) return false
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      if (!raw.cookies || raw.cookies.length === 0) return false
      await context.addCookies(raw.cookies)
      log('info', 'meta_api', `fb: restored ${raw.cookies.length} cookies`, { file })
      return true
    } catch (err) {
      log('warn', 'meta_api', 'fb: cookie restore failed', { error: (err as Error).message })
      return false
    }
  }
}
