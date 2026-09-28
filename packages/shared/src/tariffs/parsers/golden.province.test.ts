import { describe, expect, it } from 'vitest'
import { costMonth } from '../bill-engine'
import { makeTariff, type MonthUsage, type Tariff } from '../types'
import { validateTariff } from '../validators'
import { gridFromFixture, type CellFixture } from './grid'
import { parseProvinceSheet, type ParsedSheet } from './province-xlsx'
import cityPowerFx from '../__fixtures__/gp-city-power.cells.json'
import ekurhuleniFx from '../__fixtures__/gp-ekurhuleni.cells.json'
import lephalaleFx from '../__fixtures__/lp-lephalale.cells.json'
import buffaloFx from '../__fixtures__/ec-buffalo-city.cells.json'
import nmbFx from '../__fixtures__/ec-nmb.cells.json'
import capeTownFx from '../__fixtures__/wc-cape-town.cells.json'
import malutiFx from '../__fixtures__/fs-maluti.cells.json'
import kopanongFx from '../__fixtures__/fs-centlec-kopanong.cells.json'
import gamagaraFx from '../__fixtures__/nc-gamagara.cells.json'

const parse = (fx: unknown): ParsedSheet => {
  const f = fx as CellFixture
  return parseProvinceSheet(gridFromFixture(f), { fileSha256: f.source.sha256 })
}
const tariff = (s: ParsedSheet, pred: (name: string) => boolean): Tariff => {
  const t = s.tariffs.find((x) => pred(x.name))
  if (!t) throw new Error(`no tariff matching in ${s.sheet}: ${s.tariffs.map((x) => x.name).join(' | ')}`)
  return t
}
const usage = (p: Partial<MonthUsage> & { kwh?: number } = {}): MonthUsage => {
  const { kwh, ...rest } = p
  return { year: 2025, month: 1, days: 30, season: 'low', importKwh: { peak: 0, standard: kwh ?? 0, off_peak: 0 }, ...rest }
}
const energy = (t: Tariff) => t.charges.filter((c) => c.component === 'energy')

describe('golden cases re-run from the real cells (as-is/09 §7.2)', () => {
  const cityPower = parse(cityPowerFx)

  it('reads the City Power title and increase', () => {
    expect(cityPower).toMatchObject({ titleName: 'City Power', increasePct: 12.72, vatBasis: 'assumed_excl' })
  })

  it('1. Residential Single Phase 60A (rows 15-22): 800 kWh -> R2,849.26', () => {
    const t = tariff(cityPower, (n) => n === 'Residential Single Phase 60A')
    expect(energy(t).map((c) => [c.blockMinKwh, c.blockMaxKwh, c.amountExclVat, c.unit]))
      .toEqual([[0, 500, 227.28, 'c_per_kWh'], [500, 1000, 260.83, 'c_per_kWh'], [1000, 2000, 280.08, 'c_per_kWh'], [2000, 3000, 295.5, 'c_per_kWh'], [3000, null, 310, 'c_per_kWh']])
    expect(costMonth(t, usage({ kwh: 800 })).totalExclVat).toBe(2849.26)
  })

  it('2. Residential Time of Use (rows 65-75): six values, Standard kept, off-peak not peak -> R2,890.51', () => {
    const t = tariff(cityPower, (n) => n === 'Residential Time of Use (<=80A)')
    expect(validateTariff(t).map((i) => i.code)).not.toContain('tou_incomplete')
    const low = energy(t).filter((c) => c.season === 'low').map((c) => [c.tou, c.amountExclVat])
    expect(low).toEqual([['peak', 275.58], ['standard', 218], ['off_peak', 171.5]])
    const bill = costMonth(t, usage({ month: 7, season: 'high', importKwh: { peak: 100, standard: 200, off_peak: 300 } }))
    expect(bill.totalExclVat).toBe(2890.51)
  })

  it('3. Industrial LV (TOU) (rows 143-155): "R358,84", values in column C, c/kVArh is reactive -> R59,556.92', () => {
    const t = tariff(cityPower, (n) => n === 'Industrial LV (TOU)')
    expect(t.charges.find((c) => c.component === 'reactive')).toMatchObject({ unit: 'c_per_kVArh', amountExclVat: 37.64 })
    expect(t.charges.find((c) => c.component === 'demand')).toMatchObject({ amountExclVat: 358.84, season: 'all' })
    expect(t.charges.find((c) => c.component === 'service')).toMatchObject({ amountExclVat: 1895.11, season: 'all', sourceLocator: { cell: 'C154' } })
    const bill = costMonth(t, usage({ importKwh: { peak: 2000, standard: 5000, off_peak: 3000 }, maxDemandKva: 100, kvarh: 0 }))
    expect(bill.totalExclVat).toBe(59556.92)
  })

  it('4. Ekurhuleni Domestic IBT Tariff A: % in B1, unitless values inferred R/kWh -> R2,901.63', () => {
    const s = parse(ekurhuleniFx)
    expect(s.increasePct).toBe(12.74)
    const t = tariff(s, (n) => n === 'Domestic IBT Tariff A')
    expect(energy(t).every((c) => c.unit === 'R_per_kWh' && c.unitInferred)).toBe(true)
    expect(energy(t).map((c) => [c.blockMinKwh, c.blockMaxKwh])).toEqual([[0, 50], [50, 600], [600, 700], [700, null]])
    expect(costMonth(t, usage({ kwh: 800 })).totalExclVat).toBe(2901.63)
    expect(tariff(s, (n) => n === 'Domestic IBT Tariff A (single rate)').structure).toBe('flat')
  })

  it('5. Lephalale: "R1,6464/kWh" is R/kWh, fraction in B1 -> R1,061.25', () => {
    const s = parse(lephalaleFx)
    expect(s.increasePct).toBe(10.39)
    const t = tariff(s, (n) => n === 'Domestic Prepaid & Conventional')
    expect(energy(t).every((c) => c.unit === 'R_per_kWh' && !c.unitInferred)).toBe(true)
    expect(costMonth(t, usage({ kwh: 400 })).totalExclVat).toBe(1061.25)
  })

  it('6. Buffalo City Scale 1A: says c/kWh, is R/kWh, flagged -> R2,209.00; Scale 4B is legacy and skipped', () => {
    const s = parse(buffaloFx)
    const t = tariff(s, (n) => n.startsWith('Scale 1A'))
    expect(energy(t)[0]).toMatchObject({ unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true })
    expect(energy(t)[0].inferenceReason).toMatch(/^magnitude/)
    expect(costMonth(t, usage({ kwh: 500 })).totalExclVat).toBe(2209)
    expect(s.tariffs.some((x) => x.name.startsWith('Scale 4B'))).toBe(false)
    // Deviation from the plan (reality): the three Non-Profit variants (Scale 2A row 31,
    // 3A row 41, 3B row 51) are ALSO marked "Redundant tariff", so four legacy headers
    // are skipped, not one.
    expect(s.issues.filter((i) => i.code === 'legacy_tariff_skipped').map((i) => i.locator?.row)).toEqual([31, 41, 51, 71])
    const scale1c = tariff(s, (n) => n.startsWith('Scale 1C'))
    expect(energy(scale1c).map((c) => [c.blockMinKwh, c.blockMaxKwh])).toEqual([[0, 50], [50, 300], [300, null]])
  })

  it('7. Cape Town Large User LV TOU: values inside the label, basic in R/day -> R130,224.30', () => {
    const s = parse(capeTownFx)
    expect(s.increasePct).toBe(11.78)
    const t = tariff(s, (n) => n === 'Large User Low Voltage Time of Use')
    expect(t.charges.find((c) => c.component === 'basic')).toMatchObject({ unit: 'R_per_day', amountExclVat: 168.81 })
    expect(energy(t).filter((c) => c.season === 'low').map((c) => c.amountExclVat)).toEqual([203.8, 142.41, 92.8])
    const bill = costMonth(t, usage({ month: 7, season: 'high', importKwh: { peak: 5000, standard: 15000, off_peak: 10000 }, maxDemandKva: 200, nmdKva: 200 }))
    expect(bill.totalExclVat).toBe(130224.3)
  })

  it('8. Maluti-a-Phofung: ranges in column B, values in C, blank-label continuations, stated VAT-excl -> R1,275.84', () => {
    const s = parse(malutiFx)
    expect(s).toMatchObject({ vatBasis: 'stated_excl', increasePct: 10 })
    const blocks = tariff(s, (n) => n === 'DOMESTIC NON RURAL')
    expect(energy(blocks).filter((c) => c.season === 'low').map((c) => [c.blockMinKwh, c.blockMaxKwh, c.amountExclVat]))
      .toEqual([[0, 50, 1.68], [50, 350, 2.18], [350, 600, 3.08], [600, null, 3.49]])
    const levy = tariff(s, (n) => n.startsWith('TARIFF -A-')).charges.find((c) => c.label === 'Single Phase (Conventional Meters)')
    expect(levy).toMatchObject({ component: 'basic', unit: 'R_per_month', amountExclVat: 383.84, vatBasis: 'stated_excl' })
    // The book prints the levy and the unit rates as separate blocks; the reviewer links them (2b).
    const single = makeTariff({ name: 'Maluti domestic conventional single phase', structure: 'seasonal_ibt', charges: [...blocks.charges, levy!] })
    expect(costMonth(single, usage({ kwh: 400, season: 'low' })).totalExclVat).toBe(1275.84)
  })

  it('9. Centlec-Kopanong "16. SSEG (New)" opens its own sseg tariff (not merged into streetlights)', () => {
    const s = parse(kopanongFx)
    const t = tariff(s, (n) => n === '16. SSEG (New)')
    expect(t.category).toBe('sseg')
    expect(t.charges.map((c) => [c.component, c.tou, c.unit, c.amountExclVat])).toEqual([
      ['basic', 'all', 'R_per_month', 110], ['energy', 'peak', 'R_per_kWh', 1.42],
      ['energy', 'standard', 'R_per_kWh', 0.98], ['energy', 'off_peak', 'R_per_kWh', 0.62],
    ])
    expect(t.charges[0].unitInferred).toBe(true)
    expect(s.issues.some((i) => i.code === 'sseg_semantics_unknown' && i.tariff === t.name)).toBe(true)
  })
})

describe('fixtures that must be flagged, not billed', () => {
  it('Gamagara "Commercial Three Phase Prepaid" 3.52 "c/kWh" beside 353.81: the magnitude flag fires', () => {
    const s = parse(gamagaraFx)
    expect(s.increasePct).toBe(7.71)
    expect(energy(tariff(s, (n) => n === 'Commercial Three Phase Prepaid'))[0]).toMatchObject({ unit: 'R_per_kWh', amountExclVat: 3.52, unitInferred: true })
    expect(energy(tariff(s, (n) => n === 'Commercial Single Phase Prepaid'))[0]).toMatchObject({ unit: 'c_per_kWh', amountExclVat: 353.81, unitInferred: false })
  })
  it('NMB Small Business Prepaid basic = energy = 334.12: the duplicate-value flag fires; the unitless wheeling row is unresolved', () => {
    const s = parse(nmbFx)
    const t = tariff(s, (n) => n.startsWith('Small Business Prepaid Tariff'))
    expect(validateTariff(t).map((i) => i.code)).toContain('duplicate_value')
    expect(s.unresolved.map((u) => u.label)).toContain('Wheeling Charge')
  })
})
