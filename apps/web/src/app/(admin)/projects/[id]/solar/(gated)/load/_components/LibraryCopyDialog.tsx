'use client'
/** "Copy from org meter library" (spec §4.3): links a meter already imported for another study — a reference, no data copied. Same-org meters only (RLS + the action). */
import { useState } from 'react'
import { linkLibraryMetersAction, searchLibraryMetersAction, type LibraryMeterHit } from '@/actions/solar-load.actions'

export function LibraryCopyDialog({ projectId, onClose, onLinked }: { projectId: string; onClose: () => void; onLinked: (n: number) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<LibraryMeterHit[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div role="dialog" aria-modal="true" aria-label="Copy from org meter library" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Copy from org meter library</h2>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </header>
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true); setError(null)
          const r = await searchLibraryMetersAction({ projectId, query: q })
          setBusy(false)
          if ('error' in r) setError(r.error); else setHits(r.meters)
        }} style={{ margin: '8px 0' }}>
          <input aria-label="Search the org meter library" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Site, label or serial" style={{ width: '70%' }} />
          <button type="submit" disabled={busy}>Search</button>
        </form>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
        {hits !== null && hits.length === 0 && <p style={{ fontSize: 13 }}>No meters in your organisation's library match — upload the meter files instead.</p>}
        <ul style={{ listStyle: 'none', padding: 0, maxHeight: 360, overflow: 'auto', fontSize: 13 }}>
          {(hits ?? []).map((m) => (
            <li key={m.id}><label>
              <input type="checkbox" checked={picked.has(m.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n })} />
              {' '}{m.label}{m.siteLabel ? ` · ${m.siteLabel}` : ''} · {m.kind}{m.serials.length ? ` · ${m.serials.join(', ')}` : ''}
            </label></li>
          ))}
        </ul>
        <footer style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy || picked.size === 0} onClick={async () => {
            setBusy(true); setError(null)
            const r = await linkLibraryMetersAction({ projectId, meterIds: [...picked] })
            setBusy(false)
            if ('error' in r) setError(r.error); else onLinked(r.linked)
          }}>{busy ? 'Adding…' : `Add ${picked.size} meter${picked.size === 1 ? '' : 's'} to this study`}</button>
        </footer>
      </div>
    </div>
  )
}
