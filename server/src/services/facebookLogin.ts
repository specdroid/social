import puppeteer from 'puppeteer'
import { env } from '../config/env'
import { existsSync } from 'fs'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

interface LoginResult {
  success: boolean
  pages?: Array<{ pageId: string; pageName: string; accessToken: string }>
  error?: string
}

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

async function graphPost(endpoint: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params)
  const res = await fetch(`${GRAPH_API_BASE}${endpoint}`, { method: 'POST', body })
  return res.json()
}

export async function facebookLogin(email: string, password: string): Promise<LoginResult> {
  const appId = env.META_APP_ID
  const appSecret = env.META_APP_SECRET

  if (!appId || !appSecret) {
    return { success: false, error: 'META_APP_ID and META_APP_SECRET must be set in .env' }
  }

  const executablePath = findChrome()

  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })

    const page = await browser.newPage()

    // Anti-detection: override navigator.webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1366, height: 768 })

    const redirectUri = 'https://www.facebook.com/connect/login_success.html'
    const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'

    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}&auth_type=rerequest`

    await page.goto(oauthUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    const currentUrl = page.url()
    const pageTitle = await page.title()

    // Try multiple selectors for the email field (Facebook varies by region)
    const emailSelectors = ['#email', 'input[name="email"]', 'input[autocomplete="username"]', 'input[type="text"]']
    let emailField = null
    for (const sel of emailSelectors) {
      emailField = await page.waitForSelector(sel, { timeout: 5000 }).catch(() => null)
      if (emailField) break
    }
    if (!emailField) {
      return {
        success: false,
        error: `Could not find login form on Facebook. Current URL: ${currentUrl}, Page title: ${pageTitle}`,
      }
    }

    await emailField.type(email, { delay: 50 })
    const passField = await page.$('#pass') || await page.$('input[autocomplete="current-password"]') || await page.$('input[type="password"]')
    if (passField) await passField.type(password, { delay: 50 })

    const loginBtn = await page.$('#loginbutton, button[type="submit"], input[type="submit"]')
    if (loginBtn) await loginBtn.click()

    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {})
    // Short wait for redirects/consent to settle
    await new Promise(r => setTimeout(r, 2000))

    let finalUrl = page.url()

    if (finalUrl.includes('login_attempt') || finalUrl.includes('checkpoint')) {
      return { success: false, error: 'Facebook login failed or checkpoint triggered. Check email/password or handle 2FA manually.' }
    }

    let shortLivedToken = ''
    const fragmentMatch = finalUrl.match(/access_token=([^&]+)/)
    if (fragmentMatch) {
      shortLivedToken = fragmentMatch[1]
    }

    // Handle consent screen if token not yet obtained
    if (!shortLivedToken) {
      const consentBtn = await page.$('[name="__CONFIRM__"], button[type="submit"], input[value*="Continue"]')
      if (consentBtn) {
        await consentBtn.click()
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {})
        await new Promise(r => setTimeout(r, 1000))
        finalUrl = page.url()
        const afterMatch = finalUrl.match(/access_token=([^&]+)/)
        if (afterMatch) shortLivedToken = afterMatch[1]
      }
    }

    if (!shortLivedToken) {
      return { success: false, error: `Could not obtain access token. Final URL: ${finalUrl}` }
    }

    const exchangeResult = await graphPost('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    })

    const longLivedToken = exchangeResult.access_token
    if (!longLivedToken) {
      return { success: false, error: `Failed to exchange for long-lived token: ${JSON.stringify(exchangeResult)}` }
    }

    const accountsResult = await graphPost('/me/accounts', {
      access_token: longLivedToken,
    })

    const pages = accountsResult.data
    if (!pages || pages.length === 0) {
      return { success: false, error: 'No Facebook pages found for this account.' }
    }

    const resultPages = pages.map((p: any) => ({
      pageId: p.id,
      pageName: p.name || 'Unknown',
      accessToken: p.access_token,
    }))

    return { success: true, pages: resultPages }
  } catch (err) {
    return { success: false, error: `Login automation failed: ${(err as Error).message}` }
  } finally {
    if (browser) await browser.close()
  }
}
