'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface PhotoItem {
  id: string
  storage_path: string
  signed_url?: string
}

export default function PhotoField({ field, inspectionId, sectionId, readOnly }: RendererProps) {
  const supabase = createClient()
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .schema('inspections')
        .from('photos')
        .select('id, storage_path')
        .eq('inspection_id', inspectionId)
        .eq('section_id', sectionId)
        .eq('field_id', field.field_id)
      if (cancelled) return
      const rows = (data ?? []) as PhotoItem[]
      const withUrls = await Promise.all(
        rows.map(async (p) => {
          const { data: sig } = await supabase.storage
            .from('inspection-photos')
            .createSignedUrl(p.storage_path, 3600)
          return { ...p, signed_url: sig?.signedUrl }
        }),
      )
      if (!cancelled) setPhotos(withUrls)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, inspectionId, sectionId, field.field_id])

  const onUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('inspectionId', inspectionId)
      fd.append('sectionId', sectionId)
      fd.append('fieldId', field.field_id)
      const res = await fetch('/api/inspections/upload-photo', { method: 'POST', body: fd })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Upload failed (HTTP ${res.status}): ${t}`)
      }
      const { id, storage_path } = (await res.json()) as { id: string; storage_path: string }
      const { data: sig } = await supabase.storage
        .from('inspection-photos')
        .createSignedUrl(storage_path, 3600)
      setPhotos((prev) => [...prev, { id, storage_path, signed_url: sig?.signedUrl }])
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {photos.map(
          (p) =>
            p.signed_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={p.signed_url}
                alt=""
                style={{
                  width: '100%',
                  height: 96,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid var(--c-border)',
                }}
              />
            ),
        )}
        {!readOnly && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: 96,
              border: '2px dashed var(--c-border)',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 11,
              color: 'var(--c-text-dim)',
            }}
          >
            {uploading ? 'Uploading…' : '+ Add photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
          </label>
        )}
      </div>
      {error && (
        <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>{error}</p>
      )}
    </div>
  )
}
