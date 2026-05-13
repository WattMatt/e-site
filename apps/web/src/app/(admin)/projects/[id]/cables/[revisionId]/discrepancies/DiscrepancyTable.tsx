'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  acceptVarianceAction,
  requestRemeasureAction,
  requestDesignReviewAction,
} from '@/actions/cable-discrepancy.actions'

export interface DiscRow {
  id: string
  tag: string
  measured: number | null
  confirmed: number | null
  delta: number | null
  deltaPct: number | null
  method: string | null
  status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'
  confirmedAt: string | null
  verifierName: string | null
  reason: string | null
}

const STATUS_TONE: Record<DiscRow['status'], string> = {
  UNMEASURED: 'badge-muted',
  MEASURED: 'badge-warning',
  CONFIRMED: 'badge-success',
  DISCREPANCY: 'badge-error',
}

function fmt(n: number | null, d = 1) {
  if (n == null) return '—'
  return Number(n).toFixed(d)
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function DiscrepancyTable({ rows, locked }: { rows: DiscRow[]; locked: boolean }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function onAccept(id: string) {
    const reason = window.prompt('Reason for accepting this variance (required, ≥ 4 chars):') ?? ''
    if (reason.trim().length < 4) return
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      const r = await acceptVarianceAction({ cableId: id, reason })
      setPendingId(null)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  function onRemeasure(id: string) {
    if (!confirm('Clear the confirmed length and ask the site team to re-measure?')) return
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      const r = await requestRemeasureAction({ cableId: id })
      setPendingId(null)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  function onDesignReview(id: string) {
    const reason = window.prompt('Optional note for the designer (route walked longer / shorter / route changed):') ?? null
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      const r = await requestDesignReviewAction({ cableId: id, reason: reason ?? undefined })
      setPendingId(null)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  return (
    <div>
      {error && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{error}</div>
      )}
      <div className="data-panel" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <Th>Cable</Th>
              <Th align="right">Measured</Th>
              <Th align="right">Confirmed</Th>
              <Th align="right">Δ (m)</Th>
              <Th align="right">Δ (%)</Th>
              <Th>Method</Th>
              <Th>Status</Th>
              <Th>Verifier</Th>
              <Th>Reason</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const flagDelta = r.delta != null
                && (Math.abs(r.delta) > 5 || (r.deltaPct != null && Math.abs(r.deltaPct) > 10))
              return (
                <tr key={r.id} style={{
                  borderTop: '1px solid var(--c-border)',
                  background: r.status === 'DISCREPANCY' ? 'rgba(220,38,38,0.04)' : undefined,
                }}>
                  <Td>{r.tag}</Td>
                  <Td align="right">{fmt(r.measured, 1)}</Td>
                  <Td align="right">{fmt(r.confirmed, 1)}</Td>
                  <Td align="right" style={{ color: flagDelta ? '#dc2626' : 'var(--c-text)' }}>
                    {r.delta == null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)}`}
                  </Td>
                  <Td align="right" style={{ color: flagDelta ? '#dc2626' : 'var(--c-text)' }}>
                    {r.deltaPct == null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct.toFixed(1)}%`}
                  </Td>
                  <Td>{r.method ?? '—'}</Td>
                  <Td><span className={`badge ${STATUS_TONE[r.status]}`}>{r.status}</span></Td>
                  <Td style={{ fontFamily: 'inherit' }}>
                    {r.verifierName ?? '—'}
                    {r.confirmedAt && (
                      <div style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>{fmtDate(r.confirmedAt)}</div>
                    )}
                  </Td>
                  <Td style={{ fontFamily: 'inherit', whiteSpace: 'normal', maxWidth: 240 }}>
                    {r.reason ?? '—'}
                  </Td>
                  <Td>
                    {locked ? (
                      <span style={{ color: 'var(--c-text-dim)', fontStyle: 'italic' }}>locked</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.status === 'DISCREPANCY' && (
                          <button type="button" onClick={() => onAccept(r.id)} disabled={pendingId === r.id}
                            style={{ ...actionBtn, color: '#16a34a' }}>✓ Accept</button>
                        )}
                        <button type="button" onClick={() => onRemeasure(r.id)} disabled={pendingId === r.id}
                          style={actionBtn}>↺ Re-measure</button>
                        <button type="button" onClick={() => onDesignReview(r.id)} disabled={pendingId === r.id}
                          style={{ ...actionBtn, color: 'var(--c-amber)' }}>⚙ Design review</button>
                      </div>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  color: 'var(--c-text-mid)',
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '10px 12px',
      fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--c-text-dim)', fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({ children, align, style }: { children?: React.ReactNode; align?: 'left' | 'right'; style?: React.CSSProperties }) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '8px 12px', verticalAlign: 'top',
      color: 'var(--c-text)', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  )
}
