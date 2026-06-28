import { Router, Request, Response } from 'express'
import { env } from '../../config/env'
import { log } from '../../utils/logger'
import Stripe from 'stripe'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

let stripeInstance: Stripe | null = null

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    })
  }
  return stripeInstance
}

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string
  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    res.status(400).json({ error: 'Missing signature' })
    return
  }

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    log('error', 'stripe', 'Webhook signature verification failed', {
      error: (err as Error).message,
    })
    res.status(400).json({ error: 'Invalid signature' })
    return
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string
        const tier = sub.status === 'active' || sub.status === 'trialing' ? 'premium' : 'free'
        const expiresAt = sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null

        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            tier: tier as 'free' | 'premium',
            stripeSubscriptionId: sub.id,
            expiresAt,
          },
        })

        log('info', 'stripe', `Subscription ${event.type} for customer ${customerId}`, {
          tier,
          expiresAt,
        })
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string

        await prisma.user.updateMany({
          where: { stripeCustomerId: customerId },
          data: {
            tier: 'free',
            stripeSubscriptionId: null,
            expiresAt: null,
          },
        })

        log('info', 'stripe', `Subscription deleted for customer ${customerId}`)
        break
      }
    }

    res.json({ received: true })
  } catch (err) {
    log('error', 'stripe', 'Error processing webhook event', {
      type: event.type,
      error: (err as Error).message,
    })
    res.status(500).json({ error: 'Webhook handler failed' })
  }
})

export default router
