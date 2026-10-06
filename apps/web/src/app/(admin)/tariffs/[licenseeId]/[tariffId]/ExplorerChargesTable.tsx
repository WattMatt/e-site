'use client'
/**
 * Every stored charge of a tariff, grouped by component, with its YoY change
 * and citation. View source opens the cited page (PDF) or cell (workbook).
 */
import { useState, type CSSProperties } from 'react'
import { TARIFF_VAT_BASIS_LABELS, type ChargeGroupView, type ChargeRowView, type YoyCell } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { SourceViewer } from '@/components/tariffs/SourceViewer'
import { getTariffSourceUrlAction } from '@/actions/tariff-explorer.actions'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }

export function yoyText(y: YoyCell, previousFy: string | null): string {
  switch (y.kind) {
    case 'changed': return `${y.pct > 0 ? '+' : ''}${y.pct.toFixed(1)} %`
    case 'new': return `New in this year`
    case 'unit_changed': return 'Unit changed'
    case 'no_previous': return previousFy ? `No ${previousFy} match` : '—'
  }
}

export function ExplorerChargesTable({ groups, previousFy }: { groups: ChargeGroupView[]; previousFy: string | null }) {
  const [viewing, setViewing] = useState<ChargeRowView | null>(null)
  if (groups.length === 0) return <p style={{ fontSize: 13 }}>This tariff has no charges in the library.</p>
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {groups.map((g) => (
        <section key={g.component} aria-label={g.label}>
          <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>{g.label}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Season</th><th style={TH}>Period</th><th style={TH}>Days</th><th style={TH}>Block</th>
                <th style={{ ...TH, textAlign: 'right' }}>Amount</th><th style={TH}>VAT</th>
                <th style={{ ...TH, textAlign: 'right' }}>{previousFy ? `vs ${previousFy}` : 'Year on year'}</th>
                <th style={TH}>Source</th><th style={TH} />
              </tr></thead>
              <tbody>{g.rows.map((r) => (
                <tr key={r.id}>
                  <td style={TD}>{r.season}</td>
                  <td style={TD}>{r.period}</td>
                  <td style={TD}>{r.dayType}</td>
                  <td style={TD}>{r.block}</td>
                  <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {r.amount}{r.unitNote && <div style={{ fontSize: 11, color: 'var(--c-text-mid)' }}>{r.unitNote}</div>}
                  </td>
                  <td style={TD}>{TARIFF_VAT_BASIS_LABELS[r.vatBasis]}</td>
                  <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{yoyText(r.yoy, previousFy)}</td>
                  <td style={{ ...TD, fontSize: 12 }}>{r.citation}</td>
                  <td style={TD}><Button variant="ghost" size="sm" disabled={!r.canViewSource} onClick={() => setViewing(r)}>View source</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}
      {viewing && viewing.sourceDocumentId && (
        <SourceViewer title={`${viewing.season}, ${viewing.period}: ${viewing.amount}`} locator={viewing.locator}
          loadUrl={() => getTariffSourceUrlAction({ sourceDocumentId: viewing.sourceDocumentId as string })}
          onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
