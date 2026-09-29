'use client'
/**
 * Add / edit / remove one dependency (spec §14.1): FS/SS/FF/SF + lag, all
 * editable after creation (WM could neither edit nor remove a link). Remove is
 * a two-step inline confirm; below Edit the dialog is a read-only summary.
 */
import { useState } from 'react'
import { LINK_TYPES, LINK_TYPE_LABELS, type LinkType } from '@esite/shared'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

export interface LinkDialogProps {
  title: string
  initialType: LinkType
  initialLag: number
  canEdit: boolean
  isNew: boolean
  onSave: (type: LinkType, lagDays: number) => void
  onRemove: () => void
  onClose: () => void
}

export function LinkDialog({ title, initialType, initialLag, canEdit, isNew, onSave, onRemove, onClose }: LinkDialogProps) {
  const [type, setType] = useState<LinkType>(initialType)
  const [lag, setLag] = useState(String(initialLag))
  const [error, setError] = useState<string | null>(null)
  const rm = useArmedConfirm()
  return (
    <div role="dialog" aria-modal="true" aria-label="Dependency" style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', padding: 16, borderRadius: 8, width: 380, maxWidth: 'calc(100vw - 32px)', fontSize: 13, display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
        {canEdit ? (
          <>
            <label>Link type{' '}
              <select aria-label="Link type" value={type} onChange={(e) => setType(e.target.value as LinkType)}>
                {LINK_TYPES.map((t) => <option key={t} value={t}>{`${t} — ${LINK_TYPE_LABELS[t]}`}</option>)}
              </select>
            </label>
            <label>Lag (days) <input type="number" value={lag} onChange={(e) => setLag(e.target.value)} /></label>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>A negative lag is a lead. Counted in the schedule’s duration mode.</div>
          </>
        ) : (
          <div>{`${LINK_TYPE_LABELS[initialType]}, lag ${initialLag} ${Math.abs(initialLag) === 1 ? 'day' : 'days'}`}</div>
        )}
        {error && <div role="alert" style={{ color: 'var(--c-red)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {canEdit && !isNew && (rm.armed
            ? <button type="button" onClick={() => { rm.disarm(); onRemove() }}>Confirm remove</button>
            : <button type="button" onClick={rm.arm}>Remove link</button>)}
          <button type="button" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && (
            <button type="button" className="btn-primary-amber" onClick={() => {
              const n = Number(lag)
              if (lag.trim() === '' || !Number.isInteger(n) || Math.abs(n) > 365) {
                setError('Lag must be a whole number of days between -365 and 365.')
                return
              }
              onSave(type, n)
            }}>{isNew ? 'Add link' : 'Save link'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
