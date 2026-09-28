/**
 * Copies ONLY the cells the parser tests need out of the real NERSA/Eskom books
 * into small JSON fixtures, plus a pdftotext excerpt of one 2026/27 RfD.
 *   TARIFF_SOURCE_DIR="…/005. NERSA TARIFFS" \
 *     pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/extract-fixture-cells.ts
 * Re-running overwrites the fixtures byte-for-byte from the same sources.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { cellValueFromExcel, colToLetters } from '../../packages/shared/src/tariffs/parsers/grid.ts'

const SRC = process.env.TARIFF_SOURCE_DIR
if (!SRC) {
  console.error('Set TARIFF_SOURCE_DIR to the "005. NERSA TARIFFS" folder.')
  process.exit(1)
}
const OUT = resolve(import.meta.dirname, '../../packages/shared/src/tariffs/__fixtures__')
const ESKOM_2025 = 'ESKOM/Eskom-tariffs-1-April-2025-ver-2.xlsm'
const ESKOM_2026 = '2026-27/ESKOM/Eskom-tariffs-1-April-2026-Public.xlsm'

interface Spec { out: string; file: string; sheet: string; rows: [number, number][] }
const SPECS: Spec[] = [
  { out: 'gp-city-power', file: '2025/Gauteng-Province.xlsx', sheet: 'CITY POWER', rows: [[1, 160]] },
  { out: 'gp-ekurhuleni', file: '2025/Gauteng-Province.xlsx', sheet: 'CITY OF EKURHULENI', rows: [[1, 11]] },
  { out: 'lp-lephalale', file: '2025/Limpopo-Province.xlsx', sheet: 'LEPHALALE', rows: [[1, 7]] },
  { out: 'ec-buffalo-city', file: '2025/Eastern-Cape-Province.xlsx', sheet: 'BUFFALO CITY', rows: [[1, 81]] },
  { out: 'ec-nmb', file: '2025/Eastern-Cape-Province.xlsx', sheet: 'NELSON MANDELLA BAY METRO', rows: [[1, 1], [43, 48]] },
  { out: 'wc-cape-town', file: '2025/Western-Cape-Province1.xlsx', sheet: 'CITY OF CAPE ', rows: [[1, 1], [55, 72]] },
  { out: 'fs-maluti', file: '2025/Free-State-Province.xlsx', sheet: 'MALUTI A PHOFUNG', rows: [[1, 19]] },
  { out: 'fs-centlec-kopanong', file: '2025/Free-State-Province.xlsx', sheet: 'CENTLEC - KOPANONG', rows: [[1, 1], [175, 186]] },
  { out: 'nc-gamagara', file: '2025/Northern-Cape-Province.xlsx', sheet: 'GAMAGARA', rows: [[1, 23]] },
  { out: 'eskom-2025-homeflex', file: ESKOM_2025, sheet: 'Homeflex NLA', rows: [[1, 22]] },
  { out: 'eskom-2025-gen-offset', file: ESKOM_2025, sheet: 'Gen-offset', rows: [[1, 50]] },
  { out: 'eskom-2025-loss-factors', file: ESKOM_2025, sheet: 'Loss Factors', rows: [[1, 19]] },
  { out: 'eskom-2025-businessrate', file: ESKOM_2025, sheet: 'Businessrate NLA', rows: [[1, 11]] },
  { out: 'eskom-2025-megaflex', file: ESKOM_2025, sheet: 'Megaflex NLA', rows: [[1, 12]] },
  { out: 'eskom-2026-homeflex', file: ESKOM_2026, sheet: 'Homeflex NLA', rows: [[1, 22]] },
  { out: 'eskom-2026-gen-offset', file: ESKOM_2026, sheet: 'Gen-offset', rows: [[1, 50]] },
]

const RFD = '2026-27/MUNICIPAL/Gauteng/CITY POWER - NERSA RfD 2026-27 - CityPowerReasonsforDecisionontariffapplicationprocessforFY2026.pdf'

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const books = new Map<string, ExcelJS.Workbook>()
  for (const spec of SPECS) {
    const path = join(SRC as string, spec.file)
    let wb = books.get(path)
    if (!wb) {
      wb = new ExcelJS.Workbook()
      await wb.xlsx.readFile(path)
      books.set(path, wb)
    }
    const ws = wb.getWorksheet(spec.sheet)
    if (!ws) throw new Error(`${spec.file}: no sheet "${spec.sheet}"`)
    const cells: Record<string, string | number> = {}
    for (const [from, to] of spec.rows) {
      for (let r = from; r <= to; r++) {
        for (let c = 1; c <= ws.columnCount; c++) {
          const v = cellValueFromExcel(ws.getCell(r, c).value)
          if (v !== null && v !== '') cells[`${colToLetters(c)}${r}`] = v
        }
      }
    }
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    const rows = spec.rows.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')
    const fixture = { source: { file: spec.file, sha256, sheet: spec.sheet, rows }, cells }
    writeFileSync(join(OUT, `${spec.out}.cells.json`), `${JSON.stringify(fixture, null, 2)}\n`)
    console.log(`${spec.out}: ${Object.keys(cells).length} cells`)
  }

  const text = execFileSync('pdftotext', ['-layout', join(SRC as string, RFD), '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const keep: string[] = []
  let on = false
  for (const line of text.split('\n')) {
    if (/^\f?3\. Residential Single Phase 60A/.test(line) || /^\f?8\. Residential Time of Use/.test(line)) on = true
    if (/^\f?4\. Residential Single Phase 80A/.test(line) || /^\f?9\. Business/.test(line)) on = false
    if (on) keep.push(line)
  }
  writeFileSync(join(OUT, 'city-power-rfd-2026-27.excerpt.txt'), `${keep.join('\n')}\n`)
  console.log(`city-power-rfd-2026-27.excerpt.txt: ${keep.length} lines`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
