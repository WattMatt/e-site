'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { addQcEntryAction } from '@/actions/qc.actions'
import { uploadQcEntryPhotos, uploadQcMarkup } from '@/lib/qc-photos'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { FloorPlanAttachDialog } from '@/components/attachments/FloorPlanAttachDialog'
import type { StagedAttachment } from '@/components/attachments/types'

type StagedMarkup = Extract<StagedAttachment, { kind: 'annotation' }>

interface Props {
  projectId: string
  reportId: string
  orgId: string
  userId: string
}

/**
 * Collapsible "add entry" form: title/description + staged photos (PhotoPicker)
 * and drawing markups (FloorPlanAttachDialog). Mirrors AddDiaryEntryForm's
 * submit shape — entry created once, uploads resumable on retry (committed
 * items pruned from the staging lists via callbacks).
 */
export function AddQcEntryForm({ projectId, reportId, orgId, userId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [markups, setMarkups] = useState<StagedMarkup[]>([])
  const [markupDialogOpen, setMarkupDialogOpen] = useState(false)
  const [error, setError] = useState('')
  // Holds the id of an entry created on a prior submit whose upload failed —
  // a retry reuses it instead of creating a duplicate entry.
  const [createdEntryId, setCreatedEntryId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Synchronous re-entry lock. State updates lag a render, so two fast clicks
  // would both read `submitting === false` and each create an entry. A ref
  // flips immediately and blocks the duplicate submit.
  const submittingRef = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    if (!title.trim()) { setError('Title is required.'); return }
    submittingRef.current = true
    setSubmitting(true)
    setError('')

    try {
      // Create the entry once. If a previous submit created it but an upload
      // failed, reuse that id so the retry doesn't insert a duplicate.
      let entryId = createdEntryId
      if (!entryId) {
        const res = await addQcEntryAction({
          reportId,
          title: title.trim(),
          description: description.trim() || undefined,
        })
        if (res.error || !res.entryId) {
          setError(res.error ?? 'Failed to save entry.')
          return
        }
        entryId = res.entryId
        setCreatedEntryId(entryId)
      }

      const supabase = createClient()
      const target = { orgId, projectId, reportId, entryId, userId }

      if (files.length > 0) {
        try {
          await uploadQcEntryPhotos(
            supabase as any,
            { ...target, files },
            // Drop each committed file so a retry resumes with only what's left.
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
            annotationData: markup.annotationData,
            sourceFloorPlanId: markup.sourceFloorPlanId,
          })
          setMarkups((prev) => prev.filter((m) => m !== markup))
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to upload markup.')
          return
        }
      }

      setTitle('')
      setDescription('')
      setFiles([])
      setMarkups([])
      setCreatedEntryId(null)
      setOpen(false)
      startTransition(() => router.refresh())
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary-amber">
        + Add Entry
      </button>
    )
  }

  return (
    <>
      <form onSubmit={submit} className="data-panel" style={{ marginTop: 16 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">New Entry</span>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}

          <div>
            <label className="ob-label">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Cable tray supports — east riser"
              className="ob-input"
              style={{ marginTop: 4 }}
            />
          </div>

          <div>
            <label className="ob-label">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What was inspected, findings, required actions…"
              className="ob-input"
              style={{ marginTop: 4, resize: 'vertical' }}
            />
          </div>

          <div>
            <label className="ob-label">Photos</label>
            <div style={{ marginTop: 6 }}>
              <PhotoPicker
                label="Upload photos"
                maxSizeMB={20}
                onFilesSelected={(picked) =>
                  // De-dupe: the same photo picked twice must not upload as two rows.
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
                      onClick={() => setMarkups((ms) => ms.filter((x) => x.id !== m.id))}
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
              style={{ flex: 1, opacity: submitting || isPending ? 0.6 : 1 }}
            >
              {submitting || isPending ? 'Saving…' : 'Save Entry'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: '1px solid var(--c-border)',
                background: 'var(--c-panel)',
                color: 'var(--c-text-dim)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>

      {markupDialogOpen && (
        <FloorPlanAttachDialog
          projectId={projectId}
          onClose={() => setMarkupDialogOpen(false)}
          onStage={(staged) => setMarkups((prev) => [...prev, staged])}
        />
      )}
    </>
  )
}
