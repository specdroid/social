import { ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  GitBranch,
  MessageSquare,
  CreditCard,
  LogOut,
} from 'lucide-react'

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/automation', label: 'Automation', icon: GitBranch },
  { path: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { path: '/billing', label: 'Billing', icon: CreditCard },
]

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-6">
          <h1 className="text-lg font-bold text-zinc-50">Social Hub</h1>
          <p className="text-xs text-zinc-500 mt-1">Automation Dashboard</p>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-50'
                    : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800/50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  )
}
