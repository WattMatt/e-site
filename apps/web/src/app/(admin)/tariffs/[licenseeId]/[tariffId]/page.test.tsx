import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Charge, Tariff } from '@esite/shared'

const h = vi.hoisted(() => ({ detail: vi.fn(), notFound: vi.fn(() => { throw new Error('NOT_FOUND') }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/tariffs/explorer-data', () => ({ loadTariffDetail: h.detail }))
vi.mock('@/actions/tariff-explorer.actions', () => ({ getTariffSourceUrlAction: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import TariffDetailPage from './page'

const LID = '2255aace-9932-46ac-a5de-5e08b2c74170'
const TID = '11111111-2222-3333-4444-555555555555'
const ch = (p: Partial<Charge> & Pick<Charge, 'component' | 'unit' | 'amountExclVat'>): Charge => ({
  season: 'all', tou: 'all', dayType: 'all', blockMinKwh: null, blockMaxKwh: null, blockBasis: null, demandBasis: null, vatRate: 0.15,
  vatBasis: 'stated_excl', unitInferred: false, inferenceReason: null, sourceLocator: {}, extractionMethod: 'parser', ...p,
})
const tariff = (charges: Charge[], p: Partial<Tariff> = {}): Tariff => ({
  code: 'Me01N', name: '> 1 MVA (Me01N)', family: 'Megaflex', category: 'industrial', metering: 'conventional', structure: 'tou',
  voltageBand: '< 500V', phase: null, transmissionZone: 0, localAuthority: false, minAmps: null, maxAmps: null, minKva: 1000, maxKva: null,
  isLegacy: false, notes: null, charges, exportTariffCode: null, sourceLocator: {}, ...p,
})
const peak = ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 750.12, season: 'high', tou: 'peak', sourceLocator: { sheet: 'Megaflex NLA', cell: 'J8' } })
const CAL = { highSeasonMonths: [6, 7, 8], holidayTreatedAs: null, source: 'published' as const, windows: [
  { season: 'high' as const, dayType: 'weekday' as const, startMinute: 1020, endMinute: 1200, period: 'peak' as const },
] }
function detail(over: Record<string, unknown> = {}) {
  const t = tariff([peak])
  return {
    id: TID, row: {}, tariff: t, charges: [{ id: 'c1', charge: peak, sourceDocumentId: 'd1', sourceTitle: 'Eskom tariffs 2026/27' }],
    year: { id: 'y', licenseeId: LID, financialYear: '2026/27', state: 'published', effectiveFrom: '2026-04-01', effectiveTo: '2027-03-31', approvedIncreasePct: 8.76, publishedAt: null },
    licensee: { id: LID, name: 'Eskom', kind: 'eskom', province: 'national', nersaLicenceNo: null, mdbCode: null },
    previous: { financialYear: '2025/26', tariff: tariff([{ ...peak, amountExclVat: 689.79 }]) },
    calendar: { calendar: CAL, calendarId: 'cal', fromEskomFallback: false, holidays: [
      { tariffFamily: 'Megaflex', holidayDate: '2026-04-03', holidayName: 'Good Friday', treatedAs: 'sunday' as const },
    ] },
    ...over,
  }
}
const run = async () => render(await TariffDetailPage({ params: Promise.resolve({ licenseeId: LID, tariffId: TID }) }))

beforeEach(() => vi.clearAllMocks())

describe('tariff detail', () => {
  it('shows each charge with its unit, YoY change and citation', async () => {
    h.detail.mockResolvedValue(detail())
    await run()
    const energy = screen.getByRole('region', { name: 'Energy' })
    expect(within(energy).getByText('750.12 c/kWh')).toBeDefined()
    // (750.12 - 689.79) / 689.79 = +8.746 %
    expect(within(energy).getByText('+8.7 %')).toBeDefined()
    expect(within(energy).getByText('Eskom tariffs 2026/27, Megaflex NLA J8')).toBeDefined()
    expect(screen.getByText(/compare each charge with > 1 MVA \(Me01N\) in 2025\/26/)).toBeDefined()
  })
  it('draws the TOU visuals from the calendar and lists the family\'s holiday rules', async () => {
    h.detail.mockResolvedValue(detail())
    await run()
    expect(screen.getByRole('region', { name: 'Period by hour' })).toBeDefined()
    expect(screen.getByRole('img', { name: /TOU clock, high season weekday/ })).toBeDefined()
    expect(screen.getByRole('img', { name: 'Active energy rate by TOU period' })).toBeDefined()
    expect(screen.getByText('Good Friday')).toBeDefined()
    expect(screen.getByText('billed as Sunday')).toBeDefined()
  })
  it('labels Eskom hours shown for a municipality that publishes none', async () => {
    h.detail.mockResolvedValue(detail({ licensee: { id: LID, name: 'CITY POWER', kind: 'municipal', province: 'GP', nersaLicenceNo: null, mdbCode: 'JHB' },
      calendar: { calendar: { ...CAL, source: 'assumed_eskom' }, calendarId: 'cal', fromEskomFallback: true, holidays: [] } }))
    await run()
    expect(screen.getByText(/CITY POWER publishes seasons but not hours, so Eskom's hours are shown/)).toBeDefined()
    expect(screen.getByText('Public holidays are billed as the day of the week they fall on.')).toBeDefined()
  })
  it('says when no calendar exists at all, rather than drawing nothing', async () => {
    h.detail.mockResolvedValue(detail({ calendar: null }))
    await run()
    expect(screen.getByText(/No TOU calendar is loaded for Eskom yet, so the hours/)).toBeDefined()
  })
  it('without a previous year, says there is no YoY rather than showing 0 %', async () => {
    h.detail.mockResolvedValue(detail({ previous: null }))
    await run()
    expect(screen.getByText(/No published tariff of this name in the previous year/)).toBeDefined()
    expect(screen.queryByText('+0.0 %')).toBeNull()
  })
  it('a tariff the caller cannot read (or of another licensee) is not found', async () => {
    h.detail.mockResolvedValue(null)
    await expect(run()).rejects.toThrow('NOT_FOUND')
  })
})
