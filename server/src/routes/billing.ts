import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { createCheckoutSession, getSubscriptionStatus } from '../services/stripeService'
import { env } from '../config/env'
import Stripe from 'stripe'

const router = Router()
const prisma = new PrismaClient()

router.post('/checkout', requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } })
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const url = await createCheckoutSession(user)
  res.json({ url })
})

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { tier: true, stripeCustomerId: true, stripeSubscriptionId: true, expiresAt: true },
  })

  const status = user?.stripeSubscriptionId
    ? await getSubscriptionStatus(user.stripeSubscriptionId)
    : null

  res.json({
    tier: user?.tier,
    stripeCustomerId: user?.stripeCustomerId,
    stripeSubscriptionId: user?.stripeSubscriptionId,
    expiresAt: user?.expiresAt,
    stripeStatus: status,
  })
})

router.post('/portal', requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } })
  if (!user?.stripeCustomerId) {
    res.status(400).json({ error: 'No active subscription' })
    return
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
  })

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: env.STRIPE_SUCCESS_URL,
  })

  res.json({ url: session.url })
})

export default router
