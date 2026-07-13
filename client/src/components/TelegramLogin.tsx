import { useState } from 'react'
import { TelegramIcon } from './icons/TelegramIcon'

const API_URL = import.meta.env.VITE_API_URL || ''

interface Props {
  onLogin?: () => void
}

export function TelegramLogin({ onLogin }: Props) {
  const [step, setStep] = useState<'idle' | 'code' | 'password'>('idle')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const handleSendCode = async () => {
    if (!phone.trim()) return
    setSending(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/api/telegram/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: phone.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send code')
      setStep('code')
    } catch (err: any) {
      setError(err.message || 'Failed to send code')
    } finally {
      setSending(false)
    }
  }

  const handleVerifyCode = async () => {
    if (!code.trim()) return
    setSending(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/api/telegram/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Verification failed')
      if (data.passwordNeeded) {
        setStep('password')
      } else if (data.success) {
        onLogin?.()
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed')
    } finally {
      setSending(false)
    }
  }

  const handleCheckPassword = async () => {
    if (!password.trim()) return
    setSending(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`${API_URL}/api/telegram/check-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Password verification failed')
      onLogin?.()
    } catch (err: any) {
      setError(err.message || 'Password verification failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <TelegramIcon className="w-6 h-6 text-blue-400" />
        <h2 className="text-lg font-semibold text-zinc-50">Telegram</h2>
      </div>

      <div className="space-y-4 max-w-md">
        {step === 'idle' && (
          <>
            <p className="text-sm text-zinc-400">
              Enter your phone number (with country code) to receive a verification code via Telegram.
            </p>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+96112345678"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-600 text-sm"
            />
            <button
              onClick={handleSendCode}
              disabled={sending || !phone.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
            >
              {sending ? 'Sending...' : 'Send Code'}
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <p className="text-sm text-zinc-400">
              Enter the verification code sent to your Telegram app.
            </p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="12345"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-600 text-sm"
            />
            <button
              onClick={handleVerifyCode}
              disabled={sending || !code.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
            >
              {sending ? 'Verifying...' : 'Verify'}
            </button>
          </>
        )}

        {step === 'password' && (
          <>
            <p className="text-sm text-zinc-400">
              Two-factor authentication is enabled. Enter your Telegram password.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-600 text-sm"
            />
            <button
              onClick={handleCheckPassword}
              disabled={sending || !password.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
            >
              {sending ? 'Signing in...' : 'Sign In'}
            </button>
          </>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </div>
  )
}
