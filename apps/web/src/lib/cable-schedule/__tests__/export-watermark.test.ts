import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { stampExcelDraft } from '../export-watermark'

describe('stampExcelDraft', () => {
  it('writes DRAFT text + sets red tab color', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Test')
    stampExcelDraft(ws)
    expect(String(ws.getCell('A1').value)).toContain('DRAFT')
    expect(ws.getCell('A1').font?.color?.argb).toBe('FFDC2626')
    expect(ws.properties.tabColor?.argb).toBe('FFDC2626')
  })

  it('overrides a pre-existing A1 title + merge', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Test')
    ws.mergeCells('A1:H1')
    ws.getCell('A1').value = 'PROJECT TITLE'
    stampExcelDraft(ws)
    expect(String(ws.getCell('A1').value)).toContain('DRAFT')
  })
})
