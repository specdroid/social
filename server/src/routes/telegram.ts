import { Router, Response } from 'express'
import multer from 'multer'
import path from 'path'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
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
  syncContactsAndDialogs,
  downloadMessageMedia,
  deleteMessage,
} from '../services/telegramClient'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const router = Router()

const tgUpload = multer({
  dest: path.resolve(process.cwd(), '..', 'temp_telegram_uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
})

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const status = await getStatus(req.userId!)
  res.json(status)
})

router.post('/send-code', requireAuth, async (req: AuthRequest, res: Response) => {
  const { phone } = req.body
  if (!phone || typeof phone !== 'string') {
    res.status(400).json({ error: 'Phone number is required' })
    return
  }
  await sendCode(req.userId!, phone)
  res.json({ success: true })
})

router.post('/verify-code', requireAuth, async (req: AuthRequest, res: Response) => {
  const { code } = req.body
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Verification code is required' })
    return
  }
  const result = await signIn(req.userId!, code)
  res.json(result)
})

router.post('/check-password', requireAuth, async (req: AuthRequest, res: Response) => {
  const { password } = req.body
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: 'Password is required' })
    return
  }
  await checkPassword(req.userId!, password)
  res.json({ success: true })
})

router.post('/disconnect', requireAuth, async (req: AuthRequest, res: Response) => {
  await disconnectClient(req.userId!)
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

router.delete('/message/:chatId/:messageId', requireAuth, async (req: AuthRequest, res: Response) => {
  const chatId = req.params.chatId as string
  const messageId = parseInt(req.params.messageId as string, 10)
  await deleteMessage(chatId, messageId)
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

router.get('/synced-contacts', requireAuth, async (req: AuthRequest, res: Response) => {
  const contacts = await prisma.telegramContact.findMany({ where: { userId: req.userId! }, orderBy: { name: 'asc' } })
  res.json(contacts)
})

router.get('/synced-conversations', requireAuth, async (req: AuthRequest, res: Response) => {
  const conversations = await prisma.telegramConversation.findMany({ where: { userId: req.userId! }, orderBy: { lastMessageAt: 'desc' } })
  res.json(conversations)
})

router.post('/sync', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await syncContactsAndDialogs(req.userId!)
  res.json(result)
})

router.get('/media/:chatId/:messageId', async (req: AuthRequest, res: Response) => {
  const chatId = req.params.chatId as string
  const messageId = parseInt(req.params.messageId as string, 10)
  const token = typeof req.query.token === 'string' ? req.query.token : null
  if (!token) { res.status(401).json({ error: 'Token required' }); return }
  try {
    jwt.verify(token, env.JWT_SECRET)
  } catch {
    res.status(401).json({ error: 'Invalid token' }); return
  }
  try {
    const filePath = await downloadMessageMedia(chatId, messageId)
    if (!filePath) { res.status(404).json({ error: 'No media found' }); return }
    res.sendFile(filePath, (err) => {
      try { require('fs').unlinkSync(filePath) } catch { /* ignore */ }
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
