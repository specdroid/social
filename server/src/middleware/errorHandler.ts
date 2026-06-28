import { Request, Response, NextFunction } from 'express'
import { log } from '../utils/logger'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    log('warn', 'system', err.message, { statusCode: err.statusCode })
    res.status(err.statusCode).json({ error: err.message })
    return
  }

  log('error', 'system', 'Unhandled error', {
    message: err.message,
    stack: err.stack,
  })

  res.status(500).json({ error: 'Internal server error' })
}
