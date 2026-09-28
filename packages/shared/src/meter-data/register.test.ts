import { describe, it, expect } from 'vitest'
import { mapMatchMethod, parseDownloadLog, parseRegisterCsv, parseSummaryMatrix, siteKey } from './register'
import { decodeMeterText } from './text'
import { fixture, registerFixture } from './__fixtures__/load'

const text = (b: Uint8Array) => decodeMeterText(b).text

describe('siteKey', () => {
  it('drops MALL/SQUARE/CENTRE/PLAZA suffixes', () => {
    expect(siteKey('Princess Mkabayi Mall')).toBe('PRINCESSMKABAYI')
    expect(siteKey('PRINCESS MKABAYI MALL')).toBe('PRINCESSMKABAYI')
    expect(siteKey('Town Square Mall')).toBe('TOWN')
    expect(siteKey('Rustenburg')).toBe(siteKey('RUSTENBURG MALL'))
    expect(siteKey('SITE PD')).toBe('SITEPD')
  })
})

describe('consolidation summary (G)', () => {
  it('9-column export: 26 rows with match methods', () => {
    const { rows } = parseRegisterCsv(text(registerFixture('SITE YA_Consolidation_Summary.9col.csv').bytes))
    expect(rows).toHaveLength(26)
    const by = (m: string) => rows.filter((r) => r.matchMethod === m).length
    expect([by('exact'), by('llm'), by('unmapped'), by('none')]).toEqual([9, 4, 10, 3])
    expect(rows.find((r) => r.shopNo === 'SHOP 050')).toMatchObject({
      kind: 'summary', fileName: 'SA - TENANT-23.csv', tenantName: 'TENANT-23', areaM2: 3000, matchMethod: 'exact',
    })
    expect(rows.find((r) => r.tenantName === 'TENANT-22')?.shopNo).toBe('SHOP 040,04B,L4,L007B')
    expect(rows.find((r) => r.tenantName === 'TENANT-02')?.qa).toEqual({ onDrawing: 'ON DRAWING', csvOnSite: 'NO CSV' })
  })
  it('3-column tool CSV: 20 rows, no method', () => {
    const { rows } = parseRegisterCsv(text(registerFixture('SITE YA_Consolidation_Summary.csv').bytes))
    expect(rows).toHaveLength(20)
    expect(rows.every((r) => r.matchMethod === 'none')).toBe(true)
    expect(rows.find((r) => r.tenantName === 'TENANT-24')).toMatchObject({ shopNo: null, areaM2: 21 })
  })
  it('accepts a matrix with numbers and nulls (an .xls sheet)', () => {
    const { rows } = parseSummaryMatrix([
      ['Meter Filename', 'Matched Layout Name', 'Shop Number', 'Area (sqm)', 'Status'],
      ['SA - X.csv', 'X', 'SHOP 1', 12.5, 'Gemini LLM'],
      [null, null, null, null, null],
    ])
    expect(rows).toEqual([expect.objectContaining({ tenantName: 'X', areaM2: 12.5, matchMethod: 'llm' })])
  })
  it('status vocabulary', () => {
    expect([mapMatchMethod('Direct/Substring'), mapMatchMethod('Gemini LLM'), mapMatchMethod('UNMAPPED'), mapMatchMethod(null)]).toEqual(['exact', 'llm', 'unmapped', 'none'])
  })
})

describe('downloader log (E)', () => {
  it('serial → tenant, mall (last ";" part), downloaded', () => {
    const rows = parseDownloadLog(text(fixture('e-log').bytes))
    expect(rows.length).toBeGreaterThanOrEqual(30)
    expect(rows.every((r) => r.kind === 'download_log' && /^3\d{7}$/.test(r.serial ?? ''))).toBe(true)
    expect(rows[0].tenantName).toMatch(/^TENANT-E\d{3}$/)
    expect(new Set(rows.map((r) => r.mallName))).toContain('SITE TS')
  })
  it('parses the name shapes found in the corpus', () => {
    const t = 'Serial,Name,Downloaded,Timestamp\n1,A ; DB 1 ; Town Square Mall,True,2026-02-01T17:16:14.4\n2,B ; Thabazimbi Square ; MDB - 2 ; Thabazimbi Square,False,\n3,Parkdene - 3 ; Parkdene,False,\n'
    expect(parseDownloadLog(t).map((r) => [r.tenantName, r.mallName, r.downloaded])).toEqual([
      ['A', 'Town Square Mall', true], ['B', 'Thabazimbi Square', false], ['Parkdene - 3', 'Parkdene', false],
    ])
  })
})
