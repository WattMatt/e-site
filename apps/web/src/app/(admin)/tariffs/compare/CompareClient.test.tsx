import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Charge, Tariff } from '@esite/shared'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/actions/tariff-explorer.actions', () => ({ listPublishedTariffsAction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import { CompareClient } from './CompareClient'

const ch = (p: Partial<Charge> & Pick<Charge, 'component' | 'unit' | 'amountExclVat'>): Charge => ({
  season: 'all', tou: 'all', dayType: 'all', blockMinKwh: null, blockMaxKwh: null, blockBasis: null, demandBasis: null, vatRate: 0.15,
  vatBasis: 'stated_excl', unitInferred: false, inferenceReason: null, sourceLocator: {}, extractionMethod: 'parser', ...p,
})
const T = (name: string, charges: Charge[], structure: Tariff['structure']): Tariff => ({
  code: null, name, family: null, category: 'commercial', metering: 'conventional', structure, voltageBand: null, phase: null, transmissionZone: null,
  localAuthority: false, minAmps: null, maxAmps: null, minKva: null, maxKva: null, isLegacy: false, notes: null, charges, exportTariffCode: null, sourceLocator: {},
})
const flat = T('Flat', [ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300 })], 'flat')
const tou = T('TOU', [
  ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 500, tou: 'peak' }),
  ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250, tou: 'standard' }),
  ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 100, tou: 'off_peak' }),
], 'tou')
const sel = [
  { id: 'f', label: 'Muni · Flat (2026/27)', tariff: flat, highSeasonMonths: [6, 7, 8], seasonsAssumed: false },
  { id: 't', label: 'Muni · TOU (2026/27)', tariff: tou, highSeasonMonths: [6, 7, 8], seasonsAssumed: true },
]

describe('CompareClient', () => {
  it('prices the default profile on each tariff, cheapest first', () => {
    render(<CompareClient selected={sel} licensees={[]} year={2026} />)
    const rows = within(screen.getByRole('region', { name: 'Results' })).getAllByRole('listitem')
    // TOU: 10,000 kWh x (0.2 x R5 + 0.5 x R2.50 + 0.3 x R1) = R25,500/month -> R306,000/year.
    expect(rows[0].textContent).toContain('Muni · TOU')
    expect(rows[0].textContent).toContain('R306,000.00')
    expect(rows[0].textContent).toContain('June–August assumed')
    // Flat: 10,000 x R3 = R30,000/month -> R360,000/year.
    expect(rows[1].textContent).toContain('R360,000.00')
    expect(rows[1].textContent).toContain('Everything priced')
    expect(rows[0].textContent).toContain('Cheapest')
    // 360,000 - 306,000 = 54,000, 17.6 % of 306,000.
    expect(rows[1].textContent).toContain('+R54,000.00 (17.6 %) more')
  })
  it('a tariff with unpriced demand charges cannot be crowned cheapest: it is a minimum, listed last', () => {
    // Cheap energy plus a demand charge the default profile (no MD) cannot price.
    const demand = T('Demand', [
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 10 }),
      ch({ component: 'network_demand', unit: 'R_per_kVA_month', amountExclVat: 50, demandBasis: 'actual_md' }),
    ], 'flat')
    render(<CompareClient selected={[...sel, { id: 'd', label: 'Muni · Demand (2026/27)', tariff: demand, highSeasonMonths: [6, 7, 8], seasonsAssumed: false }]} licensees={[]} year={2026} />)
    const rows = within(screen.getByRole('region', { name: 'Results' })).getAllByRole('listitem')
    expect(rows.map((x) => x.textContent?.includes('Muni · Demand'))).toEqual([false, false, true])
    expect(rows[0].textContent).toContain('Cheapest')
    expect(rows[2].textContent).toContain('at least R12,000.00')
    expect(rows[2].textContent).not.toContain('Cheapest')
    expect(rows[2].textContent).not.toContain('more')
    expect(screen.getByText(/1 tariff could not be priced in full/)).toBeDefined()
  })
  it('a preset fills the whole profile', () => {
    render(<CompareClient selected={sel} licensees={[]} year={2026} />)
    fireEvent.click(screen.getByRole('button', { name: 'Industrial' }))
    expect((screen.getByLabelText('Energy per month') as HTMLInputElement).value).toBe('250000')
    expect((screen.getByLabelText('Maximum demand') as HTMLInputElement).value).toBe('800')
    expect(screen.getByRole('button', { name: 'Industrial' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('refuses shares that do not add up and prices nothing', () => {
    render(<CompareClient selected={sel} licensees={[]} year={2026} />)
    fireEvent.change(screen.getByLabelText('Peak share'), { target: { value: '60' } })
    expect(screen.getByRole('alert').textContent).toContain('must add up to 100 %')
    expect(screen.getByText('Shares total 140 %')).toBeDefined()
    expect(screen.queryByText('R306,000.00')).toBeNull()
  })
})
