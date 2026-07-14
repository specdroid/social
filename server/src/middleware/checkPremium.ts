import { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler'

export interface AuthRequest extends Request {
  userId?: string
  userTier?: string
  userRole?: string
  userExpiresAt?: string | null
}

export function checkPremiumTier(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  if (req.userTier !== 'premium') {
    throw new AppError(403, 'Premium subscription required for this feature')
  }

  if (req.userExpiresAt && new Date(req.userExpiresAt) < new Date()) {
    throw new AppError(403, 'Premium subscription has expired')
  }

  next()
}
