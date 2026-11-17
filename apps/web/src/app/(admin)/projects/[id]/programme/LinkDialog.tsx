'use client'

/**
 * One link's details: its type, lag and lag unit, editable with `canEdit`, plus a two-step
 * delete (the first press arms, the second deletes). Read-only shows the same facts with
 * nothing to change. The dialog only builds ops; the timeline sends them through `apply`.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { DependencyRow, ProgrammeOp } from '@esite/shared/programme'

export const LINK_TYPE_LABEL: Record<DependencyRow['type'], string> = {
  FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish', SF: 'Start to finish',
}
export const LAG_UNIT_LABEL: Record<DependencyRow['lag_unit'], string> = {
  working_days: 'Working days', elapsed_days: 'Calendar days', percent: '% of predecessor',
}
const LAG = /^\s*(-?\d{1,5}(?:\.\d{1,2})?)\s*$/

const button: CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)',
  color: 'var(--c-text)', fontSize: 12, cursor: 'pointer',
}
const field: CSSProperties = {
  height: 28, fontSize: 13, padding: '0 6px', borderRadius: 4, border: '1px solid var(--c-border)',
  background: 'var(--c-input-bg)', color: 'var(--c-text)', boxSizing: 'border-box',
}

export interface LinkDialogProps {
  dep: DependencyRow
  predName: string
  succName: string
  canEdit: boolean
  /** Sends ops; returns true when the store took them. */
  onApply: (ops: ProgrammeOp[], label: string) => boolean
  onClose: () => void
}

export function LinkDialog({ dep, predName, succName, canEdit, onApply, onClose }: LinkDialogProps) {
  const [type, setType] = useState(dep.type)
  const [lag, setLag] = useState(String(dep.lag))
  const [unit, setUnit] = useState(dep.lag_unit)
  const [invalid, setInvalid] = useState(false)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = () => {
    const m = LAG.exec(lag)
    if (!m) { setInvalid(true); return }
    const n = Number(m[1])
    const op: Extract<ProgrammeOp, { op: 'upsert_dependency' }> = { op: 'upsert_dependency', id: dep.id }
    if (type !== dep.type) op.type = type
    if (n !== dep.lag) op.lag = n
    if (unit !== dep.lag_unit) op.lag_unit = unit
    if (Object.keys(op).length === 2 || onApply([op], 'Edit link')) onClose()
  }
  const remove = () => {
    if (!armed) { setArmed(true); return }
    if (onApply([{ op: 'delete_dependency', id: dep.id }], 'Delete link')) onClose()
    else setArmed(false)
  }

  const title = `Link ${predName} → ${succName}`
  return (
    <div role="dialog" aria-label={title} data-testid="programme-link-dialog" style={{
      position: 'absolute', top: 52, right: 12, zIndex: 5, width: 280, padding: 12, borderRadius: 8,
      border: '1px solid var(--c-border)', background: 'var(--c-elevated)', color: 'var(--c-text)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.25)', display: 'grid', gap: 8, fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
      {canEdit ? (
        <>
          <label style={{ display: 'grid', gap: 2 }}>
            <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>Type</span>
            <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as DependencyRow['type'])} style={field}>
              {(Object.keys(LINK_TYPE_LABEL) as DependencyRow['type'][]).map((t) => <option key={t} value={t}>{LINK_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <label style={{ display: 'grid', gap: 2, flex: '0 0 80px' }}>
              <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>Lag</span>
              <input aria-label="Lag" aria-invalid={invalid} inputMode="decimal" value={lag}
                onChange={(e) => { setLag(e.target.value); setInvalid(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
                style={{ ...field, width: '100%', borderColor: invalid ? 'var(--c-red)' : 'var(--c-border)' }} />
            </label>
            <label style={{ display: 'grid', gap: 2, flex: '1 1 auto' }}>
              <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>Lag unit</span>
              <select aria-label="Lag unit" value={unit} onChange={(e) => setUnit(e.target.value as DependencyRow['lag_unit'])} style={field}>
                {(Object.keys(LAG_UNIT_LABEL) as DependencyRow['lag_unit'][]).map((u) => <option key={u} value={u}>{LAG_UNIT_LABEL[u]}</option>)}
              </select>
            </label>
          </div>
          {invalid && <span role="status" style={{ color: 'var(--c-red)', fontSize: 12 }}>The lag is a number of days, up to two decimals.</span>}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {armed ? (
              <>
                <button type="button" style={{ ...button, borderColor: 'var(--c-red)', color: 'var(--c-red)' }} onClick={remove}>Confirm delete</button>
                <button type="button" style={button} onClick={() => setArmed(false)}>Cancel</button>
              </>
            ) : (
              <button type="button" style={{ ...button, color: 'var(--c-red)' }} onClick={remove}>Delete link</button>
            )}
            <span style={{ flex: '1 1 auto' }} />
            <button type="button" style={button} onClick={onClose}>Close</button>
            <button type="button" className="btn-primary-amber" onClick={save}>Save</button>
          </div>
        </>
      ) : (
        <>
          <div>{LINK_TYPE_LABEL[dep.type]}, lag {dep.lag} {LAG_UNIT_LABEL[dep.lag_unit].toLowerCase()}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" style={button} onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </div>
  )
}
