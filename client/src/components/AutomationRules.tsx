import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, ToggleLeft, ToggleRight, Upload, X, Link2, Pencil, ChevronDown, Search } from 'lucide-react'
import { useApi } from '../hooks/useApi'

const API_URL = import.meta.env.VITE_API_URL || ''

interface AutomationRule {
  id: string
  name: string
  platform: string
  triggerType: string
  triggerValue: string
  actionType: string
  actionPayload: string
  isActive: boolean
  createdAt: string
}

interface ScheduledPost {
  id: string
  platform: string
  content: string
  mediaUrls: string | null
  scheduledAt: string
  status: string
}

export function AutomationRules() {
  const { get, post, put, del, loading } = useApi()
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    platform: 'facebook',
    triggerType: 'keyword_comment',
    triggerValue: '',
    actionType: 'send_dm',
    actionPayload: '{"replyText":"","dmText":""}',
    replyText: '',
    mediaType: 'none',
    mediaUrls: [] as string[],
    fileName: '',
    caption: '',
    contactJid: '',
    contactGroupId: '',
    options: [] as Array<{ id: string; label: string; reply: string }>,
  })
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Array<{ id: string; name?: string; notify?: string; phoneNumber?: string }>>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [groups, setGroups] = useState<Array<{ id: string; name: string; memberJids: string[] }>>([])
  const [importedContacts, setImportedContacts] = useState<Array<{ id: string; name?: string; phoneNumber?: string }>>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [postForm, setPostForm] = useState({
    platform: 'facebook',
    content: '',
    scheduledAt: '',
  })
  const [showPostForm, setShowPostForm] = useState(false)
  const [editingPost, setEditingPost] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const rulesData = await get<{ rules: AutomationRule[] }>('/api/automation/rules')
      const postsData = await get<{ posts: ScheduledPost[] }>('/api/automation/posts')
      setRules(rulesData.rules || [])
      setPosts(postsData.posts || [])
    } catch {
      // handle error silently
    }
  }

  async function fetchContacts() {
    setContactsLoading(true)
    try {
      const [cData, gData, iData] = await Promise.all([
        get<{ contacts: Array<{ id: string; name?: string; notify?: string; phoneNumber?: string }> }>('/api/whatsapp/contacts'),
        get<{ groups: Array<{ id: string; name: string; memberJids: string[] }> }>('/api/whatsapp/contact-groups'),
        get<{ contacts: Array<{ id: string; name?: string; phoneNumber?: string }> }>('/api/whatsapp/contacts/imported'),
      ])
      setContacts(cData.contacts || [])
      setGroups(gData.groups || [])
      setImportedContacts(iData.contacts || [])
    } catch {
      setContacts([])
      setGroups([])
      setImportedContacts([])
    } finally {
      setContactsLoading(false)
    }
  }

  useEffect(() => {
    if (showForm && formData.platform === 'whatsapp') {
      fetchContacts()
    }
  }, [showForm, formData.platform])

  useEffect(() => {
    if (!dropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setContactSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  const selectedLabel = (() => {
    if (formData.contactGroupId) {
      const g = groups.find(x => x.id === formData.contactGroupId)
      return g ? g.name : 'Select a contact or group...'
    }
    if (formData.contactJid) {
      const c = [...contacts, ...importedContacts].find(x => x.id === formData.contactJid)
      if (c) return 'notify' in c ? (c.name || (c as any).notify || c.phoneNumber || c.id.replace('@s.whatsapp.net', '')) : (c.name || c.phoneNumber || c.id.replace('@s.whatsapp.net', ''))
      return formData.contactJid.replace('@s.whatsapp.net', '')
    }
    return 'Select a contact or group...'
  })()

  function buildPayload(): string {
    const p: Record<string, unknown> = {}
    if (formData.mediaType === 'interactive') {
      p.interactive = true
      p.replyText = formData.replyText
      p.options = formData.options.filter(o => o.label.trim() && o.reply.trim())
    } else if (formData.mediaType === 'none') {
      p.replyText = formData.replyText
    } else {
      p.mediaType = formData.mediaType
      p.mediaUrls = formData.mediaUrls
      if (formData.fileName) p.fileName = formData.fileName
      if (formData.caption) p.caption = formData.caption
    }
    if (formData.contactJid) p.contactJid = formData.contactJid
    if (formData.contactGroupId) p.contactGroupId = formData.contactGroupId
    return JSON.stringify(p)
  }

  async function createRule() {
    try {
      const body = { ...formData, actionPayload: buildPayload() }
      if (editingRule) {
        await put(`/api/automation/rules/${editingRule}`, body)
      } else {
        await post('/api/automation/rules', body)
      }
      setShowForm(false)
      resetForm()
      await loadData()
    } catch {
      // handle error
    }
  }

  function addUrl(url: string) {
    if (url.trim()) setFormData({ ...formData, mediaUrls: [...formData.mediaUrls, url.trim()] })
  }

  function removeUrl(index: number) {
    setFormData({ ...formData, mediaUrls: formData.mediaUrls.filter((_, i) => i !== index) })
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    setUploadLoading(true)
    setUploadProgress(0)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('files', f)
      const token = localStorage.getItem('token')
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const data = JSON.parse(xhr.responseText)
            if (data.urls) setFormData((prev) => ({ ...prev, mediaUrls: [...prev.mediaUrls, ...data.urls] }))
            resolve()
          } else {
            reject(new Error('Upload failed'))
          }
        }
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.open('POST', `${API_URL}/api/upload`)
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.send(fd)
      })
    } catch {
      // upload failed silently
    } finally {
      setUploadLoading(false)
      setUploadProgress(0)
      e.target.value = ''
    }
  }

  async function toggleRule(rule: AutomationRule) {
    try {
      await put(`/api/automation/rules/${rule.id}`, { isActive: !rule.isActive })
      await loadData()
    } catch {
      // handle error
    }
  }

  function startEdit(rule: AutomationRule) {
    setEditingRule(rule.id)
    const payload = parsePayload(rule.actionPayload)
    setFormData({
      name: rule.name,
      platform: rule.platform,
      triggerType: rule.triggerType,
      triggerValue: rule.triggerValue,
      actionType: rule.actionType,
      actionPayload: rule.actionPayload,
      replyText: payload.replyText || '',
      mediaType: payload.interactive ? 'interactive' : (payload.mediaType || 'none'),
      mediaUrls: payload.mediaUrls || [],
      fileName: payload.fileName || '',
      caption: payload.caption || '',
      contactJid: payload.contactJid || '',
      contactGroupId: payload.contactGroupId || '',
      options: payload.options || [],
    })
    setShowForm(true)
  }

  function parsePayload(payload: string) {
    try {
      return JSON.parse(payload)
    } catch {
      return {}
    }
  }

  function resetForm() {
    setEditingRule(null)
    setFormData({
      name: '',
      platform: 'facebook',
      triggerType: 'keyword_comment',
      triggerValue: '',
      actionType: 'send_dm',
      actionPayload: '{"replyText":"","dmText":""}',
      replyText: '',
      mediaType: 'none',
      mediaUrls: [],
      fileName: '',
      caption: '',
      contactJid: '',
      contactGroupId: '',
      options: [],
    })
  }

  async function deleteRule(id: string) {
    try {
      await del(`/api/automation/rules/${id}`)
      await loadData()
    } catch {
      // handle error
    }
  }

  async function savePost() {
    try {
      const localDate = new Date(postForm.scheduledAt)
      if (isNaN(localDate.getTime())) return
      const body = { ...postForm, scheduledAt: localDate.toISOString() }
      if (editingPost) {
        await put(`/api/automation/posts/${editingPost}`, body)
      } else {
        await post('/api/automation/posts', body)
      }
      setShowPostForm(false)
      setEditingPost(null)
      setPostForm({ platform: 'facebook', content: '', scheduledAt: '' })
      await loadData()
    } catch {
      // handle error
    }
  }

  function startEditPost(post: ScheduledPost) {
    setEditingPost(post.id)
    const d = new Date(post.scheduledAt)
    const localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    setPostForm({
      platform: post.platform,
      content: post.content,
      scheduledAt: localISO,
    })
    setShowPostForm(true)
  }

  async function deletePost(id: string) {
    try {
      await del(`/api/automation/posts/${id}`)
      await loadData()
    } catch {
      // handle error
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-50">Automation Rules</h2>
          <p className="text-zinc-400 text-sm mt-1">Trigger-Action rules for comments and messages</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Rule
        </button>
      </div>

      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-zinc-50">{editingRule ? 'Edit Rule' : 'Create Rule'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Platform</label>
              <select
                value={formData.platform}
                onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              >
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
            {formData.platform === 'whatsapp' && (
              <div className="relative" ref={dropdownRef}>
                <label className="block text-sm text-zinc-400 mb-1">Contact / Group</label>
                <button
                  type="button"
                  onClick={() => { setDropdownOpen(!dropdownOpen); if (!dropdownOpen) setContactSearch('') }}
                  className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-50 focus:outline-none focus:border-zinc-500"
                >
                  <span className="truncate">{selectedLabel}</span>
                  <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {dropdownOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-72 flex flex-col">
                    <div className="p-2 border-b border-zinc-700/50">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={contactSearch}
                          onChange={(e) => setContactSearch(e.target.value)}
                          placeholder="Search..."
                          className="w-full pl-8 pr-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-md text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {!contactSearch && (
                        <button
                          type="button"
                          onClick={() => { setFormData({ ...formData, contactJid: '', contactGroupId: '' }); setDropdownOpen(false) }}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-700/50 transition-colors"
                        >
                          None
                        </button>
                      )}
                      {groups.length > 0 && (
                        <div className="pt-1">
                          <p className="px-3 py-1 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Groups</p>
                          {groups
                            .filter(g => !contactSearch || g.name.toLowerCase().includes(contactSearch.toLowerCase()))
                            .map(g => (
                            <button
                              key={`group:${g.id}`}
                              type="button"
                              onClick={() => { setFormData({ ...formData, contactJid: '', contactGroupId: g.id }); setDropdownOpen(false); setContactSearch('') }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${formData.contactGroupId === g.id ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-50 hover:bg-zinc-700/50'}`}
                            >
                              {g.name} <span className="text-zinc-500">({g.memberJids.length} members)</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {contacts.filter(c => !contactSearch || (c.name || c.notify || c.phoneNumber || c.id).toLowerCase().includes(contactSearch.toLowerCase())).length > 0 && (
                        <div className="pt-1">
                          <p className="px-3 py-1 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Individual Contacts</p>
                          {contacts
                            .filter(c => !contactSearch || (c.name || c.notify || c.phoneNumber || c.id).toLowerCase().includes(contactSearch.toLowerCase()))
                            .map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => { setFormData({ ...formData, contactJid: c.id, contactGroupId: '' }); setDropdownOpen(false); setContactSearch('') }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${formData.contactJid === c.id ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-50 hover:bg-zinc-700/50'}`}
                            >
                              {c.name || c.notify || c.phoneNumber?.replace('@s.whatsapp.net', '') || c.id.replace('@s.whatsapp.net', '')}
                            </button>
                          ))}
                        </div>
                      )}
                      {importedContacts.filter(c => !contactSearch || (c.name || c.phoneNumber || c.id).toLowerCase().includes(contactSearch.toLowerCase())).length > 0 && (
                        <div className="pt-1 pb-1">
                          <p className="px-3 py-1 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Imported Contacts</p>
                          {importedContacts
                            .filter(c => !contactSearch || (c.name || c.phoneNumber || c.id).toLowerCase().includes(contactSearch.toLowerCase()))
                            .map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => { setFormData({ ...formData, contactJid: c.id, contactGroupId: '' }); setDropdownOpen(false); setContactSearch('') }}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${formData.contactJid === c.id ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-50 hover:bg-zinc-700/50'}`}
                            >
                              {c.name || c.phoneNumber || c.id.replace('@s.whatsapp.net', '')}
                            </button>
                          ))}
                        </div>
                      )}
                      {groups.length === 0 && contacts.length === 0 && importedContacts.length === 0 && !contactsLoading && (
                        <p className="text-xs text-zinc-500 text-center py-4">No contacts or groups loaded.</p>
                      )}
                    </div>
                  </div>
                )}
                {contacts.length === 0 && groups.length === 0 && !contactsLoading && !dropdownOpen && (
                  <p className="text-[11px] text-zinc-500 mt-1">No contacts or groups loaded. Use the WhatsApp panel to fetch contacts first.</p>
                )}
                {contactsLoading && (
                  <p className="text-[11px] text-zinc-500 mt-1">Loading contacts and groups...</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Trigger Words (comma-separated)</label>
              <input
                type="text"
                value={formData.triggerValue}
                onChange={(e) => setFormData({ ...formData, triggerValue: e.target.value })}
                placeholder="e.g. tool, pizza, menu"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            {formData.mediaType === 'none' && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Reply Text</label>
              <input
                type="text"
                value={formData.replyText}
                onChange={(e) => setFormData({ ...formData, replyText: e.target.value })}
                placeholder="Thank you for your message!"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            )}
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Media Type</label>
              <select
                value={formData.mediaType}
                onChange={(e) => setFormData({ ...formData, mediaType: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              >
                <option value="none">Text only (no media)</option>
                <option value="interactive">Interactive (MCQ)</option>
                <option value="image">Image</option>
                <option value="audio">Audio</option>
                <option value="video">Video</option>
                <option value="document">Document</option>
              </select>
            </div>
            {formData.mediaType === 'interactive' && (
              <div className="md:col-span-2 space-y-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Prompt Text</label>
                  <input
                    type="text"
                    value={formData.replyText}
                    onChange={(e) => setFormData({ ...formData, replyText: e.target.value })}
                    placeholder="What would you like to order?"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm text-zinc-400">Options</label>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, options: [...formData.options, { id: 'opt_' + Date.now(), label: '', reply: '' }] })}
                      className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      + Add Option
                    </button>
                  </div>
                  <div className="space-y-2">
                    {formData.options.length === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-4">No options added yet.</p>
                    )}
                    {formData.options.map((opt, i) => (
                      <div key={opt.id} className="flex items-start gap-2 bg-zinc-800/50 rounded-lg p-2">
                        <div className="flex-1 space-y-1.5 min-w-0">
                          <input
                            type="text"
                            value={opt.label}
                            onChange={(e) => {
                              const next = [...formData.options]
                              next[i] = { ...next[i], label: e.target.value }
                              setFormData({ ...formData, options: next })
                            }}
                            placeholder="Option label (shown to user)"
                            className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                          />
                          <input
                            type="text"
                            value={opt.reply}
                            onChange={(e) => {
                              const next = [...formData.options]
                              next[i] = { ...next[i], reply: e.target.value }
                              setFormData({ ...formData, options: next })
                            }}
                            placeholder="Follow-up reply sent when user picks this"
                            className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-50 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, options: formData.options.filter((_, j) => j !== i) })}
                          className="text-zinc-500 hover:text-red-400 transition-colors mt-1 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {formData.mediaType !== 'none' && formData.mediaType !== 'interactive' && (
              <>
                <div className="md:col-span-2">
                  <label className="block text-sm text-zinc-400 mb-1">Media URLs</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id="url-input"
                      placeholder="https://example.com/image.jpg"
                      className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm font-mono focus:outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById('url-input') as HTMLInputElement
                        addUrl(input.value)
                        input.value = ''
                      }}
                      className="px-3 py-2 bg-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-600 transition-colors"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                    <label className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500 transition-colors cursor-pointer flex items-center gap-1 min-w-[90px] justify-center">
                      {uploadLoading ? (
                        <span className="text-xs font-mono">{uploadProgress}%</span>
                      ) : (
                        <><Upload className="w-4 h-4" /><span className="hidden sm:inline">Upload</span></>
                      )}
                      <input type="file" multiple accept="image/*,audio/*,video/*,.pdf,.doc,.docx" onChange={handleUpload} className="hidden" />
                    </label>
                  </div>
                  {formData.mediaUrls.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {formData.mediaUrls.map((url, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded text-xs text-zinc-400 font-mono">
                          <span className="flex-1 truncate">{url}</span>
                          <button onClick={() => removeUrl(i)} className="text-zinc-500 hover:text-red-400 shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {formData.mediaType === 'document' && (
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">File Name</label>
                    <input
                      type="text"
                      value={formData.fileName}
                      onChange={(e) => setFormData({ ...formData, fileName: e.target.value })}
                      placeholder="brochure.pdf"
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Caption</label>
                  <input
                    type="text"
                    value={formData.caption}
                    onChange={(e) => setFormData({ ...formData, caption: e.target.value })}
                    placeholder="Optional caption for the media"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={createRule}
              disabled={loading}
              className="px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : editingRule ? 'Update' : 'Create'}
            </button>
            <button
              onClick={() => { setShowForm(false); resetForm() }}
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Platform</th>
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Trigger</th>
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Active</th>
              <th className="text-right px-4 py-3 text-zinc-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No automation rules yet. Create your first one!
                </td>
              </tr>
            )}
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-zinc-800/50">
                <td className="px-4 py-3 text-zinc-50">{rule.name}</td>
                <td className="px-4 py-3 text-zinc-400 capitalize">{rule.platform}</td>
                <td className="px-4 py-3 text-zinc-400">
                  {rule.triggerType} = "{rule.triggerValue}"
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleRule(rule)}>
                    {rule.isActive ? (
                      <ToggleRight className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-zinc-500" />
                    )}
                  </button>
                </td>
                <td className="px-4 py-3 text-right flex items-center justify-end gap-2">
                  <button
                    onClick={() => startEdit(rule)}
                    className="text-zinc-500 hover:text-emerald-400 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-50">Scheduled Posts</h3>
          <p className="text-zinc-400 text-sm mt-1">Content queued for publishing</p>
        </div>
        <button
          onClick={() => setShowPostForm(!showPostForm)}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Schedule Post
        </button>
      </div>

{showPostForm && (
  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
    <h3 className="text-lg font-semibold text-zinc-50">{editingPost ? 'Edit Scheduled Post' : 'New Scheduled Post'}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Platform</label>
              <select
                value={postForm.platform}
                onChange={(e) => setPostForm({ ...postForm, platform: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              >
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Content</label>
              <textarea
                value={postForm.content}
                onChange={(e) => setPostForm({ ...postForm, content: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Schedule Date</label>
              <input
                type="datetime-local"
                value={postForm.scheduledAt}
                onChange={(e) => setPostForm({ ...postForm, scheduledAt: e.target.value })}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={savePost}
              disabled={loading}
              className="px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : editingPost ? 'Update' : 'Schedule'}
            </button>
            <button
              onClick={() => { setShowPostForm(false); setEditingPost(null); setPostForm({ platform: 'facebook', content: '', scheduledAt: '' }) }}
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Content</th>
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Platform</th>
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Scheduled</th>
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Status</th>
              <th className="text-left px-4 py-3 text-zinc-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No scheduled posts
                </td>
              </tr>
            )}
            {posts.map((post) => (
              <tr key={post.id} className="border-b border-zinc-800/50">
                <td className="px-4 py-3 text-zinc-50 max-w-xs truncate">{post.content}</td>
                <td className="px-4 py-3 text-zinc-400 capitalize">{post.platform}</td>
                <td className="px-4 py-3 text-zinc-400">
                  {new Date(post.scheduledAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    post.status === 'published' ? 'bg-emerald-500/10 text-emerald-400' :
                    post.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                    'bg-zinc-500/10 text-zinc-400'
                  }`}>
                    {post.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEditPost(post)}
                      className="text-zinc-400 hover:text-zinc-50 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deletePost(post.id)}
                      className="text-zinc-400 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
