/**
 * Schedule → .xlsx using the IMPORT's column names and `#` numbering, so the
 * file can be edited and imported back (WM's export was not round-trippable).
 * Dates are written as YYYY-MM-DD text — no Excel serial, no time zone.
 * Ref, Critical and Float are read-only information; the importer ignores them.
 */
import ExcelJS from 'exceljs'
import { GANTT_STATUS_LABELS, criticalPath, spanDays, type WorkCalendar } from '@esite/shared'
import type { ScheduleData } from './types'

export const XLSX_HEADERS = [
  '#', 'Task', 'Category', 'Zone', 'Start', 'End', 'Duration', 'Owner', 'Progress', 'Status', 'Milestone',
  'Predecessors', 'Notes', 'Colour', 'Ref', 'Critical', 'Float (days)',
] as const

const lagText = (n: number) => (n > 0 ? `+${n}d` : n < 0 ? `${n}d` : '')

export async function exportScheduleXlsx(data: ScheduleData, cal: WorkCalendar): Promise<Buffer> {
  const tasks = [...data.tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  const pos = new Map(tasks.map((t, i) => [t.id, i + 1]))
  const cpm = criticalPath(tasks, data.links, cal)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site'
  const ws = wb.addWorksheet('Tasks', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.addRow([...XLSX_HEADERS])
  ws.getRow(1).font = { bold: true }
  for (const t of tasks) {
    const preds = data.links
      .filter((l) => l.successorId === t.id && pos.has(l.predecessorId))
      .sort((a, b) => pos.get(a.predecessorId)! - pos.get(b.predecessorId)!)
      .map((l) => `${pos.get(l.predecessorId)}${l.type}${lagText(l.lagDays)}`)
      .join(', ')
    ws.addRow([
      pos.get(t.id), t.name, t.category, t.zone, t.start, t.end,
      t.isMilestone ? 0 : spanDays(cal, t.start, t.end), t.ownerName, t.progress,
      GANTT_STATUS_LABELS[t.status], t.isMilestone ? 'Yes' : '', preds, t.description, t.colour, t.ref,
      cpm.ok && cpm.critical.has(t.id) ? 'Yes' : '', cpm.ok ? cpm.totalFloat.get(t.id) ?? '' : '',
    ])
  }
  // Start/End as text cells: a reader cannot turn them into a serial or shift them by a zone.
  ws.getColumn(5).numFmt = '@'
  ws.getColumn(6).numFmt = '@'
  ws.columns.forEach((c, i) => { c.width = [5, 40, 18, 14, 12, 12, 9, 22, 9, 13, 10, 18, 30, 9, 11, 9, 11][i] ?? 12 })
  return Buffer.from(await wb.xlsx.writeBuffer())
}
