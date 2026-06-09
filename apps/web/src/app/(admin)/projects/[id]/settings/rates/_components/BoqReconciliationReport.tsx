/**
 * BoqReconciliationReport — renders the parse-time reconciliation result for an
 * uploaded BOQ workbook (the `report` half of POST /boq/import).
 *
 * - A grand-total banner: green when `report.matched`, amber otherwise, showing
 *   the computed grand total vs the workbook's own Main-Summary expected total.
 * - A per-bill table: code/title, computed, expected, matched ✓/✗.
 * - Lists any warnings and skipped (prose) sheets.
 *
 * Pure presentation — no data fetching, no side effects. Reused inside
 * BoqImportDialog before the user confirms the import.
 */

import { Badge } from '@/components/ui/Badge'
import type { ReconciliationReport } from '@/lib/boq/types'
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

const tdNum: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  color: 'var(--c-text-mid)',
}

export function BoqReconciliationReport({ report }: { report: ReconciliationReport }) {
  const matched = report.matched

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Grand-total banner */}
      <div
        role="status"
        style={{
          borderRadius: 8,
          padding: '14px 16px',
          border: `1px solid ${matched ? 'var(--c-green)' : 'var(--c-amber)'}`,
          background: matched ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 16, color: matched ? 'var(--c-green)' : 'var(--c-amber)' }}>
            {matched ? '✓' : '⚠'}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--c-text)',
            }}
          >
            {matched ? 'Totals reconcile' : 'Totals do not reconcile'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{ color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
            Computed:{' '}
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
              {fmtMoney(report.grandTotalComputed)}
            </strong>
          </span>
          <span style={{ color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
            Expected:{' '}
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
              {fmtMoney(report.grandTotalExpected)}
            </strong>
          </span>
        </div>
      </div>

      {/* Per-bill table */}
      {report.billResults.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                <th style={th}>Bill</th>
                <th style={{ ...th, textAlign: 'right' }}>Computed</th>
                <th style={{ ...th, textAlign: 'right' }}>Expected</th>
                <th style={{ ...th, textAlign: 'center' }}>Match</th>
              </tr>
            </thead>
            <tbody>
              {report.billResults.map((bill) => (
                <tr key={bill.tempId} style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--c-text)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)' }}>
                      {bill.code}
                    </span>
                  </td>
                  <td style={tdNum}>{fmtMoney(bill.computed)}</td>
                  <td style={tdNum}>{fmtMoney(bill.expected)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <span
                      title={bill.matched ? 'Matches expected' : 'Does not match expected'}
                      style={{
                        color: bill.matched ? 'var(--c-green)' : 'var(--c-red)',
                        fontSize: 14,
                      }}
                    >
                      {bill.matched ? '✓' : '✗'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 6,
            }}
          >
            Warnings
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {report.warnings.map((w, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--c-amber)', fontFamily: 'var(--font-sans)' }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Skipped sheets */}
      {report.skippedSheets.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              paddingTop: 3,
            }}
          >
            Skipped
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {report.skippedSheets.map((s) => (
              <Badge key={s} variant="ghost">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
