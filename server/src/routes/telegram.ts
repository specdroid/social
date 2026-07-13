import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import {
  sendCode,
  signIn,
  checkPassword,
  getStatus,
  disconnectClient,
} from '../services/telegramClient'

const router = Router()

router.get('/status', requireAuth, async (_req: AuthRequest, res: Response) => {
  const status = await getStatus()
  res.json(status)
})

router.post('/send-code', requireAuth, async (req: AuthRequest, res: Response) => {
  const { phone } = req.body
  if (!phone || typeof phone !== 'string') {
    res.status(400).json({ error: 'Phone number is required' })
    return
  }
  await sendCode(phone)
  res.json({ success: true })
})

router.post('/verify-code', requireAuth, async (req: AuthRequest, res: Response) => {
  const { code } = req.body
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Verification code is required' })
    return
  }
  const result = await signIn(code)
  res.json(result)
})

router.post('/check-password', requireAuth, async (req: AuthRequest, res: Response) => {
  const { password } = req.body
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Password is required' })
    return
  }
  await checkPassword(password)
  res.json({ success: true })
})

router.post('/disconnect', requireAuth, async (_req: AuthRequest, res: Response) => {
  await disconnectClient()
  res.json({ success: true })
})

export default router
