import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { sha256Hex } from './hash'
import { parseMeterWorkbook } from './workbook'

async function book(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('PnP')
  ws.addRow(['pnpscada.com', '30000002'])
  ws.addRow(['P (per kW)', 'Q (per kvar)', 'S (per kVA)', 'scalar sum S (per kVA)', 'DATE', 'TIME', 'STATUS', 'kwh tenant'])
  for (let i = 0; i < 4; i++) {
    ws.addRow([10 + i, 1, 10 + i, 10 + i, '2025-03-10', `${String(i + 1).padStart(2, '0')}:00:00`, 'Ok', { formula: `A${i + 3}+A${i + 4}` }])
  }
  const notes = wb.addWorksheet('Notes')
  notes.addRow(['Average of kwh'])
  notes.addRow(['by time of day'])
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

describe('parseMeterWorkbook', () => {
  it('reads each sheet; formula columns are dropped and warned', async () => {
    const bytes = await book()
    const sheets = await parseMeterWorkbook({ bytes, fileName: 'SITE PD, , PDB_30000002_TENANT-97, .xlsx' })
    expect(sheets.map((s) => s.sheetName)).toEqual(['PnP', 'Notes'])

    const pnp = sheets[0]
    expect(pnp.formulaColumns).toEqual(['H'])
    expect(pnp.outcome.kind).toBe('series')
    if (pnp.outcome.kind !== 'series') return
    expect(pnp.outcome.format).toBe('B')
    expect(pnp.outcome.channels.map((c) => c.spec.sourceColumn)).toEqual(['P (per kW)', 'Q (per kvar)', 'S (per kVA)', 'scalar sum S (per kVA)'])
    expect(pnp.outcome.report.warnings.map((w) => w.code)).toContain('formula_columns')
    expect(pnp.outcome.fileSha256).toBe(await sha256Hex(bytes))

    expect(sheets[1].outcome.kind).toBe('rejected')
  })
})
