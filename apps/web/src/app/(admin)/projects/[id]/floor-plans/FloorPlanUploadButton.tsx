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
        type="button"
        onClick={() => setShowForm(true)}
        className="btn-primary-amber"
      >
        + Upload Floor Plan
      </button>
    )
  }

  return (
    <div
      style={{
        background: 'var(--c-panel)', border: '1px solid var(--c-border)',
        borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
        maxWidth: 340, width: '100%',
      }}
    >
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-mid)' }}>
        Upload Floor Plan
      </p>
      <div>
        <label className="ob-label">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Ground Floor Layout"
          className="ob-input"
        />
      </div>
      <div>
        <label className="ob-label">Level</label>
        <input
          type="text"
          value={level}
          onChange={e => setLevel(e.target.value)}
          placeholder="e.g. Ground, Level 1"
          className="ob-input"
        />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.dwg,.svg"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      {error && <p className="ob-error" role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-primary-amber"
          style={{ flex: 1 }}
        >
          {uploading ? 'Uploading…' : 'Choose File'}
        </button>
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="btn-primary-amber"
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text-mid)',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
