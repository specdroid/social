import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'
import { log } from '../utils/logger'
import { processAccessToken } from '../facebook'
import { sendWhatsAppMessage } from '../services/whatsappBot'

const router = Router()
const prisma = new PrismaClient()

// ── POST /api/facebook/token — receive access token from web page ──
router.post('/token', async (req: Request, res: Response) => {
  const { accessToken, jid } = req.body as { accessToken?: string; jid?: string }
  if (!accessToken) {
    res.status(400).json({ success: false, error: 'accessToken required' })
    return
  }

  log('info', 'meta_api', 'fb: token received from web page', { jid })

  try {
    const result = await processAccessToken(accessToken)
    if (!result.success) {
      if (jid) {
        try { await sendWhatsAppMessage(jid, `❌ Facebook login failed: ${result.error}`) } catch {}
      }
      res.json({ success: false, error: result.error })
      return
    }

    const user = await prisma.user.findFirst()
    if (!user) {
      res.json({ success: false, error: 'No user found in database.' })
      return
    }

    await prisma.facebookAccount.upsert({
      where: { fbId: result.fbUserId! },
      update: { accessToken: result.accessToken!, fbName: result.fbUserName, userId: user.id },
      create: { fbId: result.fbUserId!, fbName: result.fbUserName, accessToken: result.accessToken!, userId: user.id },
    })

    if (jid) {
      try { await sendWhatsAppMessage(jid, `✅ Facebook login successful! Connected as *${result.fbUserName || result.fbUserId}*`) } catch {}
    }

    res.json({ success: true })
  } catch (err) {
    const msg = (err as Error).message
    log('error', 'meta_api', 'fb: token processing error', { error: msg })
    if (jid) {
      try { await sendWhatsAppMessage(jid, `❌ Facebook login failed: ${msg}`) } catch {}
    }
    res.json({ success: false, error: msg })
  }
})

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

router.get('/post-logs', requireAuth, async (req: AuthRequest, res: Response) => {
  const logs = await prisma.facebookPostLog.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json({ logs })
})

async function deletePostLogs(logs: { mediaUrls: string | null }[]): Promise<void> {
  const uploadsDir = path.resolve(process.cwd(), 'uploads')
  for (const log of logs) {
    if (log.mediaUrls) {
      try {
        const urls: string[] = JSON.parse(log.mediaUrls)
        for (const url of urls) {
          const filename = path.basename(url)
          const filePath = path.join(uploadsDir, filename)
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        }
      } catch {}
    }
  }
}

router.delete('/post-logs', requireAuth, async (req: AuthRequest, res: Response) => {
  const logs = await prisma.facebookPostLog.findMany({ where: { userId: req.userId! } })
  await deletePostLogs(logs)
  await prisma.facebookPostLog.deleteMany({ where: { userId: req.userId! } })
  res.json({ ok: true })
})

router.post('/post-logs/delete', requireAuth, async (req: AuthRequest, res: Response) => {
  const { ids } = req.body as { ids: string[] }
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError(400, 'ids array required')
  const logs = await prisma.facebookPostLog.findMany({ where: { id: { in: ids }, userId: req.userId! } })
  await deletePostLogs(logs)
  await prisma.facebookPostLog.deleteMany({ where: { id: { in: ids }, userId: req.userId! } })
  res.json({ ok: true })
})

export default router
