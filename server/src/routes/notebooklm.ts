import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { execFile } from 'child_process'

const router = Router()

const NLM_BIN = process.env.NOTEBOOKLM_BIN || 'notebooklm'

function nlmRun(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(NLM_BIN, [...args, '--json'], { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

function nlmJson(args: string[], timeout = 30000): Promise<any> {
  return nlmRun(args, timeout).then(out => JSON.parse(out))
}

function nb(id: unknown): string { return String(id) }

router.get('/notebooks', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const data = await nlmJson(['list'])
    res.json({ notebooks: data.notebooks || data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const title = String(req.body.title || 'Untitled')
    const data = await nlmJson(['create', title])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmJson(['summary', nb(req.params.id)])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['delete', nb(req.params.id)])
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/sources', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmJson(['source', 'list', nb(req.params.id)])
    res.json({ sources: data.sources || data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/sources/url', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const url = String(req.body.url || '')
    const data = await nlmJson(['source', 'add', nb(req.params.id), url])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/sources/text', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const text = String(req.body.text || '')
    const title = req.body.title ? String(req.body.title) : undefined
    const args = ['source', 'add', nb(req.params.id), '--text', text]
    if (title) args.push('--title', title)
    const data = await nlmJson(args)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/notebooks/:id/sources/:sourceId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['source', 'delete', nb(req.params.id), nb(req.params.sourceId)])
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const question = String(req.body.question || '')
    const data = await nlmJson(['ask', nb(req.params.id), question], 60000)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmJson(['artifact', 'list', nb(req.params.id)])
    res.json({ artifacts: data.artifacts || data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const type = String(req.body.type || '')
    const data = await nlmJson(['artifact', 'generate', nb(req.params.id), type], 120000)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/notes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await nlmJson(['note', 'list', nb(req.params.id)])
    res.json({ notes: data.notes || data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/health', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['list'], 5000)
    res.json({ connected: true })
  } catch {
    res.json({ connected: false })
  }
})

export default router
