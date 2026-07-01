import { useState, useEffect } from 'react'
import { Facebook, Globe, Bell, Trash2, ExternalLink, RefreshCw, Plus, X, Check, Loader2, AlertCircle, History, ChevronDown } from 'lucide-react'
import { useApi } from '../hooks/useApi'

interface FacebookPage {
  id: string
  pageId: string
  pageName: string | null
  webhookActive: boolean
  createdAt: string
}

interface PostLog {
  id: string
  content: string
  mediaUrls: string | null
  status: string
  error: string | null
  ruleId: string | null
  createdAt: string
}

export function FacebookPageManager() {
  const { get, post, del, loading } = useApi()
  const [pages, setPages] = useState<FacebookPage[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ pageId: '', pageName: '', accessToken: '' })
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [postLogs, setPostLogs] = useState<PostLog[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set())

  function toggleLog(id: string) {
    setSelectedLogs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedLogs.size === postLogs.length) setSelectedLogs(new Set())
    else setSelectedLogs(new Set(postLogs.map((l) => l.id)))
  }

  const APP_ID = '1637065514060728'
  const TOOL_URL = `https://developers.facebook.com/apps/${APP_ID}/dashboard/`
  const EXPLORER_URL = `https://developers.facebook.com/tools/explorer/?app_id=${APP_ID}`

  useEffect(() => {
    loadPages()
    loadPostLogs()
  }, [])

  async function loadPages() {
    try {
      const data = await get<{ pages: FacebookPage[] }>('/api/facebook/pages')
      setPages(data.pages || [])
    } catch {
      // handle error silently
    }
  }

  async function handleAddPage() {
    if (!form.pageId || !form.accessToken) return
    try {
      await post('/api/facebook/pages', form)
      setShowAddForm(false)
      setForm({ pageId: '', pageName: '', accessToken: '' })
      setActionMsg({ type: 'success', text: 'Page added successfully' })
      await loadPages()
    } catch {
      setActionMsg({ type: 'error', text: 'Failed to add page' })
    }
    setTimeout(() => setActionMsg(null), 4000)
  }

  async function handleDelete(id: string) {
    try {
      await del(`/api/facebook/pages/${id}`)
      setActionMsg({ type: 'success', text: 'Page removed' })
      await loadPages()
    } catch {
      setActionMsg({ type: 'error', text: 'Failed to remove page' })
    }
    setTimeout(() => setActionMsg(null), 4000)
  }

  async function handleSubscribe(pageId: string) {
    setSubscribing(pageId)
    try {
      await post('/api/facebook/subscribe', { pageId })
      setActionMsg({ type: 'success', text: 'Webhook subscribed successfully' })
      await loadPages()
    } catch {
      setActionMsg({ type: 'error', text: 'Webhook subscription failed' })
    }
    setSubscribing(null)
    setTimeout(() => setActionMsg(null), 4000)
  }

  async function loadPostLogs() {
    try {
      const data = await get<{ logs: PostLog[] }>('/api/facebook/post-logs')
      setPostLogs(data.logs || [])
    } catch {}
  }

  const daysSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    return Math.floor(diff / 86400000)
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-zinc-50">Facebook</h2>
          <p className="text-zinc-400 text-sm mt-1">Manage connected pages and access tokens</p>
        </div>
      </div>

      {actionMsg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${actionMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {actionMsg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {actionMsg.text}
        </div>
      )}

      {/* Pages Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-zinc-50">Connected Pages</h2>
          <p className="text-zinc-400 text-sm mt-1">Manage connected pages and access tokens</p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
        >
          {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAddForm ? 'Cancel' : 'Add Page'}
        </button>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        You need to update your page access token every 60 days
      </div>

      {showAddForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-zinc-50">Connect a Facebook Page</h3>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-2 text-sm">
            <p className="text-amber-400 font-medium flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Need a Page Access Token?
            </p>
            <ol className="text-zinc-400 space-y-1 ml-5 list-decimal text-xs">
              <li>Open the <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline">Graph API Explorer</a></li>
              <li>Select your app and page, then generate a new token</li>
              <li>Copy the token and paste it below</li>
            </ol>
            <a href={TOOL_URL} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline text-xs flex items-center gap-1 mt-1">
              <ExternalLink className="w-3 h-3" />
              Open App Dashboard
            </a>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Page ID</label>
            <input
              type="text"
              value={form.pageId}
              onChange={(e) => setForm({ ...form, pageId: e.target.value })}
              placeholder="e.g. 585527858158488"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Page Name</label>
            <input
              type="text"
              value={form.pageName}
              onChange={(e) => setForm({ ...form, pageName: e.target.value })}
              placeholder="e.g. Lebanese Exams"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Access Token</label>
            <textarea
              value={form.accessToken}
              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              rows={2}
              placeholder="Paste your page access token"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-50 text-sm font-mono focus:outline-none focus:border-zinc-500"
            />
            <p className="text-xs text-zinc-500 mt-1">Tokens expire every ~60 days. Come back here to refresh.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAddPage}
              disabled={loading || !form.pageId || !form.accessToken}
              className="px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Page'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setForm({ pageId: '', pageName: '', accessToken: '' }) }}
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {pages.length === 0 && !loading && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <Facebook className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400 text-sm">No Facebook pages connected</p>
            <p className="text-zinc-500 text-xs mt-1">Add a page to start managing automation</p>
          </div>
        )}

        {pages.map((page) => (
          <div key={page.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Globe className="w-5 h-5 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-zinc-50 truncate">{page.pageName || 'Untitled Page'}</h3>
                  <p className="text-xs text-zinc-500 font-mono">ID: {page.pageId}</p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(page.id)}
                className="text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                title="Remove page"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${page.webhookActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-400'}`}>
                <Bell className="w-3 h-3" />
                {page.webhookActive ? 'Webhook Active' : 'Webhook Inactive'}
              </span>
              <span className="text-xs text-zinc-500">
                Added {daysSince(page.createdAt)} days ago
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!page.webhookActive && (
                <button
                  onClick={() => handleSubscribe(page.pageId)}
                  disabled={subscribing === page.pageId}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  {subscribing === page.pageId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
                  {subscribing === page.pageId ? 'Subscribing...' : 'Subscribe Webhooks'}
                </button>
              )}
              <a
                href={EXPLORER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/20 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Get New Token
              </a>
              <button
                onClick={() => {
                  setForm({ pageId: page.pageId, pageName: page.pageName || '', accessToken: '' })
                  setShowAddForm(true)
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-700 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Update Token
              </button>
            </div>

            <div className="mt-3 bg-zinc-800/50 rounded-lg px-3 py-2">
              <p className="text-[11px] text-zinc-500">
                Tokens expire every ~60 days. If webhooks stop working, generate a new token using the link above and update it here.
              </p>
            </div>
          </div>
        ))}

        {loading && pages.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
          </div>
        )}
      </div>

      {/* Post History */}
      <div className="border-t border-zinc-800 pt-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => { setShowLogs(!showLogs); if (!showLogs) loadPostLogs() }}
            className="flex items-center gap-2 text-zinc-400 hover:text-zinc-50 transition-colors text-sm"
          >
            <History className="w-4 h-4" />
            Post History ({postLogs.length})
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showLogs ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex items-center gap-3">
            {postLogs.length > 0 && (
              <button
                onClick={async () => {
                  await del('/api/facebook/post-logs')
                  setPostLogs([])
                  setSelectedLogs(new Set())
                }}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {showLogs && (
          <div className="mt-4">
            {postLogs.length > 0 && (
              <div className="flex items-center gap-3 mb-3 px-1">
                <input
                  type="checkbox"
                  checked={postLogs.length > 0 && selectedLogs.size === postLogs.length}
                  onChange={toggleAll}
                  className="accent-blue-500"
                />
                <span className="text-xs text-zinc-500">{selectedLogs.size} selected</span>
                {selectedLogs.size > 0 && (
                  <button
                    onClick={async () => {
                      await post('/api/facebook/post-logs/delete', { ids: Array.from(selectedLogs) })
                      setPostLogs((prev) => prev.filter((l) => !selectedLogs.has(l.id)))
                      setSelectedLogs(new Set())
                    }}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete Selected
                  </button>
                )}
              </div>
            )}
            <div className="space-y-2">
              {postLogs.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-4">No posts yet. Send a message to yourself on WhatsApp to trigger a Facebook post.</p>
              )}
              {postLogs.map((log) => (
                <div key={log.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedLogs.has(log.id)}
                    onChange={() => toggleLog(log.id)}
                    className="mt-1 accent-blue-500 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-50 break-words">{log.content}</p>
                        {log.mediaUrls && (
                          <p className="text-xs text-zinc-500 mt-1 truncate">Media: {JSON.parse(log.mediaUrls).join(', ')}</p>
                        )}
                        {log.error && <p className="text-xs text-red-400 mt-1">{log.error}</p>}
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {log.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-600 mt-1">{new Date(log.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
