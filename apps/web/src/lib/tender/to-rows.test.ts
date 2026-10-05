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
    const rows = toItemRows(tender).map((r, i) => ({ ...r, id: `id-${i}` }))
    const { lines, unmatched } = toEstimateLines(rows, estimate)
    expect(unmatched).toEqual([])
    const c12 = rows.find((r) => r.code === 'C1.2')!
    expect(lines.find((l) => l.item_id === c12.id)).toEqual({ item_id: c12.id, rate: 412.5, amount: 49500 })
  })

  it('reports estimate rows the tender does not have', async () => {
    const tender = await parseTenderWorkbook(await buildWmWorkbook())
    const estimate = await parseTenderWorkbook(await buildWmWorkbook({ priced: true, addC14: true }))
    const rows = toItemRows(tender).map((r, i) => ({ ...r, id: `id-${i}` }))
    expect(toEstimateLines(rows, estimate).unmatched.map((u) => u.code)).toEqual(['C1.4'])
  })
})
