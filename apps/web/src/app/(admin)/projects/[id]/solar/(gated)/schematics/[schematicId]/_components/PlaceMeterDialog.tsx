'use client'
/** Place meter (spec §13.2 "P"): pick an unplaced study meter, or create a stub for an unmetered point. */
import { useState } from 'react'
import { createMeterStubAction } from '@/actions/solar-schematics.actions'
import { METER_KIND_OPTIONS, type MeterKind } from '@/lib/solar/load/view-types'
import type { EditorMeter } from '@/lib/solar/schematics/view-types'

export function PlaceMeterDialog({ projectId, unplaced, onPick, onCreated, onClose }: {
  projectId: string; unplaced: EditorMeter[]; onPick: (meterId: string) => void; onCreated: (m: EditorMeter) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<MeterKind>('unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shown = unplaced.filter((m) => `${m.label} ${m.tenantLabel ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div role="dialog" aria-modal="true" aria-label="Place meter" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, padding: 24 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, fontSize: 13, display: 'grid', gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Place meter</h2>
        <input aria-label="Filter meters" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        {unplaced.length === 0 ? <p style={{ margin: 0 }}>Every study meter is on this schematic.</p>
          : shown.length === 0 ? <p style={{ margin: 0 }}>No unplaced meter matches.</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 280, overflow: 'auto' }}>
            {shown.map((m) => (
              <li key={m.id}><button type="button" onClick={() => onPick(m.id)} style={{ width: '100%', textAlign: 'left' }}>
                {m.label} · {m.kind}{m.tenantLabel ? ` · ${m.tenantLabel}` : ''}
              </button></li>
            ))}
          </ul>
        )}
        <fieldset style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
          <legend>Create meter (unmetered point)</legend>
          <input aria-label="New meter label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. DB-4 incomer" maxLength={120} />{' '}
          <select aria-label="New meter kind" value={kind} onChange={(e) => setKind(e.target.value as MeterKind)}>
            {METER_KIND_OPTIONS.filter((k) => k.value !== 'water').map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>{' '}
          <button type="button" disabled={busy || !label.trim()} onClick={async () => {
            setBusy(true); setError(null)
            const r = await createMeterStubAction({ projectId, label: label.trim(), kind })
            setBusy(false)
            if ('error' in r) { setError(r.error); return }
            onCreated({ id: r.meter.id, label: r.meter.label, kind: r.meter.kind, tenantLabel: null, nodeId: null, included: null })
          }}>{busy ? 'Creating…' : 'Create meter'}</button>
        </fieldset>
        {error && <p role="alert" style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ textAlign: 'right' }}><button type="button" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}
