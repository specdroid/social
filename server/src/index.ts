import './utils/dnsOverride'
import http from 'http'
import { createApp } from './app'
import { env } from './config/env'
import { setupWebSocket } from './websocket/whatsappSocket'
import { manager } from './services/whatsapp'
import { setSocketIO as setTelegramIO, syncContactsAndDialogs } from './services/telegramClient'
import { startContentScheduler } from './services/contentScheduler'
import { processRetryQueue } from './services/retryQueue'
import { log } from './utils/logger'
import cron from 'node-cron'

process.on('unhandledRejection', (reason) => {
  log('error', 'system', 'Unhandled rejection', {
    error: (reason instanceof Error ? reason.message : String(reason)),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

process.on('uncaughtException', (err) => {
  log('error', 'system', 'Uncaught exception', {
    error: err.message,
    stack: err.stack,
  })
})

async function main(): Promise<void> {
  const app = createApp()
  const httpServer = http.createServer(app)

  const io = setupWebSocket(httpServer)
  manager.setSocketIO(io)
  setTelegramIO(io)

  if (env.WA_ENABLED) {
    log('info', 'system', 'WhatsApp bot enabled. Users can connect via dashboard.')
  } else {
    log('info', 'system', 'WhatsApp bot disabled via WA_ENABLED=false')
  }

  startContentScheduler()

  cron.schedule('*/5 * * * *', () => {
    processRetryQueue().catch((err) => {
      log('error', 'system', 'Retry queue cron failed', { error: (err as Error).message })
    })
  })

  cron.schedule('0 0 * * *', async () => {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    try {
      const sessions = await prisma.telegramSession.findMany()
      for (const session of sessions) {
        try {
          const r = await syncContactsAndDialogs(session.userId)
          log('info', 'system', 'Telegram auto-sync completed', { userId: session.userId, ...r })
        } catch (err) {
          log('error', 'system', 'Telegram auto-sync failed', { userId: session.userId, error: (err as Error).message })
        }
      }
    } finally {
      await prisma.$disconnect()
    }
  })

  httpServer.listen(env.PORT, () => {
    log('info', 'system', `Server running on port ${env.PORT} in ${env.NODE_ENV} mode`)
  })
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
