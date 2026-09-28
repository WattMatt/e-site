# Solar Phase 2a-ii — Tariff Parsers and Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the real NERSA and Eskom source files into canonical `Tariff` rows with cell/page provenance, prove it with the golden cases re-run from real cells, and load them into the `tariffs` schema as `in_review` years through an idempotent, dry-run-by-default ingestion script run by E-Site staff.

**Architecture:** Deterministic parsers in `packages/shared/src/tariffs/parsers/`: one front end per format (province XLSX compendium, Eskom official xlsm, NERSA 2026/27 RfD PDF text) feeding one normaliser (`normaliseCharge`) that alone decides units and flags every inference. Parsers read a format-neutral `Grid` so tests run on small JSON fixtures copied from the real books. Ingestion is a pure core (`ingest/ingest-core.ts`) against a `TariffStore` interface, with a Supabase implementation and an in-memory one for tests; `scripts/tariffs/ingest.ts` is a thin CLI.

**Tech Stack:** TypeScript, Vitest, exceljs (already a dependency of `@esite/shared` and the repo root), poppler `pdftotext -layout` (PDF → text; installed at `/opt/homebrew/bin/pdftotext` on the ingestion Mac), `@supabase/supabase-js` (service role, CLI only).

**Depends on:** plan 2a-i (types, units, validators, YoY diff, bill engine, the `tariffs` schema). Same branch `feat/solar-phase-2a`, same worktree `~/.config/superpowers/worktrees/esite/solar-phase-2a`.

**Specs:** `docs/solar/as-is/09-nersa-tariff-source.md` §2 (real layouts per province), §3 (Eskom xlsm), §7.1 (parser stages A–E), §7.2 (golden cases); `docs/solar/03-data-model-and-security.md` §4; D-03, D-29.

---

## Ground rules (read once)

- Source folder (read-only, never write to it): `/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/005. NERSA TARIFFS` — referred to below as `$TARIFF_SOURCE_DIR`. Export it once per shell:
  ```bash
  export TARIFF_SOURCE_DIR="/Volumes/Extreme SSD/WATSON MATTHEUS Dropbox/OFFICE/PROJECTS/(001) WATSON MATTHEUS/CORRESPONDENCE/005. NERSA TARIFFS"
  ```
  If the drive is not mounted, stop: fixtures must come from the real files, never be typed by hand.
- **Fixtures are excerpts, not books.** Only the cells listed in Task 1 are copied, as JSON (numbers stay numbers, text stays text). The source books are public NERSA/Eskom documents with no personal data, so nothing needs anonymising; each fixture records the source file and its sha256.
- **Parsers never invent a unit.** A unit comes from the value's own suffix, then a unit column, then the label, then a context/header line compatible with the component. Only `decideEnergyUnit` (2a-i) may change a unit by magnitude, and every such change sets `unitInferred` with a reason. Fixed charges with no unit anywhere are assumed R/month **and flagged**. Anything else without a unit is `unresolved`, never stored.
- Node-only code (`node:fs`, `node:crypto`, `node:child_process`) lives in `scripts/tariffs/` or in `*.test.ts` files — never in `packages/shared/src` non-test files (the shared package has no `@types/node`).
- Run the three suites before claiming done. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Correction to as-is/09 §7.2 carried into the tests:** the Buffalo City "Redundant tariff" rows are under **Scale 4B** (EC xlsx rows 71–81), not Scale 4A; Scale 4A (rows 57–70) is a live TOU tariff.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/tariffs/extract-fixture-cells.ts` | Copies the listed cells from the real books into JSON fixtures (run once) |
| `packages/shared/src/tariffs/__fixtures__/*.cells.json` | 16 cell excerpts (generated) |
| `packages/shared/src/tariffs/__fixtures__/city-power-rfd-2026-27.excerpt.txt` | `pdftotext -layout` excerpt of the City Power 2026/27 RfD (generated) |
| `packages/shared/src/tariffs/parsers/grid.ts` | `Grid`, cell-value normalisation, exceljs adapter, fixture adapter |
| `packages/shared/src/tariffs/parsers/amount.ts` | Number/amount/title-percentage parsing |
| `packages/shared/src/tariffs/parsers/blocks.ts` | Block ranges and contiguity repair |
| `packages/shared/src/tariffs/parsers/labels.ts` | Label cleaning; season, TOU, component, category, metering, phase, voltage detection |
| `packages/shared/src/tariffs/parsers/normalise.ts` | Stage C: one raw value → one `Charge` or one `Unresolved` |
| `packages/shared/src/tariffs/parsers/tariff-draft.ts` | Closing a tariff: structure, single-rate split, names, legacy/empty handling |
| `packages/shared/src/tariffs/parsers/province-xlsx.ts` | NERSA province compendium front end + state machine |
| `packages/shared/src/tariffs/parsers/eskom-xlsm.ts` | Eskom banded tables, Gen-offset export tariffs, loss factors, export linking |
| `packages/shared/src/tariffs/parsers/rfd-text.ts` | NERSA 2026/27 RfD PDF text front end |
| `packages/shared/src/tariffs/parsers/xlsx-load.ts` | exceljs workbook bytes → `Grid[]` |
| `packages/shared/src/tariffs/parsers/index.ts` | Barrel (NOT re-exported from the package root) |
| `packages/shared/src/tariffs/ingest/ingest-core.ts` | `runIngest`, `TariffStore`, plan/report types, `normaliseAlias` |
| `packages/shared/src/tariffs/ingest/build-plan.ts` | Source bytes (+ PDF text) → `IngestPlan` |
| `packages/shared/src/tariffs/ingest/memory-store.ts` | In-memory `TariffStore` (tests, and CLI dry runs without a database) |
| `packages/shared/src/tariffs/ingest/supabase-store.ts` | Service-role `TariffStore` and row mappers |
| `scripts/tariffs/ingest.ts` | CLI: read file, sha256, pdftotext, plan, dry-run or apply |
| `packages/shared/package.json` | Sub-path exports for 2b |
| Tests beside each module; golden re-runs in `parsers/golden.province.test.ts`, `parsers/eskom-xlsm.test.ts`, `parsers/rfd-text.test.ts`; gated real-file sweep in `parsers/real-files.test.ts` |

---

### Task 1: Copy the fixture cells out of the real books

**Files:**
- Create: `scripts/tariffs/extract-fixture-cells.ts`
- Create (generated): `packages/shared/src/tariffs/__fixtures__/*.cells.json`, `packages/shared/src/tariffs/__fixtures__/city-power-rfd-2026-27.excerpt.txt`
- Create: `packages/shared/src/tariffs/parsers/grid.ts` (needed by the script)

- [ ] **Step 1: Write the grid module the script shares with the parsers**

`packages/shared/src/tariffs/parsers/grid.ts`:
```ts
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
```

- [ ] **Step 2: Write the extraction script**

`scripts/tariffs/extract-fixture-cells.ts`:
```ts
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
```

- [ ] **Step 3: Run it**

```bash
pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/extract-fixture-cells.ts
```
Expected: 16 `<name>: N cells` lines and `city-power-rfd-2026-27.excerpt.txt: 50 lines`. If `tsx` cannot resolve `exceljs`, run from the repo root instead: `pnpm exec tsx scripts/tariffs/extract-fixture-cells.ts` (exceljs is a root devDependency).

- [ ] **Step 4: Spot-check the fixtures against the source (these values are what the tests assume)**

```bash
F=packages/shared/src/tariffs/__fixtures__
node -e '
const f=(n)=>require("./'"$F"'/"+n+".cells.json").cells;
const cp=f("gp-city-power"), ct=f("wc-cape-town"), hf=f("eskom-2025-homeflex"), go=f("eskom-2025-gen-offset");
console.log(cp.A1, cp.B16, cp.B129, cp.C154, cp.B152);
console.log(ct.A56); console.log(hf.B11, hf.E11, hf.F11, hf.Q11, hf.G18); console.log(go.B49, go.J49);
'
du -ch "$F"/* | tail -1
```
Expected:
```
City Power - 12.72% 227.28 R37,64 R1 895,11 R358,84
o   Basic charge: R168.81/day
HF101N 706.97 813.02 3.27 12.13
GOHF101N 185.41
```
and a total well under 1 MB. Any mismatch means the source file changed: stop and report the file and cell.

- [ ] **Step 5: Commit**

```bash
git add scripts/tariffs/extract-fixture-cells.ts packages/shared/src/tariffs/parsers/grid.ts packages/shared/src/tariffs/__fixtures__
git commit -m "test(tariffs): cell-level fixtures from the real NERSA/Eskom books + extraction script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Grid, amount and title parsing

**Files:**
- Create: `packages/shared/src/tariffs/parsers/amount.ts`
- Test: `packages/shared/src/tariffs/parsers/grid.test.ts`, `packages/shared/src/tariffs/parsers/amount.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/tariffs/parsers/grid.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cellValueFromExcel, colToLetters, gridFromCells, lettersToCol, parseAddress } from './grid'

describe('grid', () => {
  it('converts column letters both ways', () => {
    expect(colToLetters(1)).toBe('A')
    expect(colToLetters(28)).toBe('AB')
    expect(lettersToCol('AC')).toBe(29)
    expect(parseAddress('X11')).toEqual({ row: 11, col: 24 })
  })
  it('reads exceljs rich text, shared-formula results and plain values', () => {
    expect(cellValueFromExcel({ richText: [{ text: 'R37' }, { text: ',64' }] })).toBe('R37,64')
    expect(cellValueFromExcel({ result: 378.67, sharedFormula: 'J11' })).toBe(378.67)
    expect(cellValueFromExcel({ formula: 'ROUND(E11*1.15,2)' })).toBeNull()
    expect(cellValueFromExcel(227.28)).toBe(227.28)
    expect(cellValueFromExcel(undefined)).toBeNull()
  })
  it('serves a fixture as a grid', () => {
    const g = gridFromCells('S', { A1: 'x', C4: 2 })
    expect([g.maxRow, g.maxCol, g.get(4, 3), g.get(2, 2)]).toEqual([4, 3, 2, null])
  })
})
```

`packages/shared/src/tariffs/parsers/amount.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseAmount, parseNumberText, parseTitle } from './amount'

describe('parseNumberText', () => {
  it.each([
    ['1 184,45', 1184.45], ['1,6464', 1.6464], ['1,787.81', 1787.81], ['227.28', 227.28], ['110,00', 110],
  ])('%s -> %s', (s, v) => expect(parseNumberText(s)).toBe(v))
  it('refuses a thousands comma it cannot read as a decimal', () => {
    expect(parseNumberText('1,000,000')).toBeNull()
  })
})

describe('parseAmount', () => {
  it.each([
    ['R1 184,45', 1184.45, null, true],
    ['R 202,25 /month', 202.25, '/month', true],
    ['214.46c/kWh', 214.46, 'c/kWh', false],
    ['R1,6464/kWh', 1.6464, '/kWh', true],
    ['R346.49//kVA', 346.49, '//kVA', true],
    ['R157.91 R/kVA', 157.91, 'R/kVA', true],
    ['R0.00A/kVA NMD/Month', 0, 'A/kVA NMD/Month', true],
    ['288.86 c/kWh', 288.86, 'c/kWh', false],
    ['R358,84', 358.84, null, true],
  ] as const)('%s', (raw, value, unitText, randPrefix) => {
    expect(parseAmount(raw)).toMatchObject({ value, unitText, randPrefix })
  })
  it('passes numbers through', () => {
    expect(parseAmount(227.28)).toMatchObject({ value: 227.28, unitText: null })
  })
  it('refuses text that is not an amount', () => {
    for (const s of ['Redundant tariff', '(0-50kWh)', '2024/25 Recommended', '-', 'Approved c/kWh', 'kWh']) {
      expect(parseAmount(s)).toBeNull()
    }
  })
})

describe('parseTitle', () => {
  it.each([
    ['City Power - 12.72%', null, 'City Power', 12.72],
    ['Gamagara Local Municipality (7.71%)', null, 'Gamagara Local Municipality', 7.71],
    ['Maluti a Phofung (10,00%)', null, 'Maluti a Phofung', 10],
    ['BUFFALO CITY - 11%', null, 'BUFFALO CITY', 11],
    ['City of Ekurhuleni', '12.74%', 'City of Ekurhuleni', 12.74],
    ['LEPHALALE', 0.1039, 'LEPHALALE', 10.39],
    ['DAMPLAAS', null, 'DAMPLAAS', null],
  ] as const)('%s | %s', (a1, b1, name, pct) => {
    expect(parseTitle(a1, b1)).toEqual({ name, increasePct: pct })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/grid.test.ts src/tariffs/parsers/amount.test.ts`
Expected: grid PASS (module exists), amount FAIL — `Failed to resolve import "./amount"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/parsers/amount.ts`:
```ts
import { parseUnitToken } from '../units'
import type { CellValue } from './grid'

export interface ParsedAmount {
  value: number
  /** Text after the number ("c/kWh", "/month"), or null. */
  unitText: string | null
  /** Written with a leading "R" (so a bare "/kWh" is rand). */
  randPrefix: boolean
  raw: string
}

/** "1 184,45" / "1,6464" / "1,787.81" → number. A single comma + 1-4 digits is a decimal comma. */
export function parseNumberText(s: string): number | null {
  let t = s.replace(/[\s ]/g, '')
  if (!/^\d[\d,.]*$/.test(t)) return null
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '')
  else if (/^\d+,\d{1,4}$/.test(t)) t = t.replace(',', '.')
  else if (t.includes(',')) return null
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

const AMOUNT = /^(R\s?)?(\d[\d ]*(?:[.,]\d+)?)\s*(.*)$/i

/** A cell or label tail holding one price. The tail, when present, must be a unit. */
export function parseAmount(raw: CellValue): ParsedAmount | null {
  if (raw === null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, unitText: null, randPrefix: false, raw: String(raw) } : null
  const s = raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
  const m = AMOUNT.exec(s)
  if (!m) return null
  const value = parseNumberText(m[2])
  if (value === null) return null
  const tail = m[3].trim()
  const randPrefix = m[1] !== undefined
  if (tail !== '' && parseUnitToken(tail, { randPrefix, bare: true }) === null) return null
  return { value, unitText: tail === '' ? null : tail, randPrefix, raw: s }
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

/** Row 1 of a province sheet: "NAME - x%", "NAME (x%)", or the % (text or fraction) in B1. */
export function parseTitle(a1: CellValue, b1: CellValue): { name: string; increasePct: number | null } {
  const text = typeof a1 === 'string' ? a1.replace(/\s+/g, ' ').trim() : ''
  const inA = /(\d+(?:[.,]\d+)?)\s*%/.exec(text)
  let pct: number | null = inA ? Number(inA[1].replace(',', '.')) : null
  if (pct === null && b1 !== null) {
    if (typeof b1 === 'number') {
      pct = b1 > 0 && b1 < 1 ? round4(b1 * 100) : b1
    } else {
      const inB = /(\d+(?:[.,]\d+)?)\s*%/.exec(b1)
      if (inB) pct = Number(inB[1].replace(',', '.'))
      else {
        const n = parseNumberText(b1)
        if (n !== null) pct = n > 0 && n < 1 ? round4(n * 100) : n
      }
    }
  }
  const name = text
    .replace(/\s*[-|]?\s*\(?\s*\d+(?:[.,]\d+)?\s*%\s*\)?\s*$/, '')
    .replace(/\s*[-|]\s*$/, '')
    .trim()
  return { name, increasePct: pct }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/grid.test.ts src/tariffs/parsers/amount.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/parsers/amount.ts packages/shared/src/tariffs/parsers/grid.test.ts packages/shared/src/tariffs/parsers/amount.test.ts
git commit -m "feat(tariffs): amount, decimal-comma and title-percentage parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Blocks and labels

**Files:**
- Create: `packages/shared/src/tariffs/parsers/blocks.ts`, `packages/shared/src/tariffs/parsers/labels.ts`
- Test: `packages/shared/src/tariffs/parsers/blocks.test.ts`, `packages/shared/src/tariffs/parsers/labels.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/tariffs/parsers/blocks.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseBlockRange, repairBlocks } from './blocks'
import { makeCharge } from '../types'

describe('parseBlockRange', () => {
  it.each([
    ['Block 1 (0-350kWh)', 0, 350],
    ['Block 2 (501-1000kWh)', 501, 1000],
    ['Block 5 (>3000kWh)', 3000, null],
    ['Block 1 (0 to 50 kWh)', 0, 50],
    ['Block 2 (>50 to <=600 kWh)', 50, 600],
    ['Block 2 (51 – 350 kWh)', 51, 350],
    ['(0-50kWh)', 0, 50],
    ['Part 1 - First 50 kWh. Charge per kWh', 0, 50],
    ["Part 2 - Charge per kWh >2000 kWh's purchased (c/kWh)", 2000, null],
    ['Block 1 (<300)kWh', 0, 300],
    ['Block 2 (300 - 700)kWh', 300, 700],
  ] as const)('%s', (text, min, max) => {
    expect(parseBlockRange(text)).toMatchObject({ min, max, typo: false })
  })
  it('flags the "500Wh" typo', () => {
    expect(parseBlockRange('Block 3 (>500Wh)')).toEqual({ min: 500, max: null, typo: true })
  })
  it('finds no block in a label without a range', () => {
    for (const s of ['Peak', 'Part 2 - Charge per kWh (c/kWh)', 'Energy charge: R/kWh', 'Single rate energy charge']) {
      expect(parseBlockRange(s)).toBeNull()
    }
  })
})

describe('repairBlocks', () => {
  const b = (min: number | null, max: number | null) =>
    makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 1, blockMinKwh: min, blockMaxKwh: max, blockBasis: min === null ? null : 'monthly' })
  it('closes "0-500 / 501-1000" to a 500 boundary', () => {
    const cs = [b(0, 500), b(501, 1000), b(1001, null)]
    repairBlocks(cs)
    expect(cs.map((c) => [c.blockMinKwh, c.blockMaxKwh])).toEqual([[0, 500], [500, 1000], [1000, null]])
  })
  it('gives an unranged middle part the gap between its neighbours (Buffalo City Scale 1C)', () => {
    const cs = [b(0, 50), b(null, null), b(300, null)]
    repairBlocks(cs)
    expect(cs.map((c) => [c.blockMinKwh, c.blockMaxKwh, c.blockBasis])).toEqual([[0, 50, 'monthly'], [50, 300, 'monthly'], [300, null, 'monthly']])
  })
})
```

`packages/shared/src/tariffs/parsers/labels.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cleanLabel, detectCategory, detectComponent, detectMetering, detectPhase, detectSeason, detectTou, labelUnit, voltageBandFromText } from './labels'

describe('cleanLabel', () => {
  it('strips bullets and collapses whitespace', () => {
    expect(cleanLabel('o   Basic charge: R168.81/day')).toBe('Basic charge: R168.81/day')
    expect(cleanLabel('§  Peak: 610.75c/kWh')).toBe('Peak: 610.75c/kWh')
    expect(cleanLabel('Ø       Network      capacity      charge:      R0.00A/kVA\nNMD/Month')).toBe('Network capacity charge: R0.00A/kVA NMD/Month')
    expect(cleanLabel('·       Large User Low Voltage Time of Use')).toBe('Large User Low Voltage Time of Use')
    expect(cleanLabel('Off-peak')).toBe('Off-peak')
  })
})

describe('season and TOU', () => {
  it.each([
    ['Summer Energy Charges', 'low'], ['Winter Energy Charge', 'high'], ['o Low Season', 'low'],
    ['High demand season [Jun - Aug]', 'high'], ['Low Demand (Sept - May) - Peak', 'low'],
    ['All season Demand Charge (R/kVA)', 'all'], ['All seasons', 'all'], ['Service Charge (R/month)', null],
    ['Conventional Normal meter-per kWh(single phase)summer tariff', 'low'],
  ] as const)('%s -> %s', (label, season) => expect(detectSeason(label)).toBe(season))
  it('reads off-peak before peak', () => {
    expect(detectTou('Off-peak')).toBe('off_peak')
    expect(detectTou('Off Peak')).toBe('off_peak')
    expect(detectTou('Peak(R/kWh):')).toBe('peak')
    expect(detectTou('Standard (R/kWh):')).toBe('standard')
    expect(detectTou('Summer Energy Charges')).toBeNull()
  })
})

describe('labelUnit', () => {
  it.each([
    ['Service Charge (R/month)', 'R_per_month'],
    ['All season Demand Charge (c/kVArh)', 'c_per_kVArh'],
    ['Basic Charge -  R/month', 'R_per_month'],
    ['Energy Charges - c/kWh', 'c_per_kWh'],
    ['BASIC LEVY - PER MONTH', 'R_per_month'],
    ['Block 1 (0-350kWh)', null],
    ['Large Power Users (80kVA up to 150kVA Commercial / Industrial) , Min 100A,', null],
    ['Residential Time of Use (<=80A)', null],
  ] as const)('%s -> %s', (label, unit) => expect(labelUnit(label)).toBe(unit))
})

describe('detectComponent', () => {
  it.each([
    ['All season Demand Charge (c/kVArh)', 'c_per_kVArh', null, 'reactive'],
    ['Wheeling Charge', null, null, 'wheeling_uos'],
    ['Network capacity charge', 'R_per_kVA_month', null, 'network_capacity'],
    ['Capacity Charge (R/month)', 'R_per_month', null, 'network_capacity'],
    ['Network demand charge [c/kWh]', 'c_per_kWh', null, 'network_demand'],
    ['Generation capacity charge [R/POD/day]', 'R_per_POD_day', null, 'gcc'],
    ['Ancillary service charge [c/kWh]', 'c_per_kWh', null, 'ancillary'],
    ["'Service and administration charge [R/POD/day]", 'R_per_POD_day', null, 'service'],
    ['Electrification and rural network subsidy charge [c/kWh]', 'c_per_kWh', null, 'ers'],
    ['Demand charge', 'R_per_kVA_month', null, 'demand'],
    ['Basic charge', 'R_per_day', null, 'basic'],
    ['Peak', 'c_per_kWh', null, 'energy'],
    ['Block 1 (0-350kWh)', null, null, 'energy'],
    ['Single Phase (Conventional Meters)', null, 'basic', 'basic'],
    ['Active energy charge [c/kWh]', 'c_per_kWh', 'export_credit', 'export_credit'],
  ] as const)('%s', (label, unit, hint, component) => expect(detectComponent(label, unit, hint)).toBe(component))
})

describe('category, metering, phase, voltage', () => {
  it('classifies', () => {
    expect(detectCategory('16. SSEG (New)')).toBe('sseg')
    expect(detectCategory('Gen-Offset Homeflex')).toBe('sseg')
    expect(detectCategory('Industrial LV (TOU)')).toBe('industrial')
    expect(detectCategory('Residential Single Phase 60A')).toBe('domestic')
    expect(detectCategory('Businessrate')).toBe('commercial')
    expect(detectMetering('Domestic Prepaid & Conventional')).toBe('both')
    expect(detectMetering('Residential Prepaid Low')).toBe('prepaid')
    expect(detectPhase('Commercial Three Phase Prepaid')).toBe('three')
    expect(voltageBandFromText('< 500V')).toBe('lt_500v')
    expect(voltageBandFromText('≥ 500V & < 66kV')).toBe('500v_66kv')
    expect(voltageBandFromText('> 132kV/Transmission connected')).toBe('gt_132kv')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/blocks.test.ts src/tariffs/parsers/labels.test.ts`
Expected: FAIL — unresolved imports `./blocks`, `./labels`.

- [ ] **Step 3: Implement blocks**

`packages/shared/src/tariffs/parsers/blocks.ts`:
```ts
import type { Charge } from '../types'

export interface BlockRange {
  min: number
  max: number | null
  /** Written as Wh rather than kWh ("Block 3 (>500Wh)"): kept, but sent to review. */
  typo: boolean
}

const n = (s: string): number => Number(s.replace(/\s/g, ''))

/** Half-open [min, max) kWh per month from a block label. "0-500 / 501-1000" is repaired later. */
export function parseBlockRange(text: string): BlockRange | null {
  const t = text.replace(/[‒-―−]/g, '-').replace(/ /g, ' ').toLowerCase()
  const typo = /\d\s*wh\b/.test(t) && !/\d\s*kwh/.test(t)
  let m: RegExpExecArray | null
  if ((m = /first\s+(\d[\d ]*?)\s*kwh/.exec(t))) return { min: 0, max: n(m[1]), typo }
  if ((m = />\s*(\d[\d ]*?)\s*(?:kwh)?\s*(?:to|-|and)\s*<=?\s*(\d[\d ]*?)\s*(?:kwh|\)|$)/.exec(t))) return { min: n(m[1]), max: n(m[2]), typo }
  if ((m = /(\d[\d ]*?)\s*(?:kwh)?\s*(?:-|to)\s*(\d[\d ]*?)\s*(?:k?wh|\))/.exec(t))) return { min: n(m[1]), max: n(m[2]), typo }
  if ((m = />\s*=?\s*(\d[\d ]*?)\s*(?:k?wh|\)|$)/.exec(t))) return { min: n(m[1]), max: null, typo }
  if ((m = /<\s*=?\s*(\d[\d ]*?)\s*(?:k?wh|\))/.exec(t))) return { min: 0, max: n(m[1]), typo }
  return null
}

/**
 * In source order, for the energy charges of ONE season with no TOU:
 *  - "501-1000" after "0-500" starts at 500 (as-is/09 §7.1 Stage C.5);
 *  - an unranged middle part takes the gap between its neighbours.
 * Mutates the charges.
 */
export function repairBlocks(charges: Charge[]): void {
  for (let k = 1; k < charges.length; k++) {
    const prev = charges[k - 1]
    const cur = charges[k]
    if (prev.blockMaxKwh !== null && cur.blockMinKwh !== null && cur.blockMinKwh === prev.blockMaxKwh + 1) {
      cur.blockMinKwh = prev.blockMaxKwh
    }
  }
  for (let k = 1; k < charges.length - 1; k++) {
    const cur = charges[k]
    const prev = charges[k - 1]
    const next = charges[k + 1]
    if (cur.blockMinKwh === null && prev.blockMaxKwh !== null && next.blockMinKwh !== null && next.blockMinKwh > prev.blockMaxKwh) {
      cur.blockMinKwh = prev.blockMaxKwh
      cur.blockMaxKwh = next.blockMinKwh
      cur.blockBasis = 'monthly'
    }
  }
}
```

- [ ] **Step 4: Implement labels**

`packages/shared/src/tariffs/parsers/labels.ts`:
```ts
import { parseUnitToken } from '../units'
import type { ChargeComponent, TariffCategory, TariffMetering, TariffSeason, TariffUnit, TouPeriod } from '../types'

/** Bullets used by the Cape Town sheet ("·", "o", "§", "Ø"), NBSPs and line breaks go. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[·•§Ø▪\-–]+|o(?=\s))\s*/u, '')
    .trim()
}

/** Low = summer / low-demand (Sep-May); high = winter / high-demand (Jun-Aug). */
export function detectSeason(label: string): TariffSeason | null {
  const t = label.toLowerCase()
  if (/\ball[- ]seasons?\b/.test(t)) return 'all'
  if (/summer|\blow[- ]season\b|\blow[- ]demand\b/.test(t)) return 'low'
  if (/winter|\bhigh[- ]season\b|\bhigh[- ]demand\b/.test(t)) return 'high'
  return null
}

/** Off-peak is tested BEFORE peak (the old parser read "off-peak" as "peak"). */
export function detectTou(label: string): TouPeriod | null {
  const t = label.toLowerCase()
  if (/\boff[- ]?peak\b/.test(t)) return 'off_peak'
  if (/\bstandard\b/.test(t)) return 'standard'
  if (/\bpeak\b/.test(t)) return 'peak'
  return null
}

const EXPLICIT_UNIT = /(c\/kwh|r\/kwh|c\/kvarh|r\/kva(?:\/m(?:onth)?)?|\/kva|r\/pod\/day|r\/day|r\/month|per month|r\/a\/m)/i

/** A unit written in a label: the last parenthesis that names one, else an explicit token. */
export function labelUnit(label: string): TariffUnit | null {
  const parens = [...label.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).reverse()
  for (const p of parens) {
    const u = parseUnitToken(p)
    if (u) return u
  }
  const m = EXPLICIT_UNIT.exec(label)
  return m ? parseUnitToken(m[1]) : null
}

/**
 * The component a label names. The UNIT wins where it is decisive (c/kVArh is
 * reactive even when the label says "Demand" — City Power). A context hint is
 * used only when the label itself is silent.
 */
export function detectComponent(label: string, unit: TariffUnit | null, hint: ChargeComponent | null): ChargeComponent {
  const t = label.toLowerCase()
  if (unit === 'c_per_kVArh' || /reactive|kvarh/.test(t)) return 'reactive'
  if (/wheeling/.test(t)) return 'wheeling_uos'
  if (/network capacity|access charge/.test(t)) return 'network_capacity'
  if (/network demand/.test(t)) return 'network_demand'
  if (/generation capacity/.test(t)) return 'gcc'
  if (/transmission network/.test(t)) return 'transmission_network'
  if (/ancillary/.test(t)) return 'ancillary'
  if (/legacy/.test(t)) return 'legacy'
  if (/electrification|rural network subsidy/.test(t)) return 'ers'
  if (/affordability/.test(t)) return 'affordability'
  if (/\badmin/.test(t) && !/service/.test(t)) return 'admin'
  if (/service/.test(t)) return 'service'
  if (/capacity charge/.test(t)) return /\bamp/.test(t) || unit === 'R_per_A_month' ? 'capacity_amp' : 'network_capacity'
  if (/demand/.test(t) && (unit === 'R_per_kVA_month' || unit === 'R_per_kW_month')) return 'demand'
  if (/basic|levy|fixed charge|daily charge/.test(t)) return 'basic'
  if (unit === 'c_per_kWh' || unit === 'R_per_kWh') return hint === 'export_credit' ? 'export_credit' : 'energy'
  if (/energy|kwh|block|part \d|peak|standard|charge per|single rate|flat rate|consumption/.test(t)) {
    return hint === 'export_credit' ? 'export_credit' : 'energy'
  }
  if (hint) return hint
  if (unit === 'R_per_month' || unit === 'R_per_day') return 'basic'
  if (unit === 'R_per_kVA_month' || unit === 'R_per_kW_month') return 'demand'
  return 'other'
}

export function detectCategory(text: string): TariffCategory | null {
  const t = text.toLowerCase()
  if (/sseg|small[- ]scale embedded|embedded generat|gen-?offset|feed[- ]in|\bexport\b/.test(t)) return 'sseg'
  if (/wheeling/.test(t)) return 'wheeling'
  if (/street|public lighting|robots/.test(t)) return 'public_lighting'
  if (/agric|farm|landrate|ruraflex/.test(t)) return 'agricultural'
  if (/\bbulk\b/.test(t)) return 'bulk'
  if (/industr|large power|\blpu\b|megaflex|miniflex|nightsave|municflex/.test(t)) return 'industrial'
  if (/commerc|business/.test(t)) return 'commercial'
  if (/domestic|residential|household|indigent|home/.test(t)) return 'domestic'
  return null
}

export function detectMetering(text: string): TariffMetering {
  const t = text.toLowerCase()
  const prepaid = /prepaid|prepayment/.test(t)
  const conventional = /conventional|credit metered/.test(t)
  if (prepaid && conventional) return 'both'
  if (prepaid) return 'prepaid'
  if (conventional) return 'conventional'
  return 'both'
}

export function detectPhase(text: string): 'single' | 'three' | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  if (/single phase|1 phase/.test(t)) return 'single'
  if (/three phase|3 phase/.test(t)) return 'three'
  return null
}

export function voltageBandFromText(text: string | null): string | null {
  if (!text) return null
  const s = text.replace(/\s+/g, '').toLowerCase()
  if (/^<500v/.test(s)) return 'lt_500v'
  if (/^(≥|>=)500v&<66kv/.test(s)) return '500v_66kv'
  if (/^(≥|>=)500v&(≤|<=)22kv/.test(s)) return '500v_22kv'
  if (/^(≥|>=)66kv&(≤|<=)132kv/.test(s)) return '66kv_132kv'
  if (/^>132kv/.test(s)) return 'gt_132kv'
  return s
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/blocks.test.ts src/tariffs/parsers/labels.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tariffs/parsers/blocks.ts packages/shared/src/tariffs/parsers/labels.ts packages/shared/src/tariffs/parsers/blocks.test.ts packages/shared/src/tariffs/parsers/labels.test.ts
git commit -m "feat(tariffs): block ranges with contiguity repair; label, season, TOU and component detection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The normaliser and tariff closing

**Files:**
- Create: `packages/shared/src/tariffs/parsers/normalise.ts`, `packages/shared/src/tariffs/parsers/tariff-draft.ts`
- Test: `packages/shared/src/tariffs/parsers/normalise.test.ts`, `packages/shared/src/tariffs/parsers/tariff-draft.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/tariffs/parsers/normalise.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { normaliseCharge, type NormaliseInput } from './normalise'
import { parseAmount } from './amount'

const base = (label: string, raw: string | number, over: Partial<NormaliseInput> = {}): NormaliseInput => ({
  label,
  amount: parseAmount(raw)!,
  rawValue: String(raw),
  unitColumn: null,
  contextUnit: null,
  headerUnit: null,
  componentHint: null,
  seasonState: { energy: 'all', general: 'all' },
  blockText: null,
  vatBasis: 'assumed_excl',
  extractionMethod: 'parser',
  locator: { sheet: 'T', row: 1 },
  ...over,
})

describe('normaliseCharge', () => {
  it('Buffalo City: c/kWh label with 3.09 becomes R/kWh, flagged', () => {
    const r = normaliseCharge(base('Part 1 - Charge per kWh (c/kWh)', 3.09))
    expect(r.ok && r.charge).toMatchObject({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true })
  })
  it('City Power: a "(c/kVArh)" label under "Demand" is reactive at 37.64 c/kVArh', () => {
    const r = normaliseCharge(base('All season Demand Charge (c/kVArh)', 'R37,64'))
    expect(r.ok && r.charge).toMatchObject({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 37.64, season: 'all', unitInferred: false })
  })
  it('uses a compatible header unit and ignores an incompatible one', () => {
    const energy = normaliseCharge(base('Block 1 (0-500kWh)', 227.28, { headerUnit: 'c_per_kWh' }))
    expect(energy.ok && energy.charge).toMatchObject({ unit: 'c_per_kWh', unitInferred: false, blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' })
    const hinted = normaliseCharge(base('Part 1 - Charge per kWh', 3.425, { contextUnit: 'R_per_kVA_month' }))
    expect(hinted.ok && hinted.charge).toMatchObject({ component: 'energy', unit: 'R_per_kWh', unitInferred: true })
  })
  it('assumes R/month for a unitless fixed charge, flagged (Centlec SSEG "R110,00")', () => {
    const r = normaliseCharge(base('Basic charges:', 'R110,00'))
    expect(r.ok && r.charge).toMatchObject({ component: 'basic', unit: 'R_per_month', unitInferred: true })
  })
  it('refuses a unitless non-fixed, non-energy charge (NMB "Wheeling Charge")', () => {
    const r = normaliseCharge(base('Wheeling Charge', 112.31))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.unresolved.reason).toMatch(/wheeling_uos/)
  })
  it('applies season state: energy follows the energy season, fixed charges stay all-season', () => {
    const state = { energy: 'high' as const, general: 'all' as const }
    const peak = normaliseCharge(base('Peak', 634.02, { headerUnit: 'c_per_kWh', seasonState: state }))
    const service = normaliseCharge(base('Service Charge (R/month)', 235.79, { seasonState: { energy: 'high', general: 'high' } }))
    expect(peak.ok && peak.charge).toMatchObject({ season: 'high', tou: 'peak' })
    expect(service.ok && service.charge.season).toBe('all')
  })
  it('marks per-kVA network capacity as NMD-based', () => {
    const r = normaliseCharge(base('Network capacity charge', 'R0.00A/kVA NMD/Month'))
    expect(r.ok && r.charge).toMatchObject({ component: 'network_capacity', unit: 'R_per_kVA_month', demandBasis: 'nmd', amountExclVat: 0 })
  })
  it('sends a Wh block typo to review', () => {
    const r = normaliseCharge(base('Block 3 (>500Wh)', 322.61, { headerUnit: 'c_per_kWh' }))
    expect(r.ok && r.issues.map((i) => i.code)).toEqual(['block_unit_typo'])
  })
})
```

`packages/shared/src/tariffs/parsers/tariff-draft.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { finishDraft, inferStructure, newDraft } from './tariff-draft'
import { makeCharge, type Charge } from '../types'

const e = (p: Partial<Charge>) => makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2, ...p })

describe('inferStructure', () => {
  it('reads the structure off the energy charges', () => {
    expect(inferStructure([e({})])).toBe('flat')
    expect(inferStructure([e({ season: 'low' }), e({ season: 'high' })])).toBe('seasonal')
    expect(inferStructure([e({ blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly' })])).toBe('ibt')
    expect(inferStructure([e({ blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly', season: 'low' })])).toBe('seasonal_ibt')
    expect(inferStructure([e({ tou: 'peak' })])).toBe('tou')
  })
})

describe('finishDraft', () => {
  it('splits a single-rate energy charge off an IBT tariff into a variant (Ekurhuleni row 8)', () => {
    const d = newDraft({ name: 'Domestic IBT Tariff A', fileSha256: 'x', sheet: 'S', headerRow: 3 })
    d.charges.push(
      e({ blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly' }),
      e({ blockMinKwh: 50, blockMaxKwh: null, blockBasis: 'monthly' }),
      e({ label: 'Single rate energy charge', amountExclVat: 2.4574 }),
    )
    const out = finishDraft(d, new Set())
    expect(out.tariffs.map((t) => [t.name, t.structure, t.charges.length])).toEqual([
      ['Domestic IBT Tariff A', 'ibt', 2],
      ['Domestic IBT Tariff A (single rate)', 'flat', 1],
    ])
  })
  it('skips a legacy header with no charges and says so', () => {
    const d = newDraft({ name: 'Scale 4B', fileSha256: 'x', sheet: 'S', headerRow: 71 })
    d.isLegacy = true
    const out = finishDraft(d, new Set())
    expect(out.tariffs).toEqual([])
    expect(out.issues[0]).toMatchObject({ code: 'legacy_tariff_skipped', locator: { row: 71 } })
  })
  it('keeps names unique within a book by suffixing the header row', () => {
    const taken = new Set<string>()
    const a = newDraft({ name: 'Domestic', fileSha256: 'x', sheet: 'S', headerRow: 3 })
    a.charges.push(e({}))
    const b = newDraft({ name: 'DOMESTIC', fileSha256: 'x', sheet: 'S', headerRow: 9 })
    b.charges.push(e({}))
    expect(finishDraft(a, taken).tariffs[0].name).toBe('Domestic')
    expect(finishDraft(b, taken).tariffs[0].name).toBe('DOMESTIC [row 9]')
  })
  it('flags an SSEG tariff whose import/export meaning is unknown', () => {
    const d = newDraft({ name: '16. SSEG (New)', fileSha256: 'x', sheet: 'S', headerRow: 181 })
    d.charges.push(e({ tou: 'peak' }))
    const out = finishDraft(d, new Set())
    expect(out.tariffs[0].category).toBe('sseg')
    expect(out.issues.map((i) => i.code)).toContain('sseg_semantics_unknown')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/normalise.test.ts src/tariffs/parsers/tariff-draft.test.ts`
Expected: FAIL — unresolved `./normalise`, `./tariff-draft`.

- [ ] **Step 3: Implement the normaliser**

`packages/shared/src/tariffs/parsers/normalise.ts`:
```ts
/**
 * Stage C (as-is/09 §7.1): the ONLY place a unit is decided. Precedence:
 * the value's own suffix, a unit column, the label, then a context or header
 * unit that is compatible with the component. Energy goes through
 * decideEnergyUnit (magnitude check, always flagged); a unitless fixed charge
 * is assumed R/month and flagged; anything else without a unit is unresolved.
 */
import { decideEnergyUnit, parseUnitToken, unitClass } from '../units'
import { makeCharge, type Charge, type ChargeComponent, type DemandBasis, type ExtractionMethod, type SourceLocator, type TariffSeason, type TariffUnit, type VatBasis } from '../types'
import type { TariffIssue } from '../validators'
import type { ParsedAmount } from './amount'
import { parseBlockRange } from './blocks'
import { detectComponent, detectSeason, detectTou, labelUnit } from './labels'

export interface NormaliseInput {
  label: string
  amount: ParsedAmount
  rawValue: string
  unitColumn: TariffUnit | null
  contextUnit: TariffUnit | null
  headerUnit: TariffUnit | null
  componentHint: ChargeComponent | null
  /** energy: set by "Summer Energy Charges"-style lines and energy labels; general: by "Low Season"-style lines. */
  seasonState: { energy: TariffSeason; general: TariffSeason }
  blockText: string | null
  vatBasis: VatBasis
  extractionMethod: ExtractionMethod
  locator: SourceLocator
}

export interface Unresolved {
  label: string
  raw: string
  reason: string
  locator: SourceLocator
}

export type NormaliseResult =
  | { ok: true; charge: Charge; issues: TariffIssue[] }
  | { ok: false; unresolved: Unresolved }

const FIXED_LIKE: ReadonlySet<ChargeComponent> = new Set<ChargeComponent>(['basic', 'service', 'admin', 'network_capacity', 'capacity_amp', 'gcc'])

export function unitCompatible(component: ChargeComponent, unit: TariffUnit): boolean {
  const cls = unitClass(unit)
  if (component === 'energy' || component === 'export_credit') return cls === 'per_kwh'
  if (component === 'reactive') return cls === 'per_kvarh'
  if (component === 'demand') return cls === 'per_kva_month' || cls === 'per_kw_month'
  if (FIXED_LIKE.has(component)) return cls === 'per_month' || cls === 'per_day' || cls === 'per_kva_month' || cls === 'per_amp_month'
  return true
}

export function normaliseCharge(inp: NormaliseInput): NormaliseResult {
  const issues: TariffIssue[] = []
  const explicit = parseUnitToken(inp.amount.unitText, { randPrefix: inp.amount.randPrefix, bare: true })
    ?? inp.unitColumn
    ?? labelUnit(inp.label)
  const component = detectComponent(inp.label, explicit, inp.componentHint)
  const hinted = [inp.contextUnit, inp.headerUnit].find((u): u is TariffUnit => u !== null && unitCompatible(component, u)) ?? null
  let unit: TariffUnit | null = explicit ?? hinted
  let inferred = false
  let reason: string | null = null

  if (component === 'energy' || component === 'export_credit') {
    const labelled = unit === 'c_per_kWh' || unit === 'R_per_kWh' ? unit : null
    const d = decideEnergyUnit(inp.amount.value, labelled)
    unit = d.unit
    inferred = d.inferred
    reason = d.reason
  } else if (unit === null && (component === 'basic' || component === 'service' || component === 'admin' || component === 'network_capacity')) {
    unit = 'R_per_month'
    inferred = true
    reason = 'fixed charge without a unit: assumed R/month'
  }
  if (unit === null) {
    return { ok: false, unresolved: { label: inp.label, raw: inp.rawValue, reason: reason ?? `unit unknown for ${component}`, locator: inp.locator } }
  }

  const cls = unitClass(unit)
  const isEnergy = component === 'energy' || component === 'export_credit'
  const labelSeason = detectSeason(inp.label)
  const season: TariffSeason = labelSeason
    ?? (isEnergy ? inp.seasonState.energy : cls === 'per_month' || cls === 'per_day' ? 'all' : inp.seasonState.general)
  const tou = isEnergy ? (detectTou(inp.label) ?? 'all') : 'all'

  let blockMinKwh: number | null = null
  let blockMaxKwh: number | null = null
  if (component === 'energy') {
    const b = parseBlockRange(inp.blockText ?? inp.label)
    if (b) {
      blockMinKwh = b.min
      blockMaxKwh = b.max
      if (b.typo) {
        issues.push({ code: 'block_unit_typo', severity: 'review', message: `block written in Wh: "${inp.blockText ?? inp.label}"`, locator: inp.locator })
      }
    }
  }

  let demandBasis: DemandBasis | null = null
  if (cls === 'per_kva_month' || cls === 'per_kw_month') {
    demandBasis = component === 'network_capacity' || /nmd|notified/i.test(`${inp.label} ${inp.amount.unitText ?? ''}`) ? 'nmd' : 'actual_md'
  }

  const charge = makeCharge({
    component, unit, amountExclVat: inp.amount.value, season, tou,
    blockMinKwh, blockMaxKwh, blockBasis: blockMinKwh === null ? null : 'monthly',
    demandBasis, vatBasis: inp.vatBasis,
    unitInferred: inferred, inferenceReason: inferred ? reason : null,
    sourceLocator: { ...inp.locator, raw_unit: inp.amount.unitText ?? null },
    extractionMethod: inp.extractionMethod,
    label: inp.label,
  })
  return { ok: true, charge, issues }
}
```

- [ ] **Step 4: Implement tariff closing**

`packages/shared/src/tariffs/parsers/tariff-draft.ts`:
```ts
import { normaliseTariffName, type TariffIssue } from '../validators'
import type { Charge, SourceLocator, Tariff, TariffCategory, TariffStructure } from '../types'
import { repairBlocks } from './blocks'
import { detectCategory, detectMetering, detectPhase } from './labels'

export interface TariffDraft {
  name: string
  fileSha256: string
  sheet?: string
  headerRow?: number
  page?: number
  line?: number
  isLegacy: boolean
  notes: string[]
  charges: Charge[]
  categoryHint: TariffCategory | null
}

export function newDraft(p: { name: string; fileSha256: string; sheet?: string; headerRow?: number; page?: number; line?: number; categoryHint?: TariffCategory | null }): TariffDraft {
  return { ...p, isLegacy: false, notes: [], charges: [], categoryHint: p.categoryHint ?? null }
}

export function inferStructure(charges: readonly Charge[]): TariffStructure {
  const energy = charges.filter((c) => c.component === 'energy')
  const tou = energy.some((c) => c.tou !== 'all')
  const blocks = energy.some((c) => c.blockMinKwh !== null)
  const seasonal = energy.some((c) => c.season !== 'all')
  if (tou) return blocks ? 'tou_ibt' : 'tou'
  if (blocks) return seasonal ? 'seasonal_ibt' : 'ibt'
  return seasonal ? 'seasonal' : 'flat'
}

function locatorOf(d: TariffDraft): SourceLocator {
  return d.headerRow !== undefined
    ? { file_sha256: d.fileSha256, sheet: d.sheet, row: d.headerRow, cell: `A${d.headerRow}` }
    : { file_sha256: d.fileSha256, page: d.page, line: d.line }
}

const isSingleRate = (c: Charge): boolean =>
  c.component === 'energy' && c.blockMinKwh === null && c.tou === 'all' && /single rate|flat rate/i.test(c.label ?? '')

function toTariff(name: string, d: TariffDraft, charges: Charge[]): Tariff {
  const sseg = /\b(sseg|small[- ]scale embedded|embedded generation|generator|feed[- ]in|export)\b/i.test(d.name)
  return {
    code: null,
    name,
    family: null,
    category: sseg ? 'sseg' : detectCategory(d.name) ?? d.categoryHint ?? 'other',
    metering: detectMetering(d.name),
    structure: inferStructure(charges),
    voltageBand: null,
    phase: detectPhase(d.name),
    transmissionZone: null,
    localAuthority: false,
    minAmps: null,
    maxAmps: null,
    minKva: null,
    maxKva: null,
    isLegacy: d.isLegacy,
    notes: d.notes.length > 0 ? d.notes.join(' / ') : null,
    charges,
    exportTariffCode: null,
    sourceLocator: locatorOf(d),
  }
}

/** Close a tariff. `taken` holds normalised names already used in this book. */
export function finishDraft(d: TariffDraft, taken: Set<string>): { tariffs: Tariff[]; issues: TariffIssue[] } {
  const issues: TariffIssue[] = []
  if (d.charges.length === 0) {
    issues.push({
      code: d.isLegacy ? 'legacy_tariff_skipped' : 'empty_tariff',
      severity: 'warn',
      message: `${d.isLegacy ? 'legacy (redundant/obsolete) ' : ''}header "${d.name}" has no charges; skipped`,
      tariff: d.name,
      locator: locatorOf(d),
    })
    return { tariffs: [], issues }
  }

  for (const s of ['all', 'high', 'low'] as const) {
    repairBlocks(d.charges.filter((c) => c.component === 'energy' && c.tou === 'all' && c.season === s))
  }

  const groups: { suffix: string; charges: Charge[] }[] = []
  if (d.charges.some((c) => c.component === 'energy' && c.blockMinKwh !== null) && d.charges.some(isSingleRate)) {
    const nonEnergy = d.charges.filter((c) => c.component !== 'energy')
    groups.push({ suffix: '', charges: d.charges.filter((c) => !isSingleRate(c)) })
    groups.push({ suffix: ' (single rate)', charges: [...d.charges.filter(isSingleRate), ...nonEnergy.map((c) => ({ ...c }))] })
  } else {
    groups.push({ suffix: '', charges: d.charges })
  }

  const tariffs = groups.map((g) => {
    let name = `${d.name}${g.suffix}`
    if (taken.has(normaliseTariffName(name))) name = `${name} [row ${d.headerRow ?? d.line ?? 0}]`
    taken.add(normaliseTariffName(name))
    return toTariff(name, d, g.charges)
  })
  for (const t of tariffs) {
    if (t.category === 'sseg') {
      issues.push({
        code: 'sseg_semantics_unknown', severity: 'review',
        message: `"${t.name}": the source does not say whether these are import or export rates`,
        tariff: t.name, locator: t.sourceLocator,
      })
    }
  }
  return { tariffs, issues }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/normalise.test.ts src/tariffs/parsers/tariff-draft.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tariffs/parsers/normalise.ts packages/shared/src/tariffs/parsers/tariff-draft.ts packages/shared/src/tariffs/parsers/normalise.test.ts packages/shared/src/tariffs/parsers/tariff-draft.test.ts
git commit -m "feat(tariffs): charge normaliser (unit precedence, flagged inference) and tariff closing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Province compendium parser + golden cases 1–9 from real cells

**Files:**
- Create: `packages/shared/src/tariffs/parsers/province-xlsx.ts`
- Test: `packages/shared/src/tariffs/parsers/golden.province.test.ts`

The state machine (as-is/09 §7.1 Stage B), per row after the title row:
1. VAT statement line → sheet `vatBasis`.
2. "Redundant"/"Obsolete" in a value cell → the current tariff is legacy; the row yields nothing.
3. A row with a value (a value cell in B–F, a Maluti continuation, or a value embedded after a colon in the label) → a charge.
4. A strong header (`^\d+\.`, `Scale X`, `Tariff IV`, `Tariff -A-`, `Tariff A `) → opens a tariff. (`TARIFF PER UNIT` is deliberately not one.)
5. A context line (charge vocabulary, a season, "Inclining Block") → sets hints; a season on an energy-worded line applies to energy only.
6. A value-less line while the current tariff has no charges yet → description (notes).
7. Otherwise: a header if the next non-empty row has a value or is context; else a banner (category hint).

- [ ] **Step 1: Write the failing golden test**

`packages/shared/src/tariffs/parsers/golden.province.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { costMonth } from '../bill-engine'
import { makeTariff, type MonthUsage, type Tariff } from '../types'
import { validateTariff } from '../validators'
import { gridFromFixture, type CellFixture } from './grid'
import { parseProvinceSheet, type ParsedSheet } from './province-xlsx'
import cityPowerFx from '../__fixtures__/gp-city-power.cells.json'
import ekurhuleniFx from '../__fixtures__/gp-ekurhuleni.cells.json'
import lephalaleFx from '../__fixtures__/lp-lephalale.cells.json'
import buffaloFx from '../__fixtures__/ec-buffalo-city.cells.json'
import nmbFx from '../__fixtures__/ec-nmb.cells.json'
import capeTownFx from '../__fixtures__/wc-cape-town.cells.json'
import malutiFx from '../__fixtures__/fs-maluti.cells.json'
import kopanongFx from '../__fixtures__/fs-centlec-kopanong.cells.json'
import gamagaraFx from '../__fixtures__/nc-gamagara.cells.json'

const parse = (fx: unknown): ParsedSheet => {
  const f = fx as CellFixture
  return parseProvinceSheet(gridFromFixture(f), { fileSha256: f.source.sha256 })
}
const tariff = (s: ParsedSheet, pred: (name: string) => boolean): Tariff => {
  const t = s.tariffs.find((x) => pred(x.name))
  if (!t) throw new Error(`no tariff matching in ${s.sheet}: ${s.tariffs.map((x) => x.name).join(' | ')}`)
  return t
}
const usage = (p: Partial<MonthUsage> & { kwh?: number } = {}): MonthUsage => {
  const { kwh, ...rest } = p
  return { year: 2025, month: 1, days: 30, season: 'low', importKwh: { peak: 0, standard: kwh ?? 0, off_peak: 0 }, ...rest }
}
const energy = (t: Tariff) => t.charges.filter((c) => c.component === 'energy')

describe('golden cases re-run from the real cells (as-is/09 §7.2)', () => {
  const cityPower = parse(cityPowerFx)

  it('reads the City Power title and increase', () => {
    expect(cityPower).toMatchObject({ titleName: 'City Power', increasePct: 12.72, vatBasis: 'assumed_excl' })
  })

  it('1. Residential Single Phase 60A (rows 15-22): 800 kWh -> R2,849.26', () => {
    const t = tariff(cityPower, (n) => n === 'Residential Single Phase 60A')
    expect(energy(t).map((c) => [c.blockMinKwh, c.blockMaxKwh, c.amountExclVat, c.unit]))
      .toEqual([[0, 500, 227.28, 'c_per_kWh'], [500, 1000, 260.83, 'c_per_kWh'], [1000, 2000, 280.08, 'c_per_kWh'], [2000, 3000, 295.5, 'c_per_kWh'], [3000, null, 310, 'c_per_kWh']])
    expect(costMonth(t, usage({ kwh: 800 })).totalExclVat).toBe(2849.26)
  })

  it('2. Residential Time of Use (rows 65-75): six values, Standard kept, off-peak not peak -> R2,890.51', () => {
    const t = tariff(cityPower, (n) => n === 'Residential Time of Use (<=80A)')
    expect(validateTariff(t).map((i) => i.code)).not.toContain('tou_incomplete')
    const low = energy(t).filter((c) => c.season === 'low').map((c) => [c.tou, c.amountExclVat])
    expect(low).toEqual([['peak', 275.58], ['standard', 218], ['off_peak', 171.5]])
    const bill = costMonth(t, usage({ month: 7, season: 'high', importKwh: { peak: 100, standard: 200, off_peak: 300 } }))
    expect(bill.totalExclVat).toBe(2890.51)
  })

  it('3. Industrial LV (TOU) (rows 143-155): "R358,84", values in column C, c/kVArh is reactive -> R59,556.92', () => {
    const t = tariff(cityPower, (n) => n === 'Industrial LV (TOU)')
    expect(t.charges.find((c) => c.component === 'reactive')).toMatchObject({ unit: 'c_per_kVArh', amountExclVat: 37.64 })
    expect(t.charges.find((c) => c.component === 'demand')).toMatchObject({ amountExclVat: 358.84, season: 'all' })
    expect(t.charges.find((c) => c.component === 'service')).toMatchObject({ amountExclVat: 1895.11, season: 'all', sourceLocator: { cell: 'C154' } })
    const bill = costMonth(t, usage({ importKwh: { peak: 2000, standard: 5000, off_peak: 3000 }, maxDemandKva: 100, kvarh: 0 }))
    expect(bill.totalExclVat).toBe(59556.92)
  })

  it('4. Ekurhuleni Domestic IBT Tariff A: % in B1, unitless values inferred R/kWh -> R2,901.63', () => {
    const s = parse(ekurhuleniFx)
    expect(s.increasePct).toBe(12.74)
    const t = tariff(s, (n) => n === 'Domestic IBT Tariff A')
    expect(energy(t).every((c) => c.unit === 'R_per_kWh' && c.unitInferred)).toBe(true)
    expect(energy(t).map((c) => [c.blockMinKwh, c.blockMaxKwh])).toEqual([[0, 50], [50, 600], [600, 700], [700, null]])
    expect(costMonth(t, usage({ kwh: 800 })).totalExclVat).toBe(2901.63)
    expect(tariff(s, (n) => n === 'Domestic IBT Tariff A (single rate)').structure).toBe('flat')
  })

  it('5. Lephalale: "R1,6464/kWh" is R/kWh, fraction in B1 -> R1,061.25', () => {
    const s = parse(lephalaleFx)
    expect(s.increasePct).toBe(10.39)
    const t = tariff(s, (n) => n === 'Domestic Prepaid & Conventional')
    expect(energy(t).every((c) => c.unit === 'R_per_kWh' && !c.unitInferred)).toBe(true)
    expect(costMonth(t, usage({ kwh: 400 })).totalExclVat).toBe(1061.25)
  })

  it('6. Buffalo City Scale 1A: says c/kWh, is R/kWh, flagged -> R2,209.00; Scale 4B is legacy and skipped', () => {
    const s = parse(buffaloFx)
    const t = tariff(s, (n) => n.startsWith('Scale 1A'))
    expect(energy(t)[0]).toMatchObject({ unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true })
    expect(energy(t)[0].inferenceReason).toMatch(/^magnitude/)
    expect(costMonth(t, usage({ kwh: 500 })).totalExclVat).toBe(2209)
    expect(s.tariffs.some((x) => x.name.startsWith('Scale 4B'))).toBe(false)
    expect(s.issues.find((i) => i.code === 'legacy_tariff_skipped')?.locator?.row).toBe(71)
    const scale1c = tariff(s, (n) => n.startsWith('Scale 1C'))
    expect(energy(scale1c).map((c) => [c.blockMinKwh, c.blockMaxKwh])).toEqual([[0, 50], [50, 300], [300, null]])
  })

  it('7. Cape Town Large User LV TOU: values inside the label, basic in R/day -> R130,224.30', () => {
    const s = parse(capeTownFx)
    expect(s.increasePct).toBe(11.78)
    const t = tariff(s, (n) => n === 'Large User Low Voltage Time of Use')
    expect(t.charges.find((c) => c.component === 'basic')).toMatchObject({ unit: 'R_per_day', amountExclVat: 168.81 })
    expect(energy(t).filter((c) => c.season === 'low').map((c) => c.amountExclVat)).toEqual([203.8, 142.41, 92.8])
    const bill = costMonth(t, usage({ month: 7, season: 'high', importKwh: { peak: 5000, standard: 15000, off_peak: 10000 }, maxDemandKva: 200, nmdKva: 200 }))
    expect(bill.totalExclVat).toBe(130224.3)
  })

  it('8. Maluti-a-Phofung: ranges in column B, values in C, blank-label continuations, stated VAT-excl -> R1,275.84', () => {
    const s = parse(malutiFx)
    expect(s).toMatchObject({ vatBasis: 'stated_excl', increasePct: 10 })
    const blocks = tariff(s, (n) => n === 'DOMESTIC NON RURAL')
    expect(energy(blocks).filter((c) => c.season === 'low').map((c) => [c.blockMinKwh, c.blockMaxKwh, c.amountExclVat]))
      .toEqual([[0, 50, 1.68], [50, 350, 2.18], [350, 600, 3.08], [600, null, 3.49]])
    const levy = tariff(s, (n) => n.startsWith('TARIFF -A-')).charges.find((c) => c.label === 'Single Phase (Conventional Meters)')
    expect(levy).toMatchObject({ component: 'basic', unit: 'R_per_month', amountExclVat: 383.84, vatBasis: 'stated_excl' })
    // The book prints the levy and the unit rates as separate blocks; the reviewer links them (2b).
    const single = makeTariff({ name: 'Maluti domestic conventional single phase', structure: 'seasonal_ibt', charges: [...blocks.charges, levy!] })
    expect(costMonth(single, usage({ kwh: 400, season: 'low' })).totalExclVat).toBe(1275.84)
  })

  it('9. Centlec-Kopanong "16. SSEG (New)" opens its own sseg tariff (not merged into streetlights)', () => {
    const s = parse(kopanongFx)
    const t = tariff(s, (n) => n === '16. SSEG (New)')
    expect(t.category).toBe('sseg')
    expect(t.charges.map((c) => [c.component, c.tou, c.unit, c.amountExclVat])).toEqual([
      ['basic', 'all', 'R_per_month', 110], ['energy', 'peak', 'R_per_kWh', 1.42],
      ['energy', 'standard', 'R_per_kWh', 0.98], ['energy', 'off_peak', 'R_per_kWh', 0.62],
    ])
    expect(t.charges[0].unitInferred).toBe(true)
    expect(s.issues.some((i) => i.code === 'sseg_semantics_unknown' && i.tariff === t.name)).toBe(true)
  })
})

describe('fixtures that must be flagged, not billed', () => {
  it('Gamagara "Commercial Three Phase Prepaid" 3.52 "c/kWh" beside 353.81: the magnitude flag fires', () => {
    const s = parse(gamagaraFx)
    expect(s.increasePct).toBe(7.71)
    expect(energy(tariff(s, (n) => n === 'Commercial Three Phase Prepaid'))[0]).toMatchObject({ unit: 'R_per_kWh', amountExclVat: 3.52, unitInferred: true })
    expect(energy(tariff(s, (n) => n === 'Commercial Single Phase Prepaid'))[0]).toMatchObject({ unit: 'c_per_kWh', amountExclVat: 353.81, unitInferred: false })
  })
  it('NMB Small Business Prepaid basic = energy = 334.12: the duplicate-value flag fires; the unitless wheeling row is unresolved', () => {
    const s = parse(nmbFx)
    const t = tariff(s, (n) => n.startsWith('Small Business Prepaid Tariff'))
    expect(validateTariff(t).map((i) => i.code)).toContain('duplicate_value')
    expect(s.unresolved.map((u) => u.label)).toContain('Wheeling Charge')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/golden.province.test.ts`
Expected: FAIL — `Failed to resolve import "./province-xlsx"`.

- [ ] **Step 3: Implement the province parser**

`packages/shared/src/tariffs/parsers/province-xlsx.ts`:
```ts
/**
 * Front end for the NERSA province compendium workbooks (one sheet per
 * licensee; layouts in as-is/09 §2.2). Values may sit in B, C, D or E, be
 * typed as text with the unit glued on, carry a block range in B (Maluti), or
 * sit inside the column-A sentence (Cape Town). Nothing here decides a unit:
 * that is normaliseCharge.
 */
import { parseUnitToken } from '../units'
import type { ChargeComponent, Tariff, TariffCategory, TariffSeason, TariffUnit, VatBasis } from '../types'
import type { TariffIssue } from '../validators'
import { parseAmount, parseTitle, type ParsedAmount } from './amount'
import { parseBlockRange } from './blocks'
import { colToLetters, type CellValue, type Grid } from './grid'
import { cleanLabel, detectCategory, detectSeason, labelUnit } from './labels'
import { normaliseCharge, type Unresolved } from './normalise'
import { finishDraft, newDraft, type TariffDraft } from './tariff-draft'

export interface ParsedSheet {
  sheet: string
  titleName: string
  increasePct: number | null
  vatBasis: VatBasis
  tariffs: Tariff[]
  issues: TariffIssue[]
  unresolved: Unresolved[]
}

export interface ProvinceParseOptions {
  fileSha256: string
}

// "TARIFF -A- …" and "Tariff A – …" are headers; "TARIFF PER UNIT" is a context line, not a header.
const STRONG_HEADER = /^(\d+(?:\.\d+)*\.?\s+\S|scale\s+\w+|tariff\s+[ivx]+\b|tariff\s*-[a-z0-9]{1,3}-|tariff\s+[a-z0-9]\s)/i
const CONTEXT_VOCAB = /\b(charges?|levy|per unit|per month|energy|demand|season|consumption)\b/i
const IBT_CONTEXT = /inclining block/i
const ENERGY_WORDED = /energy|kwh|consumption|per unit/i
const MARKER = /\b(redundant|obsolete)\b/i
const RECOMMENDED = /recommended|proposed/i
const VAT_EXCL = /(do not include|excl(?:uding|usive)?\.?)\s*vat|vat\s*excl/i
const VAT_INCL = /\b(incl(?:uding|usive)?\.?)\s*vat|vat\s*incl/i

interface RowRead {
  row: number
  label: string
  value: { col: number; raw: CellValue; amount: ParsedAmount } | null
  embedded: { label: string; amount: ParsedAmount; raw: string } | null
  unitColumn: TariffUnit | null
  blockCell: string | null
  texts: string[]
}

function readRow(grid: Grid, row: number): RowRead | null {
  const a = grid.get(row, 1)
  const label = typeof a === 'string' ? cleanLabel(a) : a === null ? '' : String(a)
  const lastCol = Math.min(6, Math.max(grid.maxCol, 2))
  let value: RowRead['value'] = null
  for (let col = lastCol; col >= 2; col--) {
    const raw = grid.get(row, col)
    const amount = parseAmount(raw)
    if (amount && parseUnitToken(amount.unitText, { randPrefix: amount.randPrefix, bare: true }) !== 'pct') {
      value = { col, raw, amount }
      break
    }
  }
  const texts: string[] = []
  for (let col = 2; col <= lastCol; col++) {
    const v = grid.get(row, col)
    if (typeof v === 'string' && v.trim() !== '' && !(value && value.col === col)) texts.push(v.trim())
  }
  let unitColumn: TariffUnit | null = null
  if (value) {
    const next = grid.get(row, value.col + 1)
    if (typeof next === 'string' && parseAmount(next) === null) unitColumn = parseUnitToken(next, { bare: true })
  }
  const b = grid.get(row, 2)
  const blockCell = value && value.col > 2 && typeof b === 'string' && parseBlockRange(b) ? b : null
  let embedded: RowRead['embedded'] = null
  if (!value && label.includes(':')) {
    const idx = label.indexOf(':')
    const tail = label.slice(idx + 1).trim()
    const amount = tail === '' ? null : parseAmount(tail)
    if (amount) embedded = { label: label.slice(0, idx).trim(), amount, raw: tail }
  }
  if (label === '' && !value && texts.length === 0) return null
  return { row, label, value, embedded, unitColumn, blockCell, texts }
}

const hasValue = (r: RowRead | undefined): boolean => !!r && (r.value !== null || r.embedded !== null)

function isContext(r: RowRead | undefined): boolean {
  if (!r || hasValue(r) || r.label === '' || STRONG_HEADER.test(r.label)) return false
  return CONTEXT_VOCAB.test(r.label) || IBT_CONTEXT.test(r.label) || detectSeason(r.label) !== null
}

function contextComponent(label: string): ChargeComponent | null {
  if (/levy|basic|fixed/i.test(label)) return 'basic'
  if (/demand/i.test(label)) return 'demand'
  if (ENERGY_WORDED.test(label)) return 'energy'
  return null
}

export function parseProvinceSheet(grid: Grid, opts: ProvinceParseOptions): ParsedSheet {
  const title = parseTitle(grid.get(1, 1), grid.get(1, 2))
  const out: ParsedSheet = {
    sheet: grid.sheet, titleName: title.name || grid.sheet.trim(), increasePct: title.increasePct,
    vatBasis: 'assumed_excl', tariffs: [], issues: [], unresolved: [],
  }
  if (title.increasePct === null) {
    out.issues.push({ code: 'increase_missing', severity: 'review', message: `no increase % in A1/B1 of "${grid.sheet}"`, locator: { file_sha256: opts.fileSha256, sheet: grid.sheet, cell: 'A1' } })
  }

  const rows: RowRead[] = []
  for (let r = 2; r <= grid.maxRow; r++) {
    const rr = readRow(grid, r)
    if (rr) rows.push(rr)
  }

  const taken = new Set<string>()
  let cur: TariffDraft | null = null
  let headerUnit: TariffUnit | null = null
  let componentHint: ChargeComponent | null = null
  let contextUnit: TariffUnit | null = null
  let seasonState: { energy: TariffSeason; general: TariffSeason } = { energy: 'all', general: 'all' }
  let bannerCategory: TariffCategory | null = null
  let lastChargeLabel = ''

  const close = (): void => {
    if (!cur) return
    const done = finishDraft(cur, taken)
    out.tariffs.push(...done.tariffs)
    out.issues.push(...done.issues)
    cur = null
  }
  const open = (rr: RowRead): void => {
    close()
    cur = newDraft({ name: rr.label, fileSha256: opts.fileSha256, sheet: grid.sheet, headerRow: rr.row, categoryHint: bannerCategory })
    headerUnit = rr.texts.map((t) => parseUnitToken(t)).find((u): u is TariffUnit => u !== null) ?? null
    componentHint = null
    contextUnit = null
    seasonState = { energy: 'all', general: 'all' }
    lastChargeLabel = ''
  }

  for (let k = 0; k < rows.length; k++) {
    const rr = rows[k]
    const allText = [rr.label, ...rr.texts].join(' ')

    if (!hasValue(rr) && VAT_EXCL.test(allText)) { out.vatBasis = 'stated_excl'; continue }
    if (!hasValue(rr) && VAT_INCL.test(allText)) { out.vatBasis = 'stated_incl'; continue }
    if (rr.texts.some((t) => MARKER.test(t))) {
      if (cur) (cur as TariffDraft).isLegacy = true
      continue
    }
    if (!hasValue(rr) && rr.label === '') {
      if (cur && rr.texts.some((t) => RECOMMENDED.test(t))) (cur as TariffDraft).notes.push(rr.texts.join(' '))
      continue
    }

    if (hasValue(rr)) {
      if (!cur) {
        open({ ...rr, label: `${out.titleName} (untitled)` })
        out.issues.push({ code: 'orphan_charge', severity: 'review', message: `a charge before any tariff header (row ${rr.row})`, locator: { file_sha256: opts.fileSha256, sheet: grid.sheet, row: rr.row } })
      }
      const label = rr.embedded ? rr.embedded.label : rr.label || lastChargeLabel
      const amount = rr.embedded ? rr.embedded.amount : (rr.value as NonNullable<RowRead['value']>).amount
      const col = rr.embedded ? 1 : (rr.value as NonNullable<RowRead['value']>).col
      const rawValue = rr.embedded ? rr.embedded.raw : String((rr.value as NonNullable<RowRead['value']>).raw)
      const res = normaliseCharge({
        label, amount, rawValue, unitColumn: rr.unitColumn, contextUnit, headerUnit, componentHint, seasonState,
        blockText: rr.blockCell, vatBasis: out.vatBasis, extractionMethod: 'parser',
        locator: { file_sha256: opts.fileSha256, sheet: grid.sheet, row: rr.row, col: colToLetters(col), cell: `${colToLetters(col)}${rr.row}`, raw_text: `${label} = ${rawValue}` },
      })
      if (res.ok) {
        const draft = cur as unknown as TariffDraft
        draft.charges.push(res.charge)
        out.issues.push(...res.issues)
        // A season written on an ENERGY label carries to the energy rows that follow it.
        const s = detectSeason(label)
        if (s && (res.charge.component === 'energy' || res.charge.component === 'export_credit')) seasonState = { ...seasonState, energy: s }
      } else {
        out.unresolved.push(res.unresolved)
      }
      if (rr.label) lastChargeLabel = rr.label
    } else if (STRONG_HEADER.test(rr.label)) {
      open(rr)
    } else if (isContext(rr)) {
      const s = detectSeason(rr.label)
      if (s) seasonState = ENERGY_WORDED.test(rr.label) ? { ...seasonState, energy: s } : { energy: s, general: s }
      const comp = contextComponent(rr.label)
      const u = labelUnit(rr.label) ?? rr.texts.map((t) => parseUnitToken(t)).find((x): x is TariffUnit => x !== null) ?? null
      if (comp !== null && comp !== componentHint) {
        componentHint = comp
        contextUnit = u
      } else if (u !== null) {
        contextUnit = u
      }
    } else if (cur && (cur as TariffDraft).charges.length === 0) {
      (cur as TariffDraft).notes.push(rr.label)
    } else {
      const next = rows[k + 1]
      if (hasValue(next) || isContext(next)) open(rr)
      else bannerCategory = detectCategory(rr.label) ?? bannerCategory
    }
    if (cur && MARKER.test(rr.label)) (cur as TariffDraft).isLegacy = true
  }
  close()
  return out
}

export function parseProvinceWorkbook(grids: readonly Grid[], opts: ProvinceParseOptions): ParsedSheet[] {
  return grids.map((g) => parseProvinceSheet(g, opts))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/golden.province.test.ts`
Expected: PASS, 11 tests. When a case fails, print the tariff names (`tariff()` already does) and the charges of the failing tariff before changing any rule; a rule change must keep every other case green (run the whole file each time).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/parsers/province-xlsx.ts packages/shared/src/tariffs/parsers/golden.province.test.ts
git commit -m "feat(tariffs): NERSA province compendium parser; golden cases 1-9 re-run from real cells

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Eskom xlsm parser, loss factors, export linking + golden case 10 from real cells

**Files:**
- Create: `packages/shared/src/tariffs/parsers/eskom-xlsm.ts`
- Test: `packages/shared/src/tariffs/parsers/eskom-xlsm.test.ts`

Eskom sheets are banded tables: a title row naming each charge and its unit in brackets (`Active energy charge [c/kWh]`), optional season and period rows below it, and a row of `VAT incl` markers; the excl value sits in the column left of each `VAT incl`. The parser finds tables by their `VAT incl` rows, so the same code reads 2025/26 and 2026/27. 2a parses the NLA sheets listed in `ESKOM_SHEETS`; municipal ("Munic") sheets are skipped and reported (open question Q5).

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/parsers/eskom-xlsm.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { costMonth } from '../bill-engine'
import { netBillingRule } from '../net-billing-rules'
import { validateTariff } from '../validators'
import type { MonthUsage, Tariff } from '../types'
import { gridFromCells, gridFromFixture, type CellFixture } from './grid'
import { parseEskomWorkbook } from './eskom-xlsm'
import hf25 from '../__fixtures__/eskom-2025-homeflex.cells.json'
import go25 from '../__fixtures__/eskom-2025-gen-offset.cells.json'
import lf25 from '../__fixtures__/eskom-2025-loss-factors.cells.json'
import br25 from '../__fixtures__/eskom-2025-businessrate.cells.json'
import mf25 from '../__fixtures__/eskom-2025-megaflex.cells.json'
import hf26 from '../__fixtures__/eskom-2026-homeflex.cells.json'
import go26 from '../__fixtures__/eskom-2026-gen-offset.cells.json'

const grids = (...fx: unknown[]) => fx.map((f) => gridFromFixture(f as CellFixture))
const byCode = (ts: Tariff[], code: string): Tariff => {
  const t = ts.find((x) => x.code === code)
  if (!t) throw new Error(`no ${code}: ${ts.map((x) => x.code).join(',')}`)
  return t
}
const july = (exportStd: number): MonthUsage => ({
  year: 2025, month: 7, days: 30, season: 'high',
  importKwh: { peak: 100, standard: 300, off_peak: 200 }, exportKwh: { peak: 0, standard: exportStd, off_peak: 0 },
})

describe('Eskom 2025/26 official workbook', () => {
  const parsed = parseEskomWorkbook(grids(hf25, go25, lf25, br25, mf25), { fileSha256: (hf25 as CellFixture).source.sha256 })

  it('reads Homeflex 1 with excl values, incl kept as proof, per-POD-day fixed charges and c/kWh adders', () => {
    const hf1 = byCode(parsed.tariffs, 'HF101N')
    expect(hf1.name).toBe('Homeflex 1 (HF101N)')
    const e = hf1.charges.filter((c) => c.component === 'energy').map((c) => [c.season, c.tou, c.amountExclVat])
    expect(e).toEqual([
      ['high', 'peak', 706.97], ['high', 'standard', 216.31], ['high', 'off_peak', 159.26],
      ['low', 'peak', 329.28], ['low', 'standard', 204.9], ['low', 'off_peak', 159.26],
    ])
    expect(hf1.charges.find((c) => c.component === 'energy')?.sourceLocator.raw_incl).toBe(813.02)
    expect(hf1.charges.find((c) => c.component === 'service')).toMatchObject({ unit: 'R_per_POD_day', amountExclVat: 3.27 })
    expect(hf1.charges.find((c) => c.component === 'network_demand')).toMatchObject({ unit: 'c_per_kWh', amountExclVat: 26.37 })
    expect(hf1.charges.find((c) => c.component === 'network_capacity')).toMatchObject({ unit: 'R_per_POD_day', amountExclVat: 12.13 })
    expect(hf1.charges.find((c) => c.component === 'gcc')).toMatchObject({ amountExclVat: 0.72 })
    expect(hf1.charges.every((c) => c.vatBasis === 'stated_excl')).toBe(true)
    expect(validateTariff(hf1).filter((i) => i.severity === 'block')).toEqual([])
  })

  it('shares the one Homeflex energy row with Homeflex 2-4, and says so', () => {
    const hf3 = byCode(parsed.tariffs, 'HF301N')
    expect(hf3.charges.filter((c) => c.component === 'energy')).toHaveLength(6)
    expect(hf3.charges.find((c) => c.component === 'network_capacity')?.amountExclVat).toBe(57.82)
    expect(parsed.issues.some((i) => i.code === 'eskom_shared_energy_row' && i.tariff === hf3.name)).toBe(true)
  })

  it('reads Gen-offset as separate sseg export tariffs and links them', () => {
    const go = byCode(parsed.tariffs, 'GOHF101N')
    expect(go.category).toBe('sseg')
    expect(go.charges.map((c) => [c.component, c.season, c.tou, c.amountExclVat])).toEqual([
      ['export_credit', 'high', 'peak', 650.52], ['export_credit', 'high', 'standard', 185.41], ['export_credit', 'high', 'off_peak', 131.21],
      ['export_credit', 'low', 'peak', 292.75], ['export_credit', 'low', 'standard', 174.58], ['export_credit', 'low', 'off_peak', 131.21],
    ])
    expect(byCode(parsed.tariffs, 'HF101N').exportTariffCode).toBe('GOHF101N')
    const urban = byCode(parsed.tariffs, 'NLUrbOffset01N')
    expect(urban).toMatchObject({ transmissionZone: 0, voltageBand: 'lt_500v' })
    expect(urban.charges.slice(0, 3).map((c) => c.amountExclVat)).toEqual([650.52, 162.63, 108.42])
    expect(byCode(parsed.tariffs, 'Me01N').exportTariffCode).toBe('NLUrbOffset01N')
  })

  it('10. golden: Homeflex 1 + Gen-Offset Homeflex from the real cells -> R2,177.26; S400 variant -> credit R556.23', () => {
    const hf1 = byCode(parsed.tariffs, 'HF101N')
    const go = byCode(parsed.tariffs, 'GOHF101N')
    expect(costMonth(hf1, july(150), { exportTariff: go, sseg: netBillingRule('eskom') }).totalExclVat).toBe(2177.26)
    expect(costMonth(hf1, july(400), { exportTariff: go, sseg: netBillingRule('eskom') }).credit.earned).toBe(556.23)
  })

  it('reads Megaflex zone x voltage rows and Businessrate flat energy, dropping a zero duplicate column', () => {
    const me = byCode(parsed.tariffs, 'Me01N')
    expect(me).toMatchObject({ name: 'Megaflex (Me01N)', transmissionZone: 0, voltageBand: 'lt_500v', category: 'industrial' })
    expect(me.charges.find((c) => c.component === 'gcc')).toMatchObject({ unit: 'R_per_kVA_month', amountExclVat: 3.49 })
    expect(me.charges.find((c) => c.component === 'transmission_network')?.amountExclVat).toBe(10.63)
    const br = byCode(parsed.tariffs, 'B101N')
    expect(br).toMatchObject({ name: 'Businessrate 1 (B101N)', structure: 'flat', category: 'commercial' })
    expect(br.charges.filter((c) => c.component === 'ers').map((c) => c.amountExclVat)).toEqual([4.94])
    expect(parsed.issues.some((i) => i.code === 'eskom_duplicate_column')).toBe(true)
  })

  it('reads the loss-factor table', () => {
    const lf = parsed.lossFactors.map((f) => [f.kind, f.voltageBand ?? f.transmissionZone, f.factor])
    expect(lf).toEqual([
      ['dx_urban', 'lt_500v', 1.1862], ['dx_rural', 'lt_500v', 1.1973],
      ['dx_urban', '500v_66kv', 1.1556], ['dx_rural', '500v_66kv', 1.1761],
      ['dx_urban', '66kv_132kv', 1.0724], ['dx_urban', 'gt_132kv', 1],
      ['tx', 0, 1.006], ['tx', 1, 1.016], ['tx', 2, 1.0261], ['tx', 3, 1.0361],
    ])
  })

  it('refuses a broken excl/incl pair through the validator', () => {
    const broken = gridFromCells('Homeflex NLA', {
      ...(hf25 as CellFixture).cells, F11: 900,
    })
    const p = parseEskomWorkbook([broken], { fileSha256: 'x' })
    expect(validateTariff(byCode(p.tariffs, 'HF101N')).map((i) => i.code)).toContain('vat_pair')
  })
})

describe('Eskom 2026/27 workbook (same layout)', () => {
  const parsed = parseEskomWorkbook(grids(hf26, go26), { fileSha256: (hf26 as CellFixture).source.sha256 })
  it('10b. Homeflex 1 + Gen-Offset Homeflex 2026/27 -> R2,366.21', () => {
    // energy 736.61 + 676.14 + 331.88 = 1,744.63; adders (0.45+24.78+28.68)c x 600 = 323.46;
    // service 5.74x30 = 172.20; NCC 13.19x30 = 395.70; GCC 1.09x30 = 32.70; import 2,668.69;
    // credit 150 x 201.65c = 302.475 -> 302.48; total 2,366.21.
    const hf1 = byCode(parsed.tariffs, 'HF101N')
    const go = byCode(parsed.tariffs, 'GOHF101N')
    expect(costMonth(hf1, { ...july(150), year: 2026 }, { exportTariff: go, sseg: netBillingRule('eskom') }).totalExclVat).toBe(2366.21)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/eskom-xlsm.test.ts`
Expected: FAIL — `Failed to resolve import "./eskom-xlsm"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/parsers/eskom-xlsm.ts`:
```ts
/**
 * Front end for Eskom's official tariff workbook (as-is/09 §3.1). Tables are
 * found by their "VAT incl" marker row; the excl value is the column left of
 * each marker and the incl value is kept in source_locator.raw_incl so the
 * validator can prove x1.15. Gen-offset tables are separate export (sseg)
 * tariffs linked to their import tariffs by family, zone and voltage.
 */
import { makeCharge, type Charge, type DemandBasis, type LossFactor, type Tariff, type TariffUnit } from '../types'
import { parseUnitToken } from '../units'
import type { TariffIssue } from '../validators'
import { colToLetters, type CellValue, type Grid } from './grid'
import { detectCategory, detectComponent, detectSeason, detectTou, voltageBandFromText } from './labels'
import { inferStructure } from './tariff-draft'

export const ESKOM_SHEETS: readonly string[] = [
  'Homeflex NLA', 'Businessrate NLA', 'Megaflex NLA', 'Miniflex NLA', 'Nightsave Urban NLA', 'Nightsave Rural NLA',
  'Ruraflex NLA', 'Landrate NLA', 'Homepower NLA', 'Gen-offset',
]

export interface ParsedEskom {
  tariffs: Tariff[]
  lossFactors: LossFactor[]
  issues: TariffIssue[]
  skippedSheets: { sheet: string; reason: string }[]
}

const BILL_CODE = /^[A-Za-z]+\d+[A-Z]$/
const text = (v: CellValue): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

interface Table {
  vatRow: number
  titleRow: number
  seasonRow: number | null
  periodRow: number | null
  inclCols: number[]
  title: string
  zoneCol: number | null
  zoneTextCol: number | null
  voltageTextCol: number | null
  firstDataRow: number
}

interface Acc {
  code: string
  family: string
  isExport: boolean
  localAuthority: boolean
  descriptive: string | null
  appliesTo: string | null
  zone: number | null
  voltageText: string | null
  charges: Charge[]
  firstRow: number
}

function rowHas(g: Grid, row: number, pred: (s: string) => boolean): number | null {
  for (let c = 1; c <= g.maxCol; c++) if (pred(text(g.get(row, c)))) return c
  return null
}

function nearestLeft(g: Grid, row: number | null, col: number, minCol: number): { col: number; text: string } | null {
  if (row === null) return null
  for (let c = col; c >= minCol; c--) {
    const t = text(g.get(row, c))
    if (t !== '') return { col: c, text: t }
  }
  return null
}

function findTables(g: Grid): Table[] {
  const tables: Table[] = []
  let prevEnd = 0
  let prevTitle = g.sheet.trim()
  for (let r = 1; r <= g.maxRow; r++) {
    if (rowHas(g, r, (s) => s === 'VAT incl') === null) continue
    let titleRow: number | null = null
    for (let h = r - 1; h > Math.max(prevEnd, r - 6); h--) {
      if (rowHas(g, h, (s) => /\[.+\]/.test(s)) !== null) { titleRow = h; break }
    }
    if (titleRow === null) { prevEnd = r; continue }
    const tr: number = titleRow
    const within = (pred: (s: string) => boolean): number | null => {
      for (let h = tr + 1; h <= r; h++) if (rowHas(g, h, pred) !== null) return h
      return null
    }
    let title = prevTitle
    for (let h = tr; h > prevEnd; h--) {
      const c = rowHas(g, h, (s) => /authority/i.test(s))
      if (c !== null) { title = text(g.get(h, c)); break }
    }
    prevTitle = title
    const inclCols: number[] = []
    for (let c = 1; c <= g.maxCol; c++) if (text(g.get(r, c)) === 'VAT incl') inclCols.push(c)
    const headerCol = (pred: (s: string) => boolean, fromRow: number, toRow: number): number | null => {
      for (let h = fromRow; h <= toRow; h++) {
        const c = rowHas(g, h, pred)
        if (c !== null) return c
      }
      return null
    }
    tables.push({
      vatRow: r, titleRow: tr,
      seasonRow: within((s) => /season/i.test(s)),
      periodRow: within((s) => s === 'Peak'),
      inclCols, title,
      zoneCol: headerCol((s) => s === 'Tx zone', r, r),
      zoneTextCol: headerCol((s) => s === 'Transmission zone', tr, r - 1),
      voltageTextCol: headerCol((s) => s === 'Voltage', tr, r - 1),
      firstDataRow: r + 1,
    })
    prevEnd = r
  }
  return tables
}

function familyOf(title: string): string {
  return title.replace(/\s*[–-]\s*(non-)?local authority.*$/i, '').replace(/\s+/g, ' ').trim()
}

function demandBasisFor(component: Charge['component'], unit: TariffUnit): DemandBasis | null {
  if (unit !== 'R_per_kVA_month' && unit !== 'R_per_kW_month') return component === 'network_capacity' ? 'nmd' : null
  return component === 'demand' ? 'actual_md' : 'utilised_capacity'
}

export function parseEskomSheet(g: Grid, opts: { fileSha256: string }): { accs: Acc[]; issues: TariffIssue[] } {
  const accs = new Map<string, Acc>()
  const issues: TariffIssue[] = []
  for (const t of findTables(g)) {
    const family = familyOf(t.title)
    const isExport = /gen-?offset/i.test(family)
    const localAuthority = !/non-local/i.test(t.title) && /local authority|munic/i.test(t.title)
    for (let r = t.firstDataRow; r <= g.maxRow; r++) {
      let codeCol: number | null = null
      for (let c = 1; c <= 8; c++) if (BILL_CODE.test(text(g.get(r, c)))) { codeCol = c; break }
      if (codeCol === null) break
      const code = text(g.get(r, codeCol))
      const colA = text(g.get(r, 1))
      let descriptive: string | null = null
      if (!isExport && colA !== '' && colA !== family && colA !== code) descriptive = colA
      if (!isExport && descriptive === null) {
        for (let c = 2; c <= 8; c++) {
          if (c === codeCol || c === t.zoneTextCol || c === t.voltageTextCol || c === t.zoneCol) continue
          const s = text(g.get(r, c))
          if (s.length > 3 && /[a-z]/i.test(s) && !BILL_CODE.test(s) && s !== family) { descriptive = s; break }
        }
      }
      const zoneRaw = t.zoneCol !== null ? g.get(r, t.zoneCol) : null
      const acc: Acc = accs.get(code) ?? {
        code, family, isExport, localAuthority, descriptive: null, appliesTo: isExport && colA !== '' ? colA : null,
        zone: typeof zoneRaw === 'number' ? zoneRaw : null,
        voltageText: t.voltageTextCol !== null ? text(g.get(r, t.voltageTextCol)) || null : null,
        charges: [], firstRow: r,
      }
      acc.descriptive = acc.descriptive ?? descriptive
      accs.set(code, acc)

      for (const incl of t.inclCols) {
        const excl = incl - 1
        const v = g.get(r, excl)
        if (typeof v !== 'number') continue
        const titleCell = nearestLeft(g, t.titleRow, excl, 1)
        if (!titleCell) continue
        const bracket = /\[([^\]]+)\]/.exec(titleCell.text)
        const unit = bracket ? parseUnitToken(bracket[1]) : null
        if (unit === null) {
          issues.push({ code: 'unit_unknown', severity: 'review', message: `no unit in "${titleCell.text}"`, locator: { file_sha256: opts.fileSha256, sheet: g.sheet, cell: `${colToLetters(titleCell.col)}${t.titleRow}` } })
          continue
        }
        const component = isExport && (unit === 'c_per_kWh' || unit === 'R_per_kWh') ? 'export_credit' : detectComponent(titleCell.text, unit, null)
        const seasonCell = nearestLeft(g, t.seasonRow, excl, titleCell.col)
        const periodCell = nearestLeft(g, t.periodRow, excl, seasonCell?.col ?? titleCell.col)
        const season = seasonCell ? detectSeason(seasonCell.text) ?? 'all' : 'all'
        const tou = periodCell ? detectTou(periodCell.text) ?? 'all' : 'all'
        const inclV = g.get(r, incl)
        const charge = makeCharge({
          component, unit, amountExclVat: v, season, tou,
          demandBasis: demandBasisFor(component, unit),
          vatBasis: 'stated_excl', extractionMethod: 'parser', label: titleCell.text,
          sourceLocator: {
            file_sha256: opts.fileSha256, sheet: g.sheet, row: r, col: colToLetters(excl), cell: `${colToLetters(excl)}${r}`,
            raw_text: `${titleCell.text} = ${v}`, raw_unit: bracket ? bracket[1] : null,
            ...(typeof inclV === 'number' ? { raw_incl: inclV } : {}),
          },
        })
        const key = `${component}|${season}|${tou}`
        const at = acc.charges.findIndex((c) => `${c.component}|${c.season}|${c.tou}` === key)
        if (at >= 0) {
          issues.push({ code: 'eskom_duplicate_column', severity: 'warn', message: `${code}: a second "${titleCell.text}" column (${v}); kept the first non-zero`, locator: charge.sourceLocator })
          if (acc.charges[at].amountExclVat === 0 && v !== 0) acc.charges[at] = charge
          continue
        }
        acc.charges.push(charge)
      }
    }
  }

  // Homeflex prints one energy row (HF101N) for the whole family.
  const list = [...accs.values()]
  for (const family of new Set(list.map((a) => a.family))) {
    const members = list.filter((a) => a.family === family)
    const withEnergy = members.filter((a) => a.charges.some((c) => c.component === 'energy'))
    if (withEnergy.length !== 1) continue
    const donor = withEnergy[0]
    for (const m of members) {
      if (m === donor || m.charges.some((c) => c.component === 'energy')) continue
      const have = new Set(m.charges.map((c) => `${c.component}|${c.season}|${c.tou}`))
      for (const c of donor.charges) if (!have.has(`${c.component}|${c.season}|${c.tou}`)) m.charges.push({ ...c })
      issues.push({ code: 'eskom_shared_energy_row', severity: 'review', message: `${m.code}: energy and per-kWh charges taken from ${donor.code}, the family's only energy row`, tariff: nameOf(m) })
    }
  }
  return { accs: list, issues }
}

function nameOf(a: Acc): string {
  return `${a.descriptive ?? a.family} (${a.code})`
}

function toTariff(a: Acc): Tariff {
  return {
    code: a.code, name: nameOf(a), family: a.family,
    category: a.isExport ? 'sseg' : detectCategory(a.family) ?? 'other',
    metering: 'both', structure: inferStructure(a.charges),
    voltageBand: voltageBandFromText(a.voltageText), phase: null, transmissionZone: a.zone,
    localAuthority: a.localAuthority, minAmps: null, maxAmps: null, minKva: null, maxKva: null,
    isLegacy: false, notes: a.appliesTo ? `export credit for ${a.appliesTo}` : null,
    charges: a.charges, exportTariffCode: null,
    sourceLocator: { file_sha256: a.charges[0]?.sourceLocator.file_sha256, sheet: a.charges[0]?.sourceLocator.sheet, row: a.firstRow },
  }
}

export function parseLossFactors(g: Grid, opts: { fileSha256: string }): LossFactor[] {
  const out: LossFactor[] = []
  for (let r = 1; r <= g.maxRow; r++) {
    const urbanCol = rowHas(g, r, (s) => /^urban loss factor$/i.test(s))
    if (urbanCol === null) continue
    const ruralCol = rowHas(g, r, (s) => /^rural loss factor$/i.test(s))
    let voltCol: number | null = null
    for (let c = urbanCol - 1; c >= 1; c--) if (text(g.get(r, c)) === 'Voltage') { voltCol = c; break }
    const zoneCol = rowHas(g, r, (s) => s === 'Zone')
    const lfCol = rowHas(g, r, (s) => /^loss factor$/i.test(s))
    const loc = (row: number, col: number) => ({ file_sha256: opts.fileSha256, sheet: g.sheet, row, cell: `${colToLetters(col)}${row}` })
    const f5 = (x: number) => Math.round(x * 1e5) / 1e5
    for (let row = r + 1; voltCol !== null && text(g.get(row, voltCol)) !== ''; row++) {
      const band = voltageBandFromText(text(g.get(row, voltCol)))
      const u = g.get(row, urbanCol)
      if (typeof u === 'number') out.push({ kind: 'dx_urban', voltageBand: band, transmissionZone: null, factor: f5(u), sourceLocator: loc(row, urbanCol) })
      const ru = ruralCol === null ? null : g.get(row, ruralCol)
      if (typeof ru === 'number' && ruralCol !== null) out.push({ kind: 'dx_rural', voltageBand: band, transmissionZone: null, factor: f5(ru), sourceLocator: loc(row, ruralCol) })
    }
    for (let row = r + 1; zoneCol !== null && lfCol !== null && typeof g.get(row, zoneCol) === 'number'; row++) {
      const factor = g.get(row, lfCol)
      if (typeof factor === 'number') out.push({ kind: 'tx', voltageBand: null, transmissionZone: g.get(row, zoneCol) as number, factor: f5(factor), sourceLocator: loc(row, lfCol) })
    }
    break
  }
  return out
}

export function parseEskomWorkbook(grids: readonly Grid[], opts: { fileSha256: string }): ParsedEskom {
  const res: ParsedEskom = { tariffs: [], lossFactors: [], issues: [], skippedSheets: [] }
  const accs: Acc[] = []
  for (const g of grids) {
    const name = g.sheet.trim()
    if (name === 'Loss Factors') { res.lossFactors.push(...parseLossFactors(g, opts)); continue }
    if (!ESKOM_SHEETS.includes(name)) {
      res.skippedSheets.push({ sheet: name, reason: /munic/i.test(name) ? 'local-authority sheet: not parsed in 2a (open question Q5)' : 'not a 2a sheet' })
      continue
    }
    const p = parseEskomSheet(g, opts)
    accs.push(...p.accs)
    res.issues.push(...p.issues)
  }
  const tariffs = accs.map(toTariff)
  // Link each import tariff to its Gen-offset export tariff: same family, zone and voltage.
  const exports = accs.filter((a) => a.isExport)
  for (const [i, a] of accs.entries()) {
    if (a.isExport) continue
    const hit = exports.find((x) =>
      (x.appliesTo ?? x.family.replace(/^gen-?offset\s+/i, '')).toLowerCase() === a.family.toLowerCase()
      && x.zone === a.zone
      && voltageBandFromText(x.voltageText) === voltageBandFromText(a.voltageText))
    if (hit) tariffs[i].exportTariffCode = hit.code
  }
  res.tariffs = tariffs
  return res
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/eskom-xlsm.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/parsers/eskom-xlsm.ts packages/shared/src/tariffs/parsers/eskom-xlsm.test.ts
git commit -m "feat(tariffs): Eskom xlsm parser (Homeflex, Gen-offset, loss factors); golden case 10 from real cells, both years

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: NERSA 2026/27 RfD text parser (draft rows for review)

**Files:**
- Create: `packages/shared/src/tariffs/parsers/rfd-text.ts`
- Test: `packages/shared/src/tariffs/parsers/rfd-text.test.ts`

D-29: there is no 2026/27 compendium; NERSA published one "Decision and Reasons for Decision" PDF per licensee (176 files + `manifest.csv`). Their tariff tables print five columns — *2025/26 approved*, *proposed %*, *2026/27 proposed*, **2026/27 recommended** (the approved value), *recommended %* — with the numbers either on the label's line or on the line just above it. Text comes from `pdftotext -layout` (the repo's `pdfjs-dist` renders pages; it does not reproduce column layout, which this grammar depends on). Every row the parser emits is `extraction_method = 'parser'` and lands in an `in_review` year. AI-assisted extraction is not in 2a (see "Deferred").

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/parsers/rfd-text.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { costMonth } from '../bill-engine'
import type { MonthUsage } from '../types'
import { parseRfdText } from './rfd-text'

const text = readFileSync(new URL('../__fixtures__/city-power-rfd-2026-27.excerpt.txt', import.meta.url), 'utf8')
const parsed = parseRfdText(text, { fileSha256: 'fixture' })
const t = (name: string) => {
  const hit = parsed.tariffs.find((x) => x.name === name)
  if (!hit) throw new Error(`no "${name}": ${parsed.tariffs.map((x) => x.name).join(' | ')}`)
  return hit
}

describe('City Power 2026/27 RfD (pdftotext -layout excerpt)', () => {
  it('takes the Recommended column, numbers above or beside their label', () => {
    const r60 = t('Residential Single Phase 60A')
    expect(r60.charges.filter((c) => c.component === 'energy').map((c) => [c.blockMinKwh, c.blockMaxKwh, c.amountExclVat]))
      .toEqual([[0, 500, 288.27], [500, 1000, 330.82], [1000, 2000, 355.23], [2000, 3000, 374.79], [3000, null, 393.19]])
    expect(r60.charges.find((c) => c.component === 'service')).toMatchObject({ unit: 'R_per_month', amountExclVat: 235.79 })
    expect(r60.charges.every((c) => c.extractionMethod === 'parser' && c.sourceLocator.line !== undefined)).toBe(true)
  })
  it('reads seasons and TOU periods, and the recommended increase', () => {
    const tou = t('Residential Time of Use (<=80A)')
    expect(tou.charges.filter((c) => c.component === 'energy').map((c) => [c.season, c.tou, c.amountExclVat])).toEqual([
      ['low', 'peak', 340.42], ['low', 'standard', 269.3], ['low', 'off_peak', 211.86],
      ['high', 'peak', 783.2], ['high', 'standard', 320.83], ['high', 'off_peak', 226.39],
    ])
    expect(tou.charges.find((c) => c.component === 'network_capacity')?.amountExclVat).toBe(1227.18)
    expect(parsed.increasePct).toBe(9.01)
    expect(parsed.issues.filter((i) => i.code === 'rfd_row_increase_mismatch')).toEqual([])
  })
  it('11. golden (2026/27): Residential Single Phase 60A, 800 kWh -> R3,364.18', () => {
    // 500 x 2.8827 + 300 x 3.3082 = 2,433.81; + 235.79 + 694.58
    const u: MonthUsage = { year: 2026, month: 8, days: 31, season: 'high', importKwh: { peak: 0, standard: 800, off_peak: 0 } }
    expect(costMonth(t('Residential Single Phase 60A'), u).totalExclVat).toBe(3364.18)
  })
  it('flags a row whose own arithmetic disagrees with its stated increase', () => {
    const bad = parseRfdText([
      '3. Probe',
      'Block 1 (0-500kWh)                 100,00      9,01%      120,00      120,00      9,01%',
    ].join('\n'), { fileSha256: 'x' })
    expect(bad.issues.map((i) => i.code)).toContain('rfd_row_increase_mismatch')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/rfd-text.test.ts`
Expected: FAIL — `Failed to resolve import "./rfd-text"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/parsers/rfd-text.ts`:
```ts
/**
 * NERSA 2026/27 "Decision and Reasons for Decision" tables, from
 * `pdftotext -layout`. A tariff opens at "N. Name" in column 0. A charge row is
 * a label in column 0 with five columns — approved, proposed %, proposed,
 * RECOMMENDED, recommended % — either on the same line or on the indented line
 * above it. Commentary to the right is ignored. Output is always for review.
 */
import type { TariffSeason, TariffUnit, Tariff } from '../types'
import type { TariffIssue } from '../validators'
import { detectSeason, labelUnit } from './labels'
import { normaliseCharge, type Unresolved } from './normalise'
import { finishDraft, newDraft, type TariffDraft } from './tariff-draft'

export interface ParsedRfd {
  tariffs: Tariff[]
  /** The most common recommended % across rows. */
  increasePct: number | null
  issues: TariffIssue[]
  unresolved: Unresolved[]
}

interface Row {
  approved: number
  recommended: number
  recommendedPct: number
}

const AMOUNT = /^\d{1,3}(?: \d{3})+,\d+$|^\d+,\d+$/
const PCT = /^-?\d+,\d+%$/
const HEADER = /^(\d{1,2})\.\s+(\S.*)$/
const num = (s: string): number => Number(s.replace(/ /g, '').replace('%', '').replace(',', '.'))

function readFive(tokens: string[]): Row | null {
  if (tokens.length < 5) return null
  const [a, p1, b, c] = tokens
  // Commentary can follow the last % after a single space: "9,01% category reflects…".
  const p2 = tokens[4].split(' ')[0]
  if (!AMOUNT.test(a) || !PCT.test(p1) || !AMOUNT.test(b) || !AMOUNT.test(c) || !PCT.test(p2)) return null
  return { approved: num(a), recommended: num(c), recommendedPct: num(p2) }
}

function mode(xs: number[]): number | null {
  if (xs.length === 0) return null
  const counts = new Map<number, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0][0]
}

export function parseRfdText(text: string, opts: { fileSha256: string }): ParsedRfd {
  const out: ParsedRfd = { tariffs: [], increasePct: null, issues: [], unresolved: [] }
  const taken = new Set<string>()
  const pcts: number[] = []
  let cur: TariffDraft | null = null
  let pending: { row: Row; line: number } | null = null
  let energySeason: TariffSeason = 'all'
  let contextUnit: TariffUnit | null = null
  let page = 1

  const close = (): void => {
    if (!cur) return
    const done = finishDraft(cur, taken)
    out.tariffs.push(...done.tariffs)
    out.issues.push(...done.issues)
    cur = null
  }

  text.split('\n').forEach((rawLine, idx) => {
    const lineNo = idx + 1
    page += (rawLine.match(/\f/g) ?? []).length
    const line = rawLine.replace(/\f/g, '')
    if (line.trim() === '' || /^\s*-\s*$/.test(line)) return

    if (/^\s/.test(line)) {
      const row = readFive(line.trim().split(/\s{2,}/))
      if (row) pending = { row, line: lineNo }
      return
    }

    const tokens = line.split(/\s{2,}/)
    const head = HEADER.exec(tokens[0])
    if (head) {
      close()
      cur = newDraft({ name: head[2].trim(), fileSha256: opts.fileSha256, page, line: lineNo })
      pending = null
      energySeason = 'all'
      contextUnit = null
      return
    }

    const label = tokens[0].trim()
    const inline = readFive(tokens.slice(1))
    const values = inline ? { row: inline, line: lineNo } : pending
    if (!values) {
      const s = detectSeason(label)
      if (s) energySeason = s
      contextUnit = labelUnit(label)
      return
    }
    pending = null
    if (!cur) {
      out.issues.push({ code: 'orphan_charge', severity: 'review', message: `"${label}" before any tariff header`, locator: { page, line: lineNo } })
      return
    }
    const rawValue = String(values.row.recommended)
    const res = normaliseCharge({
      label,
      amount: { value: values.row.recommended, unitText: null, randPrefix: false, raw: rawValue },
      rawValue, unitColumn: null, contextUnit, headerUnit: null, componentHint: null,
      seasonState: { energy: energySeason, general: 'all' },
      blockText: null, vatBasis: 'assumed_excl', extractionMethod: 'parser',
      locator: { file_sha256: opts.fileSha256, page, line: values.line, raw_text: `${label} = ${rawValue} (recommended)` },
    })
    if (!res.ok) {
      out.unresolved.push(res.unresolved)
      return
    }
    ;(cur as TariffDraft).charges.push(res.charge)
    out.issues.push(...res.issues)
    pcts.push(values.row.recommendedPct)
    if (values.row.approved > 0) {
      const computed = (values.row.recommended / values.row.approved - 1) * 100
      if (Math.abs(computed - values.row.recommendedPct) > 0.05) {
        out.issues.push({
          code: 'rfd_row_increase_mismatch', severity: 'review',
          message: `"${label}": ${values.row.approved} -> ${values.row.recommended} is ${computed.toFixed(2)}%, the row says ${values.row.recommendedPct}%`,
          locator: res.charge.sourceLocator,
        })
      }
    }
  })
  close()
  out.increasePct = mode(pcts.filter((p) => p !== 0))
  return out
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/rfd-text.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/parsers/rfd-text.ts packages/shared/src/tariffs/parsers/rfd-text.test.ts
git commit -m "feat(tariffs): NERSA 2026/27 RfD text parser (recommended column, draft rows); golden 2026/27 bill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Workbook loading, barrel, sub-path export and the gated real-file sweep

**Files:**
- Create: `packages/shared/src/tariffs/parsers/xlsx-load.ts`, `packages/shared/src/tariffs/parsers/index.ts`
- Modify: `packages/shared/package.json` (`exports`)
- Test: `packages/shared/src/tariffs/parsers/xlsx-load.test.ts`, `packages/shared/src/tariffs/parsers/real-files.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/tariffs/parsers/xlsx-load.test.ts`:
```ts
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseProvinceWorkbook } from './province-xlsx'
import { loadWorkbookGrids } from './xlsx-load'
import lephalaleFx from '../__fixtures__/lp-lephalale.cells.json'
import type { CellFixture } from './grid'

describe('loadWorkbookGrids', () => {
  it('round-trips a real excerpt through exceljs, rich text included', async () => {
    const fx = lephalaleFx as CellFixture
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(fx.source.sheet)
    for (const [addr, v] of Object.entries(fx.cells)) ws.getCell(addr).value = v
    ws.getCell('D1').value = { richText: [{ text: 'rich' }, { text: ' text' }] }
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const [grid] = await loadWorkbookGrids(bytes)
    expect(grid.sheet).toBe('LEPHALALE')
    expect(grid.get(3, 2)).toBe('R1,6464/kWh')
    expect(grid.get(1, 4)).toBe('rich text')
    const [sheet] = parseProvinceWorkbook([grid], { fileSha256: 'x' })
    expect(sheet.tariffs[0].name).toBe('Domestic Prepaid & Conventional')
  })
})
```

`packages/shared/src/tariffs/parsers/real-files.test.ts`:
```ts
/**
 * Whole-book sweep over the real sources. Skipped unless TARIFF_SOURCE_DIR is
 * set (CI never has the drive); run it by hand on the ingestion Mac:
 *   TARIFF_SOURCE_DIR="…/005. NERSA TARIFFS" pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/real-files.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateTariff } from '../validators'
import { parseEskomWorkbook } from './eskom-xlsm'
import { parseProvinceWorkbook } from './province-xlsx'
import { loadWorkbookGrids } from './xlsx-load'

const DIR = process.env.TARIFF_SOURCE_DIR
const PROVINCES = [
  'Eastern-Cape-Province', 'Free-State-Province', 'Gauteng-Province', 'Kwa-Zulu-Natal-Province', 'Limpopo-Province',
  'Mpumalanga-Province', 'North-West-Province', 'Northern-Cape-Province', 'Western-Cape-Province1',
]

describe.skipIf(!DIR)('real source books', () => {
  it('parses all 177 province sheets with no 100x energy errors left unflagged', async () => {
    let sheets = 0
    let charges = 0
    for (const p of PROVINCES) {
      const grids = await loadWorkbookGrids(readFileSync(join(DIR as string, '2025', `${p}.xlsx`)))
      const parsed = parseProvinceWorkbook(grids, { fileSha256: p })
      sheets += parsed.length
      for (const s of parsed) {
        for (const t of s.tariffs) {
          for (const c of t.charges) {
            charges++
            // An energy value under 20 left in c/kWh is exactly the old seed's 628-row defect.
            if (c.component === 'energy' && c.unit === 'c_per_kWh' && c.amountExclVat > 0) expect(c.amountExclVat, `${s.sheet} / ${t.name}`).toBeGreaterThanOrEqual(20)
          }
        }
      }
    }
    expect(sheets).toBe(177)
    console.log(`province sweep: ${sheets} sheets, ${charges} charges`)
    expect(charges).toBeGreaterThan(5000)
  }, 120_000)

  it.each([
    ['2025/26', 'ESKOM/Eskom-tariffs-1-April-2025-ver-2.xlsm'],
    ['2026/27', '2026-27/ESKOM/Eskom-tariffs-1-April-2026-Public.xlsm'],
  ])('parses the Eskom %s workbook: Homeflex, Gen-offset, loss factors, no VAT-pair failures', async (_fy, file) => {
    const parsed = parseEskomWorkbook(await loadWorkbookGrids(readFileSync(join(DIR as string, file))), { fileSha256: file })
    const hf1 = parsed.tariffs.find((t) => t.code === 'HF101N')
    expect(hf1?.charges.filter((c) => c.component === 'energy')).toHaveLength(6)
    expect(hf1?.exportTariffCode).toBe('GOHF101N')
    expect(parsed.lossFactors.filter((f) => f.kind === 'tx')).toHaveLength(4)
    const vat = parsed.tariffs.flatMap((t) => validateTariff(t)).filter((i) => i.code === 'vat_pair')
    expect(vat).toEqual([])
  }, 120_000)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/xlsx-load.test.ts src/tariffs/parsers/real-files.test.ts`
Expected: FAIL — `Failed to resolve import "./xlsx-load"` (the real-files suite is skipped without `TARIFF_SOURCE_DIR`).

- [ ] **Step 3: Implement loading, the barrel and the sub-path export**

`packages/shared/src/tariffs/parsers/xlsx-load.ts`:
```ts
import ExcelJS from 'exceljs'
import { gridFromWorksheet, type Grid, type WorksheetLike } from './grid'

/** Workbook bytes (.xlsx or .xlsm) → one Grid per sheet, formulas as cached results. */
export async function loadWorkbookGrids(bytes: Uint8Array | ArrayBuffer): Promise<Grid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  return wb.worksheets.map((ws) => gridFromWorksheet(ws as unknown as WorksheetLike))
}
```

`packages/shared/src/tariffs/parsers/index.ts`:
```ts
// Tariff source parsers. Imported by path (scripts, 2b server code) and via
// the "@esite/shared/tariffs/parsers" sub-path — deliberately NOT re-exported
// from the package root, so client bundles never pull the workbook reader.
export * from './grid'
export * from './amount'
export * from './blocks'
export * from './labels'
export * from './normalise'
export * from './tariff-draft'
export * from './province-xlsx'
export * from './eskom-xlsm'
export * from './rfd-text'
export * from './xlsx-load'
```

In `packages/shared/package.json`, extend `exports` (keep the existing entries):
```json
  "exports": {
    ".": "./src/index.ts",
    "./placeholder-fill": "./src/lib/jbcc/placeholder-fill.ts",
    "./docx-letterhead": "./src/lib/jbcc/docx-letterhead.ts",
    "./docx-preview": "./src/lib/jbcc/docx-html.ts",
    "./tariffs/parsers": "./src/tariffs/parsers/index.ts",
    "./tariffs/ingest": "./src/tariffs/ingest/index.ts"
  },
```
(`./src/tariffs/ingest/index.ts` is created in Task 9; type-check runs after it.)

- [ ] **Step 4: Run to verify pass, then the real-file sweep by hand**

```bash
pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/xlsx-load.test.ts
TARIFF_SOURCE_DIR="$TARIFF_SOURCE_DIR" pnpm --filter @esite/shared exec vitest run src/tariffs/parsers/real-files.test.ts
```
Expected: the first PASS; the sweep PASS with `province sweep: 177 sheets, N charges` printed. A sheet named in a failure is a parser gap: add its cells as a fixture (Task 1's spec list), write the failing assertion in `golden.province.test.ts`, then fix the rule — never loosen the sweep.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/parsers/xlsx-load.ts packages/shared/src/tariffs/parsers/index.ts packages/shared/src/tariffs/parsers/xlsx-load.test.ts packages/shared/src/tariffs/parsers/real-files.test.ts packages/shared/package.json
git commit -m "feat(tariffs): workbook loader, parser barrel and sub-path export; gated real-book sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Ingestion core with an in-memory store

**Files:**
- Create: `packages/shared/src/tariffs/ingest/ingest-core.ts`, `packages/shared/src/tariffs/ingest/memory-store.ts`, `packages/shared/src/tariffs/ingest/index.ts`
- Test: `packages/shared/src/tariffs/ingest/ingest-core.test.ts`

Flow: sha256 already ingested successfully → `already_ingested`, nothing written. Otherwise resolve each licensee by alias, validate, diff against the published predecessor year, and decide an action per year (`create`, `replace_draft`, `skip_published`, `skip_unknown_licensee`). **Dry run stops there.** Apply uploads the file to `tariff-sources/<fy>/<sha256>.<ext>`, records the document and an `ingest_run`, writes each year in `ingesting`, then flips it to `in_review`. A failure marks the run `failed`; a retry reuses the document.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/ingest/ingest-core.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff, type Tariff } from '../types'
import { normaliseAlias, runIngest, type IngestPlan, type LicenseeYearDraft } from './ingest-core'
import { createMemoryTariffStore } from './memory-store'

const SHA = 'a'.repeat(64)
const cp = (block1: number): Tariff => makeTariff({ name: 'Residential Single Phase 60A', structure: 'ibt', charges: [
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: block1, blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly', extractionMethod: 'parser' }),
] })
const draft = (over: Partial<LicenseeYearDraft> = {}): LicenseeYearDraft => ({
  licenseeName: 'City Power', aliases: ['CITY POWER', 'City Power'], kind: 'municipal',
  effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30', approvedIncreasePct: 9.01,
  tariffs: [cp(247.76)], lossFactors: [], ssegRule: null, issues: [], unresolved: [], ...over,
})
const plan = (years: LicenseeYearDraft[], sha = SHA): IngestPlan => ({
  parser: 'rfd_pdf',
  source: {
    fileName: 'city-power.pdf', bytes: new Uint8Array([37, 80, 68, 70]), sha256: sha, contentType: 'application/pdf',
    kind: 'nersa_decision', title: 'City Power RfD 2026/27', financialYear: '2026/27', status: 'nersa_approved',
    url: null, retrievedAt: null, pageCount: 41,
  },
  years,
})

describe('normaliseAlias', () => {
  it('matches the database CHECK (upper, trimmed, single spaces)', () => {
    expect(normaliseAlias('CITY OF CAPE ')).toBe('CITY OF CAPE')
    expect(normaliseAlias(' Modale  City')).toBe('MODALE CITY')
  })
})

describe('runIngest', () => {
  it('dry run (default) writes nothing and skips an unknown licensee', async () => {
    const store = createMemoryTariffStore()
    const r = await runIngest(plan([draft()]), store, { apply: false, createMissingLicensees: false })
    expect(r.status).toBe('dry_run')
    expect(r.years[0].action).toBe('skip_unknown_licensee')
    expect(store.state.writes).toEqual([])
  })

  it('applies: uploads by sha, records the run, writes the year in review', async () => {
    const store = createMemoryTariffStore()
    const r = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    expect(r.status).toBe('applied')
    expect(r.storagePath).toBe(`2026-27/${SHA}.pdf`)
    expect([...store.state.uploads.keys()]).toEqual([`2026-27/${SHA}.pdf`])
    const year = [...store.state.years.values()][0]
    expect(year).toMatchObject({ financialYear: '2026/27', state: 'in_review' })
    expect([...store.state.aliases.keys()].sort()).toEqual(['CITY POWER'])
    expect([...store.state.runs.values()][0]).toMatchObject({ status: 'succeeded' })
    expect(r.years[0]).toMatchObject({ action: 'create', tariffs: 1, charges: 1 })
  })

  it('is idempotent on sha256', async () => {
    const store = createMemoryTariffStore()
    await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    const before = store.state.writes.length
    const again = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    expect(again.status).toBe('already_ingested')
    expect(store.state.writes.length).toBe(before)
  })

  it('replaces an in-review draft and never touches a published year', async () => {
    const store = createMemoryTariffStore({
      licensees: [{ name: 'City Power', kind: 'municipal', aliases: ['CITY POWER'] }],
      years: [
        { licensee: 'City Power', financialYear: '2026/27', state: 'in_review', tariffs: [cp(1)] },
        { licensee: 'City Power', financialYear: '2025/26', state: 'published', tariffs: [cp(227.28)] },
      ],
    })
    const r = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: false })
    expect(r.years[0].action).toBe('replace_draft')
    const draftYear = [...store.state.years.values()].find((y) => y.financialYear === '2026/27')!
    expect(store.state.tariffsByYear.get(draftYear.id)?.[0].charges[0].amountExclVat).toBe(247.76)
    expect(draftYear.state).toBe('in_review')
    // YoY against the published 2025/26: 227.28 -> 247.76 is 9.011%, inside the band.
    expect(r.years[0].yoy).toMatchObject({ changed: 1, outOfBand: 0 })

    const store2 = createMemoryTariffStore({
      licensees: [{ name: 'City Power', kind: 'municipal', aliases: ['CITY POWER'] }],
      years: [{ licensee: 'City Power', financialYear: '2026/27', state: 'published', tariffs: [cp(1)] }],
    })
    const r2 = await runIngest(plan([draft()], 'b'.repeat(64)), store2, { apply: true, createMissingLicensees: false })
    expect(r2.years[0].action).toBe('skip_published')
    expect(store2.state.writes.filter((w) => w.startsWith('year:') || w.startsWith('tariffs:'))).toEqual([])
  })

  it('marks the run failed on error and lets a retry reuse the document', async () => {
    const store = createMemoryTariffStore(undefined, { failOnce: 'insertTariffs' })
    await expect(runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })).rejects.toThrow(/insertTariffs/)
    expect([...store.state.runs.values()][0]).toMatchObject({ status: 'failed' })
    const retry = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    expect(retry.status).toBe('applied')
    expect(store.state.uploads.size).toBe(1)
    expect(store.state.docs.size).toBe(1)
  })

  it('links an import tariff to its export tariff by code', async () => {
    const store = createMemoryTariffStore()
    const hf = makeTariff({ name: 'Homeflex 1 (HF101N)', code: 'HF101N', structure: 'tou', exportTariffCode: 'GOHF101N', charges: cp(706.97).charges })
    const go = makeTariff({ name: 'Gen-Offset Homeflex (GOHF101N)', code: 'GOHF101N', structure: 'tou', category: 'sseg', charges: cp(185.41).charges })
    await runIngest(plan([draft({ licenseeName: 'Eskom', aliases: ['ESKOM'], kind: 'eskom', tariffs: [hf, go] })]), store, { apply: true, createMissingLicensees: true })
    expect(store.state.links).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/ingest-core.test.ts`
Expected: FAIL — `Failed to resolve import "./ingest-core"`.

- [ ] **Step 3: Implement the core**

`packages/shared/src/tariffs/ingest/ingest-core.ts`:
```ts
/**
 * Ingestion (D-03): E-Site staff run it; it never publishes. Idempotent on the
 * file's sha256. Dry run is the default and writes nothing. Pure: the caller
 * supplies bytes, sha256 and a TariffStore.
 */
import { previousFinancialYear } from '../financial-year'
import { validateTariffYear, type TariffIssue } from '../validators'
import { diffTariffYears } from '../yoy'
import type {
  LicenseeKind, LossFactor, SourceDocumentKind, SourceDocumentStatus, SsegRule, Tariff, YearState,
} from '../types'
import type { Unresolved } from '../parsers/normalise'

export type ParserName = 'province_xlsx' | 'eskom_xlsm' | 'rfd_pdf'

export interface IngestSource {
  fileName: string
  bytes: Uint8Array
  sha256: string
  contentType: string
  kind: SourceDocumentKind
  title: string
  financialYear: string
  status: SourceDocumentStatus
  url: string | null
  retrievedAt: string | null
  pageCount: number | null
}

export interface LicenseeYearDraft {
  licenseeName: string
  aliases: string[]
  kind: LicenseeKind
  effectiveFrom: string
  effectiveTo: string
  approvedIncreasePct: number | null
  tariffs: Tariff[]
  lossFactors: LossFactor[]
  ssegRule: SsegRule | null
  issues: TariffIssue[]
  unresolved: Unresolved[]
}

export interface IngestPlan {
  parser: ParserName
  source: IngestSource
  years: LicenseeYearDraft[]
}

export interface StoredYear {
  id: string
  state: YearState
}

export interface YearMeta {
  licenseeId: string
  financialYear: string
  effectiveFrom: string
  effectiveTo: string
  approvedIncreasePct: number | null
  sourceDocumentId: string
}

export interface SourceDocumentRow {
  kind: SourceDocumentKind
  title: string
  financialYear: string
  status: SourceDocumentStatus
  storagePath: string
  sha256: string
  pageCount: number | null
  url: string | null
  retrievedAt: string | null
}

export interface TariffStore {
  findSourceDocumentBySha(sha256: string): Promise<{ id: string; hasSucceededRun: boolean } | null>
  findLicenseeIdByAlias(alias: string): Promise<string | null>
  createLicensee(input: { name: string; kind: LicenseeKind; aliases: string[] }): Promise<string>
  findYear(licenseeId: string, financialYear: string): Promise<StoredYear | null>
  loadYearTariffs(yearId: string): Promise<Tariff[]>
  uploadSource(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  insertSourceDocument(row: SourceDocumentRow): Promise<string>
  insertIngestRun(row: { sourceDocumentId: string; parser: ParserName; startedBy: string | null }): Promise<string>
  finishIngestRun(id: string, patch: { status: 'succeeded' | 'failed'; stats: unknown; diff: unknown; error: string | null }): Promise<void>
  insertYear(meta: YearMeta): Promise<string>
  updateYear(yearId: string, meta: YearMeta): Promise<void>
  setYearState(yearId: string, state: 'ingesting' | 'in_review'): Promise<void>
  deleteYearChildren(yearId: string): Promise<void>
  /** Inserts tariffs and their charges; returns tariff name → id. */
  insertTariffs(yearId: string, sourceDocumentId: string, tariffs: Tariff[]): Promise<Map<string, string>>
  linkExportTariffs(links: { tariffId: string; exportTariffId: string }[]): Promise<void>
  insertLossFactors(yearId: string, factors: LossFactor[]): Promise<void>
  insertSsegRule(yearId: string, rule: SsegRule): Promise<void>
}

export type YearAction = 'create' | 'replace_draft' | 'skip_published' | 'skip_unknown_licensee'

export interface YearReport {
  licensee: string
  financialYear: string
  action: YearAction
  licenseeId: string | null
  yearId: string | null
  tariffs: number
  charges: number
  blocking: number
  review: number
  unresolved: number
  yoy: { added: number; removed: number; changed: number; outOfBand: number } | null
  issues: TariffIssue[]
}

export interface IngestReport {
  status: 'dry_run' | 'applied' | 'already_ingested'
  sha256: string
  sourceDocumentId: string | null
  runId: string | null
  storagePath: string
  years: YearReport[]
}

/** Same rule as the licensee_alias_normalised CHECK. */
export function normaliseAlias(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase()
}

export function storagePathFor(source: Pick<IngestSource, 'financialYear' | 'sha256' | 'fileName'>): string {
  const dot = source.fileName.lastIndexOf('.')
  const ext = dot >= 0 ? source.fileName.slice(dot).toLowerCase() : ''
  return `${source.financialYear.replace('/', '-')}/${source.sha256}${ext}`
}

function summarise(reports: YearReport[]): Record<string, unknown> {
  return {
    years: reports.length,
    byAction: reports.reduce<Record<string, number>>((a, r) => ({ ...a, [r.action]: (a[r.action] ?? 0) + 1 }), {}),
    tariffs: reports.reduce((a, r) => a + r.tariffs, 0),
    charges: reports.reduce((a, r) => a + r.charges, 0),
    blocking: reports.reduce((a, r) => a + r.blocking, 0),
    review: reports.reduce((a, r) => a + r.review, 0),
    unresolved: reports.reduce((a, r) => a + r.unresolved, 0),
    issues: reports.flatMap((r) => r.issues.map((i) => ({ licensee: r.licensee, ...i }))),
  }
}

export async function runIngest(
  plan: IngestPlan, store: TariffStore,
  opts: { apply: boolean; createMissingLicensees: boolean; startedBy?: string | null },
): Promise<IngestReport> {
  const { source } = plan
  const storagePath = storagePathFor(source)
  const existing = await store.findSourceDocumentBySha(source.sha256)
  if (existing?.hasSucceededRun) {
    return { status: 'already_ingested', sha256: source.sha256, sourceDocumentId: existing.id, runId: null, storagePath, years: [] }
  }

  const prepared: { draft: LicenseeYearDraft; report: YearReport; existingYear: StoredYear | null }[] = []
  for (const draft of plan.years) {
    let licenseeId: string | null = null
    for (const alias of draft.aliases) {
      licenseeId = await store.findLicenseeIdByAlias(normaliseAlias(alias))
      if (licenseeId) break
    }
    const issues = [...draft.issues, ...validateTariffYear(draft.tariffs)]
    let yoy: YearReport['yoy'] = null
    let existingYear: StoredYear | null = null
    if (licenseeId) {
      const prev = await store.findYear(licenseeId, previousFinancialYear(source.financialYear))
      if (prev && (prev.state === 'published' || prev.state === 'superseded')) {
        const d = diffTariffYears(await store.loadYearTariffs(prev.id), draft.tariffs, draft.approvedIncreasePct)
        issues.push(...d.issues)
        yoy = { added: d.added.length, removed: d.removed.length, changed: d.changed.length, outOfBand: d.issues.filter((i) => i.code === 'yoy_out_of_band').length }
      }
      existingYear = await store.findYear(licenseeId, source.financialYear)
    }
    const action: YearAction = !licenseeId && !opts.createMissingLicensees
      ? 'skip_unknown_licensee'
      : existingYear && (existingYear.state === 'published' || existingYear.state === 'superseded')
        ? 'skip_published'
        : existingYear ? 'replace_draft' : 'create'
    prepared.push({
      draft, existingYear,
      report: {
        licensee: draft.licenseeName, financialYear: source.financialYear, action, licenseeId, yearId: existingYear?.id ?? null,
        tariffs: draft.tariffs.length, charges: draft.tariffs.reduce((a, t) => a + t.charges.length, 0),
        blocking: issues.filter((i) => i.severity === 'block').length,
        review: issues.filter((i) => i.severity === 'review').length,
        unresolved: draft.unresolved.length, yoy, issues,
      },
    })
  }
  const years = prepared.map((p) => p.report)
  if (!opts.apply) {
    return { status: 'dry_run', sha256: source.sha256, sourceDocumentId: existing?.id ?? null, runId: null, storagePath, years }
  }

  let sourceDocumentId = existing?.id ?? null
  if (!sourceDocumentId) {
    await store.uploadSource(storagePath, source.bytes, source.contentType)
    sourceDocumentId = await store.insertSourceDocument({
      kind: source.kind, title: source.title, financialYear: source.financialYear, status: source.status,
      storagePath, sha256: source.sha256, pageCount: source.pageCount, url: source.url, retrievedAt: source.retrievedAt,
    })
  }
  const runId = await store.insertIngestRun({ sourceDocumentId, parser: plan.parser, startedBy: opts.startedBy ?? null })
  try {
    for (const { draft, report, existingYear } of prepared) {
      if (report.action === 'skip_published' || report.action === 'skip_unknown_licensee') continue
      const licenseeId = report.licenseeId ?? await store.createLicensee({
        name: draft.licenseeName, kind: draft.kind,
        aliases: [...new Set(draft.aliases.map(normaliseAlias).filter((a) => a !== ''))],
      })
      report.licenseeId = licenseeId
      const meta: YearMeta = {
        licenseeId, financialYear: source.financialYear, effectiveFrom: draft.effectiveFrom, effectiveTo: draft.effectiveTo,
        approvedIncreasePct: draft.approvedIncreasePct, sourceDocumentId,
      }
      let yearId: string
      if (existingYear) {
        yearId = existingYear.id
        if (existingYear.state === 'in_review') await store.setYearState(yearId, 'ingesting')
        await store.updateYear(yearId, meta)
        await store.deleteYearChildren(yearId)
      } else {
        yearId = await store.insertYear(meta)
      }
      const ids = await store.insertTariffs(yearId, sourceDocumentId, draft.tariffs)
      const links = draft.tariffs.flatMap((t) => {
        if (!t.exportTariffCode) return []
        const target = draft.tariffs.find((x) => x.code === t.exportTariffCode)
        const a = ids.get(t.name)
        const b = target ? ids.get(target.name) : undefined
        return a && b ? [{ tariffId: a, exportTariffId: b }] : []
      })
      if (links.length > 0) await store.linkExportTariffs(links)
      if (draft.lossFactors.length > 0) await store.insertLossFactors(yearId, draft.lossFactors)
      if (draft.ssegRule) await store.insertSsegRule(yearId, draft.ssegRule)
      await store.setYearState(yearId, 'in_review')
      report.yearId = yearId
    }
    await store.finishIngestRun(runId, {
      status: 'succeeded', stats: summarise(years),
      diff: years.map((r) => ({ licensee: r.licensee, action: r.action, yoy: r.yoy })), error: null,
    })
  } catch (e) {
    await store.finishIngestRun(runId, { status: 'failed', stats: summarise(years), diff: {}, error: e instanceof Error ? e.message : String(e) })
    throw e
  }
  return { status: 'applied', sha256: source.sha256, sourceDocumentId, runId, storagePath, years }
}
```

- [ ] **Step 4: Implement the in-memory store**

`packages/shared/src/tariffs/ingest/memory-store.ts`:
```ts
import type { LicenseeKind, LossFactor, SsegRule, Tariff, YearState } from '../types'
import { normaliseAlias, type ParserName, type SourceDocumentRow, type TariffStore, type YearMeta } from './ingest-core'

export interface MemoryState {
  docs: Map<string, SourceDocumentRow & { id: string }>
  runs: Map<string, { id: string; sourceDocumentId: string; parser: ParserName; status: string; error: string | null }>
  licensees: Map<string, { id: string; name: string; kind: LicenseeKind }>
  aliases: Map<string, string>
  years: Map<string, YearMeta & { id: string; state: YearState }>
  tariffsByYear: Map<string, (Tariff & { id: string })[]>
  links: { tariffId: string; exportTariffId: string }[]
  lossFactors: { yearId: string; factor: LossFactor }[]
  ssegRules: { yearId: string; rule: SsegRule }[]
  uploads: Map<string, number>
  /** Every mutating call, in order: "<kind>:<id>". Empty after a dry run. */
  writes: string[]
}

export interface MemorySeed {
  licensees?: { name: string; kind: LicenseeKind; aliases: string[] }[]
  years?: { licensee: string; financialYear: string; state: YearState; tariffs: Tariff[] }[]
}

export function createMemoryTariffStore(seed?: MemorySeed, opts: { failOnce?: keyof TariffStore } = {}): TariffStore & { state: MemoryState } {
  let n = 0
  const id = (p: string): string => `${p}-${++n}`
  let failPending = opts.failOnce
  const state: MemoryState = {
    docs: new Map(), runs: new Map(), licensees: new Map(), aliases: new Map(), years: new Map(),
    tariffsByYear: new Map(), links: [], lossFactors: [], ssegRules: [], uploads: new Map(), writes: [],
  }
  const maybeFail = (name: keyof TariffStore): void => {
    if (failPending === name) {
      failPending = undefined
      throw new Error(`memory store: injected failure in ${name}`)
    }
  }
  const byName = new Map<string, string>()
  for (const l of seed?.licensees ?? []) {
    const lid = id('lic')
    state.licensees.set(lid, { id: lid, name: l.name, kind: l.kind })
    byName.set(l.name, lid)
    for (const a of l.aliases) state.aliases.set(normaliseAlias(a), lid)
  }
  for (const y of seed?.years ?? []) {
    const yid = id('year')
    state.years.set(yid, {
      id: yid, licenseeId: byName.get(y.licensee) as string, financialYear: y.financialYear, state: y.state,
      effectiveFrom: '2000-01-01', effectiveTo: '2000-12-31', approvedIncreasePct: null, sourceDocumentId: 'seed',
    })
    state.tariffsByYear.set(yid, y.tariffs.map((t) => ({ ...t, id: id('tariff') })))
  }

  return {
    state,
    async findSourceDocumentBySha(sha256) {
      const doc = [...state.docs.values()].find((d) => d.sha256 === sha256)
      if (!doc) return null
      return { id: doc.id, hasSucceededRun: [...state.runs.values()].some((r) => r.sourceDocumentId === doc.id && r.status === 'succeeded') }
    },
    async findLicenseeIdByAlias(alias) {
      return state.aliases.get(alias) ?? null
    },
    async createLicensee({ name, kind, aliases }) {
      maybeFail('createLicensee')
      const lid = id('lic')
      state.licensees.set(lid, { id: lid, name, kind })
      for (const a of aliases) if (!state.aliases.has(a)) state.aliases.set(a, lid)
      state.writes.push(`licensee:${lid}`)
      return lid
    },
    async findYear(licenseeId, financialYear) {
      const y = [...state.years.values()].find((x) => x.licenseeId === licenseeId && x.financialYear === financialYear)
      return y ? { id: y.id, state: y.state } : null
    },
    async loadYearTariffs(yearId) {
      return state.tariffsByYear.get(yearId) ?? []
    },
    async uploadSource(path, bytes) {
      maybeFail('uploadSource')
      if (!state.uploads.has(path)) state.uploads.set(path, bytes.byteLength)
      state.writes.push(`upload:${path}`)
    },
    async insertSourceDocument(row) {
      maybeFail('insertSourceDocument')
      const did = id('doc')
      state.docs.set(did, { ...row, id: did })
      state.writes.push(`doc:${did}`)
      return did
    },
    async insertIngestRun({ sourceDocumentId, parser }) {
      const rid = id('run')
      state.runs.set(rid, { id: rid, sourceDocumentId, parser, status: 'running', error: null })
      state.writes.push(`run:${rid}`)
      return rid
    },
    async finishIngestRun(rid, patch) {
      const run = state.runs.get(rid)
      if (run) Object.assign(run, { status: patch.status, error: patch.error })
      state.writes.push(`run-finish:${rid}`)
    },
    async insertYear(meta) {
      maybeFail('insertYear')
      const yid = id('year')
      state.years.set(yid, { ...meta, id: yid, state: 'ingesting' })
      state.writes.push(`year:${yid}`)
      return yid
    },
    async updateYear(yearId, meta) {
      const y = state.years.get(yearId)
      if (y) Object.assign(y, meta)
      state.writes.push(`year:${yearId}`)
    },
    async setYearState(yearId, s) {
      const y = state.years.get(yearId)
      if (y) y.state = s
      state.writes.push(`year-state:${yearId}:${s}`)
    },
    async deleteYearChildren(yearId) {
      state.tariffsByYear.set(yearId, [])
      state.lossFactors = state.lossFactors.filter((f) => f.yearId !== yearId)
      state.ssegRules = state.ssegRules.filter((r) => r.yearId !== yearId)
      state.writes.push(`tariffs-delete:${yearId}`)
    },
    async insertTariffs(yearId, _doc, tariffs) {
      maybeFail('insertTariffs')
      const ids = new Map<string, string>()
      const rows = tariffs.map((t) => {
        const tid = id('tariff')
        ids.set(t.name, tid)
        return { ...t, id: tid }
      })
      state.tariffsByYear.set(yearId, [...(state.tariffsByYear.get(yearId) ?? []), ...rows])
      state.writes.push(`tariffs:${yearId}`)
      return ids
    },
    async linkExportTariffs(links) {
      state.links.push(...links)
      state.writes.push(`links:${links.length}`)
    },
    async insertLossFactors(yearId, factors) {
      state.lossFactors.push(...factors.map((factor) => ({ yearId, factor })))
      state.writes.push(`loss-factors:${yearId}`)
    },
    async insertSsegRule(yearId, rule) {
      state.ssegRules.push({ yearId, rule })
      state.writes.push(`sseg-rule:${yearId}`)
    },
  }
}
```

`packages/shared/src/tariffs/ingest/index.ts`:
```ts
export * from './ingest-core'
export * from './build-plan'
export * from './memory-store'
export * from './supabase-store'
```
(`build-plan` and `supabase-store` arrive in Tasks 10–11; create this file now and leave those two lines commented out until then, uncommenting each in its own task.)

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/ingest-core.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tariffs/ingest
git commit -m "feat(tariffs): ingestion core — sha256 idempotency, dry run by default, in_review years, YoY against the published predecessor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Building a plan from a source file

**Files:**
- Create: `packages/shared/src/tariffs/ingest/build-plan.ts`
- Modify: `packages/shared/src/tariffs/ingest/index.ts` (uncomment `./build-plan`)
- Test: `packages/shared/src/tariffs/ingest/build-plan.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/ingest/build-plan.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { CellFixture } from '../parsers/grid'
import { buildIngestPlan } from './build-plan'
import lephalaleFx from '../__fixtures__/lp-lephalale.cells.json'
import hf25 from '../__fixtures__/eskom-2025-homeflex.cells.json'
import go25 from '../__fixtures__/eskom-2025-gen-offset.cells.json'
import lf25 from '../__fixtures__/eskom-2025-loss-factors.cells.json'

async function workbook(...fixtures: unknown[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  for (const f of fixtures as CellFixture[]) {
    const ws = wb.addWorksheet(f.source.sheet)
    for (const [addr, v] of Object.entries(f.cells)) ws.getCell(addr).value = v
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
const SHA = 'c'.repeat(64)

describe('buildIngestPlan', () => {
  it('province compendium: one municipal year per sheet, July-June', async () => {
    const plan = await buildIngestPlan({ parser: 'province_xlsx', fileName: 'Limpopo-Province.xlsx', bytes: await workbook(lephalaleFx), sha256: SHA, financialYear: '2025/26' })
    expect(plan.source).toMatchObject({ kind: 'tariff_book', status: 'nersa_approved', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    expect(plan.years).toHaveLength(1)
    expect(plan.years[0]).toMatchObject({ licenseeName: 'LEPHALALE', kind: 'municipal', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30', approvedIncreasePct: 10.39 })
    expect(plan.years[0].aliases).toContain('LEPHALALE')
  })
  it('Eskom workbook: one Eskom year, April-March, loss factors and the Net-Billing rule', async () => {
    const plan = await buildIngestPlan({ parser: 'eskom_xlsm', fileName: 'Eskom-tariffs-1-April-2025-ver-2.xlsm', bytes: await workbook(hf25, go25, lf25), sha256: SHA, financialYear: '2025/26' })
    const y = plan.years[0]
    expect(y).toMatchObject({ licenseeName: 'Eskom', kind: 'eskom', effectiveFrom: '2025-04-01', effectiveTo: '2026-03-31' })
    expect(y.lossFactors).toHaveLength(10)
    expect(y.ssegRule).toMatchObject({ crediting: 'net_billing_tou', fyEndMonth: 3 })
    expect(y.tariffs.find((t) => t.code === 'HF101N')?.exportTariffCode).toBe('GOHF101N')
  })
  it('RfD PDF text: needs the licensee name, counts pages', async () => {
    const text = readFileSync(new URL('../__fixtures__/city-power-rfd-2026-27.excerpt.txt', import.meta.url), 'utf8')
    await expect(buildIngestPlan({ parser: 'rfd_pdf', fileName: 'x.pdf', bytes: new Uint8Array(), sha256: SHA, financialYear: '2026/27', pdfText: text })).rejects.toThrow(/licensee/)
    const plan = await buildIngestPlan({ parser: 'rfd_pdf', fileName: 'x.pdf', bytes: new Uint8Array(), sha256: SHA, financialYear: '2026/27', pdfText: text, licenseeName: 'CITY POWER' })
    expect(plan.source).toMatchObject({ kind: 'nersa_decision', contentType: 'application/pdf' })
    expect(plan.years[0]).toMatchObject({ licenseeName: 'CITY POWER', approvedIncreasePct: 9.01, effectiveFrom: '2026-07-01' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/build-plan.test.ts`
Expected: FAIL — `Failed to resolve import "./build-plan"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/ingest/build-plan.ts`:
```ts
import { effectiveDates } from '../financial-year'
import { netBillingRule } from '../net-billing-rules'
import { parseEskomWorkbook } from '../parsers/eskom-xlsm'
import { parseProvinceWorkbook } from '../parsers/province-xlsx'
import { parseRfdText } from '../parsers/rfd-text'
import { loadWorkbookGrids } from '../parsers/xlsx-load'
import type { IngestPlan, ParserName } from './ingest-core'

export interface BuildPlanInput {
  parser: ParserName
  fileName: string
  bytes: Uint8Array
  sha256: string
  financialYear: string
  /** pdftotext -layout output; required for rfd_pdf. */
  pdfText?: string
  /** Required for rfd_pdf: one RfD is one licensee (from manifest.csv). */
  licenseeName?: string
  url?: string | null
  retrievedAt?: string | null
}

const CONTENT_TYPES: Record<ParserName, string> = {
  province_xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  eskom_xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  rfd_pdf: 'application/pdf',
}

export async function buildIngestPlan(input: BuildPlanInput): Promise<IngestPlan> {
  const common = {
    fileName: input.fileName, bytes: input.bytes, sha256: input.sha256, contentType: CONTENT_TYPES[input.parser],
    financialYear: input.financialYear, status: 'nersa_approved' as const,
    url: input.url ?? null, retrievedAt: input.retrievedAt ?? null,
  }

  if (input.parser === 'province_xlsx') {
    const sheets = parseProvinceWorkbook(await loadWorkbookGrids(input.bytes), { fileSha256: input.sha256 })
    const dates = effectiveDates('municipal', input.financialYear)
    return {
      parser: input.parser,
      source: { ...common, kind: 'tariff_book', title: `NERSA municipal tariff compendium: ${input.fileName}`, pageCount: null },
      years: sheets.map((s) => ({
        licenseeName: s.titleName, aliases: [s.sheet, s.titleName], kind: 'municipal',
        effectiveFrom: dates.from, effectiveTo: dates.to, approvedIncreasePct: s.increasePct,
        tariffs: s.tariffs, lossFactors: [], ssegRule: null, issues: s.issues, unresolved: s.unresolved,
      })),
    }
  }

  if (input.parser === 'eskom_xlsm') {
    const parsed = parseEskomWorkbook(await loadWorkbookGrids(input.bytes), { fileSha256: input.sha256 })
    const dates = effectiveDates('eskom', input.financialYear)
    return {
      parser: input.parser,
      source: { ...common, kind: 'eskom_schedule', title: `Eskom tariffs ${input.financialYear}: ${input.fileName}`, pageCount: null },
      years: [{
        licenseeName: 'Eskom', aliases: ['ESKOM', 'ESKOM HOLDINGS SOC LTD'], kind: 'eskom',
        effectiveFrom: dates.from, effectiveTo: dates.to, approvedIncreasePct: null,
        tariffs: parsed.tariffs, lossFactors: parsed.lossFactors, ssegRule: netBillingRule('eskom'),
        issues: [
          ...parsed.issues,
          ...parsed.skippedSheets.map((s) => ({ code: 'sheet_skipped' as const, severity: 'warn' as const, message: `sheet "${s.sheet}" not parsed: ${s.reason}` })),
        ],
        unresolved: [],
      }],
    }
  }

  if (!input.pdfText) throw new Error('rfd_pdf needs pdfText (run pdftotext -layout)')
  if (!input.licenseeName) throw new Error('rfd_pdf needs --licensee: one RfD is one licensee (see manifest.csv)')
  const parsed = parseRfdText(input.pdfText, { fileSha256: input.sha256 })
  const dates = effectiveDates('municipal', input.financialYear)
  return {
    parser: input.parser,
    source: {
      ...common, kind: 'nersa_decision', title: `NERSA RfD ${input.financialYear}: ${input.licenseeName}`,
      pageCount: (input.pdfText.match(/\f/g) ?? []).length + 1,
    },
    years: [{
      licenseeName: input.licenseeName, aliases: [input.licenseeName], kind: 'municipal',
      effectiveFrom: dates.from, effectiveTo: dates.to, approvedIncreasePct: parsed.increasePct,
      tariffs: parsed.tariffs, lossFactors: [], ssegRule: null, issues: parsed.issues, unresolved: parsed.unresolved,
    }],
  }
}
```

Uncomment `export * from './build-plan'` in `packages/shared/src/tariffs/ingest/index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/build-plan.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/ingest/build-plan.ts packages/shared/src/tariffs/ingest/build-plan.test.ts packages/shared/src/tariffs/ingest/index.ts
git commit -m "feat(tariffs): build ingestion plans from province, Eskom and RfD sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Supabase store and the CLI

**Files:**
- Create: `packages/shared/src/tariffs/ingest/supabase-store.ts`, `scripts/tariffs/ingest.ts`
- Modify: `packages/shared/src/tariffs/ingest/index.ts` (uncomment `./supabase-store`)
- Test: `packages/shared/src/tariffs/ingest/supabase-store.test.ts`

- [ ] **Step 1: Write the failing test (row mappers + a stub client)**

`packages/shared/src/tariffs/ingest/supabase-store.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff } from '../types'
import { chargeFromRow, chargeRow, tariffFromRows, tariffRow } from './supabase-store'

describe('row mappers', () => {
  const c = makeCharge({
    component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, season: 'low', tou: 'peak',
    unitInferred: true, inferenceReason: 'magnitude: labelled c/kWh but 3.09 < 20, read as R/kWh',
    sourceLocator: { sheet: 'BUFFALO CITY', cell: 'B25' }, extractionMethod: 'parser', label: 'Part 1 - Charge per kWh (c/kWh)',
  })
  it('round-trips a charge through its database row', () => {
    const row = chargeRow('t1', 'd1', c)
    expect(row).toMatchObject({ tariff_id: 't1', source_document_id: 'd1', unit: 'R_per_kWh', unit_inferred: true, block_min_kwh: null })
    expect(row.source_locator).toMatchObject({ cell: 'B25', label: 'Part 1 - Charge per kWh (c/kWh)' })
    expect(chargeFromRow({ ...row, amount_excl_vat: '3.090000', reviewed_at: null })).toMatchObject({
      component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, season: 'low', tou: 'peak', label: 'Part 1 - Charge per kWh (c/kWh)',
    })
  })
  it('maps a tariff and rebuilds it with its charges', () => {
    const t = makeTariff({ name: 'Scale 1A', structure: 'flat', category: 'domestic', charges: [c] })
    const row = tariffRow('y1', t)
    expect(row).toMatchObject({ tariff_year_id: 'y1', name: 'Scale 1A', structure: 'flat', category: 'domestic' })
    const back = tariffFromRows({ ...row, id: 't1' }, [{ ...chargeRow('t1', null, c), amount_excl_vat: 3.09 }])
    expect(back).toMatchObject({ name: 'Scale 1A', charges: [{ amountExclVat: 3.09 }] })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/supabase-store.test.ts`
Expected: FAIL — `Failed to resolve import "./supabase-store"`.

- [ ] **Step 3: Implement the Supabase store**

`packages/shared/src/tariffs/ingest/supabase-store.ts`:
```ts
/**
 * Service-role TariffStore for the ingestion CLI. NEVER import this into a
 * client bundle: it is built from a service key and bypasses RLS (the
 * immutability triggers still apply to it).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Charge, ChargeComponent, ChargeDayType, BlockBasis, DemandBasis, ExtractionMethod, LossFactor, SourceLocator,
  SsegRule, Tariff, TariffCategory, TariffMetering, TariffSeason, TariffStructure, TariffUnit, TouOrAll, VatBasis, YearState,
} from '../types'
import type { TariffStore, YearMeta } from './ingest-core'

type Row = Record<string, unknown>
const CHUNK = 500

function check<T extends { error: { message: string } | null }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res
}
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function tariffRow(yearId: string, t: Tariff): Row {
  return {
    tariff_year_id: yearId, code: t.code, name: t.name, family: t.family, category: t.category, metering: t.metering,
    structure: t.structure, voltage_band: t.voltageBand, phase: t.phase, transmission_zone: t.transmissionZone,
    local_authority: t.localAuthority, min_amps: t.minAmps, max_amps: t.maxAmps, min_kva: t.minKva, max_kva: t.maxKva,
    is_legacy: t.isLegacy, notes: t.notes, source_locator: t.sourceLocator,
  }
}

export function chargeRow(tariffId: string, sourceDocumentId: string | null, c: Charge): Row {
  return {
    tariff_id: tariffId, component: c.component, season: c.season, tou: c.tou, day_type: c.dayType,
    block_min_kwh: c.blockMinKwh, block_max_kwh: c.blockMaxKwh, block_basis: c.blockBasis, unit: c.unit,
    demand_basis: c.demandBasis, amount_excl_vat: c.amountExclVat, vat_rate: c.vatRate, vat_basis: c.vatBasis,
    unit_inferred: c.unitInferred, inference_reason: c.inferenceReason, source_document_id: sourceDocumentId,
    source_locator: { ...c.sourceLocator, ...(c.label ? { label: c.label } : {}) }, extraction_method: c.extractionMethod,
  }
}

export function chargeFromRow(r: Row): Charge {
  const locator = (r.source_locator ?? {}) as SourceLocator
  return {
    component: r.component as ChargeComponent, season: r.season as TariffSeason, tou: r.tou as TouOrAll,
    dayType: r.day_type as ChargeDayType, blockMinKwh: num(r.block_min_kwh), blockMaxKwh: num(r.block_max_kwh),
    blockBasis: (r.block_basis ?? null) as BlockBasis | null, unit: r.unit as TariffUnit,
    demandBasis: (r.demand_basis ?? null) as DemandBasis | null, amountExclVat: Number(r.amount_excl_vat),
    vatRate: Number(r.vat_rate ?? 0.15), vatBasis: r.vat_basis as VatBasis, unitInferred: Boolean(r.unit_inferred),
    inferenceReason: (r.inference_reason ?? null) as string | null, sourceLocator: locator,
    extractionMethod: r.extraction_method as ExtractionMethod, label: locator.label,
    reviewedAt: (r.reviewed_at ?? null) as string | null,
  }
}

export function tariffFromRows(t: Row, charges: Row[]): Tariff {
  return {
    code: (t.code ?? null) as string | null, name: t.name as string, family: (t.family ?? null) as string | null,
    category: t.category as TariffCategory, metering: t.metering as TariffMetering, structure: t.structure as TariffStructure,
    voltageBand: (t.voltage_band ?? null) as string | null, phase: (t.phase ?? null) as 'single' | 'three' | null,
    transmissionZone: num(t.transmission_zone), localAuthority: Boolean(t.local_authority),
    minAmps: num(t.min_amps), maxAmps: num(t.max_amps), minKva: num(t.min_kva), maxKva: num(t.max_kva),
    isLegacy: Boolean(t.is_legacy), notes: (t.notes ?? null) as string | null,
    charges: charges.map(chargeFromRow), exportTariffCode: null, sourceLocator: (t.source_locator ?? {}) as SourceLocator,
  }
}

function yearRow(meta: YearMeta): Row {
  return {
    licensee_id: meta.licenseeId, financial_year: meta.financialYear, effective_from: meta.effectiveFrom,
    effective_to: meta.effectiveTo, approved_increase_pct: meta.approvedIncreasePct, source_document_id: meta.sourceDocumentId,
  }
}

export function createSupabaseTariffStore(url: string, serviceKey: string): TariffStore {
  const db: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const t = () => db.schema('tariffs')

  return {
    async findSourceDocumentBySha(sha256) {
      const doc = check(await t().from('source_document').select('id').eq('sha256', sha256).maybeSingle(), 'source_document lookup')
      if (!doc.data) return null
      const id = (doc.data as Row).id as string
      const runs = check(await t().from('ingest_run').select('id').eq('source_document_id', id).eq('status', 'succeeded').limit(1), 'ingest_run lookup')
      return { id, hasSucceededRun: (runs.data ?? []).length > 0 }
    },
    async findLicenseeIdByAlias(alias) {
      const r = check(await t().from('licensee_alias').select('licensee_id').eq('alias', alias).maybeSingle(), 'alias lookup')
      return r.data ? ((r.data as Row).licensee_id as string) : null
    },
    async createLicensee({ name, kind, aliases }) {
      const r = check(await t().from('licensee').insert({ name, kind }).select('id').single(), 'licensee insert')
      const id = (r.data as Row).id as string
      if (aliases.length > 0) {
        check(await t().from('licensee_alias').upsert(aliases.map((alias) => ({ alias, licensee_id: id })), { onConflict: 'alias', ignoreDuplicates: true }), 'alias insert')
      }
      return id
    },
    async findYear(licenseeId, financialYear) {
      const r = check(await t().from('tariff_year').select('id,state').eq('licensee_id', licenseeId).eq('financial_year', financialYear).maybeSingle(), 'year lookup')
      return r.data ? { id: (r.data as Row).id as string, state: (r.data as Row).state as YearState } : null
    },
    async loadYearTariffs(yearId) {
      const ts = check(await t().from('tariff').select('*').eq('tariff_year_id', yearId), 'tariff load').data as Row[] | null ?? []
      const ids = ts.map((x) => x.id as string)
      const charges: Row[] = []
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = check(await t().from('charge').select('*').in('tariff_id', ids.slice(i, i + CHUNK)), 'charge load')
        charges.push(...((r.data as Row[] | null) ?? []))
      }
      return ts.map((x) => tariffFromRows(x, charges.filter((c) => c.tariff_id === x.id)))
    },
    async uploadSource(path, bytes, contentType) {
      const r = await db.storage.from('tariff-sources').upload(path, bytes, { contentType, upsert: false })
      if (r.error && !/exists|duplicate/i.test(r.error.message)) throw new Error(`upload ${path}: ${r.error.message}`)
    },
    async insertSourceDocument(row) {
      const r = check(await t().from('source_document').insert({
        kind: row.kind, title: row.title, financial_year: row.financialYear, status: row.status, storage_path: row.storagePath,
        sha256: row.sha256, page_count: row.pageCount, url: row.url, retrieved_at: row.retrievedAt,
      }).select('id').single(), 'source_document insert')
      return (r.data as Row).id as string
    },
    async insertIngestRun({ sourceDocumentId, parser, startedBy }) {
      const r = check(await t().from('ingest_run').insert({ source_document_id: sourceDocumentId, parser, status: 'running', started_by: startedBy }).select('id').single(), 'ingest_run insert')
      return (r.data as Row).id as string
    },
    async finishIngestRun(id, patch) {
      check(await t().from('ingest_run').update({ status: patch.status, stats: patch.stats, diff: patch.diff, error: patch.error, finished_at: new Date().toISOString() }).eq('id', id), 'ingest_run finish')
    },
    async insertYear(meta) {
      const r = check(await t().from('tariff_year').insert({ ...yearRow(meta), state: 'ingesting' }).select('id').single(), 'year insert')
      return (r.data as Row).id as string
    },
    async updateYear(yearId, meta) {
      check(await t().from('tariff_year').update(yearRow(meta)).eq('id', yearId), 'year update')
    },
    async setYearState(yearId, state) {
      check(await t().from('tariff_year').update({ state }).eq('id', yearId), `year -> ${state}`)
    },
    async deleteYearChildren(yearId) {
      check(await t().from('tariff').delete().eq('tariff_year_id', yearId), 'tariff delete')
      check(await t().from('loss_factor').delete().eq('tariff_year_id', yearId), 'loss_factor delete')
      check(await t().from('sseg_rule').delete().eq('tariff_year_id', yearId), 'sseg_rule delete')
    },
    async insertTariffs(yearId, sourceDocumentId, tariffs) {
      const ids = new Map<string, string>()
      for (let i = 0; i < tariffs.length; i += CHUNK) {
        const r = check(await t().from('tariff').insert(tariffs.slice(i, i + CHUNK).map((x) => tariffRow(yearId, x))).select('id,name'), 'tariff insert')
        for (const row of (r.data as Row[] | null) ?? []) ids.set(row.name as string, row.id as string)
      }
      const charges = tariffs.flatMap((x) => x.charges.map((c) => chargeRow(ids.get(x.name) as string, sourceDocumentId, c)))
      for (let i = 0; i < charges.length; i += CHUNK) {
        check(await t().from('charge').insert(charges.slice(i, i + CHUNK)), 'charge insert')
      }
      return ids
    },
    async linkExportTariffs(links) {
      for (const l of links) check(await t().from('tariff').update({ export_tariff_id: l.exportTariffId }).eq('id', l.tariffId), 'export link')
    },
    async insertLossFactors(yearId, factors: LossFactor[]) {
      check(await t().from('loss_factor').insert(factors.map((f) => ({
        tariff_year_id: yearId, kind: f.kind, voltage_band: f.voltageBand, transmission_zone: f.transmissionZone,
        factor: f.factor, source_locator: f.sourceLocator,
      }))), 'loss_factor insert')
    },
    async insertSsegRule(yearId, rule: SsegRule) {
      check(await t().from('sseg_rule').insert({
        tariff_year_id: yearId, crediting: rule.crediting, carry_forward: rule.carryForward, fy_end_month: rule.fyEndMonth,
        cap_rule: rule.capRule, offsets: rule.offsets, forfeit_on_ownership_change: rule.forfeitOnOwnershipChange,
        max_kva: rule.maxKva, requires_tou: rule.requiresTou, requires_bidirectional_meter: rule.requiresBidirectionalMeter,
        locator: rule.locator,
      }), 'sseg_rule insert')
    },
  }
}
```
(`loss_factor.licensee_id` and `sseg_rule.licensee_id` are omitted on purpose: the `year_child_guard` trigger fills them from the year before the NOT NULL check.)

Uncomment `export * from './supabase-store'` in `packages/shared/src/tariffs/ingest/index.ts`.

- [ ] **Step 4: Write the CLI**

`scripts/tariffs/ingest.ts`:
```ts
/**
 * Ingest ONE tariff source file into the tariffs library (D-03). Run by E-Site
 * staff on a machine with the source drive. DRY RUN BY DEFAULT: parses,
 * validates, diffs and prints the plan; writes nothing.
 *
 *   pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest.ts <file> \
 *     --parser province_xlsx|eskom_xlsm|rfd_pdf --fy 2025/26 \
 *     [--licensee "CITY POWER"] [--url <source url>] [--create-licensees] [--apply] [--json]
 *
 * With NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, a dry run
 * reads the live registry (licensee aliases, existing years, the published
 * predecessor for YoY). Without them it uses an empty in-memory store.
 * --apply requires both variables and uploads to the private tariff-sources
 * bucket; years land in 'in_review' and are never published from here.
 * rfd_pdf needs poppler's pdftotext on PATH (brew install poppler).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { buildIngestPlan } from '../../packages/shared/src/tariffs/ingest/build-plan.ts'
import { runIngest, type ParserName } from '../../packages/shared/src/tariffs/ingest/ingest-core.ts'
import { createMemoryTariffStore } from '../../packages/shared/src/tariffs/ingest/memory-store.ts'
import { createSupabaseTariffStore } from '../../packages/shared/src/tariffs/ingest/supabase-store.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

async function main(): Promise<void> {
  const file = process.argv[2]
  const parser = arg('parser') as ParserName | undefined
  const fy = arg('fy')
  if (!file || file.startsWith('--') || !parser || !fy || !['province_xlsx', 'eskom_xlsm', 'rfd_pdf'].includes(parser)) {
    console.error('usage: ingest.ts <file> --parser province_xlsx|eskom_xlsm|rfd_pdf --fy 2026/27 [--licensee NAME] [--url URL] [--create-licensees] [--apply] [--json]')
    process.exit(2)
  }
  const apply = flag('apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (apply && (!url || !key)) {
    console.error('--apply needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }

  const bytes = new Uint8Array(readFileSync(file))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let pdfText: string | undefined
  if (parser === 'rfd_pdf') {
    try {
      pdfText = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    } catch {
      console.error('pdftotext failed or is missing: brew install poppler')
      process.exit(1)
    }
  }

  const plan = await buildIngestPlan({
    parser, fileName: basename(file), bytes, sha256, financialYear: fy, pdfText,
    licenseeName: arg('licensee'), url: arg('url') ?? null, retrievedAt: new Date().toISOString(),
  })
  const store = url && key ? createSupabaseTariffStore(url, key) : createMemoryTariffStore()
  if (!(url && key)) console.error('(no database credentials: dry run against an empty registry)')
  const report = await runIngest(plan, store, { apply, createMissingLicensees: flag('create-licensees') })

  if (flag('json')) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`${report.status.toUpperCase()}  sha256 ${report.sha256}  -> tariff-sources/${report.storagePath}`)
  for (const y of report.years) {
    const yoy = y.yoy ? `  yoy +${y.yoy.added} -${y.yoy.removed} ~${y.yoy.changed} out-of-band ${y.yoy.outOfBand}` : ''
    console.log(`  ${y.action.padEnd(22)} ${y.licensee}  tariffs ${y.tariffs}  charges ${y.charges}  block ${y.blocking}  review ${y.review}  unresolved ${y.unresolved}${yoy}`)
  }
  if (report.status === 'dry_run') console.log('Nothing written. Re-run with --apply to load (years land in_review).')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
```

- [ ] **Step 5: Run the tests and a real dry run (no database)**

```bash
pnpm --filter @esite/shared exec vitest run src/tariffs/ingest
pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest.ts "$TARIFF_SOURCE_DIR/2025/Gauteng-Province.xlsx" --parser province_xlsx --fy 2025/26 --create-licensees
pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest.ts "$TARIFF_SOURCE_DIR/ESKOM/Eskom-tariffs-1-April-2025-ver-2.xlsm" --parser eskom_xlsm --fy 2025/26 --create-licensees
pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest.ts "$TARIFF_SOURCE_DIR/2026-27/MUNICIPAL/Gauteng/CITY POWER - NERSA RfD 2026-27 - CityPowerReasonsforDecisionontariffapplicationprocessforFY2026.pdf" --parser rfd_pdf --fy 2026/27 --licensee "CITY POWER" --create-licensees
```
Expected: tests PASS (ingest-core 7, build-plan 3, supabase-store 2). Each CLI run prints `DRY_RUN`, one `create` line per licensee (11 for Gauteng, 1 Eskom, 1 City Power) and `Nothing written.` Record the three outputs for the PR body. Do NOT run `--apply` — the schema is not applied yet; applying data is an owner step after the migration lands.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tariffs/ingest/supabase-store.ts packages/shared/src/tariffs/ingest/supabase-store.test.ts packages/shared/src/tariffs/ingest/index.ts scripts/tariffs/ingest.ts
git commit -m "feat(tariffs): service-role tariff store and the dry-run-by-default ingestion CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Three suites, type-check, push, update the draft PR

**Files:** none

- [ ] **Step 1: Full verification**

```bash
pnpm --filter @esite/shared type-check
pnpm --filter @esite/db type-check
pnpm --filter web type-check
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared lint 2>&1 | tail -5
```
Expected: all green. `tsc` failing on `packages/shared/src/tariffs/ingest/supabase-store.ts` over `db.schema(...)` generics means the client type needs `SupabaseClient<any, any, any>`: if lint then rejects `any`, keep `SupabaseClient` and add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` on that one line only.

- [ ] **Step 2: Push**

```bash
git push git@github.com:WattMatt/e-site.git feat/solar-phase-2a
```

- [ ] **Step 3: Append 2a-ii to the draft PR body**

```bash
gh pr view --repo WattMatt/e-site feat/solar-phase-2a --json body -q .body > /tmp/solar-2a-pr.md
python3 - <<'EOF'
p = '/tmp/solar-2a-pr.md'
body = open(p).read()
section = """
### 2a-ii — parsers and ingestion
- Parsers (`@esite/shared/tariffs/parsers`): NERSA province compendium (all 9 layouts, embedded values, block ranges in column B, markers), Eskom official xlsm (banded tables for 2025/26 and 2026/27, Homeflex, Gen-offset export tariffs linked by family/zone/voltage, loss factors, excl/incl proof), NERSA 2026/27 RfD PDF text (recommended column; draft rows for review).
- One normaliser decides units; every inference is flagged (`unit_inferred` + reason) and blocks publish until reviewed.
- Golden cases 1-10 re-run from the real cells (fixtures are cell excerpts with source sha256), plus 10b (Eskom 2026/27) and 11 (City Power 2026/27 RfD).
- `scripts/tariffs/ingest.ts`: sha256-idempotent, dry run by default, private bucket upload, years land `in_review`, YoY against the published predecessor.
- Real-book sweep (`TARIFF_SOURCE_DIR` set): <paste the sweep line>
- Dry runs: <paste the three CLI outputs>
"""
marker = '### Evidence'
body = body.replace(marker, section.strip() + '\n\n' + marker, 1) if marker in body else body + section
open(p, 'w').write(body)
EOF
gh pr edit --repo WattMatt/e-site feat/solar-phase-2a --body-file /tmp/solar-2a-pr.md
```
Fill the two `<paste …>` placeholders in `/tmp/solar-2a-pr.md` with your recorded outputs before `gh pr edit` (they are not optional). The body must still end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: Report** the PR URL, suite counts, the sweep line and the three dry-run summaries. Do not merge, do not apply the migration, do not run `--apply`.

---

## Deferred (not in 2a)

- **AI-assisted extraction** for RfDs the grammar cannot read (tables as images, other column orders): a server-side, rate-limited, entitlement-checked call that proposes rows with `extraction_method = 'ai'`, always into review. It needs no change to the schema or the review flow built here; it needs a server key and a decision on cost (spec §5 security baseline item 3). Tests must never require an API key.
- **Batch ingestion of all 176 RfDs** from `2026-27/MUNICIPAL/manifest.csv` (licensee name + URL + sha256 per row): a loop over this CLI, after the per-file dry runs have been reviewed.
- **Eskom local-authority sheets** (Munic): see Q5.
- **TOU calendar seeding** (Eskom booklet p47 needs a human reading), the admin review UI and the publish action (2b).
