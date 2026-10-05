import 'server-only'
/** The Load profile workbook: one sheet per table of the export model, numbers kept as numbers. */
import ExcelJS from 'exceljs'
import type { ExportModel, Table } from './export-model'

function addTable(wb: ExcelJS.Workbook, name: string, t: Table) {
  const ws = wb.addWorksheet(name)
  ws.addRow([t.title]).font = { bold: true, size: 12 }
  ws.addRow([])
  const head = ws.addRow(t.header)
  head.font = { bold: true }
  for (const row of t.rows) ws.addRow(row.map((c) => (c === null ? '' : c)))
  ws.columns.forEach((c, i) => { c.width = Math.min(48, Math.max(10, t.header[i]?.length ?? 10) + 2) })
  ws.views = [{ state: 'frozen', ySplit: 3 }]
}

export async function buildLoadProfileWorkbook(m: ExportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site'
  const s = wb.addWorksheet('Summary')
  s.addRow([m.title]).font = { bold: true, size: 14 }
  s.addRow([m.subtitle])
  s.addRow([])
  s.addRow(['Figure', 'Value', 'Unit / basis']).font = { bold: true }
  for (const [label, value, unit] of m.kpis) s.addRow([label, value ?? '', unit])
  s.addRow([])
  s.addRow(['Notes']).font = { bold: true }
  for (const n of m.notes) s.addRow([n])
  s.getColumn(1).width = 30
  s.getColumn(2).width = 16
  s.getColumn(3).width = 70
  addTable(wb, 'Monthly', m.monthly)
  if (m.cost) addTable(wb, 'TOU split', m.cost)
  if (m.costLines) addTable(wb, 'Bill lines', m.costLines)
  addTable(wb, 'Average day', m.averageDays)
  addTable(wb, 'Load duration', m.ldc)
  addTable(wb, 'Sources', m.sources)
  if (m.hourly) addTable(wb, 'Hourly', m.hourly)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
