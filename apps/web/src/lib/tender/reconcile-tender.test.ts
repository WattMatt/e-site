import { describe, it, expect } from 'vitest'
import { parseTenderWorkbook } from './parse-tender-workbook'
import { reconcileTender, toCents } from './reconcile-tender'
import { buildMvlWorkbook, buildWmWorkbook } from './__fixtures__/workbooks'

describe('toCents', () => {
  it('rounds float noise to the nearest cent', () => {
    expect(toCents(3204337.8750000005)).toBe(320433788)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(-1.005)).toBe(-101)
  })
})

describe('reconcileTender — real MVL priced BOQ', () => {
  it('matches every bill, every summary line and the subtotal to the cent', async () => {
    const r = reconcileTender(await parseTenderWorkbook(await buildMvlWorkbook()))
    expect(r.sheets.map((s) => [s.label, s.matched])).toEqual([
      ['Bill No 1', true], ['Bill No 2', true], ['Bill No 3', true], ['Bill No 4', true],
    ])
    expect(r.summaryLines.every((l) => l.matched)).toBe(true)
    expect(r.subtotal?.matched).toBe(true)
    expect(r.arithmeticErrors).toEqual([])
    expect(r.matched).toBe(true)
  })

  it('fails on a one-cent drift in a single line', async () => {
    const r = reconcileTender(await parseTenderWorkbook(await buildMvlWorkbook({ driftOn34: 0.01 })))
    const bill3 = r.sheets.find((s) => s.label === 'Bill No 3')!
    expect(bill3.matched).toBe(false)
    expect(bill3.differenceCents).toBe(-1)
    expect(r.matched).toBe(false)
    // The same drift also breaks qty × rate on that line.
    expect(r.arithmeticErrors).toEqual([
      expect.objectContaining({ sheet: 'Bill No 3', code: '3.4', quantity: 2, rate: 12000, amount: 24000.01, expected: 24000 }),
    ])
  })
})

describe('reconcileTender — WM layout', () => {
  it('matches a priced copy (provisional sums included in the bill)', async () => {
    const r = reconcileTender(await parseTenderWorkbook(await buildWmWorkbook({ priced: true })))
    expect(r.matched).toBe(true)
    expect(r.summaryLines.map((l) => l.label)).toEqual(['A', 'C'])
  })

  it('an issued (unpriced) copy reconciles its fixed sums and warns where nothing is stated', async () => {
    const r = reconcileTender(await parseTenderWorkbook(await buildWmWorkbook()))
    const c = r.sheets.find((s) => s.label === 'C - Reticulation')!
    expect(c).toMatchObject({ computed: 50000, stated: 50000, matched: true })
    const a = r.sheets.find((s) => s.label === 'A - P&G')!
    expect(a.stated).toBeNull()
    expect(r.warnings.some((w) => w.includes('A - P&G'))).toBe(true)
    expect(r.matched).toBe(true)
  })
})

describe('reconcileTender — structural failures', () => {
  it('a summary line with no matching sheet is a mismatch', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    p.sheets = p.sheets.filter((s) => s.name !== 'Bill No 3')
    const r = reconcileTender(p)
    expect(r.summaryLines.find((l) => l.label === '3')?.matched).toBe(false)
    expect(r.matched).toBe(false)
  })

  it('an unclassified priced row fails reconciliation', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    p.unclassified.push({ sheet: 'Bill No 1', rowNumber: 99, code: '', description: 'x', amount: 5, reason: 'test' })
    expect(reconcileTender(p).matched).toBe(false)
  })
})
