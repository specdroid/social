import './utils/dnsOverride'
import http from 'http'
import { createApp } from './app'
import { env } from './config/env'
import { setupWebSocket } from './websocket/whatsappSocket'
import { initWhatsAppBot, cleanupAuthFolder } from './services/whatsappBot'
import { setSocketIO as setTelegramIO } from './services/telegramClient'
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
  setTelegramIO(io)

  if (env.WA_ENABLED) {
    log('info', 'system', 'WhatsApp bot enabled. Waiting for user to click "Connect WhatsApp".')
    const cleaned = cleanupAuthFolder()
    if (cleaned.deleted > 0) {
      log('info', 'system', `Auth folder cleaned on startup: ${cleaned.deleted} stale files removed`)
    }
  } else {
    log('info', 'system', 'WhatsApp bot disabled via WA_ENABLED=false')
  }

  startContentScheduler()

  cron.schedule('*/5 * * * *', () => {
    processRetryQueue().catch((err) => {
      log('error', 'system', 'Retry queue cron failed', {
        error: (err as Error).message,
      })
    })
  })

  httpServer.listen(env.PORT, () => {
    log('info', 'system', `Server running on port ${env.PORT} in ${env.NODE_ENV} mode`)
  })
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
