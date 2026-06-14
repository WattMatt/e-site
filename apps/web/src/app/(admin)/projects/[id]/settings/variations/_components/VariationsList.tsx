'use client'

/**
 * VariationsList — the variation-order sequence (the dated-event list).
 *
 * Mirrors ValuationsList: a header strip with a count + a "New VO" inline form,
 * then a list of selectable rows. Each row shows the VO number, title, date, a
 * draft/approved status badge, and (for approved VOs) the frozen net change
 * coloured ± (green up / red down). Selecting a row raises onSelect so the
 * parent tab can load + show its detail.
 *
 * New VO: date + title + optional reason → createVariationOrderAction. The
 * action binds the VO to the project's current BOQ import server-side.
 */

import { useState } from 'react'
import type { VariationOrder } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { createVariationOrderAction } from '@/actions/variation.actions'
import { fmtMoney } from '../../rates/_components/format'

interface Props {
  projectId: string
  vos: VariationOrder[]
  canEdit: boolean
  selectedId: string | null
  onSelect: (voId: string) => void
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

/** Signed money, coloured: positive green with a leading +, negative red. */
export function NetChange({ value }: { value: number }) {
  const negative = value < 0
  return (
    <span style={{ color: negative ? 'var(--c-red)' : 'var(--c-green)', fontFamily: 'var(--font-mono)' }}>
      {negative ? '−' : '+'}{fmtMoney(Math.abs(value))}
    </span>
  )
}

export function VariationsList({ projectId, vos, canEdit, selectedId, onSelect, onCreated }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!title.trim()) {
      setError('A title is required')
      return
    }
    setSubmitting(true)
    setError(null)
    const res = await createVariationOrderAction(projectId, {
      voDate: date,
      title: title.trim(),
      reason: reason.trim() || null,
    })
    setSubmitting(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setShowForm(false)
    setDate(todayISO())
    setTitle('')
    setReason('')
    onCreated()
    onSelect(res.data.vo.id)
  }

  return (
    <div>
      {/* Header strip: count + New VO */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.04em' }}>
          {vos.length} variation order{vos.length !== 1 ? 's' : ''}
        </span>
        {canEdit && !showForm && (
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
            + New VO
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
            <div style={{ flex: '0 1 170px' }}>
              <label style={FIELD_LABEL} htmlFor="vo_date">VO date</label>
              <input
                id="vo_date"
                type="date"
                style={FIELD_INPUT}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <label style={FIELD_LABEL} htmlFor="vo_title">Title</label>
              <input
                id="vo_title"
                type="text"
                style={FIELD_INPUT}
                placeholder="e.g. Remeasure — Level 2 small power"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <label style={FIELD_LABEL} htmlFor="vo_reason">Reason (optional)</label>
              <input
                id="vo_reason"
                type="text"
                style={FIELD_INPUT}
                placeholder="e.g. Client instruction CI-014"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setError(null) }}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" isLoading={submitting} disabled={submitting} onClick={handleCreate}>
                {submitting ? 'Creating…' : 'Create VO'}
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
      {vos.length === 0 && !showForm ? (
        <div
          className="data-panel"
          style={{ padding: '48px 18px', textAlign: 'center', color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        >
          No variation orders yet{canEdit ? ' — create the first one above.' : '.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {vos.map((vo) => (
            <VariationRow
              key={vo.id}
              vo={vo}
              selected={vo.id === selectedId}
              onSelect={() => onSelect(vo.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VariationRow({
  vo,
  selected,
  onSelect,
}: {
  vo: VariationOrder
  selected: boolean
  onSelect: () => void
}) {
  const approved = vo.status === 'approved'
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
          VO {vo.voNo} · {vo.title}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {approved ? <Badge variant="success">approved</Badge> : <Badge variant="warning">draft</Badge>}
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
        <span>{fmtDate(vo.voDate)}</span>
        {approved && vo.netChange != null && (
          <span>
            Net change <NetChange value={vo.netChange} />
          </span>
        )}
      </div>
    </button>
  )
}
