import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { execFile } from 'child_process'

const router = Router()

const NLM_BIN = process.env.NOTEBOOKLM_BIN || 'notebooklm'

function nlmRun(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(NLM_BIN, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

function nlmJson(args: string[], timeout = 30000): Promise<any> {
  return nlmRun(args, timeout).then(out => {
    try { return JSON.parse(out) } catch { return out }
  })
}

function nbId(id: unknown): string { return String(id) }

router.get('/notebooks', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const data = await nlmJson(['list', '--json'])
    res.json({ notebooks: data.notebooks || data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const title = String(req.body.title || 'Untitled')
    const data = await nlmJson(['create', title, '--json'])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = nbId(req.params.id)
    await nlmRun(['use', id])
    const data = await nlmJson(['summary', '--json'])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['use', nbId(req.params.id)])
    await nlmRun(['delete'])
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/sources', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = nbId(req.params.id)
    await nlmRun(['use', id])
    const data = await nlmJson(['source', 'list', '--json'])
    const sources = Array.isArray(data) ? data : (data?.sources || [])
    res.json({ sources })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/sources/url', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const url = String(req.body.url || '')
    await nlmRun(['use', nbId(req.params.id)])
    const data = await nlmJson(['source', 'add', url, '--json'])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/sources/text', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const text = String(req.body.text || '')
    const title = req.body.title ? String(req.body.title) : undefined
    await nlmRun(['use', nbId(req.params.id)])
    const args = ['source', 'add', '--text', text]
    if (title) args.push('--title', title)
    args.push('--json')
    const data = await nlmJson(args)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/notebooks/:id/sources/:sourceId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['use', nbId(req.params.id)])
    await nlmRun(['source', 'delete', nbId(req.params.sourceId)])
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const question = String(req.body.question || '')
    await nlmRun(['use', nbId(req.params.id)])
    const data = await nlmJson(['ask', question, '--json'], 60000)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['use', nbId(req.params.id)])
    const data = await nlmJson(['artifact', 'list', '--json'])
    const artifacts = Array.isArray(data) ? data : (data?.artifacts || [])
    res.json({ artifacts })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const type = String(req.body.type || '')
    await nlmRun(['use', nbId(req.params.id)])
    const data = await nlmJson(['artifact', 'generate', type, '--json'], 120000)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/notes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['use', nbId(req.params.id)])
    const data = await nlmJson(['note', 'list', '--json'])
    const notes = Array.isArray(data) ? data : (data?.notes || [])
    res.json({ notes })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/health', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    await nlmRun(['list', '--json'], 5000)
    res.json({ connected: true })
  } catch {
    res.json({ connected: false })
  }
})

export default router
