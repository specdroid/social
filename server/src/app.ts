import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth'
import whatsappRoutes from './routes/whatsapp'
import automationRoutes from './routes/automation'
import billingRoutes from './routes/billing'
import metaWebhookRoutes from './routes/webhooks/meta'
import stripeWebhookRoutes from './routes/webhooks/stripe'
import uploadRoutes from './routes/upload'
import facebookRoutes from './routes/facebook'

export function createApp(): express.Application {
  const app = express()

  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }))

  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      const url = req.url || ''
      if (url.includes('/webhooks/stripe')) {
        (req as any).rawBody = buf
      }
    },
  }))

  app.use(express.urlencoded({ extended: true }))

  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')))

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.use('/api/auth', authRoutes)
  app.use('/api/whatsapp', whatsappRoutes)
  app.use('/api/automation', automationRoutes)
  app.use('/api/billing', billingRoutes)
  app.use('/api/upload', uploadRoutes)
  app.use('/api/facebook', facebookRoutes)

  app.use('/webhooks/meta', metaWebhookRoutes)
  app.use('/webhooks/stripe', stripeWebhookRoutes)

  app.use(errorHandler)

  return app
}
