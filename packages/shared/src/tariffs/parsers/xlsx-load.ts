import ExcelJS from 'exceljs'
import { gridFromWorksheet, type Grid, type WorksheetLike } from './grid'

/** Workbook bytes (.xlsx or .xlsm) → one Grid per sheet, formulas as cached results. */
export async function loadWorkbookGrids(bytes: Uint8Array | ArrayBuffer): Promise<Grid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  return wb.worksheets.map((ws) => gridFromWorksheet(ws as unknown as WorksheetLike))
}
