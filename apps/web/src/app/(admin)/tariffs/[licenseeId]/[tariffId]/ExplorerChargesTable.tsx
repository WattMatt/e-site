'use client'
/**
 * A tariff's charges, read two ways. For reading: one compact list per
 * component, each row naming only what varies within it (season, period,
 * days, block) with its amount and a coloured year-on-year chip. For
 * auditing: every charge with its VAT basis and cited source, folded away
 * under "Sources and audit". View source opens the cited page or cell.
 */
import { useState, type CSSProperties } from 'react'
import { signedPct, type ChargeGroupView, type ChargeRowView, type YoyCell } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { SourceViewer } from '@/components/tariffs/SourceViewer'
import { getTariffSourceUrlAction } from '@/actions/tariff-explorer.actions'
import { MUTED, NUM, YoyCellChip, autoGrid } from '../../_components/explorer-ui'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 12, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }

export function yoyText(y: YoyCell, previousFy: string | null): string {
  switch (y.kind) {
    case 'changed': return signedPct(y.pct)
    case 'new': return `New in this year`
    case 'unit_changed': return 'Unit changed'
    case 'no_previous': return previousFy ? `No ${previousFy} match` : '—'
  }
}

type Dim = 'season' | 'period' | 'dayType' | 'block'
const DIMS: readonly Dim[] = ['season', 'period', 'dayType', 'block']

/** The dimensions that differ between a group's rows: only those are worth printing. */
export function varyingDims(rows: readonly ChargeRowView[]): Dim[] {
  return DIMS.filter((d) => new Set(rows.map((r) => r[d])).size > 1)
}

const DEFAULTS: Record<Dim, string> = { season: 'All year', period: 'All hours', dayType: 'Every day', block: '—' }

/** The non-default values in the given dimensions. */
function specific(r: ChargeRowView, dims: readonly Dim[]): string[] {
  return dims.filter((d) => r[d] !== DEFAULTS[d]).map((d) => r[d])
}

/** What every row of a group shares that is not the default ("Weekdays", one block): said once, in the heading. */
export function groupContext(rows: readonly ChargeRowView[]): string | null {
  if (rows.length < 2) return null
  const shared = specific(rows[0], DIMS.filter((d) => !varyingDims(rows).includes(d)))
  return shared.length ? shared.join(' · ') : null
}

/** What a row applies to, in words; a single uniform row says so instead of printing "All year · All hours · Every day". */
export function rowLabel(r: ChargeRowView, dims: readonly Dim[]): string {
  const parts = specific(r, dims)
  if (parts.length) return parts.join(' · ')
  // Every varying dimension is at its default on this row: name the defaults, so it still reads differently from its siblings.
  if (dims.length) return dims.map((d) => (d === 'block' ? 'No block' : r[d])).join(' · ')
  const fixed = specific(r, DIMS)
  return fixed.length ? fixed.join(' · ') : 'All year, all hours'
}

/** The stored amount is always excluding VAT; the basis says how the source printed it. */
const VAT_NOTE: Record<ChargeRowView['vatBasis'], string | null> = {
  stated_excl: null,
  assumed_excl: 'VAT basis not stated; read as excl. VAT',
  stated_incl: 'Source printed incl. VAT; shown excl.',
}
const AUDIT_VAT: Record<ChargeRowView['vatBasis'], string> = {
  stated_excl: 'Printed excl. VAT',
  assumed_excl: 'Assumed excl. VAT',
  stated_incl: 'Printed incl. VAT, VAT removed',
}
function vatTag(r: ChargeRowView): string | null {
  return VAT_NOTE[r.vatBasis]
}

export function ExplorerChargesTable({ groups, previousFy }: { groups: ChargeGroupView[]; previousFy: string | null }) {
  const [viewing, setViewing] = useState<ChargeRowView | null>(null)
  if (groups.length === 0) return <p style={{ fontSize: 13 }}>This tariff has no charges in the library.</p>
  const viewer = (r: ChargeRowView, label: string) => (
    <button type="button" disabled={!r.canViewSource} onClick={() => setViewing(r)} aria-label={`View source for ${label}`} title={r.citation}
      style={{ background: 'none', border: 'none', minWidth: 28, minHeight: 28, padding: 0, cursor: r.canViewSource ? 'pointer' : 'default', opacity: r.canViewSource ? 0.7 : 0.25, fontSize: 14, color: 'inherit' }}>
      ⧉
    </button>
  )
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ ...autoGrid(300, 14), alignItems: 'start' }}>
        {groups.map((g) => {
          const dims = varyingDims(g.rows)
          // One VAT basis for the whole group is said once, in the heading.
          const groupVat = new Set(g.rows.map((r) => r.vatBasis)).size === 1 ? vatTag(g.rows[0]) : null
          const context = groupContext(g.rows)
          const credit = g.component === 'export_credit'
          return (
            <section key={g.component} aria-label={g.label} style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px', minWidth: 0 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 4px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{g.label}</span>
                <span style={{ ...MUTED, fontWeight: 400, fontSize: 12, textAlign: 'right' }}>{[context, groupVat, g.rows.length > 1 ? `${g.rows.length} rates` : null].filter(Boolean).join(' · ')}</span>
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {g.rows.map((r) => {
                  const label = rowLabel(r, dims)
                  const vat = groupVat ? null : vatTag(r)
                  return (
                    <li key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 10px', padding: '6px 0', borderTop: '1px solid var(--c-border)' }}>
                      <span style={{ flex: '1 1 140px', fontSize: 12, ...MUTED, minWidth: 0 }}>{label}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, marginLeft: 'auto' }}>
                        <span style={{ ...NUM, fontSize: 14, fontWeight: 600 }}>{r.amount}</span>
                        <YoyCellChip y={r.yoy} previousFy={previousFy} credit={credit} />
                        {viewer(r, `${g.label}, ${label}`)}
                      </span>
                      {(r.unitNote || vat) && (
                        <span style={{ flexBasis: '100%', fontSize: 11, ...MUTED }}>{[vat, r.unitNote].filter(Boolean).join(' · ')}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      <details>
        <summary style={{ fontSize: 13, cursor: 'pointer', ...MUTED }}>Sources and audit — every charge with its VAT basis and where it was read from</summary>
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Charge</th><th style={TH}>Applies to</th><th style={{ ...TH, textAlign: 'right' }}>Amount</th><th style={TH}>VAT</th>
              <th style={{ ...TH, textAlign: 'right' }}>{previousFy ? `vs ${previousFy}` : 'Year on year'}</th><th style={TH}>Source</th><th style={TH} />
            </tr></thead>
            <tbody>{groups.flatMap((g) => g.rows.map((r) => (
              <tr key={r.id}>
                <td style={TD}>{g.label}</td>
                <td style={TD}>{[r.season, r.period, r.dayType, r.block !== '—' ? r.block : null].filter(Boolean).join(' · ')}</td>
                <td style={{ ...TD, ...NUM, textAlign: 'right' }}>{r.amount}{r.unitNote && <div style={{ fontSize: 11, ...MUTED, whiteSpace: 'normal' }}>{r.unitNote}</div>}</td>
                <td style={TD}>{AUDIT_VAT[r.vatBasis]}</td>
                <td style={{ ...TD, ...NUM, textAlign: 'right' }}>{yoyText(r.yoy, previousFy)}</td>
                <td style={TD}>{r.citation}</td>
                <td style={TD}><Button variant="ghost" size="sm" disabled={!r.canViewSource} onClick={() => setViewing(r)}>View source</Button></td>
              </tr>
            )))}</tbody>
          </table>
        </div>
      </details>

      {viewing && viewing.sourceDocumentId && (
        <SourceViewer title={`${viewing.season}, ${viewing.period}: ${viewing.amount}`} locator={viewing.locator}
          loadUrl={() => getTariffSourceUrlAction({ sourceDocumentId: viewing.sourceDocumentId as string })}
          onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
