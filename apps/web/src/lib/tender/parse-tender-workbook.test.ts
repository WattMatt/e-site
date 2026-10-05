import { describe, it, expect } from 'vitest'
import { parseTenderWorkbook } from './parse-tender-workbook'
import { buildMvlWorkbook, buildWmWorkbook, MVL_BILL_TOTALS, MVL_SUBTOTAL, MVL_VAT, MVL_TOTAL } from './__fixtures__/workbooks'
import type { ParsedTenderWorkbook } from './types'

const row = (p: ParsedTenderWorkbook, sheet: string, code: string) => {
  const s = p.sheets.find((x) => x.name === sheet)
  const r = s?.rows.find((x) => x.code === code)
  if (!r) throw new Error(`row ${sheet}/${code} not found`)
  return r
}

describe('parseTenderWorkbook — MVL layout (Summary + Bill No N)', () => {
  it('reads every bill sheet with its bill code, and the summary', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    expect(p.sheets.map((s) => [s.name, s.billCode])).toEqual([
      ['Bill No 1', '1'],
      ['Bill No 2', '2'],
      ['Bill No 3', '3'],
      ['Bill No 4', '4'],
    ])
    expect(p.skippedSheets).toEqual([])
    expect(p.unclassified).toEqual([])
    expect(p.summary?.sheet).toBe('Summary')
  })

  it('takes summary amounts from the mapped amount column, not the last number on the row', async () => {
    // The P&G summary row carries a stray 0 after its amount.
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    expect(p.summary!.lines).toEqual([
      { code: '1', description: "BILL NO. 1 : P&G's", amount: MVL_BILL_TOTALS['1'] },
      { code: '2', description: 'BILL NO. 2 : ELECTRICAL RETICULATION', amount: MVL_BILL_TOTALS['2'] },
      { code: '3', description: 'BILL NO. 3 : MISCELLANEOUS', amount: MVL_BILL_TOTALS['3'] },
      { code: '4', description: 'BILL NO. 4 : CONTINGENCY', amount: MVL_BILL_TOTALS['4'] },
    ])
    expect(p.summary!.subtotalExVat).toBe(MVL_SUBTOTAL)
    expect(p.summary!.vat).toBe(MVL_VAT)
    expect(p.summary!.totalInclVat).toBe(MVL_TOTAL)
  })

  it('reads each sheet’s stated total from its carried-forward row', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    expect(p.sheets.map((s) => s.statedTotal)).toEqual([
      MVL_BILL_TOTALS['1'], MVL_BILL_TOTALS['2'], MVL_BILL_TOTALS['3'], MVL_BILL_TOTALS['4'],
    ])
    const total = p.sheets[0].rows.at(-1)!
    expect(total.kind).toBe('total')
    expect(total.amount).toBe(MVL_BILL_TOTALS['1'])
  })

  it('classifies a coded row with child codes as a heading', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    expect(row(p, 'Bill No 2', '2.1').kind).toBe('heading')
    // Has unit + qty but its children carry the prices.
    expect(row(p, 'Bill No 2', '2.1.1').kind).toBe('heading')
  })

  it('keeps a parent row that carries its own non-zero amount as an item', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    const tape = row(p, 'Bill No 2', '2.1.4')
    expect(tape.kind).toBe('item')
    expect(tape.amount).toBe(725.625)
  })

  it('keeps uncoded text rows as notes and coded unpriced descriptions as headings', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    const b1 = p.sheets[0]
    expect(b1.rows.find((r) => r.description.startsWith('Contractor’s fixed-charge'))?.kind).toBe('note')
    expect(row(p, 'Bill No 2', '2.2.8').kind).toBe('heading')
  })

  it('reads locked description, unit, quantity and the rate/amount columns', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    const r = row(p, 'Bill No 2', '2.1.3.1')
    expect(r).toMatchObject({
      kind: 'item',
      description: 'S - Supply',
      unit: 'm',
      quantity: 450,
      rate: 1148.1,
      amount: 516644.99999999994,
      rateColumn: 'F',
      amountColumn: 'G',
      rateCellType: 'priced',
      billCode: '2',
    })
    expect(r.headingPath).toEqual(['2.1', '2.1.3'])
    expect(r.rowNumber).toBe(17)
  })

  it('guesses fixed for PC rows and contingency, rate_only for a unit with no quantity', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    expect(row(p, 'Bill No 2', '2.1.7.1').rateCellType).toBe('fixed')
    expect(row(p, 'Bill No 2', '2.1.8').rateCellType).toBe('fixed')
    expect(row(p, 'Bill No 4', '4.1').rateCellType).toBe('fixed')
    expect(row(p, 'Bill No 2', '2.1.1.4').rateCellType).toBe('rate_only')
  })

  it('maps a sheet without a RATE column (amount only)', async () => {
    const p = await parseTenderWorkbook(await buildMvlWorkbook())
    const r = row(p, 'Bill No 4', '4.1')
    expect(r.rateColumn).toBeNull()
    expect(r.amountColumn).toBe('F')
    expect(r.unit).toBe('0.05')
  })
})

describe('parseTenderWorkbook — WM lettered layout', () => {
  it('skips the notes sheet and reads the MAIN SUMMARY', async () => {
    const p = await parseTenderWorkbook(await buildWmWorkbook({ priced: true }))
    expect(p.skippedSheets).toEqual(['NOTES TO TENDERER'])
    expect(p.sheets.map((s) => [s.name, s.billCode])).toEqual([
      ['A - P&G', 'A'],
      ['C - Reticulation', 'C'],
    ])
    expect(p.summary!.lines.map((l) => l.code)).toEqual(['A', 'C'])
    expect(p.summary!.subtotalExVat).not.toBeNull()
    expect(p.summary!.vat).not.toBeNull()
    expect(p.summary!.totalInclVat).not.toBeNull()
  })

  it('reads RATE ONLY as rate_only with no quantity, and a provisional sum as fixed', async () => {
    const p = await parseTenderWorkbook(await buildWmWorkbook())
    expect(row(p, 'A - P&G', 'A1.2')).toMatchObject({ kind: 'item', quantity: null, rateCellType: 'rate_only' })
    expect(row(p, 'C - Reticulation', 'C2.1')).toMatchObject({ rateCellType: 'fixed', amount: 50000 })
    expect(row(p, 'C - Reticulation', 'C1.2')).toMatchObject({ rateCellType: 'priced', rate: null, amount: null })
  })

  it('treats lettered category codes as headings', async () => {
    const p = await parseTenderWorkbook(await buildWmWorkbook())
    expect(row(p, 'C - Reticulation', 'C').kind).toBe('heading')
    expect(row(p, 'C - Reticulation', 'C1').kind).toBe('heading')
    expect(row(p, 'C - Reticulation', 'C1.1').headingPath).toEqual(['C', 'C1'])
  })
})

describe('parseTenderWorkbook — nothing is dropped silently', () => {
  it('reports an uncoded row that carries an amount', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Bill No 9')
    ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
    ws.addRow(['9.1', 'Thing', 'No', 1, 10, 10])
    ws.addRow([null, 'Mystery extra', null, null, null, 99])
    ws.addRow(['TOTAL CARRIED FORWARD', null, null, null, null, 109])
    const p = await parseTenderWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))
    expect(p.unclassified).toEqual([
      expect.objectContaining({ sheet: 'Bill No 9', rowNumber: 3, description: 'Mystery extra', amount: 99 }),
    ])
  })

  it('reads RATE ONLY even when the row has no unit', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Bill No 9')
    ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
    ws.addRow(['9.1', 'Overtime surcharge', null, 'RATE ONLY', null, null])
    const p = await parseTenderWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))
    expect(p.sheets[0].rows[0]).toMatchObject({ kind: 'item', code: '9.1', rateCellType: 'rate_only', quantity: null })
  })

  it('lists a sheet with no header row as skipped', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Cover').addRow(['Sunbird Central tender'])
    const p = await parseTenderWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))
    expect(p.skippedSheets).toEqual(['Cover'])
    expect(p.sheets).toEqual([])
  })
})
