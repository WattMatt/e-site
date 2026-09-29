import { describe, it, expect } from 'vitest'
import { parseMeterFilename } from './filename'

describe('parseMeterFilename — {SITE}, {SHOP_NO}, {LABEL}, {AREA}[ (n)]', () => {
  it('standard name with shop and area', () => {
    expect(parseMeterFilename('SITE YA, SHOP 050, TENANT-23, 3000.csv')).toEqual({
      grammar: 'standard', siteHint: 'SITE YA', shopNo: 'SHOP 050', label: 'TENANT-23',
      areaM2Hint: 3000, dupIndex: null, serialHint: null, extension: 'csv',
    })
  })
  it('blank shop and blank area', () => {
    const p = parseMeterFilename('SITE YA, , BULK METER, .csv')
    expect([p.shopNo, p.label, p.areaM2Hint]).toEqual([null, 'BULK METER', null])
  })
  it('repeat marker (n)', () => {
    const p = parseMeterFilename('SITE FL, SHOP 06, Vacant, 450 (2).csv')
    expect([p.shopNo, p.label, p.areaM2Hint, p.dupIndex]).toEqual(['SHOP 06', 'Vacant', 450, 2])
  })
  // as-is/10 §6.4 edge cases, anonymised but structurally identical.
  it('shop number containing commas ("11A,13,12")', () => {
    const p = parseMeterFilename('SITE TH, 11A,13,12, TENANT-02, 225.csv')
    expect([p.siteHint, p.shopNo, p.label, p.areaM2Hint]).toEqual(['SITE TH', '11A, 13, 12', 'TENANT-02', 225])
  })
  it('shop number with ", " and "&" (VENDA "C2, C3 & C4")', () => {
    expect(parseMeterFilename('SITE VP, C2, C3 & C4, TENANT-03, 270.csv').shopNo).toBe('C2, C3 & C4')
  })
  it('stray quote ("4-5-6)', () => {
    const p = parseMeterFilename('SITE CY, "4-5-6, TENANT-04, 272.csv')
    expect([p.shopNo, p.label, p.areaM2Hint]).toEqual(['4-5-6', 'TENANT-04', 272])
  })
  it('decimal area (BOTLOKWA 227.5)', () => {
    expect(parseMeterFilename('SITE BP, 20, TENANT-05, 227.5.csv').areaM2Hint).toBe(227.5)
  })
  it('serial embedded in the label', () => {
    expect(parseMeterFilename('SITE SG, , 30123456_DB-26, .csv').serialHint).toBe('30123456')
    expect(parseMeterFilename('SITE PM, , Meter 30654321, .csv').serialHint).toBe('30654321')
    expect(parseMeterFilename('SITE PD, , PDB_31234567_TENANT-97_22m2V, .csv').serialHint).toBe('31234567')
    expect(parseMeterFilename('SITE KM, , E9002, .csv').serialHint).toBeNull()
  })
  it('audit-tree name "<CODE> - <TENANT> <AREA>"', () => {
    expect(parseMeterFilename('RP - TENANT-06 525.csv')).toMatchObject({
      grammar: 'audit', siteHint: 'RP', label: 'TENANT-06', areaM2Hint: 525,
    })
  })
  it('anything else', () => {
    expect(parseMeterFilename('export.txt')).toMatchObject({ grammar: 'other', label: 'export', extension: 'txt' })
  })
  it('strips a directory', () => {
    expect(parseMeterFilename('org/project/SITE YA, , CHECK 1, .csv').label).toBe('CHECK 1')
  })
})
