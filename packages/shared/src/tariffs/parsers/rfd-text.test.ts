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

// Real pdftotext -layout excerpts (2026/27 RfDs). Each is the decision page or the table pages of the
// named file, cut on whole lines with their form feeds; nothing re-typed.
const excerpt = (name: string): string => readFileSync(new URL(`../__fixtures__/rfd-2026-27/${name}.excerpt.txt`, import.meta.url), 'utf8')
const PROSE = /Based on the available|decided|At its meeting|CONCLUSION|DETERMINATION OF/

describe('the City Power reader never files a table under a decision paragraph, a TOC line or a section heading', () => {
  it('MIDVAAL: decision paragraph "2. Based on…" does not swallow the tariff tables (published 2026/27 had 1 tariff / 22 charges)', () => {
    const p = parseRfdText(excerpt('midvaal'), { fileSha256: 'x' })
    expect(p.tariffs.filter((x) => PROSE.test(x.name)).map((x) => x.name)).toEqual([])
    const mega = p.tariffs.find((x) => x.name === 'Megaflex')
    expect(mega?.charges.filter((c) => c.component === 'energy').map((c) => [c.season, c.tou, c.amountExclVat])).toEqual([
      ['high', 'off_peak', 196.24], ['high', 'standard', 324.23], ['high', 'peak', 783.03],
      ['low', 'off_peak', 183.34], ['low', 'standard', 232.91], ['low', 'peak', 519.05],
    ])
    const gl = p.tariffs.find((x) => x.name === 'General Lighting')
    expect(gl?.charges.map((c) => [c.component, c.amountExclVat])).toEqual([['basic', 1242.69], ['energy', 783.03]])
    expect(p.tariffs.map((x) => x.name)).toEqual(expect.arrayContaining(['Commercial Prepaid/Conventional', 'Miniflex', 'Bulk Supply – Medium Voltage']))
  })

  it('City Power: rows on a page pdftotext indents belong to that page\'s own headers, not to "2. Based on…"', () => {
    const p = parseRfdText(excerpt('city-power-decision-and-p28'), { fileSha256: 'x' })
    expect(p.tariffs.filter((x) => PROSE.test(x.name)).map((x) => x.name)).toEqual([])
    const high = p.tariffs.find((x) => x.name === 'Residential Prepaid High')
    expect(high?.charges.map((c) => [c.component, c.blockMinKwh, c.amountExclVat])).toEqual([
      ['energy', 0, 290.46], ['energy', 350, 333.18], ['energy', 500, 379.64], ['service', null, 70], ['network_capacity', null, 140],
    ])
    expect(p.tariffs.find((x) => x.name === 'Residential Prepaid Low')?.charges.filter((c) => c.component === 'energy')).toHaveLength(3)
    // A tariff on an ordinary page reads exactly as before.
    expect(p.tariffs.find((x) => x.name === 'Residential Single Phase 60A')?.charges.map((c) => c.amountExclVat))
      .toEqual([288.27, 330.82, 355.23, 374.79, 393.19, 235.79, 694.58])
  })

  it('Ramotshere Moiloa: "9. Industrial Low Tension" on an indented page is read; "7.     CONFIDENTIALITY" is a section, not a charge', () => {
    const p = parseRfdText(excerpt('ramotshere-moiloa'), { fileSha256: 'x' })
    expect(p.tariffs.find((x) => x.name === 'Industrial Low Tension')?.charges.map((c) => [c.component, c.amountExclVat]))
      .toEqual([['energy', 183.94], ['demand', 479.2], ['basic', 305.62]])
    expect(p.tariffs.find((x) => x.name === 'Agriculture Low Tension')?.charges.map((c) => c.amountExclVat)).toEqual([493.71, 210.8, 349.89])
    expect(p.unresolved.map((u) => u.label)).not.toContain('7.')
  })

  it('Renosterberg: a file whose tables this reader cannot attach goes to the column reader whole (published 2026/27 had 11 rows under a decision clause)', () => {
    const p = parseRfdText(excerpt('renosterberg'), { fileSha256: 'x' })
    expect(p.issues.map((i) => i.code)).not.toContain('orphan_charge')
    expect(p.tariffs.map((x) => x.name)).toEqual([
      'Domestic Indigent ( Prepaid and Conventional)', 'Domestic Conventional & Prepaid', 'Commercial Prepaid', 'Commercial Conventional', 'Industrial',
    ])
  })

  it('a table-of-contents line is never a tariff header (BA-PHALABORWA published "CONCLUSION ……23")', () => {
    const p = parseRfdText([
      '10. CONCLUSION .........................................................................................................23',
      'Energy Charge c/kWh           288,90        9,01%   314,93     314,93              9,01%',
      '3. Commercial Prepaid',
      'Energy Charge c/kWh           286,65        9,01%   312,48     312,48              9,01%',
    ].join('\n'), { fileSha256: 'x' })
    expect(p.tariffs.map((x) => x.name)).toEqual(['Commercial Prepaid'])
    expect(p.issues.map((i) => i.code)).toContain('orphan_charge')
  })
})
