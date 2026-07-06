'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface FileItem {
  id: string
  storage_path: string
  signed_url?: string
  filename: string
}

// Mirrors the inspection-attachments bucket definition (migration 00066):
// 25 MB cap, PDF/DOCX/XLSX. Checked client-side for a fast, readable error —
// the bucket enforces both regardless. Some browsers/OSes report an empty
// file.type, so the MIME is inferred from the extension in that case (the
// bucket rejects an empty contentType outright).
const MAX_FILE_BYTES = 25 * 1024 * 1024
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const ALLOWED_MIME = new Set(Object.values(EXT_MIME))

export default function FileField({ field, inspectionId, sectionId, readOnly }: RendererProps) {
  const supabase = createClient()
  // Capture routes live under /projects/[id]/… — the param is the project id.
  const params = useParams<{ id?: string }>()
  const [files, setFiles] = useState<FileItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // File attachments re-use inspections.photos (see spec §4.4): the blob
      // lives in the inspection-attachments bucket and the original filename
      // is stored in the `caption` column. Mirrors how photo fields read
      // inspections.photos via useFieldPhotos.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .schema('inspections')
        .from('photos')
        .select('id, storage_path, caption')
        .eq('inspection_id', inspectionId)
        .eq('section_id', sectionId)
        .eq('field_id', field.field_id)
      if (cancelled) return
      const rows = (data ?? []) as Array<{ id: string; storage_path: string; caption: string | null }>
      const withUrls = await Promise.all(
        rows.map(async (r) => {
          const { data: sig } = await supabase.storage
            .from('inspection-attachments')
            .createSignedUrl(r.storage_path, 3600)
          return {
            id: r.id,
            storage_path: r.storage_path,
            filename: r.caption ?? 'file',
            signed_url: sig?.signedUrl,
          }
        }),
      )
      if (!cancelled) setFiles(withUrls)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, inspectionId, sectionId, field.field_id])

  // Bytes go browser → Storage under the user's session (bucket RLS gates via
  // user_can_write_responses, migration 00073), then the metadata row insert
  // is gated by photos_insert RLS. No Vercel function in the byte path — the
  // 4.5 MB request-body cap that used to break large PDFs does not apply.
  const onUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB.`)
      }
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const mime = file.type || EXT_MIME[ext] || ''
      if (!ALLOWED_MIME.has(mime)) {
        throw new Error(`Unsupported file type: ${file.type || `.${ext}`}. Allowed: PDF, DOCX, XLSX.`)
      }

      let projectId = typeof params?.id === 'string' ? params.id : null
      if (!projectId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: insp } = await (supabase as any)
          .schema('inspections')
          .from('inspections')
          .select('project_id')
          .eq('id', inspectionId)
          .maybeSingle()
        projectId = (insp?.project_id as string | undefined) ?? null
      }
      if (!projectId) throw new Error('Could not resolve the inspection project')

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${projectId}/${inspectionId}/${sectionId}/${field.field_id}/${Date.now()}-${safeName}`
      const { error: upErr } = await supabase.storage
        .from('inspection-attachments')
        .upload(path, file, { contentType: mime })
      if (upErr) {
        const msg = upErr.message.toLowerCase()
        throw new Error(
          msg.includes('row-level security') || msg.includes('violates')
            ? 'Upload not allowed — this inspection is no longer editable.'
            : upErr.message,
        )
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row, error: insErr } = await (supabase as any)
        .schema('inspections')
        .from('photos')
        .insert({
          inspection_id: inspectionId,
          section_id: sectionId,
          field_id: field.field_id,
          storage_path: path,
          file_size_bytes: file.size,
          caption: file.name,
          uploaded_by: user.id,
        })
        .select('id')
        .single()
      if (insErr || !row) {
        await supabase.storage.from('inspection-attachments').remove([path]).catch(() => undefined)
        throw new Error(insErr?.message ?? 'Saving the file record failed')
      }

      const { data: sig } = await supabase.storage
        .from('inspection-attachments')
        .createSignedUrl(path, 3600)
      setFiles((prev) => [
        ...prev,
        { id: (row as { id: string }).id, storage_path: path, filename: file.name, signed_url: sig?.signedUrl },
      ])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {files.map(
          (f) =>
            f.signed_url && (
              <li key={f.id}>
                <a
                  href={f.signed_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline' }}
                >
                  {f.filename}
                </a>
              </li>
            ),
        )}
      </ul>
      {!readOnly && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 12px',
            border: '1px dashed var(--c-border)',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--c-text-dim)',
            maxWidth: 200,
          }}
        >
          {uploading ? 'Uploading…' : '+ Add file'}
          <input
            type="file"
            accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      )}
      {error && <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>{error}</p>}
    </div>
  )
}
