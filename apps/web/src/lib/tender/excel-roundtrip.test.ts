import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseTenderWorkbook } from './parse-tender-workbook'
import { toItemRows } from './to-rows'
import { compareUploadedBoq, type StoredRow } from './excel-roundtrip'
import { buildWmWorkbook } from './__fixtures__/workbooks'

async function stored(): Promise<StoredRow[]> {
  const p = await parseTenderWorkbook(await buildWmWorkbook())
  return toItemRows(p).map((r, i) => ({ ...r, id: `id-${i}` }))
}

/** The issued copy with rates typed in (and optionally a tampered cell). */
async function priced(edit?: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await buildWmWorkbook()) as unknown as ArrayBuffer)
  const ws = wb.getWorksheet('C - Reticulation')!
  ws.eachRow((row) => {
    const code = row.getCell(1).value
    if (code === 'C1.1') { row.getCell(5).value = 85000; row.getCell(6).value = 85000 }
    if (code === 'C1.2') { row.getCell(5).value = 412.5; row.getCell(6).value = 49500.01 } // their amount is 1c off
    if (code === 'C1.3') { row.getCell(5).value = 1999.99; row.getCell(6).value = 7999.96 }
    if (code === 'C2.1') { row.getCell(5).value = 1 } // a rate typed into a fixed sum
  })
  const a = wb.getWorksheet('A - P&G')!
  a.eachRow((row) => {
    if (row.getCell(1).value === 'A1.1') { row.getCell(5).value = 45250; row.getCell(6).value = 45250 }
    if (row.getCell(1).value === 'A1.2') row.getCell(5).value = 450
  })
  edit?.(ws)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('compareUploadedBoq', () => {
  it('lifts the rates out of an untouched priced copy', async () => {
    const s = await stored()
    const r = compareUploadedBoq(s, await parseTenderWorkbook(await priced()))
    expect(r.ok).toBe(true)
    expect(r.changes).toEqual([])
    const byCode = Object.fromEntries(r.rates.map((x) => [s.find((i) => i.id === x.itemId)!.code, x.rate]))
    expect(byCode).toEqual({ 'A1.1': 45250, 'A1.2': 450, 'C1.1': 85000, 'C1.2': 412.5, 'C1.3': 1999.99 })
  })

  it('reports (but does not trust) the bidder’s own arithmetic', async () => {
    const r = compareUploadedBoq(await stored(), await parseTenderWorkbook(await priced()))
    expect(r.arithmetic).toEqual([expect.objectContaining({ code: 'C1.2', theirs: 49500.01, ours: 49500 })])
  })

  it('ignores a rate typed into a fixed sum', async () => {
    const r = compareUploadedBoq(await stored(), await parseTenderWorkbook(await priced()))
    expect(r.ignoredFixedRates.map((x) => x.code)).toEqual(['C2.1'])
  })

  it('refuses a changed quantity, description or unit', async () => {
    const r = compareUploadedBoq(
      await stored(),
      await parseTenderWorkbook(await priced((ws) => ws.eachRow((row) => {
        if (row.getCell(1).value === 'C1.2') { row.getCell(4).value = 100; row.getCell(2).value = 'Cheaper cable'; row.getCell(3).value = 'km' }
      }))),
    )
    expect(r.ok).toBe(false)
    expect(r.changes.map((c) => [c.code, c.field])).toEqual([
      ['C1.2', 'description'],
      ['C1.2', 'unit'],
      ['C1.2', 'quantity'],
    ])
  })

  it('refuses a deleted row (everything below shifts)', async () => {
    const r = compareUploadedBoq(await stored(), await parseTenderWorkbook(await priced((ws) => ws.spliceRows(4, 1))))
    expect(r.ok).toBe(false)
    expect(r.changes.length).toBeGreaterThan(0)
  })

  it('refuses an added item, including one that turns a priced item into a heading', async () => {
    const r = compareUploadedBoq(
      await stored(),
      await parseTenderWorkbook(await priced((ws) => {
        ws.eachRow((row) => { if (row.getCell(1).value === 'C1.3') { row.getCell(5).value = null; row.getCell(6).value = null } })
        ws.addRow(['C1.3.1', 'Extra terminations', 'No', 2, 100, 200])
      })),
    )
    expect(r.ok).toBe(false)
    expect(r.changes.map((c) => [c.code, c.field])).toEqual(expect.arrayContaining([['C1.3', 'missing row'], ['C1.3.1', 'added row']]))
  })
})
