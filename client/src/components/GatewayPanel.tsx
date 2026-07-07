import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shield, ChevronDown, ChevronUp, Plus, Loader2, Trash2, Phone, Users, Search, X } from 'lucide-react'

interface AllowedNumber { id: string; phone: string; createdAt: string }
interface AllowedGroup { id: string; name: string; createdAt: string }
interface AvailableContact { id: string; name?: string; notify?: string; verifiedName?: string; phoneNumber?: string }
interface AvailableGroup { jid: string; subject: string }

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

  const [availableContacts, setAvailableContacts] = useState<AvailableContact[]>([])
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([])
  const [avLoading, setAvLoading] = useState(false)

  const [contactSearch, setContactSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [showContactPicker, setShowContactPicker] = useState(false)
  const [showGroupPicker, setShowGroupPicker] = useState(false)

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

  const loadAvailable = useCallback(async () => {
    setAvLoading(true)
    try {
      const [cData, gData] = await Promise.all([
        get<{ contacts: AvailableContact[] }>('/api/whatsapp/gateway/available-contacts'),
        get<{ groups: AvailableGroup[] }>('/api/whatsapp/gateway/available-groups'),
      ])
      setAvailableContacts(cData.contacts || [])
      setAvailableGroups(gData.groups || [])
    } finally {
      setAvLoading(false)
    }
  }, [get])

  useEffect(() => {
    if (open) {
      load()
      loadAvailable()
    }
  }, [open, load, loadAvailable])

  const removeNumber = async (id: string) => {
    await del(`/api/whatsapp/gateway/numbers/${id}`)
    load()
  }

  const removeGroup = async (id: string) => {
    await del(`/api/whatsapp/gateway/groups/${id}`)
    load()
  }

  const addNumber = async (phone: string) => {
    await post('/api/whatsapp/gateway/numbers', { phone })
    setShowContactPicker(false)
    setContactSearch('')
    load()
  }

  const addGroup = async (name: string) => {
    await post('/api/whatsapp/gateway/groups', { name })
    setShowGroupPicker(false)
    setGroupSearch('')
    load()
  }

  const allowedPhoneSet = useMemo(() => new Set(numbers.map(n => n.phone)), [numbers])
  const allowedGroupNameSet = useMemo(() => new Set(groups.map(g => g.name.toLowerCase())), [groups])

  const filteredContacts = useMemo(() => {
    const q = contactSearch.toLowerCase()
    return availableContacts.filter(c => {
      if (c.phoneNumber && allowedPhoneSet.has(c.phoneNumber)) return false
      if (!q) return true
      const display = [c.name, c.notify, c.verifiedName, c.phoneNumber].filter(Boolean).join(' ').toLowerCase()
      return display.includes(q)
    })
  }, [availableContacts, contactSearch, allowedPhoneSet])

  const filteredGroups = useMemo(() => {
    const q = groupSearch.toLowerCase()
    return availableGroups.filter(g => {
      if (allowedGroupNameSet.has(g.subject.toLowerCase())) return false
      if (!q) return true
      return g.subject.toLowerCase().includes(q)
    })
  }, [availableGroups, groupSearch, allowedGroupNameSet])

  function contactLabel(c: AvailableContact): string {
    return c.name || c.notify || c.verifiedName || c.phoneNumber || c.id
  }

  function contactSub(c: AvailableContact): string {
    return c.phoneNumber ? `+${c.phoneNumber}` : ''
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

            {!showContactPicker && (
              <button
                onClick={() => { setShowContactPicker(true); setContactSearch('') }}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
              >
                <Plus className="w-4 h-4" />
                Add number
              </button>
            )}

            {showContactPicker && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 bg-zinc-800 rounded px-2 py-1">
                  <Search className="w-4 h-4 text-zinc-500 shrink-0" />
                  <input
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Search contacts..."
                    className="flex-1 bg-transparent text-sm text-zinc-50 placeholder-zinc-500 outline-none"
                    autoFocus
                  />
                  <button onClick={() => { setShowContactPicker(false); setContactSearch('') }}>
                    <X className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {avLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400 mx-auto my-2" />
                  ) : filteredContacts.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center py-2">
                      {contactSearch ? 'No matching contacts' : 'No contacts available'}
                    </p>
                  ) : (
                    filteredContacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => c.phoneNumber && addNumber(c.phoneNumber)}
                        disabled={!c.phoneNumber}
                        className="w-full text-left px-3 py-1.5 rounded text-sm bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <span>{contactLabel(c)}</span>
                        {contactSub(c) && <span className="text-zinc-500 ml-2">{contactSub(c)}</span>}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

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

            {!showGroupPicker && (
              <button
                onClick={() => { setShowGroupPicker(true); setGroupSearch('') }}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-zinc-800 rounded text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
              >
                <Plus className="w-4 h-4" />
                Add group
              </button>
            )}

            {showGroupPicker && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 bg-zinc-800 rounded px-2 py-1">
                  <Search className="w-4 h-4 text-zinc-500 shrink-0" />
                  <input
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Search groups..."
                    className="flex-1 bg-transparent text-sm text-zinc-50 placeholder-zinc-500 outline-none"
                    autoFocus
                  />
                  <button onClick={() => { setShowGroupPicker(false); setGroupSearch('') }}>
                    <X className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {avLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400 mx-auto my-2" />
                  ) : filteredGroups.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center py-2">
                      {groupSearch ? 'No matching groups' : 'No groups available'}
                    </p>
                  ) : (
                    filteredGroups.map((g) => (
                      <button
                        key={g.jid}
                        onClick={() => addGroup(g.subject)}
                        className="w-full text-left px-3 py-1.5 rounded text-sm bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300"
                      >
                        {g.subject}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

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