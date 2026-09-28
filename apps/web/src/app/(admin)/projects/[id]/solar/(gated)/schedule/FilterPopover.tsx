'use client'
/**
 * Filters popover (spec §14.1): status, owner, colour; presets saved to the
 * database per user. Owner options are exactly the `owners` prop — the
 * loader's Solar-eligible list (owner decision Q4), never raw members. Colour
 * options are the colours IN USE (WM offered 8 fixed ones, so 12 of its 20
 * import colours could not be filtered).
 */
import { useState } from 'react'
import { EMPTY_SCHEDULE_FILTERS, GANTT_STATUSES, GANTT_STATUS_LABELS, filterCount, type ScheduleFilters } from '@esite/shared'
import type { ScheduleOwner, SchedulePreset } from '@/lib/solar/schedule/types'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { POPOVER } from './popover-style'

const toggle = <T,>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

function PresetRow({ p, onApply, onDelete }: { p: SchedulePreset; onApply: (id: string) => void; onDelete: (id: string) => void }) {
  const { armed, arm, disarm } = useArmedConfirm()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
      <button type="button" onClick={() => onApply(p.id)}>{p.name}</button>
      {armed
        ? <button type="button" aria-label={`Confirm delete preset ${p.name}`} onClick={() => { disarm(); onDelete(p.id) }} style={{ color: 'var(--c-red)' }}>Delete?</button>
        : <button type="button" aria-label={`Delete preset ${p.name}`} onClick={arm}>×</button>}
    </div>
  )
}

export interface FilterPopoverProps {
  filters: ScheduleFilters
  onFilters: (f: ScheduleFilters) => void
  owners: ScheduleOwner[]
  colours: string[]
  presets: SchedulePreset[]
  onApplyPreset: (id: string) => void
  /** Resolves to an error sentence, or null when saved. */
  onSavePreset: (name: string) => Promise<string | null>
  onDeletePreset: (id: string) => void
}

export function FilterPopover({ filters, onFilters, owners, colours, presets, onApplyPreset, onSavePreset, onDeletePreset }: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const n = filterCount(filters)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{n ? `Filters (${n})` : 'Filters'}</button>
      {open && (
        <div role="dialog" aria-label="Filters" style={{ ...POPOVER, left: 0, width: 280 }}>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}><legend style={{ fontWeight: 600 }}>Status</legend>
            {GANTT_STATUSES.map((s) => (
              <label key={s} style={{ display: 'block' }}>
                <input type="checkbox" checked={filters.statuses.includes(s)} onChange={() => onFilters({ ...filters, statuses: toggle(filters.statuses, s) })} /> {GANTT_STATUS_LABELS[s]}
              </label>
            ))}
          </fieldset>
          {owners.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}><legend style={{ fontWeight: 600 }}>Owner</legend>
              {owners.map((o) => (
                <label key={o.id} style={{ display: 'block' }}>
                  <input type="checkbox" data-owner={o.id} checked={filters.ownerIds.includes(o.id)} onChange={() => onFilters({ ...filters, ownerIds: toggle(filters.ownerIds, o.id) })} /> {o.name}
                </label>
              ))}
            </fieldset>
          )}
          {colours.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}><legend style={{ fontWeight: 600 }}>Colour</legend>
              {colours.map((c) => (
                <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
                  <input type="checkbox" aria-label={c} checked={filters.colours.includes(c)} onChange={() => onFilters({ ...filters, colours: toggle(filters.colours, c) })} />
                  <span style={{ width: 12, height: 12, background: c, display: 'inline-block', borderRadius: 2 }} />
                </label>
              ))}
            </fieldset>
          )}
          <button type="button" onClick={() => onFilters({ ...EMPTY_SCHEDULE_FILTERS })}>Clear all</button>
          <div style={{ marginTop: 8, borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
            <div style={{ fontWeight: 600 }}>My presets</div>
            {presets.length === 0 && <div style={{ color: 'var(--c-text-dim)' }}>No saved presets yet.</div>}
            {presets.map((p) => <PresetRow key={p.id} p={p} onApply={onApplyPreset} onDelete={onDeletePreset} />)}
            <label style={{ display: 'block', marginTop: 6 }}>Preset name <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
            <button type="button" disabled={!name.trim()} onClick={async () => {
              const err = await onSavePreset(name.trim())
              setMsg(err ?? 'Preset saved.')
              if (!err) setName('')
            }}>Save as preset</button>
            {msg && <div role="status">{msg}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
