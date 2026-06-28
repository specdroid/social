import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { AuthRequest } from './checkPremium'
import { AppError } from './errorHandler'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface JwtPayload {
  userId: string
  tier: string
  expiresAt: string | null
}

export async function requireAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError(401, 'Authentication required')
  }

  const token = header.slice(7)

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!session || session.expiresAt < new Date()) {
      throw new AppError(401, 'Session expired')
    }

    req.userId = decoded.userId
    req.userTier = decoded.tier
    req.userExpiresAt = decoded.expiresAt

    next()
  } catch (err) {
    if (err instanceof AppError) throw err
    throw new AppError(401, 'Invalid token')
  }
}
