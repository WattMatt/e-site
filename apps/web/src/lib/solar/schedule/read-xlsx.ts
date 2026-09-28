/**
 * First worksheet of an .xlsx → rows of strings. exceljs gives date cells as
 * UTC-midnight Dates, read with calendarDateFromUtc (never local getters, which
 * would move a date in SAST). Formulas read their cached result.
 */
import ExcelJS from 'exceljs'
import { calendarDateFromUtc } from '@esite/shared'

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : calendarDateFromUtc(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'boolean') return v ? 'yes' : ''
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim()
    if ('formula' in v || 'sharedFormula' in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null)
    if ('text' in v && typeof (v as { text?: unknown }).text === 'string') return String((v as { text: string }).text).trim()
    if ('error' in v) return ''
  }
  return String(v)
}

/**
 * Columns read per row. The import maps at most 17 fields; a stray cell far to
 * the right (column XFD = 16,384) would otherwise make every row walk 16,384
 * cells — 2,000 rows × 16,384 = 33M getCell calls.
 */
export const XLSX_MAX_COLUMNS = 50

/** maxRows defaults to the header + 2,000 tasks + one more, so "too many" can be detected. */
export async function readXlsxTable(buf: Buffer, maxRows = 2002): Promise<string[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const width = Math.min(ws.columnCount, XLSX_MAX_COLUMNS)
  const rows: string[][] = []
  for (let r = 1; r <= Math.min(ws.rowCount, maxRows); r++) {
    const row = ws.getRow(r)
    const out: string[] = []
    for (let c = 1; c <= width; c++) out.push(cellText(row.getCell(c).value))
    rows.push(out)
  }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop()
  return rows
}
