# Tariff Source Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove every published tariff value against the exact source file it was read from, hide anything not proven, refuse to publish or price (Solar) anything not proven unless a person enters a labelled placeholder.

**Architecture:** Independent readers in `packages/shared/src/tariffs/verify/` (ExcelJS for workbook cells, pdf.js text positions for NERSA decision PDFs; no import from `tariffs/parsers`) are driven by `scripts/tariffs/verify.ts`, which downloads each source by sha256 and records one `tariffs.source_verification` row per subject. The database decides "verified" (`tariffs.subject_verified`), gates publishing (a dedicated trigger), exposes verified-only views to the explorer, and Solar's pricing loader refuses unverified charges unless an override row confirms a placeholder.

**Tech Stack:** TypeScript (pnpm/turbo monorepo), Vitest, ExcelJS, pdfjs-dist (legacy node build), pdf-lib (test fixtures only), Postgres/Supabase migrations with `@verify` blocks, Next.js 15 server components.

**Spec:** `docs/superpowers/specs/2026-10-06-tariff-source-verification-design.md`

**Two PRs, in order (the order is part of the design):**
- **PR A — Phase A (Tasks 1–9):** readers, table, script, admin evidence. No gate. Merge, apply, run over all published years, read the result.
- **PR B — Phase B (Tasks 10–14):** publish gate, verified views + explorer, Solar refusal + placeholder, schedule. Opened only after Phase A's run is read; merged after project 2 fixes what failed (or the owner accepts withdrawing those tariffs).

**Working rules for every task:**
- Worktree: `/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/worktrees/tariff-source-verification` (on the SSD: the internal disk has ~6 GB free and a `~/.config` worktree copies 2.3 GB). Create it from `origin/main` with `git worktree add`, branch `feat/tariff-source-verification`; copy the spec and this plan into it.
- Run THREE suites before any push touching a migration: `pnpm --filter @esite/shared test`, `pnpm --filter web test`, `pnpm --filter @esite/db test:ci`.
- Migration number: written as `NNNNN` here. Claim it **at apply time** after checking the ledger `max(version)`, `origin/main` filenames and every open PR's migration filenames.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/tariffs/verify/number-format.ts` | Render a stored value in every form a source may print it (`739.28`, `739,28`, `R302.84`, `2941,7115`), and parse a printed number token. |
| `packages/shared/src/tariffs/verify/workbook-cell.ts` | Read one cited cell from workbook bytes; decide match / mismatch / not_found. |
| `packages/shared/src/tariffs/verify/pdf-page-items.ts` | Load a PDF page's text items with x/y (pdf.js), grouped into rows. |
| `packages/shared/src/tariffs/verify/pdf-charge.ts` | On a cited page: find the label's row, the value token on that row, the approved column's header, and decide. |
| `packages/shared/src/tariffs/verify/types.ts` | `VerifyOutcome`, `Evidence`, `SubjectToVerify`. |
| `packages/shared/src/tariffs/verify/index.ts` | Barrel (NOT re-exported from `tariffs/index.ts`: pdf.js must not enter the web client bundle). |
| `packages/shared/src/tariffs/verify/independence.contract.test.ts` | Fails if any `verify/` file imports `../parsers` or `../ingest`. |
| `apps/edge-functions/supabase/migrations/NNNNN_tariff_source_verification.sql` | Table, fingerprint trigger, `subject_verified`, `unverified_charges`, two-person confirm, RLS, `@verify`. |
| `scripts/db/assert-tariff-source-verification.sql` | Behaviour assertions (impersonated roles). |
| `scripts/tariffs/verify.ts` | Download sources by sha256, run readers, insert rows (service key). |
| `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/VerificationPanel.tsx` | Evidence list + two-person confirm buttons. |
| `apps/web/src/actions/tariff-verification.actions.ts` | `confirmVerificationAction`. |
| Phase B: `NNNNN_tariff_verification_gates.sql`, `apps/web/src/lib/tariffs/explorer-data.ts` (views), `apps/web/src/lib/solar/pricing/load-study-pricing.ts` + `packages/shared/src/solar/tariff/placeholders.ts`, `.github/workflows/tariff-verify.yml` |

---

## PHASE A

### Task 1: Number forms

**Files:**
- Create: `packages/shared/src/tariffs/verify/number-format.ts`
- Test: `packages/shared/src/tariffs/verify/number-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { numberTokens, parsePrintedNumber, sameValue } from './number-format'

describe('parsePrintedNumber', () => {
  it('reads decimal points, decimal commas, currency and units', () => {
    expect(parsePrintedNumber('739.28')).toBe(739.28)
    expect(parsePrintedNumber('2941,7115')).toBe(2941.7115)
    expect(parsePrintedNumber('R302.84/kVA')).toBe(302.84)
    expect(parsePrintedNumber('R 215.91')).toBe(215.91)
    expect(parsePrintedNumber('1 925,00')).toBe(1925)
    expect(parsePrintedNumber('15%')).toBe(15)
  })
  it('returns null for text with no number or with two numbers', () => {
    expect(parsePrintedNumber('Peak')).toBeNull()
    expect(parsePrintedNumber('2558,0100 2941,7115')).toBeNull()
  })
})

describe('numberTokens', () => {
  it('lists every way a source may print the value, at its own decimals', () => {
    expect(numberTokens(2941.7115)).toEqual(expect.arrayContaining(['2941.7115', '2941,7115']))
    expect(numberTokens(123.2, 2)).toEqual(expect.arrayContaining(['123.20', '123,20', '123.2', '123,2']))
  })
})

describe('sameValue', () => {
  it('is exact at the printed decimals, never approximate', () => {
    expect(sameValue(739.28, 739.28)).toBe(true)
    expect(sameValue(739.28, 739.29)).toBe(false)
    expect(sameValue(4.527, 4.527)).toBe(true)
    expect(sameValue(0.1 + 0.2, 0.3)).toBe(true) // float noise below 1e-9 only
  })
})
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/verify/number-format.test.ts`

- [ ] **Step 3: Implement**

```ts
/**
 * How a value is printed in a source, and reading a printed number back.
 * Exact comparison only: the tolerance (1e-9) absorbs binary float noise,
 * never a rounding difference a reader could see.
 */
const NUM = /-?\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g

export function parsePrintedNumber(text: string): number | null {
  const hits = text.match(NUM) ?? []
  if (hits.length !== 1) return null
  const raw = hits[0].replace(/[  ]/g, '').replace(',', '.')
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9
}

/** The decimals of a stored NUMERIC rendered without trailing noise. */
function minimalDecimals(v: number): number {
  const s = String(Number(v.toFixed(6)))
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export function numberTokens(v: number, displayDecimals?: number): string[] {
  const out = new Set<string>()
  const decs = new Set<number>([minimalDecimals(v)])
  if (displayDecimals !== undefined) decs.add(displayDecimals)
  for (const d of decs) {
    const dot = v.toFixed(d)
    out.add(dot)
    out.add(dot.replace('.', ','))
  }
  return [...out]
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/verify/number-format.ts packages/shared/src/tariffs/verify/number-format.test.ts
git commit -m "feat(tariffs/verify): exact number forms for source verification"
```

### Task 2: Types and the independence guard

**Files:**
- Create: `packages/shared/src/tariffs/verify/types.ts`, `packages/shared/src/tariffs/verify/index.ts`
- Test: `packages/shared/src/tariffs/verify/independence.contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = __dirname
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'))

describe('the verifier shares no code with ingest', () => {
  it('covers the verifier module', () => expect(files).toContain('types.ts'))
  it.each(files)('%s imports nothing from parsers or ingest', (f) => {
    const src = readFileSync(join(DIR, f), 'utf8')
    expect(src).not.toMatch(/from\s+['"][^'"]*\/(parsers|ingest)(\/|['"])/)
  })
})
```

- [ ] **Step 2: Run — expect FAIL ("covers the verifier module": `types.ts` does not exist yet)**

- [ ] **Step 3: Create `types.ts` and `index.ts`**

```ts
// types.ts
export type VerifyOutcome = 'match' | 'mismatch' | 'not_found' | 'unresolved'
export type SubjectKind = 'charge' | 'tariff' | 'tou_window' | 'holiday_treatment'

export interface Evidence {
  /** What the reader saw at the cited place, verbatim. */
  read: string | number | null
  /** Where exactly: sheet+cell, or page + row text + token + x-range + column header. */
  at: Record<string, unknown>
  note?: string
}

export interface VerifyResult {
  outcome: VerifyOutcome
  evidence: Evidence
}
```

```ts
// index.ts — import by path ('@esite/shared/tariffs/verify'), never from the tariffs barrel.
export * from './types'
export * from './number-format'
export * from './workbook-cell'
export * from './pdf-page-items'
export * from './pdf-charge'
```

Add to `packages/shared/package.json` `exports`: `"./tariffs/verify": "./src/tariffs/verify/index.ts"`. (`index.ts` will not compile until Tasks 3–5 exist; that is fine because nothing imports it yet. Run only this test file.)

- [ ] **Step 4: Run the contract test — expect PASS** (`types.ts`, `index.ts`, `number-format.ts` present)

- [ ] **Step 5: Mutation check:** add `import '../parsers/grid'` to `types.ts`, run the test, see it FAIL naming `types.ts`; remove the line, see it PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tariffs/verify packages/shared/package.json
git commit -m "feat(tariffs/verify): verifier types; contract test forbids parser/ingest imports"
```

### Task 3: Workbook cell reader

**Files:**
- Create: `packages/shared/src/tariffs/verify/workbook-cell.ts`
- Test: `packages/shared/src/tariffs/verify/workbook-cell.test.ts`

- [ ] **Step 1: Write the failing test** (fixtures built in memory with ExcelJS, matching the real cells read on 2026-10-06: `Megaflex NLA!J8 = 739.28`, format `#,##0.00_);(#,##0.00)`; `GOVAN MBEKI!B80 = "R302.84/kVA"`)

```ts
// @vitest-environment node
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { verifyWorkbookCell } from './workbook-cell'

async function book(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Megaflex NLA')
  ws.getCell('J8').value = 739.28
  ws.getCell('J8').numFmt = '#,##0.00_);(#,##0.00)'
  ws.getCell('K8').value = 850.17
  ws.getCell('S39').value = 0
  const gm = wb.addWorksheet('GOVAN MBEKI')
  gm.getCell('A80').value = 'Low Season:'
  gm.getCell('B80').value = 'R302.84/kVA'
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

describe('verifyWorkbookCell', () => {
  it('matches a numeric cell exactly and records the cell and its format', async () => {
    const r = await verifyWorkbookCell(await book(), { sheet: 'Megaflex NLA', cell: 'J8' }, 739.28)
    expect(r.outcome).toBe('match')
    expect(r.evidence.read).toBe(739.28)
    expect(r.evidence.at).toMatchObject({ sheet: 'Megaflex NLA', cell: 'J8', numFmt: '#,##0.00_);(#,##0.00)' })
  })
  it('a value off by 0.01 is a mismatch, not a match', async () => {
    expect((await verifyWorkbookCell(await book(), { sheet: 'Megaflex NLA', cell: 'J8' }, 739.29)).outcome).toBe('mismatch')
  })
  it('reads the number out of a text cell', async () => {
    expect((await verifyWorkbookCell(await book(), { sheet: 'GOVAN MBEKI', cell: 'B80' }, 302.84)).outcome).toBe('match')
  })
  it('a label cell (no number) is not_found', async () => {
    expect((await verifyWorkbookCell(await book(), { sheet: 'GOVAN MBEKI', cell: 'A80' }, 302.84)).outcome).toBe('not_found')
  })
  it('a missing sheet or empty cell is not_found', async () => {
    expect((await verifyWorkbookCell(await book(), { sheet: 'Nope', cell: 'A1' }, 1)).outcome).toBe('not_found')
    expect((await verifyWorkbookCell(await book(), { sheet: 'Megaflex NLA', cell: 'Z99' }, 1)).outcome).toBe('not_found')
  })
  it('zero matches zero', async () => {
    expect((await verifyWorkbookCell(await book(), { sheet: 'Megaflex NLA', cell: 'S39' }, 0)).outcome).toBe('match')
  })
  it('sheet names are matched exactly, including Eskom\'s leading spaces', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet(' Nightsave Urban NLA').getCell('P14').value = 72.99
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    expect((await verifyWorkbookCell(bytes, { sheet: ' Nightsave Urban NLA', cell: 'P14' }, 72.99)).outcome).toBe('match')
    expect((await verifyWorkbookCell(bytes, { sheet: 'Nightsave Urban NLA', cell: 'P14' }, 72.99)).outcome).toBe('not_found')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/verify/workbook-cell.test.ts`

- [ ] **Step 3: Implement**

```ts
/**
 * One cited workbook cell, read straight from the source bytes (ExcelJS; no
 * parser code). Formulas count as their cached result, the value the
 * published workbook displays.
 */
import ExcelJS from 'exceljs'
import { parsePrintedNumber, sameValue } from './number-format'
import type { VerifyResult } from './types'

export interface CellRef { sheet: string; cell: string }

const cache = new WeakMap<Uint8Array, Promise<ExcelJS.Workbook>>()
function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  let p = cache.get(bytes)
  if (!p) {
    const wb = new ExcelJS.Workbook()
    p = wb.xlsx.load(bytes as unknown as ArrayBuffer).then(() => wb)
    cache.set(bytes, p)
  }
  return p
}

function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'object' && 'result' in v) {
    const r = (v as { result?: unknown }).result
    return typeof r === 'number' || typeof r === 'string' ? r : null
  }
  if (typeof v === 'object' && 'richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('')
  return null
}

export async function verifyWorkbookCell(bytes: Uint8Array, ref: CellRef, expected: number): Promise<VerifyResult> {
  const wb = await load(bytes)
  const ws = wb.worksheets.find((w) => w.name === ref.sheet)
  if (!ws) return { outcome: 'not_found', evidence: { read: null, at: { ...ref }, note: 'sheet not in workbook' } }
  const c = ws.getCell(ref.cell)
  const read = cellValue(c.value)
  const at = { ...ref, numFmt: c.numFmt ?? null }
  if (read === null) return { outcome: 'not_found', evidence: { read, at, note: 'cell is empty' } }
  const n = typeof read === 'number' ? read : parsePrintedNumber(read)
  if (n === null) return { outcome: 'not_found', evidence: { read, at, note: 'cell holds no single number' } }
  return { outcome: sameValue(n, expected) ? 'match' : 'mismatch', evidence: { read, at } }
}
```

- [ ] **Step 4: Run — expect PASS (7 tests)**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/verify/workbook-cell.ts packages/shared/src/tariffs/verify/workbook-cell.test.ts
git commit -m "feat(tariffs/verify): independent workbook cell reader"
```

### Task 4: PDF page items with positions

**Files:**
- Modify: `packages/shared/package.json` — add `"pdfjs-dist": "^5.7.284"` to `dependencies` (same version as `apps/web`), `"pdf-lib": "^1.17.1"` to `devDependencies`; run `pnpm install`.
- Create: `packages/shared/src/tariffs/verify/pdf-page-items.ts`
- Test: `packages/shared/src/tariffs/verify/pdf-page-items.test.ts`

- [ ] **Step 1: Write the failing test** (fixture drawn with pdf-lib at known x/y)

```ts
// @vitest-environment node
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { pageRows } from './pdf-page-items'

async function pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([600, 800])
  const p = doc.addPage([600, 800])
  const t = (s: string, x: number, y: number) => p.drawText(s, { x, y, size: 9, font })
  t('Approved', 300, 700); t('Proposed', 380, 700); t('Recommended', 460, 700)
  t('Basic Charge (R/month)', 40, 680); t('2558,0100', 300, 680); t('2941,7115', 380, 680); t('2941,7115', 470, 680)
  return doc.save()
}

describe('pageRows', () => {
  it('groups the cited page\'s items into rows, left to right, with x positions', async () => {
    const rows = await pageRows(await pdf(), 2)
    const hdr = rows.find((r) => r.text.includes('Recommended'))!
    expect(hdr.items.map((i) => i.str)).toEqual(['Approved', 'Proposed', 'Recommended'])
    const row = rows.find((r) => r.text.startsWith('Basic Charge'))!
    expect(row.items.map((i) => i.str)).toEqual(['Basic Charge (R/month)', '2558,0100', '2941,7115', '2941,7115'])
    expect(row.items[3].x).toBeGreaterThan(row.items[2].x)
  })
  it('a page that does not exist yields no rows', async () => {
    expect(await pageRows(await pdf(), 9)).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
/**
 * Text items of one PDF page with their positions (pdf.js), grouped into rows
 * by baseline. Independent of the ingest path, which reads `pdftotext -layout`.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PageItem { str: string; x: number; y: number; width: number }
export interface PageRow { y: number; items: PageItem[]; text: string }

const ROW_TOLERANCE = 2.5 // pt: items whose baselines differ by less share a row

export async function pageRows(bytes: Uint8Array, pageNumber: number): Promise<PageRow[]> {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false }).promise
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) return []
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const items: PageItem[] = []
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      items.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], width: it.width })
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const rows: PageRow[] = []
    for (const i of items) {
      const row = rows.find((r) => Math.abs(r.y - i.y) < ROW_TOLERANCE)
      if (row) row.items.push(i)
      else rows.push({ y: i.y, items: [i], text: '' })
    }
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x)
      r.text = r.items.map((i) => i.str).join(' ')
    }
    return rows
  } finally {
    await doc.destroy()
  }
}
```

- [ ] **Step 4: Run — expect PASS.** If pdf.js under vitest needs a worker setting, set `GlobalWorkerOptions.workerSrc` is NOT required for the legacy node build; if the import fails under vitest, add `server.deps.inline: ['pdfjs-dist']` to `packages/shared/vitest.config.ts` and re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json pnpm-lock.yaml packages/shared/src/tariffs/verify/pdf-page-items.ts packages/shared/src/tariffs/verify/pdf-page-items.test.ts
git commit -m "feat(tariffs/verify): pdf.js page rows with positions"
```

### Task 5: PDF charge check (label row, value token, approved column)

**Files:**
- Create: `packages/shared/src/tariffs/verify/pdf-charge.ts`
- Test: `packages/shared/src/tariffs/verify/pdf-charge.test.ts`

- [ ] **Step 1: Write the failing test** (layout copied from the real Inkosi Langalibalele RfD 2026/27 p22 row read on 2026-10-05: `Basic Charge (R/month) 2558,0100 2941,7115 15% 2941,7115` under `Approved Proposed increase Tariff`, with "Recommended" one row above "Tariff")

```ts
// @vitest-environment node
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { verifyPdfCharge } from './pdf-charge'

type T = [string, number, number]
async function pdf(lines: T[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p = doc.addPage([600, 800])
  for (const [s, x, y] of lines) p.drawText(s, { x, y, size: 9, font })
  return doc.save()
}
const HEADER: T[] = [['2025/26', 300, 712], ['2026/27', 380, 712], ['Recommended', 460, 712],
  ['Approved', 300, 700], ['Proposed', 380, 700], ['increase', 430, 700], ['Tariff', 470, 700]]
const ROW: T[] = [['Basic Charge (R/month)', 40, 680], ['2558,0100', 300, 680], ['2941,7115', 380, 680], ['15%', 430, 680], ['2941,7115', 470, 680]]

describe('verifyPdfCharge', () => {
  it('matches when the value sits under the Recommended column on the label row', async () => {
    const r = await verifyPdfCharge(await pdf([...HEADER, ...ROW]), { page: 1, label: 'Basic Charge (R/month)' }, 2941.7115)
    expect(r.outcome).toBe('match')
    expect(r.evidence.at).toMatchObject({ page: 1, column: 'Recommended', token: '2941,7115' })
  })
  it('a value that is printed only in the Approved (prior-year) column is a mismatch', async () => {
    const r = await verifyPdfCharge(await pdf([...HEADER, ...ROW]), { page: 1, label: 'Basic Charge (R/month)' }, 2558.01)
    expect(r.outcome).toBe('mismatch')
  })
  it('a value not on the row at all is a mismatch, with what the column holds', async () => {
    const r = await verifyPdfCharge(await pdf([...HEADER, ...ROW]), { page: 1, label: 'Basic Charge (R/month)' }, 2941.7116)
    expect(r.outcome).toBe('mismatch')
    expect(r.evidence.read).toBe('2941,7115')
  })
  it('a label that is not on the page is not_found', async () => {
    const r = await verifyPdfCharge(await pdf([...HEADER, ...ROW]), { page: 1, label: 'Demand charge (R/kVA)' }, 297.666)
    expect(r.outcome).toBe('not_found')
  })
  it('two columns headed Recommended (Nala, Siyancuma) is unresolved, never a guess', async () => {
    const twin: T[] = [['Recommended', 380, 700], ['Recommended', 470, 700], ['Basic Charge (R/month)', 40, 680], ['2941,7115', 380, 680], ['2941,7115', 470, 680]]
    const r = await verifyPdfCharge(await pdf(twin), { page: 1, label: 'Basic Charge (R/month)' }, 2941.7115)
    expect(r.outcome).toBe('unresolved')
  })
  it('a page with no text (scanned image) is unresolved', async () => {
    const r = await verifyPdfCharge(await pdf([]), { page: 1, label: 'Basic Charge (R/month)' }, 1)
    expect(r.outcome).toBe('unresolved')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
/**
 * A charge cited to a NERSA decision page: the label's row, the value's token
 * on that row, and the column the decision approves. Independent of ingest:
 * pdf.js positions, not pdftotext layout. Anything ambiguous is `unresolved`.
 */
import { parsePrintedNumber, sameValue } from './number-format'
import { pageRows, type PageRow } from './pdf-page-items'
import type { VerifyResult } from './types'

export interface PdfRef { page: number; label: string }

const APPROVED_HEADER = /^(recommended|approved\s+tariff|recommend)/i
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** x-centres of headers that name the approved column, from the rows above the label row. */
function approvedColumns(rows: PageRow[], labelRow: PageRow): number[] {
  const above = rows.filter((r) => r.y > labelRow.y && r.y - labelRow.y < 120)
  const xs: number[] = []
  for (const r of above) for (const i of r.items) if (APPROVED_HEADER.test(i.str)) xs.push(i.x + i.width / 2)
  return xs
}

export async function verifyPdfCharge(bytes: Uint8Array, ref: PdfRef, expected: number): Promise<VerifyResult> {
  const rows = await pageRows(bytes, ref.page)
  if (rows.length === 0) return { outcome: 'unresolved', evidence: { read: null, at: { ...ref }, note: 'no text on the page (image or missing page)' } }
  const want = norm(ref.label)
  const labelRow = rows.find((r) => norm(r.text).startsWith(want) || norm(r.items[0]?.str ?? '') === want)
  if (!labelRow) return { outcome: 'not_found', evidence: { read: null, at: { ...ref }, note: 'label not on the page' } }
  const cols = approvedColumns(rows, labelRow)
  const at = { ...ref, row: labelRow.text }
  if (cols.length === 0) return { outcome: 'unresolved', evidence: { read: labelRow.text, at, note: 'no approved-column header above the row' } }
  if (cols.length > 1) return { outcome: 'unresolved', evidence: { read: labelRow.text, at: { ...at, headers: cols }, note: 'more than one approved-column header' } }
  const nums = labelRow.items.filter((i) => parsePrintedNumber(i.str) !== null && !i.str.includes('%'))
  if (nums.length === 0) return { outcome: 'not_found', evidence: { read: labelRow.text, at, note: 'no number on the row' } }
  const nearest = nums.reduce((a, b) => (Math.abs(b.x + b.width / 2 - cols[0]) < Math.abs(a.x + a.width / 2 - cols[0]) ? b : a))
  const value = parsePrintedNumber(nearest.str) as number
  const tokenAt = { ...at, column: 'Recommended', token: nearest.str, x: [nearest.x, nearest.x + nearest.width] }
  return { outcome: sameValue(value, expected) ? 'match' : 'mismatch', evidence: { read: nearest.str, at: tokenAt } }
}
```

- [ ] **Step 4: Run — expect PASS (6 tests).** Then run the contract test from Task 2 — still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/verify/pdf-charge.ts packages/shared/src/tariffs/verify/pdf-charge.test.ts
git commit -m "feat(tariffs/verify): NERSA decision charge check by row, token and approved column"
```

### Task 6: Real-file checks (env-gated)

**Files:**
- Test: `packages/shared/src/tariffs/verify/real-files.test.ts`

- [ ] **Step 1: Write the test** (runs only with `TARIFF_SOURCE_DIR` pointing at a folder holding files named `<sha256>.<ext>`, the way `tariff-sources` stores them; same pattern as `parsers/real-files.test.ts`)

```ts
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyPdfCharge } from './pdf-charge'
import { verifyWorkbookCell } from './workbook-cell'

const DIR = process.env.TARIFF_SOURCE_DIR
const ESKOM_2627 = 'aeebe852d693cc43a13440dedb2f8312646c6b8a94ae1b4309cc11fe979737ad.xlsm'
const INKOSI_2627 = 'aa33406b934c82da49da18ac636daa2de4182aff2d8a40d5b1f2869b114eb305.pdf'
const has = (f: string) => !!DIR && existsSync(join(DIR, f))

describe.runIf(has(ESKOM_2627))('Eskom 2026/27 workbook (values hand-checked 2026-10-05)', () => {
  const bytes = () => new Uint8Array(readFileSync(join(DIR!, ESKOM_2627)))
  it.each([['J8', 739.28], ['L8', 184.82], ['N8', 123.2], ['P8', 306.82], ['R8', 172.5], ['T8', 123.2]])('Megaflex NLA %s = %s', async (cell, v) => {
    expect((await verifyWorkbookCell(bytes(), { sheet: 'Megaflex NLA', cell }, v)).outcome).toBe('match')
  })
  it('a corrupted expectation is caught', async () => {
    expect((await verifyWorkbookCell(bytes(), { sheet: 'Megaflex NLA', cell: 'J8' }, 739.27)).outcome).toBe('mismatch')
  })
})

describe.runIf(has(INKOSI_2627))('Inkosi Langalibalele RfD 2026/27 p22 (hand-checked 2026-10-05)', () => {
  const bytes = () => new Uint8Array(readFileSync(join(DIR!, INKOSI_2627)))
  it.each([['Basic Charge (R/month)', 2941.7115], ['Demand charge (R/kVA)', 297.666]])('%s', async (label, v) => {
    expect((await verifyPdfCharge(bytes(), { page: 22, label }, v)).outcome).toBe('match')
  })
})
```

- [ ] **Step 2: Fetch the two files into a local folder outside git** (service key from `esite/.secrets/supabase.md`), then run:

```bash
TARIFF_SOURCE_DIR="/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/tariff-sources-cache" pnpm --filter @esite/shared exec vitest run src/tariffs/verify/real-files.test.ts
```

Expected: 9 PASS. If the Inkosi page has TWO tables whose label "Basic Charge (R/month)" repeats (Low Voltage and Medium Voltage share p22), the first test may pick the wrong row: then extend `PdfRef` with the stored `line` from `source_locator` and choose, among rows matching the label, the n-th occurrence on the page where n is derived from the stored line's order. Write that failing case first with a two-table fixture, then implement.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/tariffs/verify/real-files.test.ts
git commit -m "test(tariffs/verify): real Eskom and NERSA decision files, env-gated"
```

### Task 7: Migration — verification table and helpers

**Files:**
- Create: `apps/edge-functions/supabase/migrations/NNNNN_tariff_source_verification.sql`
- Create: `scripts/db/assert-tariff-source-verification.sql`

- [ ] **Step 1: Write the assertions first** (same structure as `scripts/db/assert-tariff-explorer.sql`: temp `_r` table, one DO block, fixtures rolled back)

Assertions, each a row `(check, ok)`:
1. `table_exists`: `to_regclass('tariffs.source_verification') IS NOT NULL`.
2. `member_cannot_insert`: as an active org member, `INSERT INTO tariffs.source_verification …` raises `insufficient_privilege`.
3. `admin_cannot_insert`: as a platform tariff admin (allow-list row in-transaction), the same insert is refused — only the service path writes results.
4. `fingerprint_stamped`: as postgres (service path), insert a `match` row for a real published charge; `subject_fingerprint = tariffs.charge_fingerprint(<charge id>)`.
5. `verified_after_match`: `tariffs.subject_verified('charge', <id>)` is true.
6. `stale_after_edit`: `SET LOCAL session_replication_role = replica`, `UPDATE tariffs.charge SET amount_excl_vat = amount_excl_vat + 0.01`, reset role → `subject_verified` is false.
7. `mismatch_not_verified`: a newer `mismatch` row makes it false even after a `match`.
8. `unverified_charges_lists_it`: `tariffs.unverified_charges(<tariff id>)` returns the charge.
9. `two_person_confirm`: an `unresolved` row confirmed by admin A then admin B (different users) → verified; the same admin twice → refused (`check_violation`).
10. `member_reads_rows`: an active member reads the row for a published charge; a deactivated user reads none.
11. `anon_no_execute`: `has_function_privilege('anon', 'tariffs.subject_verified(text,uuid)', 'EXECUTE')` is false.

Run red: `scripts/db/dry-run-migration.sh <noop.sql> scripts/db/assert-tariff-source-verification.sql` → the file aborts (table missing). Expected: FAIL.

- [ ] **Step 2: Write the migration**

```sql
-- NNNNN_tariff_source_verification.sql — every published value proven against its source file.
-- Spec: docs/superpowers/specs/2026-10-06-tariff-source-verification-design.md (project 1, Phase A).
-- No gate in this migration: rows are recorded and read; gates come in Phase B.

CREATE TABLE IF NOT EXISTS tariffs.source_verification (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_kind          TEXT NOT NULL CHECK (subject_kind IN ('charge', 'tariff', 'tou_window', 'holiday_treatment')),
    subject_id            TEXT NOT NULL CHECK (btrim(subject_id) <> ''),
    source_document_id    UUID REFERENCES tariffs.source_document(id),
    source_sha256         TEXT CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
    outcome               TEXT NOT NULL CHECK (outcome IN ('match', 'mismatch', 'not_found', 'unresolved')),
    evidence              JSONB NOT NULL DEFAULT '{}'::jsonb,
    subject_fingerprint   TEXT,
    checker_version       TEXT NOT NULL CHECK (btrim(checker_version) <> ''),
    checked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_by          UUID REFERENCES auth.users(id),
    confirmed_at          TIMESTAMPTZ,
    second_confirmed_by   UUID REFERENCES auth.users(id),
    second_confirmed_at   TIMESTAMPTZ,
    CONSTRAINT source_verification_two_people CHECK (second_confirmed_by IS NULL OR (confirmed_by IS NOT NULL AND second_confirmed_by <> confirmed_by))
);
CREATE INDEX IF NOT EXISTS source_verification_subject_idx ON tariffs.source_verification (subject_kind, subject_id, checked_at DESC);

-- What a value IS for verification purposes. Any change to these fields makes an old result stale.
CREATE OR REPLACE FUNCTION tariffs.charge_fingerprint(p_charge_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT md5(concat_ws('|', c.amount_excl_vat::text, c.unit, c.component, c.season, c.tou, c.day_type,
                         coalesce(c.block_min_kwh::text, ''), coalesce(c.block_max_kwh::text, ''),
                         coalesce(c.source_document_id::text, ''), c.source_locator::text))
      FROM tariffs.charge c WHERE c.id = p_charge_id;
$$;

CREATE OR REPLACE FUNCTION tariffs.tariff_fingerprint(p_tariff_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT md5(concat_ws('|', t.name, coalesce(t.code, ''), t.source_locator::text)) FROM tariffs.tariff t WHERE t.id = p_tariff_id;
$$;

CREATE OR REPLACE FUNCTION tariffs.subject_fingerprint(p_kind TEXT, p_id TEXT)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT CASE p_kind
        WHEN 'charge' THEN tariffs.charge_fingerprint(p_id::uuid)
        WHEN 'tariff' THEN tariffs.tariff_fingerprint(p_id::uuid)
        WHEN 'tou_window' THEN (SELECT md5(concat_ws('|', w.season, w.day_type, w.start_minute, w.end_minute, w.period)) FROM tariffs.tou_window w WHERE w.id = p_id::uuid)
        WHEN 'holiday_treatment' THEN (SELECT md5(concat_ws('|', h.calendar_id, h.tariff_family, h.holiday_date, h.holiday_name, h.treated_as))
                                         FROM tariffs.holiday_treatment h
                                        WHERE concat_ws('|', h.calendar_id, h.tariff_family, h.holiday_date) = p_id)
    END;
$$;

-- The database, not the caller, stamps time and fingerprint.
CREATE OR REPLACE FUNCTION tariffs.source_verification_bind()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.checked_at := now();
        NEW.subject_fingerprint := tariffs.subject_fingerprint(NEW.subject_kind, NEW.subject_id);
        NEW.confirmed_by := NULL; NEW.confirmed_at := NULL; NEW.second_confirmed_by := NULL; NEW.second_confirmed_at := NULL;
        RETURN NEW;
    END IF;
    -- UPDATE: only the two confirmation stamps may change, only on an unresolved row, once each.
    IF NEW.id <> OLD.id OR NEW.subject_kind <> OLD.subject_kind OR NEW.subject_id <> OLD.subject_id
       OR NEW.outcome <> OLD.outcome OR NEW.evidence <> OLD.evidence OR NEW.checked_at <> OLD.checked_at
       OR NEW.subject_fingerprint IS DISTINCT FROM OLD.subject_fingerprint OR OLD.outcome <> 'unresolved'
       OR (OLD.confirmed_by IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by)
       OR (OLD.second_confirmed_by IS NOT NULL AND NEW.second_confirmed_by IS DISTINCT FROM OLD.second_confirmed_by) THEN
        RAISE EXCEPTION 'tariffs.source_verification %: a result is immutable; only two confirmations of an unresolved result may be added', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER source_verification_bind BEFORE INSERT OR UPDATE ON tariffs.source_verification
    FOR EACH ROW EXECUTE FUNCTION tariffs.source_verification_bind();

CREATE OR REPLACE FUNCTION tariffs.subject_verified(p_kind TEXT, p_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT coalesce((
        SELECT (v.outcome = 'match' OR (v.outcome = 'unresolved' AND v.second_confirmed_by IS NOT NULL))
               AND v.subject_fingerprint IS NOT DISTINCT FROM tariffs.subject_fingerprint(p_kind, p_id)
          FROM tariffs.source_verification v
         WHERE v.subject_kind = p_kind AND v.subject_id = p_id
         ORDER BY v.checked_at DESC, v.id DESC LIMIT 1), false);
$$;

CREATE OR REPLACE FUNCTION tariffs.unverified_charges(p_tariff_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT c.id FROM tariffs.charge c WHERE c.tariff_id = p_tariff_id AND NOT tariffs.subject_verified('charge', c.id::text);
$$;

-- Two different platform tariff admins confirm an unresolved result against the page image.
CREATE OR REPLACE FUNCTION tariffs.confirm_source_verification(p_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v tariffs.source_verification;
BEGIN
    IF NOT public.is_platform_tariff_admin() THEN
        RAISE EXCEPTION 'confirming a source check needs a platform tariff admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v FROM tariffs.source_verification WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v.outcome <> 'unresolved' THEN
        RAISE EXCEPTION 'only an unresolved result can be confirmed' USING ERRCODE = 'check_violation';
    END IF;
    IF v.confirmed_by IS NULL THEN
        UPDATE tariffs.source_verification SET confirmed_by = auth.uid(), confirmed_at = now() WHERE id = p_id;
        RETURN 'first';
    END IF;
    IF v.confirmed_by = auth.uid() THEN
        RAISE EXCEPTION 'the second confirmation must come from a different person' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE tariffs.source_verification SET second_confirmed_by = auth.uid(), second_confirmed_at = now() WHERE id = p_id;
    RETURN 'second';
END $$;

ALTER TABLE tariffs.source_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.source_verification FORCE ROW LEVEL SECURITY;
REVOKE ALL ON tariffs.source_verification FROM PUBLIC, anon, authenticated;
GRANT SELECT ON tariffs.source_verification TO authenticated;
GRANT ALL ON tariffs.source_verification TO service_role;
CREATE POLICY source_verification_select ON tariffs.source_verification FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));

REVOKE ALL ON FUNCTION tariffs.charge_fingerprint(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tariffs.tariff_fingerprint(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tariffs.subject_fingerprint(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tariffs.subject_verified(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tariffs.unverified_charges(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tariffs.confirm_source_verification(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION tariffs.source_verification_bind() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tariffs.subject_verified(TEXT, TEXT), tariffs.unverified_charges(UUID),
    tariffs.charge_fingerprint(UUID), tariffs.tariff_fingerprint(UUID), tariffs.subject_fingerprint(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tariffs.confirm_source_verification(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- table: tariffs.source_verification
-- trigger: source_verification_bind ON tariffs.source_verification
-- function: tariffs.subject_verified(text, text)
-- function: tariffs.unverified_charges(uuid)
-- function: tariffs.confirm_source_verification(uuid)
-- policy: source_verification_select ON tariffs.source_verification PERMISSIVE
-- grant_absent: anon EXECUTE ON tariffs.subject_verified(text, text)
-- grant_absent: authenticated INSERT ON tariffs.source_verification
-- sql: (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'tariffs.source_verification'::regclass)
-- behaviour: scripts/db/assert-tariff-source-verification.sql, every row ok
-- @verify:end
```

Parse the block before dry-running: `pnpm --filter @esite/shared exec vitest run src/lib/migrations`.

- [ ] **Step 3: Dry-run green**

```bash
scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/NNNNN_tariff_source_verification.sql scripts/db/assert-tariff-source-verification.sql
```

Expected: every row ✓. Then evaluate every earlier `@verify` block ≥ 00185 that touches `tariffs` under the new state (00210, 00214, 00228, 00241): extract their `sql:` predicates into one file and dry-run it with this migration (the 00206 lesson). Expected: all ✓.

- [ ] **Step 4: Mutation proof:** remove the `second_confirmed_by <> confirmed_by` CHECK and the function's same-person branch in a scratch copy → assertion 9 red; drop the fingerprint comparison in `subject_verified` → assertion 6 red. Record both in the PR body.

- [ ] **Step 5: Run `pnpm --filter @esite/db test:ci` and `pnpm --filter @esite/shared exec vitest run src/lib/migrations`.** Expected PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/NNNNN_tariff_source_verification.sql scripts/db/assert-tariff-source-verification.sql
git commit -m "feat(tariffs): source_verification — results, fingerprints, two-person confirmation (migration NNNNN)"
```

### Task 8: The verifier script

**Files:**
- Create: `packages/shared/src/tariffs/verify/run-subject.ts` (pure: decide which reader to call from a locator)
- Test: `packages/shared/src/tariffs/verify/run-subject.test.ts`
- Create: `scripts/tariffs/verify.ts`

- [ ] **Step 1: Failing test for the dispatcher**

```ts
// @vitest-environment node
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { verifyChargeAgainstSource } from './run-subject'

describe('verifyChargeAgainstSource', () => {
  it('a workbook locator goes to the cell reader, including the VAT-inclusive cell', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Megaflex NLA')
    ws.getCell('J8').value = 739.28
    ws.getCell('K8').value = 850.17
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
    const ok = await verifyChargeAgainstSource(bytes, { sheet: 'Megaflex NLA', cell: 'J8', col: 'J', row: 8, raw_incl: 850.17 }, 739.28)
    expect(ok.outcome).toBe('match')
    const badIncl = await verifyChargeAgainstSource(bytes, { sheet: 'Megaflex NLA', cell: 'J8', col: 'J', row: 8, raw_incl: 850.18 }, 739.28)
    expect(badIncl.outcome).toBe('mismatch')
  })
  it('a locator with neither cell nor page is not_found', async () => {
    expect((await verifyChargeAgainstSource(new Uint8Array(), {}, 1)).outcome).toBe('not_found')
  })
})
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement**

```ts
import { verifyPdfCharge } from './pdf-charge'
import type { VerifyResult } from './types'
import { verifyWorkbookCell } from './workbook-cell'

export interface Locator { sheet?: string; cell?: string; col?: string; row?: number; page?: number; line?: number; label?: string; raw_incl?: number }

const nextCol = (col: string) => {
  let n = 0
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64)
  n += 1
  let s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

export async function verifyChargeAgainstSource(bytes: Uint8Array, loc: Locator, amountExclVat: number): Promise<VerifyResult> {
  if (loc.sheet && loc.cell) {
    const r = await verifyWorkbookCell(bytes, { sheet: loc.sheet, cell: loc.cell }, amountExclVat)
    if (r.outcome !== 'match' || typeof loc.raw_incl !== 'number' || !loc.col || !loc.row) return r
    // Eskom prints the VAT-inclusive figure in the next column; it must match too.
    const incl = await verifyWorkbookCell(bytes, { sheet: loc.sheet, cell: `${nextCol(loc.col)}${loc.row}` }, loc.raw_incl)
    return incl.outcome === 'match' ? { outcome: 'match', evidence: { ...r.evidence, at: { ...r.evidence.at, incl: incl.evidence } } }
      : { outcome: 'mismatch', evidence: { read: incl.evidence.read, at: { ...incl.evidence.at, excl: r.evidence }, note: 'VAT-inclusive cell differs' } }
  }
  if (typeof loc.page === 'number' && loc.label) return verifyPdfCharge(bytes, { page: loc.page, label: loc.label }, amountExclVat)
  return { outcome: 'not_found', evidence: { read: null, at: { ...loc }, note: 'locator has neither a cell nor a page' } }
}
```

Add `export * from './run-subject'` to `verify/index.ts`.

- [ ] **Step 4: PASS. Step 5: Write `scripts/tariffs/verify.ts`**

```ts
/**
 * Verify tariff values against their source files. Writes one row per subject
 * to tariffs.source_verification through the service role. Reads only.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/verify.ts (--all-published | --year <uuid> | --stale) [--dry-run]
 */
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { verifyChargeAgainstSource } from '../../packages/shared/src/tariffs/verify/run-subject.ts'

const CHECKER_VERSION = 'verify-1'
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(2) }
const db = createClient(url, key, { auth: { persistSession: false } })
const t = db.schema('tariffs')

type Row = Record<string, any>

async function yearIds(): Promise<string[]> {
  const i = args.indexOf('--year')
  if (i >= 0) return [args[i + 1]]
  const { data, error } = await t.from('tariff_year').select('id').in('state', ['published', 'superseded'])
  if (error) throw error
  return (data ?? []).map((r: Row) => r.id)
}

const files = new Map<string, Promise<Uint8Array>>()
function source(docId: string): Promise<Uint8Array> {
  let p = files.get(docId)
  if (!p) {
    p = (async () => {
      const { data: doc, error } = await t.from('source_document').select('storage_path, sha256').eq('id', docId).single()
      if (error || !doc?.storage_path) throw new Error(`source ${docId}: no stored file`)
      const { data, error: de } = await db.storage.from('tariff-sources').download(doc.storage_path)
      if (de || !data) throw new Error(`source ${docId}: download failed`)
      const bytes = new Uint8Array(await data.arrayBuffer())
      const sha = createHash('sha256').update(bytes).digest('hex')
      if (sha !== doc.sha256) throw new Error(`source ${docId}: sha256 differs from the library (${sha})`)
      return bytes
    })()
    files.set(docId, p)
  }
  return p
}

async function main() {
  const tally: Record<string, number> = {}
  for (const yearId of await yearIds()) {
    const { data: tariffs } = await t.from('tariff').select('id').eq('tariff_year_id', yearId)
    const ids = (tariffs ?? []).map((r: Row) => r.id)
    for (let i = 0; i < ids.length; i += 100) {
      const { data: charges, error } = await t.from('charge').select('id, amount_excl_vat, source_document_id, source_locator').in('tariff_id', ids.slice(i, i + 100))
      if (error) throw error
      const rows: Row[] = []
      for (const c of charges ?? []) {
        let outcome = 'not_found'
        let evidence: unknown = { note: 'no source document' }
        let sha: string | null = null
        if (c.source_document_id) {
          try {
            const bytes = await source(c.source_document_id)
            sha = createHash('sha256').update(bytes).digest('hex')
            const r = await verifyChargeAgainstSource(bytes, c.source_locator ?? {}, Number(c.amount_excl_vat))
            outcome = r.outcome; evidence = r.evidence
          } catch (e) { outcome = 'unresolved'; evidence = { note: (e as Error).message } }
        }
        tally[outcome] = (tally[outcome] ?? 0) + 1
        rows.push({ subject_kind: 'charge', subject_id: c.id, source_document_id: c.source_document_id, source_sha256: sha, outcome, evidence, checker_version: CHECKER_VERSION })
      }
      if (!dry && rows.length) {
        const { error: ie } = await t.from('source_verification').insert(rows)
        if (ie) throw ie
      }
    }
  }
  console.log(JSON.stringify({ checker: CHECKER_VERSION, dry, tally }))
}

main().catch((e) => { console.error(e); process.exit(1) })
```

(Tariff identity: Task 8b. Eskom calendar rows: Task 8c. `--stale`: Task 13.)

- [ ] **Step 6: Dry-run against production (writes nothing):**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/worktrees/tariff-source-verification"
NEXT_PUBLIC_SUPABASE_URL=https://cbskbnvvgcybmfikxgky.supabase.co SUPABASE_SERVICE_ROLE_KEY=<from .secrets/supabase.md> \
  pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/verify.ts --all-published --dry-run
```

Expected: one JSON line with a tally. Every Eskom workbook value in the 2026-10-05 hand check must be in `match`; if not, stop and investigate the reader before going further.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/tariffs/verify/run-subject.ts packages/shared/src/tariffs/verify/run-subject.test.ts packages/shared/src/tariffs/verify/index.ts scripts/tariffs/verify.ts
git commit -m "feat(tariffs/verify): verifier script — re-read each source by sha256, record results"
```

### Task 8b: Tariff identity — the name or code the source prints

Live shapes (2026-10-06): province workbooks cite a cell (565 published tariffs; some stored names are cut short, e.g. `(ii) Prepayment Meter Tariff for residential/domestic custo`); Eskom cites sheet + row with no cell (98; the stored name `> 1 MVA (Me01N)` is composed by the parser and printed nowhere); NERSA decisions cite page + line (208; some names carry stray characters, e.g. `. Commercial Prepaid (1 - 60A)`). Under the owner's rule a name must equal what the source prints, so the comparison is exact (whitespace runs collapsed, nothing else): a cut-short or altered name is a `mismatch` and is hidden until project 2 stores the printed text. Eskom tariffs are identified by the printed family and bill code on the cited row.

**Files:**
- Create: `packages/shared/src/tariffs/verify/tariff-identity.ts` (+ `tariff-identity.test.ts`)
- Modify: `packages/shared/src/tariffs/verify/index.ts`, `scripts/tariffs/verify.ts`

- [ ] **Step 1: Failing tests**

```ts
// @vitest-environment node
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { verifyTariffIdentity } from './tariff-identity'

async function wb(): Promise<Uint8Array> {
  const b = new ExcelJS.Workbook()
  const nc = b.addWorksheet('NEWCASTLE')
  nc.getCell('A19').value = '(ii) Prepayment Meter Tariff for residential/domestic customers'
  const me = b.addWorksheet('Megaflex NLA')
  me.getCell('A8').value = 'Megaflex'; me.getCell('E8').value = 'Me01N'
  return new Uint8Array(await b.xlsx.writeBuffer())
}
async function pdf(rows: Array<[string, number]>): Promise<Uint8Array> {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const p = d.addPage([600, 800])
  for (const [s, y] of rows) p.drawText(s, { x: 40, y, size: 9, font: f })
  return d.save()
}

describe('verifyTariffIdentity', () => {
  it('a workbook name equal to the cited cell matches', async () => {
    const r = await verifyTariffIdentity(await wb(), { sheet: 'NEWCASTLE', cell: 'A19' }, { name: '(ii) Prepayment Meter Tariff for residential/domestic customers', code: null, family: null })
    expect(r.outcome).toBe('match')
  })
  it('a stored name cut short is a mismatch that says so', async () => {
    const r = await verifyTariffIdentity(await wb(), { sheet: 'NEWCASTLE', cell: 'A19' }, { name: '(ii) Prepayment Meter Tariff for residential/domestic custo', code: null, family: null })
    expect(r.outcome).toBe('mismatch')
    expect(r.evidence.note).toMatch(/shorter than the printed text/)
  })
  it('an Eskom row is identified by its printed family and bill code', async () => {
    expect((await verifyTariffIdentity(await wb(), { sheet: 'Megaflex NLA', row: 8 }, { name: '> 1 MVA (Me01N)', code: 'Me01N', family: 'Megaflex' })).outcome).toBe('match')
    expect((await verifyTariffIdentity(await wb(), { sheet: 'Megaflex NLA', row: 8 }, { name: 'x', code: 'Me02N', family: 'Megaflex' })).outcome).toBe('mismatch')
  })
  it('a decision-page heading equal to the stored name matches; a stray prefix does not', async () => {
    const bytes = await pdf([['1. Commercial Prepaid (1 - 60A)', 700]])
    expect((await verifyTariffIdentity(bytes, { page: 1 }, { name: '1. Commercial Prepaid (1 - 60A)', code: null, family: null })).outcome).toBe('match')
    expect((await verifyTariffIdentity(bytes, { page: 1 }, { name: '. Commercial Prepaid (1 - 60A)', code: null, family: null })).outcome).toBe('mismatch')
  })
  it('a name found only in a contents line (dot leaders and a page number) is a mismatch', async () => {
    const bytes = await pdf([['CONCLUSION.......................................... 27', 700]])
    const r = await verifyTariffIdentity(bytes, { page: 1 }, { name: 'CONCLUSION.......................................... 27', code: null, family: null })
    expect(r.outcome).toBe('mismatch')
    expect(r.evidence.note).toMatch(/contents line/)
  })
})
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement**

```ts
/** A tariff's identity as the source prints it. Exact after collapsing whitespace. */
import ExcelJS from 'exceljs'
import { pageRows } from './pdf-page-items'
import type { VerifyResult } from './types'

export interface IdentityRef { sheet?: string; cell?: string; row?: number; page?: number }
export interface Identity { name: string; code: string | null; family: string | null }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const CONTENTS_LINE = /\.{5,}\s*\d+\s*$/

async function sheetOf(bytes: Uint8Array, name: string) {
  const b = new ExcelJS.Workbook()
  await b.xlsx.load(bytes as unknown as ArrayBuffer)
  return b.worksheets.find((w) => w.name === name) ?? null
}
const text = (v: ExcelJS.CellValue): string => (v === null || v === undefined ? '' : typeof v === 'object' && 'richText' in v
  ? (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('') : typeof v === 'object' && 'result' in v ? String((v as { result?: unknown }).result ?? '') : String(v))

export async function verifyTariffIdentity(bytes: Uint8Array, ref: IdentityRef, id: Identity): Promise<VerifyResult> {
  if (ref.sheet) {
    const ws = await sheetOf(bytes, ref.sheet)
    if (!ws) return { outcome: 'not_found', evidence: { read: null, at: { ...ref }, note: 'sheet not in workbook' } }
    if (ref.cell) {
      const read = squash(text(ws.getCell(ref.cell).value))
      const want = squash(id.name)
      if (read === want) return { outcome: 'match', evidence: { read, at: { ...ref } } }
      return { outcome: read ? 'mismatch' : 'not_found', evidence: { read, at: { ...ref }, note: read.startsWith(want) ? 'stored name is shorter than the printed text' : 'stored name differs from the printed text' } }
    }
    if (typeof ref.row === 'number' && id.code) {
      const cells = (ws.getRow(ref.row).values as ExcelJS.CellValue[]).map((v) => squash(text(v)))
      const ok = cells.includes(id.code) && (!id.family || cells.includes(id.family))
      return { outcome: ok ? 'match' : 'mismatch', evidence: { read: cells.filter(Boolean).join(' | '), at: { ...ref }, note: ok ? undefined : 'bill code or family not printed on the cited row' } }
    }
    return { outcome: 'not_found', evidence: { read: null, at: { ...ref }, note: 'no cell, and no row with a bill code' } }
  }
  if (typeof ref.page === 'number') {
    const rows = await pageRows(bytes, ref.page)
    if (rows.length === 0) return { outcome: 'unresolved', evidence: { read: null, at: { ...ref }, note: 'no text on the page (image or missing page)' } }
    const want = squash(id.name)
    const hit = rows.find((r) => squash(r.text) === want || r.items.some((i) => squash(i.str) === want))
    if (hit && CONTENTS_LINE.test(squash(hit.text))) return { outcome: 'mismatch', evidence: { read: hit.text, at: { ...ref }, note: 'the name is a contents line, not a tariff heading' } }
    if (hit) return { outcome: 'match', evidence: { read: hit.text, at: { ...ref } } }
    const near = rows.find((r) => squash(r.text).includes(want.replace(/^[.\s]+/, '')))
    return { outcome: 'mismatch', evidence: { read: near?.text ?? null, at: { ...ref }, note: near ? 'stored name differs from the printed heading' : 'name not on the page' } }
  }
  return { outcome: 'not_found', evidence: { read: null, at: { ...ref }, note: 'no sheet or page cited' } }
}
```

- [ ] **Step 4: PASS. Step 5:** in `scripts/tariffs/verify.ts`, for each tariff of the year (`select id, name, code, family, source_locator`), find its source document as the year's `source_document_id` (or the first charge's), run `verifyTariffIdentity`, insert a `subject_kind: 'tariff'` row. **Step 6: Commit** `feat(tariffs/verify): tariff identity exactly as printed`.

### Task 8c: Eskom calendar rows — recorded for two-person confirmation

The hours are drawn as coloured wheels (schedule p56) and the holiday table's exact text layout on p12 has not been read into a tested fixture yet, so no machine reading is presented as proof (spec §3). The verifier records each row `unresolved` with the page to look at; two different tariff admins confirm against the rendered page.

**Files:** Modify `scripts/tariffs/verify.ts`; modify `VerificationPanel.tsx` (Task 9) to offer **Confirm all rows of this table against page N** — one click confirms every listed row for that person; the second person repeats it.

- [ ] **Step 1:** In `verify.ts`, add `--calendars`: for each Eskom `tou_calendar`, insert one `unresolved` row per `tou_window` (`subject_id` = window id, evidence `{ at: { page: 56, figure: 2, season, day_type, start, end, period }, note: 'confirm against the page image' }`) and one per `holiday_treatment` row (`subject_id` = `calendar_id|tariff_family|holiday_date`, evidence `{ at: { page: 12, date, name, treated_as } }`). Skip a subject whose latest row is already confirmed by two people with a current fingerprint.
- [ ] **Step 2:** Batch confirm in the action: `confirmVerificationsAction({ ids: string[] })` loops `confirm_source_verification` and reports how many moved to first / second. Test: a different-person refusal on any id stops and reports which.
- [ ] **Step 3: Commit** `feat(tariffs/verify): Eskom hours and holidays recorded for two-person confirmation`.

### Task 9: Admin evidence, confirmation, PR A, apply, first run

**Files:**
- Create: `apps/web/src/actions/tariff-verification.actions.ts`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/VerificationPanel.tsx` (+ test)
- Modify: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/page.tsx` (render the panel)
- Modify: `apps/web/src/app/(admin)/admin/tariffs/cycle/page.tsx` (verified / mismatch / unresolved counts)
- Modify: `docs/rbac-matrix.md` (new action row)

- [ ] **Step 1: Action test then action**

```ts
// tariff-verification.actions.ts
'use server'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function confirmVerificationAction(input: { verificationId: string }): Promise<{ ok: true; step: 'first' | 'second' } | { error: string }> {
  const g = await requirePlatformTariffAdmin()
  if (!g.ok) return { error: g.error }
  if (!UUID.test(input.verificationId)) return { error: 'That check is not available.' }
  const { data, error } = await g.supabase.schema('tariffs').rpc('confirm_source_verification', { p_id: input.verificationId })
  if (error) {
    console.error('[tariff-verify] confirm failed', { code: error.code })
    return { error: error.code === '23514' ? 'The second confirmation must come from a different person.' : 'Could not record the confirmation. Try again.' }
  }
  return { ok: true, step: data === 'second' ? 'second' : 'first' }
}
```

Test (vitest, mock `requirePlatformTariffAdmin` returning a fake client whose `rpc` resolves `{ data: 'first' }`, then `{ error: { code: '23514' } }`): asserts `{ ok: true, step: 'first' }`, then the different-person sentence; non-admin returns the gate error without calling `rpc`.

- [ ] **Step 2: VerificationPanel** — a server-rendered list of the year's charges whose latest result is not `match`, each showing: our value + unit, the source label, the outcome in words ("Does not match the source", "Not found at the cited place", "Needs two people to confirm against the page"), `evidence.read` verbatim, the cited sheet/cell or page, and *View source* (reuse `getTariffSourceUrlAdminAction`). For `unresolved`: a *Confirm against the page* button calling `confirmVerificationAction`; shows "Confirmed by 1 of 2" after the first. Test: render with three rows (mismatch, not_found, unresolved) and assert each sentence and that only the unresolved row has the button.

- [ ] **Step 3: Cycle page** — add per regime: "Verified against source: N of M published charges · X mismatches · Y need confirmation", from one query over `source_verification` latest rows (a SQL view is not needed; group in TS).

- [ ] **Step 4: Suites, build, PR A**

```bash
pnpm --filter @esite/shared test && pnpm --filter web test && pnpm --filter @esite/db test:ci
pnpm --filter web exec tsc --noEmit && pnpm --filter web lint
cd apps/web && NEXT_TELEMETRY_DISABLED=1 npx next build
```

Expected: all green. Open PR A **ready, not draft**, titled "feat(tariffs): prove published values against their source files (Phase A, migration NNNNN)", body listing the dry-run tally from Task 8 Step 6 and the two mutation proofs.

- [ ] **Step 5: Merge after CI green; renumber `NNNNN` above the ledger head at merge time (re-check ledger, main, open PRs immediately before `gh pr merge`, in a separate command); confirm the deploy applied it by reading `to_regclass('tariffs.source_verification')` back.**

- [ ] **Step 6: First real run (writes results):**

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/verify.ts --all-published
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/verify.ts --calendars
```

Record the tally and a breakdown by licensee and parser in `docs/tariffs/verification-run-2026-10.md` and in the vault. **Stop here and report to the owner** — Phase B starts only after this report is read.

---

## PHASE B (separate PR; after the Phase A report)

### Task 10: Publish gate

**Files:**
- Create: `apps/edge-functions/supabase/migrations/NNNNN_tariff_verification_gates.sql` (shared with Tasks 11–12)
- Modify: `scripts/db/assert-tariff-source-verification.sql` (add gate assertions)

- [ ] **Step 1: Failing assertions:** an `in_review` year with one charge lacking a `match` → `UPDATE … SET state='published'` (as a signed-in admin with all other publish conditions met) raises `check_violation` with "not verified against its source"; after inserting `match` rows for every charge and tariff → the publish succeeds.

- [ ] **Step 2: Migration section**

```sql
CREATE OR REPLACE FUNCTION tariffs.tariff_year_verified_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_n INT;
BEGIN
    IF NEW.state = 'published' AND OLD.state = 'in_review' THEN
        SELECT count(*) INTO v_n FROM tariffs.charge c JOIN tariffs.tariff t ON t.id = c.tariff_id
         WHERE t.tariff_year_id = NEW.id AND NOT tariffs.subject_verified('charge', c.id::text);
        IF v_n > 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: % charge(s) not verified against their source', NEW.id, v_n USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_n FROM tariffs.tariff t
         WHERE t.tariff_year_id = NEW.id AND NOT tariffs.subject_verified('tariff', t.id::text);
        IF v_n > 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: % tariff name(s) not verified against their source', NEW.id, v_n USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tariffs.tariff_year_verified_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tariff_year_verified_guard BEFORE UPDATE OF state ON tariffs.tariff_year
    FOR EACH ROW EXECUTE FUNCTION tariffs.tariff_year_verified_guard();
```

- [ ] **Step 3: Dry-run green, mutation (drop the trigger → gate assertion red), commit.**

### Task 11: Verified-only explorer

**Files:**
- Modify: the Phase B migration (views)
- Modify: `apps/web/src/lib/tariffs/explorer-data.ts`
- Test: `apps/web/src/lib/tariffs/explorer-data.test.ts` (new; fake client)

- [ ] **Step 1: Views (security invoker: the caller's RLS applies)**

```sql
CREATE OR REPLACE VIEW tariffs.verified_tariff WITH (security_invoker = true) AS
SELECT t.* FROM tariffs.tariff t
 WHERE tariffs.subject_verified('tariff', t.id::text)
   AND NOT EXISTS (SELECT 1 FROM tariffs.charge c WHERE c.tariff_id = t.id AND NOT tariffs.subject_verified('charge', c.id::text));
GRANT SELECT ON tariffs.verified_tariff TO authenticated;
```

- [ ] **Step 2: Failing test:** `loadYearTariffList` and `loadTariffDetail` read `verified_tariff` (assert the fake client saw `from('verified_tariff')`), and a tariff absent from the view yields `null` (page 404s) even though `tariff` has it.

- [ ] **Step 3: Replace `from('tariff')` with `from('verified_tariff')` in `loadYearTariffList`, `loadTariffDetail` (both the tariff and the previous-year lookup) and `loadLicenseeIndex`'s live-year logic (a licensee counts as live only with ≥1 verified tariff in a published year). Charges need no change: a verified tariff's charges are all verified.**

- [ ] **Step 4: Licensee page sentence when tariffs are withheld:** "N tariffs of this year are withheld until every value is verified against the source." (a count of library rows, not a tariff number). Test it.

- [ ] **Step 5: Suites, commit.**

### Task 12: Solar refuses unverified charges; placeholders

**Files:**
- Create: `packages/shared/src/solar/tariff/placeholders.ts` (+ test)
- Modify: `apps/web/src/lib/solar/pricing/load-study-pricing.ts`
- Modify: `apps/web/src/lib/solar/cases/tariff.ts` (`TARIFF_REASONS.unverified`)
- Modify: `packages/shared/src/solar/tariff/readiness.ts` (unverified → amber, blocking)
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/OverridePanel.tsx` (placeholder entry + label)
- Modify: Solar report/proposal renderers that print charges (find with `grep -rn "overrideChargeIds\|override" apps/web/src/lib/solar/reports`)

- [ ] **Step 1: Pure rule, failing test first**

```ts
// placeholders.ts
export interface PlaceholderCheckInput {
  /** Library charge ids of the pinned tariff that are not verified. */
  unverifiedChargeIds: readonly string[]
  /** The study's override rows, if any. */
  overrideRows: ReadonlyArray<{ baseChargeId: string | null; editedBy: string | null; reason: string | null }> | null
}
export type PlaceholderCheck = { ok: true; placeholders: string[] } | { ok: false; missing: string[] }

/** Every unverified library charge must be covered by an override row a person confirmed (editedBy + reason). */
export function checkPlaceholders(i: PlaceholderCheckInput): PlaceholderCheck {
  const confirmed = new Set((i.overrideRows ?? []).filter((r) => r.baseChargeId && r.editedBy && r.reason && r.reason.trim()).map((r) => r.baseChargeId as string))
  const missing = i.unverifiedChargeIds.filter((id) => !confirmed.has(id))
  return missing.length ? { ok: false, missing } : { ok: true, placeholders: [...i.unverifiedChargeIds] }
}
```

Tests: no unverified → ok with []; one unverified, no override → `missing` it; override copied but untouched (editedBy null) → still missing; editedBy set but blank reason → missing; editedBy + reason → ok with that id in `placeholders`.

- [ ] **Step 2: Loader:** in `loadStudyPricing`, after the pinned tariff is read, call `svc.schema('tariffs').rpc('unverified_charges', { p_tariff_id })`, run `checkPlaceholders` with the study's override rows (`base_charge_id`, `edited_by`, `reason`), and return `{ ok: false, code: 'unverified', missing }` when not ok. Callers map `unverified` to `TARIFF_REASONS.unverified = 'This tariff has values not yet verified against the NERSA-approved source. Enter a placeholder for each, or choose another tariff.'` Carry `placeholders` into `ResolvedStudyPricing.provenance.placeholderChargeIds` (sorted) so the pricing hash changes when a placeholder does.

- [ ] **Step 3: Tests:** loader returns `unverified` with the missing ids; with confirmed placeholders it prices and provenance lists them; the case-run loader surfaces the reason.

- [ ] **Step 4: UI and outputs:** the Tariff tab lists each unverified charge (source label, document, page/cell) with *Enter placeholder* (opens the override row for that charge, value + reason required); every place an override charge is shown or printed adds "Placeholder entered by <name> on <date> — not verified against the NERSA-approved source" when its `base_charge_id` is in `placeholderChargeIds`. When a placeholder's base charge later verifies, show "The verified source value is now available" with *Use verified value* (deletes that override row). Tests for each.

- [ ] **Step 5: Readiness:** `tariffReadiness` gains `unverifiedMissing: number`; >0 → `{ status: 'amber', reason: 'N tariff values are not verified against the source: enter placeholders or choose another tariff' }`. Test.

- [ ] **Step 6: Suites, commit.**

### Task 13: Re-verification schedule

**Files:**
- Create: `.github/workflows/tariff-verify.yml` (push over SSH: `git push git@github.com:WattMatt/e-site.git <branch>`; the HTTPS token lacks `workflow` scope)
- Modify: `scripts/tariffs/ingest.ts` and `ingest-worker.ts` — after a successful `--apply`, run the verifier for the new year (spawn `verify.ts --year <id>`)

```yaml
name: Tariff source verification
on:
  schedule: [{ cron: '0 3 * * 1' }]
  workflow_dispatch: {}
concurrency: { group: tariff-verify, cancel-in-progress: false }
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/verify.ts --stale
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

Implement `--stale` in `verify.ts`: subjects whose latest row's fingerprint no longer equals `subject_fingerprint` (one SQL query via `rpc` or a view), plus subjects with no row. Confirm the two secrets exist (`gh secret list`); if not, that is an owner action — stop and report.

### Task 14: PR B, apply order, verification

- [ ] Suites, tsc, lint, build green; dry-run the Phase B migration with every earlier tariffs `@verify` block re-evaluated under it.
- [ ] Open PR B ready; merge **only** when the owner has read the Phase A report and either project 2 has fixed the failures or the owner accepts withdrawing those tariffs from view.
- [ ] After apply: read back the trigger and view; as a non-admin member (impersonated), `SELECT count(*) FROM tariffs.verified_tariff` equals the Phase A run's fully-matched tariff count; a Solar study pinned to a tariff with an unverified charge returns the refusal; vault + CLAUDE.md updated.
