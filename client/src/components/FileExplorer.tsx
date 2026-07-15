import { useState, useEffect } from 'react'
import { Folder, File, Trash2, ArrowLeft, AlertTriangle, FolderOpen } from 'lucide-react'
import { useApi } from '../hooks/useApi'

interface FileEntry {
  name: string
  isDir: boolean
  size: number | null
  modified: string
  path: string
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-zinc-50">{title}</h2>
        </div>
        <p className="text-sm text-zinc-400">{message}</p>
        <div className="flex gap-2 pt-2">
          <button onClick={onCancel} className="flex-1 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-sm hover:bg-zinc-700 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export function FileExplorer() {
  const { get, del } = useApi()
  const [currentDir, setCurrentDir] = useState('')
  const [items, setItems] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null)
  const [deleteBulk, setDeleteBulk] = useState(false)

  const loadDir = async (dir: string) => {
    setLoading(true)
    try {
      const data = await get<{ dir: string; items: FileEntry[] }>(`/api/files/list?dir=${encodeURIComponent(dir)}`)
      setItems(data.items)
      setCurrentDir(data.dir)
      setSelected(new Set())
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadDir('') }, [])

  const handleNavigate = (item: FileEntry) => {
    if (item.isDir) loadDir(item.path)
  }

  const handleBack = () => {
    const parts = currentDir.split('/')
    parts.pop()
    loadDir(parts.join('/'))
  }

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.isDir) {
        await del('/api/files/folder', { path: deleteTarget.path })
      } else {
        await del('/api/files/file', { path: deleteTarget.path })
      }
      setDeleteTarget(null)
      loadDir(currentDir)
    } catch { /* ignore */ }
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    try {
      await del('/api/files/bulk', { paths: Array.from(selected) })
      setDeleteBulk(false)
      loadDir(currentDir)
    } catch { /* ignore */ }
  }

  const pathParts = currentDir.split('/').filter(Boolean)

  const quickLinks = [
    { label: 'Uploads', path: 'uploads' },
    { label: 'Telegram Uploads', path: 'telegram/uploads' },
    { label: 'Telegram Downloads', path: 'telegram/downloads' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderOpen className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-zinc-50">File Explorer</h1>
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => setDeleteBulk(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete {selected.size} selected
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 text-sm text-zinc-400">
        <button onClick={() => loadDir('')} className="hover:text-zinc-200 transition-colors">
          server
        </button>
        {pathParts.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            <span>/</span>
            <button
              onClick={() => loadDir(pathParts.slice(0, i + 1).join('/'))}
              className="hover:text-zinc-200 transition-colors"
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        {quickLinks.map((link) => (
          <button
            key={link.path}
            onClick={() => loadDir(link.path)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              currentDir === link.path
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-500'
            }`}
          >
            {link.label}
          </button>
        ))}
      </div>

      {currentDir && (
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      )}

      {loading ? (
        <div className="text-zinc-400">Loading...</div>
      ) : items.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <Folder className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Empty folder</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={() => {
                      if (selected.size === items.length) setSelected(new Set())
                      else setSelected(new Set(items.map((i) => i.path)))
                    }}
                    className="accent-blue-500"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Size</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Modified</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.path} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(item.path)}
                      onChange={() => toggleSelect(item.path)}
                      className="accent-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleNavigate(item)}
                      className="flex items-center gap-2 text-sm text-zinc-200 hover:text-zinc-50"
                    >
                      {item.isDir ? <Folder className="w-4 h-4 text-blue-400" /> : <File className="w-4 h-4 text-zinc-500" />}
                      {item.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{formatSize(item.size)}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{new Date(item.modified).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleteTarget(item)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title={item.isDir ? 'Delete folder' : 'Delete file'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget?.isDir ? 'Folder' : 'File'}`}
        message={`Are you sure you want to delete "${deleteTarget?.name}"? ${deleteTarget?.isDir ? 'All contents will be deleted.' : ''}`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={deleteBulk}
        title="Delete Selected"
        message={`Are you sure you want to delete ${selected.size} items? This cannot be undone.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setDeleteBulk(false)}
      />
    </div>
  )
}
