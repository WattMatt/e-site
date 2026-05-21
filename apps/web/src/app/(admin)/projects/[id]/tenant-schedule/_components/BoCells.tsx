'use client'

/**
 * BoCells — inline Tenant Schedule cells for beneficial-occupation tracking.
 *
 *   BoPeriodSelect : sets a tenant's bo_period_days (90/60/45/30 or custom).
 *   BoDateCell     : shows the effective BO date and lets the user pin or clear
 *                    a per-tenant override of the computed date.
 *
 * Both write through setTenantBoAction; the page recomputes dates on
 * revalidation, so the two cells stay consistent without client coordination.
 */

import { useState, useTransition } from 'react'
import { setTenantBoAction } from '@/actions/tenant-bo.actions'

/** Per-tenant BO data the page computes and hands to the schedule table. */
export interface TenantBoInfo {
  boPeriodDays: number | null
  boDateOverride: string | null
  /** bo_date_override ?? (opening_date − bo_period_days) — the tenant's BO date. */
  effectiveDate: string | null
}

/** Standard BO periods (days before opening). Larger tenants take longer. */
const PERIOD_PRESETS = [90, 60, 45, 30]

const cellInput: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 5,
  border: '1px solid var(--c-border)',
  background: 'var(--c-panel)',
  color: 'var(--c-text)',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  padding: '1px 4px',
  color: 'var(--c-amber)',
}

// ─────────────────────────────────────────────────────────────────────────────
// BoPeriodSelect
// ─────────────────────────────────────────────────────────────────────────────

export function BoPeriodSelect({
  projectId,
  nodeId,
  value,
}: {
  projectId: string
  nodeId: string
  value: number | null
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Custom mode is on when a value is set that is not one of the presets.
  const [customMode, setCustomMode] = useState(value != null && !PERIOD_PRESETS.includes(value))

  function save(next: number | null) {
    setError(null)
    startTransition(async () => {
      const res = await setTenantBoAction(projectId, nodeId, { boPeriodDays: next })
      if ('error' in res) setError(res.error)
    })
  }

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value
    if (v === 'custom') {
      setCustomMode(true)
      return
    }
    setCustomMode(false)
    save(v === '' ? null : Number(v))
  }

  function handleCustomCommit(e: React.FocusEvent<HTMLInputElement>) {
    const raw = e.target.value.trim()
    if (raw === '') {
      save(null)
      return
    }
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) save(Math.round(n))
  }

  const selectValue = customMode ? 'custom' : value == null ? '' : String(value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
      <select
        value={selectValue}
        onChange={handleSelect}
        disabled={isPending}
        style={{ ...cellInput, cursor: isPending ? 'default' : 'pointer' }}
        aria-label="BO period (days before opening)"
      >
        <option value="">—</option>
        {PERIOD_PRESETS.map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {customMode && (
        <input
          type="number"
          min={1}
          defaultValue={value ?? ''}
          onBlur={handleCustomCommit}
          disabled={isPending}
          placeholder="days"
          style={{ ...cellInput, width: 72 }}
          aria-label="Custom BO period in days"
        />
      )}
      {error && <span style={{ fontSize: 10, color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BoDateCell
// ─────────────────────────────────────────────────────────────────────────────

export function BoDateCell({
  projectId,
  nodeId,
  effectiveDate,
  isOverride,
}: {
  projectId: string
  nodeId: string
  effectiveDate: string | null
  isOverride: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  function saveOverride(next: string | null) {
    setError(null)
    startTransition(async () => {
      const res = await setTenantBoAction(projectId, nodeId, { boDateOverride: next })
      if ('error' in res) setError(res.error)
      else setEditing(false)
    })
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
        <input
          type="date"
          defaultValue={effectiveDate ?? ''}
          disabled={isPending}
          onChange={(e) => {
            if (e.target.value) saveOverride(e.target.value)
          }}
          style={cellInput}
          aria-label="Override BO date"
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {isOverride && (
            <button type="button" onClick={() => saveOverride(null)} disabled={isPending} style={linkBtn}>
              Use computed
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={isPending}
            style={{ ...linkBtn, color: 'var(--c-text-dim)' }}
          >
            Cancel
          </button>
        </div>
        {error && <span style={{ fontSize: 10, color: 'var(--c-red)' }}>{error}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {effectiveDate ? (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text)' }}>
          {effectiveDate}
        </span>
      ) : (
        <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>—</span>
      )}
      {isOverride && (
        <span
          title="Manually set — overrides the computed date"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'var(--c-amber)',
            textTransform: 'uppercase',
          }}
        >
          set
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{ ...linkBtn, color: 'var(--c-text-dim)' }}
        aria-label="Edit BO date"
      >
        ✎
      </button>
      {error && <span style={{ fontSize: 10, color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
