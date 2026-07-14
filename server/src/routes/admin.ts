import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { requireMaster } from '../middleware/requireMaster'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

router.use(requireAuth)
router.use(requireMaster)

router.get('/users', async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      tier: true,
      role: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  res.json({ users })
})

router.post('/users', async (req: AuthRequest, res: Response) => {
  const { email, password, name, tier } = req.body

  if (!email || !password) {
    throw new AppError(400, 'Email and password required')
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    throw new AppError(409, 'Email already registered')
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      tier: tier === 'premium' ? 'premium' : 'free',
    },
  })

  res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, tier: user.tier, role: user.role },
  })
})

router.patch('/users/:id/tier', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string
  const { tier } = req.body

  if (tier !== 'free' && tier !== 'premium') {
    throw new AppError(400, 'Tier must be "free" or "premium"')
  }

  const user = await prisma.user.update({
    where: { id },
    data: { tier },
    select: { id: true, email: true, name: true, tier: true, role: true },
  })

  res.json({ user })
})

router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string

  if (id === req.userId) {
    throw new AppError(400, 'Cannot delete your own account')
  }

  await prisma.user.delete({ where: { id } })

  res.json({ ok: true })
})

export default router
