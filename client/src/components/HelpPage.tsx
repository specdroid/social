import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi'
import { Loader2, Terminal, MessageSquare, BookOpen } from 'lucide-react'

interface Command {
  command: string
  description: string
  example: string
}

export function HelpPage() {
  const { get } = useApi()
  const [commands, setCommands] = useState<Command[]>([])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    get<{ commands: Command[]; note: string }>('/api/help').then((data) => {
      setCommands(data.commands)
      setNote(data.note)
    }).finally(() => setLoading(false))
  }, [get])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-zinc-50 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-zinc-400" />
          Commands & Help
        </h2>
        <p className="text-zinc-400 text-sm mt-1">
          All commands are sent as self-chat messages (message yourself on WhatsApp).
        </p>
      </div>

      {commands.map((cmd, i) => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
              <Terminal className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              <code className="block text-sm font-mono text-emerald-400 bg-zinc-800/50 rounded-lg px-3 py-2 break-all">
                {cmd.command}
              </code>
              <p className="text-sm text-zinc-300">{cmd.description}</p>
              <div className="flex items-start gap-2 text-xs text-zinc-500 bg-zinc-800/30 rounded-lg px-3 py-2">
                <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <code className="font-mono text-zinc-400 break-all">{cmd.example}</code>
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
        <p className="text-xs text-zinc-500 text-center">{note}</p>
      </div>
    </div>
  )
}
