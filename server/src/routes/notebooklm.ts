import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { spawn } from 'child_process'
import path from 'path'

const router = Router()

const NLM_SERVER = process.env.NOTEBOOKLM_SERVER_URL || 'http://127.0.0.1:8000'
const NLM_TOKEN = process.env.NOTEBOOKLM_SERVER_TOKEN || ''

async function nlmFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${NLM_SERVER}/v1${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NLM_TOKEN}`,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err: any = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || `NotebookLM error ${res.status}`)
  }
  return res.json()
}

function handleNlm(res: Response, promise: Promise<any>) {
  promise.then(data => res.json(data)).catch((err: any) => res.status(500).json({ error: err.message }))
}

router.get('/notebooks', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch('/notebooks')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/notebooks', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch('/notebooks', {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.delete('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmFetch(`/notebooks/${req.params.id}`, { method: 'DELETE' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/notebooks/:id/sources', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/sources`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/notebooks/:id/sources/url', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/sources/url`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/notebooks/:id/sources/text', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/sources/text`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.delete('/notebooks/:id/sources/:sourceId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmFetch(`/notebooks/${req.params.id}/sources/${req.params.sourceId}`, { method: 'DELETE' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/notebooks/:id/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/chat`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/artifacts`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/artifacts`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/notebooks/:id/artifacts/:taskId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/artifacts/${req.params.taskId}`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/notebooks/:id/notes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/notes`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/notebooks/:id/notes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmFetch(`/notebooks/${req.params.id}/notes`, {
      method: 'POST',
      body: JSON.stringify(req.body),
    })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/health', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const res2 = await fetch(`${NLM_SERVER}/healthz`)
    const ok = res2.ok
    res.json({ connected: ok })
  } catch {
    res.json({ connected: false })
  }
})

export default router
