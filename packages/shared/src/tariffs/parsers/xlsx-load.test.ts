import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseProvinceWorkbook } from './province-xlsx'
import { loadWorkbookGrids } from './xlsx-load'
import lephalaleFx from '../__fixtures__/lp-lephalale.cells.json'
import type { CellFixture } from './grid'

describe('loadWorkbookGrids', () => {
  it('round-trips a real excerpt through exceljs, rich text included', async () => {
    const fx = lephalaleFx as CellFixture
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(fx.source.sheet)
    for (const [addr, v] of Object.entries(fx.cells)) ws.getCell(addr).value = v
    ws.getCell('D1').value = { richText: [{ text: 'rich' }, { text: ' text' }] }
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const [grid] = await loadWorkbookGrids(bytes)
    expect(grid.sheet).toBe('LEPHALALE')
    expect(grid.get(3, 2)).toBe('R1,6464/kWh')
    expect(grid.get(1, 4)).toBe('rich text')
    const [sheet] = parseProvinceWorkbook([grid], { fileSha256: 'x' })
    expect(sheet.tariffs[0].name).toBe('Domestic Prepaid & Conventional')
  })
})
