import { useState, useEffect, useCallback } from 'react'
import { Shield, ChevronDown, ChevronUp, Plus, Loader2, Trash2, Phone, Users } from 'lucide-react'

interface AllowedNumber { id: string; phone: string; createdAt: string }
interface AllowedGroup { id: string; name: string; createdAt: string }

export function GatewayPanel({
  get, post, del,
}: {
  get: <T>(url: string) => Promise<T>
  post: <T>(url: string, body: unknown) => Promise<T>
  del: <T>(url: string) => Promise<T>
}) {
  const [open, setOpen] = useState(false)
  const [numbers, setNumbers] = useState<AllowedNumber[]>([])
  const [groups, setGroups] = useState<AllowedGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [newGroup, setNewGroup] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nData, gData] = await Promise.all([
        get<{ numbers: AllowedNumber[] }>('/api/whatsapp/gateway/numbers'),
        get<{ groups: AllowedGroup[] }>('/api/whatsapp/gateway/groups'),
      ])
      setNumbers(nData.numbers)
      setGroups(gData.groups)
    } finally {
      setLoading(false)
    }
  }, [get])

  useEffect(() => { if (open) load() }, [open, load])

  const addNumber = async () => {
    if (!newPhone.trim()) return
    await post('/api/whatsapp/gateway/numbers', { phone: newPhone.trim() })
    setNewPhone('')
    load()
  }

  const removeNumber = async (id: string) => {
    await del(`/api/whatsapp/gateway/numbers/${id}`)
    load()
  }

  const addGroup = async () => {
    if (!newGroup.trim()) return
    await post('/api/whatsapp/gateway/groups', { name: newGroup.trim() })
    setNewGroup('')
    load()
  }

  const removeGroup = async (id: string) => {
    await del(`/api/whatsapp/gateway/groups/${id}`)
    load()
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md space-y-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-zinc-50"
      >
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-medium">Gateway (allowed numbers & groups)</span>
          {(numbers.length > 0 || groups.length > 0) && (
            <span className="text-xs text-zinc-500">({numbers.length}n / {groups.length}g)</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="space-y-6">
          <p className="text-xs text-zinc-500">
            Messages from an allowed number in an allowed group are processed as commands (fb:, ws:, etc.).
            The account holder is always allowed.
          </p>

          {/* Allowed Numbers */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <Phone className="w-4 h-4" />
              <span className="font-medium">Allowed Numbers</span>
            </div>
            <div className="flex gap-2">
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNumber()}
                placeholder="96170123456"
                className="flex-1 px-3 py-1.5 bg-zinc-800 rounded text-sm text-zinc-50 placeholder-zinc-500"
              />
              <button onClick={addNumber} className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-zinc-400 mx-auto" />
            ) : numbers.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-2">No allowed numbers</p>
            ) : (
              <div className="space-y-1">
                {numbers.map((n) => (
                  <div key={n.id} className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-1.5">
                    <span className="text-sm text-zinc-300">{n.phone}</span>
                    <button onClick={() => removeNumber(n.id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Allowed Groups */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <Users className="w-4 h-4" />
              <span className="font-medium">Allowed Groups</span>
            </div>
            <div className="flex gap-2">
              <input
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                placeholder="Exams"
                className="flex-1 px-3 py-1.5 bg-zinc-800 rounded text-sm text-zinc-50 placeholder-zinc-500"
              />
              <button onClick={addGroup} className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-zinc-400 mx-auto" />
            ) : groups.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-2">No allowed groups</p>
            ) : (
              <div className="space-y-1">
                {groups.map((g) => (
                  <div key={g.id} className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-1.5">
                    <span className="text-sm text-zinc-300">{g.name}</span>
                    <button onClick={() => removeGroup(g.id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
