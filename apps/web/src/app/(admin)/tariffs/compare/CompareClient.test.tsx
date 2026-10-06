import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
    const rows = screen.getAllByRole('row').slice(1)
    // TOU: 10,000 kWh x (0.2 x R5 + 0.5 x R2.50 + 0.3 x R1) = R25,500/month -> R306,000/year.
    expect(rows[0].textContent).toContain('Muni · TOU')
    expect(rows[0].textContent).toContain('R306,000.00')
    expect(rows[0].textContent).toContain('June–August assumed')
    // Flat: 10,000 x R3 = R30,000/month -> R360,000/year.
    expect(rows[1].textContent).toContain('R360,000.00')
    expect(rows[1].textContent).toContain('Everything priced')
  })
  it('refuses shares that do not add up and prices nothing', () => {
    render(<CompareClient selected={sel} licensees={[]} year={2026} />)
    fireEvent.change(screen.getByLabelText('Peak share'), { target: { value: '60' } })
    expect(screen.getByRole('alert').textContent).toContain('must add up to 100 %')
    expect(screen.queryByText('R306,000.00')).toBeNull()
  })
})
