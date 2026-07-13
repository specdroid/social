import { useState, useEffect, useCallback } from 'react'
import { TelegramLogin } from '../components/TelegramLogin'
import { TelegramChat } from '../components/TelegramChat'
import { useApi } from '../hooks/useApi'

interface TelegramStatus {
  connected: boolean
  phone: string | null
}

export function Telegram() {
  const { get, post } = useApi()
  const [status, setStatus] = useState<TelegramStatus>({ connected: false, phone: null })
  const [loading, setLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      const data = await get<TelegramStatus>('/api/telegram/status')
      setStatus(data)
    } catch {
      setStatus({ connected: false, phone: null })
    } finally {
      setLoading(false)
    }
  }, [get])

  const handleDisconnect = useCallback(async () => {
    try {
      await post('/api/telegram/disconnect', {})
    } catch { /* ignore */ }
    setStatus({ connected: false, phone: null })
  }, [post])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  if (loading) {
    return <div className="text-zinc-400 text-sm">Loading...</div>
  }

  if (!status.connected) {
    return <TelegramLogin onLogin={fetchStatus} />
  }

  return <TelegramChat onDisconnect={handleDisconnect} phone={status.phone} />
}
