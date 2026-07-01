import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { checkPremiumTier, AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

router.get('/rules', requireAuth, async (req: AuthRequest, res: Response) => {
  const rules = await prisma.automationRule.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ rules })
})

router.post('/rules', requireAuth, checkPremiumTier, async (req: AuthRequest, res: Response) => {
  const { name, platform, triggerType, triggerValue, actionType, actionPayload } = req.body

  const rule = await prisma.automationRule.create({
    data: {
      userId: req.userId!,
      name,
      platform,
      triggerType,
      triggerValue,
      actionType,
      actionPayload: typeof actionPayload === 'string' ? actionPayload : JSON.stringify(actionPayload),
    },
  })

  res.status(201).json({ rule })
})

router.put('/rules/:id', requireAuth, checkPremiumTier, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string
  const { name, platform, triggerType, triggerValue, actionType, actionPayload, isActive } = req.body

  const existing = await prisma.automationRule.findFirst({
    where: { id, userId: req.userId! },
  })
  if (!existing) throw new AppError(404, 'Rule not found')

  const rule = await prisma.automationRule.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(platform !== undefined && { platform }),
      ...(triggerType !== undefined && { triggerType }),
      ...(triggerValue !== undefined && { triggerValue }),
      ...(actionType !== undefined && { actionType }),
      ...(actionPayload !== undefined && { actionPayload: typeof actionPayload === 'string' ? actionPayload : JSON.stringify(actionPayload) }),
      ...(isActive !== undefined && { isActive }),
    },
  })

  res.json({ rule })
})

router.delete('/rules/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string

  const existing = await prisma.automationRule.findFirst({
    where: { id, userId: req.userId! },
  })
  if (!existing) throw new AppError(404, 'Rule not found')

  await prisma.automationRule.delete({ where: { id } })

  res.json({ ok: true })
})

router.get('/posts', requireAuth, async (req: AuthRequest, res: Response) => {
  const posts = await prisma.scheduledPost.findMany({
    where: { userId: req.userId! },
    orderBy: { scheduledAt: 'asc' },
  })
  res.json({ posts })
})

router.post('/posts', requireAuth, checkPremiumTier, async (req: AuthRequest, res: Response) => {
  const { platform, target, content, mediaUrls, scheduledAt } = req.body

  const post = await prisma.scheduledPost.create({
    data: {
      userId: req.userId!,
      platform,
      target: target || 'page',
      content,
      mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null,
      scheduledAt: new Date(scheduledAt),
    },
  })

  res.status(201).json({ post })
})

router.put('/posts/:id', requireAuth, checkPremiumTier, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string
  const { platform, target, content, mediaUrls, scheduledAt } = req.body

  const existing = await prisma.scheduledPost.findFirst({
    where: { id, userId: req.userId! },
  })
  if (!existing) throw new AppError(404, 'Post not found')

  const post = await prisma.scheduledPost.update({
    where: { id },
    data: {
      ...(platform !== undefined && { platform }),
      ...(target !== undefined && { target }),
      ...(content !== undefined && { content }),
      ...(mediaUrls !== undefined && { mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null }),
      ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
    },
  })

  res.json({ post })
})

router.delete('/posts/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string

  const existing = await prisma.scheduledPost.findFirst({
    where: { id, userId: req.userId! },
  })
  if (!existing) throw new AppError(404, 'Post not found')

  await prisma.scheduledPost.delete({ where: { id } })

  res.json({ ok: true })
})

export default router
