import { useState, useEffect, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { TelegramIcon } from './icons/TelegramIcon'
import { useSocket } from '../hooks/useSocket'
import { Search, Send, Paperclip, Loader2, RefreshCw, Clock } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || ''

interface DialogInfo {
  id: string
  name: string
  type: 'user' | 'group' | 'channel'
  unreadCount: number
  lastMessage: string | null
  date: string | null
  phone?: string
  canSend: boolean
}

interface MessageInfo {
  id: number
  fromId: string
  text: string
  date: string
  out: boolean
  media: { type: string; caption?: string } | null
}

export function TelegramChat({ onDisconnect, phone }: { onDisconnect: () => void; phone: string | null }) {
  const { get } = useApi()
  const { socket } = useSocket()
  const [dialogs, setDialogs] = useState<DialogInfo[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageInfo[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingDialogs, setLoadingDialogs] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const chatEnd = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const selectedDialog = dialogs.find((d) => d.id === selectedId) || null
  const filteredDialogs = dialogs.filter(
    (d) => d.name.toLowerCase().includes(search.toLowerCase()) || d.phone?.includes(search)
  )

  useEffect(() => {
    loadDialogs()
    fetchLastSync()
  }, [])

  async function fetchLastSync() {
    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`${API_URL}/api/telegram/synced-conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const convs = await resp.json()
      if (convs.length > 0) setLastSync(convs[0].lastSyncAt || null)
    } catch { /* ignore */ }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`${API_URL}/api/telegram/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      await resp.json()
      setLastSync(new Date().toISOString())
      setSyncing(false)
      loadDialogs()
    } catch { /* ignore */ }
    setSyncing(false)
  }

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!socket) return
    const handler = (data: { chatId: string; message: MessageInfo }) => {
      if (data.chatId === selectedId) {
        setMessages((prev) => [...prev, data.message])
      }
      setDialogs((prev) =>
        prev.map((d) =>
          d.id === data.chatId
            ? { ...d, lastMessage: data.message.text || '[Media]', date: data.message.date, unreadCount: d.id === selectedId ? 0 : d.unreadCount + 1 }
            : d
        )
      )
    }
    socket.on('telegram:message', handler)
    return () => { socket.off('telegram:message', handler) }
  }, [socket, selectedId])

  async function loadDialogs() {
    setLoadingDialogs(true)
    try {
      const data = await get<DialogInfo[]>('/api/telegram/dialogs')
      if (data) setDialogs(data)
    } catch { /* ignore */ }
    setLoadingDialogs(false)
  }

  async function loadMessages(chatId: string) {
    setLoadingMessages(true)
    setMessages([])
    try {
      const data = await get<MessageInfo[]>(`/api/telegram/history/${chatId}?limit=50`)
      if (data) setMessages(data)
    } catch { /* ignore */ }
    setLoadingMessages(false)
  }

  function selectDialog(id: string) {
    setSelectedId(id)
    setDialogs((prev) => prev.map((d) => (d.id === id ? { ...d, unreadCount: 0 } : d)))
    loadMessages(id)
  }

  async function handleSend() {
    if (!chatInput.trim() || !selectedId || sending) return
    const text = chatInput.trim()
    setChatInput('')
    setSending(true)
    try {
      const token = localStorage.getItem('token')
      await fetch(`${API_URL}/api/telegram/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chatId: selectedId, text }),
      })
      const now = new Date().toISOString()
      const msg: MessageInfo = { id: Date.now(), fromId: 'me', text, date: now, out: true, media: null }
      setMessages((prev) => [...prev, msg])
    } catch { /* ignore */ }
    setSending(false)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedId) return
    setSending(true)
    try {
      const token = localStorage.getItem('token')
      const form = new FormData()
      form.append('file', file)
      form.append('chatId', selectedId)
      if (file.name) form.append('caption', file.name)
      await fetch(`${API_URL}/api/telegram/send-media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const now = new Date().toISOString()
      const msg: MessageInfo = { id: Date.now(), fromId: 'me', text: `[${file.type.startsWith('image/') ? 'Photo' : 'File'}]`, date: now, out: true, media: { type: file.type, caption: file.name } }
      setMessages((prev) => [...prev, msg])
    } catch { /* ignore */ }
    setSending(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TelegramIcon className="w-6 h-6 text-blue-400" />
          <h2 className="text-lg font-semibold text-zinc-50">Telegram</h2>
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {phone || 'Connected'}
          </span>
          {lastSync && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-600">
              <Clock className="w-3 h-3" />
              {new Date(lastSync).toLocaleDateString()} {new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button onClick={onDisconnect} className="text-xs text-red-400 hover:text-red-300 transition-colors">
            Disconnect
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* ── Left panel: dialogs ── */}
        <div className="w-72 flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-zinc-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
                placeholder="Search contacts..."
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingDialogs ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
            ) : filteredDialogs.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">No conversations</p>
            ) : (
              filteredDialogs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => selectDialog(d.id)}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors ${
                    selectedId === d.id ? 'bg-zinc-800' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-200 truncate">{d.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {d.unreadCount > 0 && (
                        <span className="bg-blue-600 text-[10px] text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                          {d.unreadCount > 99 ? '99+' : d.unreadCount}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600">{d.type === 'user' ? '' : d.type === 'group' ? 'G' : 'C'}</span>
                    </div>
                  </div>
                  {d.lastMessage && (
                    <p className="text-xs text-zinc-500 truncate mt-0.5">{d.lastMessage}</p>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="p-2 border-t border-zinc-800 flex justify-between text-[11px] text-zinc-500">
            <span>{dialogs.length} conversations</span>
            <span>{dialogs.filter((d) => d.type === 'user').length} contacts</span>
          </div>
        </div>

        {/* ── Right panel: chat ── */}
        <div className="flex-1 flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-zinc-600 text-sm">Select a conversation to start chatting</p>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {loadingMessages ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
                ) : messages.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center pt-8">No messages yet</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.out ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                          m.out ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-200'
                        }`}
                      >
                        {m.media && !m.text.startsWith('[') && (
                          <p className="text-xs text-zinc-400 mb-1 italic">
                            {m.media.type.includes('Photo') ? '[Photo]' : '[Media]'}
                          </p>
                        )}
                        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                        <p className={`text-[10px] mt-1 ${m.out ? 'text-blue-200' : 'text-zinc-500'}`}>
                          {new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEnd} />
              </div>

              {selectedDialog && !selectedDialog.canSend ? (
                <div className="p-3 border-t border-zinc-800 text-center text-xs text-zinc-500">
                  Read-only — you are not an admin of this channel
                </div>
              ) : (
                <div className="p-3 border-t border-zinc-800 flex gap-2 items-center">
                  <input
                    type="file"
                    ref={fileRef}
                    onChange={handleFile}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={sending}
                    className="p-2 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
                    placeholder="Type a message..."
                  />
                  <button
                    onClick={handleSend}
                    disabled={!chatInput.trim() || sending}
                    className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
