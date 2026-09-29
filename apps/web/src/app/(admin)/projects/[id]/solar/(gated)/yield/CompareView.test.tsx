import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompareView } from './CompareView'
import type { CompareColumn } from '@/lib/solar/cases/page-data'

const col = (id: string, name: string, dc: number, money: CompareColumn['money']): CompareColumn => ({
  caseId: id, name, monthlyPvKwh: new Array(12).fill(1000), money,
  kpis: { dcKwp: dc, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.8, annualAcKwh: 1, pvAcKwh: 845_000, deliveredKwh: 1, selfConsumedKwh: 1, exportKwh: 1, curtailedKwh: 0, loadKwh: 1, importBeforeKwh: 1, importAfterKwh: 1, solarFraction: 0.5, selfConsumption: 0.9, peakDemandBeforeKw: 1, peakDemandAfterKw: 1, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
})

describe('CompareView', () => {
  it('one column per case; rand rows only for cost-view', () => {
    const cols = [col('a', 'Base', 500, { year1SavingZar: 400_000, irr: 0.2, npvZar: 2e6, simplePaybackYears: 5 }), col('b', 'Big', 800, null)]
    const { rerender, container } = render(<CompareView columns={cols} showMoney />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['KPI', 'Base', 'Big'])
    expect(screen.getByText('Year-1 bill saving')).toBeTruthy()
    expect(screen.getByText('R 400 000')).toBeTruthy()
    expect(screen.getAllByText('Run financials first')).toHaveLength(4)
    rerender(<CompareView columns={cols} showMoney={false} />)
    expect(screen.queryByText('Year-1 bill saving')).toBeNull()
    expect(container.textContent).not.toMatch(/R \d/)
    expect(screen.getByRole('img', { name: 'Monthly PV energy by case' })).toBeTruthy()
    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(24)
  })
  it('says when fewer than two ticked cases have a completed run', () => {
    render(<CompareView columns={[col('a', 'Base', 500, null)]} showMoney={false} />)
    expect(screen.getByText('Only cases with a completed run can be compared — run at least two.')).toBeTruthy()
  })
})
