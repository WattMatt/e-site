'use client'

/** The plan's live legend: every entry with its count, total measured area, and what needs attention. */
import { SCHEMATIC_LEGEND, TENANT_LEGEND, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { measuredGlaText, swatchCss, type AttentionItem, type LegendSummary } from '@/lib/status-plans/shape-view'

export interface PlanLegendProps {
  purpose: StatusPlanPurpose
  summary: LegendSummary
  hasScale: boolean
  attention: AttentionItem[]
  onSelectShape: (shapeId: string) => void
}

export function PlanLegend({ purpose, summary, hasScale, attention, onSelectShape }: PlanLegendProps) {
  const legend = purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND
  return (
    <div className="data-panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 13 }}>Legend</h2>
      <ul aria-label="Legend entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {legend.map((e) => (
          <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span aria-hidden style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(e.style) }} />
            <span style={{ flex: 1 }}>{e.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{summary.counts[e.key] ?? 0}</span>
          </li>
        ))}
      </ul>
      {purpose === 'tenant_layout' && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-mid)' }}>
          {hasScale
            ? measuredGlaText(summary.totalM2, summary.unmeasured)
            : 'Set the page scale to measure areas.'}
        </p>
      )}
      {attention.length > 0 && (
        <div>
          <h3 style={{ margin: '4px 0', fontSize: 12, color: 'var(--c-amber)' }}>Needs attention ({attention.length})</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {attention.map((a) => (
              <li key={a.shapeId}>
                <button type="button" onClick={() => onSelectShape(a.shapeId)} style={{ textAlign: 'left', fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                  <strong>{a.label}</strong> — {a.reason}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
