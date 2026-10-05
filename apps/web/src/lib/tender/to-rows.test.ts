import { describe, it, expect } from 'vitest'
import { parseTenderWorkbook } from './parse-tender-workbook'
import { toItemRows, toEstimateLines } from './to-rows'
import { buildMvlWorkbook, buildWmWorkbook } from './__fixtures__/workbooks'

describe('toItemRows', () => {
  it('keeps every parsed row, in sheet order, with a unique (sheet,row) key', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    const rows = toItemRows(p)
    const parsedCount = p.sheets.reduce((n, s) => n + s.rows.length, 0)
    expect(rows).toHaveLength(parsedCount)
    expect(rows.map((r) => r.sort_order)).toEqual(rows.map((_, i) => i))
    expect(new Set(rows.map((r) => `${r.sheet_name}!${r.row_number}`)).size).toBe(rows.length)
  })

  it('leaves a fixed row without an amount NULL, never R0', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook({ unpriced: true }))
    // 2.1.7.1 is a PC row; the non-null path is covered by C2.1 (R50 000) below.
    const row = p.sheets[1].rows.find((r) => r.code === '2.1.7.1')!
    row.amount = null
    expect(toItemRows(p).find((r) => r.code === '2.1.7.1')!.fixed_amount).toBeNull()
  })

  it('maps item, fixed, total and heading rows onto the table columns', async () => {
    const p = await parseTenderWorkbook(await buildWmWorkbook())
    const rows = toItemRows(p)
    const ps = rows.find((r) => r.code === 'C2.1')!
    expect(ps).toMatchObject({ kind: 'item', rate_cell_type: 'fixed', fixed_amount: 50000, amount_column: 'F', rate_column: 'E' })
    const priced = rows.find((r) => r.code === 'C1.2')!
    expect(priced).toMatchObject({ rate_cell_type: 'priced', fixed_amount: null, quantity: 120, unit: 'm' })
    const heading = rows.find((r) => r.code === 'C1')!
    expect(heading).toMatchObject({ kind: 'heading', rate_cell_type: null, rate_column: null })
    const total = rows.find((r) => r.kind === 'total' && r.sheet_name === 'C - Reticulation')!
    expect(total.stated_amount).toBe(50000)
  })
})

describe('toEstimateLines', () => {
  it('pairs every priced estimate row with its tender row by sheet + code', async () => {
    const tender = await parseTenderWorkbook(await buildWmWorkbook())
    const estimate = await parseTenderWorkbook(await buildWmWorkbook({ priced: true }))
    const rows = toItemRows(tender)
    const { lines, unmatched } = toEstimateLines(rows, estimate)
    expect(unmatched).toEqual([])
    const c12 = rows.find((r) => r.code === 'C1.2')!
    expect(lines.find((l) => l.row_number === c12.row_number && l.sheet_name === c12.sheet_name)).toEqual({
      sheet_name: 'C - Reticulation', row_number: c12.row_number, rate: 412.5, amount: 49500,
    })
  })

  it('reports estimate rows the tender does not have', async () => {
    const tender = await parseTenderWorkbook(await buildWmWorkbook())
    const estimate = await parseTenderWorkbook(await buildWmWorkbook({ priced: true, addC14: true }))
    const rows = toItemRows(tender)
    expect(toEstimateLines(rows, estimate).unmatched.map((u) => u.code)).toEqual(['C1.4'])
  })
})
