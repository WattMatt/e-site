/**
 * Engine v2 features on SYNTHETIC pages (made-up numbers — licensed values
 * never enter this public repository).
 */
import { describe, expect, it } from 'vitest'
import { splitPdfText } from './pdf-text'
import { extractTable, lineTokens, type TableSpec } from './extract-table'

const doc = (...pages: string[][]): string => pages.map((p) => p.join('\n')).join('\f') + '\f'
const foot = (n: number): string => `             ${n}                          © SABS`

describe('lineTokens', () => {
  it('merges a thousands group printed with one space, never two columns', () => {
    expect(lineTokens('  1 138   1 070   12').map((t) => t.text)).toEqual(['1 138', '1 070', '12'])
    expect(lineTokens('  1,75 0,20 1,75').map((t) => t.text)).toEqual(['1,75', '0,20', '1,75'])
  })
})

describe('continuation pages, conditions, printed form', () => {
  const D = doc(
    ['   Table 7.1 — Ratings', '              Ambient temperature: 30 °C',
      '     1          2          3', '    mm2         A          A',
      '     1,5        14,5       13', '     95         182        164', foot(10)],
    ['   Table 7.1 (concluded)', '     1          2          3',
      '     1 000      1 154      –', foot(11)],
  )
  const spec: TableSpec = {
    clause: '7.1', title: 't', topic: 'cable_ratings', pages: 'all',
    keyColumn: { key: 'size', label: 'Size', unit: 'mm²', header: 1 },
    valueColumns: [{ key: 'a', label: 'A', unit: 'A', header: 2 }, { key: 'b', label: 'B', unit: 'A', header: 3 }],
    expectedKeys: [1.5, 95, 1000],
    conditions: [{ key: 'ambient_c', label: 'Ambient temperature', unit: '°C', match: /Ambient temperature:\s*([\d,]+)\s*°C/ }],
  }
  it('reads both pages, cites each row to its own page, keeps the printed form', () => {
    const { rows, conditions } = extractTable(splitPdfText(D), spec)
    expect(rows.map((r) => [r.sort_key, r.citation.page_printed])).toEqual([[1.5, 10], [95, 10], [1000, 11]])
    expect(rows[2].row_data).toEqual({ size: 1000, a: 1154, b: null })
    expect(rows[2].citation.printed).toMatchObject({ a: '1 154', b: '–' })
    expect(rows[0].citation.printed?.a).toBe('14,5')
    expect(conditions).toEqual([{ key: 'ambient_c', label: 'Ambient temperature', unit: '°C', value: '30', page_pdf: 1, page_printed: 10 }])
  })
  it("'first' reads only the heading page and refuses the missing rows", () => {
    expect(() => extractTable(splitPdfText(D), { ...spec, pages: 'first' })).toThrow(/missing row\(s\) 1000/)
  })
  it('refuses a condition that is not printed', () => {
    expect(() => extractTable(splitPdfText(D), { ...spec, conditions: [{ key: 'x', label: 'Soil', unit: '°C', match: /Soil temperature:\s*([\d,]+)/ }] }))
      .toThrow(/condition "Soil" not printed/)
  })
})

describe('r / x / z sub-columns', () => {
  const D = doc([
    '   Table 7.2 — Volt drop',
    '     1          2                     3',
    '     16         2,8                   2,4',
    '                r     x     z         r     x     z',
    '     25         1,75  0,20  1,80      1,50  0,18  1,52',
    foot(5),
  ])
  const spec: TableSpec = {
    clause: '7.2', title: 't', topic: 'volt_drop',
    keyColumn: { key: 'size', label: 'Size', unit: 'mm²', header: 1 },
    valueColumns: [{ key: 'p1_z', label: '1φ z', unit: 'mV/A/m', header: 2 }, { key: 'p3_z', label: '3φ z', unit: 'mV/A/m', header: 3 }],
    subColumns: {
      trigger: /^\s*r(\s+[rxz])+\s*$/,
      columns: [
        { key: 'p1_r', label: 'r', unit: 'mV/A/m', header: 1 }, { key: 'p1_x', label: 'x', unit: 'mV/A/m', header: 2 }, { key: 'p1_z', label: 'z', unit: 'mV/A/m', header: 3 },
        { key: 'p3_r', label: 'r', unit: 'mV/A/m', header: 4 }, { key: 'p3_x', label: 'x', unit: 'mV/A/m', header: 5 }, { key: 'p3_z', label: 'z', unit: 'mV/A/m', header: 6 },
      ],
    },
    expectedKeys: [16, 25],
  }
  it('switches to the sub-columns from the r x z line', () => {
    const { rows } = extractTable(splitPdfText(D), spec)
    expect(rows[0].row_data).toEqual({ size: 16, p1_z: 2.8, p3_z: 2.4 })
    expect(rows[1].row_data).toEqual({ size: 25, p1_r: 1.75, p1_x: 0.2, p1_z: 1.8, p3_r: 1.5, p3_x: 0.18, p3_z: 1.52 })
  })
  it('one dash across a whole r/x/z group fills the group with "not applicable"', () => {
    const dashed = D.replace('1,50  0,18  1,52', '      –     ')
    const grouped: TableSpec = { ...spec, subColumns: { ...spec.subColumns!, columns: spec.subColumns!.columns.map((c) => ({ ...c, group: c.key.startsWith('p1') ? '1φ' : '3φ' })) } }
    const { rows } = extractTable(splitPdfText(dashed), grouped)
    expect(rows[1].row_data).toMatchObject({ p3_r: null, p3_x: null, p3_z: null })
  })
  it('byOrderWhenComplete: a full row of drifting values is read in printed order; a short one by position', () => {
    // 1,80 sits midway between the x and z labels: by position it is refused, by order it is z.
    const drift = D.replace('     25         1,75  0,20  1,80      1,50  0,18  1,52', '     25         1,75  0,20    1,80    1,50  0,18  1,52')
    expect(() => extractTable(splitPdfText(drift), spec)).toThrow(/sits between columns/)
    const { rows } = extractTable(splitPdfText(drift), { ...spec, subColumns: { ...spec.subColumns!, byOrderWhenComplete: true } })
    expect(rows[1].row_data).toEqual({ size: 25, p1_r: 1.75, p1_x: 0.2, p1_z: 1.8, p3_r: 1.5, p3_x: 0.18, p3_z: 1.52 })
  })
  it('a sub row missing a sub value is refused', () => {
    const bad = D.replace('1,50  0,18  1,52', '1,50        1,52')
    expect(() => extractTable(splitPdfText(bad), spec)).toThrow(/no value in p3_x/)
  })
})

describe('band and text keys', () => {
  const D = doc([
    '   Table 7.3 — Bands',
    '        1                 2',
    '      1,5 – 10           0,70',
    '      > 45               1,0',
    foot(3),
  ])
  it('normalises band keys and sorts by the lower bound', () => {
    const { rows } = extractTable(splitPdfText(D), {
      clause: '7.3', title: 't', topic: 'derating',
      keyColumn: { key: 'band', label: 'Band', unit: null, header: 1, kind: 'band' },
      valueColumns: [{ key: 'f', label: 'f', unit: null, header: 2 }],
      expectedTextKeys: ['1.5–10', '>45'],
    })
    expect(rows.map((r) => [r.row_data.band, r.sort_key])).toEqual([['1.5–10', 1.5], ['>45', 45]])
  })
  it('reads short text keys and a text column', () => {
    const T = doc([
      '   Table 7.4 — Codes',
      '     1      2                         3',
      '     A1     Entertainment hall        2',
      '     G1     Offices                   8',
      foot(4),
    ])
    const { rows } = extractTable(splitPdfText(T), {
      clause: '7.4', title: 't', topic: 'building_energy',
      keyColumn: { key: 'code', label: 'Class', unit: null, header: 1, kind: 'text' },
      valueColumns: [{ key: 'desc', label: 'Description', unit: null, header: 2, type: 'text' }, { key: 'w', label: 'W/m²', unit: 'W/m²', header: 3 }],
      expectedTextKeys: ['A1', 'G1'],
    })
    expect(rows.map((r) => r.row_data)).toEqual([{ code: 'A1', desc: 'Entertainment hall', w: 2 }, { code: 'G1', desc: 'Offices', w: 8 }])
  })
})

describe('ordered rows', () => {
  const D = doc([
    '   Table 7.5 — Zones',
    '                         1     2     5H',
    '   A1',
    '   Assembly halls         30    32    38',
    '   A3',
    '   Schools                24    26    22',
    '   A3',
    '   Other instruction      44    62    50',
    foot(19),
  ])
  const spec: TableSpec = {
    clause: '7.5', title: 't', topic: 'building_energy',
    centresRow: /^\s*1\s+2\s+5H\s*$/,
    keyColumn: { key: 'cls', label: 'Class', unit: null, header: 0 },
    valueColumns: [{ key: 'z1', label: '1', unit: null, header: 1 }, { key: 'z2', label: '2', unit: null, header: 2 }, { key: 'z5h', label: '5H', unit: null, header: 3 }],
    rows: [
      { key: 'A1', label: 'A1 assembly', near: /^\s*A1\b/ },
      { key: 'A3_schools', label: 'A3 schools', near: /Schools/ },
      { key: 'A3_other', label: 'A3 other', near: /Other/ },
    ],
    minCells: 3,
  }
  it('assigns value lines to the declared rows in order, keyed by the spec', () => {
    const { rows } = extractTable(splitPdfText(D), spec)
    expect(rows.map((r) => [r.sort_key, r.row_data.cls, r.row_data.z5h])).toEqual([[1, 'A1 assembly', 38], [2, 'A3 schools', 22], [3, 'A3 other', 50]])
  })
  it('refuses a row whose label is not near its values', () => {
    expect(() => extractTable(splitPdfText(D), { ...spec, rows: spec.rows!.map((r, i) => (i === 1 ? { ...r, near: /Hospital/ } : r)) }))
      .toThrow(/row "A3_schools" — label not found/)
  })
  it('refuses when value lines and declared rows disagree in number', () => {
    expect(() => extractTable(splitPdfText(D), { ...spec, rows: spec.rows!.slice(0, 2) })).toThrow(/3 value lines for 2 declared rows/)
  })
})
