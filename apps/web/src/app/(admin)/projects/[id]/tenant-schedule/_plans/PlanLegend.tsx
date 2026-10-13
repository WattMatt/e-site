'use client'

/**
 * The plan's live legend: every entry with its count on THIS sheet and, when
 * the plan has more than one sheet, across ALL sheets; measured area; and what
 * needs attention on this sheet.
 */
import { SCHEMATIC_LEGEND, TENANT_LEGEND, type StatusPlanPurpose } from '@esite/shared/status-plans'
import type { BoardLegendRow } from '@/lib/status-plans/board-view'
import { measuredGlaText, swatchCss, type AttentionItem, type LegendSummary } from '@/lib/status-plans/shape-view'

export interface PlanLegendProps {
  purpose: StatusPlanPurpose
  /** This sheet. */
  summary: LegendSummary
  /** Every sheet of the plan; shown as a second column when sheetCount > 1. */
  planSummary?: LegendSummary | null
  sheetCount?: number
  hasScale: boolean
  attention: AttentionItem[]
  onSelectShape: (shapeId: string) => void
  /** Board mode: these rows replace the status entries. */
  board?: { rows: BoardLegendRow[]; planRows: BoardLegendRow[] | null; revisionCode: string } | null
}

const mono = { fontFamily: 'var(--font-mono)', minWidth: 28, textAlign: 'right' } as const

export function PlanLegend({ purpose, summary, planSummary = null, sheetCount = 1, hasScale, attention, onSelectShape, board = null }: PlanLegendProps) {
  const legend = purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND
  const showPlan = planSummary !== null && sheetCount > 1
  return (
    <div className="data-panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 13, flex: 1 }}>Legend</h2>
        {showPlan && (
          <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>this sheet · all {sheetCount}</span>
        )}
      </div>
      {board ? (
        <>
          <ul aria-label="Legend entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {board.rows.map((r, i) => (
              <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span aria-hidden style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(r.style) }} />
                <span style={{ flex: 1 }}>
                  {r.label}
                  {r.m2 !== null && <span style={{ color: 'var(--c-text-dim)' }}> · {r.m2.toFixed(1)} m²</span>}
                </span>
                <span style={mono}>{r.count}</span>
                {showPlan && <span style={{ ...mono, color: 'var(--c-text-dim)' }} title="All sheets">{board.planRows?.[i]?.count ?? 0}</span>}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--c-text-dim)' }}>
            Coloured by the main board that feeds each shop, from cable schedule {board.revisionCode}.
          </p>
        </>
      ) : (
        <ul aria-label="Legend entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {legend.map((e) => (
            <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span aria-hidden style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(e.style) }} />
              <span style={{ flex: 1 }}>{e.label}</span>
              <span style={mono}>{summary.counts[e.key] ?? 0}</span>
              {showPlan && <span style={{ ...mono, color: 'var(--c-text-dim)' }} title="All sheets">{planSummary!.counts[e.key] ?? 0}</span>}
            </li>
          ))}
        </ul>
      )}
      {purpose === 'tenant_layout' && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-mid)' }}>
          {hasScale
            ? measuredGlaText(summary.totalM2, summary.unmeasured)
            : 'Set this sheet’s scale to measure areas.'}
        </p>
      )}
      {purpose === 'tenant_layout' && showPlan && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-mid)' }}>
          All sheets: {measuredGlaText(planSummary!.totalM2, planSummary!.unmeasured)}
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
