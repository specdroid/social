import type { LoginResult } from './types'
import { log } from '../utils/logger'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

async function graphPost(endpoint: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params)
  const res = await fetch(`${GRAPH_API_BASE}${endpoint}`, { method: 'POST', body })
  return res.json()
}

export type { LoginResult } from './types'

export function generateOAuthUrl(): string {
  const appId = process.env.META_APP_ID
  if (!appId) throw new Error('META_APP_ID not set in .env')
  const redirectUri = 'https://www.facebook.com/connect/login_success.html'
  const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list'
  return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token,granted_scopes&scope=${encodeURIComponent(scope)}&auth_type=rerequest&display=popup`
}

export async function processToken(token: string): Promise<LoginResult> {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return { success: false, error: 'META_APP_ID and META_APP_SECRET must be set in .env' }

  log('info', 'meta_api', 'fb: exchanging token for long-lived')
  const exchangeResult = await graphPost('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: token,
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

  log('info', 'meta_api', 'fb: token processed', { pageCount: pages.length })
  return { success: true, pages }
}
