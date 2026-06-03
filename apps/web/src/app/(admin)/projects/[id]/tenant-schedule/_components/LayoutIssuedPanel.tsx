'use client'

/**
 * LayoutIssuedPanel — per-tenant layout-issued panel.
 *
 * Renders:
 *   1. READ-ONLY layout status display (auto-derived by the 00118 DB trigger)
 *   2. Layout drawings (managed set via TenantDocumentList)
 *
 * Status is auto-derived from document/revision presence by the DB trigger.
 * Manual status/date controls were removed — setting them directly conflicted
 * with the trigger (spec §3.3).
 *
 * This is an "inline expand" panel — ScheduleTable renders it in a full-width
 * row below the tenant row when the user clicks the layout edit button.
 */

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
  layoutDetails,
  onClose,
}: Props) {
  const status = layoutDetails?.layout_status ?? 'not_issued'
  const issuedAt = layoutDetails?.layout_issued_at ?? null

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

      {/* ── Controls: status display + drawing ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        {/* Status display (read-only — auto-derived by DB trigger) */}
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
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 12px',
              borderRadius: 5,
              border: '1px solid',
              fontSize: 12,
              fontWeight: 600,
              background:
                status === 'issued' ? 'var(--c-green-dim)' : 'var(--c-amber-dim)',
              borderColor:
                status === 'issued' ? 'var(--c-green)' : 'var(--c-amber)',
              color:
                status === 'issued' ? 'var(--c-green)' : 'var(--c-amber)',
            }}
          >
            {status === 'issued' ? 'Issued' : 'Not Issued'}
            {issuedAt && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  opacity: 0.85,
                }}
              >
                {issuedAt}
              </span>
            )}
          </div>
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
