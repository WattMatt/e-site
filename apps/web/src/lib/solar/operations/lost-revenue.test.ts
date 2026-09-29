import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ tariff: vi.fn(), build: vi.fn(() => ({ monthlyBills: () => [] })) }))
vi.mock('@/lib/solar/cases/tariff', () => ({ resolveStudyTariff: h.tariff }))
// resolveStudyTariff's build hook is (tariff, TariffBillCalculatorOptions) → BillCalculator; its default
// is solar-engine's tariffBillCalculator, which energyOnlyBuild wraps.
vi.mock('@esite/shared/solar-engine', async (orig) => ({ ...(await orig<typeof import('@esite/shared/solar-engine')>()), tariffBillCalculator: h.build }))

import { energyOnlyBuild, valueLostEnergy } from './lost-revenue'

/** A tariff whose March energy costs R2/kWh; R100 fixed per month; demand would cost R50/kW if not forced to 0. */
const calc = {
  monthlyBills: ({ importKwh }: { importKwh: Float64Array }) => Array.from({ length: 12 }, (_, k) => ({
    month: k + 1, totalZar: 100 + (k === 2 ? importKwh.reduce((s, v) => s + v, 0) * 2 : 0), exportCreditUsedZar: 0,
  })),
  withExportRateScaled: () => calc,
}
const series = (hour: number, kwh: number) => { const s = new Float64Array(8760); s[hour] = kwh; return s }

beforeEach(() => {
  vi.clearAllMocks()
  h.tariff.mockResolvedValue({ ok: true, calc, calendar: {}, holidays: new Set(), year: 2026,
    tariffRef: { tariffId: 't', tariffName: 'Business 1', financialYear: '2026/27', licenseeName: 'City of Tshwane' } })
})

describe('valueLostEnergy', () => {
  it('values each event and the month as the marginal energy cost at the pinned tariff, fixed charges cancelling', async () => {
    const r = await valueLostEnergy({} as never, 'p1', '2026-03', [series(1600, 10), series(1601, 5)])
    expect(r).toEqual({ ok: true, tariffName: 'Business 1 (City of Tshwane, 2026/27)', perEventZar: [20, 10], totalZar: 30 })
    // Priced in the report month's financial year, not today's (TARIFF-12).
    expect(h.tariff).toHaveBeenCalledWith({}, 'p1', { year: 2026, build: energyOnlyBuild, todayIso: '2026-03-01' })
  })
  it('no events → zero, still naming the tariff', async () => {
    await expect(valueLostEnergy({} as never, 'p1', '2026-03', [])).resolves.toEqual({ ok: true, tariffName: 'Business 1 (City of Tshwane, 2026/27)', perEventZar: [], totalZar: 0 })
  })
  it('passes the tariff reason through (Generate is disabled with it)', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    await expect(valueLostEnergy({} as never, 'p1', '2026-03', [series(1, 1)])).resolves.toEqual({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
  })
})

describe('energyOnlyBuild', () => {
  it('forces maximum and peak-window demand to zero, keeps NMD and the reference year', () => {
    energyOnlyBuild({} as never, { calendar: {}, referenceYear: 2026, demandForMonth: () => ({ nmdKva: 500 }) } as never)
    const opts = (h.build.mock.calls[0] as unknown[])[1] as { demandForMonth: (m: number) => Record<string, number>; referenceYear: number }
    expect(opts.referenceYear).toBe(2026)
    expect(opts.demandForMonth(3)).toEqual({ nmdKva: 500, maxDemandKva: 0, maxDemandKw: 0, peakWindowMdKva: 0 })
  })
  it('with no NMD, only the forced zeros', () => {
    energyOnlyBuild({} as never, { calendar: {}, referenceYear: 2026 } as never)
    const opts = (h.build.mock.calls[0] as unknown[])[1] as { demandForMonth: (m: number) => Record<string, number> }
    expect(opts.demandForMonth(1)).toEqual({ maxDemandKva: 0, maxDemandKw: 0, peakWindowMdKva: 0 })
  })
})
