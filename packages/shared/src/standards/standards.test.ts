/**
 * The extractor on SYNTHETIC pages laid out like a SABS standard. Every number
 * here is made up: licensed values never enter this (public) repository.
 */
import { describe, expect, it } from 'vitest'
import { pageOffset, parseCell, printedPage, readPrintedPage, splitPdfText } from './pdf-text'
import { extractTable, findTablePage, type TableSpec } from './extract-table'
import { crosscheck, type CrosscheckMapping } from './crosscheck'
import { readDocumentIdentity, tableCode } from './dataset'

const page = (lines: string[]): string => lines.join('\n')
const DOC = [
  page([
    'Licensed exclusively to Somebody; License ID : X. Copying and network storage prohibited',
    '             SANS 99999-1:2099',
    '             Edition 7.2',
    '      text that mentions table 9.1 but is not its heading',
    '                     Table 9.1 — Correction factors for something',
    '                  1                2                3',
    '               Ambient          Type A           Type B',
    '                 °C              70 °C            90 °C',
    '                 10              1,40',
    '                 20              1,20',
    '                                                  1,0',
    '                 30              1,00',
    '                 40               –               0,80',
    '                 50               –               0,60',
    '           NOTE The 50 °C row is not a key.',
    '             12                          © SABS',
  ]),
  page([
    '                                          SANS 99999-1:2099',
    '                                                  Edition 7.2',
    '                          © SABS              13',
  ]),
].join('\f') + '\f'

const SPEC: TableSpec = {
  clause: '9.1',
  title: 'Correction factors for something',
  topic: 'derating',
  keyColumn: { key: 'ambient_c', label: 'Ambient', unit: '°C', header: 1 },
  valueColumns: [
    { key: 'type_a', label: 'Type A', unit: null, header: 2 },
    { key: 'type_b', label: 'Type B', unit: null, header: 3 },
  ],
  expectedKeys: [10, 20, 30, 40, 50],
  spanned: { column: 'type_b', from: 10, to: 30 },
}

describe('pdf-text', () => {
  it('splits pages, drops the licence watermark, reads printed page numbers', () => {
    const pages = splitPdfText(DOC)
    expect(pages).toHaveLength(2)
    expect(pages[0].lines.some((l) => /Licensed/.test(l))).toBe(false)
    expect(pages.map((p) => p.printedOnPage)).toEqual([12, 13])
    expect(pageOffset(pages)).toBe(-11)
    expect(printedPage(pages[0], -11)).toBe(12)
  })

  it('reads landscape page numbers but never a column-number row', () => {
    expect(readPrintedPage(['  1      2      3      4', 'body', '  120'])).toBe(120)
    expect(readPrintedPage(['body', '121          SANS 10142-1     Edition 3.1'])).toBe(121)
    expect(readPrintedPage(['  1               2           3', 'body'])).toBeNull()
  })

  it('refuses a page whose own number disagrees with the document offset', () => {
    const pages = splitPdfText(DOC)
    expect(() => printedPage(pages[0], -10)).toThrow(/disagrees/)
  })

  it('parses decimal commas and dashes, rejects clause numbers and words', () => {
    expect(parseCell('1,22')).toBe(1.22)
    expect(parseCell('0,5')).toBe(0.5)
    expect(parseCell('400')).toBe(400)
    expect(parseCell('1 138')).toBe(1138)
    expect(parseCell('–')).toBeNull()
    expect(parseCell('6.2.10')).toBeUndefined()
    expect(parseCell('K·m/W')).toBeUndefined()
  })
})

describe('extractTable', () => {
  it('places values by column, fills a spanned band, cites every row', () => {
    const { rows } = extractTable(splitPdfText(DOC), SPEC)
    expect(rows.map((r) => r.row_data)).toEqual([
      { ambient_c: 10, type_a: 1.4, type_b: 1.0 },
      { ambient_c: 20, type_a: 1.2, type_b: 1.0 },
      { ambient_c: 30, type_a: 1.0, type_b: 1.0 },
      { ambient_c: 40, type_a: null, type_b: 0.8 },
      { ambient_c: 50, type_a: null, type_b: 0.6 },
    ])
    for (const r of rows) expect(r.citation).toMatchObject({ clause: 'Table 9.1', page_pdf: 1, page_printed: 12 })
    expect(rows[0].citation.spanned_columns).toEqual(['type_b'])
    expect(rows[3].citation.spanned_columns).toBeUndefined()
  })

  it('finds the heading, not a reference to the table', () => {
    expect(findTablePage(splitPdfText(DOC), '9.1').lineIdx).toBe(3)
  })

  it('refuses a missing expected row', () => {
    expect(() => extractTable(splitPdfText(DOC), { ...SPEC, expectedKeys: [...SPEC.expectedKeys, 60] }))
      .toThrow(/missing row\(s\) 60/)
  })

  it('refuses an unexpected row key', () => {
    expect(() => extractTable(splitPdfText(DOC), { ...SPEC, expectedKeys: [10, 20, 30, 40] }))
      .toThrow(/unexpected row key 50/)
  })

  it('refuses a stray number when no spanned band is declared', () => {
    const { spanned: _s, ...noSpan } = SPEC; void _s
    expect(() => extractTable(splitPdfText(DOC), { ...noSpan, valueColumns: noSpan.valueColumns.map((c) => ({ ...c, sparse: true })) }))
      .toThrow(/without a row key/)
  })

  it('refuses a blank required cell', () => {
    const { spanned: _s, ...noSpan } = SPEC; void _s
    const text = DOC.replace('                                                  1,0\n', '')
    expect(() => extractTable(splitPdfText(text), noSpan)).toThrow(/row 10 has no value in type_b/)
  })

  it('refuses a number that sits between two columns', () => {
    const text = DOC.replace('                 20              1,20', '                 20                      1,20')
    expect(() => extractTable(splitPdfText(text), SPEC)).toThrow(/sits between columns/)
  })

  it('refuses a missing heading', () => {
    expect(() => extractTable(splitPdfText(DOC), { ...SPEC, clause: '9.2' })).toThrow(/heading not found/)
  })
})

describe('dataset identity', () => {
  it('derives table codes from document and clause', () => {
    expect(tableCode('SANS 10142-1', 2021, '6.13')).toBe('SANS_10142_1_2021_T6_13')
    expect(tableCode('SANS 10142-1', 2017, '6.4(a)')).toBe('SANS_10142_1_2017_T6_4A')
  })

  it('reads year and edition from the document, never from config', () => {
    expect(readDocumentIdentity(DOC, 'SANS 99999-1')).toEqual({ edition: '7.2', year: 2099 })
    expect(() => readDocumentIdentity('nothing here', 'SANS 99999-1')).toThrow(/cannot read/)
  })
})

describe('crosscheck', () => {
  const MAP: CrosscheckMapping = {
    legacyCode: 'L', sansClause: '9.1', legacyKey: 'depth_mm', sansKey: 'depth_m', keyScale: 1000,
    pairs: [{ legacy: 'f', sans: 'g' }], unpaired: { x: 'manufacturer only' },
  }
  it('matches across a key scale, flags differences and uncovered rows', () => {
    const r = crosscheck(MAP,
      [{ depth_mm: 500, f: 1, x: 3 }, { depth_mm: 800, f: 0.9 }, { depth_mm: 2000, f: 0.8 }],
      [{ depth_m: 0.5, g: 1 }, { depth_m: 0.8, g: 0.95 }])
    expect(r.cells.map((c) => [c.key, c.column, c.outcome])).toEqual([
      [500, 'f', 'match'], [500, 'x', 'no_counterpart'],
      [800, 'f', 'mismatch'],
      [2000, 'f', 'no_counterpart'],
    ])
    expect([r.matched, r.mismatched, r.noCounterpart]).toEqual([1, 1, 2])
  })
})

describe('columnCoverage', () => {
  it('stops at the first row SANS does not back, per column', async () => {
    const { columnCoverage, crosscheck } = await import('./crosscheck')
    const r = crosscheck(
      { legacyCode: 'L', sansClause: '9.1', legacyKey: 'k', sansKey: 'k', pairs: [{ legacy: 'a', sans: 'a' }, { legacy: 'b', sans: 'b' }], unpaired: { x: 'n/a' } },
      [{ k: 1, a: 1, b: 1, x: 9 }, { k: 2, a: 2, b: 9 }, { k: 3, a: 3, b: 3 }, { k: 4, a: 4, b: 4 }],
      [{ k: 1, a: 1, b: 1 }, { k: 2, a: 2, b: 2 }, { k: 3, a: 3, b: 3 }],
    )
    expect(columnCoverage(r, [1, 2, 3, 4])).toEqual({
      a: { up_to: 3, whole: false, values: { 1: 1, 2: 2, 3: 3 } },   // row 4 has no SANS counterpart
      b: { up_to: 1, whole: false, values: { 1: 1, 3: 3 } },         // row 2 differs
    })                                  // x was never compared: absent, never cited
  })
})
