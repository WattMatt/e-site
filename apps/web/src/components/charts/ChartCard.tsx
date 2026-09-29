'use client'
import { useRef, useState, type ReactNode } from 'react'
import { downloadChartPng } from './export'

/** A titled chart with "Download PNG" (client) and "Download CSV" (a server route at full resolution). */
export function ChartCard({ title, pngName, csvHref, children }: { title: string; pngName: string; csvHref?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <section style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, background: 'var(--c-panel)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</h3>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 12 }}>
          <button type="button" disabled={busy} onClick={async () => { if (!ref.current) return; setBusy(true); try { await downloadChartPng(ref.current, pngName) } finally { setBusy(false) } }}>
            {busy ? 'Preparing…' : 'Download PNG'}
          </button>
          {csvHref && <a href={csvHref} download>Download CSV</a>}
        </span>
      </header>
      <div ref={ref}>{children}</div>
    </section>
  )
}
