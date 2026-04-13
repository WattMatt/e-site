'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function FloorPlanUploadButton({
  projectId,
  orgId,
}: {
  projectId: string
  orgId: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [name, setName] = useState('')
  const [level, setLevel] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 100 * 1024 * 1024) { setError('File must be under 100 MB'); return }

    setUploading(true)
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setUploading(false); return }

    const ext = file.name.split('.').pop() ?? 'pdf'
    const filePath = `${orgId}/${projectId}/${Date.now()}.${ext}`

    const { error: storageErr } = await supabase.storage
      .from('drawings')
      .upload(filePath, file, { contentType: file.type, upsert: false })
    if (storageErr) { setError(storageErr.message); setUploading(false); return }

    const { error: dbErr } = await supabase
      .schema('tenants')
      .from('floor_plans')
      .insert({
        organisation_id: orgId,
        project_id: projectId,
        uploaded_by: user.id,
        name: name || file.name.replace(/\.[^.]+$/, ''),
        level: level || null,
        file_path: filePath,
        file_size_bytes: file.size,
      })
    if (dbErr) { setError(dbErr.message); setUploading(false); return }

    setShowForm(false)
    setName('')
    setLevel('')
    router.refresh()
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
      >
        + Upload Floor Plan
      </button>
    )
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3 max-w-sm">
      <p className="text-sm font-medium text-white">Upload Floor Plan</p>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Name (e.g. Ground Floor Layout)"
        className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        type="text"
        value={level}
        onChange={e => setLevel(e.target.value)}
        placeholder="Level (e.g. Ground, Level 1)"
        className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.dwg,.svg"
        className="hidden"
        onChange={handleUpload}
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {uploading ? 'Uploading…' : 'Choose File'}
        </button>
        <button
          onClick={() => setShowForm(false)}
          className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
