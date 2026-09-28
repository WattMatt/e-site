'use client'
/** Summary (functional spec §6.4). Computed from the CURRENT (unsaved) objects so it moves as you draw. */
import { layoutSummary, type DesignConditions, type LayoutObject } from '@esite/shared'

export function SummaryPanel({ objects, conditions, onDownloadBom, fallbackPpm = null }: {
  objects: LayoutObject[]; conditions: DesignConditions; layoutName: string; onDownloadBom(): void
  /** The sheet's current scale, for objects not yet saved (no stamped scale). */
  fallbackPpm?: number | null
}) {
  const s = layoutSummary(objects, conditions, fallbackPpm)
  const row = (k: string, v: string) => <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--c-text-dim)' }}>{k}</span><span>{v}</span></div>
  return (
    <section aria-label="Summary" style={{ fontSize: 13, display: 'grid', gap: 4 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600 }}>Summary</h3>
      {row('DC', `${s.dcKwp.toFixed(2)} kWp`)}
      {row('AC', `${s.acKw.toFixed(1)} kW`)}
      {row('DC/AC', s.dcAcRatio === null ? '—' : s.dcAcRatio.toFixed(2))}
      {row('Modules', `${s.moduleCount} modules`)}
      {s.modulesByType.map((t) => row(`· ${t.label}`, `${t.count}`))}
      {row('Inverters', String(s.inverterCount))}
      {row('Strings', `${s.strings.pass} pass · ${s.strings.warn} warn · ${s.strings.fail} fail`)}
      {row('Unstrung modules', String(s.unstrungModules))}
      {row('Roof utilisation', s.utilisationPct === null ? '—' : `${s.utilisationPct.toFixed(1)} %`)}
      {s.arraysOutsideRoof.length > 0 && <p role="alert" style={{ color: '#dc2626' }}>An array lies outside every roof area.</p>}
      <button type="button" onClick={onDownloadBom}>Download BOM CSV</button>
      <button type="button" disabled title="Cases arrive with Yield & Scenarios.">Push to case</button>
    </section>
  )
}
