'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createClient } from '@/lib/supabase/client'
import { uploadSnagPhoto } from '@/lib/image/compress'

// ─── Photo types ──────────────────────────────────────────────────────────────
// These literals MUST stay inside the field.snag_photos CHECK constraint
// ('evidence' | 'closeout' | 'markup' — 00004_field_schema.sql). Sending an
// off-list value makes every insert fail AFTER the upload has already landed.

const PHOTO_TYPES = [
  {
    value: 'evidence' as const,
    label: 'Evidence',
    hint: 'The defect as found — "before".',
  },
  {
    value: 'closeout' as const,
    label: 'Close-out',
    hint: 'Proof the defect is fixed — "after". Required to sign off.',
  },
]

type PhotoType = (typeof PHOTO_TYPES)[number]['value']

interface Props {
  snagId: string
  orgId: string
  projectId: string
  /** Existing close-out photo count — drives the sign-off readiness hint. */
  closeoutCount: number
}

export function SnagPhotoUploader({ snagId, orgId, projectId, closeoutCount }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [photoType, setPhotoType] = useState<PhotoType>('evidence')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    setDone(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let uploaded = 0
    try {
      for (const [i, raw] of Array.from(files).entries()) {
        await uploadSnagPhoto(supabase as never, {
          file: raw,
          orgId,
          projectId,
          snagId,
          photoType,
          sortOrder: i,
          uploadedBy: user?.id ?? null,
        })
        uploaded += 1
      }

      setDone(`${uploaded} ${photoType === 'closeout' ? 'close-out' : 'evidence'} photo${uploaded === 1 ? '' : 's'} added.`)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const selected = PHOTO_TYPES.find((t) => t.value === photoType)!

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Type selector */}
      <div style={{ display: 'flex', gap: 8 }}>
        {PHOTO_TYPES.map((t) => {
          const isSel = t.value === photoType
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setPhotoType(t.value)}
              disabled={busy}
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: 'all 0.12s',
                border: `1px solid ${isSel ? (t.value === 'closeout' ? 'var(--c-green)' : 'var(--c-amber-mid)') : 'var(--c-border)'}`,
                background: isSel ? (t.value === 'closeout' ? 'var(--c-green-dim)' : 'var(--c-amber-dim)') : 'var(--c-panel)',
                color: isSel ? (t.value === 'closeout' ? 'var(--c-green)' : 'var(--c-amber)') : 'var(--c-text-dim)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>{selected.hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        disabled={busy}
        onChange={(e) => void handleFiles(e.target.files)}
        style={{ fontSize: 12, color: 'var(--c-text-dim)' }}
      />

      {busy && (
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>Uploading…</p>
      )}

      {done && (
        <p style={{ fontSize: 12, color: 'var(--c-green)', margin: 0 }}>{done}</p>
      )}

      {error && (
        <p style={{ fontSize: 12, color: 'var(--c-red)', margin: 0 }}>{error}</p>
      )}

      {closeoutCount === 0 && (
        <p style={{ fontSize: 12, color: 'var(--c-amber)', margin: 0 }}>
          No close-out photo yet — one is required before this snag can be signed off.
        </p>
      )}
    </div>
  )
}
