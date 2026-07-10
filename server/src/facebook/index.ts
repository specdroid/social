import type { RequestCodeHelper, LoginResult } from './types'
import { BrowserManager } from './browser'
import { SessionManager } from './session'
import { HumanSimulator } from './human'
import { LoginFlow } from './flow'
import { log } from '../utils/logger'
import { existsSync } from 'fs'

export type { RequestCodeHelper, LoginResult } from './types'

function findChrome(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ]
  return candidates.find(p => p && existsSync(p))
}

export async function facebookLogin(email: string, password: string, requestCode?: RequestCodeHelper): Promise<LoginResult> {
  log('info', 'meta_api', 'fb: starting login', { email })
  const browser = new BrowserManager()
  const session = new SessionManager()
  const human = new HumanSimulator()
  const flow = new LoginFlow(human)

  try {
    const context = await browser.initialize(findChrome())
    const page = await browser.newPage()

    // Try restoring saved session cookies
    const restored = await session.tryRestore(context, email)
    if (restored) {
      log('info', 'meta_api', 'fb: session restored, checking if valid')
    }

    const result = await flow.run(page, email, password, requestCode)

    // Save session on success
    if (result.success) {
      await session.saveCookies(context, email)
    }

    return result
  } catch (err) {
    log('error', 'meta_api', 'fb: login failed', { error: (err as Error).message })
    return { success: false, error: `Login automation failed: ${(err as Error).message}` }
  } finally {
    await browser.close()
  }
}
