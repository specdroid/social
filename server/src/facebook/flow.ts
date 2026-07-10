import type { Page } from 'playwright'
import type { RequestCodeHelper, LoginResult } from './types'
import { HumanSimulator } from './human'
import { log } from '../utils/logger'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

async function graphPost(endpoint: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params)
  const res = await fetch(`${GRAPH_API_BASE}${endpoint}`, { method: 'POST', body })
  return res.json()
}

export class LoginFlow {
  constructor(private human: HumanSimulator) {}

  async run(page: Page, email: string, password: string, requestCode?: RequestCodeHelper): Promise<LoginResult> {
    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET

    if (!appId || !appSecret) {
      return { success: false, error: 'META_APP_ID and META_APP_SECRET must be set in .env' }
    }

    const redirectUri = 'https://www.facebook.com/connect/login_success.html'
    const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'
    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}&auth_type=rerequest`

    log('info', 'meta_api', 'fb: navigating to OAuth URL')
    await page.goto(oauthUrl, { waitUntil: 'networkidle', timeout: 30000 })
    log('info', 'meta_api', 'fb: OAuth page loaded', { url: page.url(), title: await page.title() })

    // Try to extract token from URL (works if session cookies restored)
    let shortLivedToken = await this.extractToken(page)
    if (shortLivedToken) {
      log('info', 'meta_api', 'fb: token from URL (session valid)')
      return this.exchangeAndFetch(shortLivedToken, appId, appSecret)
    }

    // Fill login form
    log('info', 'meta_api', 'fb: filling login form')
    const filled = await this.fillForm(page, email, password)
    if (!filled) {
      const text = await page.evaluate("document.body?.innerText?.slice(0, 500) || ''") as string
      log('warn', 'meta_api', 'fb: email field not found', { url: page.url(), text: text.slice(0, 200) })
      return { success: false, error: 'Could not find email field on login page.' }
    }

    await page.keyboard.press('Enter')
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 3000))

    const afterUrl = page.url()
    log('info', 'meta_api', 'fb: after submit', { url: afterUrl, title: await page.title() })

    // Check for token in URL after login
    shortLivedToken = await this.extractToken(page)
    if (shortLivedToken) {
      return this.exchangeAndFetch(shortLivedToken, appId, appSecret)
    }

    // Handle 2FA if present
    if (afterUrl.includes('two_step_verification')) {
      const result = await this.handle2FA(page, afterUrl, requestCode)
      if (result) return result
      shortLivedToken = await this.extractToken(page)
      if (shortLivedToken) {
        return this.exchangeAndFetch(shortLivedToken, appId, appSecret)
      }
    }

    // Handle consent page
    if (!shortLivedToken) {
      shortLivedToken = await this.waitForConsent(page)
    }

    if (!shortLivedToken) {
      if (page.url().includes('two_step_verification')) {
        return { success: false, error: requestCode ? 'Invalid 2FA code.' : 'Two-factor authentication (2FA) is enabled.' }
      }
      const finalHash = await page.evaluate('window.location.hash').catch(() => '') as string
      log('warn', 'meta_api', 'fb: failed to obtain token', { url: page.url(), hash: finalHash })
      return { success: false, error: 'Could not obtain access token.' }
    }

    return this.exchangeAndFetch(shortLivedToken, appId, appSecret)
  }

  private async extractToken(page: Page): Promise<string> {
    const urlMatch = page.url().match(/access_token=([^&]+)/)
    if (urlMatch) return urlMatch[1]
    const hash = await page.evaluate('window.location.hash').catch(() => '') as string
    if (!hash) return ''
    const hashMatch = hash.match(/access_token=([^&]+)/)
    return hashMatch ? hashMatch[1] : ''
  }

  private async fillForm(page: Page, email: string, password: string): Promise<boolean> {
    const emailLoc = page.locator('#email')
    try {
      await emailLoc.waitFor({ state: 'attached', timeout: 10000 })
    } catch {
      try {
        await page.locator('input[name="email"]').waitFor({ state: 'attached', timeout: 5000 })
      } catch {
        return false
      }
    }
    await this.human.typeText(page, '#email', email)

    const passLoc = page.locator('#pass')
    try {
      await passLoc.waitFor({ state: 'attached', timeout: 5000 })
    } catch {
      try {
        await page.locator('input[name="pass"]').waitFor({ state: 'attached', timeout: 3000 })
      } catch {}
    }
    await page.fill('#pass', password).catch(() => page.fill('input[name="pass"]', password).catch(() => {}))
    return true
  }

  private async handle2FA(page: Page, currentUrl: string, requestCode?: RequestCodeHelper): Promise<LoginResult | null> {
    for (let attempt = 0; attempt < 3 && page.url().includes('two_step_verification'); attempt++) {
      const url = page.url()
      log('info', 'meta_api', `fb: 2FA attempt ${attempt}`, { url })

      if (url.includes('two_step_verification/two_factor/') && url.includes('flow=two_factor_login')) {
        if (!requestCode) {
          return { success: false, error: 'Facebook sent a login confirmation to your phone. Approve it and retry.' }
        }
        log('info', 'meta_api', 'fb: asking user to confirm on phone')
        const instruction = await requestCode.get(page, url)
        await new Promise(r => setTimeout(r, 3000))

        if (/try\s*(another|different)\s*way/.test(instruction.toLowerCase())) {
          log('info', 'meta_api', 'fb: clicking "Try another way"')
          await this.clickTryAnotherWay(page)

          const radioCount = await page.locator('input[type="radio"]').count()
          if (radioCount > 0) {
            log('info', 'meta_api', `fb: ${radioCount} radio options, selecting the last one`)
            await page.locator('input[type="radio"]').last().click()
            await new Promise(r => setTimeout(r, 3000))
            await this.clickContinue(page)
          }
        } else {
          log('info', 'meta_api', 'fb: using waitForConsent')
          await this.waitForConsent(page)
        }

        await requestCode.screenshot(page, '📸 After clicking the button')

        if (page.url().includes('two_step_verification/two_factor/') && page.url().includes('flow=two_factor_login')) {
          for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 7000))
            await requestCode.screenshot(page, `📸 ${5 + (i + 1) * 7}s after click`)
          }
          return { success: false, error: 'Page did not advance after clicking the button.' }
        }

      } else if (url.includes('two_step_verification/authentication/') || url.includes('approvals_code')) {
        if (!requestCode) {
          return { success: false, error: 'Two-factor authentication code required.' }
        }
        log('info', 'meta_api', 'fb: requesting 2FA code')
        const code = await requestCode.get(page, url)
        log('info', 'meta_api', 'fb: entering code')
        const ok = await this.enterCode(page, code)
        if (!ok) {
          return { success: false, error: 'Invalid 2FA code.' }
        }
        log('info', 'meta_api', 'fb: 2FA passed')
        return null

      } else {
        return { success: false, error: `Unexpected 2FA page: ${url}` }
      }

      await new Promise(r => setTimeout(r, 2000))
    }
    return null
  }

  private async clickTryAnotherWay(page: Page): Promise<void> {
    try {
      await page.getByRole('button', { name: /try another way/i }).click()
    } catch {
      try {
        await page.getByText('Try another way', { exact: false }).click()
      } catch {}
    }
    await new Promise(r => setTimeout(r, 3000))
  }

  private async clickContinue(page: Page): Promise<void> {
    try {
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
    } catch {
      try {
        await page.locator('button:has-text("Continue")').click()
      } catch {
        log('info', 'meta_api', 'fb: pressing Enter for Continue')
        await page.keyboard.press('Enter')
      }
    }
    await new Promise(r => setTimeout(r, 5000))
  }

  private async enterCode(page: Page, code: string): Promise<boolean> {
    let loc = page.locator('input[type="text"], input[type="tel"], input[autocomplete="one-time-code"]')
    try {
      await loc.waitFor({ state: 'attached', timeout: 5000 })
    } catch {
      loc = page.locator('#approvals_code')
      try {
        await loc.waitFor({ state: 'attached', timeout: 3000 })
      } catch {
        return false
      }
    }
    await loc.fill(code)
    await new Promise(r => setTimeout(r, 300))
    await page.keyboard.press('Enter')
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 3000))
    return !page.url().includes('two_step_verification')
  }

  private async waitForConsent(page: Page): Promise<string> {
    log('info', 'meta_api', 'fb: waiting for consent button')
    for (let i = 0; i < 3; i++) {
      const token = await this.extractToken(page)
      if (token) return token

      const buttons = page.locator('button, input[type="submit"], [role="button"], a[role="button"]')
      const count = await buttons.count()
      for (let j = 0; j < count; j++) {
        const text = (await buttons.nth(j).textContent() || '').trim().toLowerCase()
        const cls = (await buttons.nth(j).getAttribute('class') || '')
        log('info', 'meta_api', `fb: consent button i=${i} j=${j}`, { text: text.slice(0, 80), class: cls.slice(0, 80) })
        if (
          text.includes('continue') || text.includes('allow') || text.includes('connect') ||
          text.includes('yes') || text.includes('this was me') || cls.includes('confirm') ||
          text.includes('log in') ||
          (text && !cls.includes('cancel'))
        ) {
          log('info', 'meta_api', 'fb: clicking consent button')
          await buttons.nth(j).click().catch(() => {})
          await new Promise(r => setTimeout(r, 3000))
          const token2 = await this.extractToken(page)
          if (token2) return token2
          if (page.url().includes('login_success.html')) {
            const h = await page.evaluate('window.location.hash').catch(() => '') as string
            const hm = h.match(/access_token=([^&]+)/)
            if (hm) return hm[1]
          }
          break
        }
      }
      await new Promise(r => setTimeout(r, 2000))
    }
    log('warn', 'meta_api', 'fb: consent button not found after 3 attempts')
    return ''
  }

  private async exchangeAndFetch(shortLivedToken: string, appId: string, appSecret: string): Promise<LoginResult> {
    log('info', 'meta_api', 'fb: exchanging for long-lived token')
    const exchangeResult = await graphPost('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    })

    const longLivedToken = exchangeResult.access_token
    if (!longLivedToken) {
      log('warn', 'meta_api', 'fb: token exchange failed', { exchangeResult })
      return { success: false, error: `Failed to exchange for long-lived token: ${JSON.stringify(exchangeResult)}` }
    }

    log('info', 'meta_api', 'fb: fetching pages')
    const accountsResult = await graphPost('/me/accounts', { access_token: longLivedToken })
    const pages = accountsResult.data
    if (!pages || pages.length === 0) {
      log('warn', 'meta_api', 'fb: no pages found')
      return { success: false, error: 'No Facebook pages found for this account.' }
    }

    const resultPages = pages.map((p: any) => ({
      pageId: p.id,
      pageName: p.name || 'Unknown',
      accessToken: p.access_token,
    }))

    log('info', 'meta_api', 'fb: success', { pageCount: resultPages.length })
    return { success: true, pages: resultPages }
  }
}
