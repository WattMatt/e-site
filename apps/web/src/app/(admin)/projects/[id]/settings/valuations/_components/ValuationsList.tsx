'use client'

/**
 * ValuationsList — the valuation sequence (the dated-event list).
 *
 * Mirrors the snag VisitList pattern: a header strip with a count + a "New
 * valuation" inline form, then a list of selectable rows. Each row shows the
 * valuation number, date, a draft/certified status badge, and (for certified
 * valuations) the frozen total due incl-VAT. Selecting a row raises onSelect so
 * the parent tab can load + show its detail.
 *
 * New valuation: a single date picker → createValuationAction. The action reads
 * the project's retention_pct + current BOQ import server-side; the first
 * valuation carries nothing forward, later ones inherit the prior progress.
 */

import { useState } from 'react'
import type { Valuation } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { createValuationAction } from '@/actions/valuation.actions'
import { fmtMoney } from '../../rates/_components/format'

interface Props {
  projectId: string
  valuations: Valuation[]
  canEdit: boolean
  selectedId: string | null
  onSelect: (valuationId: string) => void
  /** Called after a successful create so the parent can refresh the list. */
  onCreated: () => void
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

const FIELD_LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
  marginBottom: 6,
  textTransform: 'uppercase',
}
const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--c-panel-deep)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--c-text)',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

export function ValuationsList({ projectId, valuations, canEdit, selectedId, onSelect, onCreated }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setSubmitting(true)
    setError(null)
    const res = await createValuationAction(projectId, date)
    setSubmitting(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setShowForm(false)
    setDate(todayISO())
    onCreated()
    onSelect(res.data.valuation.id)
  }

  return (
    <div>
      {/* Header strip: count + New valuation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.04em' }}>
          {valuations.length} valuation{valuations.length !== 1 ? 's' : ''}
        </span>
        {canEdit && !showForm && (
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
            + New valuation
          </Button>
        )}
      </div>

      {/* Inline create form */}
      {showForm && (
        <div
          style={{
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border-mid)',
            borderRadius: 8,
            padding: '20px 24px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={FIELD_LABEL} htmlFor="val_date">Valuation date</label>
              <input
                id="val_date"
                type="date"
                style={FIELD_INPUT}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setError(null) }}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" isLoading={submitting} disabled={submitting} onClick={handleCreate}>
                {submitting ? 'Creating…' : 'Create valuation'}
              </Button>
            </div>
          </div>
          {error && (
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)', border: '1px solid #6b1e1e', borderRadius: 6, padding: '8px 12px' }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* List */}
      {valuations.length === 0 && !showForm ? (
        <div
          className="data-panel"
          style={{ padding: '48px 18px', textAlign: 'center', color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        >
          No valuations yet{canEdit ? ' — create the first one above.' : '.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {valuations.map((v) => (
            <ValuationRow
              key={v.id}
              valuation={v}
              selected={v.id === selectedId}
              onSelect={() => onSelect(v.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ValuationRow({
  valuation,
  selected,
  onSelect,
}: {
  valuation: Valuation
  selected: boolean
  onSelect: () => void
}) {
  const certified = valuation.status === 'certified'
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        background: 'var(--c-panel)',
        border: `1px solid ${selected ? 'var(--c-amber)' : 'var(--c-border)'}`,
        borderRadius: 8,
        padding: '14px 18px',
        transition: 'border-color 0.12s',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
          Valuation No. {valuation.valuationNo}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {certified ? <Badge variant="success">certified</Badge> : <Badge variant="warning">draft</Badge>}
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--c-text-dim)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0 14px',
          alignItems: 'center',
        }}
      >
        <span>{fmtDate(valuation.valuationDate)}</span>
        {certified && valuation.dueInclVat != null && (
          <span>Due incl-VAT {fmtMoney(valuation.dueInclVat)}</span>
        )}
      </div>
    </button>
  )
}
