/** A format-neutral sheet: 1-based rows/cols, cells are number | string | null. */
export type CellValue = string | number | null

export interface Grid {
  readonly sheet: string
  readonly maxRow: number
  readonly maxCol: number
  get(row: number, col: number): CellValue
}

export interface CellFixture {
  source: { file: string; sha256: string; sheet: string; rows: string }
  cells: Record<string, string | number>
}

export function colToLetters(col: number): string {
  let s = ''
  let n = col
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function lettersToCol(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

export function parseAddress(address: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/i.exec(address)
  if (!m) throw new RangeError(`not a cell address: ${address}`)
  return { row: Number(m[2]), col: lettersToCol(m[1]) }
}

/** exceljs cell value → CellValue: rich text flattened, formulas to their cached result. */
export function cellValueFromExcel(v: unknown): CellValue {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('')
    if ('result' in o) return cellValueFromExcel(o.result)
    if (typeof o.text === 'string') return o.text
  }
  return null
}

function gridFromMap(sheet: string, map: Map<string, CellValue>, maxRow: number, maxCol: number): Grid {
  return { sheet, maxRow, maxCol, get: (r, c) => map.get(`${r}:${c}`) ?? null }
}

export function gridFromCells(sheet: string, cells: Record<string, string | number>): Grid {
  const map = new Map<string, CellValue>()
  let maxRow = 0
  let maxCol = 0
  for (const [address, v] of Object.entries(cells)) {
    const { row, col } = parseAddress(address)
    map.set(`${row}:${col}`, v)
    maxRow = Math.max(maxRow, row)
    maxCol = Math.max(maxCol, col)
  }
  return gridFromMap(sheet, map, maxRow, maxCol)
}

export function gridFromFixture(fx: CellFixture): Grid {
  return gridFromCells(fx.source.sheet, fx.cells)
}

/** The subset of exceljs's Worksheet the adapter uses. */
export interface WorksheetLike {
  name: string
  rowCount: number
  columnCount: number
  getCell(row: number, col: number): { value: unknown }
}

export function gridFromWorksheet(ws: WorksheetLike): Grid {
  const map = new Map<string, CellValue>()
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = cellValueFromExcel(ws.getCell(r, c).value)
      if (v !== null && v !== '') map.set(`${r}:${c}`, v)
    }
  }
  return gridFromMap(ws.name, map, ws.rowCount, ws.columnCount)
}
