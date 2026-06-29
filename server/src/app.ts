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

  app.get('/privacy', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Privacy Policy - EduLb</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#333}h1{color:#1a1a2e}</style></head>
<body>
<h1>Privacy Policy</h1>
<p>Last updated: June 29, 2026</p>
<p>EduLb ("we", "our", "us") operates the edulb.duckdns.org website and the EduLb Facebook application.</p>
<h2>Information We Collect</h2>
<p>When you connect your Facebook page to our service, we collect and store your Facebook Page access token and Page ID to provide automation features such as auto-replying to comments and messages.</p>
<h2>How We Use Your Information</h2>
<p>We use your Page access token solely to reply to comments, send messages via Facebook Messenger, and publish scheduled posts on your behalf.</p>
<h2>Data Storage</h2>
<p>Your access token is stored securely in our database and is never shared with third parties. You can revoke access at any time by removing your Facebook Page from our application.</p>
<h2>Contact</h2>
<p>Email: ahmad.zeineddine@hotmail.com</p>
</body>
</html>`)
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
