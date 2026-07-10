import type { LoginResult } from './types'
import { log } from '../utils/logger'
import { env } from '../config/env'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

async function graphPost(endpoint: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params)
  const res = await fetch(`${GRAPH_API_BASE}${endpoint}`, { method: 'POST', body })
  return res.json()
}

export type { LoginResult } from './types'

export async function processAccessToken(shortLivedToken: string): Promise<LoginResult> {
  const appId = env.META_APP_ID
  const appSecret = env.META_APP_SECRET
  if (!appId || !appSecret) {
    return { success: false, error: 'META_APP_ID and META_APP_SECRET must be set in .env' }
  }

  // Exchange short-lived token for long-lived token
  log('info', 'meta_api', 'fb: exchanging token for long-lived')
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

  // Fetch user info
  log('info', 'meta_api', 'fb: fetching user info')
  const meResult = await graphPost('/me', { access_token: longLivedToken, fields: 'id,name' })

  if (!meResult.id) {
    log('error', 'meta_api', 'fb: failed to fetch user info', { response: meResult })
    return { success: false, error: `Failed to fetch user info: ${JSON.stringify(meResult)}` }
  }

  log('info', 'meta_api', 'fb: login successful', { fbUserId: meResult.id, fbName: meResult.name })
  return { success: true, accessToken: longLivedToken, fbUserId: meResult.id, fbUserName: meResult.name || '' }
}
