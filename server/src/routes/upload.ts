import { Router, Response } from 'express'
import multer from 'multer'
import path from 'path'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'

const storage = multer.diskStorage({
  destination: path.resolve(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + '-' + file.originalname)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
})

const router = Router()

router.post('/', requireAuth, upload.array('files', 10), (req: AuthRequest, res: Response) => {
  const files = req.files as Express.Multer.File[]
  const baseUrl = `${req.protocol}://${req.get('host')}`
  const urls = files.map((f) => `${baseUrl}/uploads/${f.filename}`)
  res.json({ urls })
})

export default router
