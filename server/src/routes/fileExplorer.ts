import { Router, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { requireAuth } from '../middleware/auth'
import { requireMaster } from '../middleware/requireMaster'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'

const router = Router()

const BASE_DIR = path.resolve(process.cwd())
const ALLOWED_DIRS = ['uploads', 'telegram/uploads', 'telegram/downloads']

router.use(requireAuth)
router.use(requireMaster)

function ensureAllowedDir(dirPath: string): void {
  const resolved = path.resolve(dirPath)
  const allowed = ALLOWED_DIRS.some((d) => resolved.startsWith(path.resolve(BASE_DIR, d)))
  if (!allowed) throw new AppError(403, 'Access denied: only telegram/uploads and telegram/downloads are accessible')
}

router.get('/list', async (req: AuthRequest, res: Response) => {
  const dir = typeof req.query.dir === 'string' ? req.query.dir : ''
  const target = dir ? path.resolve(BASE_DIR, dir) : BASE_DIR
  ensureAllowedDir(target)

  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true })
    for (const d of ALLOWED_DIRS) {
      fs.mkdirSync(path.resolve(BASE_DIR, d), { recursive: true })
    }
  }

  const entries = fs.readdirSync(target, { withFileTypes: true }).map((e) => {
    const fullPath = path.resolve(target, e.name)
    const stat = fs.statSync(fullPath)
    return {
      name: e.name,
      isDir: e.isDirectory(),
      size: e.isDirectory() ? null : stat.size,
      modified: stat.mtime.toISOString(),
      path: path.relative(BASE_DIR, fullPath),
    }
  })

  const dirs = entries.filter((e) => e.isDir).sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter((e) => !e.isDir).sort((a, b) => a.name.localeCompare(b.name))

  res.json({ dir: path.relative(BASE_DIR, target) || '.', items: [...dirs, ...files] })
})

router.delete('/file', async (req: AuthRequest, res: Response) => {
  const filePath = req.body.path as string
  if (!filePath) throw new AppError(400, 'File path required')
  const target = path.resolve(BASE_DIR, filePath)
  ensureAllowedDir(target)

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    throw new AppError(404, 'File not found')
  }

  fs.unlinkSync(target)
  res.json({ ok: true })
})

router.delete('/folder', async (req: AuthRequest, res: Response) => {
  const folderPath = req.body.path as string
  if (!folderPath) throw new AppError(400, 'Folder path required')
  const target = path.resolve(BASE_DIR, folderPath)
  ensureAllowedDir(target)

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new AppError(404, 'Folder not found')
  }

  fs.rmSync(target, { recursive: true, force: true })
  res.json({ ok: true })
})

router.delete('/bulk', async (req: AuthRequest, res: Response) => {
  const paths = req.body.paths as string[]
  if (!Array.isArray(paths) || paths.length === 0) throw new AppError(400, 'Paths array required')

  const results: Array<{ path: string; ok: boolean; error?: string }> = []
  for (const p of paths) {
    const target = path.resolve(BASE_DIR, p)
    try {
      ensureAllowedDir(target)
      if (!fs.existsSync(target)) { results.push({ path: p, ok: false, error: 'Not found' }); continue }
      fs.rmSync(target, { recursive: true, force: true })
      results.push({ path: p, ok: true })
    } catch (err) {
      results.push({ path: p, ok: false, error: (err as Error).message })
    }
  }

  res.json({ results })
})

export default router
