import { useState, useEffect } from 'react'
import { Smartphone, Link2, Unlink, Loader2, AlertCircle, Wifi, ChevronDown, ChevronUp, MessageSquare, Trash2, Users, Search, RefreshCw, Upload, FolderPlus, Check, Eye, Pencil } from 'lucide-react'
import { useSocket } from '../hooks/useSocket'
import { useApi } from '../hooks/useApi'
import { SavedGroupListsPanel } from './SavedGroupListsPanel'
import { GatewayPanel } from './GatewayPanel'

interface ConnectionState {
  connected: boolean
  connecting: boolean
  attempt: number
  maxAttempts: number
  qrAvailable: boolean
}

const API_URL = import.meta.env.VITE_API_URL || ''

export function WhatsAppLinker() {
  const { socket, connected: socketConnected } = useSocket()
  const { get, post, del, put } = useApi()
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [waConnected, setWaConnected] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('Click "Connect WhatsApp" to begin')
  const [statusState, setStatusState] = useState<string>('idle')
  const [actionLoading, setActionLoading] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)
  const [sendTestLoading, setSendTestLoading] = useState(false)
  const [sendTestResult, setSendTestResult] = useState<string | null>(null)
  const [cleanAuthLoading, setCleanAuthLoading] = useState(false)
  const [cleanAuthResult, setCleanAuthResult] = useState<string | null>(null)
  const [forceCleanLoading, setForceCleanLoading] = useState(false)
  const [contacts, setContacts] = useState<Array<{ id: string; name?: string; notify?: string; verifiedName?: string; phoneNumber?: string }>>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsOpen, setContactsOpen] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const [expandedContact, setExpandedContact] = useState<string | null>(null)
  const [vcfLoading, setVcfLoading] = useState(false)
  const [vcfResult, setVcfResult] = useState<string | null>(null)
  const [importedContacts, setImportedContacts] = useState<Array<{ id: string; name?: string; notify?: string; phoneNumber?: string }>>([])
  const [importedContactsOpen, setImportedContactsOpen] = useState(false)
  const [importedContactSearch, setImportedContactSearch] = useState('')
  const [groups, setGroups] = useState<Array<{ id: string; name: string; memberJids: string[] }>>([])
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [groupMemberSearch, setGroupMemberSearch] = useState('')
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContactName, setNewContactName] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')
  const [addContactLoading, setAddContactLoading] = useState(false)
  const [addContactError, setAddContactError] = useState<string | null>(null)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [clearLoading, setClearLoading] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [editGroupName, setEditGroupName] = useState('')
  const [editGroupMembers, setEditGroupMembers] = useState<Set<string>>(new Set())
  const [editGroupSearch, setEditGroupSearch] = useState('')

  useEffect(() => {
    loadStatus()
  }, [])

  useEffect(() => {
    if (!socket) return

    socket.on('whatsapp:state', (state: ConnectionState) => {
      if (state.connected) {
        setWaConnected(true)
        setStatusState('connected')
      }
    })

    socket.on('whatsapp:qr', (data: { qr: string }) => {
      setQrCode(data.qr)
      setStatusState('qr_ready')
      setActionLoading(false)
    })

    socket.on('whatsapp:ready', () => {
      setQrCode(null)
      setWaConnected(true)
      setStatusState('connected')
      setStatusMessage('WhatsApp connected successfully.')
      setActionLoading(false)
    })

    socket.on('whatsapp:disconnected', () => {
      setWaConnected(false)
      setStatusState('disconnected')
      setStatusMessage('WhatsApp disconnected.')
    })

    socket.on('whatsapp:status', (data: { state: string; message: string; attempt?: number; maxAttempts?: number }) => {
      setStatusMessage(data.message)
      setStatusState(data.state)
      if (data.state === 'qr_ready') {
        setActionLoading(false)
      }
    })

    return () => {
      socket.off('connect')
      socket.off('whatsapp:state')
      socket.off('whatsapp:qr')
      socket.off('whatsapp:ready')
      socket.off('whatsapp:disconnected')
      socket.off('whatsapp:status')
    }
  }, [socket])

  async function loadStatus() {
    try {
      const data = await get<{ connected: boolean; connecting: boolean; attempt: number; maxAttempts: number }>('/api/whatsapp/status')
      setWaConnected(data.connected)
      if (data.connected) {
        setStatusState('connected')
        setStatusMessage('WhatsApp connected.')
      } else if (data.connecting) {
        setStatusState('connecting')
        setStatusMessage(`Connecting... attempt ${data.attempt + 1}/${data.maxAttempts}`)
      }
    } catch {
      // server may be starting, stay in idle
    }
  }

  async function runDiagnostics() {
    setDiagLoading(true)
    setDiagOpen(true)
    try {
      const response = await fetch(`${API_URL}/api/whatsapp/diagnostics`)
      const data = await response.json()
      setDiagnostics(data)
    } catch {
      setDiagnostics({ error: 'Could not reach diagnostics endpoint' })
    } finally {
      setDiagLoading(false)
    }
  }

  async function handleConnect() {
    setActionLoading(true)
    setStatusState('connecting')
    setStatusMessage('Starting WhatsApp connection...')

    if (socket?.connected) {
      socket.emit('whatsapp:connect')
    } else {
      const waitForSocket = setInterval(() => {
        if (socket?.connected) {
          clearInterval(waitForSocket)
          socket.emit('whatsapp:connect')
        }
      }, 500)

      setTimeout(() => {
        clearInterval(waitForSocket)
        if (statusState === 'connecting') {
          setStatusState('idle')
          setStatusMessage('Could not reach server. Is it running?')
          setActionLoading(false)
        }
      }, 10000)
    }
  }

  async function handleDisconnect() {
    setActionLoading(true)
    try {
      await post('/api/whatsapp/disconnect')
      setWaConnected(false)
      setQrCode(null)
      setStatusState('idle')
      setStatusMessage('Disconnected.')
    } catch {
      setStatusMessage('Failed to disconnect.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSendTest() {
    setSendTestLoading(true)
    setSendTestResult(null)
    try {
      await post('/api/whatsapp/send-test')
      setSendTestResult('Message sent successfully')
    } catch {
      setSendTestResult('Failed to send message')
    } finally {
      setSendTestLoading(false)
      setTimeout(() => setSendTestResult(null), 4000)
    }
  }

  async function handleCleanAuth() {
    setCleanAuthLoading(true)
    setCleanAuthResult(null)
    try {
      const res = await post<{ deleted: number }>('/api/whatsapp/clear-credentials')
      setCleanAuthResult(`Cleared ${res.deleted} auth files. Generating new QR code...`)
      setWaConnected(false)
      setQrCode(null)
      setStatusState('connecting')
      setStatusMessage('Auth cleared. Starting fresh connection for new QR code...')
      if (socket?.connected) {
        socket.emit('whatsapp:connect')
      }
    } catch {
      setCleanAuthResult('Failed to clear credentials')
    } finally {
      setCleanAuthLoading(false)
      setTimeout(() => setCleanAuthResult(null), 8000)
    }
  }

  async function handleForceClean() {
    if (!window.confirm('This will disconnect WhatsApp and delete ALL auth files. You will need to re-link. Continue?')) return
    setForceCleanLoading(true)
    try {
      await post('/api/whatsapp/force-clean-auth')
      setWaConnected(false)
      setQrCode(null)
      setStatusState('idle')
      setStatusMessage('Auth forcefully cleaned. Click Connect to re-link.')
    } catch {
      setStatusMessage('Force clean failed')
    } finally {
      setForceCleanLoading(false)
    }
  }

  async function handleGetContacts() {
    setContactsLoading(true)
    setContactsOpen(true)
    setContactSearch('')
    try {
      const data = await get<{ contacts: Array<{ id: string; name?: string; notify?: string; verifiedName?: string; phoneNumber?: string }> }>('/api/whatsapp/contacts')
      setContacts(data.contacts || [])
    } catch (err) {
      console.error('Get contacts failed:', err)
      setContacts([])
    } finally {
      setContactsLoading(false)
    }
  }

  async function handleImportVcf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setVcfLoading(true)
    setVcfResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const token = localStorage.getItem('token')
      const xhr = new XMLHttpRequest()
      const result = await new Promise<{ added: number }>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
          else reject(new Error('Import failed'))
        }
        xhr.onerror = () => reject(new Error('Import failed'))
        xhr.open('POST', `${API_URL}/api/whatsapp/contacts/import-vcf`)
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.send(fd)
      })
      setVcfResult(`Imported ${result.added} contacts`)
      await handleLoadImportedContacts()
      await handleGetContacts()
    } catch {
      setVcfResult('Import failed')
    } finally {
      setVcfLoading(false)
      e.target.value = ''
      setTimeout(() => setVcfResult(null), 5000)
    }
  }

  async function handleLoadImportedContacts() {
    try {
      const data = await get<{ contacts: Array<{ id: string; name?: string; phoneNumber?: string }> }>('/api/whatsapp/contacts/imported')
      setImportedContacts(data.contacts || [])
    } catch {
      setImportedContacts([])
    }
  }

  async function handleDeleteImportedContact(id: string) {
    try {
      await del(`/api/whatsapp/contacts/imported/${id}`)
      await handleLoadImportedContacts()
    } catch {
      // handle error
    }
  }

  async function handleClearImported() {
    try {
      await del('/api/whatsapp/contacts/imported')
      await handleLoadImportedContacts()
    } catch {
      // handle error
    }
  }

  async function handleAddContact() {
    if (!newContactPhone.trim()) return
    setAddContactLoading(true)
    setAddContactError(null)
    try {
      await post('/api/whatsapp/contacts/imported', { name: newContactName.trim(), phoneNumber: newContactPhone.trim() })
      setNewContactName('')
      setNewContactPhone('')
      setShowAddContact(false)
      setAddContactError(null)
      await handleLoadImportedContacts()
    } catch (err) {
      setAddContactError((err as Error).message || 'Failed to add contact')
    } finally {
      setAddContactLoading(false)
    }
  }

  async function handleLoadGroups() {
    setGroupsLoading(true)
    try {
      const data = await get<{ groups: Array<{ id: string; name: string; memberJids: string[] }> }>('/api/whatsapp/contact-groups')
      setGroups(data.groups || [])
    } catch {
      setGroups([])
    } finally {
      setGroupsLoading(false)
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim() || selectedMembers.size === 0) return
    try {
      await post('/api/whatsapp/contact-groups', {
        name: newGroupName.trim(),
        memberJids: Array.from(selectedMembers),
      })
      setNewGroupName('')
      setSelectedMembers(new Set())
      setShowGroupForm(false)
      await handleLoadGroups()
    } catch {
      // handle error
    }
  }

  async function handleUpdateGroup(id: string) {
    if (!editGroupName.trim() || editGroupMembers.size === 0) return
    try {
      await put(`/api/whatsapp/contact-groups/${id}`, {
        name: editGroupName.trim(),
        memberJids: Array.from(editGroupMembers),
      })
      setEditingGroup(null)
      setEditGroupName('')
      setEditGroupMembers(new Set())
      await handleLoadGroups()
    } catch {
      // handle error
    }
  }

  function startEditGroup(g: { id: string; name: string; memberJids: string[] }) {
    setEditingGroup(g.id)
    setEditGroupName(g.name)
    setEditGroupMembers(new Set(g.memberJids))
    setEditGroupSearch('')
  }

  async function handleClearCredentials() {
    setClearLoading(true)
    try {
      await post('/api/whatsapp/clear-credentials')
      setWaConnected(false)
      setQrCode(null)
      setStatusState('idle')
      setStatusMessage('Credentials cleared. Click "Connect WhatsApp" to generate a new QR code.')
      setShowClearDialog(false)
      document.getElementById('whatsapp-panel')?.scrollIntoView({ behavior: 'smooth' })
    } catch {
      // handle error
    } finally {
      setClearLoading(false)
    }
  }

  async function handleDeleteGroup(id: string) {
    try {
      await del(`/api/whatsapp/contact-groups/${id}`)
      await handleLoadGroups()
    } catch {
      // handle error
    }
  }

  function toggleMember(jid: string) {
    setSelectedMembers(prev => {
      const next = new Set(prev)
      if (next.has(jid)) next.delete(jid)
      else next.add(jid)
      return next
    })
  }

  async function handleResyncContacts() {
    setContactsLoading(true)
    try {
      await post('/api/whatsapp/contacts/resync')
      await handleGetContacts()
    } catch {
      // silent
    } finally {
      setContactsLoading(false)
    }
  }

  const isCtaDisabled = actionLoading

  const diagPass = !!(diagnostics?.tcpConnect as { reachable?: boolean } | undefined)?.reachable

  return (
    <div id="whatsapp-panel" className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-zinc-50">WhatsApp Connection</h2>
        <p className="text-zinc-400 text-sm mt-1">Link your WhatsApp account via QR code</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <Smartphone className="w-5 h-5 text-zinc-400" />
          <div>
            <p className="text-sm font-medium text-zinc-50">
              {statusState === 'connected' ? 'Connected' :
               statusState === 'qr_ready' ? 'Scan QR Code' :
               statusState === 'connecting' ? 'Connecting...' :
               'WhatsApp Device'}
            </p>
            <p className="text-xs text-zinc-500">
              {socketConnected ? 'Connected to server' : 'Connecting to server...'}
            </p>
          </div>
        </div>

        {statusState !== 'idle' && statusState !== 'connected' && statusState !== 'qr_ready' && (
          <div className="flex items-start gap-2 px-3 py-2 bg-zinc-800/50 rounded-lg mb-4">
            {(statusState === 'connecting' || statusState === 'reconnecting') ? (
              <Loader2 className="w-4 h-4 text-yellow-400 mt-0.5 animate-spin shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
            )}
            <p className="text-xs text-zinc-400">{statusMessage}</p>
          </div>
        )}

        <div className="space-y-4">
          {statusState === 'connected' || waConnected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 px-4 py-3 rounded-lg">
                <Smartphone className="w-4 h-4" />
                <span className="text-sm font-medium">WhatsApp Connected</span>
              </div>
              <button
                onClick={handleSendTest}
                disabled={sendTestLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500/10 text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
              >
                {sendTestLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                {sendTestLoading ? 'Sending...' : 'Send Test Message'}
              </button>
              {sendTestResult && (
                <p className={`text-xs text-center ${sendTestResult === 'Message sent successfully' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {sendTestResult}
                </p>
              )}

              <button
                onClick={() => {
                  if (contactsOpen) {
                    setContactsOpen(false)
                  } else {
                    handleGetContacts()
                  }
                }}
                disabled={contactsLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-sky-500/10 text-sky-400 rounded-lg text-sm font-medium hover:bg-sky-500/20 transition-colors disabled:opacity-50"
              >
                {contactsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                {contactsLoading ? 'Loading...' : 'Get Contacts'}
              </button>
              {contactsOpen && (
                <div className="bg-zinc-800/80 rounded-xl overflow-hidden border border-zinc-700/50">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50">
                    <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <input
                      type="text"
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Search contacts..."
                      className="bg-transparent text-xs text-zinc-300 placeholder-zinc-600 flex-1 outline-none"
                    />
                    <button onClick={handleResyncContacts} disabled={contactsLoading} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      <RefreshCw className={`w-3.5 h-3.5 ${contactsLoading ? 'animate-spin' : ''}`} />
                    </button>
                    {contacts.length > 0 && (
                      <button onClick={() => del('/api/whatsapp/contacts').then(() => { setExpandedContact(null); handleGetContacts() })} className="text-zinc-500 hover:text-red-400 transition-colors text-[10px]">
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-zinc-700/30">
                    {contacts.length === 0 && !contactsLoading && (
                      <p className="text-xs text-zinc-500 text-center py-6">No contacts found</p>
                    )}
                    {contacts
                      .filter(c => {
                        if (!contactSearch) return true
                        const q = contactSearch.toLowerCase()
                        return (c.name || '').toLowerCase().includes(q) ||
                               (c.notify || '').toLowerCase().includes(q) ||
                               (c.id || '').toLowerCase().includes(q) ||
                               (c.phoneNumber || '').toLowerCase().includes(q)
                      })
                      .sort((a, b) => {
                        const aHas = (a.name || a.notify) ? 1 : 0
                        const bHas = (b.name || b.notify) ? 1 : 0
                        return bHas - aHas
                      })
                      .map((c) => {
                        const initial = (c.name || c.notify || c.phoneNumber || c.id)[0].toUpperCase()
                        const colors = ['bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600', 'bg-orange-600']
                        const colorIdx = (c.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % colors.length
                        const isExpanded = expandedContact === c.id
                        return (
                        <div key={c.id}>
                          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-700/30 transition-colors">
                            <div className={`w-8 h-8 rounded-full ${colors[colorIdx]} flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm`}>
                              {initial}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-zinc-100 truncate leading-tight">{c.name || c.notify || 'Unknown'}</p>
                              <p className="text-[11px] text-zinc-300 truncate leading-tight mt-0.5">
                                {c.phoneNumber ? `${c.phoneNumber.replace('@s.whatsapp.net', '')} · ` : ''}{c.id.replace('@s.whatsapp.net', '').replace(':52@lid', '')}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => setExpandedContact(isExpanded ? null : c.id)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={async () => { await del(`/api/whatsapp/contacts/${encodeURIComponent(c.id)}`); setExpandedContact(null); await handleGetContacts() }}
                                className="text-zinc-500 hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="px-6 py-2 bg-zinc-800/50 space-y-1 border-t border-zinc-700/20">
                              <p className="text-[11px] text-zinc-500">JID: <span className="text-zinc-400 font-mono">{c.id}</span></p>
                              {c.name && <p className="text-[11px] text-zinc-500">Name: <span className="text-zinc-400">{c.name}</span></p>}
                              {c.notify && <p className="text-[11px] text-zinc-500">Notify: <span className="text-zinc-400">{c.notify}</span></p>}
                              {c.phoneNumber && <p className="text-[11px] text-zinc-500">Phone: <span className="text-zinc-400">+{c.phoneNumber}</span></p>}
                            </div>
                          )}
                        </div>
                      )})}
                  </div>
                  <div className="px-3 py-1.5 border-t border-zinc-700/50 text-[10px] text-zinc-300 text-center">
                    {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
                  </div>
                </div>
              )}
              <button
                onClick={() => { setImportedContactsOpen(!importedContactsOpen); if (!importedContactsOpen) handleLoadImportedContacts() }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/20 transition-colors"
              >
                <Upload className="w-4 h-4" />
                {importedContactsOpen ? 'Hide Imported Contacts' : `Imported Contacts (${importedContacts.length})`}
              </button>
              {importedContactsOpen && (
                <div className="bg-zinc-800/80 rounded-xl overflow-hidden border border-zinc-700/50">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
                    <span className="text-xs text-zinc-400">Import from VCF</span>
                    {importedContacts.length > 0 && (
                      <button onClick={handleClearImported} className="text-[10px] text-red-400 hover:text-red-300 transition-colors">
                        Clear All
                      </button>
                    )}
                  </div>
                  <div className="p-2 border-b border-zinc-700/50">
                    <label className="flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-zinc-600 rounded-lg text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">
                      {vcfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {vcfLoading ? 'Importing...' : 'Upload .vcf file'}
                      <input type="file" accept=".vcf" onChange={handleImportVcf} className="hidden" />
                    </label>
                  </div>
                  {vcfResult && (
                    <p className={`text-[10px] text-center py-1 ${vcfResult.startsWith('Imported') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {vcfResult}
                    </p>
                  )}
                  <div className="px-2 py-1.5 border-b border-zinc-700/30">
                    <div className="relative">
                      <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={importedContactSearch}
                        onChange={(e) => setImportedContactSearch(e.target.value)}
                        placeholder="Search imported contacts..."
                        className="w-full pl-7 pr-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-zinc-700/30">
                    {importedContacts.length === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-4">No imported contacts</p>
                    )}
                    {importedContacts.length > 0 && importedContacts.filter(c => {
                      if (!importedContactSearch) return true
                      const q = importedContactSearch.toLowerCase()
                      return (c.name || '').toLowerCase().includes(q) ||
                             (c.phoneNumber || '').toLowerCase().includes(q) ||
                             c.id.toLowerCase().includes(q)
                    }).length === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-4">No contacts match your search</p>
                    )}
                    {importedContacts
                      .filter(c => {
                        if (!importedContactSearch) return true
                        const q = importedContactSearch.toLowerCase()
                        return (c.name || '').toLowerCase().includes(q) ||
                               (c.phoneNumber || '').toLowerCase().includes(q) ||
                               c.id.toLowerCase().includes(q)
                      })
                      .map(c => (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-700/30">
                        <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {(c.name || c.phoneNumber || c.id)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-zinc-200 truncate">{c.name || 'Unknown'}</p>
                          <p className="text-[10px] text-zinc-500 truncate">{c.phoneNumber ? `+${c.phoneNumber}` : c.id.replace('@s.whatsapp.net', '')}</p>
                        </div>
                        <button onClick={() => handleDeleteImportedContact(c.id)} className="text-zinc-500 hover:text-red-400 transition-colors shrink-0">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowAddContact(!showAddContact)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-teal-500/10 text-teal-400 rounded-lg text-sm font-medium hover:bg-teal-500/20 transition-colors"
              >
                <Users className="w-4 h-4" />
                {showAddContact ? 'Cancel' : 'Add Contact'}
              </button>
              {showAddContact && (
                <div className="bg-zinc-800/80 rounded-xl p-4 border border-zinc-700/50 space-y-3">
                  <p className="text-xs text-zinc-400 font-medium">Contacts added manually</p>
                  <input
                    type="text"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="Name"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  <input
                    type="text"
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    placeholder="Phone number (e.g. +96170123456)"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  {addContactError && (
                    <p className="text-[11px] text-red-400 text-center">{addContactError}</p>
                  )}
                  <button
                    onClick={handleAddContact}
                    disabled={addContactLoading || !newContactPhone.trim()}
                    className="w-full px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {addContactLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {addContactLoading ? 'Saving...' : 'Save Contact'}
                  </button>
                </div>
              )}
              <button
                onClick={() => { setGroupsOpen(!groupsOpen); if (!groupsOpen) handleLoadGroups() }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-violet-500/10 text-violet-400 rounded-lg text-sm font-medium hover:bg-violet-500/20 transition-colors"
              >
                <FolderPlus className="w-4 h-4" />
                {groupsOpen ? 'Hide Contact Groups' : 'Contact Groups'}
              </button>
              {groupsOpen && (
                <div className="bg-zinc-800/80 rounded-xl overflow-hidden border border-zinc-700/50">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
                    <span className="text-xs text-zinc-400 font-medium">Groups ({groups.length})</span>
                    <button
                      onClick={() => setShowGroupForm(!showGroupForm)}
                      className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      {showGroupForm ? 'Cancel' : '+ New Group'}
                    </button>
                  </div>
                  {showGroupForm && (
                    <div className="p-3 border-b border-zinc-700/50 space-y-3">
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Group name..."
                        className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                      <div className="relative">
                        <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={groupMemberSearch}
                          onChange={(e) => setGroupMemberSearch(e.target.value)}
                          placeholder="Search members..."
                          className="w-full pl-7 pr-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {[...contacts.filter(c => c.name || c.notify), ...importedContacts.filter(c => c.name)]
                          .filter(c => {
                            if (!groupMemberSearch) return true
                            const q = groupMemberSearch.toLowerCase()
                            return (c.name || c.notify || '').toLowerCase().includes(q) ||
                                   (c.phoneNumber || c.id).toLowerCase().includes(q)
                          })
                          .map(c => (
                          <div key={c.id} onClick={() => toggleMember(c.id)} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-700/30 cursor-pointer">
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedMembers.has(c.id) ? 'bg-violet-600 border-violet-600' : 'border-zinc-600'}`}>
                              {selectedMembers.has(c.id) && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <span className="text-xs text-zinc-300 truncate">{c.name || c.notify}</span>
                          </div>
                        ))}
                        {contacts.filter(c => c.name || c.notify).length === 0 && importedContacts.filter(c => c.name).length === 0 && (
                          <p className="text-[10px] text-zinc-500 text-center py-2">No named contacts available</p>
                        )}
                      </div>
                      <button
                        onClick={handleCreateGroup}
                        disabled={!newGroupName.trim() || selectedMembers.size === 0}
                        className="w-full px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-500 transition-colors disabled:opacity-50"
                      >
                        Create Group ({selectedMembers.size} members)
                      </button>
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto divide-y divide-zinc-700/30">
                    {groups.length === 0 && !groupsLoading && (
                      <p className="text-xs text-zinc-500 text-center py-4">No groups yet</p>
                    )}
                    {groups.map(g => (
                      <div key={g.id}>
                        <div className="flex items-center justify-between px-3 py-2 hover:bg-zinc-700/30">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-zinc-100 truncate">{g.name}</p>
                            <p className="text-[10px] text-zinc-500">{g.memberJids.length} member{g.memberJids.length !== 1 ? 's' : ''}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => startEditGroup(g)} className="text-zinc-500 hover:text-emerald-400 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDeleteGroup(g.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {expandedGroup === g.id && (
                          <div className="px-6 py-2 bg-zinc-800/50 space-y-1 border-t border-zinc-700/20">
                            {g.memberJids.length === 0 && <p className="text-[10px] text-zinc-500 italic">No members</p>}
                            {g.memberJids.map(jid => {
                              const c = [...contacts, ...importedContacts].find(x => x.id === jid)
                              return (
                                <div key={jid} className="flex items-center justify-between group">
                                  <span className="text-[11px] text-zinc-400 truncate">
                                    {c?.name || c?.notify || c?.phoneNumber || jid.replace('@s.whatsapp.net', '')}
                                  </span>
                                  <button
                                    onClick={async () => {
                                      await put(`/api/whatsapp/contact-groups/${g.id}`, {
                                        name: g.name,
                                        memberJids: g.memberJids.filter(m => m !== jid),
                                      })
                                      await handleLoadGroups()
                                    }}
                                    className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0 ml-2"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {editingGroup === g.id && (
                          <div className="p-3 border-t border-zinc-700/30 space-y-3 bg-zinc-800/50">
                            <input
                              type="text"
                              value={editGroupName}
                              onChange={(e) => setEditGroupName(e.target.value)}
                              placeholder="Group name..."
                              className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                            />
                            <div className="relative">
                              <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type="text"
                                value={editGroupSearch}
                                onChange={(e) => setEditGroupSearch(e.target.value)}
                                placeholder="Search members..."
                                className="w-full pl-7 pr-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                              />
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                              {[...contacts.filter(c => c.name || c.notify), ...importedContacts.filter(c => c.name)]
                                .filter(c => {
                                  if (!editGroupSearch) return true
                                  const q = editGroupSearch.toLowerCase()
                                  return (c.name || c.notify || '').toLowerCase().includes(q) ||
                                         (c.phoneNumber || c.id).toLowerCase().includes(q)
                                })
                                .map(c => (
                                <div key={c.id} onClick={() => {
                                  setEditGroupMembers(prev => {
                                    const next = new Set(prev)
                                    if (next.has(c.id)) next.delete(c.id)
                                    else next.add(c.id)
                                    return next
                                  })
                                }} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-700/30 cursor-pointer">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${editGroupMembers.has(c.id) ? 'bg-emerald-600 border-emerald-600' : 'border-zinc-600'}`}>
                                    {editGroupMembers.has(c.id) && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="text-xs text-zinc-300 truncate">{c.name || c.notify}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleUpdateGroup(g.id)}
                                disabled={!editGroupName.trim() || editGroupMembers.size === 0}
                                className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingGroup(null)}
                                className="px-3 py-1.5 bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-600 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleDisconnect}
                  disabled={isCtaDisabled}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  <Unlink className="w-4 h-4" />
                  {actionLoading ? 'Disconnecting...' : 'Disconnect'}
                </button>
                <button
                  onClick={() => setShowClearDialog(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-rose-500/10 text-rose-400 rounded-lg text-sm font-medium hover:bg-rose-500/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Credentials
                </button>
              </div>
            </div>
          ) : statusState === 'qr_ready' && qrCode ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400 text-center">
                Scan this QR code with your WhatsApp app
              </p>
              <div className="bg-white p-4 rounded-lg flex items-center justify-center">
                <img src={qrCode} alt="WhatsApp QR Code" className="w-48 h-48" />
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                Waiting for scan...
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Click the button below to connect. WhatsApp will generate a QR code.
                Open the WhatsApp app on your phone &rarr; Settings &rarr; Linked Devices &rarr; Link a Device.
              </p>
              <button
                onClick={handleConnect}
                disabled={isCtaDisabled}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                {actionLoading ? 'Starting...' : 'Connect WhatsApp'}
              </button>
            </div>
          )}
        </div>
      </div>

      {statusState === 'connected' && <SavedGroupListsPanel get={get} put={put} del={del} />}
      {statusState === 'connected' && <GatewayPanel get={get} post={post} del={del} />}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md space-y-4">
        <button
          onClick={handleCleanAuth}
          disabled={cleanAuthLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50"
        >
          {cleanAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {cleanAuthLoading ? 'Cleaning...' : 'Clean Auth Files'}
        </button>
        {cleanAuthResult && (
          <p className="text-xs text-center text-zinc-400">{cleanAuthResult}</p>
        )}

        <button
          onClick={handleForceClean}
          disabled={forceCleanLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          {forceCleanLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
          {forceCleanLoading ? 'Force Cleaning...' : 'Force Clean Auth (delete all)'}
        </button>

        <hr className="border-zinc-800" />

        <button
          onClick={() => setDiagOpen(!diagOpen)}
          className="w-full flex items-center justify-between text-zinc-50"
        >
          <div className="flex items-center gap-2">
            <Wifi className="w-5 h-5 text-zinc-400" />
            <span className="text-sm font-medium">Network Diagnostics</span>
          </div>
          {diagOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {diagOpen && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-zinc-500">
              Tests connectivity to WhatsApp WebSocket servers. Run this to check if a firewall is blocking the connection.
            </p>

            {!!diagnostics && (
              <div className="bg-zinc-800 rounded-lg p-3 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">DNS (System):</span>
                  {(diagnostics.dnsSystem as { error?: string })?.error ? (
                    <span className="text-red-400">{(diagnostics.dnsSystem as { error: string }).error}</span>
                  ) : (
                    <span className="text-emerald-400">
                      {(diagnostics.dnsSystem as { addresses?: string[] })?.addresses?.[0] || 'OK'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">DNS (Google):</span>
                  {(diagnostics.dnsGoogle as { error?: string })?.error ? (
                    <span className="text-red-400">{(diagnostics.dnsGoogle as { error: string }).error}</span>
                  ) : (
                    <span className="text-emerald-400">
                      {(diagnostics.dnsGoogle as { addresses?: string[] })?.addresses?.[0] || 'OK'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">TCP 443:</span>
                  {(diagnostics.tcpConnect as { reachable?: boolean })?.reachable ? (
                    <span className="text-emerald-400">Reachable</span>
                  ) : (
                    <span className="text-red-400">Blocked — {(diagnostics.tcpConnect as { error?: string })?.error || 'unknown'}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">HTTPS:</span>
                  {(diagnostics.httpsStatus as { code?: number })?.code ? (
                    <span className="text-emerald-400">{(diagnostics.httpsStatus as { code: number }).code}</span>
                  ) : (
                    <span className="text-red-400">{(diagnostics as { httpsError?: string })?.httpsError || 'Failed'}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">WebSocket:</span>
                  {(diagnostics.wsUpgrade as { supported?: boolean })?.supported ? (
                    <span className="text-emerald-400">Supported</span>
                  ) : (diagnostics.wsUpgradeError) ? (
                    <span className="text-red-400">{(diagnostics as { wsUpgradeError?: string }).wsUpgradeError}</span>
                  ) : (
                    <span className="text-yellow-400">No upgrade (expected)</span>
                  )}
                </div>
              </div>
            )}

            {!!diagnostics && !((diagnostics.dnsSystem as { addresses?: string[] })?.addresses?.length) && (diagnostics.dnsGoogle as { addresses?: string[] })?.addresses?.length ? (
              <div className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-lg">
                DNS override active — server resolves <code className="text-emerald-300">web.whatsapp.com</code> via Google DNS.
              </div>
            ) : null}

            {!!diagnostics && !!diagPass && !waConnected && !(diagnostics.dnsGoogle as { error?: string })?.error && (
              <div className="text-xs text-yellow-400 bg-yellow-500/10 px-3 py-2 rounded-lg">
                WhatsApp server returns <strong>code 405</strong> (connection rejected) — IP may be rate-limited or flagged. <br/>
                <span className="text-xs">Try: delete <code>auth_info_baileys/</code> folder, wait 60s, then restart server. If still failing, set <code>WA_ENABLED=false</code> for local dev and deploy to VPS.</span>
              </div>
            )}

            <button
              onClick={runDiagnostics}
              disabled={diagLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              {diagLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {diagLoading ? 'Running...' : 'Run Diagnostics'}
            </button>
          </div>
        )}
      </div>

      {showClearDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-rose-500/10 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-rose-400" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-50">Clear Credentials</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Are you sure? You will have to generate a new QR code and re-link your WhatsApp device.
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowClearDialog(false)}
                disabled={clearLoading}
                className="flex-1 px-4 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearCredentials}
                disabled={clearLoading}
                className="flex-1 px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-medium hover:bg-rose-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {clearLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {clearLoading ? 'Clearing...' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
