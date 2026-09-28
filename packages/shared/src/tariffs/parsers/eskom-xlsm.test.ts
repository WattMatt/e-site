import { describe, expect, it } from 'vitest'
import { costMonth } from '../bill-engine'
import { netBillingRule } from '../net-billing-rules'
import { validateTariff } from '../validators'
import type { MonthUsage, Tariff } from '../types'
import { gridFromCells, gridFromFixture, type CellFixture } from './grid'
import { parseEskomWorkbook } from './eskom-xlsm'
import hf25 from '../__fixtures__/eskom-2025-homeflex.cells.json'
import go25 from '../__fixtures__/eskom-2025-gen-offset.cells.json'
import lf25 from '../__fixtures__/eskom-2025-loss-factors.cells.json'
import br25 from '../__fixtures__/eskom-2025-businessrate.cells.json'
import mf25 from '../__fixtures__/eskom-2025-megaflex.cells.json'
import hf26 from '../__fixtures__/eskom-2026-homeflex.cells.json'
import go26 from '../__fixtures__/eskom-2026-gen-offset.cells.json'

const grids = (...fx: unknown[]) => fx.map((f) => gridFromFixture(f as CellFixture))
const byCode = (ts: Tariff[], code: string): Tariff => {
  const t = ts.find((x) => x.code === code)
  if (!t) throw new Error(`no ${code}: ${ts.map((x) => x.code).join(',')}`)
  return t
}
const july = (exportStd: number): MonthUsage => ({
  year: 2025, month: 7, days: 30, season: 'high',
  importKwh: { peak: 100, standard: 300, off_peak: 200 }, exportKwh: { peak: 0, standard: exportStd, off_peak: 0 },
})

describe('Eskom 2025/26 official workbook', () => {
  const parsed = parseEskomWorkbook(grids(hf25, go25, lf25, br25, mf25), { fileSha256: (hf25 as CellFixture).source.sha256 })

  it('reads Homeflex 1 with excl values, incl kept as proof, per-POD-day fixed charges and c/kWh adders', () => {
    const hf1 = byCode(parsed.tariffs, 'HF101N')
    expect(hf1.name).toBe('Homeflex 1 (HF101N)')
    const e = hf1.charges.filter((c) => c.component === 'energy').map((c) => [c.season, c.tou, c.amountExclVat])
    expect(e).toEqual([
      ['high', 'peak', 706.97], ['high', 'standard', 216.31], ['high', 'off_peak', 159.26],
      ['low', 'peak', 329.28], ['low', 'standard', 204.9], ['low', 'off_peak', 159.26],
    ])
    expect(hf1.charges.find((c) => c.component === 'energy')?.sourceLocator.raw_incl).toBe(813.02)
    expect(hf1.charges.find((c) => c.component === 'service')).toMatchObject({ unit: 'R_per_POD_day', amountExclVat: 3.27 })
    expect(hf1.charges.find((c) => c.component === 'network_demand')).toMatchObject({ unit: 'c_per_kWh', amountExclVat: 26.37 })
    expect(hf1.charges.find((c) => c.component === 'network_capacity')).toMatchObject({ unit: 'R_per_POD_day', amountExclVat: 12.13 })
    expect(hf1.charges.find((c) => c.component === 'gcc')).toMatchObject({ amountExclVat: 0.72 })
    expect(hf1.charges.every((c) => c.vatBasis === 'stated_excl')).toBe(true)
    expect(validateTariff(hf1).filter((i) => i.severity === 'block')).toEqual([])
  })

  it('shares the one Homeflex energy row with Homeflex 2-4, and says so', () => {
    const hf3 = byCode(parsed.tariffs, 'HF301N')
    expect(hf3.charges.filter((c) => c.component === 'energy')).toHaveLength(6)
    expect(hf3.charges.find((c) => c.component === 'network_capacity')?.amountExclVat).toBe(57.82)
    expect(parsed.issues.some((i) => i.code === 'eskom_shared_energy_row' && i.tariff === hf3.name)).toBe(true)
  })

  it('reads Gen-offset as separate sseg export tariffs and links them', () => {
    const go = byCode(parsed.tariffs, 'GOHF101N')
    expect(go.category).toBe('sseg')
    expect(go.charges.map((c) => [c.component, c.season, c.tou, c.amountExclVat])).toEqual([
      ['export_credit', 'high', 'peak', 650.52], ['export_credit', 'high', 'standard', 185.41], ['export_credit', 'high', 'off_peak', 131.21],
      ['export_credit', 'low', 'peak', 292.75], ['export_credit', 'low', 'standard', 174.58], ['export_credit', 'low', 'off_peak', 131.21],
    ])
    expect(byCode(parsed.tariffs, 'HF101N').exportTariffCode).toBe('GOHF101N')
    const urban = byCode(parsed.tariffs, 'NLUrbOffset01N')
    expect(urban).toMatchObject({ transmissionZone: 0, voltageBand: 'lt_500v' })
    expect(urban.charges.slice(0, 3).map((c) => c.amountExclVat)).toEqual([650.52, 162.63, 108.42])
    expect(byCode(parsed.tariffs, 'Me01N').exportTariffCode).toBe('NLUrbOffset01N')
  })

  it('10. golden: Homeflex 1 + Gen-Offset Homeflex from the real cells -> R2,177.26; S400 variant -> credit R556.23', () => {
    const hf1 = byCode(parsed.tariffs, 'HF101N')
    const go = byCode(parsed.tariffs, 'GOHF101N')
    expect(costMonth(hf1, july(150), { exportTariff: go, sseg: netBillingRule('eskom') }).totalExclVat).toBe(2177.26)
    expect(costMonth(hf1, july(400), { exportTariff: go, sseg: netBillingRule('eskom') }).credit.earned).toBe(556.23)
  })

  it('reads Megaflex zone x voltage rows and Businessrate flat energy, dropping a zero duplicate column', () => {
    const me = byCode(parsed.tariffs, 'Me01N')
    expect(me).toMatchObject({ name: 'Megaflex (Me01N)', transmissionZone: 0, voltageBand: 'lt_500v', category: 'industrial' })
    expect(me.charges.find((c) => c.component === 'gcc')).toMatchObject({ unit: 'R_per_kVA_month', amountExclVat: 3.49 })
    expect(me.charges.find((c) => c.component === 'transmission_network')?.amountExclVat).toBe(10.63)
    const br = byCode(parsed.tariffs, 'B101N')
    expect(br).toMatchObject({ name: 'Businessrate 1 (B101N)', structure: 'flat', category: 'commercial' })
    expect(br.charges.filter((c) => c.component === 'ers').map((c) => c.amountExclVat)).toEqual([4.94])
    expect(parsed.issues.some((i) => i.code === 'eskom_duplicate_column')).toBe(true)
  })

  it('reads the loss-factor table', () => {
    const lf = parsed.lossFactors.map((f) => [f.kind, f.voltageBand ?? f.transmissionZone, f.factor])
    expect(lf).toEqual([
      ['dx_urban', 'lt_500v', 1.1862], ['dx_rural', 'lt_500v', 1.1973],
      ['dx_urban', '500v_66kv', 1.1556], ['dx_rural', '500v_66kv', 1.1761],
      ['dx_urban', '66kv_132kv', 1.0724], ['dx_urban', 'gt_132kv', 1],
      ['tx', 0, 1.006], ['tx', 1, 1.016], ['tx', 2, 1.0261], ['tx', 3, 1.0361],
    ])
  })

  it('refuses a broken excl/incl pair through the validator', () => {
    const broken = gridFromCells('Homeflex NLA', {
      ...(hf25 as CellFixture).cells, F11: 900,
    })
    const p = parseEskomWorkbook([broken], { fileSha256: 'x' })
    expect(validateTariff(byCode(p.tariffs, 'HF101N')).map((i) => i.code)).toContain('vat_pair')
  })
})

describe('Eskom 2026/27 workbook (same layout)', () => {
  const parsed = parseEskomWorkbook(grids(hf26, go26), { fileSha256: (hf26 as CellFixture).source.sha256 })
  it('10b. Homeflex 1 + Gen-Offset Homeflex 2026/27 -> R2,366.21', () => {
    // energy 736.61 + 676.14 + 331.88 = 1,744.63; adders (0.45+24.78+28.68)c x 600 = 323.46;
    // service 5.74x30 = 172.20; NCC 13.19x30 = 395.70; GCC 1.09x30 = 32.70; import 2,668.69;
    // credit 150 x 201.65c = 302.475 -> 302.48; total 2,366.21.
    const hf1 = byCode(parsed.tariffs, 'HF101N')
    const go = byCode(parsed.tariffs, 'GOHF101N')
    expect(costMonth(hf1, { ...july(150), year: 2026 }, { exportTariff: go, sseg: netBillingRule('eskom') }).totalExclVat).toBe(2366.21)
  })
})
