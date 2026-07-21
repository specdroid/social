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

  console.log('PDF content length:', content.length)
  console.log('PDF content first 500 chars:', JSON.stringify(content.substring(0, 500)))
  console.log('PDF content has &lt;:', content.includes('&lt;'))
  console.log('PDF content has <:', content.includes('<'))

  const withMarkdown = content
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_: string, lang: string, code: string) => `<pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)
    .replace(/`([^`]+)`/g, (_: string, code: string) => `<code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
  const rendered = renderMathInText(withMarkdown)
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>')
  const bodyContent = rendered.startsWith('<') ? rendered : `<p>${rendered}</p>`
  console.log('PDF bodyContent first 500 chars:', JSON.stringify(bodyContent.substring(0, 500)))
  const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css">
<style>
  @page{margin:20mm 15mm}
  body{font-family:Georgia,'Times New Roman',serif;max-width:210mm;margin:0 auto;line-height:1.8;font-size:12pt;color:#1a1a2e;orphans:3;widows:3}
  img{max-width:100%}
  .katex{font-size:1.05em}
  code{background:#f1f1f1;padding:0.15em 0.3em;border-radius:2px;font-size:0.85em;font-family:'SFMono-Regular',Consolas,monospace;word-break:break-word}
  pre{background:#f5f5f5;padding:0.7rem 0.9rem;border-radius:4px;overflow-x:auto;page-break-inside:avoid;border:1px solid #e0e0e0}
  pre code{background:none;padding:0;font-size:0.8em;line-height:1.5}
  table{border-collapse:collapse;width:100%;page-break-inside:avoid;margin:0.5em 0}
  td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}
  th{background:#eee;font-weight:600}
  h1,h2,h3,h4{page-break-after:avoid;color:#111;line-height:1.3;margin-top:1.2em;margin-bottom:0.4em}
  h1{font-size:1.6em;border-bottom:1px solid #ddd;padding-bottom:0.2em}
  h2{font-size:1.3em}
  h3{font-size:1.1em}
  p{page-break-inside:avoid;margin:0 0 0.6em 0}
  ul,ol{page-break-inside:avoid;margin:0.3em 0;padding-left:1.5em}
  li{margin-bottom:0.2em}
  blockquote{border-left:3px solid #ccc;margin:0.5em 0;padding:0.2em 0.8em;color:#555;font-style:italic}
  hr{border:none;border-top:1px solid #ddd;margin:1em 0}
  a{color:#2563eb;text-decoration:none}
</style></head><body>${bodyContent}</body></html>`

  const tmpPdf = path.join(os.tmpdir(), `omniroute-pdf-${Date.now()}.pdf`)

  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.pdf({ path: tmpPdf, format: 'A4', printBackground: true, margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' } })

    if (!fs.existsSync(tmpPdf)) throw new Error('PDF file was not created by Playwright')
    const stat = fs.statSync(tmpPdf)
    if (stat.size === 0) throw new Error('Generated PDF is empty')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="omniroute-response.pdf"')
    res.setHeader('Content-Length', stat.size)
    const readStream = fs.createReadStream(tmpPdf)
    readStream.pipe(res)
  } catch (err) {
    throw new AppError(500, err instanceof Error ? err.message : 'PDF generation failed')
  } finally {
    if (browser) { try { await browser.close() } catch {} }
    try { fs.unlinkSync(tmpPdf) } catch {}
  }
})

export default router
