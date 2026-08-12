'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadFormPhoto, SITE_FORM_PHOTO_BUCKET } from '@/lib/site-forms/upload'

/**
 * Per-field photo strip for site forms.
 *
 * Photos are keyed by (form_id, section_id, field_id), so the field id passed
 * in is the only thing scoping a photo to its evidence slot. Repeating-group
 * sub-fields pass their synthetic id (`circuits[0].photo_circuit_termination`)
 * straight through and land against that exact entry.
 *
 * Self-contained rather than reusing the inspections `useFieldPhotos` hook,
 * which hardcodes the `inspections` schema, the `inspection-photos` bucket and
 * an `inspection_id` column.
 */

export interface FormPhotoRow {
  id: string
  section_id: string
  field_id: string
  storage_path: string
  caption: string | null
  sort_order: number
  signed_url?: string | null
}

type PgError = { message: string } | null

interface PhotoDbClient {
  schema(name: string): {
    from(table: string): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          maybeSingle(): PromiseLike<{
            data: { storage_path: string; sort_order: number } | null
            error: PgError
          }>
        }
      }
      delete(opts: { count: 'exact' }): {
        eq(
          column: string,
          value: string,
        ): PromiseLike<{ error: PgError; count: number | null }>
      }
    }
  }
}

/** Turn a raw storage/PostgREST failure into something actionable on site. */
function friendlyError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('row-level security') || m.includes('violates')) {
    return 'Upload not allowed — this form is no longer a draft, or your role cannot edit it.'
  }
  if (m.includes('maximum allowed size') || m.includes('too large') || m.includes('exceeded')) {
    return 'Photo exceeds the 10 MB storage limit.'
  }
  if (m.includes('mime')) {
    return 'That file type is not accepted. Use a JPEG, PNG, WebP or HEIC photo.'
  }
  return raw
}

interface Props {
  projectId: string
  formId: string
  sectionId: string
  fieldId: string
  photos: FormPhotoRow[]
  readOnly: boolean
  currentUserId: string | null
  onAdded: (row: FormPhotoRow) => void
  onRemoved: (id: string) => void
}

export default function FormPhotoStrip({
  projectId,
  formId,
  sectionId,
  fieldId,
  photos,
  readOnly,
  currentUserId,
  onAdded,
  onRemoved,
}: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two-step inline confirm: first tap arms, second commits, 3 s auto-reset.
  // window.confirm() is silently suppressed by Safari on this stack.
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const supabase = createClient()
      const nextSort = photos.reduce((max, p) => Math.max(max, p.sort_order + 1), 0)

      const result = await uploadFormPhoto(
        supabase as unknown as Parameters<typeof uploadFormPhoto>[0],
        {
          file,
          projectId,
          formId,
          sectionId,
          fieldId,
          sortOrder: nextSort,
          uploadedBy: currentUserId,
        },
      )
      if ('error' in result) throw new Error(friendlyError(result.error))

      // The upload helper owns the storage path layout — migration 00179's
      // policies key on segment [2] being the form id — so the path is read
      // back from the row rather than reconstructed here.
      const db = supabase as unknown as PhotoDbClient
      const { data: row } = await db
        .schema('field')
        .from('form_photos')
        .select('storage_path, sort_order')
        .eq('id', result.id)
        .maybeSingle()

      const storagePath = row?.storage_path ?? ''
      let signedUrl: string | null = null
      if (storagePath) {
        const { data: sig } = await supabase.storage
          .from(SITE_FORM_PHOTO_BUCKET)
          .createSignedUrl(storagePath, 3600)
        signedUrl = sig?.signedUrl ?? null
      }

      onAdded({
        id: result.id,
        section_id: sectionId,
        field_id: fieldId,
        storage_path: storagePath,
        caption: file.name,
        sort_order: row?.sort_order ?? nextSort,
        signed_url: signedUrl,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const remove = async (photo: FormPhotoRow) => {
    setError(null)
    try {
      const supabase = createClient()
      const db = supabase as unknown as PhotoDbClient
      const { error: delErr, count } = await db
        .schema('field')
        .from('form_photos')
        .delete({ count: 'exact' })
        .eq('id', photo.id)
      if (delErr) throw new Error(friendlyError(delErr.message))
      if (!count) {
        // 0 rows: either RLS filtered it (form no longer writable) or it was
        // already gone. Only the former is an error worth showing.
        throw new Error(
          'Delete not permitted — this form is no longer a draft, or your role cannot edit it.',
        )
      }
      onRemoved(photo.id)
      // Best-effort: an orphaned object is invisible once no row points at it.
      if (photo.storage_path) {
        await supabase.storage
          .from(SITE_FORM_PHOTO_BUCKET)
          .remove([photo.storage_path])
          .catch(() => undefined)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const viewable = photos.filter((p) => !!p.signed_url)

  // Read-only with nothing captured: render nothing rather than an empty strip.
  if (readOnly && photos.length === 0) return null

  return (
    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      {photos.map((p) => (
        <div key={p.id} style={{ position: 'relative' }}>
          {p.signed_url ? (
            <a
              href={p.signed_url}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block', lineHeight: 0 }}
              title={p.caption ?? 'Open photo'}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.signed_url}
                alt={p.caption ?? 'Site photo'}
                style={{
                  width: 72,
                  height: 72,
                  objectFit: 'cover',
                  borderRadius: 4,
                  border: '1px solid var(--c-border)',
                  display: 'block',
                }}
              />
            </a>
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 4,
                border: '1px solid var(--c-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: 'var(--c-text-dim)',
                textAlign: 'center',
                padding: 4,
              }}
            >
              Preview unavailable
            </div>
          )}

          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                if (confirmId === p.id) {
                  setConfirmId(null)
                  void remove(p)
                } else {
                  setConfirmId(p.id)
                  setTimeout(() => {
                    setConfirmId((curr) => (curr === p.id ? null : curr))
                  }, 3000)
                }
              }}
              aria-label={confirmId === p.id ? 'Tap again to confirm delete' : 'Delete photo'}
              title={confirmId === p.id ? 'Tap again to confirm' : 'Delete photo'}
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                height: 24,
                minWidth: 24,
                padding: confirmId === p.id ? '0 8px' : 0,
                borderRadius: 12,
                background: confirmId === p.id ? '#7f1d1d' : 'rgba(220, 38, 38, 0.95)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.9)',
                fontSize: confirmId === p.id ? 10 : 15,
                fontWeight: 700,
                lineHeight: 1,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                whiteSpace: 'nowrap',
                zIndex: 5,
              }}
            >
              {confirmId === p.id ? 'Tap to delete' : '×'}
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px dashed var(--c-border-mid)',
            cursor: uploading ? 'wait' : 'pointer',
            fontSize: 12,
            color: 'var(--c-text-mid)',
            whiteSpace: 'nowrap',
          }}
        >
          {uploading ? 'Uploading…' : photos.length > 0 ? '+ Photo' : '+ Take photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={uploading}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
              // Reset so re-selecting the same file still fires onChange.
              e.target.value = ''
            }}
          />
        </label>
      )}

      {photos.length > 0 && viewable.length < photos.length && (
        <span style={{ fontSize: 10, color: 'var(--c-text-dim)', width: '100%' }}>
          Some previews could not be signed. The photos are still attached to this record.
        </span>
      )}

      {error && (
        <span className="form-error" style={{ fontSize: 11, color: 'var(--c-red)', width: '100%' }}>
          {error}
        </span>
      )}
    </div>
  )
}
