'use client'

import { useState } from 'react'
import { reviewCocAction, markUnderReviewAction } from '@/actions/compliance.actions'

interface Props {
  uploadId: string
  subsectionId: string
  siteId: string
  currentStatus: string
}

export function ReviewCocForm({ uploadId, subsectionId, siteId, currentStatus }: Props) {
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState<'approved' | 'rejected' | 'review' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAction(action: 'approved' | 'rejected' | 'review') {
    if (action === 'rejected' && !notes.trim()) {
      setError('Please add a note explaining why the COC was rejected.')
      return
    }

    setLoading(action)
    setError(null)

    let result: { error?: string }

    if (action === 'review') {
      result = await markUnderReviewAction(uploadId, subsectionId, siteId)
    } else {
      result = await reviewCocAction(
        uploadId,
        subsectionId,
        siteId,
        action,
        notes.trim() || null,
      )
    }

    setLoading(null)
    if (result.error) setError(result.error)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label className="ob-label">
          Review notes <span style={{ color: 'var(--c-text-dim)', fontSize: 10 }}>(required for rejection)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional for approval; required for rejection"
          className="ob-input"
          style={{ resize: 'vertical', minHeight: 56 }}
        />
      </div>

      {error && <p className="ob-error" role="alert">{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {currentStatus === 'submitted' && (
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => handleAction('review')}
            className="filter-tab"
            style={{ padding: '7px 14px' }}
          >
            {loading === 'review' ? 'Updating…' : 'Mark under review'}
          </button>
        )}

        <button
          type="button"
          disabled={loading !== null}
          onClick={() => handleAction('approved')}
          style={{
            padding: '7px 14px',
            fontSize: 12, fontWeight: 600,
            borderRadius: 6,
            background: '#14532d', border: '1px solid #166534',
            color: '#4ade80', cursor: loading ? 'wait' : 'pointer',
            opacity: loading !== null ? 0.5 : 1,
            fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
          }}
        >
          {loading === 'approved' ? 'Approving…' : 'Approve ✓'}
        </button>

        <button
          type="button"
          disabled={loading !== null}
          onClick={() => handleAction('rejected')}
          style={{
            padding: '7px 14px',
            fontSize: 12, fontWeight: 600,
            borderRadius: 6,
            background: 'var(--c-red-dim)', border: '1px solid rgba(127,29,29,0.6)',
            color: '#fca5a5', cursor: loading ? 'wait' : 'pointer',
            opacity: loading !== null ? 0.5 : 1,
            fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
          }}
        >
          {loading === 'rejected' ? 'Rejecting…' : 'Reject ✗'}
        </button>
      </div>
    </div>
  )
}
