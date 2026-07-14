'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  closeQcReportAction,
  reopenQcReportAction,
  deleteQcReportAction,
} from '@/actions/qc.actions'

interface Props {
  projectId: string
  reportId: string
  /** 'draft' | 'issued' | 'closed' — decides which lifecycle moves render. */
  status: string
}

/**
 * Manager lifecycle affordances (parent renders only for ORG_WRITE_ROLES —
 * every action re-gates server-side):
 *
 *   issued → Close report   (two-step armed; drops the report from the client
 *                            portal and freezes all content)
 *   closed → Reopen report  (closed → issued; the explicit way back — Issue is
 *                            hidden while closed)
 *   any    → Delete report  (two-step armed; entries/photos/PDFs cascade, then
 *                            back to the QC list)
 *
 * Two-step arm/confirm is the house Safari pattern (window.confirm suppression
 * — see QcDeleteButton).
 */
export function QcLifecycleButtons({ projectId, reportId, status }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [armed, setArmed] = useState<'close' | 'delete' | null>(null)
  const [busy, setBusy] = useState<'close' | 'reopen' | 'delete' | null>(null)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function arm(kind: 'close' | 'delete') {
    setArmed(kind)
    setError('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setArmed(null), 3000)
  }

  async function run(kind: 'close' | 'reopen' | 'delete') {
    if (timer.current) clearTimeout(timer.current)
    setArmed(null)
    setBusy(kind)
    setError('')
    const action =
      kind === 'close' ? closeQcReportAction
      : kind === 'reopen' ? reopenQcReportAction
      : deleteQcReportAction
    const res = await action(reportId)
    if (res?.error) {
      setError(res.error)
      setBusy(null)
      return
    }
    if (kind === 'delete') {
      router.push(`/projects/${projectId}/quality-control`)
      return
    }
    setBusy(null)
    startTransition(() => router.refresh())
  }

  const ghostButton = (color: string): React.CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 6,
    background: 'transparent',
    border: `1px solid ${color}`,
    color,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1,
    transition: 'all 0.12s',
    whiteSpace: 'nowrap',
  })

  const armedButton: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 6,
    background: 'var(--c-red)',
    border: '1px solid var(--c-red)',
    color: '#fff',
    cursor: 'pointer',
    transition: 'all 0.12s',
    whiteSpace: 'nowrap',
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</span>}

      {status === 'issued' && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={armed === 'close' ? () => run('close') : () => arm('close')}
          style={armed === 'close' ? armedButton : ghostButton('var(--c-text-mid)')}
          title="Close the report — freezes content and removes it from the client portal"
        >
          {busy === 'close' ? 'Closing…' : armed === 'close' ? 'Confirm close?' : 'Close report'}
        </button>
      )}

      {status === 'closed' && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run('reopen')}
          style={ghostButton('var(--c-amber)')}
          title="Reopen the report (closed → issued)"
        >
          {busy === 'reopen' ? 'Reopening…' : 'Reopen report'}
        </button>
      )}

      <button
        type="button"
        disabled={busy !== null}
        onClick={armed === 'delete' ? () => run('delete') : () => arm('delete')}
        style={armed === 'delete' ? armedButton : ghostButton('var(--c-red)')}
        title="Permanently delete this report, its entries, photos and saved PDFs"
      >
        {busy === 'delete' ? 'Deleting…' : armed === 'delete' ? 'Confirm delete?' : 'Delete report'}
      </button>
    </span>
  )
}
