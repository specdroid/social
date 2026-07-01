import { useState, useEffect, useCallback } from 'react'
import { Users, ChevronDown, ChevronUp, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react'

interface GroupList {
  id: string
  name: string
  groups: string[]
  createdAt: string
  updatedAt: string
}

export function SavedGroupListsPanel({
  get,
  put,
  del,
}: {
  get: <T>(url: string) => Promise<T>
  put: <T>(url: string, body: unknown) => Promise<T>
  del: <T>(url: string) => Promise<T>
}) {
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState<GroupList[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editGroups, setEditGroups] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await get<{ lists: GroupList[] }>('/api/whatsapp/group-lists')
      setLists(data.lists)
    } finally {
      setLoading(false)
    }
  }, [get])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleEdit = (list: GroupList) => {
    setEditingId(list.id)
    setEditName(list.name)
    setEditGroups(list.groups.join(', '))
  }

  const handleSave = async (id: string) => {
    const groups = editGroups.split(',').map((s) => s.trim()).filter(Boolean)
    await put(`/api/whatsapp/group-lists/${id}`, { name: editName, groups })
    setEditingId(null)
    load()
  }

  const handleDelete = async (id: string) => {
    await del(`/api/whatsapp/group-lists/${id}`)
    load()
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md space-y-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-zinc-50"
      >
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-zinc-400" />
          <span className="text-sm font-medium">Saved Group Lists</span>
          {lists.length > 0 && (
            <span className="text-xs text-zinc-500">({lists.length})</span>
          )}
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            Create lists via self-chat: <code className="text-zinc-300">ws create 'name' save [gr1, gr2]</code>
          </p>

          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
          ) : lists.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">No saved group lists yet.</p>
          ) : (
            <div className="space-y-2">
              {lists.map((list) => (
                <div key={list.id} className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                  {editingId === list.id ? (
                    <div className="space-y-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-2 py-1 bg-zinc-700 rounded text-sm text-zinc-50"
                        placeholder="List name"
                      />
                      <textarea
                        value={editGroups}
                        onChange={(e) => setEditGroups(e.target.value)}
                        className="w-full px-2 py-1 bg-zinc-700 rounded text-sm text-zinc-50 resize-none"
                        rows={2}
                        placeholder="group1, group2, group3"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSave(list.id)}
                          className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-500 transition-colors"
                        >
                          <Check className="w-3 h-3 inline mr-1" />Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-600 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-50">{list.name}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleEdit(list)}
                            className="p-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(list.id)}
                            className="p-1.5 text-red-400 hover:text-red-300 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {list.groups.map((g) => (
                          <span key={g} className="px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded text-xs">
                            {g}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
