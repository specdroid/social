import { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler'

const threadTimestamps = new Map<string, number>()

const MIN_INTERVAL_MS = 3000

export function whatsappRateLimiter(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const threadId = req.body?.threadId || req.query?.threadId || 'default'
  const now = Date.now()
  const lastSent = threadTimestamps.get(String(threadId)) || 0

  if (now - lastSent < MIN_INTERVAL_MS) {
    throw new AppError(429, `Rate limited. Wait ${MIN_INTERVAL_MS}ms between messages to this thread.`)
  }

  threadTimestamps.set(String(threadId), now)
  next()
}
