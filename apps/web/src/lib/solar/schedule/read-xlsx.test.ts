// @vitest-environment node
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { readXlsxTable } from './read-xlsx'

async function book(fill: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  fill(wb.addWorksheet('Tasks'))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('readXlsxTable', () => {
  it('reads strings, numbers, real date cells (no SAST drift), rich text, formulas and blanks', async () => {
    const buf = await book((ws) => {
      ws.addRow(['Task', 'Start', 'Progress', 'Notes'])
      ws.addRow(['Design', new Date(Date.UTC(2026, 9, 1)), 0.5, { richText: [{ text: 'Rich ' }, { text: 'text' }] }])
      ws.addRow(['Install', '2026-10-06', { formula: '1+1', result: 2 }, null])
      ws.addRow([])
    })
    expect(await readXlsxTable(buf)).toEqual([
      ['Task', 'Start', 'Progress', 'Notes'],
      ['Design', '2026-10-01', '0.5', 'Rich text'],
      ['Install', '2026-10-06', '2', ''],
    ])
  })
  it('an empty workbook is an empty table', async () => {
    expect(await readXlsxTable(await book(() => {}))).toEqual([])
  })
  it('stops at maxRows', async () => {
    const buf = await book((ws) => { for (let i = 0; i < 10; i++) ws.addRow([`r${i}`]) })
    expect(await readXlsxTable(buf, 3)).toEqual([['r0'], ['r1'], ['r2']])
  })
})
