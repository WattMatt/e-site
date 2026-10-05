import { describe, it, expect } from 'vitest'
import { parseTenderWorkbook } from './parse-tender-workbook'
import { toItemRows } from './to-rows'
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

// ─── Review findings (2026-10-05) ───────────────────────────────────────────

async function sheetBook(build: (wb: import('exceljs').Workbook) => void): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  build(wb)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('parseTenderWorkbook — real-world quirks', () => {
  it('keeps the trailing zero of a code typed as a number with a 0.00 format', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow([1.1, 'First', 'No', 1, null, null]).getCell(1).numFmt = '0.00'
      ws.addRow([1.1, 'Tenth', 'No', 1, null, null]).getCell(1).numFmt = '0.0'
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].rows.map((r) => r.code)).toEqual(['1.10', '1.1'])
  })

  it('accepts a DESCRIPTION OF WORK header', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION OF WORK', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Thing', 'No', 1, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].rows[0]).toMatchObject({ code: '1.1', kind: 'item' })
  })

  it('skips hidden sheets and reports any skipped sheet that holds numbers', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Thing', 'No', 1, null, null])
      const hid = wb.addWorksheet('Workings')
      hid.state = 'hidden'
      hid.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY'])
      hid.addRow(['9.9', 'Secret', 'No', 3])
      wb.addWorksheet('Odd layout').addRow(['Cable', 'm', 120, 55.5])
      wb.addWorksheet('Cover').addRow(['Sunbird Central'])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets.map((s) => s.name)).toEqual(['Bill No 1'])
    expect(p.skippedSheets).toEqual(['Workings', 'Odd layout', 'Cover'])
    // Hidden workings are expected in an internal estimate: skipped and named, not a failure.
    expect(p.hiddenSheets).toEqual(['Workings'])
    expect(p.skippedPricedSheets).toEqual(['Odd layout'])
  })

  it('reports an uncoded row that has a unit or quantity (it would need a price)', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow([null, 'a) 16mm conduit', 'm', 120, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.unclassified).toEqual([expect.objectContaining({ rowNumber: 2, description: 'a) 16mm conduit' })])
  })

  it('does not mistake a coded item whose description starts with Total for a total row', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Total station survey of the bill area', 'day', 2, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].rows[0]).toMatchObject({ kind: 'item', code: '1.1' })
  })

  it('treats page carried/brought-forward rows as carry rows, not prices', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'A', 'No', 1, 100, 100])
      ws.addRow([null, 'CARRIED FORWARD', null, null, null, 100])
      ws.addRow([null, 'BROUGHT FORWARD', null, null, null, 100])
      ws.addRow(['1.2', 'B', 'No', 1, 50, 50])
      ws.addRow(['TOTAL CARRIED TO SUMMARY', null, null, null, null, 150])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.unclassified).toEqual([])
    expect(p.sheets[0].statedTotal).toBe(150)
    expect(p.sheets[0].rows.filter((r) => r.kind === 'item').map((r) => r.code)).toEqual(['1.1', '1.2'])
  })

  it('ignores a recap block that repeats codes after the bill total', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 2')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['2.1', 'Section one'])
      ws.addRow(['2.1.1', 'A', 'No', 1, 100, 100])
      ws.addRow(['2.2', 'Section two'])
      ws.addRow(['2.2.1', 'B', 'No', 1, 50, 50])
      ws.addRow(['TOTAL FOR BILL NO 2 - CARRIED TO SUMMARY', null, null, null, null, 150])
      ws.addRow([null, 'BILL SUMMARY'])
      ws.addRow(['2.1', 'Section one', null, null, null, 100])
      ws.addRow(['2.2', 'Section two', null, null, null, 50])
    })
    const p = await parseTenderWorkbook(buf)
    const items = p.sheets[0].rows.filter((r) => r.kind === 'item')
    expect(items.map((r) => r.code)).toEqual(['2.1.1', '2.2.1'])
    expect(p.sheets[0].statedTotal).toBe(150)
  })

  it('is conservative about fixed sums', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 3')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['3.1', 'PC socket outlet, double', 'No', 12, null, null])
      ws.addRow(['3.2', 'Provisional quantity: trenching in rock', 'm', 30, null, null])
      ws.addRow(['3.3', 'Provisional quantities'])
      ws.addRow(['3.3.1', 'Extra conduit', 'm', 50, null, null])
      ws.addRow(['3.4', 'Provisional sums'])
      ws.addRow(['3.4.1', 'Eskom connection fee', 'Sum', 1, null, 250000])
      ws.addRow(['3.5', 'Prime cost sum for luminaires', 'Sum', 1, null, 80000])
    })
    const p = await parseTenderWorkbook(buf)
    const t = Object.fromEntries(p.sheets[0].rows.filter((r) => r.kind === 'item').map((r) => [r.code, r.rateCellType]))
    expect(t).toEqual({ '3.1': 'priced', '3.2': 'priced', '3.3.1': 'priced', '3.4.1': 'fixed', '3.5': 'fixed' })
  })

  it('reads only the top-left cell of a merged range', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Notes about the installation spanning columns'])
      ws.mergeCells('B2:D2')
      ws.addRow(['1.1.1', 'Thing', 'No', 1, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].rows[0]).toMatchObject({ code: '1.1', kind: 'heading', unit: null })
  })
})

describe('parseTenderWorkbook — second review', () => {
  it('does not take a title row containing DESCRIPTION as the header', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['PROJECT DESCRIPTION', 'Sunbird Central'])
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Thing', 'No', 1, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].headerRowNumber).toBe(2)
    expect(p.sheets[0].rows[0]).toMatchObject({ code: '1.1', kind: 'item', unit: 'No' })
  })

  it('reports a second summary sheet that is laid out like a bill and holds numbers', async () => {
    const buf = await sheetBook((wb) => {
      const ms = wb.addWorksheet('MAIN SUMMARY')
      ms.addRow(['ITEM', 'DESCRIPTION', 'AMOUNT'])
      ms.addRow(['1', 'Bill 1', 10])
      const b = wb.addWorksheet('Bill 3 - Summary & Daywork')
      b.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      b.addRow(['3.1', 'Labourer', 'hr', 10, 50, 500])
      const sub = wb.addWorksheet('MALL SUMMARY')
      sub.addRow(['ITEM', 'DESCRIPTION', 'AMOUNT'])
      sub.addRow(['1', 'Section', 10])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.skippedPricedSheets).toEqual(['Bill 3 - Summary & Daywork'])
    expect(p.skippedSheets).toContain('MALL SUMMARY')
  })

  it('counts priced recap rows after the bill total so they can be checked', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 2')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['2.1', 'A', 'No', 1, 100, 100])
      ws.addRow(['TOTAL CARRIED TO SUMMARY', null, null, null, null, 100])
      ws.addRow([null, 'Something priced after the total', null, null, null, 75])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].recapPricedRows).toEqual([{ rowNumber: 4, description: 'Something priced after the total', amount: 75 }])
  })

  it('reads lowercase pc as pieces, uppercase PC as a prime cost', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Cable ties', 'pc', 200, null, null])
      ws.addRow(['1.2', 'Allowance for drilling', 'PC', 1, null, 15000])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].rows.map((r) => r.rateCellType)).toEqual(['priced', 'fixed'])
  })
})

describe('parseTenderWorkbook — total wording in the ITEM column', () => {
  it('reads TOTAL CARRIED TO SUMMARY in the ITEM column as a total even when QTY holds a number', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Thing', 'No', 1, null, null])
      ws.addRow(['TOTAL CARRIED TO SUMMARY', null, null, 17428.33, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    const rows = toItemRows(p)
    expect(rows.filter((r) => r.kind === 'item').map((r) => r.code)).toEqual(['1.1'])
    expect(rows[1]).toMatchObject({ kind: 'total', code: null, description: 'TOTAL CARRIED TO SUMMARY', stated_amount: 17428.33 })
    expect(p.sheets[0].statedTotal).toBe(17428.33)
  })

  it('reads collection wording in the ITEM column as a total whatever QTY holds', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Thing', 'No', 1, null, null])
      ws.addRow(['PAGE TOTAL CARRIED TO COLLECTION', null, null, 5000, null, null])
      ws.addRow(['1.2', 'Other', 'No', 1, null, null])
      ws.addRow(['PAGE TOTAL TO COLLECTION', null, 'Sum', 900, null, null])
      ws.addRow(['COLLECTION', null, null, 5900, null, null])
    })
    const rows = toItemRows(await parseTenderWorkbook(buf))
    expect(rows.filter((r) => r.kind === 'item').map((r) => r.code)).toEqual(['1.1', '1.2'])
    expect(rows.filter((r) => r.kind === 'total').map((r) => r.stated_amount)).toEqual([5000, 900, 5900])
  })

  it('never makes a digitless sentence in the ITEM column an item code', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['1.1', 'Thing', 'No', 1, null, null])
      ws.addRow(['Allow for testing and commissioning', null, 'Sum', 1, null, null])
      ws.addRow(['General notes apply to all items'])
    })
    const p = await parseTenderWorkbook(buf)
    const rows = toItemRows(p)
    expect(rows.filter((r) => r.kind === 'item').map((r) => r.code)).toEqual(['1.1'])
    expect(rows.some((r) => r.code != null && /[a-z]{2,} [a-z]{2,}/i.test(r.code))).toBe(false)
    // Not dropped: the unit/quantity row is reported, the bare text is a note.
    expect(p.unclassified).toEqual([
      expect.objectContaining({ rowNumber: 3, description: 'Allow for testing and commissioning', reason: 'row has a unit or quantity but no item code' }),
    ])
    expect(rows.find((r) => r.row_number === 4)).toMatchObject({ kind: 'note', code: null, description: 'General notes apply to all items' })
  })

  it('does not take a bill code from a sentence in the ITEM column', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Electrical')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['General notes apply'])
      ws.addRow(['5.1', 'Thing', 'No', 1, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].billCode).toBe('5')
  })

  it('still reads short lettered codes as codes', async () => {
    const buf = await sheetBook((wb) => {
      const ws = wb.addWorksheet('Bill No 1')
      ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
      ws.addRow(['AB', 'Daywork allowance', 'Sum', 1, null, null])
    })
    const p = await parseTenderWorkbook(buf)
    expect(p.sheets[0].rows[0]).toMatchObject({ kind: 'item', code: 'AB' })
  })
})
