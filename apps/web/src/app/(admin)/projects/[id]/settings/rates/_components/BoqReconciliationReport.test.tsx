import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { BoqReconciliationReport } from './BoqReconciliationReport'
import type { ReconciliationReport } from '@/lib/boq/types'

const base: ReconciliationReport = {
  grandTotalComputed: 350,
  grandTotalExpected: 350,
  matched: true,
  billResults: [
    { tempId: 'b1', code: '1', computed: 350, expected: 350, matched: true },
  ],
  warnings: [],
  skippedSheets: [],
}

describe('BoqReconciliationReport', () => {
  // The en-ZA currency formatter uses a comma decimal + nbsp grouping
  // (matches the cable-cost fmtZAR). Match flexibly on the digits to avoid
  // whitespace/locale-glyph brittleness.
  const money350 = (_: string, el: Element | null) =>
    /R\s*350,00/.test(el?.textContent ?? '')

  it('renders the matched (green) state with computed + expected totals', () => {
    render(<BoqReconciliationReport report={base} />)
    expect(screen.getByText('Totals reconcile')).toBeTruthy()
    // both totals rendered as ZAR amounts (banner computed + expected)
    expect(screen.getAllByText(money350).length).toBeGreaterThanOrEqual(2)
    // banner shows the matched (✓) marker, not the mismatch (⚠) marker
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('✓')
    expect(banner.textContent).not.toContain('⚠')
    // green background marks the matched state
    expect(banner.getAttribute('style')).toContain('rgba(34, 197, 94')
  })

  it('renders the mismatched (amber) state and flags the failing bill', () => {
    const bad: ReconciliationReport = {
      ...base,
      grandTotalComputed: 350,
      grandTotalExpected: 999,
      matched: false,
      billResults: [{ tempId: 'b1', code: '1', computed: 350, expected: 999, matched: false }],
    }
    render(<BoqReconciliationReport report={bad} />)
    expect(screen.getByText('Totals do not reconcile')).toBeTruthy()
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('⚠')
    // amber background marks the mismatch state
    expect(banner.getAttribute('style')).toContain('rgba(245, 158, 11')
    // the failing bill row shows the ✗ marker
    expect(screen.getByTitle('Does not match expected').textContent).toContain('✗')
  })

  it('lists warnings and skipped sheets', () => {
    const withExtras: ReconciliationReport = {
      ...base,
      warnings: ['Sheet "P&G" had no AMOUNT column'],
      skippedSheets: ['NOTES TO TENDERER', 'QUALIFICATIONS'],
    }
    render(<BoqReconciliationReport report={withExtras} />)
    expect(screen.getByText('Sheet "P&G" had no AMOUNT column')).toBeTruthy()
    expect(screen.getByText('NOTES TO TENDERER')).toBeTruthy()
    expect(screen.getByText('QUALIFICATIONS')).toBeTruthy()
  })
})
