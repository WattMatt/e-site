import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { isNumberLike, sanitiseWorkbookForBidder } from './bidder-workbook'
import { parseTenderWorkbook } from './parse-tender-workbook'
import { toItemRows } from './to-rows'
import { compareUploadedBoq } from './excel-roundtrip'
import { buildWmWorkbook } from './__fixtures__/workbooks'

// Every figure WM priced in the PRE-PRICED fixture (rates, amounts, bill and summary totals).
const WM_FIGURES = [85000, 412.5, 49500, 1999.99, 7999.96, 45250, 450, 170000]

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  return wb
}

function allValues(wb: ExcelJS.Workbook) {
  const out: unknown[] = []
  for (const ws of wb.worksheets) ws.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (c) => out.push(c.value)))
  return out
}

async function pricedWithExtras() {
  const src = await buildWmWorkbook({ priced: true })
  const items = toItemRows(await parseTenderWorkbook(src))
  const wb = await load(src)
  const ret = wb.getWorksheet('C - Reticulation')!
  ret.getCell('E4').note = 'WM: rate from supplier quote, 18% margin'
  ret.getCell('H4').value = { formula: 'F4*2', result: 170000 } // a working right of AMOUNT
  ret.getColumn('G').hidden = true
  ret.getCell('G5').value = 'cost 350'
  const hidden = wb.addWorksheet('WM workings')
  hidden.state = 'veryHidden'
  hidden.addRow(['secret margin', 0.18])
  wb.definedNames.add("'C - Reticulation'!$E$4", 'C11_RATE')
  wb.company = 'WM Consulting'
  wb.title = 'PRICED ESTIMATE R9'
  ret.getRow(5).hidden = true // a collapsed outline row holding item C1.2
  wb.getWorksheet('MAIN SUMMARY')!.addRow(['', 'Estimate total', 'R 1 234 567,00'])
  return { wb, items }
}

describe('sanitiseWorkbookForBidder', () => {
  it('leaves none of WM’s figures, workings, comments or names in the bidder’s copy', async () => {
    const { wb, items } = await pricedWithExtras()
    const { removedSheets } = sanitiseWorkbookForBidder(wb, items)
    expect(removedSheets).toEqual(['WM workings'])
    const out = await load(Buffer.from(await wb.xlsx.writeBuffer()))
    const values = allValues(out)
    for (const f of WM_FIGURES) expect(values).not.toContain(f)
    expect(values.some((v) => typeof v === 'object' && v !== null && 'formula' in (v as object))).toBe(false)
    expect(values).not.toContain('cost 350')
    expect(out.getWorksheet('C - Reticulation')!.getCell('E4').note).toBeUndefined()
    expect(out.definedNames.model).toEqual([])
    expect(values).not.toContain('R 1 234 567,00')
    expect(out.company ?? '').toBe('')
    expect(out.title ?? '').toBe('')
  })

  it('clears SUPPLY and INSTALL rates too: every figure outside the locked columns goes', async () => {
    const src = new ExcelJS.Workbook()
    const ws = src.addWorksheet('E - Lighting')
    ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'SUPPLY', 'INSTALL', 'RATE', 'AMOUNT'])
    ws.addRow(['E', 'LIGHTING'])
    ws.addRow(['E1.1', 'LED panel 600x600', 'No', 40, 812.5, 95, 907.5, 36300])
    ws.addRow(['E1.2', 'Emergency fitting', 'No', 12, 1400, 120, 1520, 18240])
    const buf = Buffer.from(await src.xlsx.writeBuffer())
    const items = toItemRows(await parseTenderWorkbook(buf))
    expect(items.filter((i) => i.kind === 'item')).toHaveLength(2)
    const wb = await load(buf)
    sanitiseWorkbookForBidder(wb, items)
    const out = await load(Buffer.from(await wb.xlsx.writeBuffer()))
    const values = allValues(out)
    for (const f of [812.5, 95, 907.5, 36300, 1400, 120, 1520, 18240]) expect(values).not.toContain(f)
    for (const keep of ['E1.1', 'LED panel 600x600', 'No', 40, 12]) expect(values).toContain(keep)
  })

  it('clears a figure in a locked column on any row that is not a stored item or heading', async () => {
    const src = new ExcelJS.Workbook()
    const ws = src.addWorksheet('F - Earthing')
    ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
    ws.addRow(['F', 'EARTHING'])
    ws.addRow(['F1.1', 'Earth electrode', 'No', 6, 1200, 7200])
    ws.addRow([null, 'Build-up: labour hours per electrode', null, 2.75, null, null]) // WM's working
    ws.getRow(4).hidden = true
    ws.addRow(['F1.2', 'Bonding conductor', 'm', 120.33333, 85, 10228.33])
    ws.addRow([null, 'TOTAL CARRIED TO SUMMARY', null, 17428.33, null, null]) // a total parked in QTY
    const buf = Buffer.from(await src.xlsx.writeBuffer())
    const items = toItemRows(await parseTenderWorkbook(buf))
    const wb = await load(buf)
    sanitiseWorkbookForBidder(wb, items)
    const out = await load(Buffer.from(await wb.xlsx.writeBuffer()))
    const values = allValues(out)
    for (const f of [2.75, 17428.33, 1200, 85, 7200, 10228.33]) expect(values).not.toContain(f)
    expect(values).not.toContain('Build-up: labour hours per electrode')
    expect(values).toContain(6)
    expect(values).toContain(120.33333) // more decimals than the 4 stored: still recognised as the QTY column
  })

  it('finds the QTY column on a sheet of mostly rate-only items', async () => {
    const src = new ExcelJS.Workbook()
    const ws = src.addWorksheet('D - Dayworks')
    ws.addRow(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'])
    ws.addRow(['D', 'DAYWORKS'])
    ws.addRow(['D1.1', 'Electrician', 'hr', 'RATE ONLY', 450, null])
    ws.addRow(['D1.2', 'Assistant', 'hr', 'RATE ONLY', 250, null])
    ws.addRow(['D1.3', 'Labourer', 'hr', 'RATE ONLY', 180, null])
    ws.addRow(['D1.4', 'Allowance for overtime', 'Sum', 1, 15000, 15000])
    const buf = Buffer.from(await src.xlsx.writeBuffer())
    const items = toItemRows(await parseTenderWorkbook(buf))
    const wb = await load(buf)
    sanitiseWorkbookForBidder(wb, items)
    const parsed = await parseTenderWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))
    const result = compareUploadedBoq(items.map((r, i) => ({ ...r, id: `id-${i}` })), parsed)
    expect(result.changes).toEqual([])
    const values = allValues(wb)
    for (const f of [450, 250, 180, 15000]) expect(values).not.toContain(f)
  })

  it('reads currency and percentage text as figures, words as words', () => {
    for (const v of ['R 1 234 567,00', '1 234.50', '15 %', '-3', 12]) expect(isNumberLike(v)).toBe(true)
    for (const v of ['1. Tenderers shall price every item.', 'RATE ONLY', 'PC Sum', '', null]) expect(isNumberLike(v as never)).toBe(false)
  })

  it('keeps what a bidder needs: notes, descriptions, quantities and the fixed sums', async () => {
    const { wb, items } = await pricedWithExtras()
    sanitiseWorkbookForBidder(wb, items)
    const out = await load(Buffer.from(await wb.xlsx.writeBuffer()))
    const values = allValues(out)
    expect(values).toContain('1. Tenderers shall price every item.')
    expect(values).toContain('95mm² 4c PVC SWA Cu cable, supply and install')
    expect(values).toContain(120)
    expect(values).toContain(50000) // the provisional sum is issued to every bidder
    expect(out.worksheets.map((s) => s.name)).toContain('MAIN SUMMARY')
  })

  it('round-trips: the sanitised copy, priced by a bidder, is accepted with no locked-cell change', async () => {
    const { wb, items } = await pricedWithExtras()
    sanitiseWorkbookForBidder(wb, items)
    const ret = wb.getWorksheet('C - Reticulation')!
    ret.eachRow((row) => { if (row.getCell(1).value === 'C1.2') row.getCell(5).value = 399 })
    const parsed = await parseTenderWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))
    const stored = items.map((r, i) => ({ ...r, id: `id-${i}` }))
    const result = compareUploadedBoq(stored, parsed)
    expect(result.changes).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.rates.find((r) => r.rate === 399)).toBeTruthy()
  })
})
