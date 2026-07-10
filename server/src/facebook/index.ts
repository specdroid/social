import type { RequestCodeHelper, LoginResult } from './types'
import { Flow } from './flow'
import { CookieManager } from './session'
import { log } from '../utils/logger'
import { chromium } from 'playwright'
import path from 'path'

const CDP_URL = process.env.FB_CDP_URL || 'http://127.0.0.1:9336'
const DATA_DIR = path.resolve(__dirname, '../../data')

export type { RequestCodeHelper, LoginResult } from './types'

export async function facebookLogin(email: string, password: string, requestCode?: RequestCodeHelper): Promise<LoginResult> {
  log('info', 'meta_api', 'fb: starting login via CDP', { email, cdpUrl: CDP_URL })

  const flow = new Flow()
  const cookies = new CookieManager(DATA_DIR)

  try {
    log('info', 'meta_api', 'fb: connecting to CDP browser')
    const browser = await chromium.connectOverCDP(CDP_URL)
    const context = browser.contexts()[0] || await browser.newContext()
    const pages = context.pages()
    const page = pages[0] || await context.newPage()
    log('info', 'meta_api', 'fb: connected to CDP browser')

    // Try restoring saved cookies
    const restored = await cookies.tryRestore(context, email)
    if (restored) log('info', 'meta_api', 'fb: cookies restored')

    const result = await flow.run(page, email, password, requestCode)

    if (result.success) {
      await cookies.save(context, email)
    }

    return result
  } catch (err) {
    log('error', 'meta_api', 'fb: login failed', { error: (err as Error).message })
    return { success: false, error: `Login failed: ${(err as Error).message}` }
  }
}
