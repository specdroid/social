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

export function generateOAuthUrl(state: string): string {
  const appId = env.META_APP_ID
  const redirectUri = env.META_REDIRECT_URI
  if (!appId) throw new Error('META_APP_ID not set in .env')
  if (!redirectUri) throw new Error('META_REDIRECT_URI not set in .env')
  const scope = 'publish_posts,user_posts'
  return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}&auth_type=rerequest`
}

export async function exchangeCodeForToken(code: string): Promise<LoginResult> {
  const appId = env.META_APP_ID
  const appSecret = env.META_APP_SECRET
  const redirectUri = env.META_REDIRECT_URI
  if (!appId || !appSecret || !redirectUri) {
    return { success: false, error: 'META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI must be set in .env' }
  }

  // Exchange authorization code for short-lived access token
  log('info', 'meta_api', 'fb: exchanging code for short-lived token')
  const tokenResult = await graphPost('/oauth/access_token', {
    client_id: appId,
    redirect_uri: redirectUri,
    client_secret: appSecret,
    code,
  })

  const shortLivedToken = tokenResult.access_token
  if (!shortLivedToken) {
    log('error', 'meta_api', 'fb: code exchange failed', { response: tokenResult })
    return { success: false, error: `Code exchange failed: ${JSON.stringify(tokenResult)}` }
  }

  // Exchange short-lived token for long-lived token
  log('info', 'meta_api', 'fb: exchanging short-lived token for long-lived')
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
