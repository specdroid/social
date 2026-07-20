import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const prisma = new PrismaClient()
const router = Router()

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/google/callback'
const NLM_BIN = process.env.NOTEBOOKLM_BIN || 'notebooklm'

const SCOPES = ['https://www.googleapis.com/auth/drive']

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data: any = await res.json()
  if (data.error) return null
  return data
}

async function getAccessToken(driveId: string): Promise<string> {
  let drive = await prisma.googleDrive.findUnique({ where: { id: driveId } })
  if (!drive) throw new AppError(404, 'Google Drive not found')
  if (drive.expiresAt < new Date() && drive.refreshToken) {
    const refreshed = await refreshAccessToken(drive.refreshToken)
    if (refreshed) {
      drive = await prisma.googleDrive.update({
        where: { id: driveId },
        data: { accessToken: refreshed.access_token, expiresAt: new Date(Date.now() + refreshed.expires_in * 1000) },
      })
    }
  }
  if (drive.expiresAt < new Date()) throw new AppError(400, 'Google Drive token expired, please reconnect')
  return drive.accessToken
}

async function getAccessTokenForUser(userId: string): Promise<string> {
  const drive = await prisma.googleDrive.findFirst({ where: { userId } })
  if (!drive) throw new AppError(400, 'Google Drive not connected')
  return getAccessToken(drive.id)
}

async function uploadToGoogleDrive(accessToken: string, fileName: string, mimeType: string, content: string | Buffer, parentFolderId?: string) {
  const metadata: any = { name: fileName, mimeType }
  if (parentFolderId) metadata.parents = [parentFolderId]

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([content], { type: mimeType }))

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  const data: any = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data
}

// ── OAuth: start ──
router.get('/auth', async (req: AuthRequest, res: Response) => {
  const token = req.query.token as string
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return }

  let userId: string
  try {
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    userId = decoded.userId
  } catch { res.status(401).json({ error: 'Invalid token' }); return }

  const label = (req.query.label as string) || 'My Drive'
  const state = JSON.stringify({ userId, label })

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  res.redirect(`https://accounts.google.com/o/oauth2/auth?${params.toString()}`)
})

// ── OAuth: callback ──
router.get('/callback', async (req: AuthRequest, res: Response) => {
  const { code, state: stateStr, error } = req.query
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  if (error || !code) {
    res.redirect(`${frontendUrl}/google-drive?error=auth_failed`)
    return
  }

  let userId: string
  let label: string
  try {
    const parsed = JSON.parse(stateStr as string)
    userId = parsed.userId
    label = parsed.label || 'My Drive'
  } catch {
    res.redirect(`${frontendUrl}/google-drive?error=invalid_state`)
    return
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    const tokens: any = await tokenRes.json()
    if (tokens.error) throw new AppError(400, tokens.error_description || tokens.error)

    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000)

    let email: string | null = null
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      const userInfo: any = await userInfoRes.json()
      email = userInfo.email || null
    } catch { /* ignore */ }

    if (!email) {
      try {
        const aboutRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        const about: any = await aboutRes.json()
        email = about?.user?.emailAddress || null
      } catch { /* ignore */ }
    }

    await prisma.googleDrive.create({
      data: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAt,
        email,
        label,
      },
    })

    res.redirect(`${frontendUrl}/google-drive?success=true`)
  } catch (err) {
    res.redirect(`${frontendUrl}/google-drive?error=${encodeURIComponent((err as Error).message)}`)
  }
})

// ── List all drives ──
router.get('/drives', requireAuth, async (req: AuthRequest, res: Response) => {
  const drives = await prisma.googleDrive.findMany({
    where: { userId: req.userId! },
    select: { id: true, email: true, label: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const drivesWithStorage = await Promise.all(drives.map(async (d) => {
    try {
      const accessToken = await getAccessToken(d.id)
      const aboutRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const about: any = await aboutRes.json()
      const q = about.storageQuota || {}
      return {
        ...d,
        storageLimit: q.limit ? parseInt(q.limit, 10) : null,
        storageUsed: q.usageInDrive ? parseInt(q.usageInDrive, 10) : null,
        storageTrash: q.usageInDriveTrash ? parseInt(q.usageInDriveTrash, 10) : null,
      }
    } catch {
      return { ...d, storageLimit: null, storageUsed: null, storageTrash: null }
    }
  }))

  res.json({ drives: drivesWithStorage })
})

// ── Status (backward compat: returns first drive) ──
router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const drive = await prisma.googleDrive.findFirst({ where: { userId: req.userId! } })
  if (!drive) { res.json({ connected: false }); return }

  if (drive.expiresAt < new Date() && drive.refreshToken) {
    const refreshed = await refreshAccessToken(drive.refreshToken)
    if (refreshed) {
      await prisma.googleDrive.update({
        where: { id: drive.id },
        data: { accessToken: refreshed.access_token, expiresAt: new Date(Date.now() + refreshed.expires_in * 1000) },
      })
    }
  }

  const updated = await prisma.googleDrive.findFirst({ where: { userId: req.userId! } })
  const expired = (updated?.expiresAt || drive.expiresAt) < new Date()
  res.json({ connected: true, expired, email: updated?.email || drive.email })
})

// ── Disconnect specific drive ──
router.post('/disconnect/:driveId', requireAuth, async (req: AuthRequest, res: Response) => {
  const driveId = String(req.params.driveId)
  const drive = await prisma.googleDrive.findFirst({ where: { id: driveId, userId: req.userId! } })
  if (!drive) { res.status(404).json({ error: 'Drive not found' }); return }
  await prisma.googleDrive.delete({ where: { id: drive.id } })
  res.json({ ok: true })
})

// ── Disconnect all drives ──
router.post('/disconnect', requireAuth, async (req: AuthRequest, res: Response) => {
  await prisma.googleDrive.deleteMany({ where: { userId: req.userId! } })
  res.json({ ok: true })
})

// ── Refresh specific drive ──
router.post('/refresh/:driveId', requireAuth, async (req: AuthRequest, res: Response) => {
  const drive = await prisma.googleDrive.findFirst({ where: { id: String(req.params.driveId), userId: req.userId! } })
  if (!drive) { res.status(404).json({ error: 'Drive not found' }); return }
  if (!drive.refreshToken) { res.status(400).json({ error: 'No refresh token' }); return }

  const refreshed = await refreshAccessToken(drive.refreshToken)
  if (!refreshed) { res.status(400).json({ error: 'Failed to refresh token' }); return }

  await prisma.googleDrive.update({
    where: { id: drive.id },
    data: { accessToken: refreshed.access_token, expiresAt: new Date(Date.now() + refreshed.expires_in * 1000) },
  })
  res.json({ ok: true, expired: false })
})

// ── Browse files in a drive ──
router.get('/drive/:driveId/files', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const drive = await prisma.googleDrive.findFirst({ where: { id: String(req.params.driveId), userId: req.userId! } })
    if (!drive) { res.status(404).json({ error: 'Drive not found' }); return }

    const accessToken = await getAccessToken(drive.id)
    const folderId = (req.query.folderId as string) || 'root'

    const q = `'${folderId}' in parents and trashed = false`
    const fields = 'files(id,name,mimeType,size,modifiedTime,parents,webViewLink)'
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${fields}&orderBy=name&pageSize=100`

    const result = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    const data: any = await result.json()
    if (data.error) throw new Error(data.error.message)

    res.json({ files: data.files || [], folderId })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Create folder in a drive ──
router.post('/drive/:driveId/folder', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const drive = await prisma.googleDrive.findFirst({ where: { id: String(req.params.driveId), userId: req.userId! } })
    if (!drive) { res.status(404).json({ error: 'Drive not found' }); return }

    const accessToken = await getAccessToken(drive.id)
    const { name, parentFolderId } = req.body as { name: string; parentFolderId?: string }

    const metadata: any = { name, mimeType: 'application/vnd.google-apps.folder' }
    if (parentFolderId) metadata.parents = [parentFolderId]

    const result = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    })
    const data: any = await result.json()
    if (data.error) throw new Error(data.error.message)

    res.json({ ok: true, folder: data })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Upload file to a drive ──
router.post('/drive/:driveId/upload', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const drive = await prisma.googleDrive.findFirst({ where: { id: String(req.params.driveId), userId: req.userId! } })
    if (!drive) { res.status(404).json({ error: 'Drive not found' }); return }

    const accessToken = await getAccessToken(drive.id)
    const { fileName, mimeType, content, folderId } = req.body as {
      fileName: string; mimeType: string; content: string; folderId?: string
    }

    if (!fileName || !content) { res.status(400).json({ error: 'fileName and content are required' }); return }

    const result = await uploadToGoogleDrive(accessToken, fileName, mimeType || 'text/plain', content, folderId)
    res.json({ ok: true, file: result })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Download file from a drive (accepts token via query param for browser downloads) ──
router.get('/drive/:driveId/download/:fileId', async (req: AuthRequest, res: Response) => {
  const token = (req.query.token as string) || (req.headers.authorization?.replace('Bearer ', '') || '')
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return }
  try {
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    req.userId = decoded.userId
  } catch { res.status(401).json({ error: 'Invalid token' }); return }
  try {
    const drive = await prisma.googleDrive.findFirst({ where: { id: String(req.params.driveId), userId: req.userId! } })
    if (!drive) { res.status(404).json({ error: 'Drive not found' }); return }

    const accessToken = await getAccessToken(drive.id)

    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${req.params.fileId}?fields=name,mimeType,size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const meta: any = await metaRes.json()
    if (meta.error) throw new Error(meta.error.message)

    const result = await fetch(`https://www.googleapis.com/drive/v3/files/${req.params.fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!result.ok) throw new Error(`Download failed: ${result.statusText}`)

    const contentType = result.headers.get('content-type') || 'application/octet-stream'
    const contentDisp = `attachment; filename="${(meta.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}"`
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Disposition', contentDisp)
    if (meta.size) res.setHeader('Content-Length', meta.size)

    const reader = (result.body as any).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
    res.end()
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// ── Delete file from a drive ──
router.delete('/drive/:driveId/file/:fileId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const drive = await prisma.googleDrive.findFirst({ where: { id: String(req.params.driveId), userId: req.userId! } })
    if (!drive) { res.status(404).json({ error: 'Drive not found' }); return }

    const accessToken = await getAccessToken(drive.id)
    const result = await fetch(`https://www.googleapis.com/drive/v3/files/${req.params.fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!result.ok) {
      const err: any = await result.json()
      throw new Error(err.error?.message || 'Delete failed')
    }
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── NotebookLM export helpers ──
function nlmRun(args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(NLM_BIN, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout.trim())
    })
  })
}

function flashcardsToCsv(data: any): string {
  const cards = data.flashcards || data.cards || data
  if (!Array.isArray(cards)) return 'Front,Back\n'
  let csv = 'Front,Back\n'
  for (const card of cards) {
    const front = String(card.front || card.term || card.question || '').replace(/"/g, '""')
    const back = String(card.back || card.definition || card.answer || '').replace(/"/g, '""')
    csv += `"${front}","${back}"\n`
  }
  return csv
}

function quizToCsv(data: any): string {
  const questions = data.questions || data.quiz || data
  if (!Array.isArray(questions)) return 'Question,Answer\n'
  let csv = 'Question,Answer,Options\n'
  for (const q of questions) {
    const question = String(q.question || '').replace(/"/g, '""')
    const answer = String(q.answer || q.correct || '').replace(/"/g, '""')
    const options = Array.isArray(q.options) ? q.options.join(' | ') : ''
    csv += `"${question}","${answer}","${options.replace(/"/g, '""')}"\n`
  }
  return csv
}

router.post('/export', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { notebookId, artifactId, type, driveId } = req.body as {
      notebookId: string; artifactId: string; type: string; driveId?: string
    }
    if (!notebookId || !artifactId || !type) {
      res.status(400).json({ error: 'notebookId, artifactId, and type are required' })
      return
    }

    const accessToken = driveId
      ? await getAccessToken(driveId)
      : await getAccessTokenForUser(req.userId!)

    await nlmRun(['use', notebookId], 60000)
    const artifact = await nlmRun(['artifact', 'get', artifactId, '--json'], 60000)
    const artifactData = JSON.parse(artifact)
    const artifactType = (artifactData?.type_id || artifactData?.type || '').replace(/_/g, '-')
    const title = artifactData?.title || 'NotebookLM Export'

    if (type === 'google-sheets') {
      const tmpDir = `/tmp/nlm-export-${Date.now()}`
      fs.mkdirSync(tmpDir, { recursive: true })
      const outputPath = `${tmpDir}/artifact.json`
      await nlmRun(['download', artifactType, '--artifact', artifactId, outputPath], 300000)

      const allFiles: string[] = []
      const listFiles = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = `${dir}/${f.name}`
          if (f.isDirectory()) listFiles(p)
          else allFiles.push(p)
        }
      }
      listFiles(tmpDir)
      const jsonFile = allFiles.find((f: string) => f.endsWith('.json'))
      if (!jsonFile) { fs.rmSync(tmpDir, { recursive: true, force: true }); throw new Error('No JSON data found') }
      const fileContent = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'))
      fs.rmSync(tmpDir, { recursive: true, force: true })

      let csv: string
      if (artifactType === 'flashcards') csv = flashcardsToCsv(fileContent)
      else if (artifactType === 'quiz') csv = quizToCsv(fileContent)
      else csv = flashcardsToCsv(fileContent)

      const result = await uploadToGoogleDrive(accessToken, `${title}.csv`, 'text/csv', csv)
      res.json({ ok: true, fileId: result.id, url: `https://docs.google.com/spreadsheets/d/${result.id}`, name: `${title}.csv` })
    } else if (type === 'google-docs') {
      const tmpDir = `/tmp/nlm-export-${Date.now()}`
      fs.mkdirSync(tmpDir, { recursive: true })
      const outputPath = `${tmpDir}/artifact.md`
      await nlmRun(['download', artifactType, '--artifact', artifactId, outputPath], 300000)

      const allFiles: string[] = []
      const listFiles = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = `${dir}/${f.name}`
          if (f.isDirectory()) listFiles(p)
          else allFiles.push(p)
        }
      }
      listFiles(tmpDir)
      const mdFile = allFiles.find((f: string) => f.endsWith('.md') || f.endsWith('.txt'))
      if (!mdFile) { fs.rmSync(tmpDir, { recursive: true, force: true }); throw new Error('No document content found') }
      const mdContent = fs.readFileSync(mdFile, 'utf-8')
      fs.rmSync(tmpDir, { recursive: true, force: true })

      const result = await uploadToGoogleDrive(accessToken, `${title}.md`, 'text/markdown', mdContent)
      res.json({ ok: true, fileId: result.id, url: `https://docs.google.com/document/d/${result.id}`, name: `${title}.md` })
    } else {
      res.status(400).json({ error: 'type must be "google-sheets" or "google-docs"' })
    }
  } catch (err: any) {
    console.error('[google export]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
