import { Router, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'

const prisma = new PrismaClient()
const router = Router()

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/google/callback'

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

router.get('/auth', async (req: AuthRequest, res: Response) => {
  const token = req.query.token as string
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return }

  let userId: string
  try {
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string }
    userId = decoded.userId
  } catch { res.status(401).json({ error: 'Invalid token' }); return }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: userId,
  })
  res.redirect(`https://accounts.google.com/o/oauth2/auth?${params.toString()}`)
})

router.get('/callback', async (req: AuthRequest, res: Response) => {
  const { code, state, error } = req.query
  const userId = state as string
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  if (error || !code) {
    res.redirect(`${frontendUrl}/google-drive?error=auth_failed`)
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

    await prisma.googleDrive.upsert({
      where: { userId },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt,
        email,
      },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAt,
        email,
      },
    })

    res.redirect(`${frontendUrl}/google-drive?success=true`)
  } catch (err) {
    res.redirect(`${frontendUrl}/google-drive?error=${encodeURIComponent((err as Error).message)}`)
  }
})

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  let drive = await prisma.googleDrive.findUnique({ where: { userId: req.userId! } })
  if (!drive) { res.json({ connected: false }); return }

  if (drive.expiresAt < new Date() && drive.refreshToken) {
    const refreshed = await refreshAccessToken(drive.refreshToken)
    if (refreshed) {
      drive = await prisma.googleDrive.update({
        where: { userId: req.userId! },
        data: {
          accessToken: refreshed.access_token,
          expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        },
      })
    }
  }

  const expired = drive.expiresAt < new Date()
  res.json({ connected: true, expired, email: drive.email })
})

router.post('/refresh', requireAuth, async (req: AuthRequest, res: Response) => {
  const drive = await prisma.googleDrive.findUnique({ where: { userId: req.userId! } })
  if (!drive) { res.status(404).json({ error: 'Not connected' }); return }
  if (!drive.refreshToken) { res.status(400).json({ error: 'No refresh token' }); return }

  const refreshed = await refreshAccessToken(drive.refreshToken)
  if (!refreshed) { res.status(400).json({ error: 'Failed to refresh token' }); return }

  await prisma.googleDrive.update({
    where: { userId: req.userId! },
    data: {
      accessToken: refreshed.access_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  })

  res.json({ ok: true, expired: false })
})

router.post('/disconnect', requireAuth, async (req: AuthRequest, res: Response) => {
  await prisma.googleDrive.deleteMany({ where: { userId: req.userId! } })
  res.json({ ok: true })
})

export default router
