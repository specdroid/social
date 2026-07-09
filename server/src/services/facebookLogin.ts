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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    await page.setViewport({ width: 1366, height: 768 })

    // Step 1: Login via clean login page
    log('info', 'meta_api', 'fb_login: navigating to login page')
    await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle0', timeout: 30000 })
    log('info', 'meta_api', 'fb_login: login page loaded', { url: page.url(), title: await page.title() })

    let emailSelector = '#email'
    let passSelector = '#pass'
    let loginBtnSelector = '#loginbutton, button[name="login"]'

    // Try to find email field with multiple selectors
    let emailField = await page.waitForSelector(emailSelector, { timeout: 10000 }).catch(() => null)
    if (!emailField) {
      emailSelector = 'input[name="email"]'
      emailField = await page.waitForSelector(emailSelector, { timeout: 5000 }).catch(() => null)
    }
    if (!emailField) {
      const pageText = await page.evaluate("document.body?.innerText?.slice(0, 500) || ''") as string
      log('warn', 'meta_api', 'fb_login: email field not found', { url: page.url(), title: await page.title(), text: pageText.slice(0, 200) })
      return { success: false, error: 'Could not find email field on login page.' }
    }
    log('info', 'meta_api', 'fb_login: email field found', { selector: emailSelector })
    await emailField.type(email, { delay: 40 })

    let passField = await page.waitForSelector(passSelector, { timeout: 5000 }).catch(() => null)
    if (!passField) {
      passSelector = 'input[name="pass"]'
      passField = await page.waitForSelector(passSelector, { timeout: 3000 }).catch(() => null)
    }
    if (passField) {
      log('info', 'meta_api', 'fb_login: pass field found')
      await passField.type(password, { delay: 40 })
    }

    await new Promise(r => setTimeout(r, 500))

    // Submit login
    log('info', 'meta_api', 'fb_login: submitting login')
    const loginBtn = await page.$(loginBtnSelector)
    if (loginBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}),
        loginBtn.click(),
      ])
    } else {
      const loginBtnAlt = await page.$('button[type="submit"], input[type="submit"]')
      if (loginBtnAlt) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}),
          loginBtnAlt.click(),
        ])
      } else {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {}),
          page.keyboard.press('Enter'),
        ])
      }
    }

    await new Promise(r => setTimeout(r, 3000))

    let finalUrl = page.url()
    log('info', 'meta_api', 'fb_login: after login submit', { url: finalUrl, title: await page.title() })

    // Check if still on login page
    if (finalUrl.includes('login.php') || finalUrl.includes('login/')) {
      log('info', 'meta_api', 'fb_login: still on login page, trying JS submit')
      await page.evaluate("document.querySelector('form')?.submit()")
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {})
      await new Promise(r => setTimeout(r, 2000))
      finalUrl = page.url()
      log('info', 'meta_api', 'fb_login: after JS submit', { url: finalUrl, title: await page.title() })
    }

    if (finalUrl.includes('login') || finalUrl.includes('checkpoint')) {
      const pageText = await page.evaluate("document.body?.innerText?.slice(0, 1000) || ''") as string
      log('warn', 'meta_api', 'fb_login: login still showing', { text: pageText.slice(0, 300) })
      if (pageText.includes('incorrect') || pageText.includes('wrong')) {
        return { success: false, error: 'Facebook login failed: incorrect email or password.' }
      }
      return { success: false, error: 'Facebook login failed. Check email/password.' }
    }

    // Step 2: Now navigate to OAuth dialog to get the token
    const redirectUri = 'https://www.facebook.com/connect/login_success.html'
    const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'
    const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}&auth_type=rerequest`

    log('info', 'meta_api', 'fb_login: navigating to OAuth URL')
    await page.goto(oauthUrl, { waitUntil: 'networkidle0', timeout: 30000 })
    log('info', 'meta_api', 'fb_login: OAuth page loaded', { url: page.url(), title: await page.title() })
    await new Promise(r => setTimeout(r, 2000))

    let shortLivedToken = ''
    const fragmentMatch = page.url().match(/access_token=([^&]+)/)
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
        const buttons = await page.$$('button, input[type="submit"], [role="button"]')
        let confirmBtn = null
        for (const b of buttons) {
          const text = await page.evaluate((el) => (el.textContent || '').trim().toLowerCase(), b).catch(() => '')
          const cls = await page.evaluate((el) => el.className, b).catch(() => '')
          log('info', 'meta_api', `fb_login: button ${i}.${buttons.indexOf(b)}`, { text: text.slice(0, 50), class: cls.slice(0, 50) })
          if (
            text.includes('continue') ||
            text.includes('allow') ||
            text.includes('confirm') ||
            text.includes('connect') ||
            cls.includes('confirm') ||
            (text && !cls.includes('cancel'))
          ) {
            confirmBtn = b
            break
          }
        }
        if (confirmBtn) {
          log('info', 'meta_api', `fb_login: clicking confirm button`)
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}),
            confirmBtn.click().catch(() => {}),
          ])
          await new Promise(r => setTimeout(r, 1000))
          const u = page.url()
          log('info', 'meta_api', 'fb_login: after confirm click', { url: u, title: await page.title() })
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
