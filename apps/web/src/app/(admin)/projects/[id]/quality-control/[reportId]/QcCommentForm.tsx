'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addQcCommentAction } from '@/actions/qc.actions'
import type { QcPhotoView } from './QcEntryCard'

interface Props {
  entryId: string
  /** The entry's photos — offered as optional comment targets. */
  photos: QcPhotoView[]
}

/** Comment composer for one entry: body + optional per-photo target ("Whole
 *  entry" = group comment, photoId '' coerced to undefined by the schema). */
export function QcCommentForm({ entryId, photos }: Props) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [photoId, setPhotoId] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Synchronous re-entry lock (AddDiaryEntryForm double-click lesson).
  const submittingRef = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    if (!body.trim()) { setError('Comment required.'); return }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const res = await addQcCommentAction({ entryId, photoId, body: body.trim() })
      if (res.error) {
        setError(res.error)
        return
      }
      setBody('')
      setPhotoId('')
      router.refresh()
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          className="ob-input"
          style={{ flex: 1, minWidth: 220, resize: 'vertical' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          className="ob-select"
          value={photoId}
          onChange={(e) => setPhotoId(e.target.value)}
          aria-label="Comment target"
          style={{ flex: 1 }}
        >
          <option value="">Whole entry</option>
          {photos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.kind === 'markup' ? 'Markup' : 'Photo'} {p.index}{p.fileName ? ` — ${p.fileName}` : ''}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary-amber"
          style={{ opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? 'Saving…' : 'Comment'}
        </button>
      </div>
    </form>
  )
}
