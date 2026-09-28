import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FinancialResults } from './FinancialResults'
import type { FinancialResultsView } from '@/lib/solar/cases/financials-page-data'

const row = (y: number, net: number, cum: number) => ({ year: y, energyKwh: 1, billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, opexZar: 21_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: net, cumulativeZar: cum })
const view: FinancialResultsView = {
  computedAt: '2026-09-28T10:00:00Z', engineVersion: '0.1.0', tariffLabel: 'City Power Flat 2025/26',
  capex: { exclVatZar: 1_200_000, vatZar: 180_000, inclVatZar: 1_380_000, zarPerWp: 12 },
  year1: { billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, exportCreditUsedZar: 0 },
  lcoeZarPerKwh: 0.95,
  columns: [
    { key: 'cash-owner', label: 'Cash purchase — owner', year1: { label: 'Year-1 bill saving', zar: 262_800 }, upfrontZar: 1_200_000, npvZar: 900_000, irr: 0.21, simplePaybackYears: 4.6, discountedPaybackYears: 6.2, cumulativeZar: 3_500_000, rows: [row(1, 241_800, -958_200), row(2, 250_000, -708_200)] },
    { key: 'ppa-client', label: 'PPA — client', year1: { label: 'Year-1 net saving', zar: 82_800 }, upfrontZar: 0, npvZar: 400_000, irr: null, simplePaybackYears: null, discountedPaybackYears: null, cumulativeZar: 1_000_000, rows: [row(1, 50_000, 50_000)] },
  ],
  tornado: { title: 'NPV sensitivity (Cash purchase — owner), ±20 %', baseNpvZar: 900_000, bars: [{ variable: 'capex', label: 'Capex', lowNpvZar: 1_140_000, highNpvZar: 660_000, spreadZar: 480_000 }] },
  loadShedding: { year1Zar: 40_000, npvZar: 250_000 },
}

describe('FinancialResults', () => {
  it('one results column per finance model/view; n/a where there is no IRR', () => {
    render(<FinancialResults projectId="p1" caseId="c1" view={view} />)
    expect(within(screen.getAllByRole('table')[0]!).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['KPI', 'Cash purchase — owner', 'PPA — client'])
    expect(screen.getByText('21.0 %')).toBeTruthy()
    expect(screen.getAllByText('n/a').length).toBeGreaterThanOrEqual(1)
    // Each column shows ITS party's year-1 figure (not the gross saving copied into every column).
    expect(screen.getByText('R 262 800 (bill saving)')).toBeTruthy()
    expect(screen.getByText('R 82 800 (net saving)')).toBeTruthy()
    expect(screen.queryAllByText('R 262 800')).toHaveLength(0)
    expect(screen.getAllByText('R 0.95/kWh')).toHaveLength(2)
  })
  it('load-shedding value is a separate line, never in the IRR (D-14); absent when not stored', () => {
    const { rerender } = render(<FinancialResults projectId="p1" caseId="c1" view={view} />)
    expect(screen.getByText('Load-shedding value (separate, not in IRR): R 40 000 in year 1, NPV R 250 000')).toBeTruthy()
    rerender(<FinancialResults projectId="p1" caseId="c1" view={{ ...view, loadShedding: null }} />)
    expect(screen.queryByText(/Load-shedding value/)).toBeNull()
  })
  it('cashflow table switches with the model/view; chart, tornado and XLSX link present', () => {
    render(<FinancialResults projectId="p1" caseId="c1" view={view} />)
    expect(screen.getByRole('img', { name: 'Cashflow — Cash purchase — owner' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cashflow for'), { target: { value: 'ppa-client' } })
    expect(screen.getByRole('img', { name: 'Cashflow — PPA — client' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'NPV sensitivity (Cash purchase — owner), ±20 %' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download XLSX' }).getAttribute('href')).toBe('/api/projects/p1/solar/cases/c1/financials/xlsx')
  })
  it('provenance footer uses fixed SAST text (hydration-safe)', () => {
    render(<FinancialResults projectId="p1" caseId="c1" view={view} />)
    expect(screen.getByText('Computed 2026-09-28 12:00 SAST · engine 0.1.0 · tariff City Power Flat 2025/26')).toBeTruthy()
  })
})
