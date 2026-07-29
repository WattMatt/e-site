'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadQcEntryPhotos, uploadQcMarkup } from '@/lib/qc-photos'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { QcMarkupDialog, type StagedQcMarkup } from './QcMarkupDialog'

interface Props {
  projectId: string
  orgId: string
  reportId: string
  /** The EXISTING entry the staged media is appended to. */
  entryId: string
  userId: string
}

/**
 * Collapsible "+ Add photos / markup" affordance on an existing QC entry
 * (spec §Admin UI). Stages photos (PhotoPicker) + drawing markups
 * (QcMarkupDialog) then uploads them against the entry's own id via
 * uploadQcEntryPhotos / uploadQcMarkup (client-direct, bucket + table RLS are
 * the gate) and router.refresh()es. Mirrors AddQcEntryForm's upload loop,
 * minus the entry-create step: committed items are pruned as they upload so a
 * retry after a mid-loop failure resumes with only the remainder (no dupes).
 * The parent renders this only for QC_WRITE_ROLES on non-closed reports.
 */
export function AddEntryMediaForm({ projectId, orgId, reportId, entryId, userId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [markups, setMarkups] = useState<StagedQcMarkup[]>([])
  const [markupDialogOpen, setMarkupDialogOpen] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Synchronous re-entry lock (AddDiaryEntryForm double-click lesson).
  const submittingRef = useRef(false)

  function resetStaging() {
    // Revoke any object URLs still staged so a cancel doesn't leak them.
    for (const m of markups) URL.revokeObjectURL(m.previewUrl)
    setFiles([])
    setMarkups([])
    setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    if (files.length === 0 && markups.length === 0) {
      setError('Add at least one photo or markup first.')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')

    const supabase = createClient()
    const target = { orgId, projectId, reportId, entryId, userId }

    try {
      if (files.length > 0) {
        try {
          await uploadQcEntryPhotos(
            supabase as any,
            { ...target, files },
            (uploaded) => setFiles((prev) => prev.filter((f) => f !== uploaded)),
          )
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to upload photos.')
          return
        }
      }

      for (const markup of markups) {
        try {
          await uploadQcMarkup(supabase as any, target, {
            blob: markup.blob,
            fileName: markup.fileName,
            annotationData: markup.scene,
            sourceFloorPlanId: markup.sourceFloorPlanId,
          })
          URL.revokeObjectURL(markup.previewUrl)
          setMarkups((prev) => prev.filter((m) => m !== markup))
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to upload markup.')
          return
        }
      }

      setOpen(false)
      startTransition(() => router.refresh())
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 6,
            border: '1px solid var(--c-border)', background: 'var(--c-panel)',
            color: 'var(--c-text-mid)', cursor: 'pointer',
          }}
        >
          + Add photos / markup
        </button>
      </div>
    )
  }

  return (
    <>
      <form
        onSubmit={submit}
        style={{
          marginTop: 12,
          border: '1px solid var(--c-border-mid)',
          borderRadius: 8,
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {error && <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}

        <div>
          <label className="ob-label">Photos</label>
          <div style={{ marginTop: 6 }}>
            <PhotoPicker
              label="Upload photos"
              maxSizeMB={20}
              onFilesSelected={(picked) =>
                setFiles((prev) => {
                  const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`
                  const seen = new Set(prev.map(key))
                  return [...prev, ...picked.filter((f) => !seen.has(key(f)))]
                })
              }
            />
          </div>
          {files.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {files.map((f, i) => (
                <div key={`${f.name}-${f.size}-${f.lastModified}`} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(f)}
                    alt=""
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-border)' }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                    style={{
                      position: 'absolute', top: -4, right: -4, width: 20, height: 20,
                      background: 'var(--c-red)', color: '#fff', border: 'none', borderRadius: '50%',
                      fontSize: 11, lineHeight: 1, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="ob-label">Drawing markups</label>
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setMarkupDialogOpen(true)}
              style={{
                fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--c-border)', background: 'var(--c-panel)',
                color: 'var(--c-text-mid)', cursor: 'pointer',
              }}
            >
              ✏️ Add drawing markup
            </button>
          </div>
          {markups.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {markups.map((m) => (
                <div key={m.id} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.previewUrl}
                    alt={m.fileName}
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-amber-mid)' }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${m.fileName}`}
                    onClick={() => {
                      URL.revokeObjectURL(m.previewUrl)
                      setMarkups((ms) => ms.filter((x) => x.id !== m.id))
                    }}
                    style={{
                      position: 'absolute', top: -4, right: -4, width: 20, height: 20,
                      background: 'var(--c-red)', color: '#fff', border: 'none', borderRadius: '50%',
                      fontSize: 11, lineHeight: 1, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="submit"
            disabled={submitting || isPending}
            className="btn-primary-amber"
            style={{ opacity: submitting || isPending ? 0.6 : 1 }}
          >
            {submitting || isPending ? 'Uploading…' : 'Upload'}
          </button>
          <button
            type="button"
            onClick={() => { resetStaging(); setOpen(false) }}
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: '1px solid var(--c-border)', background: 'var(--c-panel)',
              color: 'var(--c-text-dim)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </form>

      {markupDialogOpen && (
        <QcMarkupDialog
          projectId={projectId}
          onClose={() => setMarkupDialogOpen(false)}
          onStaged={(staged) => setMarkups((prev) => [...prev, staged])}
        />
      )}
    </>
  )
}
