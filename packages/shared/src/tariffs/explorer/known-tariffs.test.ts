/**
 * Three published tariffs, each value copied from its SOURCE (not from the
 * database), pushed through the explorer's view model. The live database was
 * checked against the same cells on 2026-10-05: docs/tariffs/explorer-verification-2026-10.md.
 */
import { describe, expect, it } from 'vitest'
import { buildChargeGroups } from './charge-rows'
import { energyRatesByPeriod } from './tou-visual'
import { ch, tariff } from './fixtures'

const book = 'Eskom tariffs 2026/27: Eskom-tariffs-1-April-2026-Public.xlsm'
const e = (season: 'high' | 'low', tou: 'peak' | 'standard' | 'off_peak', amount: number, sheet: string, cell: string, unit: 'c_per_kWh' | 'R_per_kWh' = 'c_per_kWh') =>
  ch({ component: 'energy', unit, amountExclVat: amount, season, tou, sourceLocator: { sheet, cell } })

describe('Eskom Megaflex > 1 MVA (Me01N) 2026/27 — Megaflex NLA row 8', () => {
  const t = tariff('> 1 MVA (Me01N)', [
    e('high', 'peak', 739.28, 'Megaflex NLA', 'J8'), e('high', 'standard', 184.82, 'Megaflex NLA', 'L8'), e('high', 'off_peak', 123.2, 'Megaflex NLA', 'N8'),
    e('low', 'peak', 306.82, 'Megaflex NLA', 'P8'), e('low', 'standard', 172.5, 'Megaflex NLA', 'R8'), e('low', 'off_peak', 123.2, 'Megaflex NLA', 'T8'),
  ])
  it('rates by period are the workbook cells', () => {
    expect(energyRatesByPeriod(t).rates.map((r) => r.cPerKwh)).toEqual([739.28, 184.82, 123.2, 306.82, 172.5, 123.2])
  })
  it('each row cites its cell', () => {
    const [g] = buildChargeGroups(t, t.charges.map((c, i) => ({ id: String(i), charge: c, sourceDocumentId: 'd', sourceTitle: book })), null)
    expect(g.rows[0]).toMatchObject({ season: 'High demand (winter)', period: 'Peak', amount: '739.28 c/kWh', citation: `${book}, Megaflex NLA J8` })
  })
})

describe('Eskom Homeflex 1 (HF101N) 2026/27 — Homeflex NLA row 11', () => {
  const t = tariff('Homeflex 1 (HF101N)', [
    e('high', 'peak', 736.61, 'Homeflex NLA', 'E11'), e('high', 'standard', 225.38, 'Homeflex NLA', 'G11'), e('high', 'off_peak', 165.94, 'Homeflex NLA', 'I11'),
    e('low', 'peak', 343.09, 'Homeflex NLA', 'K11'), e('low', 'standard', 213.49, 'Homeflex NLA', 'M11'), e('low', 'off_peak', 165.94, 'Homeflex NLA', 'O11'),
  ], { category: 'domestic' })
  it('rates by period are the workbook cells', () => {
    expect(energyRatesByPeriod(t).rates.map((r) => r.cPerKwh)).toEqual([736.61, 225.38, 165.94, 343.09, 213.49, 165.94])
  })
})

describe('Inkosi Langalibalele TOU Low Voltage 2026/27 — NERSA RfD p22 (Recommended column)', () => {
  const p = (season: 'high' | 'low', tou: 'peak' | 'standard' | 'off_peak', r: number) =>
    ch({ component: 'energy', unit: 'R_per_kWh', amountExclVat: r, season, tou, sourceLocator: { page: 22 } })
  const t = tariff('Time-of-Use Consumer: Low Voltage Customers', [
    p('high', 'peak', 6.2693), p('high', 'standard', 3.2527), p('high', 'off_peak', 1.8502),
    p('low', 'peak', 2.9483), p('low', 'standard', 2.1327), p('low', 'off_peak', 1.1866),
    ch({ component: 'basic', unit: 'R_per_month', amountExclVat: 2941.7115, sourceLocator: { page: 22 } }),
    ch({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 297.666, sourceLocator: { page: 22 } }),
  ])
  it('R/kWh rates chart in c/kWh without rounding drift', () => {
    expect(energyRatesByPeriod(t).rates.map((r) => r.cPerKwh)).toEqual([626.93, 325.27, 185.02, 294.83, 213.27, 118.66])
  })
  it('the table keeps the published four decimals and cites the page', () => {
    const groups = buildChargeGroups(t, t.charges.map((c, i) => ({ id: String(i), charge: c, sourceDocumentId: 'd', sourceTitle: 'NERSA RfD 2026/27: INKOSI LANGALIBALELE' })), null)
    expect(groups.map((g) => g.component)).toEqual(['energy', 'basic', 'demand'])
    expect(groups[0].rows[0]).toMatchObject({ amount: 'R6.2693/kWh', citation: 'NERSA RfD 2026/27: INKOSI LANGALIBALELE, page 22' })
    expect(groups[1].rows[0].amount).toBe('R2,941.71/month')
    expect(groups[2].rows[0].amount).toBe('R297.67/kVA/month')
  })
})
