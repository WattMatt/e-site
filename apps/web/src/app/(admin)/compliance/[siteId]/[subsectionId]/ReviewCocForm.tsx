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
  const [loading, setLoading] = useState<'approve' | 'reject' | 'review' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAction(action: 'approve' | 'reject' | 'review') {
    if (action !== 'review' && action === 'reject' && !notes.trim()) {
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
    // On success, the page revalidates and re-renders
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">
          Review notes {loading === 'reject' && <span className="text-red-400">*</span>}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional for approval; required for rejection"
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        {/* Only show "Under Review" if currently submitted */}
        {currentStatus === 'submitted' && (
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => handleAction('review')}
            className="text-sm px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 transition-colors"
          >
            {loading === 'review' ? 'Updating…' : 'Mark under review'}
          </button>
        )}

        <button
          type="button"
          disabled={loading !== null}
          onClick={() => handleAction('approve')}
          className="text-sm px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white transition-colors"
        >
          {loading === 'approve' ? 'Approving…' : 'Approve ✓'}
        </button>

        <button
          type="button"
          disabled={loading !== null}
          onClick={() => handleAction('reject')}
          className="text-sm px-3 py-1.5 rounded-lg bg-red-900/70 hover:bg-red-800/70 disabled:opacity-50 text-red-300 transition-colors"
        >
          {loading === 'reject' ? 'Rejecting…' : 'Reject ✗'}
        </button>
      </div>
    </div>
  )
}
