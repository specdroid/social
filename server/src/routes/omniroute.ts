import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'
import { getConfig, updateConfig, chatCompletion, getApiKeys, addApiKey, deleteApiKey, listChats, getChat, createChat, updateChat, deleteChat } from '../services/omniroute'

const router = Router()

router.get('/config', requireAuth, async (req: AuthRequest, res: Response) => {
  const config = await getConfig(req.userId!)
  const keys = await getApiKeys(req.userId!)
  res.json({
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey || keys.length > 0,
    model: config.model,
    systemPrompt: config.systemPrompt,
    apiKeyCount: keys.length + (config.apiKey ? 1 : 0),
  })
})

router.put('/config', requireAuth, async (req: AuthRequest, res: Response) => {
  const { baseUrl, apiKey, model, systemPrompt } = req.body
  if (baseUrl !== undefined && (typeof baseUrl !== 'string' || !baseUrl.startsWith('http'))) {
    throw new AppError(400, 'baseUrl must be a valid URL starting with http')
  }
  if (apiKey !== undefined && typeof apiKey !== 'string') {
    throw new AppError(400, 'apiKey must be a string')
  }
  if (model !== undefined && typeof model !== 'string') {
    throw new AppError(400, 'model must be a string')
  }
  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    throw new AppError(400, 'systemPrompt must be a string')
  }

  const config = await updateConfig(req.userId!, { baseUrl, apiKey, model, systemPrompt })
  const keys = await getApiKeys(req.userId!)
  res.json({
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey || keys.length > 0,
    model: config.model,
    systemPrompt: config.systemPrompt,
    apiKeyCount: keys.length + (config.apiKey ? 1 : 0),
  })
})

router.get('/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  const keys = await getApiKeys(req.userId!)
  res.json({ keys: keys.map(k => ({ id: k.id, label: k.label, key: k.key.slice(0, 8) + '...' + k.key.slice(-4), createdAt: k.createdAt })) })
})

router.post('/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  const { key, label } = req.body
  if (!key || typeof key !== 'string') throw new AppError(400, 'key is required')
  const created = await addApiKey(req.userId!, key.trim(), label)
  res.json({ id: created.id, label: created.label, key: created.key.slice(0, 8) + '...' + created.key.slice(-4), createdAt: created.createdAt })
})

router.delete('/keys/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  await deleteApiKey(String(req.params.id), req.userId!)
  res.json({ ok: true })
})

router.post('/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  const { messages } = req.body
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError(400, 'messages must be a non-empty array of {role, content}')
  }
  for (const m of messages) {
    if (!m.role) throw new AppError(400, 'each message must have role')
    if (!m.content && !Array.isArray(m.content)) throw new AppError(400, 'each message must have content')
  }

  const reply = await chatCompletion(messages, req.userId!)
  res.json({ reply })
})

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const config = await getConfig(req.userId!)
  const keys = await getApiKeys(req.userId!)
  if (!config.apiKey && keys.length === 0) {
    res.json({ ok: false, error: 'No API keys configured' })
    return
  }

  try {
    const testMessages = [{ role: 'user', content: 'Say exactly: OK' }]
    const reply = await chatCompletion(testMessages, req.userId!)
    const clean = reply.trim().toLowerCase()
    const ok = clean.includes('ok') && !clean.includes('error')
    res.json({ ok, reply: reply.slice(0, 100) })
  } catch (err: any) {
    res.json({ ok: false, error: err.message })
  }
})

router.get('/chats', requireAuth, async (req: AuthRequest, res: Response) => {
  const chats = await listChats(req.userId!)
  res.json({ chats })
})

router.post('/chats', requireAuth, async (req: AuthRequest, res: Response) => {
  const { title, messages } = req.body
  const chat = await createChat(req.userId!, title, messages || [])
  res.json({ id: chat.id, title: chat.title, messages: JSON.parse(chat.messages) })
})

router.get('/chats/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const chat = await getChat(String(req.params.id), req.userId!)
  if (!chat) throw new AppError(404, 'Chat not found')
  res.json({ id: chat.id, title: chat.title, messages: JSON.parse(chat.messages) })
})

router.put('/chats/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { title, messages } = req.body
  const chat = await updateChat(String(req.params.id), req.userId!, { title, messages })
  res.json({ id: chat.id, title: chat.title, messages: JSON.parse(chat.messages) })
})

router.delete('/chats/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  await deleteChat(String(req.params.id), req.userId!)
  res.json({ ok: true })
})

export default router
