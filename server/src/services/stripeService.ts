import Stripe from 'stripe'
import { env } from '../config/env'
import { PrismaClient, User } from '@prisma/client'
import { log } from '../utils/logger'

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

export async function createCheckoutSession(user: User): Promise<string> {
  if (!env.STRIPE_PRICE_ID) {
    throw new Error('STRIPE_PRICE_ID not configured')
  }

  let stripeCustomerId = user.stripeCustomerId

  if (!stripeCustomerId) {
    const customer = await getStripe().customers.create({
      email: user.email,
      name: user.name || undefined,
      metadata: { userId: user.id },
    })

    stripeCustomerId = customer.id

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId },
    })
  }

  const session = await getStripe().checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: env.STRIPE_SUCCESS_URL,
    cancel_url: env.STRIPE_CANCEL_URL,
    metadata: { userId: user.id },
  })

  log('info', 'stripe', 'Checkout session created', {
    userId: user.id,
    sessionId: session.id,
  })

  return session.url!
}

export async function getSubscriptionStatus(
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  try {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId)
    return sub
  } catch {
    return null
  }
}
