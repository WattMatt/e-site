'use client'

/**
 * RateCell — inline-editable supply / install / single rate for one BOQ line
 * item. Click the value to edit; Enter or blur commits, Escape cancels.
 *
 * On commit it calls updateBoqItemRateAction and OPTIMISTICALLY recomputes the
 * row amount via the shared computeItemAmount (single source of the amount rule),
 * lifting it to the parent table through onCommitted so the section/bill rollups
 * update without a server round-trip. On failure it reverts and shows an inline
 * error.
 *
 * Read-only callers (canEdit=false) never render this — BoqLineItemTable renders
 * a plain number instead.
 */

import { useState } from 'react'
import { computeItemAmount, type BoqItem } from '@esite/shared'
import { updateBoqItemRateAction } from '@/actions/boq.actions'
import { fmtMoney } from './format'

type RateField = 'supplyRate' | 'installRate' | 'rate'

interface Props {
  item: BoqItem
  projectId: string
  field: RateField
  /** Called with the server-confirmed item so the parent can refresh the row + rollups. */
  onCommitted: (item: BoqItem) => void
}

export function RateCell({ item, projectId, field, onCommitted }: Props) {
  const current = item[field]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(current === null ? '' : String(current))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit() {
    setDraft(current === null ? '' : String(current))
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function commit() {
    const trimmed = draft.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
      setError('Enter a non-negative number')
      return
    }
    // No change → just close.
    if (parsed === current) {
      setEditing(false)
      return
    }

    setSaving(true)
    setError(null)
    const res = await updateBoqItemRateAction(projectId, item.id, { [field]: parsed })
    setSaving(false)

    if ('error' in res) {
      setError(res.error)
      return
    }
    setEditing(false)
    onCommitted(res.data.item)
  }

  // Optimistic preview of the amount this edit would produce (display only).
  const previewAmount = (() => {
    if (!editing) return null
    const trimmed = draft.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) return null
    return computeItemAmount({ ...item, [field]: parsed })
  })()

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        title="Click to edit"
        style={{
          background: 'none',
          border: 'none',
          borderBottom: '1px dashed var(--c-border-hi, var(--c-border))',
          cursor: 'pointer',
          padding: '1px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: current === null ? 'var(--c-text-dim)' : 'var(--c-text-mid)',
        }}
      >
        {current === null ? '—' : fmtMoney(current)}
      </button>
    )
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <input
        type="number"
        step="0.0001"
        min="0"
        autoFocus
        value={draft}
        disabled={saving}
        aria-label="Rate"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        onBlur={() => { if (!saving) void commit() }}
        style={{
          width: 90,
          background: 'var(--c-base, var(--c-panel))',
          border: '1px solid var(--c-amber)',
          borderRadius: 4,
          padding: '3px 6px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--c-text)',
          textAlign: 'right',
        }}
      />
      {error ? (
        <span role="alert" style={{ fontSize: 10, color: 'var(--c-red)' }}>{error}</span>
      ) : (
        previewAmount !== null && (
          <span style={{ fontSize: 10, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
            = {fmtMoney(previewAmount)}
          </span>
        )
      )}
    </span>
  )
}
