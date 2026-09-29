import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Tariff } from '../types'
import { validateTariffYear } from '../validators'
import { checkRow, classifyColumn, parseRfdColumns, segmentLine } from './rfd-columns'
import { parseRfdText } from './rfd-text'

// pdftotext -layout excerpts of real NERSA 2026/27 RfDs (one or two pages each).
const fixture = (name: string): string =>
  readFileSync(new URL(`../__fixtures__/rfd-2026-27/${name}.excerpt.txt`, import.meta.url), 'utf8')
const parse = (name: string) => parseRfdText(fixture(name), { fileSha256: name })
const tariff = (tariffs: Tariff[], name: string): Tariff => {
  const hit = tariffs.find((t) => t.name === name)
  if (!hit) throw new Error(`no "${name}": ${tariffs.map((t) => t.name).join(' | ')}`)
  return hit
}
const rows = (t: Tariff) => t.charges.map((c) => [c.component, c.season, c.tou, c.blockMinKwh, c.blockMaxKwh, c.amountExclVat, c.unit])
const codes = (issues: { code: string; severity: string }[], severity?: string) =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.code)

describe('segmentLine', () => {
  it('keeps space-grouped thousands whole and splits a number off the prose after it', () => {
    expect(segmentLine('  1 128.22        8.8%      1 227.51  x').map((s) => s.text)).toEqual(['1 128.22', '8.8%', '1 227.51', 'x'])
    expect(segmentLine('Basic   1,211.96   9.01%').map((s) => s.text)).toEqual(['Basic', '1,211.96', '9.01%'])
    const peeled = segmentLine('   302,03      11,8% category reflects a')
    expect(peeled.map((s) => [s.text, !!s.peeled])).toEqual([['302,03', false], ['11,8%', true], ['category reflects a', false]])
  })
})

describe('rows written tightly (Magareng, verbatim)', () => {
  const header = [
    ' 1.1 Prepaid                                                         2026/27                          Analysis',
    '                         2025/26       Proposed %     2026/27                       Recommended',
    ' Electricity                                                         Recommen                         and Key',
    '                         Approved      Increase       Proposed                      % Increase',
    ' Residential                                                         ded                              Findings',
  ]
  it('splits a number run into its label by one space, and does not take "1.1" for an amount', () => {
    const r = parseRfdColumns([
      ...header,
      ' Block 1 (0 - 50 kWh) 192,64              10,1%       212,10         212,10              10,1%',
      ' Block 2 (51 - 350 kWh) 247,68            10,1%       272,69         272,69              10,1%',
    ].join('\n'), { fileSha256: 'x' })
    expect(r.tariffs.map((t) => t.name)).toEqual(['Prepaid Electricity Residential'])
    expect(rows(r.tariffs[0]).map((x) => [x[3], x[4], x[5]])).toEqual([[0, 50, 212.1], [50, 350, 272.69]])
    expect(codes(r.issues)).not.toContain('rfd_row_increase_mismatch')
    expect(codes(r.issues)).not.toContain('rfd_row_unverified')
  })
  it('reads "High/Low Demand season" as both seasons', () => {
    const r = parseRfdColumns([
      ...header,
      ' Demand: High/Low season (R/kVA)  36,37              10,1%        40,04          40,04              10,1%',
    ].join('\n'), { fileSha256: 'x' })
    expect(r.tariffs[0].charges[0]).toMatchObject({ component: 'demand', season: 'all', amountExclVat: 40.04, unit: 'R_per_kVA_month' })
  })
})

describe('classifyColumn', () => {
  it('reads the column a header names', () => {
    expect(classifyColumn('2025/26 Approved')).toBe('prior')
    expect(classifyColumn('2025/26 NERSA')).toBe('prior')
    expect(classifyColumn('Proposed % Increase')).toBe('proposed_pct')
    expect(classifyColumn('2026/27 Proposed')).toBe('proposed')
    expect(classifyColumn('2026/27 Recommended')).toBe('recommended')
    expect(classifyColumn('Recomme nded Tariffs')).toBe('recommended')
    expect(classifyColumn('Recommended % Increase')).toBe('recommended_pct')
    expect(classifyColumn('2026/27 Approved Increased Tariffs')).toBe('recommended')
    expect(classifyColumn('2026/27 Approved % Increase')).toBe('recommended_pct')
    expect(classifyColumn('2025/26 Actual')).toBe('other')
    expect(classifyColumn('Analysis and Key Findings')).toBe('commentary')
  })
})

describe('checkRow (Recommended ≈ Approved × (1 + Recommended %))', () => {
  it('passes within 0.02 absolute or 0.1 % relative', () => {
    expect(checkRow(270.15, 302.03, 11.8).kind).toBe('ok')
    expect(checkRow(3.29, 3.66, 11.3).kind).toBe('ok') // 3.6618
    expect(checkRow(1125.75, 1227.18, 9.01).kind).toBe('ok')
  })
  it('reviews a small mismatch, blocks a gross one, and never passes a row it cannot check', () => {
    expect(checkRow(406, 449.9, 10).kind).toBe('mismatch') // Stellenbosch: 446.60 expected
    expect(checkRow(71.37, 768.46, -4.08).kind).toBe('gross') // Cape Town feed-in tariff 2
    expect(checkRow(null, 302.03, 11.8).kind).toBe('unverified')
    expect(checkRow(270.15, 302.03, null).kind).toBe('unverified')
    expect(checkRow(0, 302.03, 11.8).kind).toBe('unverified')
  })
})

describe('the City Power reader keeps its files', () => {
  it('uses the column reader only when the City Power reader finds no tariff', () => {
    const cp = readFileSync(new URL('../__fixtures__/city-power-rfd-2026-27.excerpt.txt', import.meta.url), 'utf8')
    const viaText = parseRfdText(cp, { fileSha256: 'fixture' })
    expect(viaText.issues.map((i) => i.code)).not.toContain('rfd_row_unverified')
    expect(viaText.tariffs.every((t) => t.charges.every((c) => !c.sourceLocator.raw_text?.includes('undefined')))).toBe(true)
    // The column reader is not what produced it: it reads the same text differently (no row checks elsewhere).
    expect(viaText).not.toEqual(parseRfdColumns(cp, { fileSha256: 'fixture' }))
  })
})

describe('Makana: per-tariff blocks, wrapped names, a units row, findings prose', () => {
  const r = parse('makana')
  it('takes 2026/27 Recommended, reads names wrapped inside the header, and keeps locators', () => {
    expect(r.tariffs.map((t) => t.name)).toEqual([
      'Domestic Prepaid 20A Single Phase', 'Domestic Prepaid 40A Single Phase', 'Domestic Prepaid 60A',
      'Domestic conventional 20A Single Phase Scale 4',
    ])
    expect(rows(tariff(r.tariffs, 'Domestic Prepaid 20A Single Phase'))).toEqual([['energy', 'all', 'all', null, null, 302.03, 'c_per_kWh']])
    const c = tariff(r.tariffs, 'Domestic Prepaid 20A Single Phase').charges[0]
    expect(c).toMatchObject({ unitInferred: false, extractionMethod: 'parser', label: 'Energy charge (c/kWh)' })
    expect(c.sourceLocator).toMatchObject({ page: 1, line: 8, raw_text: 'Energy charge (c/kWh) = 302,03 (recommended)' })
  })
  it('stores the unit the table states (R/A/m for the amp charge) and every row checks out', () => {
    expect(rows(tariff(r.tariffs, 'Domestic conventional 20A Single Phase Scale 4'))).toEqual([
      ['energy', 'all', 'all', null, null, 266.43, 'c_per_kWh'],
      ['other', 'all', 'all', null, null, 12.73, 'R_per_A_month'],
    ])
    expect(codes(r.issues)).not.toContain('rfd_row_increase_mismatch')
    expect(codes(r.issues)).not.toContain('rfd_row_unverified')
    expect(r.unresolved).toEqual([])
    expect(r.increasePct).toBe(11.8)
  })
})

describe('Umlalazi: decimal points, a % column without "%", numbers straddling two lines', () => {
  const r = parse('umlalazi')
  it('takes Recommended where it differs from Proposed', () => {
    // Proposed 220.73, Recommended 214.87 (NERSA capped the increase at 10 %)
    expect(rows(tariff(r.tariffs, 'Domestic Prepaid High')).map((x) => x[5])).toEqual([214.87, 277.42, 385.9, 448.49])
  })
  it('joins "158.75 13.00 179.39 174.63" to the "Block 2 … 10.00" line below it', () => {
    const low = tariff(r.tariffs, 'Domestic Prepaid Low Cost')
    expect(rows(low).map((x) => [x[3], x[4], x[5]])).toEqual([[0, 50, 140.31], [50, 350, 174.63], [350, 600, 200.01], [600, null, 213.44]])
    expect(r.issues.filter((i) => i.tariff === low.name && i.severity !== 'warn' && i.code !== 'inferred_unit')).toEqual([])
    // The excerpt ends before the label of the commercial table's second row: that row is refused.
    expect(r.issues.find((i) => i.code === 'rfd_row_dropped')).toMatchObject({ severity: 'block', tariff: 'Commercial Conventional Single-Phase' })
  })
  it('flags every energy unit it had to infer (the table states none)', () => {
    const energy = r.tariffs.flatMap((t) => t.charges).filter((c) => c.component === 'energy')
    expect(energy.every((c) => c.unit === 'c_per_kWh' && c.unitInferred)).toBe(true)
  })
})

describe('eThekwini: labels straddling their numbers, season headings over the columns', () => {
  const r = parse('ethekwini')
  it('reads "Energy charge (c/kWh)" / numbers / "High Season" as one seasonal row', () => {
    expect(rows(tariff(r.tariffs, 'Scale 1: Business and General (Option 1)'))).toEqual([
      ['energy', 'high', 'all', null, null, 415.47, 'c_per_kWh'],
      ['energy', 'low', 'all', null, null, 400.89, 'c_per_kWh'],
      ['basic', 'all', 'all', null, null, 528.16, 'R_per_month'],
    ])
  })
  it('takes "Low/High Season Energy Charges" as headings, not as the basic charge\'s label', () => {
    const tou = tariff(r.tariffs, 'Commercial Time of Use (TOU)')
    expect(rows(tou)).toEqual([
      ['basic', 'all', 'all', null, null, 741.22, 'R_per_month'],
      ['energy', 'low', 'peak', null, null, 345.33, 'c_per_kWh'],
      ['energy', 'low', 'standard', null, null, 277.81, 'c_per_kWh'],
      ['energy', 'low', 'off_peak', null, null, 161.6, 'c_per_kWh'],
      ['energy', 'high', 'peak', null, null, 699.94, 'c_per_kWh'],
      ['energy', 'high', 'standard', null, null, 350.22, 'c_per_kWh'],
      ['energy', 'high', 'off_peak', null, null, 170.61, 'c_per_kWh'],
      ['demand', 'all', 'all', null, null, 149.38, 'R_per_kVA_month'],
    ])
    expect(validateTariffYear([tou])).toEqual([])
  })
  it('blocks two energy rates a bill cannot tell apart (an obsolete and a supplementary charge)', () => {
    const dup = r.issues.find((i) => i.code === 'rfd_duplicate_charge' && i.severity === 'block')
    expect(dup?.tariff).toBe('Scale 2 (Meter 002): Business and General')
  })
})

describe('City of Tshwane: a row split over two lines, the name from the numbered heading', () => {
  const r = parse('city-of-tshwane')
  it('takes 324.12 (Recommended) where Proposed reads 342.12', () => {
    const t = tariff(r.tariffs, 'Domestic Conventional and Prepaid')
    expect(rows(t).map((x) => [x[3], x[4], x[5]])).toEqual([[0, 100, 324.12], [100, 400, 379.32], [400, 650, 413.26], [650, null, 445.51]])
    expect(tariff(r.tariffs, 'INDIGENT & LIFELINE: CONVENTIONAL AND PREPAID').charges).toHaveLength(4)
    expect(codes(r.issues)).not.toContain('rfd_row_increase_mismatch')
    expect(codes(r.issues)).not.toContain('rfd_row_unverified')
  })
})

describe('Centlec (Mangaung): "2026/27 Approved Increased Tariffs" is the decision column', () => {
  const r = parse('centlec-mangaung')
  it('reads four-decimal R/kWh rates under Summer and Winter headings', () => {
    const t = tariff(r.tariffs, 'Tariff I: IBT Indigent (Conventional & Prepaid)')
    expect(rows(t)).toEqual([
      ['energy', 'low', 'all', 0, 50, 2.3738, 'R_per_kWh'],
      ['energy', 'low', 'all', 50, 350, 2.5277, 'R_per_kWh'],
      ['energy', 'low', 'all', 350, null, 3.4399, 'R_per_kWh'],
      ['energy', 'high', 'all', 0, 50, 3.0113, 'R_per_kWh'],
      ['energy', 'high', 'all', 50, 350, 3.2201, 'R_per_kWh'],
      ['energy', 'high', 'all', 350, null, 3.8135, 'R_per_kWh'],
    ])
    expect(codes(r.issues, 'block')).toEqual([])
    expect(codes(r.issues)).not.toContain('rfd_row_unverified')
  })
})

describe('Tsantsabane (Northern Cape template): "FY2026/27 Approved" beside "FY2026/27 Recommended"', () => {
  const r = parse('tsantsabane')
  it('reads the Recommended column, names under the header, and comma-grouped thousands', () => {
    expect(r.tariffs.map((t) => t.name)).toEqual(['Domestic Conventional', 'Domestic Prepaid', 'Commercial Tariffs', 'Commercial Prepaid'])
    expect(rows(tariff(r.tariffs, 'Domestic Prepaid')).map((x) => x[5])).toEqual([2.17, 2.94, 3.87, 4.29])
    expect(tariff(r.tariffs, 'Commercial Tariffs').charges.find((c) => c.component === 'basic')?.amountExclVat).toBe(1321.16)
    expect(codes(r.issues)).not.toContain('rfd_row_increase_mismatch')
  })
})

describe('Buffalo City: one header over several numbered tariffs, and rows it cannot read', () => {
  const r = parse('buffalo-city')
  it('opens a tariff at each numbered heading under the same columns', () => {
    expect(r.tariffs.map((t) => t.name)).toContain('Scale 1 B')
    expect(rows(tariff(r.tariffs, 'Scale 1 B'))).toEqual([
      ['energy', 'all', 'all', 0, 2000, 3.368, 'R_per_kWh'],
      ['energy', 'all', 'all', 2000, null, 3.55, 'R_per_kWh'],
      ['service', 'all', 'all', null, null, 461, 'R_per_month'],
    ])
  })
  it('blocks a tariff that lost a row ("Part 1 … Free", a rate in an impossible unit)', () => {
    const dropped = r.issues.filter((i) => i.code === 'rfd_row_dropped' && i.severity === 'block')
    expect(dropped.map((i) => i.tariff)).toContain('Indigent Domestic Prepayment/Credit Three-Part Block Tariff')
    expect(r.unresolved.length).toBeGreaterThan(0)
  })
})

describe('City of Cape Town: arithmetic that does not add up', () => {
  const r = parse('city-of-cape-town')
  it('blocks 71.37 -> 768.46 stated as -4.08 %, and reads feed-in rows as export credits', () => {
    const gross = r.issues.find((i) => i.code === 'rfd_row_increase_mismatch')
    expect(gross).toMatchObject({ severity: 'block', tariff: 'Non-Residential Small-Scale Embedded Generation' })
    expect(gross?.locator).toMatchObject({ line: 19 })
    const feedIn = tariff(r.tariffs, 'Residential: Small-Scale Embedded Generation').charges[0]
    expect(feedIn).toMatchObject({ component: 'export_credit', amountExclVat: 107.98, unit: 'c_per_kWh' })
  })
})

describe('Matjhabeng: "2026/27 Recommended Increase" is the increased tariff', () => {
  const r = parse('matjhabeng')
  it('reads it as the amount, with Summer/Winter headings over the rows', () => {
    expect(rows(tariff(r.tariffs, 'IBT DOMESTIC'))).toEqual([
      ['energy', 'low', 'all', 0, 350, 3.66, 'R_per_kWh'],
      ['energy', 'low', 'all', 350, null, 3.81, 'R_per_kWh'],
      ['energy', 'high', 'all', 0, 350, 3.98, 'R_per_kWh'],
      ['energy', 'high', 'all', 350, null, 4.4, 'R_per_kWh'],
      ['basic', 'all', 'all', null, null, 187.5, 'R_per_month'],
    ])
    expect(codes(r.issues)).not.toContain('rfd_row_increase_mismatch')
  })
})

describe('Damplaas: a page footer between rows, the season under the numbers', () => {
  const r = parse('damplaas')
  it('reads both rows with their season and ignores the running footer', () => {
    expect(rows(tariff(r.tariffs, 'Farms'))).toEqual([
      ['energy', 'low', 'all', null, null, 2.54, 'R_per_kWh'],
      ['energy', 'high', 'all', null, null, 3.84, 'R_per_kWh'],
    ])
    expect(tariff(r.tariffs, 'Farms').charges.map((c) => c.label)).toEqual(['Energy charge (R/kWh): Summer', 'Energy charge (R/kWh): Winter'])
    // No Recommended % column here: the rows cannot be checked, and say so.
    expect(codes(r.issues).filter((c) => c === 'rfd_row_unverified')).toHaveLength(2)
  })
})
