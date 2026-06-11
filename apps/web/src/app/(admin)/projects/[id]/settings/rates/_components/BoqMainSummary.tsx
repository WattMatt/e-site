'use client'

/**
 * BoqMainSummary — the Rates landing. Lists the top-level bills (sections with
 * kind='bill') with each bill's rolled-up total, plus the import's grand totals
 * (ex-VAT / VAT / incl-VAT). Clicking a bill row selects it for drill-down.
 *
 * When `revisedTotals` is set (the project has any approved variation), the
 * bill rows split into Contract | Revised columns + a revised grand total;
 * otherwise the layout is identical to a zero-VO project.
 *
 * Pure presentation + a select callback; the parent (RatesTab) owns selection.
 */

import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import type { BoqImport, BoqSection } from '@esite/shared'
import { naturalCompare } from '@/lib/natural-compare'
import { fmtMoney } from './format'

const th: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
}

interface Props {
  importRow: BoqImport
  sections: BoqSection[]
  totals: Record<string, number>
  /** Section rollups over the revised amounts; null/absent = no revisions. */
  revisedTotals?: Record<string, number> | null
  onSelectBill: (bill: BoqSection) => void
}

export function BoqMainSummary({ importRow, sections, totals, revisedTotals, onSelectBill }: Props) {
  const bills = sections
    .filter((s) => s.kind === 'bill')
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return naturalCompare(a.code ?? '', b.code ?? '')
    })

  const liveExVat = bills.reduce((s, b) => s + (totals[b.id] ?? 0), 0)
  const liveInclVat = liveExVat * 1.15
  const isEdited = Math.abs(liveExVat - (importRow.totalExVat ?? 0)) > 1

  const showRevised = revisedTotals != null
  const revisedExVat = showRevised ? bills.reduce((s, b) => s + (revisedTotals[b.id] ?? 0), 0) : 0
  const revisedInclVat = revisedExVat * 1.15

  return (
    <Card>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
            Main Summary
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
            {importRow.lineItemCount.toLocaleString('en-ZA')} line items
          </span>
        </div>
      </CardHeader>
      <CardBody>
        <div style={{ overflowX: 'auto', margin: '-14px -18px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                <th style={th}>Bill</th>
                <th style={{ ...th, textAlign: 'right' }}>{showRevised ? 'Contract (ex VAT)' : 'Total (ex VAT)'}</th>
                {showRevised && <th style={{ ...th, textAlign: 'right' }}>Revised (ex VAT)</th>}
                <th style={{ ...th, textAlign: 'right', width: 1, whiteSpace: 'nowrap' }} />
              </tr>
            </thead>
            <tbody>
              {bills.length === 0 ? (
                <tr>
                  <td colSpan={showRevised ? 4 : 3} style={{ padding: '12px', fontSize: 13, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
                    No bills in this import.
                  </td>
                </tr>
              ) : (
                bills.map((bill) => (
                  <tr
                    key={bill.id}
                    onClick={() => onSelectBill(bill)}
                    style={{ borderBottom: '1px solid var(--c-border)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '10px 12px', fontSize: 13, color: 'var(--c-text)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {bill.code && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text-dim)' }}>
                            {bill.code}
                          </span>
                        )}
                        <span style={{ fontWeight: 600 }}>{bill.title}</span>
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)',
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                        color: 'var(--c-text-mid)',
                      }}
                    >
                      {fmtMoney(totals[bill.id] ?? 0)}
                    </td>
                    {showRevised && (
                      <td
                        style={{
                          padding: '10px 12px',
                          fontSize: 13,
                          fontFamily: 'var(--font-mono)',
                          textAlign: 'right',
                          whiteSpace: 'nowrap',
                          color: 'var(--c-text)',
                        }}
                      >
                        {fmtMoney(revisedTotals?.[bill.id] ?? 0)}
                      </td>
                    )}
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span style={{ fontSize: 12, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>Open ↗</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              {/* ── Contract baseline (frozen at import) ─────────────────── */}
              <tr style={{ borderTop: '2px solid var(--c-border)' }}>
                <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
                  Contract total (ex VAT) · at import
                </td>
                <td style={{ padding: '10px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
                  {fmtMoney(importRow.totalExVat)}
                </td>
                {showRevised && <td />}
                <td />
              </tr>
              <tr>
                <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
                  VAT · at import
                </td>
                <td style={{ padding: '6px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
                  {fmtMoney(importRow.vatAmount)}
                </td>
                {showRevised && <td />}
                <td />
              </tr>
              <tr>
                <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
                  Contract total (incl VAT) · at import
                </td>
                <td style={{ padding: '6px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
                  {fmtMoney(importRow.totalInclVat)}
                </td>
                {showRevised && <td />}
                <td />
              </tr>
              {/* ── Current (live rollup) ─────────────────────────────────── */}
              <tr style={{ borderTop: '1px dashed var(--c-border)' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700, color: 'var(--c-text)', fontFamily: 'var(--font-sans)' }}>
                  Current total (ex VAT)
                  {isEdited && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--c-amber)' }}>(edited)</span>
                  )}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', textAlign: 'right', color: isEdited ? 'var(--c-amber)' : 'var(--c-text)', whiteSpace: 'nowrap' }}>
                  {fmtMoney(liveExVat)}
                </td>
                {showRevised && (
                  <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--c-text)', whiteSpace: 'nowrap' }}>
                    {fmtMoney(revisedExVat)}
                  </td>
                )}
                <td />
              </tr>
              <tr>
                <td style={{ padding: '6px 12px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }}>
                  Current total (incl VAT)
                </td>
                <td style={{ padding: '6px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'right', color: isEdited ? 'var(--c-amber)' : 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
                  {fmtMoney(liveInclVat)}
                </td>
                {showRevised && (
                  <td style={{ padding: '6px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--c-text-mid)', whiteSpace: 'nowrap' }}>
                    {fmtMoney(revisedInclVat)}
                  </td>
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardBody>
    </Card>
  )
}
