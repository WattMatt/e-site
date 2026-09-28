'use client'
/** Auto-match review (spec §4.4): proposals with confidence and source; the user ticks and applies. LLM/UNMAPPED rows never arrive pre-ticked. */
import { useState } from 'react'
import type { AutoMatchView } from '@/lib/solar/load/view-types'

export function AutoMatchDialog({ proposals, busy, error, onApply, onClose }: {
  proposals: AutoMatchView[]; busy: boolean; error: string | null
  onApply: (pairs: Array<{ nodeId: string; meterId: string }>) => void; onClose: () => void
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set(proposals.filter((p) => p.preTicked).map((p) => p.meterId)))
  const n = ticked.size
  return (
    <div role="dialog" aria-modal="true" aria-label="Auto-match meters" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Auto-match meters to tenants</h2>
        {proposals.length === 0 ? <p>No unassigned meter matches a tenant by register, serial, shop number or name.</p> : (
          <ul style={{ listStyle: 'none', padding: 0, maxHeight: 420, overflow: 'auto' }}>
            {proposals.map((p) => (
              <li key={p.meterId} style={{ padding: '3px 0' }}>
                <label>
                  <input type="checkbox" checked={ticked.has(p.meterId)} onChange={(e) => setTicked((t) => { const s = new Set(t); if (e.target.checked) s.add(p.meterId); else s.delete(p.meterId); return s })} />
                  {' '}{p.meterLabel} → {p.nodeLabel}
                </label>
                <span style={{ marginLeft: 8, fontSize: 12, color: p.confidence === 'low' ? '#b45309' : 'var(--c-text-mid)' }}>{p.confidence} · {p.source.replace('_', ' ')} · {p.note}</span>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" disabled={busy || n === 0} onClick={() => onApply(proposals.filter((p) => ticked.has(p.meterId)).map((p) => ({ nodeId: p.nodeId, meterId: p.meterId })))}>
            {busy ? 'Applying…' : `Apply ${n} pair${n === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
