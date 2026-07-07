import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { PrismaClient } from '@prisma/client'
import { getWhatsAppStatus, disconnectWhatsApp, getConnectionState, getLatestQrDataUrl, sendTestMessage, cleanupAuthFolder, clearCredentials, forceCleanAuth, getContacts, clearContacts, deleteContact, resyncContacts, importVcf, getContactGroups, createContactGroup, updateContactGroup, deleteContactGroup, getImportedContacts, deleteImportedContact, clearImportedContacts, addImportedContact, getOwnProfile } from '../services/whatsappBot'
import dns, { Resolver } from 'dns/promises'
import net from 'net'
import https from 'https'
import multer from 'multer'

const vcfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.vcf') || file.mimetype === 'text/vcard' || file.mimetype === 'text/x-vcard') {
      cb(null, true)
    } else {
      cb(new Error('Only .vcf files are allowed'))
    }
  },
})

const router = Router()
const prisma = new PrismaClient()
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function resolveWithServers(host: string, servers: string[]): Promise<{ addresses?: string[]; error?: string }> {
  const resolver = new Resolver()
  resolver.setServers(servers)
  try {
    const addresses = await resolver.resolve4(host)
    return { addresses }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

async function resolveWithFallback(host: string, nameserverSets: string[][]): Promise<{ addresses?: string[]; error?: string; tried: string[] }> {
  const tried: string[] = []
  for (const servers of nameserverSets) {
    tried.push(...servers)
    const result = await resolveWithServers(host, servers)
    if (result.addresses) return { addresses: result.addresses, tried }
  }
  return { error: 'All DNS servers failed', tried }
}

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const state = getConnectionState()
  res.json(state)
})

router.get('/own-profile', requireAuth, async (_req: AuthRequest, res: Response) => {
  const profile = getOwnProfile()
  res.json(profile)
})

router.get('/contacts', requireAuth, async (req: AuthRequest, res: Response) => {
  const contacts = await getContacts()
  res.json({ contacts })
})

router.delete('/contacts', requireAuth, async (_req: AuthRequest, res: Response) => {
  const deleted = clearContacts()
  res.json({ ok: true, deleted })
})

// Imported contacts sub-routes must come before /contacts/:id
router.get('/contacts/imported', requireAuth, async (_req: AuthRequest, res: Response) => {
  const contacts = getImportedContacts()
  res.json({ contacts })
})

router.delete('/contacts/imported/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const ok = deleteImportedContact(String(req.params.id))
  if (!ok) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }
  res.json({ ok: true })
})

router.delete('/contacts/imported', requireAuth, async (_req: AuthRequest, res: Response) => {
  const count = clearImportedContacts()
  res.json({ ok: true, deleted: count })
})

router.post('/contacts/imported', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, phoneNumber } = req.body
  if (!phoneNumber) {
    res.status(400).json({ error: 'phoneNumber is required' })
    return
  }
  const contact = addImportedContact(String(name || ''), String(phoneNumber))
  if (!contact) {
    res.status(409).json({ error: 'Contact already exists or invalid phone number' })
    return
  }
  res.json({ contact })
})

router.delete('/contacts/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const ok = deleteContact(String(req.params.id))
  if (!ok) {
    res.status(404).json({ error: 'Contact not found' })
    return
  }
  res.json({ ok: true })
})

router.post('/contacts/resync', requireAuth, async (req: AuthRequest, res: Response) => {
  const result = await resyncContacts()
  res.json(result)
})

router.post('/contacts/import-vcf', requireAuth, vcfUpload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }
  const content = req.file.buffer.toString('utf-8')
  const result = importVcf(content)
  res.json(result)
})

// Contact Groups
router.get('/contact-groups', requireAuth, async (_req: AuthRequest, res: Response) => {
  const groups = getContactGroups()
  res.json({ groups })
})

router.post('/contact-groups', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, memberJids } = req.body
  if (!name || !Array.isArray(memberJids)) {
    res.status(400).json({ error: 'name (string) and memberJids (string[]) are required' })
    return
  }
  const group = createContactGroup(String(name), memberJids)
  res.json({ group })
})

router.put('/contact-groups/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, memberJids } = req.body
  if (!name || !Array.isArray(memberJids)) {
    res.status(400).json({ error: 'name (string) and memberJids (string[]) are required' })
    return
  }
  const group = updateContactGroup(String(req.params.id), String(name), memberJids)
  if (!group) {
    res.status(404).json({ error: 'Group not found' })
    return
  }
  res.json({ group })
})

router.delete('/contact-groups/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const ok = deleteContactGroup(String(req.params.id))
  if (!ok) {
    res.status(404).json({ error: 'Group not found' })
    return
  }
  res.json({ ok: true })
})

router.get('/qr', requireAuth, async (req: AuthRequest, res: Response) => {
  const qr = getLatestQrDataUrl()
  if (qr) {
    res.json({ qr })
  } else {
    res.status(404).json({ error: 'No QR code available' })
  }
})

router.post('/disconnect', requireAuth, async (req: AuthRequest, res: Response) => {
  await disconnectWhatsApp(req.userId!)
  res.json({ ok: true })
})

router.post('/send-test', requireAuth, async (_req: AuthRequest, res: Response) => {
  const result = await sendTestMessage()
  if (result.ok) {
    res.json({ ok: true, message: 'Test message sent' })
  } else {
    res.status(400).json({ error: result.error || 'Failed to send message' })
  }
})

router.post('/cleanup-auth', requireAuth, async (_req: AuthRequest, res: Response) => {
  const result = cleanupAuthFolder()
  res.json({ ok: true, deleted: result.deleted, keptCreds: result.keptCreds })
})

router.post('/clear-credentials', requireAuth, async (_req: AuthRequest, res: Response) => {
  const result = clearCredentials()
  res.json({ ok: true, deleted: result.deleted })
})

router.post('/force-clean-auth', requireAuth, async (_req: AuthRequest, res: Response) => {
  forceCleanAuth()
  res.json({ ok: true })
})

// Saved Group Lists
router.get('/group-lists', requireAuth, async (_req: AuthRequest, res: Response) => {
  const lists = await prisma.savedGroupList.findMany({ orderBy: { createdAt: 'desc' } })
  res.json({ lists: lists.map((l: Record<string, unknown>) => ({ ...l, groups: JSON.parse(l.groups as string) })) })
})

router.put('/group-lists/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, groups } = req.body
  if (!name || !Array.isArray(groups)) {
    res.status(400).json({ error: 'name (string) and groups (string[]) are required' })
    return
  }
  try {
    const updated = await prisma.savedGroupList.update({
      where: { id: String(req.params.id) },
      data: { name: String(name), groups: JSON.stringify(groups) },
    })
    res.json({ list: { ...updated, groups: JSON.parse(updated.groups) } })
  } catch {
    res.status(404).json({ error: 'List not found' })
  }
})

router.delete('/group-lists/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.savedGroupList.delete({ where: { id: String(req.params.id) } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'List not found' })
  }
})

// Gateway — Allowed Numbers & Allowed Groups
router.get('/gateway/numbers', requireAuth, async (_req: AuthRequest, res: Response) => {
  const numbers = await prisma.allowedNumber.findMany({ orderBy: { createdAt: 'desc' } })
  res.json({ numbers })
})

router.post('/gateway/numbers', requireAuth, async (req: AuthRequest, res: Response) => {
  const { phone } = req.body
  if (!phone) { res.status(400).json({ error: 'phone is required' }); return }
  try {
    const entry = await prisma.allowedNumber.create({ data: { phone: String(phone) } })
    res.json({ number: entry })
  } catch {
    res.status(409).json({ error: 'Number already exists' })
  }
})

router.delete('/gateway/numbers/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.allowedNumber.delete({ where: { id: String(req.params.id) } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Not found' })
  }
})

router.get('/gateway/groups', requireAuth, async (_req: AuthRequest, res: Response) => {
  const groups = await prisma.allowedGroup.findMany({ orderBy: { createdAt: 'desc' } })
  res.json({ groups })
})

router.post('/gateway/groups', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name } = req.body
  if (!name) { res.status(400).json({ error: 'name is required' }); return }
  try {
    const entry = await prisma.allowedGroup.create({ data: { name: String(name) } })
    res.json({ group: entry })
  } catch {
    res.status(409).json({ error: 'Group already exists' })
  }
})

router.delete('/gateway/groups/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.allowedGroup.delete({ where: { id: String(req.params.id) } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Not found' })
  }
})

router.get('/diagnostics', async (_req: Request, res: Response) => {
  const results: Record<string, unknown> = {}

  results.timestamp = new Date().toISOString()
  results.nodeVersion = process.version
  results.platform = process.platform

  // Test DNS with system resolver (uses Node.js internal resolver)
  try {
    const addresses = await dns.resolve('web.whatsapp.com')
    results.dnsSystem = { host: 'web.whatsapp.com', addresses }
  } catch (err) {
    results.dnsSystem = { host: 'web.whatsapp.com', error: (err as Error).message }
  }

  // Test DNS with Google/Cloudflare public resolvers
  const googleResult = await resolveWithFallback('web.whatsapp.com', [
    ['8.8.8.8', '8.8.4.4'],
    ['1.1.1.1', '1.0.0.1'],
  ])
  results.dnsGoogle = googleResult

  // Determine IP to use for TCP test
  const resolvedIp = (results.dnsGoogle as { addresses?: string[] })?.addresses?.[0] || (results.dnsSystem as { addresses?: string[] })?.addresses?.[0]
  const tcpTarget = resolvedIp || 'web.whatsapp.com'

  // TCP connectivity test (uses OS resolver for hostname)
  await new Promise<void>((resolve) => {
    const sock = new net.Socket()
    sock.setTimeout(5000)
    sock.on('connect', () => {
      results.tcpConnect = { host: tcpTarget, port: 443, reachable: true, note: resolvedIp ? 'via resolved IP' : 'via hostname (OS resolver)' }
      sock.destroy()
      resolve()
    })
    sock.on('error', (err) => {
      results.tcpConnect = { host: tcpTarget, port: 443, reachable: false, error: err.message }
      resolve()
    })
    sock.on('timeout', () => {
      results.tcpConnect = { host: tcpTarget, port: 443, reachable: false, error: 'Connection timed out (5s)' }
      sock.destroy()
      resolve()
    })
    sock.on('lookup', (err, address) => {
      if (err) results.tcpLookupError = err.message
      else results.tcpLookupAddress = address
    })
    sock.connect(443, tcpTarget)
  })

  // HTTPS connectivity test (uses OS resolver)
  await new Promise<void>((resolve) => {
    const req = https.get('https://web.whatsapp.com', {
      timeout: 5000,
      rejectUnauthorized: false,
      headers: { 'User-Agent': USER_AGENT },
    }, (response) => {
      results.httpsStatus = { code: response.statusCode, message: response.statusMessage }
      response.destroy()
      resolve()
    })
    req.on('error', (err) => {
      results.httpsError = err.message
      resolve()
    })
    req.on('timeout', () => {
      results.httpsError = 'Timed out (5s)'
      req.destroy()
      resolve()
    })
  })

  // WebSocket upgrade test (simulates Baileys handshake over TLS)
  await new Promise<void>((resolve) => {
    try {
      const req = https.request({
        hostname: 'web.whatsapp.com',
        port: 443,
        method: 'GET',
        path: '/',
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'User-Agent': USER_AGENT,
        },
        timeout: 5000,
        rejectUnauthorized: false,
      })
      req.on('upgrade', (_response) => {
        results.wsUpgrade = { supported: true }
        req.destroy()
        resolve()
      })
      req.on('response', (response) => {
        results.wsUpgrade = { supported: false, httpCode: response.statusCode, note: 'Server returned HTTP response instead of WebSocket upgrade (expected for non-WA path).' }
        response.destroy()
        resolve()
      })
      req.on('error', (err) => {
        results.wsUpgradeError = err.message
        resolve()
      })
      req.on('timeout', () => {
        results.wsUpgradeError = 'Timed out (5s)'
        req.destroy()
        resolve()
      })
      req.end()
    } catch (err) {
      results.wsUpgradeError = (err as Error).message
      resolve()
    }
  })

  const state = getConnectionState()
  results.whatsappState = state

  res.json(results)
})

export default router
