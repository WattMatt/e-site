import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { costMonth } from '../bill-engine'
import type { MonthUsage } from '../types'
import { parseRfdText } from './rfd-text'

const text = readFileSync(new URL('../__fixtures__/city-power-rfd-2026-27.excerpt.txt', import.meta.url), 'utf8')
const parsed = parseRfdText(text, { fileSha256: 'fixture' })
const t = (name: string) => {
  const hit = parsed.tariffs.find((x) => x.name === name)
  if (!hit) throw new Error(`no "${name}": ${parsed.tariffs.map((x) => x.name).join(' | ')}`)
  return hit
}

describe('City Power 2026/27 RfD (pdftotext -layout excerpt)', () => {
  it('takes the Recommended column, numbers above or beside their label', () => {
    const r60 = t('Residential Single Phase 60A')
    expect(r60.charges.filter((c) => c.component === 'energy').map((c) => [c.blockMinKwh, c.blockMaxKwh, c.amountExclVat]))
      .toEqual([[0, 500, 288.27], [500, 1000, 330.82], [1000, 2000, 355.23], [2000, 3000, 374.79], [3000, null, 393.19]])
    expect(r60.charges.find((c) => c.component === 'service')).toMatchObject({ unit: 'R_per_month', amountExclVat: 235.79 })
    expect(r60.charges.every((c) => c.extractionMethod === 'parser' && c.sourceLocator.line !== undefined)).toBe(true)
  })
  it('reads seasons and TOU periods, and the recommended increase', () => {
    const tou = t('Residential Time of Use (<=80A)')
    expect(tou.charges.filter((c) => c.component === 'energy').map((c) => [c.season, c.tou, c.amountExclVat])).toEqual([
      ['low', 'peak', 340.42], ['low', 'standard', 269.3], ['low', 'off_peak', 211.86],
      ['high', 'peak', 783.2], ['high', 'standard', 320.83], ['high', 'off_peak', 226.39],
    ])
    expect(tou.charges.find((c) => c.component === 'network_capacity')?.amountExclVat).toBe(1227.18)
    expect(parsed.increasePct).toBe(9.01)
    expect(parsed.issues.filter((i) => i.code === 'rfd_row_increase_mismatch')).toEqual([])
  })
  it('11. golden (2026/27): Residential Single Phase 60A, 800 kWh -> R3,364.18', () => {
    // 500 x 2.8827 + 300 x 3.3082 = 2,433.81; + 235.79 + 694.58
    const u: MonthUsage = { year: 2026, month: 8, days: 31, season: 'high', importKwh: { peak: 0, standard: 800, off_peak: 0 } }
    expect(costMonth(t('Residential Single Phase 60A'), u).totalExclVat).toBe(3364.18)
  })
  it('flags a row whose own arithmetic disagrees with its stated increase', () => {
    const bad = parseRfdText([
      '3. Probe',
      'Block 1 (0-500kWh)                 100,00      9,01%      120,00      120,00      9,01%',
    ].join('\n'), { fileSha256: 'x' })
    expect(bad.issues.map((i) => i.code)).toContain('rfd_row_increase_mismatch')
  })
})
