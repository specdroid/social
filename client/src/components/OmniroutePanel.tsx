import { useState, useEffect, useRef } from 'react'
import { Brain, Send, Check, X, Eye, EyeOff, Loader2, MessageSquare } from 'lucide-react'
import { useApi } from '../hooks/useApi'

interface Config {
  baseUrl: string
  hasApiKey: boolean
  model: string
  systemPrompt: string
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
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testStatus, setTestStatus] = useState<{ ok: boolean; reply?: string; error?: string; msg?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadConfig()
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

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const data = await put<Config>('/api/omniroute/config', {
        baseUrl,
        apiKey: apiKey || undefined,
        model,
        systemPrompt,
      })
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
      if (data) {
        setTestStatus(data)
      }
    } catch (e: any) {
      setTestStatus({ ok: false, msg: e.message || 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSend() {
    if (!chatInput.trim() || sending) return
    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() }
    setMessages((prev) => [...prev, userMsg])
    setChatInput('')
    setSending(true)
    try {
      const data = await post<{ reply: string }>('/api/omniroute/chat', {
        messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
      })
      if (data) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
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
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-500 text-sm font-mono"
            placeholder="https://omniroutelb.duckdns.org/v1"
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-1">Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-500 text-sm font-mono"
            placeholder="auto/coding:free"
          />
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            API Key {config?.hasApiKey && <span className="text-green-400 text-xs">(configured)</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-500 text-sm font-mono pr-10"
              placeholder={config?.hasApiKey ? 'Leave blank to keep current key' : 'sk-...'}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-1">System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
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
            <span className={`text-sm ${saveMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
              {saveMsg.text}
            </span>
          )}
          {testStatus && (
            <span className={`text-sm flex items-center gap-1 ${testStatus.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testStatus.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
              {testStatus.ok ? 'Connected' : testStatus.error || testStatus.msg}
            </span>
          )}
        </div>
      </div>

      {/* ── Chat Section ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Chat</h3>

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 h-80 overflow-y-auto space-y-3">
          {messages.length === 0 && (
            <p className="text-zinc-600 text-sm text-center pt-8">Send a message to start chatting with the AI</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white'
                    : 'bg-zinc-800 text-zinc-200'
                }`}
              >
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
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
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
          The AI will use the system prompt and model configured above when responding to WhatsApp messages.
        </p>
      </div>
    </div>
  )
}
