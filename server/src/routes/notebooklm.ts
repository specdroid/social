import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { execFile } from 'child_process'

const router = Router()

const NLM_BIN = process.env.NOTEBOOKLM_BIN || 'notebooklm'

let nlmQueue: Promise<any> = Promise.resolve()

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

function sequential(notebookId: unknown, cmd: string[], timeout = 30000): Promise<any> {
  const id = notebookId ? String(notebookId) : null
  const run = async () => {
    if (id) await nlmRun(['use', id], timeout)
    return nlmJson(cmd, timeout)
  }
  nlmQueue = nlmQueue.then(run, run)
  return nlmQueue
}

router.get('/notebooks', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const data = await sequential(null, ['list', '--json'])
    res.json({ notebooks: data.notebooks || data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const title = String(req.body.title || 'Untitled')
    const data = await sequential(null, ['create', title, '--json'])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await sequential(req.params.id, ['summary', '--json'])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/notebooks/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await sequential(req.params.id, ['delete'])
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/sources', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await sequential(req.params.id, ['source', 'list', '--json'])
    const sources = Array.isArray(data) ? data : (data?.sources || [])
    res.json({ sources })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/sources/url', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const url = String(req.body.url || '')
    const data = await sequential(req.params.id, ['source', 'add', url, '--json'])
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/sources/text', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const text = String(req.body.text || '')
    const title = req.body.title ? String(req.body.title) : undefined
    const args = ['source', 'add', '--text', text]
    if (title) args.push('--title', title)
    args.push('--json')
    const data = await sequential(req.params.id, args)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/notebooks/:id/sources/:sourceId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await sequential(req.params.id, ['source', 'delete', String(req.params.sourceId)])
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/sources/:sourceId/fulltext', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await sequential(req.params.id, ['source', 'fulltext', String(req.params.sourceId), '--json'], 30000)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const question = String(req.body.question || '')
    const data = await sequential(req.params.id, ['ask', question, '--json'], 120000)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await sequential(req.params.id, ['artifact', 'list', '--json'])
    const artifacts = Array.isArray(data) ? data : (data?.artifacts || [])
    res.json({ artifacts })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/notebooks/:id/artifacts', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const type = String(req.body.type || '')
    const data = await sequential(req.params.id, ['generate', type, '--json'], 120000)
    res.json(data)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/artifacts/:artifactId/download', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const artId = String(req.params.artifactId)
    const nbId = String(req.params.id)

    await sequential(nbId, ['use', nbId])
    const artifact = await nlmJson(['artifact', 'get', artId, '--json'])
    const artifactType = (artifact?.type_id || artifact?.type || 'report').replace(/_/g, '-')
    const artifactTitle = artifact?.title || artId

    const tmpDir = `/tmp/nlm-dl-${Date.now()}`
    const fs = require('fs')
    fs.mkdirSync(tmpDir, { recursive: true })

    const outputPath = `${tmpDir}/download`
    await nlmRun(['download', artifactType, '--artifact', artId, outputPath], 300000)

    const files = fs.readdirSync(tmpDir).filter((f: string) => !f.startsWith('.'))
    if (files.length === 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      res.status(404).json({ error: 'No file downloaded' })
      return
    }

    const filePath = `${tmpDir}/${files[0]}`
    const ext = files[0].split('.').pop() || ''
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', pdf: 'application/pdf', md: 'text/markdown',
      csv: 'text/csv', json: 'application/json', png: 'image/png',
      jpg: 'image/jpeg', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    res.setHeader('Content-Disposition', `attachment; filename="${artifactTitle}.${ext}"`)
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream')
    res.sendFile(filePath, () => { fs.rmSync(tmpDir, { recursive: true, force: true }) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/notebooks/:id/notes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await sequential(req.params.id, ['note', 'list', '--json'])
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
