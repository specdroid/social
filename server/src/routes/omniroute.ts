import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'
import { getConfig, updateConfig, chatCompletion } from '../services/omniroute'

const router = Router()

router.get('/config', requireAuth, async (req: AuthRequest, res: Response) => {
  const config = await getConfig(req.userId!)
  res.json({
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    model: config.model,
    systemPrompt: config.systemPrompt,
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
  res.json({
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    model: config.model,
    systemPrompt: config.systemPrompt,
  })
})

router.post('/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  const { messages } = req.body
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError(400, 'messages must be a non-empty array of {role, content}')
  }
  for (const m of messages) {
    if (!m.role || !m.content) {
      throw new AppError(400, 'each message must have role and content')
    }
  }

  const reply = await chatCompletion(messages, req.userId!)
  res.json({ reply })
})

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const config = await getConfig(req.userId!)
  if (!config.apiKey) {
    res.json({ ok: false, error: 'API key not configured' })
    return
  }

  try {
    const testMessages = [{ role: 'user', content: 'Say exactly: OK' }]
    const reply = await chatCompletion(testMessages, req.userId!)
    const ok = reply.trim().toLowerCase() === 'ok'
    res.json({ ok, reply: reply.slice(0, 100) })
  } catch (err: any) {
    res.json({ ok: false, error: err.message })
  }
})

export default router
