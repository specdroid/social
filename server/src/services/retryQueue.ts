import { PrismaClient } from '@prisma/client'
import { log } from '../utils/logger'

const prisma = new PrismaClient()

let processing = false

export async function addToRetryQueue(item: {
  source: string
  payload: string
}): Promise<void> {
  try {
    await prisma.retryQueue.create({
      data: {
        source: item.source,
        payload: item.payload,
        attempts: 0,
        maxAttempts: 3,
      },
    })
    log('info', 'system', 'Added item to retry queue', { source: item.source })
  } catch (err) {
    log('error', 'system', 'Failed to add to retry queue', {
      error: (err as Error).message,
    })
  }
}

export async function processRetryQueue(): Promise<void> {
  if (processing) return
  processing = true

  try {
    const items = await prisma.retryQueue.findMany({
      where: { attempts: { lt: 3 } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    })

    for (const item of items) {
      try {
        const payload = JSON.parse(item.payload)
        log('info', 'system', 'Retrying queued item', { source: item.source })
        await prisma.retryQueue.delete({ where: { id: item.id } })
      } catch (err) {
        await prisma.retryQueue.update({
          where: { id: item.id },
          data: {
            attempts: item.attempts + 1,
            lastError: (err as Error).message,
          },
        })
      }
    }
  } catch (err) {
    log('error', 'system', 'Retry queue processing failed', {
      error: (err as Error).message,
    })
  } finally {
    processing = false
  }
}
