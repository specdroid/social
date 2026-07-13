import { Router, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import {
  sendCode,
  signIn,
  checkPassword,
  getStatus,
  disconnectClient,
  getDialogs,
  getMessages,
  sendMessage,
  sendMedia,
} from '../services/telegramClient'

const router = Router()

const tgUpload = multer({
  dest: path.resolve(process.cwd(), '..', 'temp_telegram_uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
})

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

router.get('/dialogs', requireAuth, async (_req: AuthRequest, res: Response) => {
  const dialogs = await getDialogs()
  res.json(dialogs)
})

router.get('/history/:chatId', requireAuth, async (req: AuthRequest, res: Response) => {
  const chatId = req.params.chatId as string
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50
  const messages = await getMessages(chatId, limit)
  res.json(messages)
})

router.post('/send', requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId, text } = req.body
  if (!chatId || !text) {
    res.status(400).json({ error: 'chatId and text are required' })
    return
  }
  await sendMessage(String(chatId), String(text))
  res.json({ success: true })
})

router.post('/send-media', requireAuth, tgUpload.single('file'), async (req: AuthRequest, res: Response) => {
  const { chatId, caption } = req.body
  const file = req.file
  if (!chatId || !file) {
    res.status(400).json({ error: 'chatId and file are required' })
    return
  }
  await sendMedia(String(chatId), file.path, caption || undefined)
  res.json({ success: true })
})

export default router
