import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'
import { log } from '../utils/logger'
import { env } from '../config/env'
import { getLoginUrl, exchangeCodeForToken, exchangeForLongLivedToken, resolveUserInfo } from '../services/metaGraph'
import crypto from 'crypto'

const router = Router()
const prisma = new PrismaClient()

// In-memory OAuth state → userId mapping (cleared on use, TTL 10 min)
const oauthStateMap = new Map<string, { userId: string; expiresAt: number }>()

// ── Pages CRUD ─────────────────────────────────────────────────────────────

router.get('/pages', requireAuth, async (req: AuthRequest, res: Response) => {
  const pages = await prisma.facebookPage.findMany({
    where: { userId: req.userId! },
    select: { id: true, pageId: true, pageName: true, webhookActive: true, createdAt: true },
  })
  res.json({ pages })
})

router.post('/pages', requireAuth, async (req: AuthRequest, res: Response) => {
  const { pageId, pageName, accessToken } = req.body
  if (!pageId || !accessToken) throw new AppError(400, 'pageId and accessToken required')

  const page = await prisma.facebookPage.upsert({
    where: { pageId },
    update: { pageName, accessToken, userId: req.userId! },
    create: { pageId, pageName, accessToken, userId: req.userId! },
  })

  log('info', 'meta_api', 'Facebook page saved', { pageId, pageName })
  res.json({ page })
})

router.delete('/pages/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string
  const page = await prisma.facebookPage.findFirst({
    where: { id, userId: req.userId! },
  })
  if (!page) throw new AppError(404, 'Page not found')

  await prisma.facebookPage.delete({ where: { id } })
  log('info', 'meta_api', 'Facebook page removed', { pageId: page.pageId })
  res.json({ ok: true })
})

router.post('/subscribe', requireAuth, async (req: AuthRequest, res: Response) => {
  const { pageId } = req.body
  if (!pageId) throw new AppError(400, 'pageId required')

  const page = await prisma.facebookPage.findFirst({
    where: { pageId, userId: req.userId! },
  })
  if (!page) throw new AppError(404, 'Page not found')

  const GRAPH_API = 'https://graph.facebook.com/v21.0'
  const url = `${GRAPH_API}/${pageId}/subscribed_apps?access_token=${page.accessToken}&subscribed_fields=feed,messages,message_deliveries,messaging_optins,messaging_postbacks`

  const response = await fetch(url, { method: 'POST' })
  const data: any = await response.json()

  if (data.error) {
    log('error', 'meta_api', 'Failed to subscribe page to webhooks', data.error)
    throw new AppError(400, `Webhook subscribe failed: ${data.error.message}`)
  }

  await prisma.facebookPage.update({
    where: { id: page.id },
    data: { webhookActive: true },
  })

  log('info', 'meta_api', 'Page subscribed to webhooks', { pageId })
  res.json({ success: true, data })
})

// ── Facebook User (Personal Account) OAuth ────────────────────────────────

router.get('/login', requireAuth, async (req: AuthRequest, res: Response) => {
  const state = crypto.randomBytes(32).toString('hex')
  oauthStateMap.set(state, { userId: req.userId!, expiresAt: Date.now() + 600_000 })
  const url = getLoginUrl(env.META_REDIRECT_URI, state)
  res.json({ url })
})

router.get('/callback', async (req: AuthRequest, res: Response) => {
  const { code, state: oauthState, error: oauthError } = req.query as Record<string, string>

  if (oauthError) {
    log('error', 'meta_api', 'Facebook OAuth error', { oauthError })
    res.redirect(`${env.FRONTEND_URL}/facebook?error=${encodeURIComponent(oauthError)}`)
    return
  }

  if (!code || !oauthState) {
    res.redirect(`${env.FRONTEND_URL}/facebook?error=missing_params`)
    return
  }

  const stateEntry = oauthStateMap.get(oauthState)
  oauthStateMap.delete(oauthState)

  if (!stateEntry || stateEntry.expiresAt < Date.now()) {
    res.redirect(`${env.FRONTEND_URL}/facebook?error=invalid_or_expired_state`)
    return
  }

  try {
    const { access_token: shortToken } = await exchangeCodeForToken(code, env.META_REDIRECT_URI)
    const { access_token: longToken } = await exchangeForLongLivedToken(shortToken)
    const userInfo = await resolveUserInfo(longToken) as { id: string; name: string }

    const existing = await prisma.facebookUser.findUnique({
      where: { userId: stateEntry.userId },
    })

    if (existing) {
      await prisma.facebookUser.update({
        where: { id: existing.id },
        data: { fbUserId: userInfo.id, name: userInfo.name, accessToken: longToken },
      })
      res.redirect(`${env.FRONTEND_URL}/facebook?connected=ok`)
      return
    }

    await prisma.facebookUser.create({
      data: {
        userId: stateEntry.userId,
        fbUserId: userInfo.id,
        name: userInfo.name,
        accessToken: longToken,
      },
    })

    res.redirect(`${env.FRONTEND_URL}/facebook?connected=ok`)
  } catch (err) {
    log('error', 'meta_api', 'Facebook OAuth callback failed', { error: (err as Error).message })
    res.redirect(`${env.FRONTEND_URL}/facebook?error=${encodeURIComponent((err as Error).message)}`)
  }
})

router.get('/user', requireAuth, async (req: AuthRequest, res: Response) => {
  const fbUser = await prisma.facebookUser.findUnique({
    where: { userId: req.userId! },
    select: { id: true, fbUserId: true, name: true, createdAt: true },
  })
  res.json({ user: fbUser || null })
})

router.delete('/user', requireAuth, async (req: AuthRequest, res: Response) => {
  const fbUser = await prisma.facebookUser.findUnique({
    where: { userId: req.userId! },
  })
  if (!fbUser) throw new AppError(404, 'Facebook account not connected')

  await prisma.facebookUser.delete({ where: { id: fbUser.id } })
  log('info', 'meta_api', 'Facebook user account disconnected', { fbUserId: fbUser.fbUserId })
  res.json({ ok: true })
})

export default router
