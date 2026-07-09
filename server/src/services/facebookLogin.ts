import puppeteer from 'puppeteer'
import { env } from '../config/env'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

interface LoginResult {
  success: boolean
  pages?: Array<{ pageId: string; pageName: string; accessToken: string }>
  error?: string
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

  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
    )

    const redirectUri = 'https://www.facebook.com/connect/login_success.html'
    const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'

    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}`

    await page.goto(oauthUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    await page.waitForSelector('#email', { timeout: 10000 })
    await page.type('#email', email)
    await page.type('#pass', password)
    await page.click('#loginbutton')

    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {})

    const currentUrl = page.url()

    if (currentUrl.includes('login_attempt')) {
      return { success: false, error: 'Facebook login failed. Check email/password or handle 2FA manually.' }
    }

    let shortLivedToken = ''
    const fragmentMatch = currentUrl.match(/access_token=([^&]+)/)
    if (fragmentMatch) {
      shortLivedToken = fragmentMatch[1]
    }

    if (!shortLivedToken) {
      const consentButton = await page.$('[name="__CONFIRM__"], button[type="submit"], input[value*="Continue"]')
      if (consentButton) {
        await consentButton.click()
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {})
        const afterConsentUrl = page.url()
        const afterMatch = afterConsentUrl.match(/access_token=([^&]+)/)
        if (afterMatch) shortLivedToken = afterMatch[1]
      }
    }

    if (!shortLivedToken) {
      return { success: false, error: 'Could not obtain access token from login flow.' }
    }

    const exchangeResult = await graphPost('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    })

    const longLivedToken = exchangeResult.access_token
    if (!longLivedToken) {
      return { success: false, error: 'Failed to exchange for long-lived token.' }
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
