/**
 * .xlsx meter workbooks: each sheet is written back to CSV text and sniffed with the same rules.
 * Formula columns are hand-added analysis (as-is/10 N7) and are never imported.
 */
import ExcelJS, { type CellValue } from 'exceljs'
import { sha256Hex } from './hash'
import { parseMeterFile, type MeterParseOutcome, type ParseOptions } from './parse-meter-file'
import { issue } from './report'

export interface WorkbookSheetOutcome {
  sheetName: string
  formulaColumns: string[]
  outcome: MeterParseOutcome
}

const pad = (n: number) => String(n).padStart(2, '0')

function colLetter(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const r = (x - 1) % 26
    s = String.fromCharCode(65 + r) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') return v
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`
  }
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('')
  if (typeof v === 'object' && 'result' in v) return cellText((v as { result?: CellValue }).result ?? null)
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text)
  return ''
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export async function parseMeterWorkbook(input: { bytes: Uint8Array; fileName: string; options?: ParseOptions }): Promise<WorkbookSheetOutcome[]> {
  const workbookSha = await sha256Hex(input.bytes)
  const wb = new ExcelJS.Workbook()
  const copy = new Uint8Array(input.bytes.byteLength)
  copy.set(input.bytes)
  // exceljs types declare Buffer; an ArrayBuffer is accepted at runtime in Node and the browser.
  await wb.xlsx.load(copy.buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const csvName = input.fileName.replace(/\.xlsx$/i, '.csv')
  const out: WorkbookSheetOutcome[] = []
  for (const ws of wb.worksheets) {
    const formulaCols = new Set<number>()
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (cell.type === ExcelJS.ValueType.Formula) formulaCols.add(col)
      })
    })
    const lines: string[] = []
    ws.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = []
      for (let col = 1; col <= ws.columnCount; col++) {
        if (formulaCols.has(col)) continue
        cells.push(csvCell(cellText(row.getCell(col).value)))
      }
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
      lines.push(cells.join(','))
    })
    const outcome = await parseMeterFile({ bytes: new TextEncoder().encode(lines.join('\n') + '\n'), fileName: csvName, options: input.options })
    outcome.fileSha256 = workbookSha
    const formulaColumns = [...formulaCols].sort((a, b) => a - b).map(colLetter)
    if (formulaColumns.length > 0) {
      outcome.report.warnings.push(issue('formula_columns', `Formula column(s) ${formulaColumns.join(', ')} were left out: hand-added analysis is not meter data.`))
    }
    out.push({ sheetName: ws.name, formulaColumns, outcome })
  }
  return out
}
