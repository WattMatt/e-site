'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { issueQcReportAction } from '@/actions/qc.actions'

interface Props {
  projectId: string
  reportId: string
  /** 'draft' shows "Issue report"; anything else reads "Re-issue" (version bump). */
  status: string
  /** Fired after a successful issue (host bumps the saved-reports reloadKey). */
  onIssued?: (version: number) => void
}

/**
 * Two-step armed issue confirm (Safari window.confirm suppression pattern).
 * On success opens the inline preview route in a new tab — same flow as
 * VisitDetail's Export PDF — and refreshes the page so the status flips.
 */
export function IssueReportButton({ projectId, reportId, status, onIssued }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const idleLabel = status === 'draft' ? '⬆ Issue report' : '⬆ Re-issue report'

  function arm() {
    setArmed(true)
    setError('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }

  async function commit() {
    if (timer.current) clearTimeout(timer.current)
    setArmed(false)
    setBusy(true)
    setError('')
    const result = await issueQcReportAction(reportId)
    setBusy(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onIssued?.(result.version)
    // Open the live preview in a new tab so the browser's native PDF viewer
    // handles it (the saved artifact is listed in the panel below).
    window.open(`/api/projects/${projectId}/quality-control/${reportId}/report`, '_blank', 'noopener')
    startTransition(() => router.refresh())
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 12 }}>Issue failed: {error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={armed ? commit : arm}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 6,
          border: 'none',
          background: armed ? 'var(--c-red)' : 'var(--c-amber)',
          color: armed ? '#fff' : 'var(--c-on-amber)',
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.6 : 1,
          transition: 'all 0.12s',
          whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Issuing…' : armed ? 'Confirm issue?' : idleLabel}
      </button>
    </span>
  )
}
