import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BookOpen, Plus, Trash2, FileText, Send,
  Link as LinkIcon, Loader2, AlertCircle, Check,
  Brain, Download, Volume2, Layers, Zap, MessageSquare
} from 'lucide-react'
import { useApi } from '../hooks/useApi'

interface Notebook { id: string; title: string; createdAt?: string }
interface Source { id: string; title?: string; sourceType?: string; type?: string; status?: string }
interface Note { id: string; title?: string; preview?: string; content?: string }
interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Artifact { id: string; type?: string; type_id?: string; title?: string; status?: string }

export function NotebookLMPage() {
  const { get, post, del } = useApi()
  const [connected, setConnected] = useState(false)
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [selectedNb, setSelectedNb] = useState<Notebook | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState<Note[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [tab, setTab] = useState<'sources' | 'chat' | 'notes' | 'artifacts'>('sources')
  const [newNbTitle, setNewNbTitle] = useState('')
  const [showNewNb, setShowNewNb] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { checkHealth() }, [])

  const checkHealth = async () => {
    try {
      const data = await get<{ connected: boolean }>('/api/notebooklm/health')
      setConnected(data.connected)
      if (data.connected) loadNotebooks()
    } catch { setConnected(false) }
  }

  const loadNotebooks = async () => {
    try {
      const data = await get<{ notebooks?: Notebook[] }>('/api/notebooklm/notebooks')
      setNotebooks(data.notebooks || [])
    } catch (err) { showMsg('error', (err as Error).message) }
  }

  const loadNotebookDetails = async (nb: Notebook) => {
    setSelectedNb(nb)
    setSelectedSources(new Set())
    setChat([])
    setLoading(true)
    try {
      const srcData = await get<{ sources?: Source[] }>(`/api/notebooklm/notebooks/${nb.id}/sources`).catch(() => ({ sources: [] }))
      setSources(srcData.sources || [])
      const noteData = await get<{ notes?: Note[] }>(`/api/notebooklm/notebooks/${nb.id}/notes`).catch(() => ({ notes: [] }))
      setNotes(noteData.notes || [])
      const artData = await get<{ artifacts?: Artifact[] }>(`/api/notebooklm/notebooks/${nb.id}/artifacts`).catch(() => ({ artifacts: [] }))
      setArtifacts(artData.artifacts || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  const refreshTab = useCallback(async () => {
    if (!selectedNb) return
    setLoading(true)
    try {
      if (tab === 'sources') {
        const data = await get<{ sources?: Source[] }>(`/api/notebooklm/notebooks/${selectedNb.id}/sources`).catch(() => ({ sources: [] }))
        setSources(data.sources || [])
      } else if (tab === 'notes') {
        const data = await get<{ notes?: Note[] }>(`/api/notebooklm/notebooks/${selectedNb.id}/notes`).catch(() => ({ notes: [] }))
        setNotes(data.notes || [])
      } else if (tab === 'artifacts') {
        const data = await get<{ artifacts?: Artifact[] }>(`/api/notebooklm/notebooks/${selectedNb.id}/artifacts`).catch(() => ({ artifacts: [] }))
        setArtifacts(data.artifacts || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [selectedNb, tab, get])

  useEffect(() => { if (selectedNb) refreshTab() }, [tab])

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const createNotebook = async () => {
    if (!newNbTitle.trim()) return
    try {
      const data = await post<{ notebook?: Notebook }>('/api/notebooklm/notebooks', { title: newNbTitle })
      setNewNbTitle('')
      setShowNewNb(false)
      showMsg('success', 'Notebook created')
      await loadNotebooks()
      if (data.notebook) loadNotebookDetails(data.notebook)
    } catch (err) { showMsg('error', (err as Error).message) }
  }

  const deleteNotebook = async (id: string) => {
    try {
      await del(`/api/notebooklm/notebooks/${id}`)
      if (selectedNb?.id === id) { setSelectedNb(null); setSources([]); setNotes([]); setChat([]); setArtifacts([]) }
      showMsg('success', 'Notebook deleted')
      await loadNotebooks()
    } catch (err) { showMsg('error', (err as Error).message) }
  }

  const addUrlSource = async () => {
    if (!selectedNb || !sourceUrl.trim()) return
    try {
      await post(`/api/notebooklm/notebooks/${selectedNb.id}/sources/url`, { url: sourceUrl })
      setSourceUrl('')
      showMsg('success', 'Source added')
      refreshTab()
    } catch (err) { showMsg('error', (err as Error).message) }
  }

  const addTextSource = async () => {
    if (!selectedNb || !sourceText.trim()) return
    try {
      await post(`/api/notebooklm/notebooks/${selectedNb.id}/sources/text`, { text: sourceText, title: sourceTitle })
      setSourceText(''); setSourceTitle('')
      showMsg('success', 'Source added')
      refreshTab()
    } catch (err) { showMsg('error', (err as Error).message) }
  }

  const deleteSource = async (sourceId: string) => {
    if (!selectedNb) return
    try {
      await del(`/api/notebooklm/notebooks/${selectedNb.id}/sources/${sourceId}`)
      setSources(s => s.filter(x => x.id !== sourceId))
      setSelectedSources(prev => { const next = new Set(prev); next.delete(sourceId); return next })
    } catch (err) { showMsg('error', (err as Error).message) }
  }

  const toggleSource = (sourceId: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }

  const toggleAllSources = () => {
    if (selectedSources.size === sources.length) setSelectedSources(new Set())
    else setSelectedSources(new Set(sources.map(s => s.id)))
  }

  const sendChat = async () => {
    if (!selectedNb || !chatInput.trim()) return
    const q = chatInput.trim()
    setChatInput('')
    setChat(c => [...c, { role: 'user', content: q }])
    setChatLoading(true)
    try {
      const selected = sources.filter(s => selectedSources.has(s.id))
      const sourceNames = selected.length > 0 ? selected.map(s => s.title || s.id).join(', ') : undefined
      const question = sourceNames ? `[About: ${sourceNames}] ${q}` : q
      const data = await post<{ answer?: string; content?: string; response?: string }>(`/api/notebooklm/notebooks/${selectedNb.id}/chat`, { question })
      const answer = data.answer || data.content || data.response || JSON.stringify(data)
      setChat(c => [...c, { role: 'user', content: q }, { role: 'assistant', content: answer }])
    } catch (err) {
      setChat(c => [...c, { role: 'user', content: q }, { role: 'assistant', content: `Error: ${(err as Error).message}` }])
    }
    setChatLoading(false)
  }

  const generateArtifact = async (type: string) => {
    if (!selectedNb) return
    try {
      const data = await post<{ task_id?: string; id?: string }>(`/api/notebooklm/notebooks/${selectedNb.id}/artifacts`, { type })
      showMsg('success', `${type} generation started`)
      pollArtifact(selectedNb.id, data.task_id || data.id || '')
    } catch (err) { showMsg('error', (err as Error).message) }
  }

  const pollArtifact = async (nbId: string, taskId: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const data = await get<{ status?: string; state?: string }>(`/api/notebooklm/notebooks/${nbId}/artifacts/${taskId}`)
        if (data.status === 'completed' || data.state === 'completed') {
          showMsg('success', 'Artifact ready!')
          refreshTab()
          return
        }
        if (data.status === 'failed' || data.state === 'failed') {
          showMsg('error', 'Artifact generation failed')
          return
        }
      } catch { /* retry */ }
    }
    showMsg('error', 'Timed out waiting for artifact')
  }

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])

  const sourceIcon = (type?: string) => {
    if (type === 'pdf') return <FileText className="w-4 h-4 text-red-400 shrink-0" />
    if (type === 'image') return <FileText className="w-4 h-4 text-blue-400 shrink-0" />
    if (type === 'docx') return <FileText className="w-4 h-4 text-blue-300 shrink-0" />
    return <FileText className="w-4 h-4 text-zinc-500 shrink-0" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-50 flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-400" /> NotebookLM
          </h2>
          <p className="text-zinc-400 text-sm mt-1">Manage notebooks, sources, and AI-powered analysis</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          {connected && (
            <button onClick={() => setShowNewNb(!showNewNb)} className="flex items-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200">
              <Plus className="w-4 h-4" /> New Notebook
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {msg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      {!connected && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <Brain className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">NotebookLM Not Connected</h3>
          <p className="text-zinc-500 text-sm mb-4">Run on VPS: notebooklm list --json</p>
        </div>
      )}

      {showNewNb && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
          <input value={newNbTitle} onChange={e => setNewNbTitle(e.target.value)} placeholder="Notebook title..."
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 text-sm focus:outline-none focus:border-zinc-600"
            onKeyDown={e => e.key === 'Enter' && createNotebook()} autoFocus />
          <button onClick={createNotebook} className="px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200">Create</button>
        </div>
      )}

      <div className="flex gap-6">
        {connected && (
          <div className="w-64 shrink-0 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2">Notebooks ({notebooks.length})</p>
            {notebooks.map(nb => (
              <div key={nb.id} className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${selectedNb?.id === nb.id ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-300'}`} onClick={() => loadNotebookDetails(nb)}>
                <BookOpen className="w-4 h-4 shrink-0" />
                <span className="truncate flex-1">{nb.title}</span>
                <button onClick={e => { e.stopPropagation(); deleteNotebook(nb.id) }} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-opacity">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {notebooks.length === 0 && <p className="text-zinc-600 text-sm px-2">No notebooks yet</p>}
          </div>
        )}

        {selectedNb && (
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="border-b border-zinc-800 px-4 py-3">
              <h3 className="font-semibold text-zinc-50">{selectedNb.title}</h3>
            </div>
            <div className="flex border-b border-zinc-800">
              {(['sources', 'chat', 'notes', 'artifacts'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-zinc-50 border-b-2 border-zinc-50' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  {t} {t === 'sources' && <span className="ml-1 text-xs text-zinc-600">({sources.length})</span>}
                  {t === 'notes' && <span className="ml-1 text-xs text-zinc-600">({notes.length})</span>}
                  {t === 'artifacts' && <span className="ml-1 text-xs text-zinc-600">({artifacts.length})</span>}
                </button>
              ))}
            </div>

            <div className="p-4 max-h-[calc(100vh-340px)] overflow-y-auto">
              {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-zinc-400 animate-spin" /></div>}

              {tab === 'sources' && !loading && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase">Add URL Source</p>
                    <div className="flex gap-2">
                      <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-zinc-600" onKeyDown={e => e.key === 'Enter' && addUrlSource()} />
                      <button onClick={addUrlSource} className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700"><LinkIcon className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase">Add Text Source</p>
                    <input value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} placeholder="Title (optional)" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-zinc-600 mb-2" />
                    <textarea value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="Paste text content..." rows={3} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-zinc-600 resize-none" />
                    <button onClick={addTextSource} className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700">Add Text</button>
                  </div>
                  <div className="border-t border-zinc-800 pt-3 space-y-1">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-zinc-500 uppercase">Sources ({sources.length})</p>
                      {sources.length > 0 && (
                        <button onClick={toggleAllSources} className="text-xs text-zinc-500 hover:text-zinc-300">
                          {selectedSources.size === sources.length ? 'Deselect all' : 'Select all'}
                        </button>
                      )}
                    </div>
                    {sources.map(s => (
                      <div key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg group cursor-pointer transition-colors ${selectedSources.has(s.id) ? 'bg-purple-500/10 border border-purple-500/30' : 'bg-zinc-950 hover:bg-zinc-900'}`} onClick={() => toggleSource(s.id)}>
                        <input type="checkbox" checked={selectedSources.has(s.id)} onChange={() => toggleSource(s.id)} className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-950 text-purple-500 focus:ring-purple-500 focus:ring-offset-0" onClick={e => e.stopPropagation()} />
                        {sourceIcon(s.type || s.sourceType)}
                        <span className="flex-1 text-sm text-zinc-400 truncate">{s.title || s.sourceType || s.id}</span>
                        <span className="text-xs text-zinc-600">{s.type || s.sourceType}</span>
                        <button onClick={e => { e.stopPropagation(); deleteSource(s.id) }} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    ))}
                    {sources.length === 0 && <p className="text-zinc-600 text-sm">No sources yet</p>}
                  </div>
                  {selectedSources.size > 0 && (
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-2 text-sm text-purple-400">
                      {selectedSources.size} source{selectedSources.size > 1 ? 's' : ''} selected — go to Chat to ask about them
                    </div>
                  )}
                </div>
              )}

              {tab === 'chat' && !loading && (
                <div className="flex flex-col h-full">
                  {selectedSources.size > 0 && (
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2 mb-3 text-xs text-purple-400 flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5" />
                      Chatting about: {sources.filter(s => selectedSources.has(s.id)).map(s => s.title || s.id).slice(0, 3).join(', ')}
                      {selectedSources.size > 3 && ` +${selectedSources.size - 3} more`}
                    </div>
                  )}
                  <div className="flex-1 space-y-3 mb-4 overflow-y-auto">
                    {chat.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">{selectedSources.size > 0 ? 'Ask a question about the selected sources' : 'Ask a question about all sources'}</p>}
                    {chat.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] px-4 py-2.5 rounded-xl text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-zinc-800 text-zinc-50' : 'bg-zinc-950 text-zinc-300 border border-zinc-800'}`}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex gap-2 border-t border-zinc-800 pt-3">
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder={selectedSources.size > 0 ? 'Ask about selected sources...' : 'Ask a question...'} className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-50 focus:outline-none focus:border-zinc-600" onKeyDown={e => e.key === 'Enter' && !chatLoading && sendChat()} disabled={chatLoading} />
                    <button onClick={sendChat} disabled={chatLoading} className="px-4 py-2.5 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"><Send className="w-4 h-4" /></button>
                  </div>
                </div>
              )}

              {tab === 'notes' && !loading && (
                <div className="space-y-3">
                  {notes.map(n => (
                    <div key={n.id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-zinc-300">{n.title || 'Untitled'}</h4>
                      <p className="text-sm text-zinc-500 mt-1 line-clamp-4">{n.preview || n.content || ''}</p>
                    </div>
                  ))}
                  {notes.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">No notes yet</p>}
                </div>
              )}

              {tab === 'artifacts' && !loading && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { type: 'quiz', label: 'Quiz', icon: Zap },
                      { type: 'flashcards', label: 'Flashcards', icon: Layers },
                      { type: 'audio', label: 'Podcast', icon: Volume2 },
                      { type: 'report', label: 'Report', icon: FileText },
                      { type: 'slide-deck', label: 'Slides', icon: Layers },
                      { type: 'infographic', label: 'Infographic', icon: FileText },
                      { type: 'mind-map', label: 'Mind Map', icon: Brain },
                      { type: 'data-table', label: 'Data Table', icon: FileText },
                    ].map(({ type, label, icon: Icon }) => (
                      <button key={type} onClick={() => generateArtifact(type)} className="flex flex-col items-center gap-2 p-4 bg-zinc-950 border border-zinc-800 rounded-xl hover:bg-zinc-800/50 transition-colors text-sm text-zinc-400 hover:text-zinc-200">
                        <Icon className="w-5 h-5" /> {label}
                      </button>
                    ))}
                  </div>
                  {artifacts.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-zinc-500 uppercase">Generated</p>
                      {artifacts.map(a => (
                        <div key={a.id} className="flex items-center gap-2 px-3 py-2 bg-zinc-950 rounded-lg">
                          <Download className="w-4 h-4 text-zinc-500 shrink-0" />
                          <span className="text-sm text-zinc-400 truncate">{a.title || a.type_id || a.type}</span>
                          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${a.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : a.status === 'processing' ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}>
                            {a.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {artifacts.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">No artifacts yet</p>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
