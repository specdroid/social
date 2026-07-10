import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { log } from '../utils/logger'

export class BrowserManager {
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  async initialize(executablePath?: string): Promise<BrowserContext> {
    log('info', 'meta_api', 'fb: launching browser')
    this.browser = await chromium.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })
    this.context = await this.browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    })
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // @ts-ignore
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      // @ts-ignore
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    })
    log('info', 'meta_api', 'fb: browser launched')
    return this.context
  }

  async newPage(): Promise<Page> {
    if (!this.context) throw new Error('Browser not initialized')
    return this.context.newPage()
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      log('info', 'meta_api', 'fb: browser closed')
    }
  }

  getContext(): BrowserContext | null {
    return this.context
  }
}
