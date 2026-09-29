import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Tariff } from '../types'
import { validateTariffYear } from '../validators'
import { checkRow, classifyColumn, decimalStyle, parseRfdColumns, segmentLine } from './rfd-columns'
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
  const dp2 = { prior: 2, recommended: 2, pct: 1 }
  it('passes within the rounding the row prints, never looser than 0.02 / 0.1 %', () => {
    expect(checkRow(270.15, 302.03, 11.8, dp2).kind).toBe('ok')
    expect(checkRow(3.29, 3.66, 11.3, dp2).kind).toBe('ok') // 3.6618
    expect(checkRow(1125.75, 1227.18, 9.01, { prior: 2, recommended: 2, pct: 2 }).kind).toBe('ok')
    expect(checkRow(2.16, 2.3738, 9.9, { prior: 2, recommended: 4, pct: 1 }).kind).toBe('ok') // Centlec
  })
  it('does not let a Proposed value hide inside 0.02 on a rate printed to four places', () => {
    // 1.5000 x 1.1132 = 1.6698; 1.6800 is the value at 12 % (Proposed)
    expect(checkRow(1.5, 1.68, 11.32, { prior: 4, recommended: 4, pct: 2 }).kind).toBe('mismatch')
    // 197 x 1.125 = 221.625 printed as 222: within its rounding, but beyond 0.02 / 0.1 %, so flagged
    expect(checkRow(197, 222, 12.5, { prior: 2, recommended: 0, pct: 1 }).kind).toBe('mismatch')
  })
  it('reviews a small mismatch, blocks a gross one, and never passes a row it cannot check', () => {
    expect(checkRow(406, 449.9, 10, dp2).kind).toBe('mismatch') // Stellenbosch: 446.60 expected
    expect(checkRow(71.37, 768.46, -4.08, dp2).kind).toBe('gross') // Cape Town feed-in tariff 2
    expect(checkRow(null, 302.03, 11.8).kind).toBe('unverified')
    expect(checkRow(270.15, 302.03, null).kind).toBe('unverified')
    expect(checkRow(0, 302.03, 11.8).kind).toBe('unverified')
  })
})

describe('classifyColumn never takes "Amended" or "Extended" for Recommended', () => {
  it('needs a word starting "recom"', () => {
    expect(classifyColumn('2026/27 Amended')).not.toBe('recommended')
    expect(classifyColumn('Extended tariff')).not.toBe('recommended')
    expect(classifyColumn('2026/27 Recommen ded')).toBe('recommended')
  })
})

describe('decimalStyle and an ambiguous "1,050"', () => {
  it('reads a table\'s decimal mark from the numbers that can only be read one way', () => {
    expect(decimalStyle(['1,050', '230.67', '9.26%'])).toBe('point')
    expect(decimalStyle(['1,050', '230,67', '9,26%'])).toBe('comma')
    expect(decimalStyle(['1,050', '1,155'])).toBe('unknown')
  })
  it('refuses a Recommended "1,155" it cannot read, and reads it as thousands in a table of points', () => {
    const head = [
      '                        2025/26    2026/27   Proposed %     2026/27     Recommended     Analysis and Key',
      'Business               Approved     Proposed    Increase    Recommended   % increase      Findings',
    ]
    const unknown = parseRfdColumns([...head, 'Basic charge (R/month)   1,050      1,176         12%       1,155        10%'].join('\n'), { fileSha256: 'x' })
    expect(unknown.tariffs.flatMap((t) => t.charges)).toEqual([])
    expect(unknown.issues.find((i) => i.code === 'rfd_row_dropped')).toMatchObject({ severity: 'block' })
    const points = parseRfdColumns([...head,
      'Basic charge (R/month)   1,050      1,176      12.00%       1,155        10.00%',
      'Energy charge (c/kWh)    230.67     258.35     12.00%      253.74        10.00%',
    ].join('\n'), { fileSha256: 'x' })
    expect(points.tariffs[0].charges.map((c) => [c.component, c.amountExclVat])).toEqual([['basic', 1155], ['energy', 253.74]])
    // Both cells ambiguous: the table's mark decided, the row could not; that blocks.
    expect(points.issues.find((i) => i.code === 'rfd_row_unverified' && i.message.includes('decimal mark'))).toMatchObject({ severity: 'block' })
  })
})

describe('the City Power reader keeps its files', () => {
  it('parses the City Power excerpt exactly as it did before the column reader existed', () => {
    // sha256(JSON.stringify(parse)) taken with rfd-text.ts as it was on main before this change.
    const cp = readFileSync(new URL('../__fixtures__/city-power-rfd-2026-27.excerpt.txt', import.meta.url), 'utf8')
    const digest = createHash('sha256').update(JSON.stringify(parseRfdText(cp, { fileSha256: 'fixture' }))).digest('hex')
    expect(digest).toBe('c526acd355a6c4850ecd1a40ff55672a259994e3219adffbe7e38bda60ab1210')
  })
})

describe('Mantsopa: "R 2,686" under "2.4198 … 11.00%" (two decimal marks in one table)', () => {
  it('lets the row\'s own arithmetic decide the comma, and only then', () => {
    const r = parseRfdColumns([
      'Tariff II: IBT -        2025/26         Proposed       2026/27       2026/27            Recommende         Analysis',
      'Domestic     (Pre-      Approved        % Increase     Proposed      Recommended        d % Increase       and      Key',
      'paid            or                                                                                         findings',
      'Conventional)',
      'SUMMER',
      'Block      1    (0-',
      '350kWh)                 2.4198          11.00%         R 2,686       R 2,686            11.00%             N/A',
      'Block     2   (351-',
      '600kWh)                 3.4049          11.00%         R 3,779       R 3,779            11.00%             N/A',
      'Block 3 (>600kWh)       3.9737          11.00%         R 4,411       R 4,411            11.00%             N/A',
    ].join('\n'), { fileSha256: 'x' })
    expect(r.tariffs[0].charges.map((c) => [c.season, c.blockMinKwh, c.blockMaxKwh, c.amountExclVat, c.unit])).toEqual([
      ['low', 0, 350, 2.686, 'R_per_kWh'], ['low', 350, 600, 3.779, 'R_per_kWh'], ['low', 600, null, 4.411, 'R_per_kWh'],
    ])
    expect(codes(r.issues)).not.toContain('rfd_row_increase_mismatch')
  })
})

describe('hostile rows under a real header (Tsantsabane)', () => {
  const head = [
    '                                FY2025/26      FY2026/27   FY2026/27      FY2026/27        FY2026/27',
    ' Domestic Conventional          Approved      Proposed %   Approved     Recommended      Recommended',
    '                                 Increase       Increase    Increase       Increase       % Increase',
    '',
  ]
  const row = (label: string, a: string, p: string, r: string) =>
    `${label.padEnd(37)}${a.padStart(4)}         9.01%        ${p.padStart(4)}             ${r.padStart(4)}                9.01%`
  const go = (lines: string[]) => parseRfdColumns([...head, ...lines].join('\n'), { fileSha256: 'x' })

  it('starts a tariff named inside the table with no season carried over', () => {
    const r = go([
      ' Summer', row(' Block 1 (0 – 50 kWh)', '1.96', '2.14', '2.14'), row(' Block 2 (>50 kWh)', '2.49', '2.71', '2.71'),
      ' Winter', row(' Block 1 (0 – 50 kWh)', '2.96', '3.23', '3.23'), row(' Block 2 (>50 kWh)', '3.49', '3.80', '3.80'),
      ' Commercial Prepaid', row(' Energy charge', '3.48', '3.79', '3.79'),
    ])
    expect(r.tariffs.map((t) => [t.name, t.charges.map((c) => c.season)])).toEqual([
      ['Domestic Conventional', ['low', 'low', 'high', 'high']],
      ['Commercial Prepaid', ['all']],
    ])
  })
  it('takes a season word under a label-first row as the next heading once a season heading was seen', () => {
    const r = go([
      ' Summer', ' Block 1 (0 – 50 kWh)', row('', '1.96', '2.14', '2.14'), ' Block 2 (>50 kWh)', row('', '2.49', '2.71', '2.71'),
      ' Winter', ' Block 1 (0 – 50 kWh)', row('', '2.96', '3.23', '3.23'), ' Block 2 (>50 kWh)', row('', '3.49', '3.80', '3.80'),
    ])
    expect(r.tariffs[0].charges.map((c) => [c.season, c.blockMinKwh, c.amountExclVat])).toEqual([
      ['low', 0, 2.14], ['low', 50, 2.71], ['high', 0, 3.23], ['high', 50, 3.8],
    ])
    expect(r.issues.filter((i) => i.severity === 'block')).toEqual([])
  })
  it('blocks a tariff whose energy is priced for one season only', () => {
    const r = go([' Winter', row(' Block 1 (0 – 50 kWh)', '2.96', '3.23', '3.23'), row(' Block 2 (>50 kWh)', '3.49', '3.80', '3.80')])
    expect(r.issues.find((i) => i.code === 'rfd_season_incomplete')).toMatchObject({ severity: 'block', tariff: 'Domestic Conventional' })
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

// ---------------------------------------------------------------------------
// The extended pass: only for a file the City Power and column readers both leave empty.

const strictOnly = (name: string) => parseRfdColumns(fixture(name), { fileSha256: name })
const withCode = (issues: { code: string; severity: string; tariff?: string }[], code: string, tariffName?: string) =>
  issues.filter((i) => i.code === code && (tariffName === undefined || i.tariff === tariffName))

describe('extended pass: only for files every other reader leaves empty', () => {
  it('never runs where the column reader already finds a tariff (Makana + a Khai-Ma table)', () => {
    const text = `${fixture('makana')}\n\n${fixture('khai-ma')}`
    const r = parseRfdText(text, { fileSha256: 'mix' })
    expect(r).toEqual(parseRfdColumns(text, { fileSha256: 'mix' }))
    // The Khai-Ma tables' "2026/27FY" headers are extended vocabulary: not read here.
    expect(r.tariffs.map((t) => t.name)).not.toContain('Commercial single-phase')
  })
  it('resets the extended rules even when a parse throws', () => {
    expect(() => parseRfdColumns(undefined as unknown as string, { fileSha256: 'x' }, { extended: true })).toThrow()
    expect(parseRfdColumns(fixture('khai-ma'), { fileSha256: 'x' }).tariffs.map((t) => t.name)).not.toContain('Domestic low single-phase tariff: 30 A')
  })
  it('keeps the strict result (and its issues) when the extended pass finds nothing either', () => {
    expect(parse('nala')).toEqual(strictOnly('nala'))
  })
})

describe('Tokologo: Summer and Winter columns side by side (APAPA × 2), header printed off its columns', () => {
  const r = parse('tokologo')
  it('is left empty by the strict reader', () => {
    expect(strictOnly('tokologo').tariffs).toEqual([])
  })
  it('reads each season from its own Recommended column: summer = low, winter (June to Aug) = high', () => {
    expect(rows(tariff(r.tariffs, 'Pre-paid (E009)'))).toEqual([
      ['energy', 'low', 'all', 0, 50, 2.6782, 'R_per_kWh'],
      ['energy', 'high', 'all', 0, 50, 2.7468, 'R_per_kWh'],
      ['energy', 'low', 'all', 50, 350, 3.4436, 'R_per_kWh'],
      ['energy', 'high', 'all', 50, 350, 3.532, 'R_per_kWh'],
      ['energy', 'low', 'all', 350, 600, 4.3816, 'R_per_kWh'],
      ['energy', 'high', 'all', 350, 600, 4.9682, 'R_per_kWh'],
      ['energy', 'low', 'all', 600, null, 4.7088, 'R_per_kWh'],
      ['energy', 'high', 'all', 600, null, 5.4939, 'R_per_kWh'],
    ])
    const c = tariff(r.tariffs, 'Pre-paid (E009)').charges[1]
    expect(c.sourceLocator.raw_text).toContain('winter/high season column')
  })
  it('stores a figure printed the same for both seasons once, for the whole year', () => {
    expect(rows(tariff(r.tariffs, 'Domestic (E001)')).at(-1)).toEqual(['basic', 'all', 'all', null, null, 375.73, 'R_per_month'])
  })
  it('names tariffs by their coded lines, not by the section headings above them', () => {
    expect(r.tariffs.map((t) => t.name)).toContain('Churches & Old Age Homes ( E006 & E011 )')
    expect(r.tariffs.map((t) => t.name).some((n) => /Commercial Tariffs/.test(n))).toBe(false)
  })
  it('reads the rows on the next page, printed at other positions, in column order', () => {
    expect(rows(tariff(r.tariffs, 'Industrial supply (E012 & E013)')).slice(0, 2)).toEqual([
      ['energy', 'low', 'all', null, null, 1.7648, 'R_per_kWh'],
      ['energy', 'high', 'all', null, null, 1.908, 'R_per_kWh'],
    ])
  })
  it('blocks what it cannot represent: a basic charge that differs by season, a demand charge with no stated period', () => {
    expect(withCode(r.issues, 'rfd_duplicate_charge', 'Industrial - Bulk ( E007 & E008)').map((i) => i.severity)).toEqual(['block'])
    expect(withCode(r.issues, 'rfd_row_dropped', 'Industrial supply (E012 & E013)').map((i) => i.severity)).toEqual(['block', 'block'])
  })
  it('says the header was read by order and checks every row per season', () => {
    expect(withCode(r.issues, 'rfd_header_inferred')).toHaveLength(r.tariffs.length)
    expect(codes(r.issues)).not.toContain('rfd_row_increase_mismatch')
  })
})

describe('Kgetleng River: "Recommended % Increase" printed across the Recommended and % columns', () => {
  const r = parse('kgetleng-river')
  it('is left empty by the strict reader', () => {
    expect(strictOnly('kgetleng-river').tariffs).toEqual([])
  })
  it('takes the column that says Recommended and holds amounts, checked by the % beside it', () => {
    expect(rows(tariff(r.tariffs, 'Domestic Prepaid: Lifeline')).map((x) => x[5])).toEqual([205.44, 258.83, 342.4, 372.63])
    expect(withCode(r.issues, 'rfd_header_inferred')).toHaveLength(2)
  })
  it('blocks the row whose printed figure breaks the arithmetic the header was settled by (317.06 -> 248.76 at 10 %)', () => {
    const m = withCode(r.issues, 'rfd_row_increase_mismatch', 'Domestic Conventional: Lifeline')
    expect(m.map((i) => i.severity)).toEqual(['block'])
  })
})

describe('Gamagara: "2026/27 Proposed" printed twice, no column named Recommended', () => {
  const r = parse('gamagara')
  it('is left empty by the strict reader', () => {
    expect(strictOnly('gamagara').tariffs).toEqual([])
  })
  it('takes the duplicated column beside "Recommended % Increase" only because every row verifies', () => {
    expect(rows(tariff(r.tariffs, 'Domestic Conventional')).map((x) => x[5])).toEqual([192.51, 246.01, 351.05, 412.88, 242.55])
    expect(withCode(r.issues, 'rfd_header_inferred')[0]?.message).toContain('printed twice')
    expect(codes(r.issues, 'block')).toEqual([])
  })
})

describe('Khai-Ma: "2026/27FY" headers and "30 A" / "60 A" in the name column', () => {
  const r = parse('khai-ma')
  it('reads two amperage tariffs, not one merged under the same words', () => {
    expect(r.tariffs.map((t) => t.name)).toEqual(['Domestic low single-phase tariff: 30 A', 'Domestic low single-phase tariff: 60 A', 'Commercial single-phase'])
    expect(rows(tariff(r.tariffs, 'Domestic low single-phase tariff: 60 A'))).toEqual([
      ['basic', 'all', 'all', null, null, 177.71, 'R_per_month'],
      ['energy', 'all', 'all', null, null, 435.73, 'c_per_kWh'],
    ])
    expect(codes(r.issues, 'block')).toEqual([])
  })
})

describe('Siyancuma: two columns say Recommended; seasonal and TOU sub-tariffs under IBT rows', () => {
  const r = parse('siyancuma')
  it('is left empty by the strict reader', () => {
    expect(strictOnly('siyancuma').tariffs).toEqual([])
  })
  it('takes "Recommended Tariffs" (Approved × 1.096), never "2026/27 Recommended" (Approved × 1.125, the proposal)', () => {
    expect(rows(tariff(r.tariffs, 'DOMESTIC PRE-PAID — For household Pre-paid metering')).map((x) => x[5])).toEqual([3.21, 3.82])
    expect(rows(tariff(r.tariffs, 'DOMESTIC CONVENTIONAL — For household conventional metering')).map((x) => x[5])).toEqual([3.37, 3.81])
    expect(rows(tariff(r.tariffs, 'COMMERCIAL CONVENTIONAL — For business conventional metering')).map((x) => x[5])).toEqual([3.66, 4.25, 4.42])
    expect(withCode(r.issues, 'rfd_header_inferred')[0]?.message).toContain('two columns say Recommended')
  })
  it('keeps the seasonal blocks and the TOU rates out of the IBT tariff a bill would otherwise sum them into', () => {
    expect(rows(tariff(r.tariffs, 'DOMESTIC PRE-PAID — For household Pre-paid metering (seasonal)'))).toEqual([
      ['energy', 'low', 'all', 0, 350, 2.78, 'R_per_kWh'],
      ['energy', 'low', 'all', 350, null, 3.3, 'R_per_kWh'],
      ['energy', 'high', 'all', 0, 350, 3.15, 'R_per_kWh'],
      ['energy', 'high', 'all', 350, null, 3.76, 'R_per_kWh'],
    ])
    expect(rows(tariff(r.tariffs, 'DOMESTIC CONVENTIONAL — Time of Use (seasonal)'))).toEqual([
      ['energy', 'low', 'off_peak', null, null, 2.53, 'R_per_kWh'],
      ['energy', 'low', 'standard', null, null, 3.22, 'R_per_kWh'],
      ['energy', 'low', 'peak', null, null, 5.12, 'R_per_kWh'],
      ['energy', 'high', 'off_peak', null, null, 2.53, 'R_per_kWh'],
      ['energy', 'high', 'standard', null, null, 3.33, 'R_per_kWh'],
      ['energy', 'high', 'peak', null, null, 8.77, 'R_per_kWh'],
    ])
    // The "new" rows have no 2025/26 figure: stored, and said to be unchecked.
    expect(withCode(r.issues, 'rfd_row_unverified', 'DOMESTIC CONVENTIONAL — Time of Use (seasonal)')).toHaveLength(6)
  })
})

describe('Sol Plaatje: tariff code | description | Season | Period label columns, "APPROVED TARIFFS 2026/2027"', () => {
  const r = parse('sol-plaatje')
  it('is left empty by the strict reader', () => {
    expect(strictOnly('sol-plaatje').tariffs).toEqual([])
  })
  it('names each tariff from the description column, keeps "= 20" and "> 20 Amps" apart', () => {
    expect(r.tariffs.map((t) => t.name)).toEqual([
      'Indigents Tariff (Prepaid) 20 Amps',
      'Domestic Tariff (Conventional and Prepaid) 20 Amps',
      'Domestic Tariff (Conventional and Prepaid) over 20 Amps',
      'Public Benefit and Schools: Conventional and Prepayment',
      'Business Tariff: Small Power Users (Conventional and prepaid)',
      'Time of Use: NPO, NGO, SCHOOLS: LV under 200 KVA',
    ])
  })
  it('reads the Season cell ("High" / "Demand:") down the rows and the Period cell as the TOU period', () => {
    expect(rows(tariff(r.tariffs, 'Time of Use: NPO, NGO, SCHOOLS: LV under 200 KVA'))).toEqual([
      ['network_demand', 'all', 'all', null, null, 206.9077, 'R_per_kVA_month'],
      ['network_capacity', 'all', 'all', null, null, 98.406, 'R_per_kVA_month'],
      ['energy', 'high', 'peak', null, null, 7.1673, 'R_per_kWh'],
      ['energy', 'high', 'standard', null, null, 2.8759, 'R_per_kWh'],
      ['energy', 'high', 'off_peak', null, null, 1.9995, 'R_per_kWh'],
      ['energy', 'low', 'peak', null, null, 3.0721, 'R_per_kWh'],
      ['energy', 'low', 'standard', null, null, 2.3565, 'R_per_kWh'],
      ['energy', 'low', 'off_peak', null, null, 1.8399, 'R_per_kWh'],
    ])
    // Tariff codes ("EL1255 PBA & SCHOOLS PEAK <75") never reach a label.
    expect(r.tariffs.flatMap((t) => t.charges.map((c) => c.label)).some((l) => /EL1\d{3}|SCHOOLS/.test(l))).toBe(false)
  })
  it('says a tariff is missing the charge its header names with no value', () => {
    expect(withCode(r.issues, 'rfd_row_dropped', 'Time of Use: NPO, NGO, SCHOOLS: LV under 200 KVA').map((i) => i.message)).toEqual([
      expect.stringContaining('"Basic charge per month" not read: charge named in the table header with no value'),
    ])
  })
})

describe('Sol Plaatje SSEG: export credits are export credits; a TOU tariff "compulsory for SSEG" is not', () => {
  const r = parse('sol-plaatje-sseg')
  it('reads "Energy credit" under "Electricity Export Credits" as export_credit', () => {
    const t = tariff(r.tariffs, 'Electricity Export Credits - Small Scale Embedded Generation (Photovoltaic Policy)')
    expect(t.charges.filter((c) => c.component === 'export_credit').map((c) => [c.season, c.tou, c.amountExclVat])).toEqual([
      ['high', 'peak', 5.7268], ['high', 'standard', 1.6039], ['high', 'off_peak', 1.1458],
      ['low', 'peak', 2.5109], ['low', 'standard', 1.5122], ['low', 'off_peak', 1.1458],
    ])
  })
  it('keeps the SSEG customers\' import rates as energy', () => {
    const t = tariff(r.tariffs, 'SMALL CONSUMER: TOU under 70 KVA: Domestic & Commercial (compulsory for SSEG customers.)')
    expect(t.charges.filter((c) => c.tou === 'peak').map((c) => [c.component, c.season, c.amountExclVat])).toEqual([
      ['energy', 'high', 9.7509], ['energy', 'low', 3.1809],
    ])
    // "11,7647 … 4,51 … 4,5098" at 8 %: printed, not verified: blocked.
    expect(withCode(r.issues, 'rfd_row_increase_mismatch').map((i) => i.severity)).toEqual(['block'])
  })
})

describe('Nala: both the % and the amount column are headed "Recommended % Increase"', () => {
  it('stays unread: the header contradicts its numbers and only position could choose', () => {
    const r = parse('nala')
    expect(r.tariffs).toEqual([])
    expect(codes(r.issues)).toEqual(['rfd_table_skipped', 'rfd_table_skipped', 'rfd_table_skipped'])
  })
})

describe('extended pass: refuses to guess', () => {
  const edit = (name: string, from: string, to: string): string => {
    const text = fixture(name)
    expect(text).toContain(from)
    return text.replace(from, to)
  }
  it('skips a season-paired table when one season\'s row fails its arithmetic (Tokologo, winter 2,7468 -> 2,9999)', () => {
    const r = parseRfdText(edit('tokologo', '2,6782          2,7468', '2,6782          2,9999'), { fileSha256: 'x' })
    expect(r.tariffs).toEqual([])
    expect(codes(r.issues)).toContain('rfd_table_skipped')
  })
  it('does not place a row on the next page that fills only some columns (Tokologo, one number removed)', () => {
    const r = parseRfdText(edit('tokologo', 'Unit Charge: Per kWh                  1,6175', 'Unit Charge: Per kWh                        '), { fileSha256: 'x' })
    const dropped = withCode(r.issues, 'rfd_row_dropped', 'Industrial supply (E012 & E013)')
    expect(dropped.some((i) => i.severity === 'block' && /could not be placed/.test(i.message))).toBe(true)
    expect(tariff(r.tariffs, 'Industrial supply (E012 & E013)').charges.filter((c) => c.component === 'energy')).toEqual([])
  })
  it('skips when both columns named Recommended verify (Siyancuma, proposal equal to the recommendation)', () => {
    let text = edit('siyancuma', 'R3,30              9,6%                  R3,21', 'R3,21              9,6%                  R3,21')
    text = text.replace('R3,92              9,6%                  R3,82', 'R3,82              9,6%                  R3,82')
    const r = parseRfdText(text, { fileSha256: 'x' })
    expect(r.tariffs.map((t) => t.name).some((n) => n.startsWith('DOMESTIC PRE-PAID'))).toBe(false)
    expect(r.tariffs.map((t) => t.name).some((n) => n.startsWith('DOMESTIC CONVENTIONAL'))).toBe(true)
  })
  it('skips the duplicated "Proposed" column when one row does not verify (Gamagara)', () => {
    const r = parseRfdText(edit('gamagara', '193,52      193,52', '193,52      199,99'), { fileSha256: 'x' })
    expect(r.tariffs.map((t) => t.name)).toEqual(['Domestic Conventional'])
  })
  it('skips a table whose header ties a column to one season when the columns do not pair by season', () => {
    const r = parseRfdColumns([
      '                         2025/26       Proposed %     2026/27        2026/27          Recommended',
      ' Domestic                Approved      Increase       Proposed       Recommended      % Increase',
      '                                                                     Winter',
      ' Energy charge           2,00          15%            2,30           2,18             9%',
      ' Basic charge            100,00        15%            115,00         109,00           9%',
    ].join('\n'), { fileSha256: 'x' }, { extended: true })
    expect(r.tariffs).toEqual([])
    expect(r.issues.map((i) => i.message).join(' ')).toContain('do not pair by season')
  })
})
