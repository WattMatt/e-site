'use client'

/**
 * LayoutIssuedPanel — per-tenant layout-issued editor.
 *
 * Renders:
 *   1. Layout status toggle (not_issued / issued)
 *   2. Issued date input (YYYY-MM-DD)
 *   3. Layout drawings (managed set via TenantDocumentList)
 *
 * This is an "inline expand" panel — ScheduleTable renders it in a full-width
 * row below the tenant row when the user clicks the layout edit button.
 */

import { useState, useTransition } from 'react'
import { setLayoutStatusAction } from '@/actions/tenant-scope.actions'
import { TenantDocumentList } from './TenantDocumentList'

// ---------------------------------------------------------------------------
// Types (re-exported so the page / ScheduleTable can import them)
// ---------------------------------------------------------------------------

export interface LayoutDetails {
  node_id: string
  layout_status: 'not_issued' | 'issued'
  layout_issued_at: string | null   // YYYY-MM-DD date string or null
}

interface Props {
  projectId: string
  nodeId: string
  shopName: string | null
  layoutDetails: LayoutDetails | null
  onClose: () => void
}

// ---------------------------------------------------------------------------
// LayoutIssuedPanel
// ---------------------------------------------------------------------------

export function LayoutIssuedPanel({
  projectId,
  nodeId,
  shopName,
  layoutDetails: initialDetails,
  onClose,
}: Props) {
  const [details, setDetails] = useState<LayoutDetails>(
    initialDetails ?? {
      node_id: nodeId,
      layout_status: 'not_issued',
      layout_issued_at: null,
    },
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // ── Status toggle ─────────────────────────────────────────────────────────

  function handleStatusChange(status: 'not_issued' | 'issued') {
    setError(null)
    const snapshot = details
    // Optimistic: set status + default issuedAt to today when flipping to 'issued'
    const issuedAt =
      status === 'issued' ? (details.layout_issued_at ?? new Date().toISOString().slice(0, 10)) : null
    setDetails((d) => ({ ...d, layout_status: status, layout_issued_at: issuedAt }))
    startTransition(async () => {
      const res = await setLayoutStatusAction(projectId, nodeId, status, issuedAt)
      if ('error' in res) {
        setError(res.error)
        setDetails(snapshot)
      }
    })
  }

  // ── Issued-date change ────────────────────────────────────────────────────

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value || null
    setError(null)
    const snapshot = details
    setDetails((d) => ({ ...d, layout_issued_at: value }))
    startTransition(async () => {
      const res = await setLayoutStatusAction(projectId, nodeId, details.layout_status, value)
      if ('error' in res) {
        setError(res.error)
        setDetails(snapshot)
      }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--c-bg)',
        borderTop: '1px solid var(--c-border)',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginRight: 8,
            }}
          >
            Layout Issued
          </span>
          {shopName && (
            <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{shopName}</span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--c-text-dim)',
            fontSize: 18,
            lineHeight: 1,
            padding: '2px 6px',
          }}
          aria-label="Close layout panel"
        >
          ×
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--c-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Controls: status + date + drawing ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        {/* Status toggle */}
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 8,
            }}
          >
            Layout Status
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['not_issued', 'issued'] as const).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                disabled={isPending}
                style={{
                  padding: '5px 12px',
                  borderRadius: 5,
                  border: '1px solid',
                  cursor: isPending ? 'default' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'all 0.15s',
                  background:
                    details.layout_status === s
                      ? s === 'issued'
                        ? 'var(--c-green-dim)'
                        : 'var(--c-amber-dim)'
                      : 'var(--c-panel)',
                  borderColor:
                    details.layout_status === s
                      ? s === 'issued'
                        ? 'var(--c-green)'
                        : 'var(--c-amber)'
                      : 'var(--c-border)',
                  color:
                    details.layout_status === s
                      ? s === 'issued'
                        ? 'var(--c-green)'
                        : 'var(--c-amber)'
                      : 'var(--c-text-dim)',
                }}
              >
                {s === 'not_issued' ? 'Not Issued' : 'Issued'}
              </button>
            ))}
          </div>
        </div>

        {/* Issued date */}
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 8,
            }}
          >
            Issued Date
          </div>
          <input
            type="date"
            value={details.layout_issued_at ?? ''}
            onChange={handleDateChange}
            disabled={isPending}
            style={{
              padding: '5px 10px',
              borderRadius: 5,
              border: '1px solid var(--c-border)',
              background: 'var(--c-panel)',
              color: 'var(--c-text)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              cursor: isPending ? 'default' : 'text',
            }}
          />
        </div>

        {/* Layout drawings (managed set) */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 8,
            }}
          >
            Layout Drawings
          </div>
          <TenantDocumentList
            kind="layout"
            projectId={projectId}
            nodeId={nodeId}
            readOnly={false}
          />
        </div>
      </div>
    </div>
  )
}
