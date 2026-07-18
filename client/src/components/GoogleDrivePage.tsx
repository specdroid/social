import { useState, useEffect } from 'react'
import { HardDrive, LogIn, LogOut, Check, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { useApi } from '../hooks/useApi'

const API_URL = import.meta.env.VITE_API_URL || ''

export function GoogleDrivePage() {
  const { get, post } = useApi()
  const [connected, setConnected] = useState(false)
  const [expired, setExpired] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      setMsg({ type: 'success', text: 'Google Drive connected successfully!' })
      window.history.replaceState({}, '', '/google-drive')
    } else if (params.get('error')) {
      setMsg({ type: 'error', text: `Connection failed: ${params.get('error')}` })
      window.history.replaceState({}, '', '/google-drive')
    }
  }, [])

  const loadStatus = async () => {
    try {
      const data = await get<{ connected: boolean; expired: boolean; email?: string }>('/api/google/status')
      setConnected(data.connected)
      setExpired(data.expired)
      setEmail(data.email || null)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadStatus() }, [])

  const handleConnect = () => {
    const token = localStorage.getItem('token')
    window.location.href = `${API_URL}/api/google/auth?token=${token}`
  }

  const handleDisconnect = async () => {
    try {
      await post('/api/google/disconnect')
      setConnected(false)
      setEmail(null)
      setMsg({ type: 'success', text: 'Google Drive disconnected' })
    } catch {
      setMsg({ type: 'error', text: 'Failed to disconnect' })
    }
    setTimeout(() => setMsg(null), 4000)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await post('/api/google/refresh')
      setExpired(false)
      setMsg({ type: 'success', text: 'Connection refreshed successfully!' })
    } catch {
      setMsg({ type: 'error', text: 'Failed to refresh — reconnect instead' })
    }
    setTimeout(() => setMsg(null), 4000)
    setRefreshing(false)
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-zinc-50">Google Drive</h2>
        <p className="text-zinc-400 text-sm mt-1">Connect your Google Drive account</p>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {msg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <HardDrive className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-zinc-50">
                {connected ? 'Google Drive Connected' : 'Not Connected'}
              </h3>
              {connected && email && (
                <p className="text-sm text-zinc-400 mt-0.5">{email}</p>
              )}
              {connected && expired && (
                <p className="text-xs text-amber-400 mt-1">Token expired — reconnect to refresh</p>
              )}
            </div>
            {connected ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Connect Google Drive
              </button>
            )}
          </div>

          {connected && (
            <div className="mt-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 text-sm text-emerald-400 flex items-center gap-2">
              <Check className="w-4 h-4" />
              Your Google Drive account is connected and ready to use.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
