import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformanceTable } from './PerformanceTable'

const row = (month: string, actual: number | null, pr: number | null = null) => ({ month, operatingYear: 1, expectedKwh: 1000, excludedKwh: 16, guaranteeKwh: 984,
  actualKwh: actual, varianceKwh: actual === null ? null : actual - 984, variancePct: actual === null ? null : ((actual - 984) / 984) * 100,
  performanceRatio: pr, correctedExpectedKwh: pr === null ? null : 1100, irradiationPlane: pr === null ? null : ('poa' as const), downtimeHours: 2, excludedHours: 1, coveragePct: actual === null ? null : 99.5 })

describe('PerformanceTable', () => {
  it('one row per month with expected, actual, variance, PR, corrected expected, downtime and coverage', () => {
    render(<PerformanceTable projectId="p1" rows={[row('2026-02', null), row('2026-03', 900, 0.79)]} selectedMonth="2026-03" />)
    const march = screen.getByRole('row', { name: /March 2026/ })
    expect(march.textContent).toContain('984')
    expect(march.textContent).toContain('900')
    expect(march.textContent).toContain('-8.5 %')
    expect(march.textContent).toContain('0.79')
    expect(march.textContent).toContain('1 100')
    expect(march.textContent).toContain('99.5 %')
    expect(screen.getByRole('row', { name: /February 2026/ }).textContent).toContain('no data')
    expect(screen.getByRole('link', { name: 'February 2026' }).getAttribute('href')).toBe('/projects/p1/solar/operations?month=2026-02')
  })
  it('an empty table shows the view’s specific reason when there is one (review B7)', () => {
    render(<PerformanceTable projectId="p1" rows={[]} selectedMonth={null} note="The commissioning date (2026-05-04) is after the last month with generation data (March 2026), so there is nothing to compare yet." />)
    expect(screen.getByText(/is after the last month with generation data/)).toBeTruthy()
    expect(screen.queryByText(/Set the commissioning date and import generation data/)).toBeNull()
  })
  it('an empty table says what to do', () => {
    render(<PerformanceTable projectId="p1" rows={[]} selectedMonth={null} />)
    expect(screen.getByText(/Set the commissioning date and import generation data/)).toBeTruthy()
  })
})
