'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { issueQcReportAction } from '@/actions/qc.actions'
import { previewViaSignedUrl } from '@/lib/file-open'

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
 * On success opens the inline preview route in a new tab and refreshes the
 * page so the status flips.
 *
 * The tab is opened through previewViaSignedUrl: a BLANK tab spawns
 * synchronously inside the confirm-click gesture, then navigates once the
 * action resolves (and closes on error). A window.open() AFTER awaiting the
 * issue — which gathers photos, renders and uploads the PDF, and emails the
 * roster — is silently popup-blocked (Safari always; Chrome once the ~5s user
 * activation expires), which read as a failed issue and provoked duplicate
 * re-issues + duplicate roster emails.
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
    let version = 0
    // previewViaSignedUrl opens the blank tab NOW (gesture still on the call
    // stack), awaits the thunk, then points the tab at the live preview route
    // so the browser's native PDF viewer handles it (the saved artifact is
    // listed in the panel below). On error the tab closes and we surface it.
    const res = await previewViaSignedUrl(async () => {
      const result = await issueQcReportAction(reportId)
      if ('error' in result) return { error: result.error }
      version = result.version
      return { url: `/api/projects/${projectId}/quality-control/${reportId}/report` }
    })
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    onIssued?.(version)
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
