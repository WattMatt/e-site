'use client'
/** Assign meters to a tenant (spec §4.4): tenant series = Σ (weight × meter series) — summed, weighted, explicit. */
import { useState } from 'react'
import type { MeterKind } from '@/lib/solar/load/view-types'

const NOT_LOAD: MeterKind[] = ['solar', 'generator', 'check', 'water']

export function AssignMetersDialog({ tenantLabel, meters, initial, onUse, onClose }: {
  tenantLabel: string
  meters: Array<{ id: string; label: string; kind: MeterKind }>
  initial: Array<{ meterId: string; weight: number }>
  onUse: (m: Array<{ meterId: string; weight: number }>) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Map<string, string>>(new Map(initial.map((m) => [m.meterId, String(m.weight)])))
  const weights = [...picked.values()].map((w) => (w.trim() === '' ? NaN : Number(w)))
  const bad = weights.some((w) => !(Number.isFinite(w) && w > 0))
  const sum = bad ? null : weights.reduce((a, b) => a + b, 0)
  const usable = meters.filter((m) => !NOT_LOAD.includes(m.kind))
  return (
    <div role="dialog" aria-modal="true" aria-label={`Assign meters to ${tenantLabel}`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 520, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Meters for {tenantLabel}</h2>
        {usable.length === 0 && <p>No load meters in this study — import them on Meters.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {usable.map((m) => (
            <li key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
              <label style={{ flex: 1 }}>
                <input type="checkbox" checked={picked.has(m.id)} onChange={(e) => setPicked((p) => { const n = new Map(p); if (e.target.checked) n.set(m.id, '1'); else n.delete(m.id); return n })} /> {m.label}
              </label>
              {picked.has(m.id) && (
                <input aria-label={`Weight for ${m.label}`} inputMode="decimal" value={picked.get(m.id)} style={{ width: 70 }}
                  onChange={(e) => setPicked((p) => new Map(p).set(m.id, e.target.value))} />
              )}
            </li>
          ))}
        </ul>
        <p style={{ margin: '6px 0' }}>
          {bad ? <span role="alert" style={{ color: '#dc2626' }}>Every weight must be greater than 0.</span> : `Sum of weights: ${(sum ?? 0).toFixed(2)}`}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={bad || picked.size === 0} onClick={() => onUse([...picked].map(([meterId, w]) => ({ meterId, weight: Number(w) })))}>Use these meters</button>
        </div>
      </div>
    </div>
  )
}
