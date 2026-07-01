import { ReactNode, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  GitBranch,
  MessageSquare,
  Facebook,
  CreditCard,
  HelpCircle,
  LogOut,
  Menu,
  X,
} from 'lucide-react'

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/automation', label: 'Automation', icon: GitBranch },
  { path: '/facebook', label: 'Facebook', icon: Facebook },
  { path: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { path: '/billing', label: 'Billing', icon: CreditCard },
  { path: '/help', label: 'Help', icon: HelpCircle },
]

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/login')
  }

  const handleNav = (path: string) => {
    navigate(path)
    setSidebarOpen(false)
  }

  const sidebarContent = (
    <>
      <div className="p-6">
        <h1 className="text-lg font-bold text-zinc-50">Social Hub</h1>
        <p className="text-xs text-zinc-500 mt-1">Automation Dashboard</p>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                location.pathname === item.path
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
    </>
  )

  return (
    <div className="min-h-screen bg-zinc-950 md:flex">
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 h-14">
        <button onClick={() => setSidebarOpen(true)} className="text-zinc-400 hover:text-zinc-50">
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-zinc-50">Social Hub</h1>
        <div className="w-5" />
      </div>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      <div className={`md:hidden fixed inset-y-0 left-0 z-40 w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-end p-4">
          <button onClick={() => setSidebarOpen(false)} className="text-zinc-400 hover:text-zinc-50">
            <X className="w-5 h-5" />
          </button>
        </div>
        {sidebarContent}
      </div>

      <aside className="hidden md:flex w-64 min-h-screen bg-zinc-900 border-r border-zinc-800 flex-col">
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-auto pt-14 md:pt-0">
        <div className="p-4 md:p-8">{children}</div>
      </main>
    </div>
  )
}
