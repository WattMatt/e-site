'use client'
/**
 * Baselines (spec §14.1): save the current schedule (name + description),
 * list, compare. Saving and deleting need Edit and are not rendered below it;
 * delete is the two-step inline confirm.
 */
import { useState } from 'react'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import type { ScheduleBaselineSummary } from '@/lib/solar/schedule/types'
import { POPOVER } from './popover-style'

function BaselineRow({ b, canEdit, onDelete }: { b: ScheduleBaselineSummary; canEdit: boolean; onDelete: (id: string) => void }) {
  const { armed, arm, disarm } = useArmedConfirm()
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span title={b.description ?? undefined}>{b.name} <span style={{ color: 'var(--c-text-dim)' }}>{b.createdAt.slice(0, 10)}</span></span>
      {canEdit && (armed
        ? <button type="button" aria-label={`Confirm delete ${b.name}`} onClick={() => { disarm(); onDelete(b.id) }} style={{ color: 'var(--c-red)' }}>Delete?</button>
        : <button type="button" aria-label={`Delete baseline ${b.name}`} onClick={arm}>×</button>)}
    </li>
  )
}

export interface BaselineMenuProps {
  canEdit: boolean
  baselines: ScheduleBaselineSummary[]
  compareId: string | null
  onCompare: (id: string | null) => void
  /** Resolves to an error sentence, or null when saved. */
  onSave: (name: string, description: string) => Promise<string | null>
  onDelete: (id: string) => void
}

export function BaselineMenu({ canEdit, baselines, compareId, onCompare, onSave, onDelete }: BaselineMenuProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Baselines</button>
      {open && (
        <div role="dialog" aria-label="Baselines" style={{ ...POPOVER, right: 0, width: 300 }}>
          {baselines.length === 0
            ? <div style={{ color: 'var(--c-text-dim)' }}>No baselines saved yet.</div>
            : (
              <label style={{ display: 'block' }}>Compare with{' '}
                <select aria-label="Compare with" value={compareId ?? ''} onChange={(e) => onCompare(e.target.value || null)}>
                  <option value="">No comparison</option>
                  {baselines.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {baselines.map((b) => <BaselineRow key={b.id} b={b} canEdit={canEdit} onDelete={onDelete} />)}
          </ul>
          {canEdit && (
            <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
              <label style={{ display: 'block' }}>Baseline name <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
              <label style={{ display: 'block' }}>Baseline description <input value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} /></label>
              <button type="button" disabled={!name.trim()} onClick={async () => {
                const err = await onSave(name.trim(), desc.trim())
                setMsg(err ?? 'Baseline saved.')
                if (!err) { setName(''); setDesc('') }
              }}>Save current as baseline</button>
            </div>
          )}
          {msg && <div role="status">{msg}</div>}
        </div>
      )}
    </div>
  )
}
