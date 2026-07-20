import { useState, useEffect, useCallback } from 'react'
import { HardDrive, LogOut, Check, AlertCircle, Loader2, RefreshCw, FolderOpen, ArrowLeft, Upload, Trash2, Download, Plus, ChevronRight } from 'lucide-react'
import { useApi } from '../hooks/useApi'

const API_URL = import.meta.env.VITE_API_URL || ''

interface DriveInfo {
  id: string
  email: string | null
  label: string | null
  createdAt: string
  storageLimit: number | null
  storageUsed: number | null
  storageTrash: number | null
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
  webViewLink?: string
}

const MIME_ICONS: Record<string, string> = {
  'application/vnd.google-apps.folder': '📁',
  'application/pdf': '📄',
  'image/jpeg': '🖼', 'image/png': '🖼', 'image/gif': '🖼', 'image/webp': '🖼',
  'video/mp4': '🎬', 'video/webm': '🎬',
  'audio/mpeg': '🎵', 'audio/ogg': '🎵',
  'text/plain': '📝', 'text/markdown': '📝', 'text/csv': '📊',
  'application/zip': '📦',
}

function fileIcon(mime: string) {
  if (mime in MIME_ICONS) return MIME_ICONS[mime]
  if (mime.startsWith('image/')) return '🖼'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('spreadsheet') || mime.includes('csv')) return '📊'
  if (mime.includes('document') || mime.includes('word')) return '📝'
  if (mime.includes('presentation')) return '📽'
  return '📄'
}

function formatSize(bytes?: string) {
  if (!bytes) return ''
  const b = parseInt(bytes, 10)
  if (isNaN(b)) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatBytes(bytes: number | null) {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function StorageBar({ used, limit }: { used: number | null; limit: number | null }) {
  if (used === null || limit === null || limit === 0) return null
  const pct = Math.min((used / limit) * 100, 100)
  const color = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
        <span>{formatBytes(used)} used</span>
        <span>{formatBytes(limit)} total</span>
      </div>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function GoogleDrivePage() {
  const { get, post } = useApi()
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [selectedDrive, setSelectedDrive] = useState<DriveInfo | null>(null)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([])
  const [uploading, setUploading] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)

  const [newDriveLabel, setNewDriveLabel] = useState('')
  const [showNewLabel, setShowNewLabel] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      setMsg({ type: 'success', text: 'Google Drive connected successfully!' })
      window.history.replaceState({}, '', '/google-drive')
    } else if (params.get('error')) {
      setMsg({ type: 'error', text: `Connection failed: ${params.get('error')}` })
      window.history.replaceState({}, '', '/google-drive')
    }
  }, [])

  const loadDrives = useCallback(async () => {
    try {
      const data = await get<{ drives: DriveInfo[] }>('/api/google/drives')
      setDrives(data.drives || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [get])

  useEffect(() => { loadDrives() }, [loadDrives])

  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) } }, [msg])

  const handleConnect = (label?: string) => {
    const token = localStorage.getItem('token')
    const url = label
      ? `${API_URL}/api/google/auth?token=${token}&label=${encodeURIComponent(label)}`
      : `${API_URL}/api/google/auth?token=${token}`
    window.location.href = url
  }

  const handleDisconnect = async (driveId: string) => {
    try {
      await post(`/api/google/disconnect/${driveId}`)
      setDrives(d => d.filter(dr => dr.id !== driveId))
      if (selectedDrive?.id === driveId) { setSelectedDrive(null); setFiles([]); setFolderStack([]) }
      setMsg({ type: 'success', text: 'Drive disconnected' })
    } catch {
      setMsg({ type: 'error', text: 'Failed to disconnect' })
    }
  }

  const handleRefresh = async (driveId: string) => {
    try {
      await post(`/api/google/refresh/${driveId}`)
      setMsg({ type: 'success', text: 'Token refreshed!' })
    } catch {
      setMsg({ type: 'error', text: 'Failed to refresh — reconnect instead' })
    }
  }

  const loadFiles = useCallback(async (driveId: string, folderId?: string) => {
    setFilesLoading(true)
    try {
      const url = folderId
        ? `/api/google/drive/${driveId}/files?folderId=${folderId}`
        : `/api/google/drive/${driveId}/files`
      const data = await get<{ files: DriveFile[] }>(url)
      setFiles(data.files || [])
    } catch {
      setMsg({ type: 'error', text: 'Failed to load files' })
    }
    setFilesLoading(false)
  }, [get])

  const openDrive = (drive: DriveInfo) => {
    setSelectedDrive(drive)
    setFolderStack([])
    loadFiles(drive.id)
  }

  const openFolder = (file: DriveFile) => {
    if (!selectedDrive) return
    setFolderStack(s => [...s, { id: file.id, name: file.name }])
    loadFiles(selectedDrive.id, file.id)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !selectedDrive) return
    setUploading(true)
    const file = e.target.files[0]
    const reader = new FileReader()
    reader.onload = async () => {
      const content = reader.result as string
      const base64 = content.split(',')[1] || content
      const folderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined
      try {
        await post(`/api/google/drive/${selectedDrive.id}/upload`, {
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          content: base64,
          folderId,
        })
        setMsg({ type: 'success', text: `"${file.name}" uploaded!` })
        loadFiles(selectedDrive.id, folderId)
      } catch {
        setMsg({ type: 'error', text: 'Upload failed' })
      }
      setUploading(false)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !selectedDrive) return
    const parentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined
    try {
      await post(`/api/google/drive/${selectedDrive.id}/folder`, {
        name: newFolderName.trim(),
        parentFolderId,
      })
      setMsg({ type: 'success', text: `Folder "${newFolderName.trim()}" created` })
      setNewFolderName('')
      setShowNewFolder(false)
      loadFiles(selectedDrive.id, parentFolderId)
    } catch {
      setMsg({ type: 'error', text: 'Failed to create folder' })
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!selectedDrive || !confirm('Delete this file?')) return
    try {
      await post(`/api/google/drive/${selectedDrive.id}/delete/${fileId}`)
      setFiles(f => f.filter(file => file.id !== fileId))
      setMsg({ type: 'success', text: 'File deleted' })
    } catch {
      setMsg({ type: 'error', text: 'Delete failed' })
    }
  }

  const handleDownload = (fileId: string) => {
    if (!selectedDrive) return
    const token = localStorage.getItem('token')
    window.open(`${API_URL}/api/google/drive/${selectedDrive.id}/download/${fileId}?token=${token}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-50">Google Drive</h2>
          <p className="text-zinc-400 text-sm mt-1">Manage multiple Google Drive accounts</p>
        </div>
        <div className="flex items-center gap-2">
          {showNewLabel ? (
            <div className="flex items-center gap-2">
              <input
                value={newDriveLabel}
                onChange={e => setNewDriveLabel(e.target.value)}
                placeholder="Drive label (e.g. Work)"
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 w-48"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') { handleConnect(newDriveLabel || 'My Drive'); setShowNewLabel(false) } if (e.key === 'Escape') setShowNewLabel(false) }}
              />
              <button onClick={() => { handleConnect(newDriveLabel || 'My Drive'); setShowNewLabel(false) }} className="px-3 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200">Connect</button>
              <button onClick={() => setShowNewLabel(false)} className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-sm hover:bg-zinc-700">Cancel</button>
            </div>
          ) : (
            <button onClick={() => { setShowNewLabel(true); setNewDriveLabel('') }} className="flex items-center gap-2 px-4 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors">
              <Plus className="w-4 h-4" />
              Connect Drive
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {msg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
        </div>
      ) : drives.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <HardDrive className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-400">No Google Drive accounts connected.</p>
          <p className="text-zinc-500 text-sm mt-2">Click "Connect Drive" to get started.</p>
        </div>
      ) : selectedDrive ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <button onClick={() => { setSelectedDrive(null); setFiles([]); setFolderStack([]) }} className="text-zinc-400 hover:text-zinc-200">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <HardDrive className="w-5 h-5 text-blue-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200 truncate">{selectedDrive.label || 'Google Drive'}</p>
              <p className="text-xs text-zinc-500 truncate">{selectedDrive.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-700 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                {uploading ? 'Uploading...' : 'Upload'}
                <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
              <button onClick={() => setShowNewFolder(!showNewFolder)} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-700 transition-colors">
                <FolderOpen className="w-3.5 h-3.5" />
                New Folder
              </button>
            </div>
          </div>

          {folderStack.length > 0 && (
            <div className="flex items-center gap-1 text-sm text-zinc-400 px-1">
              <button onClick={() => { setFolderStack([]); loadFiles(selectedDrive.id) }} className="hover:text-zinc-200">Drive</button>
              {folderStack.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" />
                  <button
                    onClick={() => {
                      const newStack = folderStack.slice(0, i + 1)
                      setFolderStack(newStack)
                      loadFiles(selectedDrive.id, f.id)
                    }}
                    className="hover:text-zinc-200 truncate max-w-[150px]"
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {showNewFolder && (
            <div className="flex items-center gap-2">
              <input
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 flex-1"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder() }}
              />
              <button onClick={handleCreateFolder} className="px-3 py-2 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium">Create</button>
              <button onClick={() => setShowNewFolder(false)} className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-sm">Cancel</button>
            </div>
          )}

          {filesLoading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
            </div>
          ) : files.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
              <FolderOpen className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-400 text-sm">This folder is empty</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800">
              {files.sort((a, b) => {
                const aFolder = a.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1
                const bFolder = b.mimeType === 'application/vnd.google-apps.folder' ? 0 : 1
                if (aFolder !== bFolder) return aFolder - bFolder
                return (a.name || '').localeCompare(b.name || '')
              }).map(file => (
                <div key={file.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors group">
                  <span className="text-lg w-7 text-center">{fileIcon(file.mimeType)}</span>
                  <div className="flex-1 min-w-0">
                    {file.mimeType === 'application/vnd.google-apps.folder' ? (
                      <button onClick={() => openFolder(file)} className="text-sm text-zinc-200 hover:text-white truncate text-left font-medium">
                        {file.name}
                      </button>
                    ) : (
                      <p className="text-sm text-zinc-200 truncate font-medium">{file.name}</p>
                    )}
                    <p className="text-xs text-zinc-500">
                      {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : ''}
                      {file.size ? ` · ${formatSize(file.size)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {file.mimeType !== 'application/vnd.google-apps.folder' && (
                      <button onClick={() => handleDownload(file.id)} className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded" title="Download">
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => handleDeleteFile(file.id)} className="p-1.5 text-zinc-400 hover:text-red-400 rounded" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {drives.map(drive => (
            <div key={drive.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors">
              <div className="flex items-center gap-4">
                <button onClick={() => openDrive(drive)} className="flex items-center gap-4 flex-1 min-w-0 text-left">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <HardDrive className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{drive.label || 'Google Drive'}</p>
                    <p className="text-xs text-zinc-500 truncate">{drive.email}</p>
                    <StorageBar used={drive.storageUsed} limit={drive.storageLimit} />
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                </button>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleRefresh(drive.id)} className="p-2 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors" title="Refresh token">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (confirm(`Disconnect ${drive.label || drive.email}?`)) handleDisconnect(drive.id) }} className="p-2 text-zinc-400 hover:text-red-400 rounded-lg hover:bg-zinc-800 transition-colors" title="Disconnect">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
