import { useState, useEffect, useRef, useMemo } from 'react'
import { Brain, Send, Check, X, Eye, EyeOff, Loader2, MessageSquare, Plus, Trash2, Key, Paperclip, Copy, FileCode, FileText, Square } from 'lucide-react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import * as pdfjsLib from 'pdfjs-dist'
import { useApi } from '../hooks/useApi'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

interface Config {
  baseUrl: string
  hasApiKey: boolean
  model: string
  systemPrompt: string
  apiKeyCount: number
}

interface ApiKeyEntry {
  id: string
  label: string
  key: string
  createdAt: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachment?: { name: string; type: string; size: number }
}

function renderMathInText(text: string): string {
  let result = text
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    try { return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  result = result.replace(/\\\[(.+?)\\\]/gs, (_, math) => {
    try { return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  result = result.replace(/\$([^\n$]+?)\$/g, (_, math) => {
    try { return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  result = result.replace(/\\\((.+?)\\\)/gs, (_, math) => {
    try { return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }) }
    catch { return `<code>${math}</code>` }
  })
  return result
}

function exportAsHtml(content: string) {
  const rendered = renderMathInText(content)
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Omniroute Response</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:2rem;line-height:1.6;color:#1a1a2e}img{max-width:100%}.katex{font-size:1.05em}code{background:#f1f1f1;padding:0.2em 0.4em;border-radius:3px;font-size:0.9em}pre{background:#f5f5f5;padding:1rem;border-radius:8px;overflow-x:auto}pre code{background:none;padding:0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left}</style></head><body>${rendered}</body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}

async function exportAsPdf(content: string) {
  try {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/omniroute/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error('Failed to generate PDF')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'omniroute-response.pdf'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    alert('PDF export failed: ' + e.message)
  }
}

function MessageContent({ content, isUser }: { content: string; isUser?: boolean }) {
  const html = useMemo(() => renderMathInText(content), [content])
  const hasMath = html.includes('katex')
  if (!hasMath) return <span className="whitespace-pre-wrap">{content}</span>
  return <span className={`prose-invert prose-sm max-w-none ${isUser ? 'text-white' : 'text-zinc-100'}`} style={{ color: isUser ? '#fff' : '#e4e4e7' }} dangerouslySetInnerHTML={{ __html: html }} />
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return '🖼'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('zip') || mime.includes('compressed')) return '📦'
  return '📎'
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function OmniroutePanel() {
  const { get, post, put, del } = useApi()
  const [config, setConfig] = useState<Config | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('auto')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testStatus, setTestStatus] = useState<{ ok: boolean; reply?: string; error?: string; msg?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([])
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [showNewKey, setShowNewKey] = useState(false)
  const [addingKey, setAddingKey] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyEntry | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [pendingFile, setPendingFile] = useState<{ name: string; type: string; size: number; base64: string } | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [chats, setChats] = useState<{ id: string; title: string; updatedAt: string }[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)

  useEffect(() => {
    loadConfig()
    loadKeys()
    loadChats()
  }, [])

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadConfig() {
    try {
      const data = await get<Config>('/api/omniroute/config')
      if (data) {
        setConfig(data)
        setBaseUrl(data.baseUrl)
        setModel(data.model)
        setSystemPrompt(data.systemPrompt)
      }
    } catch { }
  }

  async function loadChats() {
    try {
      const data = await get<{ chats: { id: string; title: string; updatedAt: string }[] }>('/api/omniroute/chats')
      setChats(data.chats || [])
    } catch {}
  }

  async function handleNewChat() {
    setCurrentChatId(null)
    setMessages([])
  }

  async function handleSelectChat(chatId: string) {
    try {
      const data = await get<{ id: string; title: string; messages: ChatMessage[] }>(`/api/omniroute/chats/${chatId}`)
      if (data) {
        setCurrentChatId(data.id)
        setMessages(data.messages)
      }
    } catch {}
  }

  async function handleDeleteChat(chatId: string) {
    try {
      await del(`/api/omniroute/chats/${chatId}`)
      if (currentChatId === chatId) { setCurrentChatId(null); setMessages([]) }
      loadChats()
    } catch {}
  }

  async function loadKeys() {
    try {
      const data = await get<{ keys: ApiKeyEntry[] }>('/api/omniroute/keys')
      setApiKeys(data.keys || [])
    } catch { }
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const payload: any = { baseUrl, model, systemPrompt }
      if (apiKey) payload.apiKey = apiKey
      const data = await put<Config>('/api/omniroute/config', payload)
      if (data) {
        setConfig(data)
        setSaveMsg({ ok: true, text: 'Configuration saved' })
        setApiKey('')
      }
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e.message || 'Failed to save' })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestStatus(null)
    try {
      const data = await get<{ ok: boolean; reply?: string; error?: string }>('/api/omniroute/status')
      if (data) setTestStatus(data)
    } catch (e: any) {
      setTestStatus({ ok: false, msg: e.message || 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleAddKey() {
    if (!newKeyValue.trim()) return
    setAddingKey(true)
    try {
      await post('/api/omniroute/keys', { key: newKeyValue.trim(), label: newKeyLabel.trim() })
      setNewKeyValue('')
      setNewKeyLabel('')
      setShowNewKey(false)
      loadKeys()
      loadConfig()
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e.message || 'Failed to add key' })
      setTimeout(() => setSaveMsg(null), 3000)
    } finally {
      setAddingKey(false)
    }
  }

  async function handleDeleteKey() {
    if (!deleteTarget) return
    try {
      await fetch(`/api/omniroute/keys/${deleteTarget.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      setDeleteTarget(null)
      loadKeys()
      loadConfig()
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e.message || 'Failed to delete' })
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] || ''
      setPendingFile({ name: file.name, type: file.type, size: file.size, base64 })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function removePendingFile() {
    setPendingFile(null)
  }

  async function pdfToImages(base64: string): Promise<string[]> {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
    const images: string[] = []
    const maxPages = Math.min(pdf.numPages, 10)
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1.25 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise
      images.push(canvas.toDataURL('image/jpeg', 0.7).split(',')[1])
    }
    return images
  }

  async function handleSend() {
    const text = chatInput.trim()
    if ((!text && !pendingFile) || sending) return

    let content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> = text
    let attachment: ChatMessage['attachment'] = undefined

    if (pendingFile) {
      const isImage = pendingFile.type.startsWith('image/')
      const isPdf = pendingFile.type === 'application/pdf'

      if (isImage) {
        const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
        if (text) contentParts.push({ type: 'text', text })
        contentParts.push({ type: 'image_url', image_url: { url: `data:${pendingFile.type};base64,${pendingFile.base64}` } })
        content = contentParts
      } else if (isPdf) {
        const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
        if (text) contentParts.push({ type: 'text', text: `${text}\n\n[PDF: ${pendingFile.name} — ${await pdfPageCount(pendingFile.base64)} pages]` })
        else contentParts.push({ type: 'text', text: `[PDF: ${pendingFile.name} — ${await pdfPageCount(pendingFile.base64)} pages. Pages shown as images below.]` })
        const images = await pdfToImages(pendingFile.base64)
        for (const img of images) {
          contentParts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } })
        }
        content = contentParts
      } else {
        content = text
          ? `${text}\n\n[File attached: ${pendingFile.name} (${formatSize(pendingFile.size)})]`
          : `[File attached: ${pendingFile.name} (${formatSize(pendingFile.size)})]`
      }
      attachment = { name: pendingFile.name, type: pendingFile.type, size: pendingFile.size }
    }

    const userMsg: ChatMessage = { role: 'user', content: typeof content === 'string' ? content : text || `[File: ${pendingFile!.name}]`, attachment }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setChatInput('')
    setPendingFile(null)
    setSending(true)

    let chatId = currentChatId
    if (!chatId) {
      try {
        const created = await post<{ id: string }>('/api/omniroute/chats', { messages: newMessages.map(m => ({ role: m.role, content: m.content })) })
        chatId = created.id
        setCurrentChatId(chatId)
        loadChats()
      } catch {}
    }

    try {
      const controller = new AbortController()
      abortRef.current = controller
      const apiMessages: Array<{ role: string; content: any }> = newMessages.map(m => ({ role: m.role, content: m.content }))
      if (pendingFile && typeof content !== 'string') {
        apiMessages[apiMessages.length - 1].content = content
      }
      const token = localStorage.getItem('token')
      const res = await fetch('/api/omniroute/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: apiMessages }),
        signal: controller.signal,
      })
      if (res.ok) {
        const data = await res.json()
        const finalMessages = [...newMessages, { role: 'assistant' as const, content: data.reply }]
        setMessages(finalMessages)
        if (chatId) {
          try {
            const title = newMessages[0]?.content?.slice(0, 50) || 'Chat'
            await put(`/api/omniroute/chats/${chatId}`, { messages: finalMessages.map(m => ({ role: m.role, content: m.content })), title })
            loadChats()
          } catch {}
        }
      } else {
        const err = await res.text()
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err}` }])
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  async function pdfPageCount(base64: string): Promise<number> {
    try {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
      return pdf.numPages
    } catch { return 0 }
  }

  function handleRemoveMessage(index: number) {
    setMessages(prev => prev.filter((_, i) => i !== index))
  }

  function handleStop() {
    abortRef.current?.abort()
    abortRef.current = null
    setSending(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Brain className="w-6 h-6 text-purple-400" />
        <h2 className="text-xl font-semibold text-zinc-50">Omniroute AI</h2>
      </div>

      {/* ── Configuration Section ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Configuration</h3>

        <div>
          <label className="block text-sm text-zinc-400 mb-1">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-500 text-sm font-mono"
            placeholder="https://omniroutelb.duckdns.org/v1"
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-1">Model</label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-500 text-sm font-mono"
            placeholder="auto"
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-1">System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-500 text-sm resize-none"
            placeholder="Optional: Set the AI's personality and behavior..."
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !config?.hasApiKey}
            className="px-4 py-2 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Test Connection
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{saveMsg.text}</span>
          )}
          {testStatus && (
            <span className={`text-sm flex items-center gap-1 ${testStatus.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testStatus.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
              {testStatus.ok ? 'Connected' : testStatus.error || testStatus.msg}
            </span>
          )}
        </div>
      </div>

      {/* ── API Keys Section ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-zinc-400" />
            <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">API Keys</h3>
            <span className="text-xs text-zinc-500">({apiKeys.length + (config?.hasApiKey && !apiKeys.length ? 1 : 0)} total, rotated round-robin)</span>
          </div>
          <button
            onClick={() => setShowNewKey(!showNewKey)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Key
          </button>
        </div>

        {showNewKey && (
          <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3">
            <input
              type="text"
              value={newKeyLabel}
              onChange={e => setNewKeyLabel(e.target.value)}
              placeholder="Label (optional, e.g. OpenRouter #1)"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 text-sm focus:outline-none focus:border-zinc-500"
            />
            <div className="relative">
              <input
                type={showNewKey ? 'text' : 'password'}
                value={newKeyValue}
                onChange={e => setNewKeyValue(e.target.value)}
                placeholder="sk-or-..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 text-sm font-mono pr-10 focus:outline-none focus:border-zinc-500"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleAddKey() }}
              />
              <button onClick={() => setShowNewKey(!showNewKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                {showNewKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleAddKey} disabled={addingKey || !newKeyValue.trim()} className="px-3 py-1.5 bg-zinc-50 text-zinc-900 rounded-lg text-xs font-medium hover:bg-zinc-200 disabled:opacity-50 flex items-center gap-1.5">
                {addingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add
              </button>
              <button onClick={() => { setShowNewKey(false); setNewKeyValue(''); setNewKeyLabel('') }} className="px-3 py-1.5 bg-zinc-800 text-zinc-400 rounded-lg text-xs hover:bg-zinc-700">Cancel</button>
            </div>
          </div>
        )}

        {apiKeys.length === 0 ? (
          <p className="text-sm text-zinc-500">No additional keys. Add API keys above to enable rotation.</p>
        ) : (
          <div className="space-y-2">
            {apiKeys.map(k => (
              <div key={k.id} className="flex items-center gap-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 font-mono truncate">{k.key}</p>
                  {k.label && <p className="text-xs text-zinc-500">{k.label}</p>}
                </div>
                <button onClick={() => setDeleteTarget(k)} className="p-1.5 text-zinc-400 hover:text-red-400 rounded transition-colors" title="Delete key">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Delete Key Dialog ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Delete API Key</h3>
                <p className="text-xs text-zinc-400 mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-zinc-300 mb-6">
              Delete key <span className="font-mono text-zinc-100">{deleteTarget.key}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors">Cancel</button>
              <button onClick={handleDeleteKey} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Chat Section ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Chat</h3>
          <button onClick={handleNewChat} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-700 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>

        {chats.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {chats.map(c => (
              <div key={c.id} className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors ${currentChatId === c.id ? 'bg-purple-600/20 text-purple-300 border border-purple-600/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-transparent'}`}>
                <span onClick={() => handleSelectChat(c.id)} className="truncate max-w-[120px]">{c.title}</span>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteChat(c.id) }} className="p-0.5 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete chat">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 h-96 overflow-y-auto space-y-3">
          {messages.length === 0 && (
            <p className="text-zinc-600 text-sm text-center pt-8">Send a message to start chatting with the AI</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`relative max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                msg.role === 'user' ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-200'
              }`}>
                {msg.attachment && (
                  <div className={`flex items-center gap-2 mb-1.5 px-2 py-1 rounded text-xs ${
                    msg.role === 'user' ? 'bg-purple-700/50' : 'bg-zinc-700/50'
                  }`}>
                    <span>{fileIcon(msg.attachment.type)}</span>
                    <span className="truncate max-w-[150px]">{msg.attachment.name}</span>
                    <span className="opacity-60">{formatSize(msg.attachment.size)}</span>
                  </div>
                )}
                <MessageContent content={msg.content} isUser={msg.role === 'user'} />
                <div className={`absolute -top-2 right-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                  {msg.role === 'user' ? (
                    <button onClick={async () => {
                      const text = typeof msg.content === 'string' ? msg.content : ''
                      try {
                        await navigator.clipboard.writeText(text)
                        setCopiedIdx(i)
                        setTimeout(() => setCopiedIdx(null), 1500)
                      } catch {
                        const ta = document.createElement('textarea')
                        ta.value = text
                        document.body.appendChild(ta)
                        ta.select()
                        document.execCommand('copy')
                        document.body.removeChild(ta)
                        setCopiedIdx(i)
                        setTimeout(() => setCopiedIdx(null), 1500)
                      }
                    }} className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${copiedIdx === i ? 'bg-green-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'}`} title="Copy prompt">
                      {copiedIdx === i ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => exportAsHtml(msg.content)} className="w-5 h-5 bg-zinc-700 hover:bg-zinc-600 rounded-full flex items-center justify-center text-zinc-300 transition-colors" title="View as HTML">
                        <FileCode className="w-3 h-3" />
                      </button>
                      <button onClick={() => exportAsPdf(msg.content)} className="w-5 h-5 bg-zinc-700 hover:bg-zinc-600 rounded-full flex items-center justify-center text-zinc-300 transition-colors" title="Save as PDF">
                        <FileText className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleRemoveMessage(i)}
                    className="w-5 h-5 bg-zinc-700 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors"
                    title="Remove message"
                  >
                    <X className="w-3 h-3 text-zinc-300" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <button onClick={handleStop} className="bg-red-600 hover:bg-red-500 rounded-lg px-3 py-2 flex items-center gap-1.5 text-white text-xs font-medium transition-colors" title="Stop generating">
                <Square className="w-3.5 h-3.5 fill-current" /> Stop
              </button>
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        {pendingFile && (
          <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2">
            <span>{fileIcon(pendingFile.type)}</span>
            <span className="text-sm text-zinc-300 truncate flex-1">{pendingFile.name}</span>
            <span className="text-xs text-zinc-500">{formatSize(pendingFile.size)}</span>
            <button onClick={removePendingFile} className="p-1 text-zinc-400 hover:text-red-400 rounded transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            accept="*/*"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700 hover:text-zinc-200 transition-colors disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-500 text-sm"
            placeholder="Type a message..."
          />
          <button
            onClick={handleSend}
            disabled={(!chatInput.trim() && !pendingFile) || sending || !config?.hasApiKey}
            className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── WhatsApp Integration Section ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-green-400" />
          <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">WhatsApp Integration</h3>
        </div>
        <p className="text-sm text-zinc-400">
          Send AI prompts directly from WhatsApp using the <code className="text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono">ws ai: &lt;prompt&gt;</code> command.
        </p>
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm">
          <p className="text-zinc-500 mb-1">API Endpoint (internal):</p>
          <code className="text-zinc-300 font-mono text-xs">POST /api/omniroute/chat</code>
        </div>
        <p className="text-xs text-zinc-600">
          The AI will use the system prompt and model configured above when responding to WhatsApp messages. Keys are rotated automatically.
        </p>
      </div>
    </div>
  )
}
