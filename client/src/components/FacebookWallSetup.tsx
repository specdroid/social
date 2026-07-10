import { useState, useEffect, useRef } from 'react'
import { Check, AlertCircle, Upload, ExternalLink, Loader2 } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export function FacebookWallSetup() {
  const [installed, setInstalled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`${API}/api/fb-setup/status`)
      .then((r) => r.json())
      .then((d) => setInstalled(d.installed))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleFile = (f: File) => {
    if (f.name !== 'facebook_cookies.txt') {
      setMsg({ type: 'error', text: 'File must be named facebook_cookies.txt' })
      setFile(null)
      return
    }
    setFile(f)
    setMsg(null)
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setMsg(null)
    const fd = new FormData()
    fd.append('cookies', file)
    try {
      const r = await fetch(`${API}/api/fb-setup/upload`, { method: 'POST', body: fd })
      const d = await r.json()
      if (d.success) {
        setInstalled(true)
        setMsg({ type: 'success', text: 'Cookies uploaded! You can now use fb: commands.' })
        setFile(null)
      } else {
        setMsg({ type: 'error', text: d.error || 'Upload failed' })
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error' })
    }
    setUploading(false)
  }

  const steps = [
    { num: 1, title: 'Install the cookie exporter', body: 'Add Get cookies.txt LOCALLY from the Chrome Web Store to your browser.' },
    { num: 2, title: 'Log into Facebook', body: 'Open facebook.com and make sure you\'re logged in.' },
    { num: 3, title: 'Export cookies', body: 'Click the extension icon \u2192 Export \u2192 saves facebook_cookies.txt to your computer.' },
    { num: 4, title: 'Upload the file below', body: 'Select the exported facebook_cookies.txt file and click Upload.' },
  ]

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-50">Facebook Wall Post Setup</h3>
          <p className="text-sm text-zinc-400 mt-0.5">
            Upload your Facebook cookies so the bot can post to your wall via browser automation.
          </p>
        </div>
        {!loading && (
          <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {installed ? 'Cookies installed' : 'Not set up'}
          </span>
        )}
      </div>

      {msg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {msg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      <div className="space-y-0">
        {steps.map((s) => (
          <div key={s.num} className="flex gap-3 py-2.5 border-b border-zinc-800 last:border-b-0">
            <div className="shrink-0 w-7 h-7 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-sm font-semibold">
              {s.num}
            </div>
            <div className="text-sm text-zinc-300 leading-relaxed">
              <span className="font-medium text-zinc-50">{s.title}</span>
              <br />
              {s.body}
            </div>
          </div>
        ))}
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-blue-400 bg-blue-500/5' : file ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-zinc-700 hover:border-zinc-500'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]) }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
        />
        <Upload className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
        {file ? (
          <p className="text-sm text-emerald-400 font-medium">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
        ) : (
          <p className="text-sm text-zinc-400">
            Drag & drop your <span className="text-zinc-200 font-medium">facebook_cookies.txt</span> here or click to browse
          </p>
        )}
      </div>

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-50 text-zinc-900 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading ? 'Uploading...' : 'Upload'}
      </button>

      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <ExternalLink className="w-3 h-3" />
        <a
          href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          Get cookies.txt LOCALLY extension
        </a>
      </div>
    </div>
  )
}