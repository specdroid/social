import { Response, NextFunction } from 'express'
import { AuthRequest } from './checkPremium'
import { AppError } from './errorHandler'

export function requireMaster(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  if (req.userRole !== 'master') {
    throw new AppError(403, 'Master access required')
  }
  next()
}
