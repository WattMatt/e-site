'use client'

/**
 * CertificateSummary — the live Payment Certificate figures.
 *
 * Pure presentational: renders the seven certificate lines from `summary`
 * (straight off the pure computeCertificate — see valuation.service.ts) plus,
 * when provided, a per-bill breakdown table. The figures shown live (draft)
 * recompute on every progress edit; once certified they equal the frozen
 * snapshot on the valuation row.
 *
 * Money formatting reuses the Rates tab's fmtMoney (en-ZA ZAR) for cross-tab
 * consistency.
 */

import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { fmtMoney } from '../../rates/_components/format'

/** The seven certificate figures — matches computeCertificate's return shape. */
export interface CertificateFigures {
  grossToDate: number
  retention: number
  netToDate: number
  previousNet: number
  dueExVat: number
  vat: number
  dueInclVat: number
}

/** One bill row in the per-bill schedule. */
export interface CertificateBillRow {
  code: string
  title: string
  grossToDate: number
  retention: number
}

interface Props {
  summary: CertificateFigures
  /** Per-bill schedule. Totals reconcile to summary.grossToDate. Optional. */
  bills?: CertificateBillRow[]
  /** Retention % (shown on the retention line label, e.g. "less Retention (5%)"). */
  retentionPct: number
}

const rowLabel: React.CSSProperties = {
  padding: '7px 0',
  fontSize: 13,
  color: 'var(--c-text-mid)',
  fontFamily: 'var(--font-sans)',
}
const rowValue: React.CSSProperties = {
  padding: '7px 0',
  fontSize: 13,
  textAlign: 'right',
  fontFamily: 'var(--font-mono)',
  color: 'var(--c-text)',
  whiteSpace: 'nowrap',
}

/** A single figure line. `strong` bolds the row (subtotals / the final total). */
function FigureRow({
  label,
  value,
  strong,
  divider,
}: {
  label: string
  value: number
  strong?: boolean
  divider?: boolean
}) {
  return (
    <tr style={divider ? { borderTop: '1px solid var(--c-border)' } : undefined}>
      <td style={{ ...rowLabel, fontWeight: strong ? 600 : 400, color: strong ? 'var(--c-text)' : 'var(--c-text-mid)' }}>
        {label}
      </td>
      <td style={{ ...rowValue, fontWeight: strong ? 700 : 400 }}>{fmtMoney(value)}</td>
    </tr>
  )
}

export function CertificateSummary({ summary, bills, retentionPct }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Per-bill schedule */}
      {bills && bills.length > 0 && (
        <Card>
          <CardHeader>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
              Summary by bill
            </h3>
          </CardHeader>
          <CardBody>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <th style={{ ...rowLabel, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-text-dim)' }}>
                      Bill
                    </th>
                    <th style={{ ...rowValue, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-text-dim)' }}>
                      Gross to date
                    </th>
                    <th style={{ ...rowValue, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--c-text-dim)' }}>
                      Retention
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b, i) => (
                    <tr key={`${b.code}-${i}`} style={{ borderBottom: '1px solid var(--c-border)' }}>
                      <td style={rowLabel}>
                        {b.code ? (
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)', marginRight: 8 }}>{b.code}</span>
                        ) : null}
                        {b.title}
                      </td>
                      <td style={rowValue}>{fmtMoney(b.grossToDate)}</td>
                      <td style={rowValue}>{fmtMoney(b.retention)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* The seven certificate figures */}
      <Card>
        <CardHeader>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
            Payment certificate
          </h3>
        </CardHeader>
        <CardBody>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <FigureRow label="Gross value to date" value={summary.grossToDate} />
              <FigureRow label={`less Retention (${retentionPct}%)`} value={summary.retention} />
              <FigureRow label="Net value to date" value={summary.netToDate} strong divider />
              <FigureRow label="less Previously certified" value={summary.previousNet} />
              <FigureRow label="Amount due (excl. VAT)" value={summary.dueExVat} strong divider />
              <FigureRow label="VAT (15%)" value={summary.vat} />
              <FigureRow label="Total due (incl. VAT)" value={summary.dueInclVat} strong divider />
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  )
}
