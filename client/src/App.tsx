import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Automation } from './pages/Automation'
import { WhatsApp } from './pages/WhatsApp'
import { Facebook } from './pages/Facebook'
import { Billing } from './pages/Billing'
import { Help } from './pages/Help'
import { Omniroute } from './pages/Omniroute'
import { Telegram } from './pages/Telegram'
import { Admin } from './pages/Admin'

function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [error, setError] = useState('')
  const API_URL = import.meta.env.VITE_API_URL || ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      const body = isRegister ? { email, password, name } : { email, password }

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Authentication failed')
        return
      }

      localStorage.setItem('token', data.token)
      onLogin(data.token)
    } catch {
      setError('Failed to connect to server')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-zinc-50">Social Automation</h1>
          <p className="text-zinc-400 text-sm mt-1">Sign in to your dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-600"
              />
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-600"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-50 focus:outline-none focus:border-zinc-600"
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            className="w-full py-2 bg-zinc-50 text-zinc-900 rounded-lg font-medium hover:bg-zinc-200 transition-colors"
          >
            {isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-zinc-500">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-zinc-300 hover:underline"
          >
            {isRegister ? 'Sign in' : 'Register'}
          </button>
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setUserRole(null)
      return
    }
    const API_URL = import.meta.env.VITE_API_URL || ''
    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setUserRole(data.user?.role ?? null))
      .catch(() => setUserRole(null))
  }, [token])

  if (!token) {
    return <LoginPage onLogin={(t) => setToken(t)} />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Dashboard /></Layout>} />
        <Route path="/automation" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Automation /></Layout>} />
        <Route path="/whatsapp" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><WhatsApp /></Layout>} />
        <Route path="/facebook" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Facebook /></Layout>} />
        <Route path="/billing" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Billing /></Layout>} />
        <Route path="/help" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Help /></Layout>} />
        <Route path="/omniroute" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Omniroute /></Layout>} />
        <Route path="/telegram" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Telegram /></Layout>} />
        <Route path="/admin" element={<Layout onLogout={() => setToken(null)} userRole={userRole}><Admin /></Layout>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
