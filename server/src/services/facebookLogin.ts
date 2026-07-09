import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Page } from 'puppeteer'
import { env } from '../config/env'
import { existsSync } from 'fs'
import { log } from '../utils/logger'

puppeteer.use(StealthPlugin())

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

async function waitForConsent(page: Page): Promise<string> {
  log('info', 'meta_api', 'fb_login: waiting for consent button')
  for (let i = 0; i < 3; i++) {
    const urlMatch = page.url().match(/access_token=([^&]+)/)
    if (urlMatch) return urlMatch[1]
    const hash = await (page.evaluate('window.location.hash') as Promise<string>).catch(() => '')
    const hashMatch = hash.match(/access_token=([^&]+)/)
    if (hashMatch) return hashMatch[1]

    const buttons = await page.$$('button, input[type="submit"], [role="button"], a[role="button"]')
    for (const b of buttons) {
      const text = await page.evaluate((el) => (el.textContent || '').trim().toLowerCase(), b).catch(() => '')
      const cls = await page.evaluate((el) => el.className, b).catch(() => '')
      log('info', 'meta_api', `fb_login: button ${i}`, { text: text.slice(0, 80), class: cls.slice(0, 80) })
      if (
        text.includes('continue') ||
        text.includes('allow') ||
        text.includes('connect') ||
        cls.includes('confirm') ||
        (text && !cls.includes('cancel'))
      ) {
        log('info', 'meta_api', 'fb_login: clicking confirm button')
        await page.evaluate((el) => el.click(), b).catch(() => {})
        await new Promise(r => setTimeout(r, 3000))
        const u = page.url()
        log('info', 'meta_api', 'fb_login: after confirm click', { url: u })
        const m = u.match(/access_token=([^&]+)/)
        if (m) return m[1]
        if (u.includes('login_success.html')) {
          const h = await (page.evaluate('window.location.hash') as Promise<string>).catch(() => '')
          const hm = h.match(/access_token=([^&]+)/)
          if (hm) return hm[1]
        }
        break
      }
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  log('warn', 'meta_api', 'fb_login: consent button not found after 3 attempts')
  return ''
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
    await page.setViewport({ width: 1366, height: 768 })

    // Navigate directly to OAuth URL (combines login + consent in one flow)
    const redirectUri = 'https://www.facebook.com/connect/login_success.html'
    const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'
    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}&auth_type=rerequest`

    log('info', 'meta_api', 'fb_login: navigating to OAuth URL')
    await page.goto(oauthUrl, { waitUntil: 'networkidle0', timeout: 30000 })
    log('info', 'meta_api', 'fb_login: OAuth page loaded', { url: page.url(), title: await page.title() })

    let shortLivedToken = ''

    // Check if URL already has token (already logged in with session)
    const urlToken = page.url().match(/access_token=([^&]+)/)
    if (urlToken) {
      shortLivedToken = urlToken[1]
    } else {
      const hash = await page.evaluate('window.location.hash').catch(() => '') as string
      const hashMatch = hash.match(/access_token=([^&]+)/)
      if (hashMatch) shortLivedToken = hashMatch[1]
    }

    if (!shortLivedToken) {
      // Need to login - fill credentials on the OAuth login form
      log('info', 'meta_api', 'fb_login: looking for email field')

      let emailField = await page.waitForSelector('#email', { timeout: 10000 }).catch(() => null)
      if (!emailField) {
        emailField = await page.waitForSelector('input[name="email"]', { timeout: 5000 }).catch(() => null)
      }
      if (!emailField) {
        const text = await page.evaluate("document.body?.innerText?.slice(0, 500) || ''") as string
        log('warn', 'meta_api', 'fb_login: email field not found', { url: page.url(), title: await page.title(), text: text.slice(0, 200) })
        return { success: false, error: 'Could not find email field on login page.' }
      }
      log('info', 'meta_api', 'fb_login: email field found')
      await emailField.type(email, { delay: 40 })

      let passField = await page.waitForSelector('#pass', { timeout: 5000 }).catch(() => null)
      if (!passField) {
        passField = await page.waitForSelector('input[name="pass"]', { timeout: 3000 }).catch(() => null)
      }
      if (passField) {
        log('info', 'meta_api', 'fb_login: pass field found')
        await passField.type(password, { delay: 40 })
      }

      await new Promise(r => setTimeout(r, 500))

      // Submit via Enter key
      log('info', 'meta_api', 'fb_login: pressing Enter to submit')
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}),
        page.keyboard.press('Enter'),
      ])

      await new Promise(r => setTimeout(r, 3000))
      log('info', 'meta_api', 'fb_login: after submit', { url: page.url(), title: await page.title() })

      // Check for token after login
      const m = page.url().match(/access_token=([^&]+)/)
      if (m) shortLivedToken = m[1]
      if (!shortLivedToken) {
        const h = await page.evaluate('window.location.hash').catch(() => '') as string
        const hm = h.match(/access_token=([^&]+)/)
        if (hm) shortLivedToken = hm[1]
      }
    }

    if (!shortLivedToken) {
      // Handle consent page (if redirected there after login)
      shortLivedToken = await waitForConsent(page)
    }

    if (!shortLivedToken) {
      const finalHash = await page.evaluate('window.location.hash').catch(() => '') as string
      log('warn', 'meta_api', 'fb_login: failed to obtain token', { url: page.url(), hash: finalHash, title: await page.title() })
      return {
        success: false,
        error: `Could not obtain access token. Final URL: ${page.url()}, Page title: ${await page.title()}`,
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
