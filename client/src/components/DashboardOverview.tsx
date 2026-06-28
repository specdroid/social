import { useState, useEffect } from 'react'
import { MessageSquare, MessageCircle, Calendar, Smartphone } from 'lucide-react'
import { useApi } from '../hooks/useApi'

interface DashboardStats {
  dmsSent: number
  commentsReplied: number
  postsScheduled: number
  whatsappConnected: boolean
}

export function DashboardOverview() {
  const { get } = useApi()
  const [stats, setStats] = useState<DashboardStats>({
    dmsSent: 0,
    commentsReplied: 0,
    postsScheduled: 0,
    whatsappConnected: false,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [automationData, whatsappData] = await Promise.all([
          get<{ rules: unknown[]; posts: unknown[] }>('/api/automation/rules'),
          get<{ connected: boolean }>('/api/whatsapp/status'),
        ])

        setStats({
          dmsSent: 0,
          commentsReplied: 0,
          postsScheduled: (automationData as any)?.posts?.length || 0,
          whatsappConnected: (whatsappData as any)?.connected || false,
        })
      } catch {
        // Stats will show defaults
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [get])

  const cards = [
    {
      label: 'DMs Sent',
      value: stats.dmsSent,
      icon: MessageSquare,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Comments Replied',
      value: stats.commentsReplied,
      icon: MessageCircle,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Posts Scheduled',
      value: stats.postsScheduled,
      icon: Calendar,
      color: 'text-violet-400',
      bg: 'bg-violet-500/10',
    },
    {
      label: 'WhatsApp',
      value: stats.whatsappConnected ? 'Connected' : 'Disconnected',
      icon: Smartphone,
      color: stats.whatsappConnected ? 'text-green-400' : 'text-zinc-400',
      bg: stats.whatsappConnected ? 'bg-green-500/10' : 'bg-zinc-500/10',
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-zinc-400 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-zinc-50">Dashboard</h2>
        <p className="text-zinc-400 text-sm mt-1">Overview of your automation metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3"
            >
              <div className={`w-10 h-10 rounded-lg ${card.bg} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-50">{card.value}</p>
                <p className="text-sm text-zinc-400">{card.label}</p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">Getting Started</h3>
        <ul className="space-y-3 text-sm text-zinc-400">
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">1.</span>
            <span>Connect your WhatsApp account in the <strong className="text-zinc-300">WhatsApp</strong> section</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">2.</span>
            <span>Create automation rules in the <strong className="text-zinc-300">Automation</strong> section</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">3.</span>
            <span>Schedule Facebook/Instagram posts from the <strong className="text-zinc-300">Automation</strong> section</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">4.</span>
            <span>Upgrade to Premium in <strong className="text-zinc-300">Billing</strong> to unlock advanced features</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
