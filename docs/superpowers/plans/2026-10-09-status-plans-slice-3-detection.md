# Status Plans — Slice 3 (300 block detection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a `distribution_schematic` status plan, read the drawing's own text layer, propose one rectangle per 7-row `NO / NAME / AREA / RATING / CABLE / SERIAL / CT` DB block, match each block's tag to a project node, and let a person accept the matched ones in one click, pick a node for the rest, or skip. Accepting writes `tenants.status_plan_shapes` rows with `source = 'detected'` and `detected_tag`.

**Architecture:** Three pure stages in `@esite/shared/status-plans`, each testable without a browser: `text-space.ts` turns pdf.js text items into image space (the scale-2 raster every stored coordinate uses) through the page viewport's transform, so `/Rotate 90` is handled by matrix maths, not special cases; `detect-blocks.ts` walks each `NO:` label down its column and reads values on the same baseline; `match-nodes.ts` + `detect-review.ts` match tags to nodes, exclude blocks that overlap shapes already on the plan, and sort proposals into *matched · need you · without a tag*. The web side adds a thin pdf.js extractor (`lib/status-plans/extract-page-text.ts`), one server action that bulk-inserts accepted blocks (`{ ok, error }`, never a throw), and a `DetectBlocksPanel` client component that slice 2's plan workspace mounts in its side panel.

**Tech Stack:** TypeScript; pdfjs-dist 5.7 (`getTextContent`, `getViewport({ scale: 2 }).transform`); pdf-lib (test fixtures only); React 19 client component; Next.js 15 server action; zod; vitest 2 (shared: node; web: jsdom, `// @vitest-environment node` for the pdf.js test); @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-09-status-plans-design.md` §3.2, §5, §9 (detection on a 0-text page), §10 (detector testing), §11 slice 3.

**Contract consumed:** `docs/superpowers/plans/2026-10-09-status-plans-slice-1-data.md` → "Interfaces for later slices". This plan uses, unchanged: `Box`, `rectToPoints`, `boundingBox`, `pointsError`, `statusPlanShapeFromRow`, `StatusPlanShape`, `StatusPlanShapeRow`, the `@esite/shared/status-plans` subpath export, the `tenants.status_plan_shapes` columns, and the error codes `23514 / 23505 / 23503 / 42501`.

**Out of scope:** hatching accepted blocks by order status (slice 2's canvas + its node-order loader draw that), the rectangle tool itself (slice 2), the PDF renderer (slice 4), any migration (slice 3 needs none).

---

## Dependency on slice 2 (read before Task 10)

Slice 2 (`docs/superpowers/plans/2026-10-09-status-plans-slice-2-tenant-layout.md`) is being planned in parallel and was not on disk when this plan was written. Tasks 1–9 and 11 depend **only on slice 1** and can be built, tested and committed before slice 2 lands. Task 10 (mounting the panel) needs slice 2's page and is written against these assumed integration points; if slice 2 named them differently, adapt the names in Task 10 only — nothing in Tasks 1–9 changes:

| Assumed in slice 2 | Used by this plan as |
|---|---|
| Route `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx` (server) | Loads the extra `detectNodes` prop (Task 10 Step 3) |
| A client workspace component in that folder holding the live shapes array in state and a side panel with a slot for detection on `purpose === 'distribution_schematic'` | Renders `<DetectBlocksPanel …/>` in that slot |
| The page already mints a signed URL for the drawing and knows whether it is a PDF (it needs both for `useSheetImage`) | Passed through as `pdfUrl` / `isPdf` |
| A way to fold new shapes into local state without `router.refresh()` (slice 2's per-shape create action result path) | `onAccepted(shapes)` calls it |
| A viewport "fit to box" (from `useSheetViewport`) — optional | `onFocus(box)`; omit the prop if slice 2 has none |
| A loader for DB order status of any project node | Not used here; accepted shapes get their hatch from it automatically |
| `canEdit` computed from `requireEffectiveRole(…, ORG_WRITE_ROLES)` `.ok` | Passed as `canEdit` |

**Panel contract (JSON props only from the page; the two callbacks come from the client workspace, never from `page.tsx`):**

```ts
interface DetectBlocksPanelProps {
  planId: string
  pageIndex: number                    // 1-based, the plan's page
  pdfUrl: string | null                // signed URL of the drawing file
  isPdf: boolean
  nodes: { id: string; code: string | null; shop_number: string | null; name: string | null; kind: string }[]
  existingShapes: { id: string; points: number[]; nodeId: string | null }[]   // the workspace's LIVE shapes
  canEdit: boolean
  onAccepted: (shapes: StatusPlanShape[]) => void
  onFocus?: (box: Box) => void
}
// server action (apps/web/src/actions/status-plan-detection.actions.ts)
acceptDetectedBlocksAction(planId: string, blocks: { points: number[]; nodeId: string | null; detectedTag: string | null }[])
  : Promise<{ ok: true; shapes: StatusPlanShape[] } | { ok: false; error: string }>
```

---

## Rules this plan follows

1. **No client drawing data in the repo.** The repo is public. Every fixture tag, name, rating, cable and serial below is invented (`DB-71`, `ALPHA STORE`, `ZX-0001` …). The real-sheet run in Task 11 happens outside git and only its **counts** go in the PR body.
2. **Image space is defined once**, by `lib/sheet/use-sheet-image.ts` (`getViewport({ scale: 2 })`). The extractor uses the same scale through one constant and a test pins it.
3. **Server actions return `{ ok, error }`.** Production redacts thrown messages. Constants are not exported from the `'use server'` file (a const export passes tsc/vitest and fails only `next build`).
4. **`requireEffectiveRole` returns an object** — check `.ok`; `if (!gate)` is dead code.
5. **Fixtures that can fail.** The detector's crowded-neighbour, stacked-block and off-column fixtures are each mutation-checked (Task 3 Step 5): the guard they protect is removed and the test must go red.
6. Run all suites before calling it green: `web`, `@esite/shared`, `@esite/db` (Task 12).
7. Worktree hygiene: `pnpm install` in this worktree; `TMPDIR` on the SSD for every test and build.

Shell setup used by every command below:

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans"
export TMPDIR="/Volumes/Extreme SSD/tmp"
```

---

## File structure

**Create**

| Path | Responsibility |
|---|---|
| `packages/shared/src/status-plans/text-space.ts` (+ `.test.ts`) | `composeMatrix`, `textItemsToImageSpace` — pdf.js items → upright runs in image space |
| `packages/shared/src/status-plans/__fixtures__/db-block-layout.ts` | Invented DB-block layouts in image space and in rotated PDF user space |
| `packages/shared/src/status-plans/detect-blocks.ts` (+ `.test.ts`) | `detectBlocks` — label-column walk → `{ tag, name, fields, box, points }` |
| `packages/shared/src/status-plans/match-nodes.ts` (+ `.test.ts`) | `normaliseTag`, `buildNodeIndex`, `matchBlock` |
| `packages/shared/src/status-plans/detect-review.ts` (+ `.test.ts`) | `runDetection`, `reviewDetection`, `detectionSummary`, `detectedTagFor`, `boxesOverlap` |
| `apps/web/src/lib/status-plans/extract-page-text.ts` (+ `.test.ts`) | pdf.js `getTextContent` at scale 2 → `ImageTextItem[]` |
| `apps/web/src/lib/status-plans/detection-errors.ts` (+ `.test.ts`) | Postgres error code → sentence |
| `apps/web/src/actions/status-plan-detection.actions.ts` (+ `.test.ts`) | `acceptDetectedBlocksAction` |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/DetectBlocksPanel.tsx` (+ `.test.tsx`) | Review UI |

**Modify**

| Path | Change |
|---|---|
| `packages/shared/src/status-plans/index.ts` | Export the four new modules |
| `packages/shared/src/status-plans/index.test.ts` | Pin the new public names |
| slice 2's plan page + workspace component (Task 10) | Load `detectNodes`; mount the panel |
| `docs/rbac-matrix.md` | Row for `acceptDetectedBlocksAction` |

---

### Task 0: Preconditions

**Files:** none.

- [ ] **Step 1: Slice 1 is present in this branch**

```bash
ls packages/shared/src/status-plans/
grep -n '"./status-plans"' packages/shared/package.json
grep -n "export function rectToPoints\|export function boundingBox\|export interface Box" packages/shared/src/status-plans/geometry.ts
grep -n "export function pointsError\|export function statusPlanShapeFromRow" packages/shared/src/status-plans/types.ts
```

Expected: `types.ts geometry.ts … index.ts` listed; the export line found; all four symbols found. If any is missing, stop: slice 1 must be merged (or this branch rebased onto it) first.

- [ ] **Step 2: Note slice 2's state (does not block Tasks 1–9)**

```bash
ls "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/" 2>/dev/null || echo "slice 2 not present yet"
ls docs/superpowers/plans/ | grep slice-2 || echo "slice 2 plan not on disk"
```

Expected: either slice 2's files, or the two "not present" lines. In the second case build Tasks 1–9 and 11 now and leave Task 10 until slice 2 is in the branch.

- [ ] **Step 3: Baseline suites green**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans
```

Expected: PASS (slice 1's ≈78 tests). Record the count; Task 12 compares against it.

---

### Task 1: Text items → image space (`text-space.ts`)

**Files:**
- Create: `packages/shared/src/status-plans/text-space.ts`
- Test: `packages/shared/src/status-plans/text-space.test.ts`

pdf.js gives each text item a `transform` in PDF user space. `page.getViewport({ scale: 2 }).transform` maps user space to the raster, including the page's `/Rotate`. Composing the two (pdf.js `Util.transform` order) gives the run's matrix on the raster: `(tx[4], tx[5])` is the baseline origin, `hypot(tx[2], tx[3])` the font height, and an upright left-to-right run has `tx[0] > 0`, `tx[1] ≈ 0`, `tx[3] < 0`. The test helper `pdfViewportTransform` is a line-for-line copy of pdf.js 5.7 `PageViewport`'s transform (`legacy/build/pdf.mjs`, `case 90: rotateA = 0; rotateB = 1; rotateC = 1; rotateD = 0`), so the shared tests check the maths against pdf.js's own formula; Task 7 checks it against pdf.js itself on a generated `/Rotate 90` PDF.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { composeMatrix, textItemsToImageSpace, type Matrix } from './text-space'

/** pdf.js 5.7 PageViewport transform (dontFlip false, no offset), copied for the test. */
export function pdfViewportTransform(
  viewBox: [number, number, number, number],
  rotation: 0 | 90 | 180 | 270,
  scale: number,
): Matrix {
  const cX = (viewBox[2] + viewBox[0]) / 2
  const cY = (viewBox[3] + viewBox[1]) / 2
  let A = 1, B = 0, C = 0, D = -1
  if (rotation === 180) { A = -1; B = 0; C = 0; D = 1 }
  else if (rotation === 90) { A = 0; B = 1; C = 1; D = 0 }
  else if (rotation === 270) { A = 0; B = -1; C = -1; D = 0 }
  let ox: number, oy: number
  if (A === 0) { ox = Math.abs(cY - viewBox[1]) * scale; oy = Math.abs(cX - viewBox[0]) * scale }
  else { ox = Math.abs(cX - viewBox[0]) * scale; oy = Math.abs(cY - viewBox[1]) * scale }
  return [A * scale, B * scale, C * scale, D * scale, ox - A * scale * cX - C * scale * cY, oy - B * scale * cX - D * scale * cY]
}

const PAGE: [number, number, number, number] = [0, 0, 600, 400]

describe('composeMatrix', () => {
  it('applies the right-hand matrix first (pdf.js Util.transform order)', () => {
    const scale2: Matrix = [2, 0, 0, 2, 0, 0]
    const shift: Matrix = [1, 0, 0, 1, 10, 20]
    expect(composeMatrix(scale2, shift)).toEqual([2, 0, 0, 2, 20, 40])
    expect(composeMatrix(shift, scale2)).toEqual([2, 0, 0, 2, 10, 20])
  })
})

describe('textItemsToImageSpace', () => {
  it('upright page: baseline, top, height and width land on the scale-2 raster', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    expect(v).toEqual([2, 0, 0, -2, 0, 800])
    const [run] = textItemsToImageSpace([{ str: 'NO:', transform: [10, 0, 0, 10, 50, 300], width: 18, height: 10 }], v)
    expect(run).toEqual({ str: 'NO:', x: 100, baseline: 200, top: 180, width: 36, height: 20 })
  })

  it('/Rotate 90: a run drawn turned +90° in user space reads upright on the raster', () => {
    const v = pdfViewportTransform(PAGE, 90, 2)
    expect(v).toEqual([0, 2, 2, 0, 0, 0])
    // Same glyph, same place on the raster as the upright case above:
    // raster x = 2 * userY, raster baseline = 2 * userX.
    const [run] = textItemsToImageSpace([{ str: 'NO:', transform: [0, 10, -10, 0, 100, 50], width: 18, height: 10 }], v)
    expect(run).toEqual({ str: 'NO:', x: 100, baseline: 200, top: 180, width: 36, height: 20 })
  })

  it('/Rotate 270 is handled by the same maths', () => {
    const v = pdfViewportTransform(PAGE, 270, 2)
    // Under 270 an upright run is drawn turned -90° in user space.
    const [run] = textItemsToImageSpace([{ str: 'CT:', transform: [0, -10, 10, 0, 100, 350], width: 18, height: 10 }], v)
    expect(run.str).toBe('CT:')
    expect(run.height).toBe(20)
    expect(run.width).toBe(36)
    expect(run.top).toBe(run.baseline - 20)
  })

  it('drops vertical, mirrored and blank runs and non-text items', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    const out = textItemsToImageSpace(
      [
        { str: 'VERTICAL', transform: [0, 10, -10, 0, 50, 50], width: 40, height: 10 },
        { str: 'MIRRORED', transform: [-10, 0, 0, 10, 300, 50], width: 40, height: 10 },
        { str: '   ', transform: [10, 0, 0, 10, 50, 50], width: 5, height: 10 },
        { type: 'beginMarkedContent', id: 'mc0' },
        { str: 'KEEP', transform: [10, 0, 0, 10, 50, 50], width: 20, height: 10 },
      ],
      v,
    )
    expect(out.map((r) => r.str)).toEqual(['KEEP'])
  })

  it('collapses inner whitespace and trims', () => {
    const v = pdfViewportTransform(PAGE, 0, 2)
    const [run] = textItemsToImageSpace([{ str: '  ALPHA   STORE ', transform: [10, 0, 0, 10, 0, 0], width: 60, height: 10 }], v)
    expect(run.str).toBe('ALPHA STORE')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/text-space.test.ts
```

Expected: FAIL with `Failed to resolve import "./text-space"`.

- [ ] **Step 3: Implement**

```ts
/**
 * pdf.js text items → image space (spec §5).
 *
 * Image space is the PDF page rasterised at getViewport({ scale: 2 }), defined
 * in apps/web/src/lib/sheet/use-sheet-image.ts; every status-plan coordinate is
 * stored in it. The caller passes that viewport's `transform`, which already
 * carries the page's /Rotate, so a rotated sheet needs no special case here:
 * the run's raster matrix is viewport ∘ item.
 *
 * Only upright, left-to-right runs are returned. A DB block's labels and
 * values read upright on the sheet as a person sees it; everything else
 * (vertical riser labels, mirrored text) cannot be part of a block.
 */

export type Matrix = readonly [number, number, number, number, number, number]

/** One upright text run on the raster. y grows downwards. */
export interface ImageTextItem {
  str: string
  /** Left edge of the run. */
  x: number
  /** Baseline (pdf.js origin) of the run. */
  baseline: number
  /** baseline − height. */
  top: number
  width: number
  height: number
}

/** m1 ∘ m2: apply m2 first, then m1 (the order of pdf.js Util.transform). */
export function composeMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

/** A run counts as upright when its direction is within ~5° of +x. */
const MAX_SKEW = 0.09

interface RawTextItem { str: string; transform: number[]; width: number }

function isTextItem(v: unknown): v is RawTextItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.str === 'string' &&
    Array.isArray(o.transform) &&
    o.transform.length >= 6 &&
    (o.transform as unknown[]).slice(0, 6).every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof o.width === 'number' &&
    Number.isFinite(o.width)
  )
}

export function textItemsToImageSpace(items: readonly unknown[], viewportTransform: Matrix): ImageTextItem[] {
  const out: ImageTextItem[] = []
  const v = viewportTransform
  for (const raw of items) {
    if (!isTextItem(raw)) continue
    const str = raw.str.replace(/\s+/g, ' ').trim()
    if (!str) continue
    const t = raw.transform
    const tx = composeMatrix(v, [t[0], t[1], t[2], t[3], t[4], t[5]])
    if (!(tx[0] > 0) || Math.abs(tx[1]) > MAX_SKEW * tx[0] || !(tx[3] < 0)) continue
    const height = Math.hypot(tx[2], tx[3])
    // item.width is user-space length along the run; scale it by how much the
    // viewport stretches the run's direction.
    const ul = Math.hypot(t[0], t[1]) || 1
    const ux = t[0] / ul
    const uy = t[1] / ul
    const stretch = Math.hypot(v[0] * ux + v[2] * uy, v[1] * ux + v[3] * uy)
    out.push({ str, x: tx[4], baseline: tx[5], top: tx[5] - height, width: raw.width * stretch, height })
  }
  return out
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/text-space.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation check**

Swap the argument order in the `composeMatrix` call (`composeMatrix([t[0] … t[5]], v)`) and re-run. Expected: the `/Rotate 90` and `/Rotate 270` tests FAIL. Restore, re-run, PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/status-plans/text-space.ts packages/shared/src/status-plans/text-space.test.ts
git commit -m "feat(status-plans): pdf.js text items into image space (rotation via viewport)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Detector core (`detect-blocks.ts`) — one block, empty tag, combined tag, inline label

**Files:**
- Create: `packages/shared/src/status-plans/__fixtures__/db-block-layout.ts`
- Create: `packages/shared/src/status-plans/detect-blocks.ts`
- Test: `packages/shared/src/status-plans/detect-blocks.test.ts`

- [ ] **Step 1: Write the fixture builder (invented values only)**

```ts
/**
 * Invented DB-block layouts for detector tests. NOTHING here comes from a
 * client drawing: the repo is public. Tags, names, ratings, cables and serials
 * are made up and chosen not to resemble any real sheet.
 *
 * Geometry mimics a schematic table: text height H, rows PITCH apart, values
 * in a column VALUE_DX right of the label column's left edge.
 */
import type { ImageTextItem } from '../text-space'

export const H = 10
export const PITCH = 16
export const VALUE_DX = 50
const CHAR_W = 6

export const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'] as const
export type Values = readonly [string, string, string, string, string, string, string]

export const ALPHA: Values = ['DB-71', 'ALPHA STORE', '412.50m2', '250A TP', '4C 95mm2 CU', 'ZX-0001', '250/5A']
export const BRAVO: Values = ['DB-72', 'BRAVO SHOP', '96.00m2', '60A TP', '4C 16mm2 CU', 'ZX-0002', '']
export const CHARLIE: Values = ['DB-90/91', 'CHARLIE HALL', '880.10m2', '400A TP', '4C 185mm2 AL', 'ZX-0003', '400/5A']
export const DELTA_NO_TAG: Values = ['', 'DELTA KIOSK', '12.00m2', '20A SP', '3C 6mm2 CU', '', '']

export function textAt(str: string, x: number, baseline: number, h = H): ImageTextItem {
  return { str, x, baseline, top: baseline - h, width: str.length * CHAR_W * (h / H), height: h }
}

export interface BlockSpec {
  x: number
  /** Baseline of the NO: row. */
  y: number
  values: Values
  h?: number
  /** Leave this row's label out (0 = NO:, 6 = CT:). */
  omitLabel?: number
  /** Move one row's label sideways by dx. */
  shiftLabel?: { row: number; dx: number }
}

export function blockItems(spec: BlockSpec): ImageTextItem[] {
  const h = spec.h ?? H
  const k = h / H
  const out: ImageTextItem[] = []
  LABELS.forEach((label, row) => {
    const baseline = spec.y + row * PITCH * k
    if (spec.omitLabel !== row) {
      const dx = spec.shiftLabel?.row === row ? spec.shiftLabel.dx : 0
      out.push(textAt(label, spec.x + dx, baseline, h))
    }
    const v = spec.values[row]
    if (v) out.push(textAt(v, spec.x + VALUE_DX * k, baseline, h))
  })
  return out
}

/**
 * The same runs as pdf.js would report them on a /Rotate 90 page viewed at
 * scale 2 (viewport transform [0, 2, 2, 0, 0, 0] for a viewBox at the origin):
 * raster x = 2·userY, raster baseline = 2·userX, text drawn turned +90°.
 */
export function toRotated90UserSpace(items: readonly ImageTextItem[]) {
  return items.map((i) => ({
    str: i.str,
    transform: [0, i.height / 2, -i.height / 2, 0, i.baseline / 2, i.x / 2],
    width: i.width / 2,
    height: i.height / 2,
  }))
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { detectBlocks } from './detect-blocks'
import { rectToPoints } from './geometry'
import { ALPHA, CHARLIE, DELTA_NO_TAG, blockItems, textAt } from './__fixtures__/db-block-layout'

describe('detectBlocks — one block', () => {
  it('reads the tag, the name, every field and the block rectangle', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: ALPHA }))
    expect(r.labelCount).toBe(1)
    expect(r.rejected).toEqual([])
    expect(r.blocks).toHaveLength(1)
    const [b] = r.blocks
    expect(b.tag).toBe('DB-71')
    expect(b.name).toBe('ALPHA STORE')
    expect(b.fields).toEqual({
      NO: 'DB-71', NAME: 'ALPHA STORE', AREA: '412.50m2', RATING: '250A TP',
      CABLE: '4C 95mm2 CU', SERIAL: 'ZX-0001', CT: '250/5A',
    })
    // pad = 0.5h = 5: left 100-5; top = NO top (90) - 5; right = widest value (150 + 11*6 = 216) + 5;
    // bottom = CT baseline (196) + 0.25h + 5
    expect(b.box).toEqual({ minX: 95, minY: 85, maxX: 221, maxY: 203.5 })
    expect(b.points).toEqual(rectToPoints(95, 85, 221, 203.5))
  })

  it('proposes a block whose NO: cell is empty, with a null tag and its name kept', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: DELTA_NO_TAG }))
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0].tag).toBeNull()
    expect(r.blocks[0].name).toBe('DELTA KIOSK')
    expect(r.blocks[0].fields.SERIAL).toBeNull()
  })

  it('keeps a combined tag verbatim', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: CHARLIE }))
    expect(r.blocks[0].tag).toBe('DB-90/91')
  })

  it('reads a label and its value printed as one text run ("NO: DB-74")', () => {
    const items = blockItems({ x: 100, y: 100, values: ['', 'ECHO UNIT', '1m2', '10A SP', '2C', 'ZX-9', '-'] })
    const noLabel = items.findIndex((i) => i.str === 'NO:')
    items[noLabel] = textAt('NO: DB-74', 100, 100)
    const r = detectBlocks(items)
    expect(r.blocks[0].tag).toBe('DB-74')
  })

  it('reads a block printed at twice the text height (tolerances scale with the label)', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: ALPHA, h: 20 }))
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0].fields.CT).toBe('250/5A')
  })

  it('finds nothing on a page with no NO: labels', () => {
    const r = detectBlocks([textAt('NOTE: SEE LEGEND', 10, 10), textAt('DB-71', 100, 100)])
    expect(r).toEqual({ labelCount: 0, blocks: [], rejected: [] })
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/detect-blocks.test.ts
```

Expected: FAIL with `Failed to resolve import "./detect-blocks"`.

- [ ] **Step 4: Implement**

```ts
/**
 * DB-block detection on a 300 distribution schematic (spec §5).
 *
 * Input: upright text runs already in image space (text-space.ts).
 * Output: one proposed rectangle per 7-row NO / NAME / AREA / RATING / CABLE /
 * SERIAL / CT table, plus every NO: label that did not start a full table and
 * why (the review panel shows those, so a miss is visible, never silent).
 *
 * Every tolerance is a multiple of the NO: label's own height, so the same
 * rules read an A0 at scale 2 and a reduced print of it.
 *
 * A block is proposed only when all seven labels are found, in order, in one
 * left-aligned column, each row within a table's row gap of the one above.
 * Anything less is REJECTED, never patched: a block missing a row must not
 * borrow the next block's rows. Two independent guards enforce that (the row
 * gap and the expected label), and each has its own test.
 */
import { rectToPoints, type Box } from './geometry'
import type { ImageTextItem } from './text-space'

export const BLOCK_LABELS = ['NO', 'NAME', 'AREA', 'RATING', 'CABLE', 'SERIAL', 'CT'] as const
export type BlockLabel = (typeof BLOCK_LABELS)[number]
export type BlockFields = Record<BlockLabel, string | null>

/** Multiples of the NO: label's height. */
export const DETECT_TOLERANCES = {
  /** Label left edges in one column differ by at most this. */
  column: 0.6,
  /** Baseline-to-baseline gap between consecutive rows: more than … */
  rowGapMin: 0.5,
  /** … and at most this. */
  rowGapMax: 2.5,
  /** A value sits on its label's baseline within this. */
  baseline: 0.35,
  /** A value never starts further right of its label's left edge than this. */
  valueSpan: 25,
  /** Padding round the proposed rectangle. */
  pad: 0.5,
} as const

export interface DetectedBlock {
  /** NO: value (whitespace collapsed), null when the cell is empty. */
  tag: string | null
  /** NAME: value, null when empty. */
  name: string | null
  fields: BlockFields
  box: Box
  /** box as a 4-corner rect (TL, TR, BR, BL) for status_plan_shapes.points. */
  points: number[]
}

export interface RejectedBlock {
  /** Top-left of the NO: label that started the walk. */
  x: number
  y: number
  tag: string | null
  /** A sentence for the review panel. */
  reason: string
}

export interface DetectResult {
  /** NO: labels found on the page. */
  labelCount: number
  blocks: DetectedBlock[]
  rejected: RejectedBlock[]
}

interface Label { item: ImageTextItem; kind: BlockLabel; inline: string }

const LABEL_RE = /^(NO|NAME|AREA|RATING|CABLE|SERIAL|CT)\s*:\s*(.*)$/i

function readLabel(item: ImageTextItem): Label | null {
  const m = LABEL_RE.exec(item.str.trim())
  if (!m) return null
  return { item, kind: m[1].toUpperCase() as BlockLabel, inline: m[2].trim() }
}

function tidy(s: string): string | null {
  const t = s.replace(/\s+/g, ' ').trim()
  return t ? t : null
}

/**
 * The value printed right of a label on its baseline: every non-label run that
 * starts after the label and before the nearest OTHER label to the right on
 * the same baseline (a crowded neighbouring block's column), capped at
 * valueSpan label-heights.
 */
function valueOf(
  label: Label,
  labels: readonly Label[],
  labelItems: ReadonlySet<ImageTextItem>,
  items: readonly ImageTextItem[],
  h: number,
): { text: string | null; right: number } {
  const T = DETECT_TOLERANCES
  const own = label.item
  const tol = T.baseline * h
  let limit = own.x + T.valueSpan * h
  for (const l of labels) {
    if (l === label) continue
    if (Math.abs(l.item.baseline - own.baseline) > tol) continue
    if (l.item.x > own.x + T.column * h && l.item.x < limit) limit = l.item.x
  }
  const start = own.x + own.width - 0.2 * h
  const parts = items
    .filter((i) => !labelItems.has(i) && Math.abs(i.baseline - own.baseline) <= tol && i.x >= start && i.x < limit)
    .sort((a, b) => a.x - b.x)
  const text = tidy([label.inline, ...parts.map((p) => p.str)].join(' '))
  const right = parts.reduce((r, p) => Math.max(r, p.x + p.width), own.x + own.width)
  return { text, right }
}

export function detectBlocks(items: readonly ImageTextItem[]): DetectResult {
  const T = DETECT_TOLERANCES
  const labels: Label[] = []
  const labelItems = new Set<ImageTextItem>()
  for (const it of items) {
    const l = readLabel(it)
    if (l) { labels.push(l); labelItems.add(it) }
  }
  const starts = labels
    .filter((l) => l.kind === 'NO')
    .sort((a, b) => a.item.baseline - b.item.baseline || a.item.x - b.item.x)

  const claimed = new Set<Label>()
  const blocks: DetectedBlock[] = []
  const rejected: RejectedBlock[] = []

  for (const no of starts) {
    if (claimed.has(no)) continue
    const h = no.item.height
    const rows: Label[] = [no]
    let failure: string | null = null

    for (const kind of BLOCK_LABELS.slice(1)) {
      const prev = rows[rows.length - 1]
      let next: Label | null = null
      for (const l of labels) {
        if (claimed.has(l) || rows.includes(l)) continue
        if (Math.abs(l.item.x - no.item.x) > T.column * h) continue
        if (l.item.baseline - prev.item.baseline <= T.rowGapMin * h) continue
        if (!next || l.item.baseline < next.item.baseline) next = l
      }
      if (!next || next.item.baseline - prev.item.baseline > T.rowGapMax * h) {
        failure = `the ${kind}: row was not found under ${prev.kind}:`
        break
      }
      if (next.kind !== kind) {
        failure = `expected ${kind}: under ${prev.kind}: but found ${next.kind}:`
        break
      }
      rows.push(next)
    }

    if (failure) {
      const tag = valueOf(no, labels, labelItems, items, h).text
      rejected.push({ x: no.item.x, y: no.item.top, tag, reason: `${tag ?? 'A block with no tag'}: ${failure}.` })
      continue
    }

    rows.forEach((r) => claimed.add(r))
    const fields = {} as BlockFields
    let right = -Infinity
    for (const r of rows) {
      const v = valueOf(r, labels, labelItems, items, h)
      fields[r.kind] = v.text
      right = Math.max(right, v.right)
    }
    const pad = T.pad * h
    const left = Math.min(...rows.map((r) => r.item.x))
    const last = rows[rows.length - 1].item
    const box: Box = {
      minX: left - pad,
      minY: no.item.top - pad,
      maxX: right + pad,
      maxY: last.baseline + 0.25 * h + pad,
    }
    blocks.push({
      tag: fields.NO,
      name: fields.NAME,
      fields,
      box,
      points: rectToPoints(box.minX, box.minY, box.maxX, box.maxY),
    })
  }

  return { labelCount: starts.length, blocks, rejected }
}
```

- [ ] **Step 5: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/detect-blocks.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/status-plans/__fixtures__/db-block-layout.ts packages/shared/src/status-plans/detect-blocks.ts packages/shared/src/status-plans/detect-blocks.test.ts
git commit -m "feat(status-plans): DB-block detector (label-column walk) with invented fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Detector robustness — crowded neighbours, stacked blocks, off-column labels, rotated page

**Files:**
- Modify: `packages/shared/src/status-plans/detect-blocks.test.ts`

- [ ] **Step 1: Append the robustness tests**

```ts
import { describe as describe2, it as it2, expect as expect2 } from 'vitest'
import { textItemsToImageSpace } from './text-space'
import { BRAVO, PITCH, toRotated90UserSpace } from './__fixtures__/db-block-layout'

const tags = (r: ReturnType<typeof detectBlocks>) => r.blocks.map((b) => b.tag)

describe2('detectBlocks — neighbours never leak into each other', () => {
  it2('a neighbouring block crowded against the value column does not lend its values', () => {
    // ALPHA's values end at x = 216; BRAVO's label column starts at 230 and its
    // values at 280, well inside ALPHA's 25h value window (up to 350).
    const r = detectBlocks([...blockItems({ x: 100, y: 100, values: ALPHA }), ...blockItems({ x: 230, y: 100, values: BRAVO })])
    expect2(tags(r)).toEqual(['DB-71', 'DB-72'])
    expect2(r.blocks[0].name).toBe('ALPHA STORE')
    expect2(r.blocks[0].fields.CT).toBe('250/5A')
    expect2(r.blocks[1].name).toBe('BRAVO SHOP')
    expect2(r.blocks[1].fields.CT).toBeNull()
  })

  it2('two blocks stacked tight in one column are each read whole', () => {
    // CHARLIE's NO: sits one row pitch below ALPHA's CT:.
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: ALPHA }),
      ...blockItems({ x: 100, y: 100 + 7 * PITCH, values: CHARLIE }),
    ])
    expect2(tags(r)).toEqual(['DB-71', 'DB-90/91'])
    expect2(r.blocks[1].fields.NAME).toBe('CHARLIE HALL')
    expect2(Object.values(r.blocks[0].fields).filter((v) => v !== null)).toHaveLength(7)
  })

  it2('text far right on the same baseline is not part of the value', () => {
    const r = detectBlocks([...blockItems({ x: 100, y: 100, values: ALPHA }), textAt('FAR NOTE', 100 + 260, 116)])
    expect2(r.blocks[0].name).toBe('ALPHA STORE')
  })
})

describe2('detectBlocks — a damaged block drops, it never merges', () => {
  it2('MUTATION FIXTURE: a label shifted off its column drops that block only', () => {
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: ALPHA, shiftLabel: { row: 1, dx: 20 } }),
      ...blockItems({ x: 230, y: 100, values: BRAVO }),
      ...blockItems({ x: 100, y: 100 + 7 * PITCH, values: CHARLIE }),
    ])
    expect2(tags(r)).toEqual(['DB-72', 'DB-90/91'])
    expect2(r.blocks.find((b) => b.tag === 'DB-90/91')!.fields.NAME).toBe('CHARLIE HALL')
    expect2(r.labelCount).toBe(3)
    expect2(r.rejected).toHaveLength(1)
    expect2(r.rejected[0].tag).toBe('DB-71')
    expect2(r.rejected[0].reason).toContain('NAME:')
  })

  it2('MUTATION FIXTURE (row gap): a missing CT: never reaches a stray CT: far below', () => {
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: ALPHA, omitLabel: 6 }),
      textAt('CT:', 100, 100 + 5 * PITCH + 60), // a legend entry 6h below SERIAL:
    ])
    expect2(r.blocks).toEqual([])
    expect2(r.rejected[0].reason).toContain('CT:')
  })

  it2('MUTATION FIXTURE (expected label): a missing CT: never takes the next block\'s NO:', () => {
    // CHARLIE's NO: sits exactly where ALPHA's CT: would be (ALPHA's CT value
    // is blanked too, or it would share CHARLIE's NO: baseline and value column).
    const alphaNoCt = [...ALPHA.slice(0, 6), ''] as unknown as typeof ALPHA
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: alphaNoCt, omitLabel: 6 }),
      ...blockItems({ x: 100, y: 100 + 6 * PITCH, values: CHARLIE }),
    ])
    expect2(tags(r)).toEqual(['DB-90/91'])
    expect2(Object.values(r.blocks[0].fields).filter((v) => v !== null)).toHaveLength(7)
  })
})

describe2('detectBlocks — a /Rotate 90 sheet', () => {
  it2('reads the same blocks as the upright layout once items pass through the viewport', () => {
    const upright = [
      ...blockItems({ x: 100, y: 100, values: ALPHA }),
      ...blockItems({ x: 230, y: 100, values: BRAVO }),
      ...blockItems({ x: 100, y: 100 + 7 * PITCH, values: DELTA_NO_TAG }),
    ]
    const viewport90 = [0, 2, 2, 0, 0, 0] as const
    const fromPdf = textItemsToImageSpace(toRotated90UserSpace(upright), viewport90)
    expect2(fromPdf).toEqual(upright)
    expect2(detectBlocks(fromPdf)).toEqual(detectBlocks(upright))
    expect2(tags(detectBlocks(fromPdf))).toEqual(['DB-71', 'DB-72', null])
  })
})
```

(Merge the imports into the file's existing import lines when appending; the aliased `describe2/it2/expect2` are only there so this block reads standalone in the plan — plain `describe/it/expect` is fine.)

- [ ] **Step 2: Run them**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/detect-blocks.test.ts
```

Expected: PASS, 13 tests. If the rotated test's `toEqual(upright)` fails only on floating error, the fixture's halving is not exact for some value: every fixture coordinate is an integer or .5 multiple, so it must be exact — investigate rather than loosen to `toBeCloseTo`.

- [ ] **Step 3: Mutation — column tolerance**

In `detect-blocks.ts` set `column: 5`. Run the file. Expected: `a label shifted off its column drops that block only` FAILS (ALPHA is read whole). Restore `column: 0.6`.

- [ ] **Step 4: Mutation — crowded-neighbour limit**

Comment out the line `if (l.item.x > own.x + T.column * h && l.item.x < limit) limit = l.item.x`. Run. Expected: `a neighbouring block crowded against the value column…` FAILS (`ALPHA STORE BRAVO SHOP`). Restore.

- [ ] **Step 5: Mutation — each merge guard on its own**

(a) Set `rowGapMax: 99`. Run. Expected: `(row gap)` test FAILS; `(expected label)` still passes. Restore.
(b) Delete the `if (next.kind !== kind) { … }` block. Run. Expected: `(expected label)` test FAILS; `(row gap)` still passes. Restore.

Record the four red runs (test name + FAIL) for the PR body. Re-run the file: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/status-plans/detect-blocks.test.ts
git commit -m "test(status-plans): detector neighbours, stacked blocks, off-column drop, rotated sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Matching tags to nodes (`match-nodes.ts`)

**Files:**
- Create: `packages/shared/src/status-plans/match-nodes.ts`
- Test: `packages/shared/src/status-plans/match-nodes.test.ts`

Rules (spec §5, owner brief): normalise = uppercase, strip spaces, hyphens (incl. Unicode dashes) and dots, keep `/` and everything else. Try in order, stopping at the first rule that finds anything: (1) `nodes.code` / `nodes.shop_number`; (2) the tag without a leading `DB`; (3) `MB-x.y` ↔ `MAIN BOARD x.y` (against code/shop_number of any node, and the name of `main_board` nodes only). One candidate → matched; several → the block's NAME may break the tie (exact normalised equality, exactly one survivor); otherwise needs a decision. **The NAME never links on its own.**

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildNodeIndex, matchBlock, normaliseTag, type MatchableNode } from './match-nodes'

const n = (id: string, kind: string, code: string | null, shop_number: string | null, name: string | null): MatchableNode =>
  ({ id, kind, code, shop_number, name })

// Invented project.
const NODES: MatchableNode[] = [
  n('n-71', 'tenant_db', 'DB-71', '71', 'Alpha Store'),
  n('n-72', 'tenant_db', 'DB72', null, 'Bravo Shop'),
  n('n-04', 'tenant_db', null, '04', 'Kiosk Four'),
  n('n-73a', 'tenant_db', 'DB-73', null, 'Delta One'),
  n('n-73b', 'tenant_db', null, 'DB 73', 'Delta Two'),
  n('n-90', 'tenant_db', 'DB-90', null, 'Ninety'),
  n('n-91', 'tenant_db', 'DB-91', null, 'Ninety One'),
  n('n-mb92', 'main_board', null, null, 'MAIN BOARD 9.2'),
  n('n-mb93', 'main_board', 'MAIN BOARD 9.3', null, 'Main board 9.3'),
  n('n-fake', 'tenant_db', null, null, 'MAIN BOARD 9.4'),
  n('n-s9', 'tenant_db', null, 'S-9', 'Sierra'),
]
const index = buildNodeIndex(NODES)
const match = (tag: string | null, name: string | null = null) => matchBlock({ tag, name }, index)

describe('normaliseTag', () => {
  it('uppercases and strips spaces, hyphens, dashes and dots but keeps /', () => {
    expect(normaliseTag('db - 7.1')).toBe('DB71')
    expect(normaliseTag('DB-90/91')).toBe('DB90/91')
    expect(normaliseTag('DB–7 1')).toBe('DB71')
    expect(normaliseTag('DB-SR1')).toBe('DBSR1')
  })
})

describe('matchBlock', () => {
  it('matches nodes.code after normalisation', () => {
    expect(match('DB-71')).toEqual({ state: 'matched', nodeId: 'n-71', via: 'code', tieBrokenByName: false })
    expect(match('db 72')).toEqual({ state: 'matched', nodeId: 'n-72', via: 'code', tieBrokenByName: false })
  })

  it('matches nodes.shop_number', () => {
    expect(match('S 9')).toEqual({ state: 'matched', nodeId: 'n-s9', via: 'shop_number', tieBrokenByName: false })
  })

  it('tries the tag without a leading DB', () => {
    expect(match('DB-04')).toEqual({ state: 'matched', nodeId: 'n-04', via: 'without_db', tieBrokenByName: false })
  })

  it('maps MB-x.y to MAIN BOARD x.y (main-board name or any code)', () => {
    expect(match('MB-9.2')).toEqual({ state: 'matched', nodeId: 'n-mb92', via: 'main_board', tieBrokenByName: false })
    expect(match('MB 9.3')).toEqual({ state: 'matched', nodeId: 'n-mb93', via: 'main_board', tieBrokenByName: false })
  })

  it('never takes the MAIN BOARD alias from a tenant node\'s name', () => {
    expect(match('MB-9.4')).toEqual({ state: 'unmatched' })
  })

  it('leaves a combined tag unmatched even when both halves exist', () => {
    expect(match('DB-90/91')).toEqual({ state: 'unmatched' })
  })

  it('several candidates → needs a decision, unless the NAME picks exactly one', () => {
    expect(match('DB-73')).toEqual({ state: 'ambiguous', candidateIds: ['n-73a', 'n-73b'] })
    expect(match('DB-73', 'DELTA  ONE')).toEqual({ state: 'matched', nodeId: 'n-73a', via: 'code', tieBrokenByName: true })
    expect(match('DB-73', 'Somebody Else')).toEqual({ state: 'ambiguous', candidateIds: ['n-73a', 'n-73b'] })
  })

  it('never links on the NAME alone', () => {
    expect(match('DB-99', 'Alpha Store')).toEqual({ state: 'unmatched' })
  })

  it('no tag → no_tag', () => {
    expect(match(null, 'Alpha Store')).toEqual({ state: 'no_tag' })
    expect(match(' - ')).toEqual({ state: 'no_tag' })
  })

  it('a node whose code and shop number both equal the key counts once', () => {
    const idx = buildNodeIndex([n('only', 'tenant_db', 'DB-55', 'DB55', 'X')])
    expect(matchBlock({ tag: 'DB-55', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'only' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/match-nodes.test.ts
```

Expected: FAIL with `Failed to resolve import "./match-nodes"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Matching a detected block's tag to a project node (spec §5).
 *
 * Exactly one candidate links; zero or several need a person. The block's
 * NAME may break a tie between several tag candidates, and never links on its
 * own: two shops can share a name, a board cannot share a tag.
 */

export interface MatchableNode {
  id: string
  code: string | null
  shop_number: string | null
  /** Tenant nodes: shop_name; other boards: name. */
  name: string | null
  kind: string
}

export type MatchVia = 'code' | 'shop_number' | 'without_db' | 'main_board'

export type BlockMatch =
  | { state: 'matched'; nodeId: string; via: MatchVia; tieBrokenByName: boolean }
  | { state: 'ambiguous'; candidateIds: string[] }
  | { state: 'unmatched' }
  | { state: 'no_tag' }

const STRIP = /[\s\-‐-―.]+/g

/** Uppercase; strip spaces, hyphens/dashes and dots; keep '/' and the rest. */
export function normaliseTag(s: string): string {
  return s.toUpperCase().replace(STRIP, '')
}

function normaliseName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

export interface NodeIndex {
  nodes: ReadonlyMap<string, MatchableNode>
  byCode: ReadonlyMap<string, readonly string[]>
  byShop: ReadonlyMap<string, readonly string[]>
  mainBoardByName: ReadonlyMap<string, readonly string[]>
}

function add(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return
  const list = map.get(key)
  if (!list) map.set(key, [id])
  else if (!list.includes(id)) list.push(id)
}

export function buildNodeIndex(nodes: readonly MatchableNode[]): NodeIndex {
  const byCode = new Map<string, string[]>()
  const byShop = new Map<string, string[]>()
  const mainBoardByName = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.code) add(byCode, normaliseTag(node.code), node.id)
    if (node.shop_number) add(byShop, normaliseTag(node.shop_number), node.id)
    if (node.kind === 'main_board' && node.name) add(mainBoardByName, normaliseTag(node.name), node.id)
  }
  return { nodes: new Map(nodes.map((x) => [x.id, x])), byCode, byShop, mainBoardByName }
}

function lookup(index: NodeIndex, key: string): { ids: string[]; via: MatchVia } {
  const code = index.byCode.get(key) ?? []
  const shop = index.byShop.get(key) ?? []
  const ids = [...new Set([...code, ...shop])]
  return { ids, via: code.length > 0 ? 'code' : 'shop_number' }
}

const MB_RE = /^MB[\s\-‐-―.]*(\d+(?:\.\d+)*)$/i

export function matchBlock(block: { tag: string | null; name: string | null }, index: NodeIndex): BlockMatch {
  const key = block.tag ? normaliseTag(block.tag) : ''
  if (!key) return { state: 'no_tag' }

  let found = lookup(index, key)
  if (found.ids.length === 0 && key.startsWith('DB') && key.length > 2) {
    found = { ids: lookup(index, key.slice(2)).ids, via: 'without_db' }
  }
  if (found.ids.length === 0) {
    const mb = MB_RE.exec(block.tag!.trim())
    if (mb) {
      const alias = normaliseTag(`MAIN BOARD ${mb[1]}`)
      const ids = [...new Set([...lookup(index, alias).ids, ...(index.mainBoardByName.get(alias) ?? [])])]
      found = { ids, via: 'main_board' }
    }
  }

  const { ids, via } = found
  if (ids.length === 0) return { state: 'unmatched' }
  if (ids.length === 1) return { state: 'matched', nodeId: ids[0], via, tieBrokenByName: false }

  const wanted = block.name ? normaliseName(block.name) : ''
  if (wanted) {
    const hits = ids.filter((id) => {
      const nm = index.nodes.get(id)?.name
      return !!nm && normaliseName(nm) === wanted
    })
    if (hits.length === 1) return { state: 'matched', nodeId: hits[0], via, tieBrokenByName: true }
  }
  return { state: 'ambiguous', candidateIds: ids }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/match-nodes.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation — name never links alone**

Add a fallback before `return { state: 'unmatched' }` that matches on `normaliseName(block.name)` against every node's name. Run. Expected: `never links on the NAME alone` FAILS. Remove it; PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/status-plans/match-nodes.ts packages/shared/src/status-plans/match-nodes.test.ts
git commit -m "feat(status-plans): match detected block tags to project nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Review model (`detect-review.ts`)

**Files:**
- Create: `packages/shared/src/status-plans/detect-review.ts`
- Test: `packages/shared/src/status-plans/detect-review.test.ts`

Turns a `DetectResult` into what the panel shows: blocks overlapping an existing shape are left out (re-runs only propose new blocks); a matched board already on the plan, or claimed by two proposals, needs a person (the DB refuses a board twice per plan, `23505`); counts and the summary sentence.

`detected_tag` for a block with no `NO:` value stores the NAME as `NAME: <value>` so the canvas can still show the hint after accept (spec §5 "render as unlinked with the NAME value as hint"); it is cut to 64 characters (slice 1's CHECK).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { detectBlocks } from './detect-blocks'
import { boxesOverlap, detectedTagFor, detectionSummary, reviewDetection, runDetection } from './detect-review'
import { rectToPoints } from './geometry'
import type { MatchableNode } from './match-nodes'
import { ALPHA, BRAVO, CHARLIE, DELTA_NO_TAG, blockItems, textAt } from './__fixtures__/db-block-layout'

const NODES: MatchableNode[] = [
  { id: 'n-71', kind: 'tenant_db', code: 'DB-71', shop_number: null, name: 'Alpha Store' },
  { id: 'n-72', kind: 'tenant_db', code: 'DB-72', shop_number: null, name: 'Bravo Shop' },
]

// Four blocks far apart: matched, matched, unmatched (combined), no tag.
const ITEMS = [
  ...blockItems({ x: 100, y: 100, values: ALPHA }),
  ...blockItems({ x: 400, y: 100, values: BRAVO }),
  ...blockItems({ x: 100, y: 400, values: CHARLIE }),
  ...blockItems({ x: 400, y: 400, values: DELTA_NO_TAG }),
]

describe('reviewDetection', () => {
  it('sorts proposals into matched · need you · without a tag', () => {
    const r = reviewDetection(detectBlocks(ITEMS), NODES, [])
    expect(r.counts).toEqual({ detected: 4, matched: 2, needsYou: 1, noTag: 1 })
    expect(r.rows.map((x) => [x.block.tag, x.category, x.nodeId])).toEqual([
      ['DB-71', 'matched', 'n-71'],
      ['DB-72', 'matched', 'n-72'],
      ['DB-90/91', 'needs_you', null],
      [null, 'no_tag', null],
    ])
    expect(r.rows[2].reason).toBe('No board in this project has the tag DB-90/91.')
    expect(r.alreadyOnPlan).toBe(0)
    expect(detectionSummary(r)).toBe('Detected 4 blocks — 2 matched · 1 needs you · 1 without a tag')
  })

  it('leaves out blocks that overlap a shape already on the plan (re-run)', () => {
    const existing = [{ id: 's1', points: rectToPoints(90, 80, 150, 120), nodeId: null }]
    const r = reviewDetection(detectBlocks(ITEMS), NODES, existing)
    expect(r.alreadyOnPlan).toBe(1)
    expect(r.rows.map((x) => x.block.tag)).toEqual(['DB-72', 'DB-90/91', null])
  })

  it('a matched board already on the plan elsewhere needs a person', () => {
    const existing = [{ id: 's1', points: rectToPoints(900, 900, 950, 950), nodeId: 'n-71' }]
    const r = reviewDetection(detectBlocks(ITEMS), NODES, existing)
    const row = r.rows.find((x) => x.block.tag === 'DB-71')!
    expect(row.category).toBe('needs_you')
    expect(row.nodeId).toBeNull()
    expect(row.reason).toBe('DB-71 matches a board that is already on this plan.')
  })

  it('two proposals that read as the same board both need a person', () => {
    const twice = [...blockItems({ x: 100, y: 100, values: ALPHA }), ...blockItems({ x: 400, y: 100, values: ALPHA })]
    const r = reviewDetection(detectBlocks(twice), NODES, [])
    expect(r.rows.map((x) => x.category)).toEqual(['needs_you', 'needs_you'])
    expect(r.rows[0].candidateIds).toEqual(['n-71'])
    expect(r.counts.matched).toBe(0)
  })

  it('pluralises the summary', () => {
    const r = reviewDetection(detectBlocks(blockItems({ x: 100, y: 100, values: CHARLIE })), NODES, [])
    expect(detectionSummary(r)).toBe('Detected 1 block — 0 matched · 1 needs you · 0 without a tag')
  })
})

describe('runDetection', () => {
  it('no text at all → no_text (never a silent empty review)', () => {
    expect(runDetection([], NODES, [])).toEqual({ kind: 'no_text' })
  })
  it('text but no complete block → no_blocks with the label count and reasons', () => {
    const out = runDetection([textAt('NO:', 10, 10), textAt('DB-71', 60, 10)], NODES, [])
    expect(out.kind).toBe('no_blocks')
    if (out.kind === 'no_blocks') {
      expect(out.labelCount).toBe(1)
      expect(out.rejected[0].reason).toContain('NAME:')
    }
  })
  it('blocks → review', () => {
    expect(runDetection(ITEMS, NODES, []).kind).toBe('review')
  })
})

describe('detectedTagFor / boxesOverlap', () => {
  it('stores the tag, else the NAME hint, cut to 64 characters', () => {
    expect(detectedTagFor({ tag: 'DB-71', name: 'ALPHA STORE' })).toBe('DB-71')
    expect(detectedTagFor({ tag: null, name: 'DELTA KIOSK' })).toBe('NAME: DELTA KIOSK')
    expect(detectedTagFor({ tag: null, name: null })).toBeNull()
    expect(detectedTagFor({ tag: 'X'.repeat(80), name: null })).toHaveLength(64)
  })
  it('boxes that only touch do not overlap', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    expect(boxesOverlap(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(false)
    expect(boxesOverlap(a, { minX: 9, minY: 9, maxX: 20, maxY: 20 })).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/detect-review.test.ts
```

Expected: FAIL with `Failed to resolve import "./detect-review"`.

- [ ] **Step 3: Implement**

```ts
/**
 * What the Detect blocks panel shows (spec §5): proposals sorted into
 * matched · need you · without a tag, with blocks already on the plan left out.
 */
import { detectBlocks, type DetectedBlock, type DetectResult, type RejectedBlock } from './detect-blocks'
import { boundingBox, type Box } from './geometry'
import { buildNodeIndex, matchBlock, type BlockMatch, type MatchableNode } from './match-nodes'
import type { ImageTextItem } from './text-space'

export type ReviewCategory = 'matched' | 'needs_you' | 'no_tag'

export interface ExistingShapeRef {
  id: string
  points: readonly number[]
  nodeId: string | null
}

export interface ReviewRow {
  /** Unique within one detection run. */
  key: string
  block: DetectedBlock
  match: BlockMatch
  category: ReviewCategory
  /** The board a one-click accept links (matched rows only). */
  nodeId: string | null
  /** Boards to offer first in the picker. */
  candidateIds: string[]
  /** Why a person is needed; null for matched rows. */
  reason: string | null
}

export interface DetectionReview {
  labelCount: number
  rows: ReviewRow[]
  /** Blocks left out because they overlap a shape already on the plan. */
  alreadyOnPlan: number
  rejected: RejectedBlock[]
  counts: { detected: number; matched: number; needsYou: number; noTag: number }
}

export type DetectionOutcome =
  | { kind: 'no_text' }
  | { kind: 'no_blocks'; labelCount: number; rejected: RejectedBlock[] }
  | { kind: 'review'; review: DetectionReview }

export const DETECTED_TAG_MAX = 64

/** Positive-area intersection; boxes that only touch do not overlap. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
}

function rowFor(key: string, block: DetectedBlock, match: BlockMatch, used: ReadonlySet<string>): ReviewRow {
  const base = { key, block, match }
  switch (match.state) {
    case 'no_tag':
      return { ...base, category: 'no_tag', nodeId: null, candidateIds: [], reason: 'This block has no NO: value.' }
    case 'matched':
      if (used.has(match.nodeId)) {
        return { ...base, category: 'needs_you', nodeId: null, candidateIds: [], reason: `${block.tag} matches a board that is already on this plan.` }
      }
      return { ...base, category: 'matched', nodeId: match.nodeId, candidateIds: [match.nodeId], reason: null }
    case 'ambiguous':
      return { ...base, category: 'needs_you', nodeId: null, candidateIds: match.candidateIds, reason: `${block.tag} matches ${match.candidateIds.length} boards; choose one.` }
    case 'unmatched':
      return { ...base, category: 'needs_you', nodeId: null, candidateIds: [], reason: `No board in this project has the tag ${block.tag}.` }
  }
}

export function reviewDetection(
  result: DetectResult,
  nodes: readonly MatchableNode[],
  existing: readonly ExistingShapeRef[],
): DetectionReview {
  const index = buildNodeIndex(nodes)
  const existingBoxes = existing.map((s) => boundingBox(s.points))
  const used = new Set(existing.flatMap((s) => (s.nodeId ? [s.nodeId] : [])))
  const rows: ReviewRow[] = []
  let alreadyOnPlan = 0

  result.blocks.forEach((block, i) => {
    if (existingBoxes.some((b) => boxesOverlap(b, block.box))) { alreadyOnPlan++; return }
    rows.push(rowFor(`block-${i}`, block, matchBlock(block, index), used))
  })

  // A board can be on a plan once: proposals that read as the same board all need a person.
  const claims = new Map<string, number>()
  for (const r of rows) if (r.category === 'matched' && r.nodeId) claims.set(r.nodeId, (claims.get(r.nodeId) ?? 0) + 1)
  for (const r of rows) {
    const n = r.nodeId ? claims.get(r.nodeId) ?? 0 : 0
    if (r.category === 'matched' && r.nodeId && n > 1) {
      r.category = 'needs_you'
      r.candidateIds = [r.nodeId]
      r.reason = `${n} blocks on this page read as the same board; choose the board for each.`
      r.nodeId = null
    }
  }

  const count = (c: ReviewCategory) => rows.filter((r) => r.category === c).length
  return {
    labelCount: result.labelCount,
    rows,
    alreadyOnPlan,
    rejected: result.rejected,
    counts: { detected: rows.length, matched: count('matched'), needsYou: count('needs_you'), noTag: count('no_tag') },
  }
}

export function detectionSummary(r: DetectionReview): string {
  const { detected, matched, needsYou, noTag } = r.counts
  return `Detected ${detected} ${detected === 1 ? 'block' : 'blocks'} — ${matched} matched · ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you · ${noTag} without a tag`
}

export function runDetection(
  items: readonly ImageTextItem[],
  nodes: readonly MatchableNode[],
  existing: readonly ExistingShapeRef[],
): DetectionOutcome {
  if (items.length === 0) return { kind: 'no_text' }
  const result = detectBlocks(items)
  if (result.blocks.length === 0) return { kind: 'no_blocks', labelCount: result.labelCount, rejected: result.rejected }
  return { kind: 'review', review: reviewDetection(result, nodes, existing) }
}

/** What status_plan_shapes.detected_tag stores for an accepted block. */
export function detectedTagFor(block: Pick<DetectedBlock, 'tag' | 'name'>): string | null {
  const raw = block.tag ?? (block.name ? `NAME: ${block.name}` : null)
  return raw ? Array.from(raw).slice(0, DETECTED_TAG_MAX).join('') : null
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/detect-review.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/detect-review.ts packages/shared/src/status-plans/detect-review.test.ts
git commit -m "feat(status-plans): detection review model (overlap exclusion, duplicate boards, summary)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Public surface

**Files:**
- Modify: `packages/shared/src/status-plans/index.ts`
- Modify: `packages/shared/src/status-plans/index.test.ts`

- [ ] **Step 1: Extend the surface test (fails first)**

In `index.test.ts`, add inside the `describe`:

```ts
  it('exports the detection surface (slice 3)', () => {
    for (const name of [
      'composeMatrix', 'textItemsToImageSpace',
      'detectBlocks',
      'normaliseTag', 'buildNodeIndex', 'matchBlock',
      'reviewDetection', 'runDetection', 'detectionSummary', 'detectedTagFor', 'boxesOverlap',
    ]) {
      expect(typeof (sp as Record<string, unknown>)[name], name).toBe('function')
    }
    expect(sp.BLOCK_LABELS).toEqual(['NO', 'NAME', 'AREA', 'RATING', 'CABLE', 'SERIAL', 'CT'])
    expect(sp.DETECTED_TAG_MAX).toBe(64)
  })
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/index.test.ts
```

Expected: FAIL (`composeMatrix: expected 'undefined' to be 'function'`).

- [ ] **Step 2: Add the exports**

Append to `packages/shared/src/status-plans/index.ts`:

```ts
export * from './text-space'
export * from './detect-blocks'
export * from './match-nodes'
export * from './detect-review'
```

- [ ] **Step 3: Run the module and the type-check**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared type-check
```

Expected: all `src/status-plans` files PASS (Task 0 count + 41); `tsc --noEmit` exits 0. If tsc reports a duplicate export name across modules, rename in the new module (never in slice 1's).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/status-plans/index.ts packages/shared/src/status-plans/index.test.ts
git commit -m "feat(status-plans): export block detection from @esite/shared/status-plans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web text extractor (`extract-page-text.ts`) against real pdf.js

**Files:**
- Create: `apps/web/src/lib/status-plans/extract-page-text.ts`
- Test: `apps/web/src/lib/status-plans/extract-page-text.test.ts`

The extractor takes the pdf.js module as an injectable loader, so the browser uses `pdfjs-dist` (worker at `/pdf.worker.min.mjs`, as `use-sheet-image.ts` does) and the test uses the Node-compatible legacy build (as `qc-report.render.test.ts` does). The test builds a `/Rotate 90` PDF with pdf-lib and asserts the run lands on the predicted raster pixel — through pdf.js itself, not a copy of its maths.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
// pdf.js legacy build + pdf-lib bytes: jsdom's Uint8Array is a different realm.
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { detectBlocks } from '@esite/shared/status-plans'
import { extractPageText, IMAGE_SPACE_SCALE } from './extract-page-text'

const legacy = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as never

const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:']
// Invented values (public repo).
const VALUES = ['DB-77', 'TEST STORE', '120m2', '100A TP', '4C 25mm2 CU', 'QA-0007', '100/5A']

/**
 * A 600×400 pt page with /Rotate 90. On the scale-2 raster of such a page,
 * raster x = 2·userY and raster baseline = 2·userX, and a run reads upright
 * when drawn turned +90° in user space. Text size 5 pt → 10 px on the raster.
 */
async function rotatedSheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([600, 400])
  page.setRotation(degrees(90))
  const put = (s: string, rasterX: number, rasterBaseline: number) =>
    page.drawText(s, { x: rasterBaseline / 2, y: rasterX / 2, size: 5, font, rotate: degrees(90) })
  LABELS.forEach((label, row) => {
    const baseline = 200 + row * 16
    put(label, 100, baseline)
    put(VALUES[row], 150, baseline)
  })
  return doc.save()
}

async function blankSheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 400])
  page.drawRectangle({ x: 50, y: 50, width: 100, height: 60, borderColor: rgb(0, 0, 0), borderWidth: 1 })
  return doc.save()
}

describe('extractPageText', () => {
  it('uses the same scale as use-sheet-image (image space is defined there)', () => {
    expect(IMAGE_SPACE_SCALE).toBe(2)
  })

  it('/Rotate 90: real pdf.js puts the NO: run on the predicted raster pixel', async () => {
    const res = await extractPageText({ data: await rotatedSheet() }, 1, legacy)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.width).toBe(800)   // 400 pt × 2, rotated
    expect(res.height).toBe(1200) // 600 pt × 2, rotated
    // pdf.js may report "NO:" alone or merged with its value; either starts with "NO:".
    const no = res.items.find((i) => i.str.startsWith('NO:'))!
    expect(no.x).toBeCloseTo(100, 0)
    expect(no.baseline).toBeCloseTo(200, 0)
    expect(no.height).toBeCloseTo(10, 0)
  })

  it('/Rotate 90: the extracted page reads as one block', async () => {
    const res = await extractPageText({ data: await rotatedSheet() }, 1, legacy)
    if (!res.ok) throw new Error(res.error)
    const r = detectBlocks(res.items)
    expect(r.blocks.map((b) => [b.tag, b.name, b.fields.CT])).toEqual([['DB-77', 'TEST STORE', '100/5A']])
  })

  it('a page with no text layer returns no items (the panel turns that into a sentence)', async () => {
    const res = await extractPageText({ data: await blankSheet() }, 1, legacy)
    expect(res).toMatchObject({ ok: true, items: [], rawItemCount: 0 })
  })

  it('a page beyond the document is refused with a sentence', async () => {
    const res = await extractPageText({ data: await blankSheet() }, 3, legacy)
    expect(res).toEqual({ ok: false, error: 'This drawing has 1 page; page 3 does not exist.' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/extract-page-text.test.ts
```

Expected: FAIL with `Failed to resolve import "./extract-page-text"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Read one drawing page's text layer into image space (spec §5).
 *
 * Browser: pdfjs-dist with the worker at /pdf.worker.min.mjs, exactly as
 * lib/sheet/use-sheet-image.ts loads it. Tests inject the Node legacy build.
 * The viewport is built at IMAGE_SPACE_SCALE, the scale use-sheet-image
 * rasterises at, and its transform carries the page's /Rotate.
 */
import { textItemsToImageSpace, type ImageTextItem, type Matrix } from '@esite/shared/status-plans'

/** Must equal the scale in lib/sheet/use-sheet-image.ts (pinned by a test). */
export const IMAGE_SPACE_SCALE = 2

type PdfViewport = { width: number; height: number; transform: number[] }
type PdfPage = {
  getViewport: (o: { scale: number }) => PdfViewport
  getTextContent: () => Promise<{ items: unknown[] }>
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> }
export type PdfjsModule = {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> }
  GlobalWorkerOptions?: { workerSrc: string }
}

async function browserPdfjs(): Promise<PdfjsModule> {
  const lib = await import('pdfjs-dist')
  if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  return lib as unknown as PdfjsModule
}

export type PageTextResult =
  | { ok: true; items: ImageTextItem[]; rawItemCount: number; width: number; height: number }
  | { ok: false; error: string }

export async function extractPageText(
  source: { url: string } | { data: Uint8Array },
  pageIndex: number,
  loadPdfjs: () => Promise<PdfjsModule> = browserPdfjs,
): Promise<PageTextResult> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({
    ...('url' in source ? { url: source.url } : { data: source.data }),
    disableFontFace: true,
    verbosity: 0,
  }).promise
  try {
    if (!Number.isInteger(pageIndex) || pageIndex < 1 || pageIndex > doc.numPages) {
      const pages = doc.numPages === 1 ? '1 page' : `${doc.numPages} pages`
      return { ok: false, error: `This drawing has ${pages}; page ${pageIndex} does not exist.` }
    }
    const page = await doc.getPage(pageIndex)
    const viewport = page.getViewport({ scale: IMAGE_SPACE_SCALE })
    const content = await page.getTextContent()
    const t = viewport.transform
    const items = textItemsToImageSpace(content.items, [t[0], t[1], t[2], t[3], t[4], t[5]] as Matrix)
    return { ok: true, items, rawItemCount: content.items.length, width: viewport.width, height: viewport.height }
  } finally {
    await doc.destroy()
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/extract-page-text.test.ts
```

Expected: PASS, 5 tests. If `rawItemCount` on the blank sheet is not 0 (pdf.js can emit an empty `hasEOL` item), change that assertion to `items: []` only — `items` is what the panel reads.

- [ ] **Step 5: Pin the scale against use-sheet-image (contract, cannot drift)**

Append to the same test file:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('image space contract', () => {
  it('use-sheet-image still rasterises at the extractor scale', () => {
    const src = readFileSync(join(__dirname, '../sheet/use-sheet-image.ts'), 'utf8')
    expect(src).toContain(`getViewport({ scale: ${IMAGE_SPACE_SCALE} })`)
  })
})
```

Run again: PASS, 6 tests. Mutation: set `IMAGE_SPACE_SCALE = 1.5` → this test and the pixel test FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/extract-page-text.ts apps/web/src/lib/status-plans/extract-page-text.test.ts
git commit -m "feat(status-plans): extract a drawing page's text into image space (pdf.js, rotate-aware)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Accept action (`acceptDetectedBlocksAction`) and its error sentences

**Files:**
- Create: `apps/web/src/lib/status-plans/detection-errors.ts`
- Test: `apps/web/src/lib/status-plans/detection-errors.test.ts`
- Create: `apps/web/src/actions/status-plan-detection.actions.ts`
- Test: `apps/web/src/actions/status-plan-detection.actions.test.ts`

Gate order: input → session → plan readable (RLS; a plan the caller cannot see is "not found") → plan is a schematic → `requireEffectiveRole(…, ORG_WRITE_ROLES)` `.ok` → one bulk insert. A PostgREST bulk insert is one statement, so it is all-or-nothing; the sentences say "Nothing was added". `organisation_id`, `project_id` and `created_by` are never sent (slice 1's triggers bind them).

- [ ] **Step 1: Write the failing error-sentence test**

```ts
import { describe, it, expect } from 'vitest'
import { acceptErrorSentence } from './detection-errors'

describe('acceptErrorSentence', () => {
  it.each([
    ['23505', 'One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.'],
    ['23514', 'One of these blocks was refused: its board is in another project or has been deleted. Nothing was added; run detection again.'],
    ['23503', 'This status plan no longer exists. Reload the page.'],
    ['42501', 'Your role cannot edit this status plan.'],
  ])('%s → sentence', (code, sentence) => {
    expect(acceptErrorSentence(code)).toBe(sentence)
  })
  it('anything else → a generic sentence, never the raw database message', () => {
    expect(acceptErrorSentence('XX000')).toBe('The blocks could not be saved. Nothing was added; try again.')
    expect(acceptErrorSentence(undefined)).toBe('The blocks could not be saved. Nothing was added; try again.')
  })
})
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/detection-errors.test.ts
```

Expected: FAIL (`Failed to resolve import "./detection-errors"`).

- [ ] **Step 2: Implement the sentences**

```ts
/** Postgres error code → the sentence the Detect blocks panel shows (slice 1 contract codes). */
export function acceptErrorSentence(code: string | null | undefined): string {
  switch (code) {
    case '23505':
      return 'One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.'
    case '23514':
      return 'One of these blocks was refused: its board is in another project or has been deleted. Nothing was added; run detection again.'
    case '23503':
      return 'This status plan no longer exists. Reload the page.'
    case '42501':
      return 'Your role cannot edit this status plan.'
    default:
      return 'The blocks could not be saved. Nothing was added; try again.'
  }
}
```

Run: PASS, 5 tests.

- [ ] **Step 3: Write the failing action test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createClientMock, requireEffectiveRoleMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({
  requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a),
}))

import { acceptDetectedBlocksAction } from './status-plan-detection.actions'

const PLAN_ID = '22222222-2222-2222-2222-222222222222'
const PROJECT_ID = '33333333-3333-3333-3333-333333333333'
const NODE_A = '44444444-4444-4444-4444-444444444444'
const NODE_B = '55555555-5555-5555-5555-555555555555'
const RECT = [95, 85, 221.5, 85, 221.5, 203.5, 95, 203.5]

function shapeRow(id: string, nodeId: string | null, tag: string | null) {
  return {
    id, status_plan_id: PLAN_ID, shape: 'rect', points: RECT, node_id: nodeId, area_type: null,
    detected_tag: tag, source: 'detected', created_by: 'u', created_at: 't', updated_at: 't',
  }
}

function fakeClient(opts: {
  plan?: { id: string; project_id: string; purpose: string } | null
  planError?: { message: string } | null
  insert?: { data: unknown[] | null; error: { code: string; message: string } | null }
}) {
  const inserts: unknown[] = []
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) },
    schema: () => ({
      from: (table: string) => {
        if (table === 'status_plans') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.plan ?? null, error: opts.planError ?? null }) }) }) }
        }
        if (table === 'status_plan_shapes') {
          return { insert: (rows: unknown) => { inserts.push(rows); return { select: async () => opts.insert ?? { data: [], error: null } } } }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }),
  }
  return { client, inserts }
}

const SCHEMATIC = { id: PLAN_ID, project_id: PROJECT_ID, purpose: 'distribution_schematic' }

beforeEach(() => {
  createClientMock.mockReset()
  requireEffectiveRoleMock.mockReset()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
})

describe('acceptDetectedBlocksAction', () => {
  it('inserts every block as a detected rect and returns the saved shapes', async () => {
    const { client, inserts } = fakeClient({
      plan: SCHEMATIC,
      insert: { data: [shapeRow('s1', NODE_A, 'DB-71'), shapeRow('s2', null, 'NAME: DELTA KIOSK')], error: null },
    })
    createClientMock.mockResolvedValue(client)
    const res = await acceptDetectedBlocksAction(PLAN_ID, [
      { points: RECT, nodeId: NODE_A, detectedTag: 'DB-71' },
      { points: RECT, nodeId: null, detectedTag: 'NAME: DELTA KIOSK' },
    ])
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.shapes.map((s) => [s.id, s.nodeId, s.source, s.detectedTag])).toEqual([
      ['s1', NODE_A, 'detected', 'DB-71'],
      ['s2', null, 'detected', 'NAME: DELTA KIOSK'],
    ])
    expect(inserts).toEqual([[
      { status_plan_id: PLAN_ID, shape: 'rect', points: RECT, node_id: NODE_A, detected_tag: 'DB-71', source: 'detected' },
      { status_plan_id: PLAN_ID, shape: 'rect', points: RECT, node_id: null, detected_tag: 'NAME: DELTA KIOSK', source: 'detected' },
    ]])
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(client, PROJECT_ID, ['owner', 'admin', 'project_manager'])
  })

  it('a refused role gate stops before any write (the gate is an object, not a boolean)', async () => {
    const { client, inserts } = fakeClient({ plan: SCHEMATIC })
    createClientMock.mockResolvedValue(client)
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const res = await acceptDetectedBlocksAction(PLAN_ID, [{ points: RECT, nodeId: NODE_A, detectedTag: 'DB-71' }])
    expect(res).toEqual({ ok: false, error: 'Your role cannot edit this status plan.' })
    expect(inserts).toEqual([])
  })

  it('refuses a tenant-layout plan', async () => {
    const { client, inserts } = fakeClient({ plan: { ...SCHEMATIC, purpose: 'tenant_layout' } })
    createClientMock.mockResolvedValue(client)
    const res = await acceptDetectedBlocksAction(PLAN_ID, [{ points: RECT, nodeId: null, detectedTag: null }])
    expect(res).toEqual({ ok: false, error: 'Block detection is only for distribution schematic plans.' })
    expect(inserts).toEqual([])
  })

  it('a plan the caller cannot see reads as not found', async () => {
    const { client } = fakeClient({ plan: null })
    createClientMock.mockResolvedValue(client)
    expect(await acceptDetectedBlocksAction(PLAN_ID, [{ points: RECT, nodeId: null, detectedTag: null }]))
      .toEqual({ ok: false, error: 'This status plan was not found.' })
  })

  it('refuses the same board twice in one batch before touching the database', async () => {
    const res = await acceptDetectedBlocksAction(PLAN_ID, [
      { points: RECT, nodeId: NODE_B, detectedTag: 'DB-1' },
      { points: RECT, nodeId: NODE_B, detectedTag: 'DB-2' },
    ])
    expect(res).toEqual({ ok: false, error: 'Two of these blocks are linked to the same board. A board can appear once on a plan.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('refuses malformed input before touching the database', async () => {
    expect(await acceptDetectedBlocksAction('not-a-uuid', [{ points: RECT, nodeId: null, detectedTag: null }]))
      .toEqual({ ok: false, error: 'These blocks could not be read. Run detection again.' })
    expect(await acceptDetectedBlocksAction(PLAN_ID, [{ points: [0, 0, 1, 1, 2, 2], nodeId: null, detectedTag: null }]))
      .toEqual({ ok: false, error: 'These blocks could not be read. Run detection again.' })
    expect(await acceptDetectedBlocksAction(PLAN_ID, []))
      .toEqual({ ok: false, error: 'These blocks could not be read. Run detection again.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('maps a duplicate-board refusal from the database to a sentence', async () => {
    const { client } = fakeClient({ plan: SCHEMATIC, insert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } } })
    createClientMock.mockResolvedValue(client)
    const res = await acceptDetectedBlocksAction(PLAN_ID, [{ points: RECT, nodeId: NODE_A, detectedTag: 'DB-71' }])
    expect(res).toEqual({ ok: false, error: 'One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.' })
  })
})
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/actions/status-plan-detection.actions.test.ts
```

Expected: FAIL (`Failed to resolve import "./status-plan-detection.actions"`).

- [ ] **Step 4: Implement the action**

```ts
'use server'

/**
 * Accept detected DB blocks onto a distribution-schematic status plan
 * (spec §5, slice 3).
 *
 * Returns { ok, error } and never throws: production replaces a thrown
 * server-action message with a generic sentence. Only async functions are
 * exported from this file ('use server' rule); constants stay module-private.
 *
 * The client never names the org, the project or the author: slice 1's
 * triggers bind them. The role gate here is the UI gate; the RESTRICTIVE
 * INSERT policy on status_plan_shapes is the database backstop.
 */
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { acceptErrorSentence } from '@/lib/status-plans/detection-errors'
import { ORG_WRITE_ROLES } from '@esite/shared'
import {
  pointsError,
  statusPlanShapeFromRow,
  type StatusPlanShape,
  type StatusPlanShapeRow,
} from '@esite/shared/status-plans'

const MAX_BATCH = 500

const blockSchema = z.object({
  points: z.array(z.number().finite()).length(8),
  nodeId: z.string().uuid().nullable(),
  detectedTag: z.string().trim().max(64).nullable(),
})
const inputSchema = z.object({
  planId: z.string().uuid(),
  blocks: z.array(blockSchema).min(1).max(MAX_BATCH),
})

const SHAPE_COLUMNS =
  'id, status_plan_id, shape, points, node_id, area_type, detected_tag, source, created_by, created_at, updated_at'

export type AcceptBlockInput = z.infer<typeof blockSchema>
export type AcceptDetectedBlocksResult = { ok: true; shapes: StatusPlanShape[] } | { ok: false; error: string }

export async function acceptDetectedBlocksAction(
  planId: string,
  blocks: AcceptBlockInput[],
): Promise<AcceptDetectedBlocksResult> {
  const parsed = inputSchema.safeParse({ planId, blocks })
  if (!parsed.success) return { ok: false, error: 'These blocks could not be read. Run detection again.' }
  for (const b of parsed.data.blocks) {
    const bad = pointsError('rect', b.points)
    if (bad) return { ok: false, error: bad }
  }
  const nodeIds = parsed.data.blocks.flatMap((b) => (b.nodeId ? [b.nodeId] : []))
  if (new Set(nodeIds).size !== nodeIds.length) {
    return { ok: false, error: 'Two of these blocks are linked to the same board. A board can appear once on a plan.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Your session has ended. Sign in again.' }

  const { data: plan, error: planError } = await (supabase as any)
    .schema('tenants')
    .from('status_plans')
    .select('id, project_id, purpose')
    .eq('id', parsed.data.planId)
    .maybeSingle()
  if (planError) return { ok: false, error: 'The status plan could not be loaded. Try again.' }
  if (!plan) return { ok: false, error: 'This status plan was not found.' }
  if (plan.purpose !== 'distribution_schematic') {
    return { ok: false, error: 'Block detection is only for distribution schematic plans.' }
  }

  const gate = await requireEffectiveRole(supabase, plan.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { ok: false, error: 'Your role cannot edit this status plan.' }

  const rows = parsed.data.blocks.map((b) => ({
    status_plan_id: parsed.data.planId,
    shape: 'rect' as const,
    points: b.points,
    node_id: b.nodeId,
    detected_tag: b.detectedTag ? b.detectedTag : null,
    source: 'detected' as const,
  }))
  const { data, error } = await (supabase as any)
    .schema('tenants')
    .from('status_plan_shapes')
    .insert(rows)
    .select(SHAPE_COLUMNS)
  if (error) return { ok: false, error: acceptErrorSentence(error.code) }

  try {
    return { ok: true, shapes: ((data ?? []) as StatusPlanShapeRow[]).map(statusPlanShapeFromRow) }
  } catch {
    return { ok: false, error: 'The blocks were saved but could not be shown. Reload the page.' }
  }
}
```

- [ ] **Step 5: Run both tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/detection-errors.test.ts src/actions/status-plan-detection.actions.test.ts
```

Expected: PASS, 5 + 7 tests.

- [ ] **Step 6: Mutation — the inert-gate shape**

Replace `if (!gate.ok)` with `if (!gate)`. Run the action test. Expected: `a refused role gate stops before any write` FAILS (an insert is recorded). Restore; PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/status-plans/detection-errors.ts apps/web/src/lib/status-plans/detection-errors.test.ts apps/web/src/actions/status-plan-detection.actions.ts apps/web/src/actions/status-plan-detection.actions.test.ts
git commit -m "feat(status-plans): accept detected blocks (bulk insert, role gate, error sentences)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `DetectBlocksPanel` review UI

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/DetectBlocksPanel.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/DetectBlocksPanel.test.tsx`

(If slice 2 has not created the `[planId]` folder yet, create just these two files in it; Task 10 wires them.)

Behaviour: nothing for read-only roles; an image drawing gets a sentence instead of a button; "Detect blocks" reads the page and shows the summary line, then three sections. Matched rows accept in one click; need-you rows pick a board (candidates first, already-used boards disabled) and Add, or Skip; tagless rows Add as unlinked or Skip. Errors appear as `role="alert"` sentences and the rows stay. Nothing is written without a click.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ImageTextItem, StatusPlanShape } from '@esite/shared/status-plans'

const { extractMock, acceptMock } = vi.hoisted(() => ({ extractMock: vi.fn(), acceptMock: vi.fn() }))
vi.mock('@/lib/status-plans/extract-page-text', () => ({ extractPageText: (...a: unknown[]) => extractMock(...a) }))
vi.mock('@/actions/status-plan-detection.actions', () => ({ acceptDetectedBlocksAction: (...a: unknown[]) => acceptMock(...a) }))

import { DetectBlocksPanel, type DetectBlocksPanelProps } from './DetectBlocksPanel'

// Invented layout (public repo): text height 10, rows 16 apart, values 50 right.
const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:']
const t = (str: string, x: number, baseline: number): ImageTextItem =>
  ({ str, x, baseline, top: baseline - 10, width: str.length * 6, height: 10 })
const block = (x: number, y: number, values: string[]) =>
  LABELS.flatMap((l, row) => [t(l, x, y + row * 16), ...(values[row] ? [t(values[row], x + 50, y + row * 16)] : [])])

const ITEMS = [
  ...block(100, 100, ['DB-71', 'ALPHA STORE', '1m2', '60A TP', '4C', 'ZX-1', '-']),
  ...block(400, 100, ['MB-9.2', 'MAIN BOARD 9.2', '-', '800A TP', '-', 'ZX-2', '800/5A']),
  ...block(100, 400, ['DB-90/91', 'CHARLIE HALL', '2m2', '100A TP', '4C', 'ZX-3', '-']),
  ...block(400, 400, ['', 'FOXTROT', '3m2', '20A SP', '3C', '', '']),
]

const NODES = [
  { id: 'n-71', kind: 'tenant_db', code: 'DB-71', shop_number: null, name: 'Alpha Store' },
  { id: 'n-mb', kind: 'main_board', code: null, shop_number: null, name: 'MAIN BOARD 9.2' },
  { id: 'n-75', kind: 'tenant_db', code: 'DB-75', shop_number: null, name: 'Echo Store' },
]

const shape = (id: string, nodeId: string | null, detectedTag: string | null): StatusPlanShape => ({
  id, statusPlanId: 'plan-1', shape: 'rect', points: [0, 0, 1, 0, 1, 1, 0, 1], nodeId, areaType: null,
  detectedTag, source: 'detected', createdBy: 'u', createdAt: 't', updatedAt: 't',
})

function props(over: Partial<DetectBlocksPanelProps> = {}): DetectBlocksPanelProps {
  return {
    planId: 'plan-1', pageIndex: 1, pdfUrl: 'https://signed.example/plan.pdf', isPdf: true,
    nodes: NODES, existingShapes: [], canEdit: true, onAccepted: vi.fn(), ...over,
  }
}

beforeEach(() => {
  extractMock.mockReset()
  acceptMock.mockReset()
  extractMock.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 1000, height: 1000 })
})

async function detect() {
  fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
  return screen.findByText('Detected 4 blocks — 2 matched · 1 needs you · 1 without a tag')
}

describe('DetectBlocksPanel', () => {
  it('renders nothing for a read-only role', () => {
    const { container } = render(<DetectBlocksPanel {...props({ canEdit: false })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('an image drawing gets a sentence, not a button', () => {
    render(<DetectBlocksPanel {...props({ isPdf: false })} />)
    expect(screen.getByText('Block detection reads the text of a PDF drawing. This drawing is an image — draw blocks by hand.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detect blocks' })).toBeNull()
  })

  it('reads the plan page and summarises; writes nothing until a click', async () => {
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    expect(extractMock).toHaveBeenCalledWith({ url: 'https://signed.example/plan.pdf' }, 1)
    expect(acceptMock).not.toHaveBeenCalled()
  })

  it('accepts every matched block in one click and hands the shapes to the canvas', async () => {
    const onAccepted = vi.fn()
    acceptMock.mockResolvedValue({ ok: true, shapes: [shape('s1', 'n-71', 'DB-71'), shape('s2', 'n-mb', 'MB-9.2')] })
    render(<DetectBlocksPanel {...props({ onAccepted })} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Accept 2 matched' }))
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    const [planId, blocks] = acceptMock.mock.calls[0]
    expect(planId).toBe('plan-1')
    expect(blocks.map((b: { nodeId: string; detectedTag: string; points: number[] }) => [b.nodeId, b.detectedTag, b.points.length]))
      .toEqual([['n-71', 'DB-71', 8], ['n-mb', 'MB-9.2', 8]])
    expect(onAccepted.mock.calls[0][0].map((s: StatusPlanShape) => s.id)).toEqual(['s1', 's2'])
    expect(screen.queryByRole('button', { name: 'Accept 2 matched' })).toBeNull()
  })

  it('a block that needs a person takes a picked board; boards claimed elsewhere are disabled', async () => {
    acceptMock.mockResolvedValue({ ok: true, shapes: [shape('s3', 'n-75', 'DB-90/91')] })
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    const select = screen.getByRole('combobox', { name: 'Board for DB-90/91' }) as HTMLSelectElement
    const alpha = within(select).getByRole('option', { name: 'DB-71 · Alpha Store' }) as HTMLOptionElement
    expect(alpha.disabled).toBe(true) // still pending as a matched row
    fireEvent.change(select, { target: { value: 'n-75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add DB-90/91' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][1]).toEqual([expect.objectContaining({ nodeId: 'n-75', detectedTag: 'DB-90/91' })])
  })

  it('a block without a tag is added unlinked with its NAME as the hint', async () => {
    acceptMock.mockResolvedValue({ ok: true, shapes: [shape('s4', null, 'NAME: FOXTROT')] })
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Add FOXTROT unlinked' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][1]).toEqual([expect.objectContaining({ nodeId: null, detectedTag: 'NAME: FOXTROT' })])
  })

  it('Skip removes a row without writing', async () => {
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Skip DB-90/91' }))
    expect(screen.queryByRole('combobox', { name: 'Board for DB-90/91' })).toBeNull()
    expect(acceptMock).not.toHaveBeenCalled()
  })

  it('a refused save shows the sentence and keeps the rows', async () => {
    acceptMock.mockResolvedValue({ ok: false, error: 'One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.' })
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Accept 2 matched' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('One of these boards is already on this plan.')
    expect(screen.getByRole('button', { name: 'Accept 2 matched' })).toBeInTheDocument()
  })

  it('a page with no text layer says so', async () => {
    extractMock.mockResolvedValue({ ok: true, items: [], rawItemCount: 0, width: 1, height: 1 })
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
    expect(await screen.findByText('This page has no readable text — draw blocks by hand.')).toBeInTheDocument()
  })

  it('a re-run leaves out blocks already on the plan and says how many', async () => {
    render(<DetectBlocksPanel {...props({ existingShapes: [{ id: 'x', points: [90, 80, 150, 80, 150, 120, 90, 120], nodeId: 'n-71' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
    expect(await screen.findByText('Detected 3 blocks — 1 matched · 1 needs you · 1 without a tag')).toBeInTheDocument()
    expect(screen.getByText('1 block already on this plan was left out.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/status-plans/[planId]/DetectBlocksPanel.test.tsx"
```

Expected: FAIL (`Failed to resolve import "./DetectBlocksPanel"`).

- [ ] **Step 3: Implement**

```tsx
'use client'

/**
 * Detect blocks — the review side panel for distribution-schematic status
 * plans (spec §5). Mounted by slice 2's plan workspace; see the slice 3 plan
 * for the contract. `onAccepted` / `onFocus` come from that client component,
 * never from page.tsx (server → client props must be JSON).
 *
 * Nothing is written until a person clicks. Accepted shapes are handed back
 * through onAccepted and folded into the canvas state (no router.refresh()).
 */
import { useMemo, useState } from 'react'
import {
  detectedTagFor,
  detectionSummary,
  normaliseTag,
  runDetection,
  type Box,
  type DetectionOutcome,
  type MatchableNode,
  type ReviewRow,
  type StatusPlanShape,
} from '@esite/shared/status-plans'
import { extractPageText } from '@/lib/status-plans/extract-page-text'
import { acceptDetectedBlocksAction } from '@/actions/status-plan-detection.actions'

export type DetectNode = MatchableNode
export interface DetectExistingShape { id: string; points: number[]; nodeId: string | null }

export interface DetectBlocksPanelProps {
  planId: string
  pageIndex: number
  pdfUrl: string | null
  isPdf: boolean
  nodes: DetectNode[]
  existingShapes: DetectExistingShape[]
  canEdit: boolean
  onAccepted: (shapes: StatusPlanShape[]) => void
  onFocus?: (box: Box) => void
}

function nodeLabel(n: DetectNode): string {
  const tag = n.code ?? n.shop_number ?? '—'
  return n.name ? `${tag} · ${n.name}` : tag
}

function rowLabel(r: ReviewRow): string {
  return r.block.tag ?? r.block.name ?? 'block without a tag'
}

const muted = { fontSize: 13, color: 'var(--c-text-dim)' } as const
const sectionTitle = { fontSize: 13, fontWeight: 600, margin: '12px 0 4px' } as const
const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--c-border)' } as const

export function DetectBlocksPanel({
  planId, pageIndex, pdfUrl, isPdf, nodes, existingShapes, canEdit, onAccepted, onFocus,
}: DetectBlocksPanelProps) {
  const [reading, setReading] = useState(false)
  const [outcome, setOutcome] = useState<DetectionOutcome | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const rows = useMemo(
    () => (outcome?.kind === 'review' ? outcome.review.rows.filter((r) => !done.has(r.key)) : []),
    [outcome, done],
  )
  const matched = rows.filter((r) => r.category === 'matched')
  const needsYou = rows.filter((r) => r.category === 'needs_you')
  const noTag = rows.filter((r) => r.category === 'no_tag')

  /** Boards that cannot be picked again: on the plan, pending as matched, or picked in another row. */
  const reserved = useMemo(() => {
    const s = new Set<string>()
    for (const sh of existingShapes) if (sh.nodeId) s.add(sh.nodeId)
    for (const r of rows) if (r.category === 'matched' && r.nodeId) s.add(r.nodeId)
    for (const id of Object.values(choice)) if (id) s.add(id)
    return s
  }, [existingShapes, rows, choice])

  if (!canEdit) return null

  if (!isPdf) {
    return (
      <section aria-label="Detect blocks">
        <p style={muted}>Block detection reads the text of a PDF drawing. This drawing is an image — draw blocks by hand.</p>
      </section>
    )
  }

  async function detect() {
    if (!pdfUrl) { setReadError('The drawing file could not be opened. Reload the page.'); return }
    setReading(true)
    setReadError(null)
    setSaveError(null)
    setOutcome(null)
    setDone(new Set())
    setChoice({})
    try {
      const page = await extractPageText({ url: pdfUrl }, pageIndex)
      if (!page.ok) { setReadError(page.error); return }
      setOutcome(runDetection(page.items, nodes, existingShapes))
    } catch {
      setReadError('The drawing could not be read. Try again.')
    } finally {
      setReading(false)
    }
  }

  async function accept(items: Array<{ row: ReviewRow; nodeId: string | null }>) {
    if (items.length === 0) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await acceptDetectedBlocksAction(
        planId,
        items.map(({ row, nodeId }) => ({ points: row.block.points, nodeId, detectedTag: detectedTagFor(row.block) })),
      )
      if (!res.ok) { setSaveError(res.error); return }
      setDone((prev) => { const next = new Set(prev); for (const i of items) next.add(i.row.key); return next })
      setChoice((prev) => { const next = { ...prev }; for (const i of items) delete next[i.row.key]; return next })
      onAccepted(res.shapes)
    } catch {
      setSaveError('The blocks could not be saved. Nothing was added; try again.')
    } finally {
      setBusy(false)
    }
  }

  function skip(row: ReviewRow) {
    setDone((prev) => new Set(prev).add(row.key))
    setChoice((prev) => { const next = { ...prev }; delete next[row.key]; return next })
  }

  function optionsFor(row: ReviewRow): DetectNode[] {
    const q = normaliseTag(filter[row.key] ?? '')
    const first = new Set(row.candidateIds)
    return nodes
      .filter((n) => !q || normaliseTag(nodeLabel(n)).includes(q))
      .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || nodeLabel(a).localeCompare(nodeLabel(b)))
  }

  const focusButton = (row: ReviewRow) =>
    onFocus ? (
      <button type="button" onClick={() => onFocus(row.block.box)} aria-label={`Show ${rowLabel(row)} on the drawing`}>Show</button>
    ) : null

  const review = outcome?.kind === 'review' ? outcome.review : null

  return (
    <section aria-label="Detect blocks">
      <button type="button" onClick={detect} disabled={reading || busy}>
        {reading ? 'Reading the drawing…' : 'Detect blocks'}
      </button>

      {readError && <p role="alert" style={{ ...muted, color: 'var(--c-amber)' }}>{readError}</p>}

      {outcome?.kind === 'no_text' && <p style={muted}>This page has no readable text — draw blocks by hand.</p>}

      {outcome?.kind === 'no_blocks' && (
        <p style={muted}>
          {outcome.labelCount === 0
            ? 'No DB blocks were found on this page (no NO: labels). Draw blocks by hand.'
            : `No DB blocks were found: none of the ${outcome.labelCount} NO: labels starts a full NO–CT table. Draw blocks by hand.`}
        </p>
      )}

      {review && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600 }}>{detectionSummary(review)}</p>
          {review.alreadyOnPlan > 0 && (
            <p style={muted}>
              {review.alreadyOnPlan === 1
                ? '1 block already on this plan was left out.'
                : `${review.alreadyOnPlan} blocks already on this plan were left out.`}
            </p>
          )}
          {review.rejected.length > 0 && (
            <details>
              <summary style={muted}>{review.rejected.length} NO: labels did not start a full table</summary>
              <ul style={muted}>{review.rejected.map((r, i) => <li key={i}>{r.reason}</li>)}</ul>
            </details>
          )}
          {saveError && <p role="alert" style={{ ...muted, color: 'var(--c-amber)' }}>{saveError}</p>}

          {matched.length > 0 && (
            <div>
              <h4 style={sectionTitle}>Matched ({matched.length})</h4>
              <button type="button" disabled={busy} onClick={() => accept(matched.map((row) => ({ row, nodeId: row.nodeId })))}>
                {`Accept ${matched.length} matched`}
              </button>
              {matched.map((row) => {
                const node = nodes.find((n) => n.id === row.nodeId)
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{rowLabel(row)} → {node ? nodeLabel(node) : '—'}</span>
                    {focusButton(row)}
                    <button type="button" disabled={busy} onClick={() => skip(row)} aria-label={`Skip ${rowLabel(row)}`}>Skip</button>
                  </div>
                )
              })}
            </div>
          )}

          {needsYou.length > 0 && (
            <div>
              <h4 style={sectionTitle}>Need you ({needsYou.length})</h4>
              {needsYou.map((row) => {
                const label = rowLabel(row)
                const picked = choice[row.key] ?? ''
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{label}{row.block.name && row.block.tag ? ` (${row.block.name})` : ''}</span>
                    <span style={muted}>{row.reason}</span>
                    <input
                      type="search"
                      aria-label={`Filter boards for ${label}`}
                      placeholder="Filter boards"
                      value={filter[row.key] ?? ''}
                      onChange={(e) => setFilter((f) => ({ ...f, [row.key]: e.target.value }))}
                      className="compact-field"
                    />
                    <select
                      aria-label={`Board for ${label}`}
                      value={picked}
                      onChange={(e) => setChoice((c) => ({ ...c, [row.key]: e.target.value }))}
                      className="compact-field"
                    >
                      <option value="">Pick a board…</option>
                      {optionsFor(row).map((n) => (
                        <option key={n.id} value={n.id} disabled={reserved.has(n.id) && picked !== n.id}>
                          {nodeLabel(n)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !picked}
                      onClick={() => accept([{ row, nodeId: picked }])}
                      aria-label={`Add ${label}`}
                    >Add</button>
                    {focusButton(row)}
                    <button type="button" disabled={busy} onClick={() => skip(row)} aria-label={`Skip ${label}`}>Skip</button>
                  </div>
                )
              })}
            </div>
          )}

          {noTag.length > 0 && (
            <div>
              <h4 style={sectionTitle}>Without a tag ({noTag.length})</h4>
              {noTag.map((row) => {
                const label = rowLabel(row)
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{label}</span>
                    <button type="button" disabled={busy} onClick={() => accept([{ row, nodeId: null }])} aria-label={`Add ${label} unlinked`}>
                      Add unlinked
                    </button>
                    {focusButton(row)}
                    <button type="button" disabled={busy} onClick={() => skip(row)} aria-label={`Skip ${label}`}>Skip</button>
                  </div>
                )
              })}
            </div>
          )}

          {rows.length === 0 && review.rows.length > 0 && <p style={muted}>Every detected block has been handled.</p>}
          {review.rows.length === 0 && <p style={muted}>Every block on this page is already on the plan.</p>}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/status-plans/[planId]/DetectBlocksPanel.test.tsx"
```

Expected: PASS, 10 tests. (If `toBeEmptyDOMElement` / `toBeInTheDocument` are unknown, the web setup lacks jest-dom matchers: replace them with `expect(container.innerHTML).toBe('')` / `expect(x).not.toBeNull()`.)

- [ ] **Step 5: Type-check and lint**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web lint
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/DetectBlocksPanel.tsx" "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/DetectBlocksPanel.test.tsx"
git commit -m "feat(status-plans): Detect blocks review panel (accept matched, pick, skip)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Mount the panel in slice 2's plan workspace (needs slice 2)

**Files (names per slice 2; confirm in Step 1):**
- Modify: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx`
- Modify: slice 2's client workspace component in the same folder
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Find slice 2's integration points**

```bash
ls "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/"
grep -rn "distribution_schematic\|detect\|Detect" "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/" | grep -v DetectBlocksPanel
grep -rn "'use client'" "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/"
```

Expected: the page, the client workspace (the file holding the shapes `useState` and the side panel), and slice 2's detection slot (a comment or a conditional on `purpose === 'distribution_schematic'`). Write down: the workspace file name, its shapes-state setter, the prop names it already receives for the signed URL / `isPdf` / `canEdit`, and whether it has a viewport fit-to-box function. If slice 2 is absent, stop here and resume when it is merged.

- [ ] **Step 2: Workspace — render the panel in the slot**

In the workspace component, inside the side panel, for schematic plans only:

```tsx
import { DetectBlocksPanel, type DetectNode } from './DetectBlocksPanel'
// …props gain: detectNodes: DetectNode[]

{plan.purpose === 'distribution_schematic' && (
  <DetectBlocksPanel
    planId={plan.id}
    pageIndex={plan.pageIndex}
    pdfUrl={signedUrl}
    isPdf={isPdf}
    nodes={detectNodes}
    existingShapes={shapes.map((s) => ({ id: s.id, points: s.points, nodeId: s.nodeId }))}
    canEdit={canEdit}
    onAccepted={(added) => setShapes((prev) => [...prev, ...added])}
    onFocus={fitToBox /* omit this prop if slice 2 has no fit-to-box */}
  />
)}
```

`existingShapes` must be the workspace's LIVE shapes (not the page's initial prop), so a second run after accepting leaves the accepted blocks out. Use slice 2's own setter name for `setShapes`; if slice 2 keeps shapes in a reducer, dispatch its "added" action instead.

- [ ] **Step 3: Page — load every live board of the project (JSON only)**

Slice 1's loader reads tenant nodes only; schematic blocks link any board. In `page.tsx`, for schematic plans, after slice 2's access gate:

```ts
let detectNodes: { id: string; kind: string; code: string | null; shop_number: string | null; name: string | null }[] = []
if (plan.purpose === 'distribution_schematic') {
  const { data: nodeRows } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id, kind, code, shop_number, shop_name, name')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('code', { ascending: true })
  // PostgREST caps at 1000 rows; a project has ~150 boards. If one ever exceeds
  // 1000, page this read (lib/tender/read-all.ts pattern).
  detectNodes = (nodeRows ?? []).map((n: any) => ({
    id: n.id, kind: n.kind, code: n.code ?? null, shop_number: n.shop_number ?? null, name: n.shop_name ?? n.name ?? null,
  }))
}
```

Pass `detectNodes={detectNodes}` to the workspace. It is plain JSON (no functions), which slice 2's page→client contract test (if present) will confirm.

- [ ] **Step 4: rbac-matrix row**

In `docs/rbac-matrix.md`, in slice 2's Status plans section, add:

```markdown
| `acceptDetectedBlocksAction` (server action, status plan detection) | owner, admin, project_manager (`ORG_WRITE_ROLES`, effective project role) | RESTRICTIVE INSERT on `tenants.status_plan_shapes` (00245); plan must be `distribution_schematic` |
```

(Match the table's existing column layout.)

- [ ] **Step 5: Run the folder's tests, type-check, lint**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/status-plans"
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web lint
```

Expected: PASS; both exit 0.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/" docs/rbac-matrix.md
git commit -m "feat(status-plans): Detect blocks on schematic plans (panel in the plan side panel)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Real-sheet dry run (local, outside git — counts only)

**Files:** none in the repo. The script and its output live in the session scratchpad and are never committed: the sheet is a client drawing and the repo is public.

The spec's evidence for the 300 sheet (152 `NO:` tables, 115 tags, 102 of them matching live nodes) is the yardstick. This task runs the real pipeline — pdf.js legacy build → `textItemsToImageSpace` → `detectBlocks` → `reviewDetection` — on the real file.

- [ ] **Step 1: Get the file**

Ask the owner for a local path to `643/E/300` sheet 1, or open the Dropbox copy once (`open -g <path>`; Dropbox placeholders are 0 bytes until opened). Check: `ls -l <path>` shows a non-zero size. Do not copy it into the worktree.

- [ ] **Step 2: Optional — the project's boards for matching**

With the Management API PAT (see CLAUDE.md "Where things live"), query KINGSWALK's live boards once into the scratchpad as JSON:

```sql
select id, kind, code, shop_number, coalesce(shop_name, name) as name
from structure.nodes n join projects.projects p on p.id = n.project_id
where p.code = 'KINGSWALK' and n.deleted_at is null;
```

Save as `<scratchpad>/kingswalk-nodes.json` (an array). Skip this step if no PAT is available; Step 3 then reports detection counts only.

- [ ] **Step 3: Write and run the scratch script**

`<scratchpad>/detect-300.mts`:

```ts
import { readFileSync, existsSync } from 'node:fs'
const WT = '/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans'
const sp = await import(`${WT}/packages/shared/src/status-plans/index.ts`)
const { getDocument } = await import(`${WT}/node_modules/.pnpm/pdfjs-dist@5.7.284/node_modules/pdfjs-dist/legacy/build/pdf.mjs`)
const [pdfPath, nodesPath] = process.argv.slice(2)
const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), disableFontFace: true, verbosity: 0 }).promise
const page = await doc.getPage(1)
const vp = page.getViewport({ scale: 2 })
const items = sp.textItemsToImageSpace((await page.getTextContent()).items, vp.transform)
const r = sp.detectBlocks(items)
console.log({ rotate: page.rotate, runs: items.length, noLabels: r.labelCount, blocks: r.blocks.length,
  withTag: r.blocks.filter((b: any) => b.tag).length, rejected: r.rejected.length })
if (nodesPath && existsSync(nodesPath)) {
  const review = sp.reviewDetection(r, JSON.parse(readFileSync(nodesPath, 'utf8')), [])
  console.log(review.counts, sp.detectionSummary(review))
}
await doc.destroy()
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec tsx "<scratchpad>/detect-300.mts" "<pdf path>" "<scratchpad>/kingswalk-nodes.json"
```

Expected (from the spec's evidence): `rotate: 90`, `noLabels: 152`, `blocks: 152`, `withTag: 115`, `rejected: 0`; with nodes: `matched` ≈ 102, `needsYou` ≈ 13, `noTag` 37.

- [ ] **Step 4: If the counts differ, investigate before changing anything**

Print `r.rejected` reasons (to the terminal only). Each kind of miss has a different cause and a different fix — decide which before touching a tolerance:
- `the NAME: row was not found` across many blocks → the sheet's row pitch or label alignment exceeds a tolerance; measure 3 real blocks' `baseline` gaps and label `x` spread, then add an **invented** fixture with those proportions to Task 3's tests (red first) before changing `DETECT_TOLERANCES`.
- `withTag` lower than 115 with blocks = 152 → values sit further right than `valueSpan` or pdf.js merged a value with a neighbour's label; add an invented fixture reproducing the geometry.
- `matched` well below 102 → check `MB-x.y` rows first (the alias assumes boards are named `MAIN BOARD x.y` in `code`, `shop_number` or a main board's `name`).

Never paste real tags, names or values into a fixture, a commit message or the PR.

- [ ] **Step 5: Record evidence**

Put the counts line (numbers only) in the PR body under "Real-sheet dry run". Delete `kingswalk-nodes.json` from the scratchpad when done.

---

### Task 12: Whole-branch verification

**Files:** none.

- [ ] **Step 1: All three suites**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db test:ci
```

Expected: all PASS. `src/status-plans` grew by 41 tests over the Task 0 baseline (6 + 13 + 11 + 10 + 1); the web suite gained 6 + 5 + 7 + 10 tests (+ Task 10's if any). `@esite/db` is unchanged by this slice and must stay green.

- [ ] **Step 2: Type-check, lint, production build**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web lint
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web build
```

Expected: all exit 0. `next build` is the only check that catches a non-async export from the `'use server'` file; it must run after the last change.

- [ ] **Step 3: No client data in the diff**

```bash
git diff origin/main --stat
git diff origin/main -- apps packages | grep -nE "KINGSWALK|BOXER|643/E|DB-0[0-9]|MB-3\.1|DB-SR" || echo "clean"
```

Expected: `clean`. Code and fixtures only; the spec and plan documents name the sheet by reference and carry no values from it.

- [ ] **Step 4: Owner walk (cannot be done by the agent — list it in the PR)**

On production after deploy, signed in as owner/admin: Status plans → New → KINGSWALK `643/E/300` sheet 1 → purpose Distribution schematic → Detect blocks → expect "Detected 152 blocks — ~102 matched · ~13 need you · 37 without a tag" → Accept matched → hatches appear per `node_orders` → pick a board for one combined tag → Skip one → Detect again → "152 blocks already on this plan were left out" minus the skipped ones. A contractor opening the same plan sees no Detect blocks panel.

---

## Self-review against the spec

| Spec | Where |
|---|---|
| §5 browser pdf.js `getTextContent`, scale 2, rotation by the viewport | Task 1 (`textItemsToImageSpace`), Task 7 (real pdf.js, `/Rotate 90`, scale pinned to use-sheet-image) |
| §5 step 1 walk NO: down the label column with a height-derived gap tolerance | Task 2 `detectBlocks`, `DETECT_TOLERANCES` |
| §5 step 2 value = items right of the label on the same baseline | Task 2 `valueOf` (+ crowded-neighbour limit, Task 3) |
| §5 step 3 block rectangle with padding | Task 2 box test (exact numbers) |
| §5 steps 4–5 tag, name; empty tag still proposed | Task 2 tests; Task 5 `no_tag`; Task 9 "Add unlinked" with NAME hint |
| §5 matcher normalisation, `MB-x.y`, name tie-break only, exactly one → matched | Task 4 |
| §5 review UI summary, one-click matched, pick/skip, `source='detected'`, `detected_tag` | Tasks 5, 8, 9 |
| §5 re-run proposes only non-overlapping blocks | Task 5 `boxesOverlap` exclusion; Task 9 re-run test |
| §5 / §9 no text layer → explicit message | Task 5 `no_text`; Task 7 blank-page test; Task 9 message test |
| §10 invented fixtures incl. rotated page, empty tag, `DB-90/91`, crowded column; off-column mutation drops not merges | Tasks 2–3 (+ four recorded mutation runs) |
| §7 `{ ok, error }`, no `router.refresh()`, `requireEffectiveRole(...).ok`, JSON page props | Tasks 8, 9, 10 |
| §7 rbac-matrix in the same PR | Task 10 Step 4 |

Interface assumptions on slice 2 are listed in "Dependency on slice 2" above; only Task 10 depends on them.
