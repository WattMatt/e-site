'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  uploadInspectionAttachmentFile,
  removeInspectionAttachmentFile,
} from '@/lib/storage/inspection-attachments-upload'
import { attachInspectionFileAction } from '@/actions/inspections.actions'

interface FileItem {
  id: string
  storage_path: string
  signed_url?: string
  filename: string
}

export default function FileField({ field, inspectionId, sectionId, readOnly }: RendererProps) {
  const supabase = createClient()
  const [files, setFiles] = useState<FileItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // File attachments re-use inspections.photos (see
      // attachInspectionFileAction + spec §4.4): the blob lives in the
      // inspection-attachments bucket and the original filename is stored in
      // the `caption` column. Mirrors how photo fields read inspections.photos
      // via useFieldPhotos.
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

  const onUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      // Bytes go browser → storage (Vercel's ~4.5 MB body cap rules out an
      // API route); the photos row is attached in a follow-up server action.
      const { storagePath, filename } = await uploadInspectionAttachmentFile({
        inspectionId,
        sectionId,
        fieldId: field.field_id,
        file,
      })
      const res = await attachInspectionFileAction({
        inspectionId,
        sectionId,
        fieldId: field.field_id,
        storagePath,
        filename,
      })
      if (!res.ok) {
        // Don't leave an orphan object behind when the DB attach fails.
        await removeInspectionAttachmentFile(storagePath)
        throw new Error(res.error)
      }
      const { data: sig } = await supabase.storage
        .from('inspection-attachments')
        .createSignedUrl(storagePath, 3600)
      setFiles((prev) => [
        ...prev,
        { id: res.id, storage_path: storagePath, filename, signed_url: sig?.signedUrl },
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
