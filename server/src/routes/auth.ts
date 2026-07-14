import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { env } from '../config/env'
import { AppError } from '../middleware/errorHandler'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'

const router = Router()
const prisma = new PrismaClient()

router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body

  if (!email || !password) {
    throw new AppError(400, 'Email and password required')
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    throw new AppError(409, 'Email already registered')
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.create({
    data: { email, passwordHash, name },
  })

  const token = jwt.sign(
    { userId: user.id, tier: user.tier, role: user.role, expiresAt: user.expiresAt?.toISOString() },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  await prisma.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, tier: user.tier, role: user.role } })
})

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body

  if (!email || !password) {
    throw new AppError(400, 'Email and password required')
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    throw new AppError(401, 'Invalid credentials')
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    throw new AppError(401, 'Invalid credentials')
  }

  const token = jwt.sign(
    { userId: user.id, tier: user.tier, role: user.role, expiresAt: user.expiresAt?.toISOString() },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  await prisma.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  res.json({ token, user: { id: user.id, email: user.email, name: user.name, tier: user.tier, role: user.role } })
})

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, name: true, tier: true, role: true, expiresAt: true },
  })

  res.json({ user })
})

router.post('/logout', requireAuth, async (req: AuthRequest, res: Response) => {
  const header = req.headers.authorization!
  const token = header.slice(7)

  await prisma.session.deleteMany({ where: { token } })

  res.json({ ok: true })
})

export default router
