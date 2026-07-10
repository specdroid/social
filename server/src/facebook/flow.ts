import type { Page } from 'playwright'
import type { RequestCodeHelper, LoginResult } from './types'
import { log } from '../utils/logger'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

async function graphPost(endpoint: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params)
  const res = await fetch(`${GRAPH_API_BASE}${endpoint}`, { method: 'POST', body })
  return res.json()
}

export class Flow {
  private buildOAuthUrl(appId: string): string {
    const redirectUri = 'https://www.facebook.com/connect/login_success.html'
    const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'
    return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}&auth_type=rerequest`
  }

  async run(page: Page, email: string, password: string, requestCode?: RequestCodeHelper): Promise<LoginResult> {
    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    if (!appId || !appSecret) return { success: false, error: 'META_APP_ID and META_APP_SECRET must be set in .env' }

    const oauthUrl = this.buildOAuthUrl(appId)

    // 1. Navigate to OAuth — if cookies are valid, we'll see consent/token directly
    log('info', 'meta_api', 'fb: navigating to OAuth URL')
    await page.goto(oauthUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)

    // 2. If login page shown → need to authenticate
    if (page.url().includes('login.php') || page.url().includes('checkpoint')) {
      log('info', 'meta_api', 'fb: login page detected, starting mobile login')
      const loginOk = await this.mobileLogin(page, email, password, requestCode)
      if (!loginOk) return { success: false, error: 'Login failed — still on login/checkpoint page after authentication' }

      // Retry OAuth after login
      log('info', 'meta_api', 'fb: retrying OAuth after login')
      await page.goto(oauthUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(3000)
    }

    // 3. Handle consent page & extract token
    log('info', 'meta_api', 'fb: handling consent page')
    const shortLivedToken = await this.waitForConsent(page, requestCode)
    if (!shortLivedToken) return { success: false, error: 'Could not obtain token from OAuth consent page' }

    // 4. Exchange for long-lived token and fetch pages
    log('info', 'meta_api', 'fb: exchanging for long-lived token')
    return this.exchangeAndFetch(shortLivedToken, appId, appSecret)
  }

  private async mobileLogin(page: Page, email: string, password: string, requestCode?: RequestCodeHelper): Promise<boolean> {
    log('info', 'meta_api', 'fb: navigating to mobile login')
    await page.goto('https://m.facebook.com/login.php', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)

    log('info', 'meta_api', 'fb: filling credentials')
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="pass"]', password)

    // Click Log in — mobile site uses a button or div[role="button"]
    const loginBtn = page.locator('button[name="login"], div[role="button"]:has-text("Log in")')
    await loginBtn.first().click()
    await page.waitForTimeout(5000)

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2000)

    const url = page.url()
    log('info', 'meta_api', 'fb: after login URL', { url })

    // Check if stuck on login/checkpoint/captcha page
    if (url.includes('login') || url.includes('checkpoint') || url.includes('captcha') || url.includes('two_step')) {
      if (!requestCode) return false
      const tunnelUrl = process.env.FB_TUNNEL_URL || 'VNC URL not configured (set FB_TUNNEL_URL in .env)'
      await requestCode.screenshot(page, `🔐 Security check detected. Open ${tunnelUrl} on your phone to solve it, then reply "done"`)
      log('info', 'meta_api', 'fb: waiting for user to solve CAPTCHA via VNC')
      await requestCode.get(page, url)

      // Wait for navigation after CAPTCHA solved
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(3000)

      const afterUrl = page.url()
      log('info', 'meta_api', 'fb: after CAPTCHA URL', { afterUrl })
      if (afterUrl.includes('login') || afterUrl.includes('checkpoint') || afterUrl.includes('captcha')) {
        log('warn', 'meta_api', 'fb: still on login/checkpoint after CAPTCHA')
        return false
      }
    }

    return true
  }

  private async waitForConsent(page: Page, requestCode?: RequestCodeHelper): Promise<string> {
    const maxAttempts = 5

    for (let i = 0; i < maxAttempts; i++) {
      // Check token in URL
      const token = this.extractToken(page)
      if (token) return token

      // Check for consent buttons
      const buttons = page.locator('button, input[type="submit"], [role="button"], a[role="button"]')
      const count = await buttons.count()
      for (let j = 0; j < count; j++) {
        const text = (await buttons.nth(j).textContent() || '').trim().toLowerCase()
        const cls = (await buttons.nth(j).getAttribute('class') || '').toLowerCase()
        log('info', 'meta_api', `fb: consent btn i=${i} j=${j}`, { text: text.slice(0, 80), class: cls.slice(0, 80) })

        if (
          text.includes('continue') || text.includes('allow') || text.includes('connect') ||
          text.includes('log in') || text.includes('yes') ||
          cls.includes('confirm') || (text && !cls.includes('cancel'))
        ) {
          log('info', 'meta_api', 'fb: clicking consent button')
          await buttons.nth(j).click().catch(() => {})
          await page.waitForTimeout(3000)
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
          await page.waitForTimeout(1000)

          const t2 = this.extractToken(page)
          if (t2) return t2

          if (page.url().includes('login_success.html')) {
            const h = await page.evaluate('window.location.hash').catch(() => '') as string
            const hm = h.match(/access_token=([^&]+)/)
            if (hm) return hm[1]
          }
          break
        }
      }

      await page.waitForTimeout(2000)
    }

    // Fallback: ask user to manually click via VNC
    if (requestCode) {
      log('warn', 'meta_api', 'fb: consent button not found automatically, asking user')
      await requestCode.screenshot(page, '⚠️ Consent button not found. Click "Continue" or "Log in" in the browser via VNC, then reply "done"')
      await requestCode.get(page, page.url())
      const t = this.extractToken(page)
      if (t) return t
      if (page.url().includes('login_success.html')) {
        const h = await page.evaluate('window.location.hash').catch(() => '') as string
        const hm = h.match(/access_token=([^&]+)/)
        if (hm) return hm[1]
      }
    }

    return ''
  }

  private extractToken(page: Page): string {
    const urlMatch = page.url().match(/access_token=([^&]+)/)
    if (urlMatch) return urlMatch[1]
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
      log('error', 'meta_api', 'fb: token exchange failed', { response: exchangeResult })
      return { success: false, error: `Token exchange failed: ${JSON.stringify(exchangeResult)}` }
    }

    log('info', 'meta_api', 'fb: fetching pages list')
    const pagesResult = await graphPost('/me/accounts', { access_token: longLivedToken })

    if (!pagesResult.data || pagesResult.data.length === 0) {
      log('error', 'meta_api', 'fb: no pages found', { response: pagesResult })
      return { success: false, error: 'No Facebook pages found for this token' }
    }

    const pages = pagesResult.data.map((p: any) => ({
      pageId: p.id,
      pageName: p.name || '',
      accessToken: p.access_token,
    }))

    log('info', 'meta_api', 'fb: login complete', { pageCount: pages.length })
    return { success: true, pages }
  }
}
