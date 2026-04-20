'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function CocUploadButton({ subsectionId, orgId }: { subsectionId: string; orgId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) { setError('File must be under 50 MB'); return }

    setUploading(true)
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setUploading(false); return }

    const ext = file.name.split('.').pop() ?? 'pdf'
    const timestamp = Date.now()
    const filePath = `${orgId}/${subsectionId}/${timestamp}.${ext}`

    const { error: storageErr } = await supabase.storage
      .from('coc-documents')
      .upload(filePath, file, { contentType: file.type, upsert: false })

    if (storageErr) { setError(storageErr.message); setUploading(false); return }

    const { count } = await supabase
      .schema('compliance')
      .from('coc_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('subsection_id', subsectionId)

    const { error: dbErr } = await supabase
      .schema('compliance')
      .from('coc_uploads')
      .insert({
        subsection_id: subsectionId,
        organisation_id: orgId,
        uploaded_by: user.id,
        file_path: filePath,
        file_size_bytes: file.size,
        version: (count ?? 0) + 1,
        status: 'submitted',
      })

    if (dbErr) { setError(dbErr.message); setUploading(false); return }

    router.refresh()
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.jpg,.png"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn-primary-amber"
        style={{ fontSize: 12, padding: '6px 12px' }}
      >
        {uploading ? 'Uploading…' : 'Upload COC'}
      </button>
      {error && <p className="ob-error" role="alert" style={{ marginTop: 4 }}>{error}</p>}
    </div>
  )
}
