import { useState, useEffect, useRef } from 'react'
import { Brain, Send, Check, X, Eye, EyeOff, Loader2, MessageSquare, Plus, Trash2, Key } from 'lucide-react'
import { useApi } from '../hooks/useApi'

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
}

export function OmniroutePanel() {
  const { get, post, put } = useApi()
  const [config, setConfig] = useState<Config | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('auto/coding:free')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showNewKeyInput, setShowNewKeyInput] = useState(false)
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
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadConfig()
    loadKeys()
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

  async function handleSend() {
    if (!chatInput.trim() || sending) return
    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() }
    setMessages(prev => [...prev, userMsg])
    setChatInput('')
    setSending(true)
    try {
      const data = await post<{ reply: string }>('/api/omniroute/chat', {
        messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
      })
      if (data) setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      setSending(false)
    }
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
            placeholder="auto/coding:free"
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
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Chat</h3>

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 h-80 overflow-y-auto space-y-3">
          {messages.length === 0 && (
            <p className="text-zinc-600 text-sm text-center pt-8">Send a message to start chatting with the AI</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                msg.role === 'user' ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-200'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 rounded-lg px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
              </div>
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        <div className="flex gap-2">
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
            disabled={!chatInput.trim() || sending || !config?.hasApiKey}
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
