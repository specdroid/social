import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'
import { log } from '../utils/logger'
import { env } from '../config/env'

const router = Router()
const prisma = new PrismaClient()

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

export default router
