import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { execFile } from 'child_process'

const router = Router()

const NLM_BIN = process.env.NOTEBOOKLM_BIN || 'notebooklm'

let nlmQueue: Promise<any> = Promise.resolve()
let downloadRunning = false

function nlmRun(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(NLM_BIN, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

function nlmRunWithStderr(args: string[], timeout = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(NLM_BIN, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
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
  const artId = String(req.params.artifactId)
  const nbId = String(req.params.id)
  console.log(`[download] START artifact=${artId} notebook=${nbId}`)

  if (downloadRunning) {
    console.log('[download] Another download in progress, returning 429')
    res.status(429).json({ error: 'Another download is in progress, please wait' })
    return
  }
  downloadRunning = true

  try {
    await nlmRun(['use', nbId], 60000)
    console.log('[download] use done')

    const artifact = await nlmJson(['artifact', 'get', artId, '--json'], 60000)
    const artifactType = (artifact?.type_id || artifact?.type || 'report').replace(/_/g, '-')
    const artifactTitle = artifact?.title || artId
    console.log(`[download] artifact type=${artifactType} title=${artifactTitle} status=${artifact?.status}`)

    const tmpDir = `/tmp/nlm-dl-${Date.now()}`
    const fs = require('fs')
    fs.mkdirSync(tmpDir, { recursive: true })

    const extMap: Record<string, string> = {
      'slide-deck': 'pdf', quiz: 'json', flashcards: 'json',
      audio: 'mp3', report: 'md', infographic: 'png',
      'mind-map': 'png', 'data-table': 'csv',
    }
    const fileExt = extMap[artifactType] || 'bin'
    const outputPath = `${tmpDir}/artifact.${fileExt}`

    console.log(`[download] running: notebooklm download ${artifactType} --artifact ${artId} ${outputPath}`)
    const { stdout, stderr } = await nlmRunWithStderr(['download', artifactType, '--artifact', artId, outputPath], 600000)
    console.log(`[download] CLI stdout: ${stdout}`)
    console.log(`[download] CLI stderr: ${stderr}`)

    function listFilesRecursive(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const fullPath = `${dir}/${entry.name}`
        if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath))
        else files.push(fullPath)
      }
      return files
    }

    const allFiles = listFilesRecursive(tmpDir)
    console.log(`[download] Files found: ${JSON.stringify(allFiles.map(f => ({ path: f, size: fs.statSync(f).size })))}`)

    const downloadFile = allFiles.find((f: string) => !f.includes('.state') && !f.endsWith('.pyc'))
      || allFiles[0]
    if (!downloadFile) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      console.log('[download] No download file found')
      res.status(404).json({ error: 'No file downloaded', details: stdout || stderr })
      return
    }

    const fileSize = fs.statSync(downloadFile).size
    console.log(`[download] file: ${downloadFile} size: ${fileSize}`)

    if (fileSize === 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      console.log('[download] File is empty')
      res.status(500).json({ error: 'Downloaded file is empty', details: stdout || stderr })
      return
    }

    const ext = downloadFile.split('.').pop() || ''
    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg', pdf: 'application/pdf', md: 'text/markdown',
      csv: 'text/csv', json: 'application/json', png: 'image/png',
      jpg: 'image/jpeg', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }
    console.log(`[download] sending file ${downloadFile} ext=${ext}`)
    res.setHeader('Content-Disposition', `attachment; filename="${artifactTitle}.${ext}"`)
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream')
    res.sendFile(downloadFile, () => { fs.rmSync(tmpDir, { recursive: true, force: true }) })
  } catch (err: any) {
    console.error('[download] ERROR:', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    downloadRunning = false
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
