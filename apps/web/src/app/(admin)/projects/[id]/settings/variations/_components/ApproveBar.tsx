'use client'

/**
 * ApproveBar — approve a draft variation order, or (once approved) show the
 * locked banner with the frozen net change.
 *
 * Draft: a two-step inline-confirm "Approve" button (the same arm-then-commit
 * pattern the app uses elsewhere — Safari silently suppresses window.confirm).
 * Approving materializes the VO's `add` lines into the BOQ, freezes net_change
 * and locks the VO (approveVariationOrderAction), then onChanged() re-fetches
 * so the whole detail flips read-only. Approved: a locked banner with the
 * approver, date and signed net change.
 */

import { useState } from 'react'
import type { VariationOrder } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { approveVariationOrderAction } from '@/actions/variation.actions'
import { NetChange } from './VariationsList'

interface Props {
  projectId: string
  vo: VariationOrder
  /** Live Σ value_change over the VO's lines (from getVariationOrderAction). */
  netChange: number
  canEdit: boolean
  /** Resolved approver display name (from getVariationOrderAction), if approved. */
  approvedByName: string | null
  /** Re-fetch the VO after approving. */
  onChanged: () => void
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ApproveBar({ projectId, vo, netChange, canEdit, approvedByName, onChanged }: Props) {
  const [arming, setArming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Approved: locked banner ─────────────────────────────────────────────────
  if (vo.status === 'approved') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          padding: '12px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Badge variant="success">approved</Badge>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
            {approvedByName ? `by ${approvedByName}` : ''}
            {vo.approvedAt ? ` · ${fmtDateTime(vo.approvedAt)}` : ''}
          </span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Net change <NetChange value={vo.netChange ?? netChange} />
        </span>
      </div>
    )
  }

  // ── Draft: approve (two-step confirm) ───────────────────────────────────────
  if (!canEdit) return null

  async function doApprove() {
    setBusy(true)
    setError(null)
    const res = await approveVariationOrderAction(projectId, vo.id)
    setBusy(false)
    setArming(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    onChanged()
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: '12px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Badge variant="warning">draft</Badge>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
          Approving locks this VO and applies its lines to the revised contract position.
        </span>
        <span style={{ fontSize: 12 }}>
          Net change <NetChange value={netChange} />
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {error && <span style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
        {arming ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setArming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" isLoading={busy} disabled={busy} onClick={doApprove}>
              {busy ? 'Approving…' : 'Confirm approve'}
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setArming(true)}>
            Approve
          </Button>
        )}
      </div>
    </div>
  )
}
