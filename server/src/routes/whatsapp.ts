import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { PrismaClient } from '@prisma/client'
import { manager } from '../services/whatsapp'
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

function getInstance(userId: string) {
  return manager.getInstance(userId)
}

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const state = manager.getStatus(req.userId!)
  const mySession = await prisma.whatsAppSession.findUnique({ where: { userId: req.userId! } })
  const isMyConnection = mySession?.isConnected === true && state.connected
  res.json({ ...state, connected: isMyConnection, belongsToMe: isMyConnection, mySessionExists: !!mySession })
})

router.get('/own-profile', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const profile = instance?.getOwnProfile() || { ownPhone: null, ownLid: null }
  res.json(profile)
})

router.get('/contacts', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const contacts = instance ? await instance.getContacts() : []
  res.json({ contacts })
})

router.delete('/contacts', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const deleted = instance ? await instance.clearContacts() : 0
  res.json({ ok: true, deleted })
})

router.get('/contacts/imported', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const contacts = instance ? await instance.getImportedContacts() : []
  res.json({ contacts })
})

router.delete('/contacts/imported/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(404).json({ error: 'Not connected' }); return }
  const ok = await instance.deleteImportedContact(String(req.params.id))
  if (!ok) { res.status(404).json({ error: 'Contact not found' }); return }
  res.json({ ok: true })
})

router.delete('/contacts/imported', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const count = instance ? await instance.clearImportedContacts() : 0
  res.json({ ok: true, deleted: count })
})

router.post('/contacts/imported', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(400).json({ error: 'Not connected' }); return }
  const { name, phoneNumber } = req.body
  if (!phoneNumber) { res.status(400).json({ error: 'phoneNumber is required' }); return }
  const contact = await instance.addImportedContact(String(name || ''), String(phoneNumber))
  if (!contact) { res.status(409).json({ error: 'Contact already exists or invalid phone number' }); return }
  res.json({ contact })
})

router.delete('/contacts/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(404).json({ error: 'Not connected' }); return }
  const ok = await instance.deleteContact(String(req.params.id))
  if (!ok) { res.status(404).json({ error: 'Contact not found' }); return }
  res.json({ ok: true })
})

router.post('/contacts/resync', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.json({ ok: false, count: 0 }); return }
  const result = await instance.resyncContacts()
  res.json(result)
})

router.post('/contacts/import-vcf', requireAuth, vcfUpload.single('file'), async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(400).json({ error: 'Not connected' }); return }
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }
  const content = req.file.buffer.toString('utf-8')
  const result = await instance.importVcf(content)
  res.json(result)
})

router.get('/contact-groups', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const groups = instance ? await instance.getContactGroups() : []
  res.json({ groups })
})

router.post('/contact-groups', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(400).json({ error: 'Not connected' }); return }
  const { name, memberJids } = req.body
  if (!name || !Array.isArray(memberJids)) { res.status(400).json({ error: 'name and memberJids required' }); return }
  const group = await instance.createContactGroup(String(name), memberJids)
  res.json({ group })
})

router.put('/contact-groups/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(400).json({ error: 'Not connected' }); return }
  const { name, memberJids } = req.body
  if (!name || !Array.isArray(memberJids)) { res.status(400).json({ error: 'name and memberJids required' }); return }
  const group = await instance.updateContactGroup(String(req.params.id), String(name), memberJids)
  if (!group) { res.status(404).json({ error: 'Group not found' }); return }
  res.json({ group })
})

router.delete('/contact-groups/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(404).json({ error: 'Not connected' }); return }
  const ok = await instance.deleteContactGroup(String(req.params.id))
  if (!ok) { res.status(404).json({ error: 'Group not found' }); return }
  res.json({ ok: true })
})

router.get('/qr', requireAuth, async (req: AuthRequest, res: Response) => {
  const qr = manager.getQr(req.userId!)
  if (qr) res.json({ qr })
  else res.status(404).json({ error: 'No QR code available' })
})

router.post('/disconnect', requireAuth, async (req: AuthRequest, res: Response) => {
  await manager.disconnect(req.userId!)
  res.json({ ok: true })
})

router.post('/send-test', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.status(400).json({ error: 'Not connected' }); return }
  const result = await instance.sendTestMessage()
  if (result.ok) res.json({ ok: true, message: 'Test message sent' })
  else res.status(400).json({ error: result.error || 'Failed to send message' })
})

router.post('/cleanup-auth', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.json({ ok: true, deleted: 0, keptCreds: false }); return }
  const result = await instance.cleanupAuthFolder()
  res.json({ ok: true, deleted: result.deleted, keptCreds: result.keptCreds })
})

router.post('/clear-credentials', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (!instance) { res.json({ ok: true, deleted: 0 }); return }
  const result = await instance.clearCredentials()
  res.json({ ok: true, deleted: result.deleted })
})

router.post('/force-clean-auth', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  if (instance) await instance.forceCleanAuth()
  res.json({ ok: true })
})

// Saved Group Lists
router.get('/group-lists', requireAuth, async (req: AuthRequest, res: Response) => {
  const lists = await prisma.savedGroupList.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' } })
  res.json({ lists: lists.map((l: Record<string, unknown>) => ({ ...l, groups: JSON.parse(l.groups as string) })) })
})

router.put('/group-lists/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, groups } = req.body
  if (!name || !Array.isArray(groups)) { res.status(400).json({ error: 'name and groups required' }); return }
  try {
    const existing = await prisma.savedGroupList.findFirst({ where: { id: String(req.params.id), userId: req.userId! } })
    if (!existing) { res.status(404).json({ error: 'List not found' }); return }
    const updated = await prisma.savedGroupList.update({ where: { id: existing.id }, data: { name: String(name), groups: JSON.stringify(groups) } })
    res.json({ list: { ...updated, groups: JSON.parse(updated.groups) } })
  } catch { res.status(404).json({ error: 'List not found' }) }
})

router.delete('/group-lists/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.savedGroupList.findFirst({ where: { id: String(req.params.id), userId: req.userId! } })
    if (!existing) { res.status(404).json({ error: 'List not found' }); return }
    await prisma.savedGroupList.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch { res.status(404).json({ error: 'List not found' }) }
})

// Gateway
router.get('/gateway/numbers', requireAuth, async (req: AuthRequest, res: Response) => {
  const numbers = await prisma.allowedNumber.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' } })
  res.json({ numbers })
})

router.post('/gateway/numbers', requireAuth, async (req: AuthRequest, res: Response) => {
  const { phone } = req.body
  if (!phone) { res.status(400).json({ error: 'phone is required' }); return }
  try {
    const entry = await prisma.allowedNumber.create({ data: { userId: req.userId!, phone: String(phone) } })
    res.json({ number: entry })
  } catch { res.status(409).json({ error: 'Number already exists' }) }
})

router.delete('/gateway/numbers/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.allowedNumber.findFirst({ where: { id: String(req.params.id), userId: req.userId! } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.allowedNumber.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch { res.status(404).json({ error: 'Not found' }) }
})

router.get('/gateway/groups', requireAuth, async (req: AuthRequest, res: Response) => {
  const groups = await prisma.allowedGroup.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' } })
  res.json({ groups })
})

router.post('/gateway/groups', requireAuth, async (req: AuthRequest, res: Response) => {
  const { name } = req.body
  if (!name) { res.status(400).json({ error: 'name is required' }); return }
  try {
    const entry = await prisma.allowedGroup.create({ data: { userId: req.userId!, name: String(name) } })
    res.json({ group: entry })
  } catch { res.status(409).json({ error: 'Group already exists' }) }
})

router.delete('/gateway/groups/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.allowedGroup.findFirst({ where: { id: String(req.params.id), userId: req.userId! } })
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }
    await prisma.allowedGroup.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch { res.status(404).json({ error: 'Not found' }) }
})

router.get('/gateway/available-groups', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const groups = instance ? await instance.getWhatsAppGroups() : []
  res.json({ groups })
})

router.get('/gateway/available-contacts', requireAuth, async (req: AuthRequest, res: Response) => {
  const instance = getInstance(req.userId!)
  const contacts = instance ? await instance.getContacts() : []
  const profile = instance?.getOwnProfile()
  const ownerPhone = profile?.ownPhone ? `961${profile.ownPhone}` : null
  if (ownerPhone && !contacts.some(c => c.phoneNumber === ownerPhone)) {
    contacts.unshift({ id: 'owner', name: 'Account holder (you)', phoneNumber: ownerPhone })
  }
  res.json({ contacts })
})

router.get('/diagnostics', async (_req: Request, res: Response) => {
  const results: Record<string, unknown> = {}
  results.timestamp = new Date().toISOString()
  results.nodeVersion = process.version
  results.platform = process.platform

  try {
    const addresses = await dns.resolve('web.whatsapp.com')
    results.dnsSystem = { host: 'web.whatsapp.com', addresses }
  } catch (err) { results.dnsSystem = { host: 'web.whatsapp.com', error: (err as Error).message } }

  const googleResult = await resolveWithFallback('web.whatsapp.com', [['8.8.8.8', '8.8.4.4'], ['1.1.1.1', '1.0.0.1']])
  results.dnsGoogle = googleResult

  const resolvedIp = (results.dnsGoogle as any)?.addresses?.[0] || (results.dnsSystem as any)?.addresses?.[0]
  const tcpTarget = resolvedIp || 'web.whatsapp.com'

  await new Promise<void>((resolve) => {
    const sock = new net.Socket()
    sock.setTimeout(5000)
    sock.on('connect', () => { results.tcpConnect = { host: tcpTarget, port: 443, reachable: true }; sock.destroy(); resolve() })
    sock.on('error', (err) => { results.tcpConnect = { host: tcpTarget, port: 443, reachable: false, error: err.message }; resolve() })
    sock.on('timeout', () => { results.tcpConnect = { host: tcpTarget, port: 443, reachable: false, error: 'Timed out' }; sock.destroy(); resolve() })
    sock.connect(443, tcpTarget)
  })

  const state = manager.getStatus('diagnostics')
  results.whatsappState = state
  res.json(results)
})

export default router
