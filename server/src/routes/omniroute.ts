import { Router, Response } from 'express'
import { requireAuth } from '../middleware/auth'
import { AuthRequest } from '../middleware/checkPremium'
import { AppError } from '../middleware/errorHandler'
import { getConfig, updateConfig, chatCompletion, getApiKeys, addApiKey, deleteApiKey, listChats, getChat, createChat, updateChat, deleteChat } from '../services/omniroute'
import katex from 'katex'
import { chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const router = Router()

router.get('/config', requireAuth, async (req: AuthRequest, res: Response) => {
  const config = await getConfig(req.userId!)
  const keys = await getApiKeys(req.userId!)
  res.json({
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey || keys.length > 0,
    model: config.model,
    systemPrompt: config.systemPrompt,
    apiKeyCount: keys.length + (config.apiKey ? 1 : 0),
  })
})

router.put('/config', requireAuth, async (req: AuthRequest, res: Response) => {
  const { baseUrl, apiKey, model, systemPrompt } = req.body
  if (baseUrl !== undefined && (typeof baseUrl !== 'string' || !baseUrl.startsWith('http'))) {
    throw new AppError(400, 'baseUrl must be a valid URL starting with http')
  }
  if (apiKey !== undefined && typeof apiKey !== 'string') {
    throw new AppError(400, 'apiKey must be a string')
  }
  if (model !== undefined && typeof model !== 'string') {
    throw new AppError(400, 'model must be a string')
  }
  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') {
    throw new AppError(400, 'systemPrompt must be a string')
  }

  const config = await updateConfig(req.userId!, { baseUrl, apiKey, model, systemPrompt })
  const keys = await getApiKeys(req.userId!)
  res.json({
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey || keys.length > 0,
    model: config.model,
    systemPrompt: config.systemPrompt,
    apiKeyCount: keys.length + (config.apiKey ? 1 : 0),
  })
})

router.get('/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  const keys = await getApiKeys(req.userId!)
  res.json({ keys: keys.map(k => ({ id: k.id, label: k.label, key: k.key.slice(0, 8) + '...' + k.key.slice(-4), createdAt: k.createdAt })) })
})

router.post('/keys', requireAuth, async (req: AuthRequest, res: Response) => {
  const { key, label } = req.body
  if (!key || typeof key !== 'string') throw new AppError(400, 'key is required')
  const created = await addApiKey(req.userId!, key.trim(), label)
  res.json({ id: created.id, label: created.label, key: created.key.slice(0, 8) + '...' + created.key.slice(-4), createdAt: created.createdAt })
})

router.delete('/keys/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  await deleteApiKey(String(req.params.id), req.userId!)
  res.json({ ok: true })
})

router.post('/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  const { messages } = req.body
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError(400, 'messages must be a non-empty array of {role, content}')
  }
  for (const m of messages) {
    if (!m.role) throw new AppError(400, 'each message must have role')
    if (!m.content && !Array.isArray(m.content)) throw new AppError(400, 'each message must have content')
  }

  const reply = await chatCompletion(messages, req.userId!)
  res.json({ reply })
})

router.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const config = await getConfig(req.userId!)
  const keys = await getApiKeys(req.userId!)
  if (!config.apiKey && keys.length === 0) {
    res.json({ ok: false, error: 'No API keys configured' })
    return
  }

  try {
    const testMessages = [{ role: 'user', content: 'Say exactly: OK' }]
    const reply = await chatCompletion(testMessages, req.userId!)
    const clean = reply.trim().toLowerCase()
    const ok = clean.includes('ok') && !clean.includes('error')
    res.json({ ok, reply: reply.slice(0, 100) })
  } catch (err: any) {
    res.json({ ok: false, error: err.message })
  }
})

router.get('/chats', requireAuth, async (req: AuthRequest, res: Response) => {
  const chats = await listChats(req.userId!)
  res.json({ chats })
})

router.post('/chats', requireAuth, async (req: AuthRequest, res: Response) => {
  const { title, messages } = req.body
  const chat = await createChat(req.userId!, title, messages || [])
  res.json({ id: chat.id, title: chat.title, messages: JSON.parse(chat.messages) })
})

router.get('/chats/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const chat = await getChat(String(req.params.id), req.userId!)
  if (!chat) throw new AppError(404, 'Chat not found')
  res.json({ id: chat.id, title: chat.title, messages: JSON.parse(chat.messages) })
})

router.put('/chats/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { title, messages } = req.body
  const chat = await updateChat(String(req.params.id), req.userId!, { title, messages })
  res.json({ id: chat.id, title: chat.title, messages: JSON.parse(chat.messages) })
})

router.delete('/chats/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  await deleteChat(String(req.params.id), req.userId!)
  res.json({ ok: true })
})

function renderMathInText(text: string): string {
  let result = text
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, math: string) => {
    try { return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  result = result.replace(/\\\[(.+?)\\\]/gs, (_, math: string) => {
    try { return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  result = result.replace(/\$([^\n$]+?)\$/g, (_, math: string) => {
    try { return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  result = result.replace(/\\\((.+?)\\\)/gs, (_, math: string) => {
    try { return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  return result
}

router.post('/export/pdf', requireAuth, async (req: AuthRequest, res: Response) => {
  const { content } = req.body
  if (!content || typeof content !== 'string') throw new AppError(400, 'content is required')

  const rendered = renderMathInText(content)
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css">
<style>
  body{font-family:Georgia,serif;max-width:210mm;margin:0 auto;padding:20mm 15mm;line-height:1.8;font-size:12pt;color:#1a1a2e}
  img{max-width:100%}
  .katex{font-size:1.1em}
  code{background:#f1f1f1;padding:0.15em 0.3em;border-radius:3px;font-size:0.9em;font-family:monospace}
  pre{background:#f5f5f5;padding:0.8rem 1rem;border-radius:6px;overflow-x:auto;page-break-inside:avoid}
  pre code{background:none;padding:0}
  table{border-collapse:collapse;width:100%;page-break-inside:avoid}
  td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}
  th{background:#f0f0f0}
  h1,h2,h3,h4{page-break-after:avoid;color:#111}
  p,li{page-break-inside:avoid}
</style></head><body>${rendered}</body></html>`

  const tmpFile = path.join(os.tmpdir(), `omniroute-pdf-${Date.now()}.html`)
  const tmpPdf = path.join(os.tmpdir(), `omniroute-pdf-${Date.now()}.pdf`)

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.pdf({ path: tmpPdf, format: 'A4', printBackground: true, margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' } })
    await browser.close()

    if (!fs.existsSync(tmpPdf)) throw new Error('PDF file was not created by Playwright')
    const stat = fs.statSync(tmpPdf)
    if (stat.size === 0) throw new Error('Generated PDF is empty')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="omniroute-response.pdf"')
    res.setHeader('Content-Length', stat.size)
    const readStream = fs.createReadStream(tmpPdf)
    readStream.pipe(res)
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
    try { fs.unlinkSync(tmpPdf) } catch {}
  }
})

export default router
