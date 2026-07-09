import puppeteer from 'puppeteer'
import { env } from '../config/env'
import { existsSync } from 'fs'
import { log } from '../utils/logger'

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
  log('info', 'meta_api', 'fb_login: starting', { executablePath })

  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })
    log('info', 'meta_api', 'fb_login: browser launched')

    const page = await browser.newPage()

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.0 Mobile Safari/537.36'
    )
    await page.setViewport({ width: 412, height: 915 })

    const redirectUri = 'https://www.facebook.com/connect/login_success.html'
    const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'

    const oauthUrl = `https://m.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}&auth_type=rerequest`

    log('info', 'meta_api', 'fb_login: navigating to OAuth URL')
    await page.goto(oauthUrl, { waitUntil: 'networkidle0', timeout: 30000 })
    log('info', 'meta_api', 'fb_login: page loaded', { url: page.url(), title: await page.title() })

    const currentUrl = page.url()

    const emailField = await page.waitForSelector('input[name="email"]', { timeout: 15000 }).catch(() => null)
    if (!emailField) {
      log('warn', 'meta_api', 'fb_login: email field not found', { url: currentUrl, title: await page.title() })
      return {
        success: false,
        error: `Could not find login form on Facebook. Current URL: ${currentUrl}, Page title: ${await page.title()}`,
      }
    }
    log('info', 'meta_api', 'fb_login: email field found, typing')

    await emailField.type(email, { delay: 30 })

    const passField = await page.waitForSelector('input[name="pass"]', { timeout: 5000 }).catch(() => null)
    if (passField) {
      log('info', 'meta_api', 'fb_login: pass field found, typing')
      await passField.type(password, { delay: 30 })
    }

    log('info', 'meta_api', 'fb_login: pressing Enter to submit')
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
      page.keyboard.press('Enter'),
    ])

    await new Promise(r => setTimeout(r, 3000))
    log('info', 'meta_api', 'fb_login: after submit', { url: page.url(), title: await page.title() })

    let finalUrl = page.url()

    if (finalUrl.includes('login_attempt') || finalUrl.includes('checkpoint')) {
      log('warn', 'meta_api', 'fb_login: login checkpoint triggered')
      return { success: false, error: 'Facebook login failed or checkpoint triggered. Check email/password or handle 2FA manually.' }
    }

    let shortLivedToken = ''
    const fragmentMatch = finalUrl.match(/access_token=([^&]+)/)
    if (fragmentMatch) {
      shortLivedToken = fragmentMatch[1]
      log('info', 'meta_api', 'fb_login: token found in URL')
    } else {
      const urlHash = await page.evaluate('window.location.hash') as string
      log('info', 'meta_api', 'fb_login: checking hash', { hash: urlHash.slice(0, 80) })
      const hashMatch = urlHash.match(/access_token=([^&]+)/)
      if (hashMatch) shortLivedToken = hashMatch[1]
    }

    const waitForConsent = async (): Promise<string> => {
      log('info', 'meta_api', 'fb_login: waiting for consent button')
      for (let i = 0; i < 15; i++) {
        const btn = await page.$(
          'button[type="submit"], ' +
          'input[type="submit"], ' +
          '[name="__CONFIRM__"], ' +
          'a[href*="consent"], ' +
          '[data-testid*="accept"], ' +
          '[ajaxify*="consent"], ' +
          'form[action*="consent"] button, ' +
          'form button:first-child'
        )
        if (btn) {
          const btnTag = await page.evaluate((el) => `${el.tagName}.${el.className}`, btn).catch(() => '?')
          log('info', 'meta_api', `fb_login: consent button found at attempt ${i + 1}`, { tag: btnTag })
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}),
            btn.click().catch(() => {}),
          ])
          await new Promise(r => setTimeout(r, 1000))
          const u = page.url()
          log('info', 'meta_api', 'fb_login: after consent click', { url: u, title: await page.title() })
          const m = u.match(/access_token=([^&]+)/)
          if (m) return m[1]
          const h = await page.evaluate('window.location.hash') as string
          const hm = h.match(/access_token=([^&]+)/)
          if (hm) return hm[1]
        }
        await new Promise(r => setTimeout(r, 1000))
      }
      log('warn', 'meta_api', 'fb_login: consent button not found after 15 attempts')
      return ''
    }

    if (!shortLivedToken) {
      shortLivedToken = await waitForConsent()
    }

    if (!shortLivedToken) {
      const finalHash = await page.evaluate('window.location.hash') as string
      log('warn', 'meta_api', 'fb_login: failed to obtain token', { finalUrl, hash: finalHash, title: await page.title() })
      return {
        success: false,
        error: `Could not obtain access token. Final URL: ${finalUrl}, Hash: ${finalHash}, Page title: ${await page.title()}`,
      }
    }

    log('info', 'meta_api', 'fb_login: exchanging for long-lived token')
    const exchangeResult = await graphPost('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    })

    const longLivedToken = exchangeResult.access_token
    if (!longLivedToken) {
      log('warn', 'meta_api', 'fb_login: token exchange failed', { exchangeResult })
      return { success: false, error: `Failed to exchange for long-lived token: ${JSON.stringify(exchangeResult)}` }
    }

    log('info', 'meta_api', 'fb_login: fetching pages')
    const accountsResult = await graphPost('/me/accounts', {
      access_token: longLivedToken,
    })

    const pages = accountsResult.data
    if (!pages || pages.length === 0) {
      log('warn', 'meta_api', 'fb_login: no pages found')
      return { success: false, error: 'No Facebook pages found for this account.' }
    }

    const resultPages = pages.map((p: any) => ({
      pageId: p.id,
      pageName: p.name || 'Unknown',
      accessToken: p.access_token,
    }))

    log('info', 'meta_api', 'fb_login: success', { pageCount: resultPages.length })
    return { success: true, pages: resultPages }
  } catch (err) {
    log('error', 'meta_api', 'fb_login: automation failed', { error: (err as Error).message })
    return { success: false, error: `Login automation failed: ${(err as Error).message}` }
  } finally {
    if (browser) {
      await browser.close()
      log('info', 'meta_api', 'fb_login: browser closed')
    }
  }
}
