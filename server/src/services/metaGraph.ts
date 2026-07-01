import { env } from '../config/env'
import { log } from '../utils/logger'
import { addToRetryQueue } from './retryQueue'

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0'

interface MetaApiError {
  error?: {
    message: string
    code: number
    error_subcode?: number
    is_transient?: boolean
  }
}

async function graphRequest(
  endpoint: string,
  options: { method?: string; body?: URLSearchParams; accessToken: string }
): Promise<unknown> {
  const { method = 'GET', body, accessToken } = options
  const url = `${GRAPH_API_BASE}${endpoint}${method === 'GET' ? `&access_token=${accessToken}` : ''}`

  const fetchOptions: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }

  if (body) {
    fetchOptions.body = body.toString()
  }

  const response = await fetch(url, fetchOptions)
  const data = (await response.json()) as MetaApiError

  if (data.error) {
    const errMsg = `Meta API error: ${data.error.message} (code: ${data.error.code})`
    log('error', 'meta_api', errMsg, data.error)

    if (data.error.code === 190 || data.error.code === 4 || data.error.is_transient) {
      addToRetryQueue({
        source: 'meta_api',
        payload: JSON.stringify({ endpoint, options }),
      })
    }

    throw new Error(errMsg)
  }

  return data
}

export async function replyToComment(
  commentId: string,
  message: string,
  accessToken: string
): Promise<unknown> {
  const body = new URLSearchParams({ message, access_token: accessToken })
  return graphRequest(`/${commentId}/comments`, {
    method: 'POST',
    body,
    accessToken,
  })
}

export async function sendMessengerDM(
  recipientId: string,
  message: string | { text?: string; template?: unknown },
  accessToken: string
): Promise<unknown> {
  const payload = {
    recipient: { id: recipientId },
    message: typeof message === 'string' ? { text: message } : message,
  }

  const body = new URLSearchParams({
    access_token: accessToken,
    messaging_type: 'RESPONSE',
  })
  body.append('recipient', JSON.stringify({ id: recipientId }))
  body.append('message', JSON.stringify(typeof message === 'string' ? { text: message } : message))

  return graphRequest('/me/messages', {
    method: 'POST',
    body,
    accessToken,
  })
}

export async function sendInstagramDM(
  recipientId: string,
  message: string,
  accessToken: string
): Promise<unknown> {
  const body = new URLSearchParams({
    access_token: accessToken,
    recipient: JSON.stringify({ id: recipientId }),
    message: JSON.stringify({ text: message }),
  })

  return graphRequest('/me/messages', {
    method: 'POST',
    body,
    accessToken,
  })
}

export async function publishPost(
  pageId: string,
  content: string,
  mediaUrls: string[] | null,
  accessToken: string
): Promise<unknown> {
  if (mediaUrls && mediaUrls.length > 0) {
    const body = new URLSearchParams({
      message: content,
      attached_media: JSON.stringify(mediaUrls.map((url) => ({ media_fbid: url }))),
      access_token: accessToken,
    })
    return graphRequest(`/${pageId}/feed`, { method: 'POST', body, accessToken })
  }

  const body = new URLSearchParams({ message: content, access_token: accessToken })
  return graphRequest(`/${pageId}/feed`, { method: 'POST', body, accessToken })
}

// ── Facebook Login / OAuth ─────────────────────────────────────────────────

export function getLoginUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: redirectUri,
    scope: 'public_profile,publish_pages',
    response_type: 'code',
    state,
  })
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; expires_in: number }> {
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  })
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`)
  const data: any = await res.json()
  if (data.error) throw new Error(`Token exchange failed: ${data.error.message}`)
  return data as { access_token: string; expires_in: number }
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  })
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`)
  const data: any = await res.json()
  if (data.error) throw new Error(`Long-lived token exchange failed: ${data.error.message}`)
  return data as { access_token: string; expires_in: number }
}

export async function resolveUserInfo(accessToken: string): Promise<{ id: string; name: string }> {
  const body = new URLSearchParams({ access_token: accessToken })
  return graphRequest('/me', { method: 'GET', body, accessToken }) as Promise<{ id: string; name: string }>
}

// ── User Feed Publishing ───────────────────────────────────────────────────

export async function publishUserFeed(
  fbUserId: string,
  content: string,
  mediaUrls: string[] | null,
  accessToken: string
): Promise<unknown> {
  const body = new URLSearchParams({ message: content, access_token: accessToken })
  return graphRequest(`/${fbUserId}/feed`, { method: 'POST', body, accessToken })
}

export async function publishUserPhoto(
  fbUserId: string,
  mediaUrl: string,
  caption: string,
  accessToken: string
): Promise<unknown> {
  const body = new URLSearchParams({ url: mediaUrl, caption, access_token: accessToken })
  return graphRequest(`/${fbUserId}/photos`, { method: 'POST', body, accessToken })
}
