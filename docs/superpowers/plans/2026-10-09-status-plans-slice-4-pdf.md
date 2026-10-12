# Status Plans — Slice 4 (PDF report, export, portal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Status plans leave the screen. A server-side pdf-lib renderer draws a status plan as a vector PDF page, with the source drawing page embedded and never rasterised. The tenant schedule report can carry an optional "Tenant status plans" appendix. A plan page offers "Export sheet", a PDF at the drawing's own size. Client-portal users get a read-only view of every plan.

**Architecture:**
- **`pdf-geometry.ts`.** A pure module maps image space to PDF space. Image space is the scale-2 pdf.js raster that every shape is stored in: pdf.js applies `/Rotate`, and a raster drawing uses its natural pixels. Mapping to source user space divides by the px/pt factor, then inverts the rotation. A single affine matrix then places the embedded page and every shape on the output page. pdf.js is the test oracle.
- **`render-plan-page.ts`.**
  - Adds one page to a `PDFDocument`. It embeds the source page with `embedPage` and forces the embed immediately, so a bad drawing fails here rather than inside the report's `save()`.
  - Draws each shape from `palette.ts` styles: fill with opacity through an ExtGState, the shared `hatchSegments` hatch, stroke and dash. Shapes are clipped to the drawing.
  - Draws a label at `visualCentre`, a title strip and a legend with counts.
  - Two layouts: `a3` (fit to A3 landscape, used by the appendix and the portal) and `source` (1:1 at the drawing's own size, used by Export sheet).
- **`plan-render-data.ts`.**
  - Turns plan rows into render inputs. Plan, shape, drawing and node rows are read through the caller's session (RLS + site_scope).
  - Shop and DB order facts are read with the service client, after the caller's gate.
  - Drawing bytes come from the `drawings` bucket with the service client.
  - Applies count and byte caps. A missing or unreadable drawing becomes a "not included" line, never a thrown error.
- **`appendix.ts`.** Appends plan pages, then inserts a divider page in front of them. The divider lists what is in the appendix and what was left out, and why. The pattern is lifted from `lib/cable-schedule/route-sheets.ts`.
- **Routes:**
  - The two tenant-report routes take `?tenantPlans=1&schematicPlans=1` through one helper (`report-appendix.ts`).
  - New `GET /api/projects/[id]/status-plans/[planId]/sheet` for Export sheet.
  - New `GET /api/portal/[projectId]/status-plans/[planId]/pdf` behind `requirePortalAccess`.
  - New portal page `/portal/[projectId]/status-plans`.

**Tech Stack:** pdf-lib 1.17 (`embedPage`, raw content-stream operators, `insertPage`); pdfjs-dist 5 (legacy build, used only as a test oracle); `@esite/shared/status-plans` (slice 1); Next.js 15 route handlers; Vitest. Byte-level tests run under `// @vitest-environment node`; component tests run under jsdom.

**Spec:** `docs/superpowers/specs/2026-10-09-status-plans-design.md` §7 (portal bullet), §8, §9, §10.
**Depends on:** slice 1 (`docs/superpowers/plans/2026-10-09-status-plans-slice-1-data.md`, "Interfaces for later slices"), merged; slices 2 and 3 for the plan page that hosts the Export sheet button (Task 9).

---

## Assumptions (read before starting; each is checked by a test or an explicit step)

1. **Slice 1 shipped exactly its "Interfaces for later slices" list:**
   - `@esite/shared/status-plans` is a subpath export.
   - `loadTenantShopFacts` lives in `@/lib/tenant-schedule/shop-facts`; `shopLinkFor` lives in `@/lib/status-plans/shop-link`.
   - Tables are `tenants.status_plans` and `tenants.status_plan_shapes`.
   - If a name differs, fix the import, not the assertion.
2. **Image space:**
   - PDFs are rasterised at `getViewport({ scale: 2 })` with the page's own `/Rotate` (`lib/sheet/use-sheet-image.ts:65`). The viewBox is the **CropBox**.
   - Rasters use `naturalWidth`/`naturalHeight` (px = 1 unit). EXIF orientation of JPEGs is NOT corrected by pdf-lib; this is a known gap, listed in the PR body.
   - The Task 1 oracle test proves the PDF half against pdf.js itself.
3. **pdf-lib's form XObject.** `embedPage(page, bbox)` writes `/BBox [l b r t]` and `/Matrix [1 0 0 1 -l -b]`, so form space = source user space − (l, b). Task 2 asserts both entries in the output bytes rather than trusting this.
4. **DB order status for schematic nodes.** Slice 1 says "slice 3 will add its own loader" and the slice-2 plan may define one too. Neither plan existed when this was written. Task 3 defines `loadSchematicOrderStatus(client, { orgId, nodeIds })` in `lib/status-plans/schematic-order-status.ts`. **If slice 2 or 3 already shipped an equivalent, delete Task 3's file and import theirs** (the signature differs only in argument shape). Do not ship two.
5. **The plan page route is `app/(admin)/projects/[id]/status-plans/[planId]/page.tsx`** (spec §7, slice 2). Task 9 only adds a button to its header.
6. **Query parameters.** Appendix choice is `?tenantPlans=1` and `?schematicPlans=1`. Absent means no appendix, so every existing caller is byte-identical. The dialog defaults to tenant plans on and schematics off (spec §8).
7. **Measured area.** The plan total sums **linked shop shapes only**. Mall, plant and services areas are labelled with their own m² but are not added to the shop total.
8. **The portal view is a PDF per plan** (the same `a3` renderer), opened in a new tab. It does not use a Konva canvas.
   - Both purposes are shown: the portal's Equipment & Materials tab already shows per-board order status, so schematic hatches reveal nothing new.
   - Owner decision recorded in the PR: hide schematics from the portal if that is not wanted.
9. **Response size.** Vercel functions cap a buffered response at about 4.5 MB. A vector A0 sheet or a report with many plans can exceed that.
   - Task 12 measures this on a large real-scale fixture.
   - If it is exceeded, the documented fallback is: upload to the `reports` bucket and `302` to a short-lived signed URL. It is not built speculatively.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/lib/status-plans/pdf-geometry.ts` (+ `.test.ts`) | `normaliseRotation`, `viewedSize`, `imageToPdfPoint`, `placementFor`, `applyMatrix`, `imageToOutput` — pure |
| `apps/web/src/test/pdf-ops.ts` | Test helper: decoded streams, painted paths, `cm … Do` matrices |
| `apps/web/src/lib/status-plans/render-plan-page.ts` (+ `.test.ts`) | `drawStatusPlanPage`, `renderStatusPlanPdf`, `StatusPlanSourceError`, `planTitle`, `layoutFor` |
| `apps/web/src/lib/status-plans/query-helpers.ts` | `inChunks`, `readAllPages` (PostgREST `max_rows = 1000`) |
| `apps/web/src/lib/status-plans/schematic-order-status.ts` (+ `.test.ts`) | `loadSchematicOrderStatus` (see Assumption 4) |
| `apps/web/src/lib/status-plans/plan-render-data.ts` (+ `.test.ts`) | `loadStatusPlanRenderInputs`, `orderPlans`, `sourceKindFor`, `scaleForPage`, caps |
| `apps/web/src/lib/status-plans/appendix-options.ts` (+ `.test.ts`) | Pure query-param helpers (safe for the client bundle — no pdf-lib) |
| `apps/web/src/lib/status-plans/appendix.ts` (+ `.test.ts`) | `appendStatusPlansToPdf`, `appendStatusPlansToReport` |
| `apps/web/src/lib/status-plans/report-appendix.ts` (+ `.test.ts`) | `loadReportAppendix` — gate + load + never-throw, shared by both report routes |
| `apps/web/src/lib/reports/render-tenant-schedule.ts` (modify) | Optional third argument: the appendix |
| `apps/web/src/lib/reports/render-tenant-schedule.render.test.ts` (modify) | Appendix pages + fallback |
| `apps/web/src/app/api/projects/[id]/tenant-schedule/report-preview/route.ts` (modify, + `route.test.ts`) | Pass the appendix |
| `apps/web/src/app/api/projects/[id]/tenant-schedule/reports/route.ts` (modify, + `route.test.ts`) | Pass the appendix |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx` (+ test) | Two checkboxes; preview and save carry the same query |
| `apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts` (+ `route.test.ts`) | Export sheet (source size, attachment) |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/_components/ExportSheetButton.tsx` (+ test) | fetch → blob → download, sentence on failure |
| `apps/web/src/lib/portal/data.ts` (modify) | `listPortalStatusPlans` |
| `apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.ts` (+ `route.test.ts`) | Portal PDF, inline |
| `apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.tsx` (+ `page.test.tsx`) | Portal list |
| `apps/web/src/components/portal/PortalProjectNav.tsx` (modify) | "Status Plans" tab |
| `docs/rbac-matrix.md` (modify) | New rows |

Command prefix used throughout (the pnpm store and temp files must stay on the SSD):

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans" && export TMPDIR="/Volumes/Extreme SSD/tmp"
```

---

### Task 1: Image space → PDF space (pure geometry)

**Files:**
- Create: `apps/web/src/lib/status-plans/pdf-geometry.ts`
- Test: `apps/web/src/lib/status-plans/pdf-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/status-plans/pdf-geometry.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, degrees } from 'pdf-lib'
import {
  normaliseRotation, viewedSize, imageToPdfPoint, placementFor, applyMatrix, imageToOutput,
  type PageBox, type QuarterTurn,
} from './pdf-geometry'

const BOX: PageBox = { x: 0, y: 0, width: 600, height: 400 }
const OFFSET: PageBox = { x: 50, y: 20, width: 600, height: 400 }
const TURNS: QuarterTurn[] = [0, 90, 180, 270]

describe('normaliseRotation', () => {
  it('folds any multiple of 90 into 0..270 and refuses the rest like pdf.js does', () => {
    expect(normaliseRotation(0)).toBe(0)
    expect(normaliseRotation(90)).toBe(90)
    expect(normaliseRotation(-90)).toBe(270)
    expect(normaliseRotation(450)).toBe(90)
    expect(normaliseRotation(-540)).toBe(180)
    expect(normaliseRotation(45)).toBe(0)
    expect(normaliseRotation(Number.NaN)).toBe(0)
  })
})

describe('viewedSize', () => {
  it('swaps width and height for a quarter turn', () => {
    expect(viewedSize(BOX, 0)).toEqual({ width: 600, height: 400 })
    expect(viewedSize(BOX, 90)).toEqual({ width: 400, height: 600 })
    expect(viewedSize(BOX, 180)).toEqual({ width: 600, height: 400 })
    expect(viewedSize(BOX, 270)).toEqual({ width: 400, height: 600 })
  })
})

describe('imageToPdfPoint — hand table (viewed point (100 pt, 50 pt) = image px (200, 100))', () => {
  // /Rotate turns the page CLOCKWISE for display (PDF 32000 §7.7.3.3).
  it.each([
    [0, BOX, { x: 100, y: 350 }],
    [90, BOX, { x: 50, y: 100 }],
    [180, BOX, { x: 500, y: 50 }],
    [270, BOX, { x: 550, y: 300 }],
    [90, OFFSET, { x: 100, y: 120 }],
  ] as const)('rotate %i', (r, box, want) => {
    const got = imageToPdfPoint({ x: 200, y: 100 }, box, r)
    expect(got.x).toBeCloseTo(want.x, 9)
    expect(got.y).toBeCloseTo(want.y, 9)
  })
  it('a raster drawing is 1 px per unit and never rotated', () => {
    expect(imageToPdfPoint({ x: 200, y: 100 }, { x: 0, y: 0, width: 400, height: 200 }, 0, 1)).toEqual({ x: 200, y: 100 })
  })
})

describe('placementFor', () => {
  it('a frame of exactly the viewed size is 1:1', () => {
    const p = placementFor(BOX, 90, { x: 0, y: 30, width: 400, height: 600 })
    expect(p.scale).toBe(1)
    expect(p.drawn).toEqual({ x: 0, y: 30, width: 400, height: 600 })
  })
  it('fits and centres in a larger frame, keeping the aspect ratio', () => {
    const p = placementFor(BOX, 0, { x: 0, y: 0, width: 1000, height: 600 })
    expect(p.scale).toBeCloseTo(1.5, 9)
    expect(p.drawn).toEqual({ x: 50, y: 0, width: 900, height: 600 })
  })
  it.each(TURNS)('rotate %i: the matrix maps the form box onto the drawn rectangle', (r) => {
    const p = placementFor(OFFSET, r, { x: 10, y: 20, width: 700, height: 500 })
    const corners = [[0, 0], [600, 0], [600, 400], [0, 400]].map(([x, y]) => applyMatrix(p.matrix, { x: x!, y: y! }))
    const d = p.drawn
    const want = [[d.x, d.y], [d.x + d.width, d.y], [d.x + d.width, d.y + d.height], [d.x, d.y + d.height]]
    const key = (q: { x: number; y: number }) => `${q.x.toFixed(6)},${q.y.toFixed(6)}`
    expect(new Set(corners.map(key))).toEqual(new Set(want.map(([x, y]) => key({ x: x!, y: y! }))))
  })
})

describe('imageToOutput', () => {
  // Second derivation, independent of the matrix algebra: on the output page the viewed sheet sits in
  // `drawn`, y up, so image px (u, v) lands at (drawn.x + k·u/2, drawn.top − k·v/2).
  it.each(TURNS)('rotate %i agrees with the viewed-sheet derivation', (r) => {
    const p = placementFor(OFFSET, r, { x: 24, y: 70, width: 950, height: 700 })
    const v = viewedSize(OFFSET, r)
    for (const [u, w] of [[0, 0], [v.width * 2, v.height * 2], [123.4, 77.7], [640, 10]]) {
      const got = imageToOutput({ x: u!, y: w! }, OFFSET, r, p)
      expect(got.x).toBeCloseTo(p.drawn.x + (p.scale * u!) / 2, 6)
      expect(got.y).toBeCloseTo(p.drawn.y + p.drawn.height - (p.scale * w!) / 2, 6)
    }
  })
})

describe('imageToPdfPoint — pdf.js is the oracle', () => {
  // The live viewer maps with pdf.js; this asserts our inverse against pdf.js's own convertToPdfPoint.
  async function pdfjs() {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const req = createRequire(import.meta.url)
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    return lib
  }
  it.each(TURNS)('matches getViewport({ scale: 2 }) for /Rotate %i on an offset MediaBox', async (r) => {
    const d = await PDFDocument.create()
    const page = d.addPage([600, 400])
    page.setMediaBox(50, 20, 600, 400)
    page.setRotation(degrees(r))
    const box = page.getCropBox()
    const lib = await pdfjs()
    const doc = await lib.getDocument({ data: await d.save(), isEvalSupported: false }).promise
    const vp = (await doc.getPage(1)).getViewport({ scale: 2 })
    for (const [vx, vy] of [[0, 0], [vp.width, 0], [vp.width, vp.height], [123.4, 77.7]]) {
      const [ex, ey] = vp.convertToPdfPoint(vx!, vy!) as [number, number]
      const got = imageToPdfPoint({ x: vx!, y: vy! }, box, r)
      expect(got.x).toBeCloseTo(ex, 6)
      expect(got.y).toBeCloseTo(ey, 6)
    }
    await doc.destroy()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/pdf-geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./pdf-geometry"`.

> If the pdf.js block fails because `pdfjs-dist/legacy/build/pdf.mjs` will not load under Vitest (module or type resolution), try `import('pdfjs-dist')` with workerSrc `pdfjs-dist/build/pdf.worker.mjs`. Keep the oracle: it is the only test here that does not share an author with the code. If `tsc` lacks a declaration for the legacy path, add `// @ts-expect-error -- pdfjs legacy build ships no d.ts` on the import line only.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/status-plans/pdf-geometry.ts
/**
 * Image space → PDF space for status plans.
 *
 * Image space is what every saved shape is stored in (spec §4): a PDF drawing rasterised by pdf.js at
 * `getViewport({ scale: 2 })` — which APPLIES the page's /Rotate and uses its CropBox — or a raster
 * drawing at its natural pixels (1 px per unit, never rotated). So a stored point is a point on the
 * VIEWED sheet, y down.
 *
 * pdf.js's viewport transform (display/display_utils.js, PageViewport) for viewBox [x0 y0 x1 y1],
 * scale s, rotation r, is, with (u, v) = image px ÷ s:
 *   r=0   u = x − x0,  v = y1 − y        r=180 u = x1 − x,  v = y − y0
 *   r=90  u = y − y0,  v = x − x0        r=270 u = y1 − y,  v = x1 − x
 * imageToPdfPoint is its inverse. The pdf.js oracle test in pdf-geometry.test.ts proves it.
 *
 * pdf-lib's embedPage(bbox) makes a form whose space is source − (x0, y0). placementFor returns the
 * single matrix M that draws that form turned and fitted into a frame, so the embedded drawing and
 * every shape (source point − origin, then M) share one transform and cannot drift apart.
 */

export type QuarterTurn = 0 | 90 | 180 | 270
export interface PageBox { x: number; y: number; width: number; height: number }
export interface Pt { x: number; y: number }
export interface Frame { x: number; y: number; width: number; height: number }
/** PDF `cm` order: X = a·x + c·y + e, Y = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number]
export interface Placement {
  matrix: Matrix
  /** Output points per source point. */
  scale: number
  /** Where the viewed sheet sits on the output page. */
  drawn: Frame
}

/** use-sheet-image rasterises PDFs at scale 2. Changing it would move every saved coordinate. */
export const PDF_PX_PER_PT = 2
/** Raster drawings: one image pixel per unit. */
export const IMAGE_PX_PER_PT = 1

/** pdf.js: a /Rotate that is not a multiple of 90 is treated as 0. */
export function normaliseRotation(angle: number): QuarterTurn {
  if (!Number.isFinite(angle) || angle % 90 !== 0) return 0
  return ((((angle % 360) + 360) % 360) as QuarterTurn)
}

export function viewedSize(box: PageBox, rotate: QuarterTurn): { width: number; height: number } {
  return rotate === 90 || rotate === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height }
}

/** A stored image-space point → the source page's user space (inverse of pdf.js's viewport). */
export function imageToPdfPoint(pt: Pt, box: PageBox, rotate: QuarterTurn, pxPerPt: number = PDF_PX_PER_PT): Pt {
  const u = pt.x / pxPerPt
  const v = pt.y / pxPerPt
  const x0 = box.x
  const y0 = box.y
  const x1 = box.x + box.width
  const y1 = box.y + box.height
  switch (rotate) {
    case 0: return { x: x0 + u, y: y1 - v }
    case 90: return { x: x0 + v, y: y0 + u }
    case 180: return { x: x1 - u, y: y0 + v }
    case 270: return { x: x1 - v, y: y1 - u }
  }
}

/**
 * Fit the viewed sheet into `frame` (centred, aspect kept) and return the matrix that draws the
 * embedded form there. Derivation (W, H = box size, k = scale, (ox, oy) = drawn origin):
 *   r=0   [ k  0  0  k  ox        oy       ]
 *   r=90  [ 0 −k  k  0  ox        oy + kW  ]
 *   r=180 [−k  0  0 −k  ox + kW   oy + kH  ]
 *   r=270 [ 0  k −k  0  ox + kH   oy       ]
 * i.e. a rotation of −r degrees (PDF /Rotate is clockwise) then a translation.
 */
export function placementFor(box: PageBox, rotate: QuarterTurn, frame: Frame): Placement {
  const v = viewedSize(box, rotate)
  const k = Math.min(frame.width / v.width, frame.height / v.height)
  const dw = v.width * k
  const dh = v.height * k
  const ox = frame.x + (frame.width - dw) / 2
  const oy = frame.y + (frame.height - dh) / 2
  const W = box.width
  const H = box.height
  let matrix: Matrix
  switch (rotate) {
    case 0: matrix = [k, 0, 0, k, ox, oy]; break
    case 90: matrix = [0, -k, k, 0, ox, oy + k * W]; break
    case 180: matrix = [-k, 0, 0, -k, ox + k * W, oy + k * H]; break
    case 270: matrix = [0, k, -k, 0, ox + k * H, oy]; break
  }
  return { matrix, scale: k, drawn: { x: ox, y: oy, width: dw, height: dh } }
}

export function applyMatrix(m: Matrix, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

/** A stored image-space point → the output page, through the same matrix as the embedded drawing. */
export function imageToOutput(pt: Pt, box: PageBox, rotate: QuarterTurn, placement: Placement, pxPerPt: number = PDF_PX_PER_PT): Pt {
  const s = imageToPdfPoint(pt, box, rotate, pxPerPt)
  return applyMatrix(placement.matrix, { x: s.x - box.x, y: s.y - box.y })
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/pdf-geometry.test.ts`
Expected: PASS (about 24 tests).

**Mutation check (do it, then revert):** swap the `case 90` and `case 270` bodies in `imageToPdfPoint`. The hand table and the pdf.js oracle must both go red. Record the counts in the PR body.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/pdf-geometry.ts apps/web/src/lib/status-plans/pdf-geometry.test.ts
git commit -m "feat(status-plans): image-space to PDF-space mapping for every /Rotate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Vector plan page renderer

**Files:**
- Create: `apps/web/src/test/pdf-ops.ts`
- Create: `apps/web/src/lib/status-plans/render-plan-page.ts`
- Test: `apps/web/src/lib/status-plans/render-plan-page.test.ts`

- [ ] **Step 1: Write the test helper**

```ts
// apps/web/src/test/pdf-ops.ts
/**
 * Test helper: read what a pdf-lib PDF actually DRAWS. Coordinates are asserted on the decoded
 * content streams, never on "a PDF rendered" (spec §10). Node only — use `// @vitest-environment node`.
 */
import zlib from 'node:zlib'

/** Every stream body, Flate-inflated when it inflates, else raw — latin1 text. */
export function pdfStreams(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes)
  const out: string[] = []
  const open = Buffer.from('stream')
  const close = Buffer.from('endstream')
  let cursor = 0
  for (;;) {
    const s = buf.indexOf(open, cursor)
    if (s === -1) break
    const e = buf.indexOf(close, s + open.length)
    if (e === -1) break
    let start = s + open.length
    while (buf[start] === 0x0d || buf[start] === 0x0a) start++
    const chunk = buf.subarray(start, e)
    try { out.push(zlib.inflateSync(chunk).toString('latin1')) } catch { out.push(chunk.toString('latin1')) }
    cursor = e + close.length
  }
  return out
}

/** Raw file text plus every decoded stream (object-stream dictionaries are only visible decoded). */
export function pdfAllText(bytes: Uint8Array): string {
  return `${Buffer.from(bytes).toString('latin1')}\n${pdfStreams(bytes).join('\n')}`
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`

export interface PaintedPath { points: Array<[number, number]>; moves: number; closed: boolean; paint: 'S' | 'f' | 'B' }

/** Paths built with m/l/h and painted with S, f or B, in drawing order. */
export function paintedPaths(stream: string): PaintedPath[] {
  const re = new RegExp(String.raw`(${NUM})\s+(${NUM})\s+([ml])(?![\w])|(?<![\w/.-])(h|S|f|B)(?![\w*])`, 'g')
  const out: PaintedPath[] = []
  let points: Array<[number, number]> = []
  let moves = 0
  let closed = false
  for (const m of stream.matchAll(re)) {
    if (m[3]) {
      if (m[3] === 'm') moves++
      points.push([Number(m[1]), Number(m[2])])
      continue
    }
    if (m[4] === 'h') { closed = true; continue }
    if (points.length) out.push({ points, moves, closed, paint: m[4] as PaintedPath['paint'] })
    points = []
    moves = 0
    closed = false
  }
  return out
}

/** The 6 numbers of the `cm` immediately before `/<prefix…> Do`. */
export function cmBeforeDo(stream: string, namePrefix: string): number[][] {
  const re = new RegExp(String.raw`((?:${NUM}\s+){6})cm\s+\/(${namePrefix}[^\s/]*)\s+Do`, 'g')
  return [...stream.matchAll(re)].map((m) => m[1]!.trim().split(/\s+/).map(Number))
}

export function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

export function samePoints(got: Array<[number, number]>, want: Array<[number, number]>, tol = 0.02): boolean {
  return got.length === want.length && want.every(([x, y]) => got.some(([gx, gy]) => near(gx, x, tol) && near(gy, y, tol)))
}
```

- [ ] **Step 2: Write the failing renderer test**

```ts
// apps/web/src/lib/status-plans/render-plan-page.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { TENANT_LEGEND, hatchSegments, type ShapeStyle } from '@esite/shared/status-plans'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'
import { extractPdfText, squash } from '@/test/pdf-text'
import { pdfStreams, pdfAllText, paintedPaths, cmBeforeDo, samePoints, near } from '@/test/pdf-ops'
import {
  renderStatusPlanPdf, drawStatusPlanPage, StatusPlanSourceError, A3_LANDSCAPE,
  type StatusPlanRenderInput, type RenderShape,
} from './render-plan-page'

/** A source drawing: MediaBox at `origin`, /Rotate r, and a 10 pt marker square whose corner is at `marker`. */
async function sourcePdf(o: { r?: number; origin?: [number, number]; marker?: [number, number]; pages?: number } = {}) {
  const d = await PDFDocument.create()
  for (let i = 0; i < (o.pages ?? 1); i++) {
    const p = d.addPage([600, 400])
    const [ox, oy] = o.origin ?? [0, 0]
    p.setMediaBox(ox, oy, 600, 400)
    p.setRotation(degrees(o.r ?? 0))
    const [mx, my] = o.marker ?? [500, 300]
    p.drawRectangle({ x: mx, y: my, width: 10, height: 10, color: rgb(0, 0, 1) })
  }
  return d.save()
}

const PLAIN: ShapeStyle = { fill: null, fillOpacity: 0, stroke: '#112233', strokeWidth: 3, dash: null, hatches: [], strikeLabel: false }
const SQUARE = [100, 100, 300, 100, 300, 300, 100, 300] // image px

function shape(over: Partial<RenderShape> = {}): RenderShape {
  return { points: SQUARE, style: PLAIN, legendKey: 'complete', label: null, ...over }
}

function input(bytes: Uint8Array, over: Partial<StatusPlanRenderInput> = {}): StatusPlanRenderInput {
  return {
    planId: 'p1', planName: 'Ground floor tenants', purpose: 'tenant_layout', drawingName: 'Tenant layout',
    pageIndex: 1, generatedOn: '2026-10-09', source: { kind: 'pdf', bytes, pageIndex: 1 },
    shapes: [shape()], legend: TENANT_LEGEND, measured: null, warnings: [], ...over,
  }
}

async function pageInfo(bytes: Uint8Array) {
  const p = (await PDFDocument.load(bytes)).getPage(0)
  return { width: p.getWidth(), height: p.getHeight() }
}

/** The page content stream: the one that draws the embedded sheet. */
function pageStream(bytes: Uint8Array): string {
  const s = pdfStreams(bytes).find((t) => /\/S[PI][^\s/]*\s+Do/.test(t))
  if (!s) throw new Error('no page content stream drawing the sheet')
  return s
}

const apply = (m: number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!]

describe('renderStatusPlanPdf — source layout (Export sheet)', () => {
  it.each([0, 90, 180, 270])('/Rotate %i: the shape lands where it sits on the viewed sheet', async (r) => {
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r })), 'source')
    const { width, height } = await pageInfo(out)
    expect(width).toBeCloseTo(r === 90 || r === 270 ? 400 : 600, 2)
    // Image px (100,100)…(300,300) ÷ 2 → viewed pt (50,50)…(150,150), y measured down from the page top.
    const want: Array<[number, number]> = [[50, height - 50], [150, height - 50], [150, height - 150], [50, height - 150]]
    const outline = paintedPaths(pageStream(out)).find((p) => p.paint === 'S' && p.closed && samePoints(p.points, want))
    expect(outline, JSON.stringify(paintedPaths(pageStream(out)).slice(0, 6))).toBeDefined()
  })

  // Hand-derived from "/Rotate turns the page clockwise": the marker corner at source (500, 300) on a
  // 600×400 page is viewed at r0 (500,100) · r90 (300,500) · r180 (100,300) · r270 (100,100), y down.
  it.each([
    [0, [500, 100]], [90, [300, 500]], [180, [100, 300]], [270, [100, 100]],
  ] as const)('/Rotate %i: the embedded drawing is placed where pdf.js shows it', async (r, [u, v]) => {
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r })), 'source')
    const { height } = await pageInfo(out)
    const [m] = cmBeforeDo(pageStream(out), 'SP')
    expect(m).toBeDefined()
    const [x, y] = apply(m!, 500, 300)
    expect(near(x, u)).toBe(true)
    expect(near(y, height - v)).toBe(true)
  })

  it('honours a MediaBox that does not start at 0,0', async () => {
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r: 90, origin: [50, 20], marker: [550, 320] })), 'source')
    const all = pdfAllText(out)
    expect(all).toMatch(/\/BBox\s*\[\s*50\s+20\s+650\s+420\s*\]/)
    expect(all).toMatch(/\/Matrix\s*\[\s*1\s+0\s+0\s+1\s+-50\s+-20\s*\]/)
    const { height } = await pageInfo(out)
    const [m] = cmBeforeDo(pageStream(out), 'SP')
    const [x, y] = apply(m!, 550 - 50, 320 - 20) // form space = source − origin (asserted above)
    expect(near(x, 300)).toBe(true)
    expect(near(y, height - 500)).toBe(true)
  })

  it('embeds the drawing as vector (a form XObject), never as an image', async () => {
    const all = pdfAllText(await renderStatusPlanPdf(input(await sourcePdf()), 'source'))
    expect(all).toMatch(/\/Subtype\s*\/Form/)
    expect(all).not.toMatch(/\/Subtype\s*\/Image/)
  })
})

describe('renderStatusPlanPdf — A3 layout (report appendix, portal)', () => {
  it('fits the turned sheet into A3 landscape and keeps shapes on the drawing', async () => {
    const full = shape({ points: [0, 0, 800, 0, 800, 1200, 0, 1200] }) // the whole viewed sheet of a /Rotate 90 page
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r: 90 }), { shapes: [full] }), 'a3')
    const { width, height } = await pageInfo(out)
    expect(width).toBeCloseTo(A3_LANDSCAPE[0], 1)
    expect(height).toBeCloseTo(A3_LANDSCAPE[1], 1)
    const [m] = cmBeforeDo(pageStream(out), 'SP')
    const box: Array<[number, number]> = [apply(m!, 0, 0), apply(m!, 600, 0), apply(m!, 600, 400), apply(m!, 0, 400)]
    const outline = paintedPaths(pageStream(out)).find((p) => p.paint === 'S' && p.closed && samePoints(p.points, box))
    expect(outline).toBeDefined()
    for (const [x] of box) expect(x).toBeLessThan(A3_LANDSCAPE[0] - 24 - 200)
  })
})

describe('styles', () => {
  it('draws the shared hatch — one subpath per hatchSegments segment, all inside the shape', async () => {
    const hatched: ShapeStyle = { ...PLAIN, hatches: [{ angleDeg: 45, spacing: 14, color: '#D64545', width: 2 }] }
    const out = await renderStatusPlanPdf(input(await sourcePdf(), { shapes: [shape({ style: hatched })] }), 'source')
    const { height } = await pageInfo(out)
    const n = hatchSegments(SQUARE, { angleDeg: 45, spacing: 14 }).length
    expect(n).toBeGreaterThan(5)
    const hatch = paintedPaths(pageStream(out)).find((p) => p.paint === 'S' && !p.closed && p.moves === n)
    expect(hatch).toBeDefined()
    for (const [x, y] of hatch!.points) {
      expect(x).toBeGreaterThanOrEqual(50 - 0.02); expect(x).toBeLessThanOrEqual(150 + 0.02)
      expect(y).toBeGreaterThanOrEqual(height - 150 - 0.02); expect(y).toBeLessThanOrEqual(height - 50 + 0.02)
    }
  })

  it('fills through an ExtGState carrying the palette opacity', async () => {
    const filled: ShapeStyle = { ...PLAIN, fill: '#2E9E4F', fillOpacity: 0.45 }
    const out = await renderStatusPlanPdf(input(await sourcePdf(), { shapes: [shape({ style: filled })] }), 'source')
    expect(pdfAllText(out)).toMatch(/\/ca\s+0\.45/)
    expect(paintedPaths(pageStream(out)).some((p) => p.paint === 'f' && p.closed)).toBe(true)
  })
})

describe('text', () => {
  it('every label, title and warning is WinAnsi-safe, with hostile input', async () => {
    const out = await renderStatusPlanPdf(input(await sourcePdf(), {
      planName: 'Plan → “east” ✓',
      shapes: [shape({ label: { primary: 'Shop → 12 ✓', secondary: 'Ω ≤ 中文 Café', areaM2: 123.456 } })],
      warnings: ['The drawing file has changed since this plan was drawn'],
    }), 'source')
    const text = extractPdfText(Buffer.from(out))
    expect(isWinAnsiSafe(text)).toBe(true)
    expect(text).not.toContain('→')
    expect(squash(text)).toContain('Shop->12')
    expect(squash(text)).toContain('123.5m²')
    expect(squash(text)).toContain('Thedrawingfilehaschanged')
  })

  it('the legend counts shapes per legend key', async () => {
    const out = await renderStatusPlanPdf(input(await sourcePdf(), {
      shapes: [shape({ legendKey: 'complete' }), shape({ legendKey: 'complete' }), shape({ legendKey: 'in_progress' })],
    }), 'source')
    const text = squash(extractPdfText(Buffer.from(out)))
    const label = (k: string) => squash(TENANT_LEGEND.find((e) => e.key === k)!.label)
    expect(text).toContain(`${label('complete')}2`)
    expect(text).toContain(`${label('in_progress')}1`)
    expect(text).toContain(`${label('vacant')}0`)
  })
})

describe('unreadable sources fail with a sentence and add no page', () => {
  async function attempt(source: StatusPlanRenderInput['source']) {
    const doc = await PDFDocument.create()
    const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
    const err = await drawStatusPlanPage(doc, input(new Uint8Array(), { source }), 'a3', fonts).then(() => null, (e: unknown) => e)
    return { err, pages: doc.getPageCount() }
  }
  it('not a PDF', async () => {
    const { err, pages } = await attempt({ kind: 'pdf', bytes: new TextEncoder().encode('not a pdf'), pageIndex: 1 })
    expect(err).toBeInstanceOf(StatusPlanSourceError)
    expect((err as Error).message).toBe('the drawing PDF could not be read')
    expect(pages).toBe(0)
  })
  it('page out of range', async () => {
    const { err } = await attempt({ kind: 'pdf', bytes: await sourcePdf(), pageIndex: 3 })
    expect((err as Error).message).toBe('page 3 is not in the drawing (it has 1)')
  })
  it('password-protected', async () => {
    const d = await PDFDocument.create()
    d.addPage([200, 200])
    d.context.trailerInfo.Encrypt = d.context.obj({ Filter: 'Standard' })
    const { err } = await attempt({ kind: 'pdf', bytes: await d.save({ useObjectStreams: false }), pageIndex: 1 })
    expect((err as Error).message).toBe('the drawing PDF is password-protected')
  })
})

describe('raster drawings', () => {
  function crc32(buf: Buffer): number {
    let crc = 0xffffffff
    for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1 }
    return (crc ^ 0xffffffff) >>> 0
  }
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  /** A real w×h RGB PNG — NOT 1×1: a square fixture could not catch a swapped width/height. */
  function png(w: number, h: number): Uint8Array {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
    const raw = Buffer.alloc((w * 3 + 1) * h, 0xff)
    for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0
    return new Uint8Array(Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]))
  }
  it('draws a PNG at 1 px per unit and maps shapes without the ÷2', async () => {
    const shapes = [shape({ points: [100, 50, 300, 50, 300, 150, 100, 150] })]
    const out = await renderStatusPlanPdf(input(new Uint8Array(), { source: { kind: 'png', bytes: png(400, 200) }, shapes }), 'source')
    const { width, height } = await pageInfo(out)
    expect(width).toBeCloseTo(400, 2)
    const [m] = cmBeforeDo(pageStream(out), 'SI')
    expect(m!.slice(0, 4)).toEqual([400, 0, 0, 200])
    const want: Array<[number, number]> = [[100, height - 50], [300, height - 50], [300, height - 150], [100, height - 150]]
    expect(paintedPaths(pageStream(out)).some((p) => p.paint === 'S' && p.closed && samePoints(p.points, want))).toBe(true)
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/render-plan-page.test.ts`
Expected: FAIL — `Failed to resolve import "./render-plan-page"`.

- [ ] **Step 4: Implement**

```ts
// apps/web/src/lib/status-plans/render-plan-page.ts
/**
 * One status plan as a vector PDF page (spec 2026-10-09 §8).
 *
 * The source drawing page is EMBEDDED (pdf-lib embedPage → form XObject), never rasterised, and
 * every shape is drawn in vector on top from the single palette (palette.ts) with the shared hatch
 * (geometry.ts hatchSegments), so the canvas, the legend and this page cannot disagree.
 *
 * Two layouts:
 *   'a3'     — fitted to A3 landscape with a legend column and a title strip (report appendix, portal)
 *   'source' — the drawing at 1:1, a band below for title and legend (schematic "Export sheet")
 *
 * Every string drawn goes through winAnsiSafe: pdf-lib's standard fonts THROW on anything outside
 * WinAnsi (PR #154). `m²` is safe; `→ ✓ Ω` are not.
 *
 * Failure model: the source is resolved (loaded, page checked, embedded) BEFORE a page is added, and
 * the embed is forced with `.embed()` — pdf-lib otherwise embeds lazily inside `save()`, where one bad
 * drawing would fail the whole report. A failure is a StatusPlanSourceError carrying a sentence the
 * appendix divider and the Export sheet route show as-is.
 */
import {
  PDFDocument, StandardFonts, EncryptedPDFError, rgb,
  pushGraphicsState, popGraphicsState, setGraphicsState, concatTransformationMatrix, drawObject,
  rectangle, clip, endPath, moveTo, lineTo, closePath, fill, stroke,
  setFillingRgbColor, setStrokingRgbColor, setLineWidth, setDashPattern,
  type PDFFont, type PDFPage, type PDFName, type PDFOperator,
} from 'pdf-lib'
import {
  PURPOSE_LABEL, boundingBox, hatchSegments, hexToRgb01, visualCentre,
  type HatchSpec, type LegendEntry, type Segment, type ShapeStyle, type StatusPlanPurpose,
} from '@esite/shared/status-plans'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import {
  IMAGE_PX_PER_PT, PDF_PX_PER_PT, imageToOutput, normaliseRotation, placementFor, viewedSize,
  type Frame, type PageBox, type Placement, type QuarterTurn,
} from './pdf-geometry'

export type PlanSource =
  | { kind: 'pdf'; bytes: Uint8Array; /** 1-based */ pageIndex: number }
  | { kind: 'png' | 'jpg'; bytes: Uint8Array }

export interface PlanLabel { primary: string; secondary?: string | null; areaM2?: number | null }

export interface RenderShape {
  /** Image space, flat [x0, y0, …] — exactly as stored. */
  points: readonly number[]
  style: ShapeStyle
  /** Key into `legend` this shape is counted under. */
  legendKey: string
  label: PlanLabel | null
}

export interface StatusPlanRenderInput {
  planId: string
  planName: string
  purpose: StatusPlanPurpose
  drawingName: string
  pageIndex: number
  /** yyyy-mm-dd — colours are computed for this day (spec §8: a saved report is a snapshot). */
  generatedOn: string
  source: PlanSource
  shapes: readonly RenderShape[]
  legend: readonly LegendEntry[]
  /** Tenant layout only: Σ linked shop areas and how many could not be measured. */
  measured: { totalM2: number; unmeasured: number } | null
  warnings: readonly string[]
}

export type PlanLayout = 'a3' | 'source'
export interface PlanFonts { regular: PDFFont; bold: PDFFont }

export class StatusPlanSourceError extends Error {
  constructor(message: string) { super(message); this.name = 'StatusPlanSourceError' }
}

export const A3_LANDSCAPE: readonly [number, number] = [1190.55, 841.89]
const MARGIN = 24
const STRIP_H = 40
const LEGEND_W = 200
const LEGEND_ROW = 13
const LABEL_MAX = 8
const LABEL_MIN = 3.5
const MIN_LINE = 0.25
const INK = rgb(0.08, 0.08, 0.08)
const MUTED = rgb(0.38, 0.38, 0.38)
const AMBER = rgb(0.71, 0.45, 0.04)

const T = (s: string) => winAnsiSafe(s)

export function planTitle(i: Pick<StatusPlanRenderInput, 'planName' | 'purpose' | 'pageIndex'>): string {
  return `${i.planName} (${PURPOSE_LABEL[i.purpose]}, page ${i.pageIndex})`
}

export function formatM2(n: number): string {
  return n.toFixed(1)
}

interface ResolvedSource {
  box: PageBox
  rotate: QuarterTurn
  pxPerPt: number
  draw: (page: PDFPage, placement: Placement) => void
}

async function resolveSource(doc: PDFDocument, source: PlanSource): Promise<ResolvedSource> {
  if (source.kind === 'pdf') {
    let src: PDFDocument
    try {
      src = await PDFDocument.load(source.bytes, { updateMetadata: false })
    } catch (e) {
      throw new StatusPlanSourceError(e instanceof EncryptedPDFError ? 'the drawing PDF is password-protected' : 'the drawing PDF could not be read')
    }
    const count = src.getPageCount()
    if (source.pageIndex < 1 || source.pageIndex > count) {
      throw new StatusPlanSourceError(`page ${source.pageIndex} is not in the drawing (it has ${count})`)
    }
    const srcPage = src.getPage(source.pageIndex - 1)
    const box = srcPage.getCropBox()
    const rotate = normaliseRotation(srcPage.getRotation().angle)
    let embedded: Awaited<ReturnType<PDFDocument['embedPage']>>
    try {
      embedded = await doc.embedPage(srcPage, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height })
      await embedded.embed()
    } catch {
      throw new StatusPlanSourceError(`page ${source.pageIndex} of the drawing could not be embedded`)
    }
    return {
      box, rotate, pxPerPt: PDF_PX_PER_PT,
      draw: (page, p) => {
        const name = page.node.newXObject('SP', embedded.ref)
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...p.matrix), drawObject(name), popGraphicsState())
      },
    }
  }
  let img: Awaited<ReturnType<PDFDocument['embedPng']>>
  try {
    img = source.kind === 'png' ? await doc.embedPng(source.bytes) : await doc.embedJpg(source.bytes)
    await img.embed()
  } catch {
    throw new StatusPlanSourceError('the drawing image could not be read')
  }
  return {
    box: { x: 0, y: 0, width: img.width, height: img.height }, rotate: 0, pxPerPt: IMAGE_PX_PER_PT,
    draw: (page, p) => {
      const name = page.node.newXObject('SI', img.ref)
      // An image XObject fills the unit square: scale it to the drawn rectangle.
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(p.drawn.width, 0, 0, p.drawn.height, p.drawn.x, p.drawn.y),
        drawObject(name),
        popGraphicsState(),
      )
    },
  }
}

interface Layout {
  pageSize: [number, number]
  frame: Frame
  strip: Frame
  legend: { x: number; yTop: number; width: number; cols: number }
}

export function layoutFor(kind: PlanLayout, viewed: { width: number; height: number }, legendCount: number): Layout {
  if (kind === 'a3') {
    const [W, H] = A3_LANDSCAPE
    const left = W - 2 * MARGIN - LEGEND_W - 12
    return {
      pageSize: [W, H],
      frame: { x: MARGIN, y: MARGIN + STRIP_H + 8, width: left, height: H - 2 * MARGIN - STRIP_H - 8 },
      strip: { x: MARGIN, y: MARGIN, width: left, height: STRIP_H },
      legend: { x: W - MARGIN - LEGEND_W, yTop: H - MARGIN, width: LEGEND_W, cols: 1 },
    }
  }
  // 'source': the drawing 1:1 at the top; a band below holds the title (left) and the legend grid.
  const titleW = Math.min(320, viewed.width * 0.4)
  const legendW = Math.max(160, viewed.width - titleW - 48)
  const cols = Math.max(1, Math.floor(legendW / 170))
  const rows = Math.ceil(legendCount / cols)
  const band = Math.max(STRIP_H + 16, 30 + rows * LEGEND_ROW + 24)
  return {
    pageSize: [viewed.width, viewed.height + band],
    frame: { x: 0, y: band, width: viewed.width, height: viewed.height },
    strip: { x: 16, y: 8, width: titleW, height: band - 16 },
    legend: { x: 16 + titleW + 16, yTop: band - 8, width: legendW, cols },
  }
}

type OpacityState = (alpha: number) => PDFName

function opacityStates(doc: PDFDocument, page: PDFPage): OpacityState {
  const cache = new Map<number, PDFName>()
  return (alpha) => {
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000
    let name = cache.get(a)
    if (!name) {
      const ref = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: a, CA: 1 }))
      name = page.node.newExtGState('GS', ref)
      cache.set(a, name)
    }
    return name
  }
}

function polygonPath(pts: readonly number[]): PDFOperator[] {
  const ops: PDFOperator[] = [moveTo(pts[0]!, pts[1]!)]
  for (let i = 2; i < pts.length; i += 2) ops.push(lineTo(pts[i]!, pts[i + 1]!))
  ops.push(closePath())
  return ops
}

/** Fill (with opacity) → hatches → outline, in output space. `unit` = output pt per style px. */
function drawStyledPolygon(
  page: PDFPage, gs: OpacityState, outPts: readonly number[], style: ShapeStyle, unit: number,
  hatchesFor: (h: HatchSpec) => Segment[],
): void {
  if (style.fill && style.fillOpacity > 0) {
    const c = hexToRgb01(style.fill)
    page.pushOperators(
      pushGraphicsState(), setGraphicsState(gs(style.fillOpacity)), setFillingRgbColor(c.r, c.g, c.b),
      ...polygonPath(outPts), fill(), popGraphicsState(),
    )
  }
  for (const h of style.hatches) {
    const segs = hatchesFor(h)
    if (segs.length === 0) continue
    const c = hexToRgb01(h.color)
    const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(c.r, c.g, c.b), setLineWidth(Math.max(MIN_LINE, h.width * unit))]
    for (const [x0, y0, x1, y1] of segs) ops.push(moveTo(x0, y0), lineTo(x1, y1))
    ops.push(stroke(), popGraphicsState())
    page.pushOperators(...ops)
  }
  const c = hexToRgb01(style.stroke)
  const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(c.r, c.g, c.b), setLineWidth(Math.max(MIN_LINE, style.strokeWidth * unit))]
  if (style.dash && style.dash.length > 0) ops.push(setDashPattern(style.dash.map((d) => d * unit), 0))
  ops.push(...polygonPath(outPts), stroke(), popGraphicsState())
  page.pushOperators(...ops)
}

function drawLabel(page: PDFPage, fonts: PlanFonts, s: RenderShape, centre: { x: number; y: number }, maxWidth: number): void {
  if (!s.label) return
  const lines: Array<{ text: string; font: PDFFont; rel: number }> = [{ text: T(s.label.primary), font: fonts.bold, rel: 1 }]
  if (s.label.secondary) lines.push({ text: T(s.label.secondary), font: fonts.regular, rel: 0.85 })
  if (s.label.areaM2 != null) lines.push({ text: T(`${formatM2(s.label.areaM2)} m²`), font: fonts.regular, rel: 0.85 })
  const widest = (size: number, ls = lines) => Math.max(...ls.map((l) => l.font.widthOfTextAtSize(l.text, size * l.rel)))
  let size = LABEL_MAX
  while (size > LABEL_MIN && widest(size) > maxWidth) size -= 0.5
  // Still too wide at the minimum: the shop number alone (never drop the label entirely).
  const shown = widest(size) > maxWidth ? lines.slice(0, 1) : lines
  const lh = size * 1.15
  let y = centre.y + ((shown.length - 1) * lh) / 2 - size * 0.35
  shown.forEach((l, i) => {
    const sz = size * l.rel
    const w = l.font.widthOfTextAtSize(l.text, sz)
    page.drawText(l.text, { x: centre.x - w / 2, y, size: sz, font: l.font, color: INK })
    if (i === 0 && s.style.strikeLabel) {
      page.drawLine({ start: { x: centre.x - w / 2, y: y + sz * 0.33 }, end: { x: centre.x + w / 2, y: y + sz * 0.33 }, thickness: 0.6, color: INK })
    }
    y -= lh
  })
}

function drawTitleStrip(page: PDFPage, input: StatusPlanRenderInput, r: Frame, fonts: PlanFonts): void {
  let y = r.y + r.height - 12
  page.drawText(T(input.planName), { x: r.x, y, size: 11, font: fonts.bold, color: INK, maxWidth: r.width })
  y -= 12
  page.drawText(
    T(`${PURPOSE_LABEL[input.purpose]} · ${input.drawingName} · page ${input.pageIndex} · generated ${input.generatedOn}`),
    { x: r.x, y, size: 7.5, font: fonts.regular, color: MUTED, maxWidth: r.width },
  )
  for (const w of input.warnings.slice(0, 2)) {
    y -= 10
    page.drawText(T(w), { x: r.x, y, size: 7, font: fonts.regular, color: AMBER, maxWidth: r.width })
  }
}

function drawLegend(page: PDFPage, gs: OpacityState, input: StatusPlanRenderInput, area: Layout['legend'], fonts: PlanFonts): void {
  const counts = new Map<string, number>()
  for (const s of input.shapes) counts.set(s.legendKey, (counts.get(s.legendKey) ?? 0) + 1)
  page.drawText(T('Legend'), { x: area.x, y: area.yTop - 10, size: 9, font: fonts.bold, color: INK })
  const colW = area.width / area.cols
  input.legend.forEach((e, i) => {
    const x = area.x + (i % area.cols) * colW
    const y = area.yTop - 26 - Math.floor(i / area.cols) * LEGEND_ROW
    // The swatch is hatched in a y-DOWN local space, then flipped, so its hatch leans the same way
    // as the drawing's (image space is y-down too).
    const local = [0, 0, 18, 0, 18, 9, 0, 9]
    const toPage = (lx: number, ly: number): [number, number] => [x + lx, y + 9 - ly]
    const swatch = [...toPage(0, 0), ...toPage(18, 0), ...toPage(18, 9), ...toPage(0, 9)]
    drawStyledPolygon(page, gs, swatch, e.style, 0.35, (h) =>
      hatchSegments(local, { angleDeg: h.angleDeg, spacing: 3.5 }).map(([a, b, c, d]) => [...toPage(a, b), ...toPage(c, d)] as Segment))
    page.drawText(T(e.label), { x: x + 24, y: y + 1, size: 7.5, font: fonts.regular, color: INK })
    const n = String(counts.get(e.key) ?? 0)
    page.drawText(n, { x: x + colW - 10 - fonts.bold.widthOfTextAtSize(n, 7.5), y: y + 1, size: 7.5, font: fonts.bold, color: INK })
  })
  let y = area.yTop - 26 - Math.ceil(input.legend.length / area.cols) * LEGEND_ROW - 4
  page.drawText(T(`${input.shapes.length} shapes on this plan`), { x: area.x, y, size: 7, font: fonts.regular, color: MUTED })
  if (input.measured) {
    y -= 10
    const m = input.measured
    page.drawText(
      T(`Measured shop area ${formatM2(m.totalM2)} m²${m.unmeasured ? ` · ${m.unmeasured} not measured` : ''}`),
      { x: area.x, y, size: 7, font: fonts.regular, color: MUTED },
    )
  }
}

/** Add one plan page to `doc`. Throws StatusPlanSourceError (no page added) when the drawing cannot be used. */
export async function drawStatusPlanPage(doc: PDFDocument, input: StatusPlanRenderInput, layoutKind: PlanLayout, fonts: PlanFonts): Promise<PDFPage> {
  const src = await resolveSource(doc, input.source)
  const layout = layoutFor(layoutKind, viewedSize(src.box, src.rotate), input.legend.length)
  const page = doc.addPage(layout.pageSize)
  const placement = placementFor(src.box, src.rotate, layout.frame)
  src.draw(page, placement)

  const unit = placement.scale / src.pxPerPt
  const gs = opacityStates(doc, page)
  const pt = (x: number, y: number) => imageToOutput({ x, y }, src.box, src.rotate, placement, src.pxPerPt)
  const toOut = (pts: readonly number[]) => {
    const out: number[] = []
    for (let i = 0; i < pts.length; i += 2) { const p = pt(pts[i]!, pts[i + 1]!); out.push(p.x, p.y) }
    return out
  }

  // Shapes are clipped to the drawing so a hatch never runs into the legend or the strip.
  const d = placement.drawn
  page.pushOperators(pushGraphicsState(), rectangle(d.x, d.y, d.width, d.height), clip(), endPath())
  for (const s of input.shapes) {
    drawStyledPolygon(page, gs, toOut(s.points), s.style, unit, (h) =>
      hatchSegments(s.points, { angleDeg: h.angleDeg, spacing: h.spacing }).map(([x0, y0, x1, y1]) => {
        const a = pt(x0, y0)
        const b = pt(x1, y1)
        return [a.x, a.y, b.x, b.y] as Segment
      }))
  }
  page.pushOperators(popGraphicsState())

  for (const s of input.shapes) {
    if (!s.label) continue
    const c = visualCentre(s.points)
    const bb = boundingBox(s.points)
    drawLabel(page, fonts, s, pt(c.x, c.y), (bb.maxX - bb.minX) * unit * 0.92)
  }
  drawTitleStrip(page, input, layout.strip, fonts)
  drawLegend(page, gs, input, layout.legend, fonts)
  return page
}

/** A standalone one-page PDF (Export sheet, portal). */
export async function renderStatusPlanPdf(input: StatusPlanRenderInput, layout: PlanLayout): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(T(input.planName))
  doc.setProducer('E-Site')
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  await drawStatusPlanPage(doc, input, layout, fonts)
  return doc.save()
}
```

> **Label width on rotated pages.** `boundingBox` is taken in image space, and image space IS the viewed sheet, so its x-extent is the on-page width at every rotation. No axis swap is needed.

- [ ] **Step 5: Run it and confirm it passes**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/render-plan-page.test.ts`
Expected: PASS (about 17 tests).

**Mutation checks (do each, then revert; record in the PR body):**
1. In `placementFor`, use `-r` instead of `r` (swap the 90 and 270 matrices). The two `/Rotate` tables must go red, at 90 and 270.
2. Remove `await embedded.embed()`, and render a source whose page content stream is corrupt (replace a content stream with invalid Flate bytes). The error must now appear only at `save()`. This proves why the forced embed exists.
3. Replace `T(` with identity in `drawLabel`. The WinAnsi test must throw (pdf-lib cannot encode `→`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/test/pdf-ops.ts apps/web/src/lib/status-plans/render-plan-page.ts apps/web/src/lib/status-plans/render-plan-page.test.ts
git commit -m "feat(status-plans): vector plan page renderer (embedded drawing, palette, hatches, legend)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: DB order status for schematic nodes (+ query helpers)

**Read Assumption 4 first.** If `grep -rn "loadSchematicOrderStatus\|order-status" apps/web/src/lib/status-plans` finds a slice-2/3 loader, skip Steps 1–4. Use that loader in Task 4 and keep only `query-helpers.ts`, unless the loader already has an equivalent.

**Files:**
- Create: `apps/web/src/lib/status-plans/query-helpers.ts`
- Create: `apps/web/src/lib/status-plans/schematic-order-status.ts`
- Test: `apps/web/src/lib/status-plans/schematic-order-status.test.ts`
- Create: `apps/web/src/test/fake-postgrest.ts` (shared by Tasks 3–4)

- [ ] **Step 1: Write the fake client (test helper)**

```ts
// apps/web/src/test/fake-postgrest.ts
/**
 * Minimal PostgREST-shaped fake: schema().from().select().eq().in().order().range() + maybeSingle(),
 * awaited like supabase-js. It honours `maxRows` (production max_rows = 1000), so a loader that
 * forgets to page returns short — the way the real API does, silently.
 */
type Row = Record<string, unknown>

export interface FakeCall { table: string; filters: string[] }

export function fakePostgrest(tables: Record<string, Row[]>, opts: { maxRows?: number; errors?: Record<string, string> } = {}) {
  const maxRows = opts.maxRows ?? 1000
  const calls: FakeCall[] = []
  function query(table: string) {
    let rows = [...(tables[table] ?? [])]
    let from = 0
    let to = Number.POSITIVE_INFINITY
    const call: FakeCall = { table, filters: [] }
    calls.push(call)
    const result = () => {
      const err = opts.errors?.[table]
      if (err) return { data: null, error: { message: err } }
      return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null }
    }
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { call.filters.push(`eq:${c}`); rows = rows.filter((r) => r[c] === v); return q },
      in: (c: string, vs: readonly unknown[]) => { call.filters.push(`in:${c}:${vs.length}`); rows = rows.filter((r) => vs.includes(r[c])); return q },
      order: (c: string) => { rows = [...rows].sort((a, b) => String(a[c]).localeCompare(String(b[c]))); return q },
      range: (f: number, t: number) => { from = f; to = t; return q },
      maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error } },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    }
    return q
  }
  return {
    calls,
    client: {
      schema: (s: string) => ({ from: (t: string) => query(`${s}.${t}`) }),
      from: (t: string) => query(`public.${t}`),
    },
  }
}

export function fakeStorage(files: Record<string, Uint8Array>) {
  const downloads: string[] = []
  return {
    downloads,
    storage: {
      from: (_bucket: string) => ({
        download: async (path: string) => {
          downloads.push(path)
          const f = files[path]
          return f ? { data: new Blob([f]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }),
    },
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/src/lib/status-plans/schematic-order-status.test.ts
import { describe, it, expect } from 'vitest'
import { fakePostgrest } from '@/test/fake-postgrest'
import { loadSchematicOrderStatus } from './schematic-order-status'

const ORG = 'org-1'
const DB_TYPE = 'type-db'
const tables = {
  'structure.scope_item_types': [
    { id: DB_TYPE, key: 'db', organisation_id: ORG },
    { id: 'type-lights', key: 'lighting', organisation_id: ORG },
    { id: 'other-org-db', key: 'db', organisation_id: 'org-2' },
  ],
  'structure.node_orders': [
    { node_id: 'n1', scope_item_type_id: DB_TYPE, status: 'received' },
    { node_id: 'n2', scope_item_type_id: DB_TYPE, status: 'ordered' },
    { node_id: 'n2', scope_item_type_id: DB_TYPE, status: 'required' }, // two rows: least advanced wins
    { node_id: 'n3', scope_item_type_id: 'type-lights', status: 'received' }, // lights, not DB
    { node_id: 'n4', scope_item_type_id: DB_TYPE, status: 'cancelled' }, // unknown status ignored
    { node_id: 'n5', scope_item_type_id: DB_TYPE, status: 'by_tenant' },
  ],
}

describe('loadSchematicOrderStatus', () => {
  it('reads the DB order per node, least advanced first, ignoring other scope types and unknown statuses', async () => {
    const { client } = fakePostgrest(tables)
    const m = await loadSchematicOrderStatus(client, { orgId: ORG, nodeIds: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'] })
    expect(Object.fromEntries(m)).toEqual({ n1: 'received', n2: 'required', n5: 'by_tenant' })
  })
  it('no DB scope type in the org → empty (every block renders "no order")', async () => {
    const { client } = fakePostgrest({ ...tables, 'structure.scope_item_types': [] })
    expect((await loadSchematicOrderStatus(client, { orgId: ORG, nodeIds: ['n1'] })).size).toBe(0)
  })
  it('chunks long id lists', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `x${i}`)
    const { client, calls } = fakePostgrest(tables)
    await loadSchematicOrderStatus(client, { orgId: ORG, nodeIds: ids })
    expect(calls.filter((c) => c.table === 'structure.node_orders')).toHaveLength(3)
  })
  it('a read error throws (the caller turns it into a "not included" line)', async () => {
    const { client } = fakePostgrest(tables, { errors: { 'structure.node_orders': 'boom' } })
    await expect(loadSchematicOrderStatus(client, { orgId: ORG, nodeIds: ['n1'] })).rejects.toThrow(/boom/)
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/schematic-order-status.test.ts`
Expected: FAIL — cannot resolve `./schematic-order-status`.

- [ ] **Step 4: Implement**

```ts
// apps/web/src/lib/status-plans/query-helpers.ts
/** PostgREST `max_rows = 1000` caps every read, `.range()` included — page anything that can exceed it. */
export const PAGE_ROWS = 1000
/** Keep `.in()` URLs short. */
export const IN_CHUNK = 200

export function inChunks<T>(xs: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/** Read every row of a query in stable-order pages. `build` must return a fresh query each call. */
export async function readAllPages<R>(build: () => any, orderColumn = 'id'): Promise<R[]> {
  const rows: R[] = []
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await build().order(orderColumn).range(from, from + PAGE_ROWS - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as R[]
    rows.push(...page)
    if (page.length < PAGE_ROWS) return rows
  }
}
```

```ts
// apps/web/src/lib/status-plans/schematic-order-status.ts
/**
 * DB order status for ANY project node, for distribution-schematic hatching (spec §3.2).
 * loadTenantShopFacts reads tenant nodes only; schematic blocks link main boards, common-area boards…
 *
 * Several rows for one node: the LEAST advanced wins — a missing or earlier row is not evidence of
 * done (the same rule as shop status, spec §3.1). Unknown status strings are ignored.
 * Caller gates project access first (this runs on the client it is given; the routes pass the service
 * client after requireProjectAccess / requirePortalAccess).
 */
import type { NodeOrderStatus } from '@esite/shared/status-plans'
import { inChunks } from './query-helpers'

type Db = { schema: (s: string) => { from: (t: string) => any } }

const RANK: Record<NodeOrderStatus, number> = { required: 0, ordered: 1, by_tenant: 2, received: 2 }

export async function loadSchematicOrderStatus(
  client: unknown,
  args: { orgId: string; nodeIds: readonly string[] },
): Promise<Map<string, NodeOrderStatus>> {
  const db = client as Db
  const out = new Map<string, NodeOrderStatus>()
  const ids = [...new Set(args.nodeIds)]
  if (ids.length === 0) return out

  const { data: types, error: tErr } = await db.schema('structure').from('scope_item_types')
    .select('id, key').eq('organisation_id', args.orgId).eq('key', 'db')
  if (tErr) throw new Error(`scope types could not be read: ${tErr.message}`)
  const dbTypeId = ((types ?? []) as Array<{ id: string }>)[0]?.id
  if (!dbTypeId) return out

  for (const chunk of inChunks(ids)) {
    const { data, error } = await db.schema('structure').from('node_orders')
      .select('node_id, status').eq('scope_item_type_id', dbTypeId).in('node_id', chunk)
    if (error) throw new Error(`orders could not be read: ${error.message}`)
    for (const r of (data ?? []) as Array<{ node_id: string; status: string }>) {
      if (!(r.status in RANK)) continue
      const status = r.status as NodeOrderStatus
      const prev = out.get(r.node_id)
      if (prev === undefined || RANK[status] < RANK[prev]) out.set(r.node_id, status)
    }
  }
  return out
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/schematic-order-status.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/test/fake-postgrest.ts apps/web/src/lib/status-plans/query-helpers.ts apps/web/src/lib/status-plans/schematic-order-status.ts apps/web/src/lib/status-plans/schematic-order-status.test.ts
git commit -m "feat(status-plans): DB order status loader for schematic nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Plan rows → render inputs (caps, "not included", never throws for one drawing)

**Files:**
- Create: `apps/web/src/lib/status-plans/plan-render-data.ts`
- Test: `apps/web/src/lib/status-plans/plan-render-data.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/status-plans/plan-render-data.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COLOURS, areaShapeStyle } from '@esite/shared/status-plans'
import { fakePostgrest, fakeStorage } from '@/test/fake-postgrest'

const factsMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-schedule/shop-facts', () => ({ loadTenantShopFacts: factsMock }))

import {
  loadStatusPlanRenderInputs, orderPlans, sourceKindFor, scaleForPage,
  MAX_STATUS_PLANS_PER_REPORT,
} from './plan-render-data'

const PROJ = 'proj-1'
const ORG = 'org-1'
const TODAY = '2026-10-09'

function planRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, project_id: PROJ, organisation_id: ORG, floor_plan_id: 'fp-1', page_index: 1, purpose: 'tenant_layout',
    name: `Plan ${id}`, source_file_path: `${ORG}/${PROJ}/layout.pdf`, created_by: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
  }
}
function shapeRow(id: string, plan: string, over: Record<string, unknown> = {}) {
  return {
    id, status_plan_id: plan, shape: 'polygon', points: [0, 0, 200, 0, 200, 100, 0, 100], node_id: null, area_type: null,
    detected_tag: null, source: 'manual', created_by: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over,
  }
}
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // bytes are not parsed here

function facts() {
  return {
    activeNodes: [
      { id: 'n-done', shopNumber: 'L01', shopName: 'Done Ltd', glaM2: 50, breakerA: null, poleConfig: null, loadA: null },
      { id: 'n-late', shopNumber: 'L02', shopName: 'Late Ltd', glaM2: 50, breakerA: null, poleConfig: null, loadA: null },
    ],
    decommissionedCount: 0,
    scopeTypeIdByKey: { db: 't-db', lighting: 't-l' },
    detailsByNode: new Map([
      ['n-done', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }],
      ['n-late', { scopeReceived: false, scopeNotRequired: false, layoutIssued: false }],
    ]),
    orderStatusByNodeScope: new Map([['n-done:t-db', 'received'], ['n-done:t-l', 'received']]),
    boByNode: new Map([['n-late', { effectiveDate: '2026-01-01' }]]),
    decommissionedNodeIds: [],
  }
}

function world(over: { plans?: any[]; shapes?: any[]; files?: Record<string, Uint8Array>; fps?: any[]; maxRows?: number } = {}) {
  const pg = fakePostgrest({
    'projects.projects': [{ id: PROJ, organisation_id: ORG, opening_date: '2026-03-01' }],
    'tenants.status_plans': over.plans ?? [planRow('a')],
    'tenants.status_plan_shapes': over.shapes ?? [],
    'tenants.floor_plans': over.fps ?? [{ id: 'fp-1', name: 'Tenant layout', file_path: `${ORG}/${PROJ}/layout.pdf`, pixels_per_meter: 20 }],
    'tenants.floor_plan_page_scales': [],
    'structure.nodes': [
      { id: 'n-done', code: 'TDB-01', shop_number: 'L01', shop_name: 'Done Ltd', name: null, status: 'active' },
      { id: 'n-late', code: 'TDB-02', shop_number: 'L02', shop_name: 'Late Ltd', name: null, status: 'active' },
      { id: 'mb', code: 'MB-3.1', shop_number: null, shop_name: null, name: 'MAIN BOARD 3.1', status: 'active' },
    ],
    'structure.scope_item_types': [{ id: 't-db', key: 'db', organisation_id: ORG }],
    'structure.node_orders': [{ node_id: 'mb', scope_item_type_id: 't-db', status: 'ordered' }],
  }, { maxRows: over.maxRows })
  const st = fakeStorage(over.files ?? { [`${ORG}/${PROJ}/layout.pdf`]: PDF })
  return { pg, st, clients: { db: pg.client, facts: pg.client, storage: st.storage } }
}

beforeEach(() => { factsMock.mockReset(); factsMock.mockResolvedValue(facts()) })

describe('pure helpers', () => {
  it('orders tenant layouts before schematics, then by name (numeric), then page', () => {
    const p = (purpose: string, name: string, pageIndex = 1) => ({ purpose, name, pageIndex }) as any
    expect(orderPlans([p('distribution_schematic', 'A'), p('tenant_layout', 'Plan 10'), p('tenant_layout', 'Plan 2'), p('tenant_layout', 'Plan 2', 2)])
      .map((x) => `${x.purpose}:${x.name}:${x.pageIndex}`))
      .toEqual(['tenant_layout:Plan 2:1', 'tenant_layout:Plan 2:2', 'tenant_layout:Plan 10:1', 'distribution_schematic:A:1'])
  })
  it('knows which drawings it can embed', () => {
    expect(sourceKindFor('a/b.PDF')).toBe('pdf')
    expect(sourceKindFor('a/b.png')).toBe('png')
    expect(sourceKindFor('a/b.jpeg')).toBe('jpg')
    expect(sourceKindFor('a/b.dwg')).toBeNull()
  })
  it('page scale: own page first, the drawing scale on page 1 only', () => {
    expect(scaleForPage(20, new Map([[2, 30]]), 2)).toBe(30)
    expect(scaleForPage(20, new Map(), 1)).toBe(20)
    expect(scaleForPage(20, new Map(), 2)).toBeNull()
  })
})

describe('loadStatusPlanRenderInputs', () => {
  it('styles tenant shapes from live facts: complete, overdue, area type, unassigned', async () => {
    const { clients } = world({ shapes: [
      shapeRow('s1', 'a', { node_id: 'n-done' }),
      shapeRow('s2', 'a', { node_id: 'n-late' }),
      shapeRow('s3', 'a', { area_type: 'common' }),
      shapeRow('s4', 'a'),
    ] })
    const { inputs, omitted } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(omitted).toEqual([])
    const [plan] = inputs
    const byKey = plan!.shapes.map((s) => s.legendKey)
    expect(byKey).toEqual(['complete', 'overdue', 'common', 'unlinked'])
    expect(plan!.shapes[0]!.style.fill).toBe(COLOURS.complete)
    expect(plan!.shapes[2]!.style).toEqual(areaShapeStyle('common'))
    // 200 × 100 px at 20 px/m = 10 m × 5 m = 50 m²
    expect(plan!.shapes[0]!.label).toEqual({ primary: 'L01', secondary: 'Done Ltd', areaM2: 50 })
    expect(plan!.shapes[3]!.label).toBeNull()
    expect(plan!.measured).toEqual({ totalM2: 100, unmeasured: 0 }) // two linked shops; the mall area is not added
    expect(plan!.generatedOn).toBe(TODAY)
    expect(plan!.source).toEqual({ kind: 'pdf', bytes: PDF, pageIndex: 1 })
  })

  it('hatches schematic blocks from the DB order of any node', async () => {
    const { clients } = world({
      plans: [planRow('s', { purpose: 'distribution_schematic' })],
      shapes: [
        shapeRow('b1', 's', { shape: 'rect', node_id: 'mb' }),
        shapeRow('b2', 's', { shape: 'rect', node_id: 'n-done' }), // no DB order in node_orders
        shapeRow('b3', 's', { shape: 'rect', detected_tag: 'DB-77' }),
      ],
    })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['distribution_schematic'] })
    expect(inputs[0]!.shapes.map((s) => s.legendKey)).toEqual(['ordered', 'no_order', 'unlinked'])
    expect(inputs[0]!.shapes[0]!.label).toEqual({ primary: 'MB-3.1', secondary: null })
    expect(inputs[0]!.shapes[2]!.label).toEqual({ primary: 'DB-77', secondary: 'not linked' })
    expect(inputs[0]!.measured).toBeNull()
    expect(factsMock).not.toHaveBeenCalled()
  })

  it('reads only the purposes asked for, tenant layouts first', async () => {
    const { clients } = world({ plans: [planRow('z', { purpose: 'distribution_schematic', name: 'A' }), planRow('y', { name: 'B' })] })
    const both = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout', 'distribution_schematic'] })
    expect(both.inputs.map((i) => i.planId)).toEqual(['y', 'z'])
    const one = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(one.inputs.map((i) => i.planId)).toEqual(['y'])
  })

  it('a missing or unsupported drawing is "not included", the rest still render', async () => {
    const { clients } = world({
      plans: [planRow('a'), planRow('b', { floor_plan_id: 'fp-2' }), planRow('c', { floor_plan_id: 'fp-3' }), planRow('d', { floor_plan_id: 'fp-gone' })],
      fps: [
        { id: 'fp-1', name: 'Tenant layout', file_path: `${ORG}/${PROJ}/layout.pdf`, pixels_per_meter: 20 },
        { id: 'fp-2', name: 'Missing file', file_path: `${ORG}/${PROJ}/missing.pdf`, pixels_per_meter: null },
        { id: 'fp-3', name: 'CAD', file_path: `${ORG}/${PROJ}/layout.dwg`, pixels_per_meter: null },
      ],
    })
    const { inputs, omitted } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs.map((i) => i.planId)).toEqual(['a'])
    expect(omitted.map((o) => o.reason)).toEqual([
      'the drawing file could not be read (Object not found)',
      'the drawing is not a PDF, PNG or JPEG file (layout.dwg)',
      'the drawing is no longer available',
    ])
  })

  it('downloads a drawing shared by several plans once', async () => {
    const { clients, st } = world({ plans: [planRow('a'), planRow('b', { page_index: 2 })] })
    await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(st.downloads).toHaveLength(1)
  })

  it(`caps at ${MAX_STATUS_PLANS_PER_REPORT} plans and at the byte budget`, async () => {
    const plans = Array.from({ length: MAX_STATUS_PLANS_PER_REPORT + 2 }, (_, i) => planRow(`p${String(i).padStart(2, '0')}`))
    const { clients } = world({ plans })
    const r = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(r.inputs).toHaveLength(MAX_STATUS_PLANS_PER_REPORT)
    expect(r.omitted).toHaveLength(2)
    expect(r.omitted[0]!.reason).toMatch(/more than 20 plans/)
    const small = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'], maxSourceBytes: 2 })
    expect(small.inputs).toHaveLength(0)
    // the two over-count lines come first; every kept plan then hits the byte cap
    expect(small.omitted.filter((o) => /size cap/.test(o.reason))).toHaveLength(MAX_STATUS_PLANS_PER_REPORT)
  })

  it('pages shapes past PostgREST max_rows', async () => {
    const shapes = Array.from({ length: 1500 }, (_, i) => shapeRow(`s${String(i).padStart(4, '0')}`, 'a'))
    const { clients } = world({ shapes, maxRows: 1000 })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs[0]!.shapes).toHaveLength(1500)
  })

  it('warns when the drawing changed since the plan was drawn, and when the page has no scale', async () => {
    const { clients } = world({
      plans: [planRow('a', { source_file_path: `${ORG}/${PROJ}/old-layout.pdf` })],
      fps: [{ id: 'fp-1', name: 'Tenant layout', file_path: `${ORG}/${PROJ}/layout.pdf`, pixels_per_meter: null }],
    })
    const { inputs } = await loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] })
    expect(inputs[0]!.warnings).toEqual([
      'The drawing file changed since this plan was drawn (old-layout.pdf -> layout.pdf); shapes may not line up.',
      'This page has no scale, so areas are not measured.',
    ])
  })

  it('a project the caller cannot see yields nothing', async () => {
    const { clients } = world()
    expect(await loadStatusPlanRenderInputs(clients, { projectId: 'other', today: TODAY, purposes: ['tenant_layout'] }))
      .toEqual({ inputs: [], omitted: [] })
  })
})
```

> **Fixtures and slice 1's real loaders.** These fixtures assume slice 1's `shopLinkFor` treats a node in `facts.activeNodes` as active, and that `shopStatus` marks `n-late` overdue because its BO date is before today. If slice 1's real `shopLinkFor` reads other fields, adjust the **fixture** to match its contract. Do not change the expected statuses.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/plan-render-data.test.ts`
Expected: FAIL — cannot resolve `./plan-render-data`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/status-plans/plan-render-data.ts
/**
 * Status plans → render inputs for the PDF renderer (report appendix, Export sheet, portal).
 *
 * Reads:
 *   clients.db      — the CALLER's session client: plans, shapes, drawings, page scales and node
 *                     labels under RLS + site_scope (00245 opens SELECT to every project role).
 *   clients.facts   — order / scope facts (loadTenantShopFacts, loadSchematicOrderStatus); the service
 *                     client, passed ONLY after the route's project gate, as the tenant report does.
 *   clients.storage — drawing bytes from the `drawings` bucket (service client).
 *
 * Never throws for one drawing: a missing, unreadable, unsupported or over-budget drawing becomes a
 * "not included" line with a sentence. It throws only when the plan list itself cannot be read; the
 * callers turn that into a single "not included" line too (report-appendix.ts), never a 500.
 *
 * Colours are computed for `today` at render time (spec §8): a saved report is a snapshot.
 */
import {
  AREA_TYPE_LABEL, PURPOSE_LABEL, SCHEMATIC_LEGEND, TENANT_LEGEND,
  areaShapeStyle, dbBlockStatus, dbBlockStyle, shapeAreaM2, shopStatus, statusPlanFromRow, statusPlanShapeFromRow,
  tenantShapeStyle, totalMeasuredM2,
  type NodeOrderStatus, type StatusPlan, type StatusPlanPurpose, type StatusPlanRow, type StatusPlanShape, type StatusPlanShapeRow,
} from '@esite/shared/status-plans'
import { loadTenantShopFacts, type TenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { shopLinkFor } from './shop-link'
import { loadSchematicOrderStatus } from './schematic-order-status'
import { inChunks, readAllPages } from './query-helpers'
import { planTitle, type PlanSource, type RenderShape, type StatusPlanRenderInput } from './render-plan-page'

export const DRAWINGS_BUCKET = 'drawings'
export const MAX_STATUS_PLANS_PER_REPORT = 20
/** Σ unique drawing files downloaded for one render. */
export const MAX_STATUS_PLAN_SOURCE_BYTES = 60 * 1024 * 1024

export interface StorageLike {
  from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }> }
}
export interface PlanRenderClients { db: unknown; facts: unknown; storage: StorageLike }
export interface LoadPlanRenderArgs {
  projectId: string
  today: string
  purposes: readonly StatusPlanPurpose[]
  planIds?: readonly string[]
  maxPlans?: number
  maxSourceBytes?: number
}
export interface PlanOmission { title: string; reason: string }
export interface PlanRenderLoadResult { inputs: StatusPlanRenderInput[]; omitted: PlanOmission[] }

type Db = { schema: (s: string) => { from: (t: string) => any } }

const PLAN_COLUMNS = 'id, project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path, created_by, created_at, updated_at'
const SHAPE_COLUMNS = 'id, status_plan_id, shape, points, node_id, area_type, detected_tag, source, created_by, created_at, updated_at'
const PURPOSE_ORDER: Record<StatusPlanPurpose, number> = { tenant_layout: 0, distribution_schematic: 1 }

interface NodeLabelRow { id: string; code: string | null; shop_number: string | null; shop_name: string | null; name: string | null }
interface DrawingRow { id: string; name: string | null; file_path: string; pixels_per_meter: number | string | null }

export function orderPlans<T extends Pick<StatusPlan, 'purpose' | 'name' | 'pageIndex'>>(plans: readonly T[]): T[] {
  return [...plans].sort((a, b) =>
    PURPOSE_ORDER[a.purpose] - PURPOSE_ORDER[b.purpose]
    || a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' })
    || a.pageIndex - b.pageIndex)
}

export function sourceKindFor(path: string): 'pdf' | 'png' | 'jpg' | null {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.png$/i.test(path)) return 'png'
  if (/\.jpe?g$/i.test(path)) return 'jpg'
  return null
}

/** Mirrors measure/route-canvas-logic.ts pageScaleFor: the page's own scale, else the drawing's on page 1 only. */
export function scaleForPage(drawingPpm: number | null, pageScales: ReadonlyMap<number, number>, page: number): number | null {
  return pageScales.get(page) ?? (page === 1 ? drawingPpm : null)
}

const basename = (p: string) => p.split('/').pop() ?? p

export async function loadStatusPlanRenderInputs(clients: PlanRenderClients, args: LoadPlanRenderArgs): Promise<PlanRenderLoadResult> {
  const db = clients.db as Db
  const maxPlans = args.maxPlans ?? MAX_STATUS_PLANS_PER_REPORT
  const maxBytes = args.maxSourceBytes ?? MAX_STATUS_PLAN_SOURCE_BYTES
  const empty: PlanRenderLoadResult = { inputs: [], omitted: [] }
  if (args.purposes.length === 0) return empty

  const { data: project } = await db.schema('projects').from('projects')
    .select('organisation_id, opening_date').eq('id', args.projectId).maybeSingle()
  if (!project) return empty
  const orgId = (project as { organisation_id: string }).organisation_id
  const openingDate = (project as { opening_date?: string | null }).opening_date ?? null

  let planQ = db.schema('tenants').from('status_plans').select(PLAN_COLUMNS)
    .eq('project_id', args.projectId).in('purpose', [...args.purposes])
  if (args.planIds) planQ = planQ.in('id', [...args.planIds])
  const { data: planRows, error: planErr } = await planQ
  if (planErr) throw new Error(`status plans could not be read: ${planErr.message}`)
  const ordered = orderPlans(((planRows ?? []) as StatusPlanRow[]).map(statusPlanFromRow))
  if (ordered.length === 0) return empty

  const omitted: PlanOmission[] = []
  const plans = ordered.slice(0, maxPlans)
  for (const p of ordered.slice(maxPlans)) {
    omitted.push({ title: planTitle(p), reason: `more than ${maxPlans} plans — export the rest from the status plans page` })
  }

  const fpIds = [...new Set(plans.map((p) => p.floorPlanId))]
  const [{ data: fpRows }, { data: scaleRows }] = await Promise.all([
    db.schema('tenants').from('floor_plans').select('id, name, file_path, pixels_per_meter').in('id', fpIds),
    db.schema('tenants').from('floor_plan_page_scales').select('floor_plan_id, page_index, pixels_per_meter').in('floor_plan_id', fpIds),
  ])
  const fpById = new Map(((fpRows ?? []) as DrawingRow[]).map((r) => [r.id, r]))
  const scalesByFp = new Map<string, Map<number, number>>()
  for (const s of (scaleRows ?? []) as Array<{ floor_plan_id: string; page_index: number; pixels_per_meter: number | string }>) {
    const m = scalesByFp.get(s.floor_plan_id) ?? new Map<number, number>()
    m.set(Number(s.page_index), Number(s.pixels_per_meter))
    scalesByFp.set(s.floor_plan_id, m)
  }

  const shapeRows = await readAllPages<StatusPlanShapeRow>(() =>
    db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS).in('status_plan_id', plans.map((p) => p.id)))
  const shapesByPlan = new Map<string, StatusPlanShape[]>()
  const badShapes = new Map<string, number>()
  for (const r of shapeRows) {
    try {
      const s = statusPlanShapeFromRow(r)
      const list = shapesByPlan.get(s.statusPlanId) ?? []
      list.push(s)
      shapesByPlan.set(s.statusPlanId, list)
    } catch {
      badShapes.set(r.status_plan_id, (badShapes.get(r.status_plan_id) ?? 0) + 1)
    }
  }

  const nodeIds = [...new Set([...shapesByPlan.values()].flat().map((s) => s.nodeId).filter((x): x is string => !!x))]
  const nodes = new Map<string, NodeLabelRow>()
  for (const chunk of inChunks(nodeIds)) {
    const { data } = await db.schema('structure').from('nodes').select('id, code, shop_number, shop_name, name').in('id', chunk)
    for (const n of (data ?? []) as NodeLabelRow[]) nodes.set(n.id, n)
  }

  const needTenant = plans.some((p) => p.purpose === 'tenant_layout')
  const facts: TenantShopFacts | null = needTenant
    ? await loadTenantShopFacts(clients.facts, { projectId: args.projectId, orgId, openingDate })
    : null
  const schematicNodeIds = plans.filter((p) => p.purpose === 'distribution_schematic')
    .flatMap((p) => (shapesByPlan.get(p.id) ?? []).map((s) => s.nodeId).filter((x): x is string => !!x))
  const orders: Map<string, NodeOrderStatus> = schematicNodeIds.length
    ? await loadSchematicOrderStatus(clients.facts, { orgId, nodeIds: schematicNodeIds })
    : new Map()

  const files = new Map<string, { bytes: Uint8Array } | { error: string }>()
  let totalBytes = 0
  const inputs: StatusPlanRenderInput[] = []

  for (const plan of plans) {
    const title = planTitle(plan)
    const fp = fpById.get(plan.floorPlanId)
    if (!fp) { omitted.push({ title, reason: 'the drawing is no longer available' }); continue }
    const kind = sourceKindFor(fp.file_path)
    if (!kind) { omitted.push({ title, reason: `the drawing is not a PDF, PNG or JPEG file (${basename(fp.file_path)})` }); continue }

    let file = files.get(fp.file_path)
    if (!file) {
      const { data, error } = await clients.storage.from(DRAWINGS_BUCKET).download(fp.file_path)
      if (error || !data) {
        file = { error: `the drawing file could not be read (${error?.message ?? 'empty'})` }
      } else {
        const bytes = new Uint8Array(await data.arrayBuffer())
        if (totalBytes + bytes.byteLength > maxBytes) {
          omitted.push({ title, reason: 'the size cap for one PDF was reached — export this plan from its page' })
          continue // not cached: a smaller later drawing may still fit
        }
        totalBytes += bytes.byteLength
        file = { bytes }
      }
      files.set(fp.file_path, file)
    }
    if ('error' in file) { omitted.push({ title, reason: file.error }); continue }

    const source: PlanSource = kind === 'pdf' ? { kind, bytes: file.bytes, pageIndex: plan.pageIndex } : { kind, bytes: file.bytes }
    const ppm = scaleForPage(fp.pixels_per_meter == null ? null : Number(fp.pixels_per_meter), scalesByFp.get(fp.id) ?? new Map(), plan.pageIndex)
    const shapes = shapesByPlan.get(plan.id) ?? []
    const warnings: string[] = []
    if (fp.file_path !== plan.sourceFilePath) {
      warnings.push(`The drawing file changed since this plan was drawn (${basename(plan.sourceFilePath)} -> ${basename(fp.file_path)}); shapes may not line up.`)
    }
    const bad = badShapes.get(plan.id)
    if (bad) warnings.push(`${bad} shape${bad === 1 ? '' : 's'} could not be drawn (invalid geometry).`)

    let rendered: RenderShape[]
    let measured: StatusPlanRenderInput['measured'] = null
    if (plan.purpose === 'tenant_layout') {
      if (ppm == null) warnings.push('This page has no scale, so areas are not measured.')
      const shopAreas: Array<number | null> = []
      rendered = shapes.map((s) => {
        const areaM2 = shapeAreaM2(s.points, ppm)
        if (s.areaType) {
          return { points: s.points, style: areaShapeStyle(s.areaType), legendKey: s.areaType, label: { primary: AREA_TYPE_LABEL[s.areaType], areaM2 } }
        }
        const r = shopStatus(shopLinkFor(facts!, s.nodeId), args.today)
        const node = s.nodeId ? nodes.get(s.nodeId) : undefined
        if (node) shopAreas.push(areaM2)
        return {
          points: s.points,
          style: tenantShapeStyle(r),
          legendKey: r.overdue ? 'overdue' : r.status,
          label: node ? { primary: node.shop_number ?? node.code ?? '-', secondary: node.shop_name ?? node.name ?? null, areaM2 } : null,
        }
      })
      measured = totalMeasuredM2(shopAreas)
    } else {
      rendered = shapes.map((s) => {
        const node = s.nodeId ? nodes.get(s.nodeId) : undefined
        const status = dbBlockStatus(!!node, node ? orders.get(node.id) ?? null : null)
        return {
          points: s.points,
          style: dbBlockStyle(status),
          legendKey: status,
          label: node
            ? { primary: node.code ?? node.shop_number ?? node.name ?? '-', secondary: null }
            : s.detectedTag ? { primary: s.detectedTag, secondary: 'not linked' } : null,
        }
      })
    }

    inputs.push({
      planId: plan.id, planName: plan.name, purpose: plan.purpose, drawingName: fp.name ?? basename(fp.file_path),
      pageIndex: plan.pageIndex, generatedOn: args.today, source, shapes: rendered,
      legend: plan.purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND, measured, warnings,
    })
  }
  return { inputs, omitted }
}
```

> **Why `facts!` is safe.** `facts` is non-null whenever any plan is `tenant_layout`, and only tenant-layout shapes read it. Keep the `!`. Do not default `facts` to an empty object: that would silently paint every shop "unlinked".
>
> **The `->` in the warning is deliberate.** It is what `winAnsiSafe` would make of `→`, so the string reads the same on screen and in the PDF.

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/plan-render-data.test.ts`
Expected: PASS (12 tests).

**Mutation check:** drop the `readAllPages` loop (one `.range(0, 999)` call). "pages shapes past PostgREST max_rows" must go red with 1000 ≠ 1500.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/plan-render-data.ts apps/web/src/lib/status-plans/plan-render-data.test.ts
git commit -m "feat(status-plans): load plans as render inputs with caps and not-included reasons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Appendix (divider + plan pages) and its query options

**Files:**
- Create: `apps/web/src/lib/status-plans/appendix-options.ts`
- Test: `apps/web/src/lib/status-plans/appendix-options.test.ts`
- Create: `apps/web/src/lib/status-plans/appendix.ts`
- Test: `apps/web/src/lib/status-plans/appendix.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/status-plans/appendix-options.test.ts
import { describe, it, expect } from 'vitest'
import { statusPlanAppendixOptions, appendixPurposes, appendixQuery } from './appendix-options'

describe('appendix options', () => {
  it('reads ?tenantPlans=1 and ?schematicPlans=1; anything else is off', () => {
    expect(statusPlanAppendixOptions('http://x/r')).toEqual({ tenantLayout: false, schematic: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1')).toEqual({ tenantLayout: true, schematic: false })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=1&schematicPlans=1')).toEqual({ tenantLayout: true, schematic: true })
    expect(statusPlanAppendixOptions('http://x/r?tenantPlans=true')).toEqual({ tenantLayout: false, schematic: false })
  })
  it('purposes in appendix order and a round-trip query', () => {
    expect(appendixPurposes({ tenantLayout: true, schematic: true })).toEqual(['tenant_layout', 'distribution_schematic'])
    expect(appendixPurposes({ tenantLayout: false, schematic: false })).toEqual([])
    expect(appendixQuery({ tenantLayout: true, schematic: false })).toBe('?tenantPlans=1')
    expect(appendixQuery({ tenantLayout: false, schematic: false })).toBe('')
    expect(statusPlanAppendixOptions(`http://x/r${appendixQuery({ tenantLayout: false, schematic: true })}`)).toEqual({ tenantLayout: false, schematic: true })
  })
})
```

```ts
// apps/web/src/lib/status-plans/appendix.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { TENANT_LEGEND, SCHEMATIC_LEGEND } from '@esite/shared/status-plans'
import { extractPdfText, squash } from '@/test/pdf-text'
import { appendStatusPlansToReport } from './appendix'
import { A3_LANDSCAPE, type StatusPlanRenderInput } from './render-plan-page'
import type { PlanRenderLoadResult } from './plan-render-data'

const A4: [number, number] = [595.28, 841.89]

async function report(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (const n of [1, 2]) d.addPage(A4).drawText(`REPORT PAGE ${n}`, { x: 40, y: 800, size: 12, font: f })
  return d.save()
}
async function drawing(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([600, 400]).drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(0, 0, 1) })
  return d.save()
}
function plan(id: string, name: string, purpose: StatusPlanRenderInput['purpose'], bytes: Uint8Array): StatusPlanRenderInput {
  return {
    planId: id, planName: name, purpose, drawingName: 'Drawing', pageIndex: 1, generatedOn: '2026-10-09',
    source: { kind: 'pdf', bytes, pageIndex: 1 }, shapes: [], measured: null, warnings: [],
    legend: purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND,
  }
}
async function pageText(bytes: Uint8Array, i: number): Promise<string> {
  const src = await PDFDocument.load(bytes)
  const one = await PDFDocument.create()
  const [p] = await one.copyPages(src, [i])
  one.addPage(p!)
  return squash(extractPdfText(Buffer.from(await one.save())))
}
async function sizes(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])
}

describe('appendStatusPlansToReport', () => {
  it('nothing to append → the report bytes untouched', async () => {
    const base = await report()
    expect(await appendStatusPlansToReport(base, { inputs: [], omitted: [] }, '2026-10-09')).toBe(base)
  })

  it('report pages, then the divider, then one A3 page per plan in the given order', async () => {
    const src = await drawing()
    const load: PlanRenderLoadResult = {
      inputs: [plan('a', 'Alpha tenants', 'tenant_layout', src), plan('b', 'Bravo schematic', 'distribution_schematic', src)],
      omitted: [{ title: 'Charlie (Tenant layout, page 1)', reason: 'the drawing file could not be read (Object not found)' }],
    }
    const out = await appendStatusPlansToReport(await report(), load, '2026-10-09')
    const a3 = [Math.round(A3_LANDSCAPE[0]), Math.round(A3_LANDSCAPE[1])]
    expect(await sizes(out)).toEqual([[595, 842], [595, 842], [595, 842], a3, a3])
    expect(await pageText(out, 0)).toContain('REPORTPAGE1')
    const divider = await pageText(out, 2)
    expect(divider).toContain('Appendix—Tenantstatusplans')
    expect(divider.indexOf('Alphatenants')).toBeLessThan(divider.indexOf('Bravoschematic'))
    expect(divider).toContain('Charlie')
    expect(divider).toContain('couldnotberead(Objectnotfound)')
    expect(await pageText(out, 3)).toContain('Alphatenants')
    expect(await pageText(out, 4)).toContain('Bravoschematic')
  })

  it('a drawing that fails to embed gets no page and is listed with its reason', async () => {
    const load: PlanRenderLoadResult = {
      inputs: [plan('a', 'Alpha', 'tenant_layout', new TextEncoder().encode('not a pdf')), plan('b', 'Bravo', 'tenant_layout', await drawing())],
      omitted: [],
    }
    const out = await appendStatusPlansToReport(await report(), load, '2026-10-09')
    expect((await sizes(out)).length).toBe(4) // 2 report + divider + Bravo
    const divider = await pageText(out, 2)
    expect(divider).toContain('Alpha')
    expect(divider).toContain('thedrawingPDFcouldnotberead')
    expect(await pageText(out, 3)).toContain('Bravo')
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/appendix-options.test.ts src/lib/status-plans/appendix.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/status-plans/appendix-options.ts
/**
 * Which status plans ride along with the tenant schedule report. Pure (no pdf-lib) so the report
 * dialog — a client component — can import it. Absent params = no appendix, so every existing
 * caller of the report routes is unchanged.
 */
import type { StatusPlanPurpose } from '@esite/shared/status-plans'

export interface StatusPlanAppendixOptions { tenantLayout: boolean; schematic: boolean }

export function statusPlanAppendixOptions(url: string | URL): StatusPlanAppendixOptions {
  const p = new URL(url).searchParams
  return { tenantLayout: p.get('tenantPlans') === '1', schematic: p.get('schematicPlans') === '1' }
}

export function appendixPurposes(o: StatusPlanAppendixOptions): StatusPlanPurpose[] {
  const out: StatusPlanPurpose[] = []
  if (o.tenantLayout) out.push('tenant_layout')
  if (o.schematic) out.push('distribution_schematic')
  return out
}

export function appendixQuery(o: StatusPlanAppendixOptions): string {
  const p = new URLSearchParams()
  if (o.tenantLayout) p.set('tenantPlans', '1')
  if (o.schematic) p.set('schematicPlans', '1')
  const s = p.toString()
  return s ? `?${s}` : ''
}
```

```ts
// apps/web/src/lib/status-plans/appendix.ts
/**
 * "Appendix — Tenant status plans" for the tenant schedule report (spec §8), appended with pdf-lib
 * after react-pdf has rendered the report — the same shape as cable route sheets
 * (lib/cable-schedule/route-sheets.ts appendRouteSheetsToPdf).
 *
 * Plan pages are drawn first and the divider is INSERTED in front of them afterwards, so the divider
 * can list exactly what made it in and what did not (and why) — including a drawing that only failed
 * while embedding. One bad drawing never fails the report.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import { drawStatusPlanPage, planTitle, type PlanFonts, type StatusPlanRenderInput } from './render-plan-page'
import type { PlanOmission, PlanRenderLoadResult } from './plan-render-data'

const A4_W = 595.28
const A4_H = 841.89
const MAX_LISTED_OMISSIONS = 30
const T = (s: string) => winAnsiSafe(s)

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = T(text)
  if (font.widthOfTextAtSize(t, size) <= width) return t
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1)
  return `${t}...`
}

function drawDivider(page: PDFPage, included: StatusPlanRenderInput[], notIncluded: PlanOmission[], fonts: PlanFonts, generatedOn: string): void {
  const margin = 40
  let y = A4_H - margin
  page.drawRectangle({ x: 0, y: A4_H - 6, width: A4_W, height: 6, color: rgb(0.95, 0.6, 0.1) })
  page.drawText(T('Appendix — Tenant status plans'), { x: margin, y: y - 22, size: 18, font: fonts.bold, color: rgb(0.05, 0.05, 0.05) })
  y -= 44
  page.drawText(
    T(`Each plan is the project drawing with its shops and boards coloured from the tenant schedule as it stood on ${generatedOn}. Colours are computed when the report is generated, so this report is a snapshot of that day.`),
    { x: margin, y, size: 9, font: fonts.regular, color: rgb(0.35, 0.35, 0.35), maxWidth: A4_W - margin * 2, lineHeight: 12 },
  )
  y -= 44
  const cols = [
    { title: '#', x: margin, w: 18 },
    { title: 'Plan', x: margin + 22, w: 230 },
    { title: 'Kind', x: margin + 256, w: 110 },
    { title: 'Drawing', x: margin + 370, w: 120 },
    { title: 'Page', x: margin + 494, w: 30 },
  ]
  for (const c of cols) page.drawText(T(c.title), { x: c.x, y, size: 8.5, font: fonts.bold })
  y -= 6
  page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) })
  y -= 14
  included.forEach((p, i) => {
    const cells = [String(i + 1), p.planName, PURPOSE_LABEL[p.purpose], p.drawingName, String(p.pageIndex)]
    cells.forEach((cell, j) => page.drawText(fit(cell, fonts.regular, 8.5, cols[j]!.w), { x: cols[j]!.x, y, size: 8.5, font: fonts.regular }))
    y -= 15
  })
  if (included.length === 0) { page.drawText(T('No plan could be included.'), { x: margin, y, size: 9, font: fonts.regular }); y -= 15 }

  if (notIncluded.length > 0) {
    y -= 12
    page.drawText(T('Not included'), { x: margin, y, size: 10, font: fonts.bold })
    y -= 16
    for (const o of notIncluded.slice(0, MAX_LISTED_OMISSIONS)) {
      page.drawText(fit(`${o.title}: ${o.reason}`, fonts.regular, 8.5, A4_W - margin * 2), { x: margin, y, size: 8.5, font: fonts.regular, color: rgb(0.55, 0.3, 0.05) })
      y -= 13
    }
    if (notIncluded.length > MAX_LISTED_OMISSIONS) {
      page.drawText(T(`…and ${notIncluded.length - MAX_LISTED_OMISSIONS} more.`), { x: margin, y, size: 8.5, font: fonts.regular })
    }
  }
}

export async function appendStatusPlansToPdf(
  pdf: PDFDocument, load: PlanRenderLoadResult, fonts: PlanFonts, generatedOn: string,
): Promise<{ appended: number; notIncluded: PlanOmission[] }> {
  if (load.inputs.length === 0 && load.omitted.length === 0) return { appended: 0, notIncluded: [] }
  const dividerAt = pdf.getPageCount()
  const included: StatusPlanRenderInput[] = []
  const notIncluded: PlanOmission[] = [...load.omitted]
  for (const input of load.inputs) {
    const before = pdf.getPageCount()
    try {
      await drawStatusPlanPage(pdf, input, 'a3', fonts)
      included.push(input)
    } catch (e) {
      while (pdf.getPageCount() > before) pdf.removePage(pdf.getPageCount() - 1)
      notIncluded.push({ title: planTitle(input), reason: e instanceof Error ? e.message : String(e) })
    }
  }
  drawDivider(pdf.insertPage(dividerAt, [A4_W, A4_H]), included, notIncluded, fonts, generatedOn)
  return { appended: included.length, notIncluded }
}

/** Append to an already-rendered report. Returns the input bytes untouched when there is nothing to add. */
export async function appendStatusPlansToReport(reportPdf: Uint8Array, load: PlanRenderLoadResult, generatedOn: string): Promise<Uint8Array> {
  if (load.inputs.length === 0 && load.omitted.length === 0) return reportPdf
  const pdf = await PDFDocument.load(reportPdf)
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) }
  await appendStatusPlansToPdf(pdf, load, fonts, generatedOn)
  return pdf.save()
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/appendix-options.test.ts src/lib/status-plans/appendix.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/appendix-options.ts apps/web/src/lib/status-plans/appendix-options.test.ts apps/web/src/lib/status-plans/appendix.ts apps/web/src/lib/status-plans/appendix.test.ts
git commit -m "feat(status-plans): report appendix with divider and not-included list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The tenant schedule report carries the appendix

**Files:**
- Create: `apps/web/src/lib/status-plans/report-appendix.ts`
- Test: `apps/web/src/lib/status-plans/report-appendix.test.ts`
- Modify: `apps/web/src/lib/reports/render-tenant-schedule.ts`
- Modify: `apps/web/src/lib/reports/render-tenant-schedule.render.test.ts`
- Modify: `apps/web/src/app/api/projects/[id]/tenant-schedule/report-preview/route.ts`
- Modify: `apps/web/src/app/api/projects/[id]/tenant-schedule/reports/route.ts`
- Test: `apps/web/src/app/api/projects/[id]/tenant-schedule/report-preview/route.test.ts`
- Test: `apps/web/src/app/api/projects/[id]/tenant-schedule/reports/route.test.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
// apps/web/src/lib/status-plans/report-appendix.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn(), service: vi.fn() }))
vi.mock('@/lib/auth/require-project-access', () => ({ requireProjectAccess: m.access }))
vi.mock('./plan-render-data', () => ({ loadStatusPlanRenderInputs: m.load }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: m.service }))

import { loadReportAppendix } from './report-appendix'

const session = { tag: 'session' } as never
const base = { sessionClient: session, projectId: 'p1', today: '2026-10-09' }

beforeEach(() => {
  vi.clearAllMocks()
  m.access.mockResolvedValue({ ok: true })
  m.service.mockReturnValue({ storage: { tag: 'storage' } })
  m.load.mockResolvedValue({ inputs: [], omitted: [] })
})

describe('loadReportAppendix', () => {
  it('no params → no appendix, no gate call, no load', async () => {
    expect(await loadReportAppendix({ ...base, url: 'http://x/r' })).toEqual({ ok: true, appendix: null })
    expect(m.access).not.toHaveBeenCalled()
    expect(m.load).not.toHaveBeenCalled()
  })
  it('gates on project access before reading anything', async () => {
    m.access.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    expect(await loadReportAppendix({ ...base, url: 'http://x/r?tenantPlans=1' })).toEqual({ ok: false, status: 404, error: 'Project not found' })
    expect(m.access).toHaveBeenCalledWith(session, 'p1')
    expect(m.load).not.toHaveBeenCalled()
  })
  it('loads the chosen purposes with the session client for rows and the service client for facts and bytes', async () => {
    const r = await loadReportAppendix({ ...base, url: 'http://x/r?tenantPlans=1&schematicPlans=1' })
    expect(r).toEqual({ ok: true, appendix: { load: { inputs: [], omitted: [] }, generatedOn: '2026-10-09' } })
    const [clients, args] = m.load.mock.calls[0]!
    expect(clients.db).toBe(session)
    expect(clients.storage).toEqual({ tag: 'storage' })
    expect(args).toEqual({ projectId: 'p1', today: '2026-10-09', purposes: ['tenant_layout', 'distribution_schematic'] })
  })
  it('a load failure becomes one "not included" line, never an error', async () => {
    m.load.mockRejectedValue(new Error('status plans could not be read: boom'))
    const r = await loadReportAppendix({ ...base, url: 'http://x/r?schematicPlans=1' })
    expect(r).toEqual({ ok: true, appendix: { load: { inputs: [], omitted: [{ title: 'Tenant status plans', reason: 'the plans could not be loaded — generate the report again' }] }, generatedOn: '2026-10-09' } })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/report-appendix.test.ts`
Expected: FAIL — cannot resolve `./report-appendix`.

- [ ] **Step 3: Implement the helper**

```ts
// apps/web/src/lib/status-plans/report-appendix.ts
/**
 * The one place both tenant-report routes (preview + save) decide the status-plan appendix, so the
 * preview and the saved version cannot differ. Gate first (requireProjectAccess runs AS the caller,
 * site-scoped), then the service client for facts and drawing bytes. Never throws: a load failure is
 * a single "not included" line on the divider — the report itself still renders.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { requireProjectAccess } from '@/lib/auth/require-project-access'
import { appendixPurposes, statusPlanAppendixOptions } from './appendix-options'
import { loadStatusPlanRenderInputs, type PlanRenderLoadResult, type StorageLike } from './plan-render-data'

export interface ReportAppendix { load: PlanRenderLoadResult; generatedOn: string }
export type ReportAppendixResult =
  | { ok: true; appendix: ReportAppendix | null }
  | { ok: false; status: 404; error: string }

export async function loadReportAppendix(a: { url: string; sessionClient: SupabaseClient; projectId: string; today: string }): Promise<ReportAppendixResult> {
  const purposes = appendixPurposes(statusPlanAppendixOptions(a.url))
  if (purposes.length === 0) return { ok: true, appendix: null }
  const access = await requireProjectAccess(a.sessionClient, a.projectId)
  if (!access.ok) return access
  const service = createServiceClient()
  try {
    const load = await loadStatusPlanRenderInputs(
      { db: a.sessionClient, facts: service, storage: service.storage as unknown as StorageLike },
      { projectId: a.projectId, today: a.today, purposes },
    )
    return { ok: true, appendix: { load, generatedOn: a.today } }
  } catch (err) {
    console.error('[status-plans] report appendix could not be loaded', err)
    return {
      ok: true,
      appendix: { load: { inputs: [], omitted: [{ title: 'Tenant status plans', reason: 'the plans could not be loaded — generate the report again' }] }, generatedOn: a.today },
    }
  }
}
```

- [ ] **Step 4: Extend the report renderer test (failing)**

Add to `apps/web/src/lib/reports/render-tenant-schedule.render.test.ts`:

```ts
import { PDFDocument, rgb } from 'pdf-lib'
import { TENANT_LEGEND } from '@esite/shared/status-plans'
import { extractPdfText, squash } from '@/test/pdf-text'

async function pages(buf: Buffer) { return (await PDFDocument.load(buf)).getPageCount() }
async function drawingPdf() {
  const d = await PDFDocument.create()
  d.addPage([600, 400]).drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(0, 0, 1) })
  return d.save()
}
const planInput = (bytes: Uint8Array) => ({
  planId: 'a', planName: 'Ground floor tenants', purpose: 'tenant_layout' as const, drawingName: 'Tenant layout', pageIndex: 1,
  generatedOn: '2026-06-20', source: { kind: 'pdf' as const, bytes, pageIndex: 1 }, shapes: [], legend: TENANT_LEGEND,
  measured: null, warnings: [],
})

describe('renderTenantScheduleReport — status plan appendix', () => {
  function renderWith(appendix: Parameters<typeof renderTenantScheduleReport>[2]) {
    return renderTenantScheduleReport(baseData, resolveBranding(buildTenantScheduleBrandingInput(baseData, '2026-06-20')), appendix)
  }
  it('no appendix → the same page count as before', async () => {
    expect(await pages(await renderWith(null))).toBe(await pages(await render(baseData)))
  })
  it('appends a divider and one page per plan', async () => {
    const base = await pages(await render(baseData))
    const out = await renderWith({ load: { inputs: [planInput(await drawingPdf())], omitted: [] }, generatedOn: '2026-06-20' })
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(await pages(out)).toBe(base + 2)
    expect(squash(extractPdfText(out))).toContain('Appendix—Tenantstatusplans')
  })
  it('an unreadable drawing still ships the report, listed on the divider', async () => {
    const base = await pages(await render(baseData))
    const out = await renderWith({ load: { inputs: [planInput(new TextEncoder().encode('nope'))], omitted: [] }, generatedOn: '2026-06-20' })
    expect(await pages(out)).toBe(base + 1)
    expect(squash(extractPdfText(out))).toContain('thedrawingPDFcouldnotberead')
  })
})
```

Run: `pnpm --filter web exec vitest run src/lib/reports/render-tenant-schedule.render.test.ts`
Expected: FAIL — `renderTenantScheduleReport` ignores its third argument (page counts unchanged).

- [ ] **Step 5: Implement in the renderer**

Replace the body of `apps/web/src/lib/reports/render-tenant-schedule.ts`:

```ts
// Node-only: renderToBuffer is unavailable in the browser build.
// Tests for this file must use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { TenantScheduleReportDocument } from './tenant-schedule-report'
import type { TenantScheduleReportData } from './tenant-schedule-report-data'
import type { ResolvedBranding } from './branding'
import { appendStatusPlansToReport } from '@/lib/status-plans/appendix'
import { planTitle } from '@/lib/status-plans/render-plan-page'
import type { ReportAppendix } from '@/lib/status-plans/report-appendix'

export async function renderTenantScheduleReport(
  data: TenantScheduleReportData,
  branding: ResolvedBranding,
  appendix?: ReportAppendix | null,
): Promise<Buffer> {
  const element = React.createElement(
    TenantScheduleReportDocument,
    { data, branding },
  ) as React.ReactElement<DocumentProps>
  const buf = await renderToBuffer(element)
  if (!appendix || (appendix.load.inputs.length === 0 && appendix.load.omitted.length === 0)) return buf
  try {
    return Buffer.from(await appendStatusPlansToReport(new Uint8Array(buf), appendix.load, appendix.generatedOn))
  } catch (err) {
    // Per-plan failures are already handled inside the appendix; this is the unexpected case. The
    // report still ships, with every plan listed as not included.
    console.error('[tenant-schedule-report] status plan appendix failed', err)
    const fallback = {
      inputs: [],
      omitted: [...appendix.load.omitted, ...appendix.load.inputs.map((i) => ({ title: planTitle(i), reason: 'the plan could not be drawn' }))],
    }
    return Buffer.from(await appendStatusPlansToReport(new Uint8Array(buf), fallback, appendix.generatedOn))
  }
}
```

Run: `pnpm --filter web exec vitest run src/lib/reports/render-tenant-schedule.render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing route tests**

```ts
// apps/web/src/app/api/projects/[id]/tenant-schedule/report-preview/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), gather: vi.fn(), render: vi.fn(), appendix: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.getUser } }) }))
vi.mock('@/lib/reports/tenant-schedule-report-data', () => ({ gatherTenantScheduleReportData: m.gather }))
vi.mock('@/lib/reports/render-tenant-schedule', () => ({ renderTenantScheduleReport: m.render }))
vi.mock('@/lib/reports/branding', () => ({ resolveBranding: () => ({}) }))
vi.mock('@/lib/reports/tenant-schedule-report-branding', () => ({ buildTenantScheduleBrandingInput: () => ({}) }))
vi.mock('@/lib/status-plans/report-appendix', () => ({ loadReportAppendix: m.appendix }))

import { GET } from './route'

const PID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const call = (q = '') => GET(new NextRequest(`http://localhost/api/projects/${PID}/tenant-schedule/report-preview${q}`), { params: Promise.resolve({ id: PID }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  m.gather.mockResolvedValue({})
  m.render.mockResolvedValue(Buffer.from('%PDF-1.7'))
  m.appendix.mockResolvedValue({ ok: true, appendix: null })
})

describe('GET report-preview — status plan appendix', () => {
  it('passes the request URL to the appendix helper and its result to the renderer', async () => {
    const appendix = { load: { inputs: [], omitted: [] }, generatedOn: '2026-10-09' }
    m.appendix.mockResolvedValue({ ok: true, appendix })
    const res = await call('?tenantPlans=1')
    expect(res.status).toBe(200)
    expect(m.appendix.mock.calls[0]![0]).toMatchObject({ url: expect.stringContaining('tenantPlans=1'), projectId: PID })
    expect(m.render.mock.calls[0]![2]).toBe(appendix)
  })
  it('a refused gate is a 404 and nothing renders', async () => {
    m.appendix.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    const res = await call('?tenantPlans=1')
    expect(res.status).toBe(404)
    expect(m.render).not.toHaveBeenCalled()
  })
  it('signed out → 401 before any helper runs', async () => {
    m.getUser.mockResolvedValue({ data: { user: null } })
    expect((await call()).status).toBe(401)
    expect(m.appendix).not.toHaveBeenCalled()
  })
})
```

```ts
// apps/web/src/app/api/projects/[id]/tenant-schedule/reports/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), gather: vi.fn(), render: vi.fn(), appendix: vi.fn(), service: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.getUser } }), createServiceClient: m.service }))
vi.mock('@/lib/reports/tenant-schedule-report-data', () => ({ gatherTenantScheduleReportData: m.gather }))
vi.mock('@/lib/reports/render-tenant-schedule', () => ({ renderTenantScheduleReport: m.render }))
vi.mock('@/lib/reports/branding', () => ({ resolveBranding: () => ({}) }))
vi.mock('@/lib/reports/tenant-schedule-report-branding', () => ({ buildTenantScheduleBrandingInput: () => ({}) }))
vi.mock('@/lib/status-plans/report-appendix', () => ({ loadReportAppendix: m.appendix }))

import { POST } from './route'

const PID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'

beforeEach(() => {
  vi.clearAllMocks()
  m.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  m.gather.mockResolvedValue({})
  m.render.mockResolvedValue(Buffer.from('%PDF-1.7'))
  m.service.mockImplementation(() => { throw new Error('service client must not be reached in this test') })
})

describe('POST reports — status plan appendix', () => {
  it('a refused appendix gate stops before any render or write', async () => {
    m.appendix.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    const res = await POST(new NextRequest(`http://localhost/api/projects/${PID}/tenant-schedule/reports?tenantPlans=1`, { method: 'POST' }), { params: Promise.resolve({ id: PID }) })
    expect(res.status).toBe(404)
    expect(m.render).not.toHaveBeenCalled()
    expect(m.service).not.toHaveBeenCalled()
  })
})
```

Run: `pnpm --filter web exec vitest run "src/app/api/projects/[id]/tenant-schedule"`
Expected: FAIL — the routes never call `loadReportAppendix`.

- [ ] **Step 7: Wire both routes**

In `report-preview/route.ts`:
- Rename `_req` to `req`.
- Add `export const maxDuration = 60`.
- Import `loadReportAppendix`.
- Then replace the render block with:

```ts
  const today = new Date().toISOString().slice(0, 10)
  const branding = resolveBranding(buildTenantScheduleBrandingInput(data, today))

  const appendixResult = await loadReportAppendix({ url: req.url, sessionClient: supabase, projectId: id, today })
  if (!appendixResult.ok) return NextResponse.json({ error: appendixResult.error }, { status: appendixResult.status })

  let pdf: Buffer
  try {
    pdf = await renderTenantScheduleReport(data, branding, appendixResult.appendix)
  } catch (err) {
    console.error('[tenant-schedule-report-preview] render error', err)
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }
```

In `reports/route.ts`, make the same three changes (`req`, `maxDuration = 60`, the helper call before `renderTenantScheduleReport(data, branding, appendixResult.appendix)`). The helper call must come **before** `createServiceClient()`. Also record the appendix in the saved row, so the saved-reports panel can say what the version holds:

```ts
      summary: appendixResult.appendix
        ? { statusPlans: appendixResult.appendix.load.inputs.length, statusPlansNotIncluded: appendixResult.appendix.load.omitted.length }
        : null,
```

Add that to the `.insert({...})` object. `projects.reports.summary` exists since `00183`. Insert `null` when there is no appendix, exactly as before.

- [ ] **Step 8: Run and confirm green**

Run: `pnpm --filter web exec vitest run src/lib/status-plans/report-appendix.test.ts src/lib/reports "src/app/api/projects/[id]/tenant-schedule"`
Expected: PASS.

Run `pnpm --filter web exec vitest run src/lib/auth/service-client-gates.contract.test.ts`. It must stay green: `report-appendix.ts` uses the service client and contains `requireProjectAccess`, and the reports route already declared its own gate.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/status-plans/report-appendix.ts apps/web/src/lib/status-plans/report-appendix.test.ts apps/web/src/lib/reports/render-tenant-schedule.ts apps/web/src/lib/reports/render-tenant-schedule.render.test.ts "apps/web/src/app/api/projects/[id]/tenant-schedule"
git commit -m "feat(tenant-schedule): optional status plan appendix on the report (preview + save)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Report dialog — two checkboxes

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx`

- [ ] **Step 1: Add the failing tests** (append inside the existing `describe`)

```tsx
  function stubPdfFetch() {
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/x')
    URL.revokeObjectURL = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}), blob: () => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })) })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('previews with tenant plans by default and schematics off', async () => {
    const fetchMock = stubPdfFetch()
    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/projects/${PROJECT_ID}/tenant-schedule/report-preview?tenantPlans=1`)
    expect((screen.getByRole('checkbox', { name: /tenant status plans/i }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /distribution schematics/i }) as HTMLInputElement).checked).toBe(false)
  })

  it('ticking schematics re-renders, and Save carries the same choice', async () => {
    const fetchMock = stubPdfFetch()
    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('checkbox', { name: /distribution schematics/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/projects/${PROJECT_ID}/tenant-schedule/report-preview?tenantPlans=1&schematicPlans=1`)
    await userEvent.click(screen.getByRole('button', { name: /save to project/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2]![0]).toBe(`/api/projects/${PROJECT_ID}/tenant-schedule/reports?tenantPlans=1&schematicPlans=1`)
    expect(fetchMock.mock.calls[2]![1]).toEqual({ method: 'POST' })
  })
```

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"`
Expected: FAIL — no checkboxes, and the URL has no query.

- [ ] **Step 2: Implement**

In `TenantScheduleReportButton.tsx`:

```tsx
import { appendixQuery, type StatusPlanAppendixOptions } from '@/lib/status-plans/appendix-options'
```

Replace `const previewUrl = …` and `openPreview` with:

```tsx
  // Spec §8: tenant layout plans default ON, distribution schematics OFF. Preview and Save use the
  // same choice, so the saved version is exactly what was previewed.
  const [plans, setPlans] = useState<StatusPlanAppendixOptions>({ tenantLayout: true, schematic: false })
  const previewUrl = (o: StatusPlanAppendixOptions) => `/api/projects/${projectId}/tenant-schedule/report-preview${appendixQuery(o)}`

  async function openPreview(o: StatusPlanAppendixOptions = plans) {
    setOpen(true)
    setSaved(false)
    setError(null)
    setLoading(true)
    revokeBlob()
    setBlobUrl(null)
    try {
      const res = await fetch(previewUrl(o))
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Preview failed (HTTP ${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      blobRef.current = url
      setBlobUrl(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render the report preview.')
    } finally {
      setLoading(false)
    }
  }

  function togglePlans(key: keyof StatusPlanAppendixOptions) {
    const next = { ...plans, [key]: !plans[key] }
    setPlans(next)
    void openPreview(next)
  }
```

In `download`, change `a.href = blobRef.current ?? previewUrl` to `a.href = blobRef.current ?? previewUrl(plans)`.

In `save`, change the fetch to `` fetch(`/api/projects/${projectId}/tenant-schedule/reports${appendixQuery(plans)}`, { method: 'POST' }) ``.

Change the Generate button to `onClick={() => openPreview()}`. Without the arrow, React would pass the click event in as the options.

In the dialog header, add the checkboxes right after the title `<span>`:

```tsx
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--c-text-mid)', marginLeft: 12 }}>
                <input type="checkbox" checked={plans.tenantLayout} onChange={() => togglePlans('tenantLayout')} disabled={loading} />
                Tenant status plans
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--c-text-mid)' }}>
                <input type="checkbox" checked={plans.schematic} onChange={() => togglePlans('schematic')} disabled={loading} />
                Distribution schematics
              </label>
```

- [ ] **Step 3: Run and confirm green** (including the original Save → refresh test)

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"
git commit -m "feat(tenant-schedule): report dialog chooses which status plans to append

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Export sheet route (source size)

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts`
- Test: `apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ getUser: vi.fn(), access: vi.fn(), load: vi.fn(), render: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: m.getUser } }),
  createServiceClient: () => ({ storage: { tag: 'storage' } }),
}))
vi.mock('@/lib/auth/require-project-access', () => ({ requireProjectAccess: m.access }))
vi.mock('@/lib/status-plans/plan-render-data', () => ({ loadStatusPlanRenderInputs: m.load }))
vi.mock('@/lib/status-plans/render-plan-page', async () => {
  const actual = await vi.importActual<typeof import('@/lib/status-plans/render-plan-page')>('@/lib/status-plans/render-plan-page')
  return { ...actual, renderStatusPlanPdf: m.render }
})

import { GET } from './route'
import { StatusPlanSourceError } from '@/lib/status-plans/render-plan-page'

const PID = 'proj-1'
const PLAN = 'plan-1'
const call = () => GET(new NextRequest(`http://localhost/api/projects/${PID}/status-plans/${PLAN}/sheet`), { params: Promise.resolve({ id: PID, planId: PLAN }) })
const input = { planId: PLAN, planName: 'Main board 3.1 / Level 2', pageIndex: 1, generatedOn: '2026-10-09' }

beforeEach(() => {
  vi.clearAllMocks()
  m.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  m.access.mockResolvedValue({ ok: true })
  m.load.mockResolvedValue({ inputs: [input], omitted: [] })
  m.render.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
})

describe('GET status plan Export sheet', () => {
  it('signed out → 401', async () => {
    m.getUser.mockResolvedValue({ data: { user: null } })
    expect((await call()).status).toBe(401)
  })
  it('no project access → 404 and nothing is read', async () => {
    m.access.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    expect((await call()).status).toBe(404)
    expect(m.load).not.toHaveBeenCalled()
  })
  it('renders this plan only, at source size, as an attachment', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.load.mock.calls[0]![1]).toMatchObject({ projectId: PID, planIds: [PLAN], purposes: ['tenant_layout', 'distribution_schematic'] })
    expect(m.render).toHaveBeenCalledWith(input, 'source')
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="main-board-3-1-level-2-p1-\d{4}-\d{2}-\d{2}\.pdf"$/)
  })
  it('unknown plan → 404', async () => {
    m.load.mockResolvedValue({ inputs: [], omitted: [] })
    expect((await call()).status).toBe(404)
  })
  it('a drawing that cannot be used → 422 with the sentence', async () => {
    m.load.mockResolvedValue({ inputs: [], omitted: [{ title: 'x', reason: 'the drawing file could not be read (Object not found)' }] })
    const res = await call()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'This sheet could not be exported: the drawing file could not be read (Object not found).' })
    m.load.mockResolvedValue({ inputs: [input], omitted: [] })
    m.render.mockRejectedValue(new StatusPlanSourceError('the drawing PDF is password-protected'))
    const res2 = await call()
    expect(res2.status).toBe(422)
    expect((await res2.json()).error).toBe('This sheet could not be exported: the drawing PDF is password-protected.')
  })
})
```

Run: `pnpm --filter web exec vitest run "src/app/api/projects/[id]/status-plans"`
Expected: FAIL — route not found.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts
/**
 * "Export sheet": one status plan as a PDF at the drawing's own size (spec §8), with the source page
 * embedded as vector. Read-level: any role that can see the project (requireProjectAccess runs as the
 * caller, site-scoped) — the same set that can open the plan page. Plan rows are read through the
 * caller's session; facts and drawing bytes with the service client after the gate.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { STATUS_PLAN_PURPOSES } from '@esite/shared/status-plans'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireProjectAccess } from '@/lib/auth/require-project-access'
import { loadStatusPlanRenderInputs, MAX_STATUS_PLAN_SOURCE_BYTES, type StorageLike } from '@/lib/status-plans/plan-render-data'
import { renderStatusPlanPdf, StatusPlanSourceError } from '@/lib/status-plans/render-plan-page'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'status-plan'
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; planId: string }> }) {
  const { id, planId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const access = await requireProjectAccess(supabase, id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const service = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  let load
  try {
    load = await loadStatusPlanRenderInputs(
      { db: supabase, facts: service, storage: service.storage as unknown as StorageLike },
      { projectId: id, today, purposes: STATUS_PLAN_PURPOSES, planIds: [planId], maxPlans: 1, maxSourceBytes: MAX_STATUS_PLAN_SOURCE_BYTES },
    )
  } catch (err) {
    console.error('[status-plans/sheet] load error', err)
    return NextResponse.json({ error: 'The plan could not be loaded — try again.' }, { status: 500 })
  }
  const input = load.inputs[0]
  if (!input) {
    const reason = load.omitted[0]?.reason
    return reason
      ? NextResponse.json({ error: `This sheet could not be exported: ${reason}.` }, { status: 422 })
      : NextResponse.json({ error: 'Status plan not found' }, { status: 404 })
  }

  let bytes: Uint8Array
  try {
    bytes = await renderStatusPlanPdf(input, 'source')
  } catch (err) {
    if (err instanceof StatusPlanSourceError) {
      return NextResponse.json({ error: `This sheet could not be exported: ${err.message}.` }, { status: 422 })
    }
    console.error('[status-plans/sheet] render error', err)
    return NextResponse.json({ error: 'Sheet render failed' }, { status: 500 })
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug(input.planName)}-p${input.pageIndex}-${today}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **Step 3: Run and confirm green**

Run: `pnpm --filter web exec vitest run "src/app/api/projects/[id]/status-plans" src/lib/auth`
Expected: PASS. The `service-client-gates` and `role-gate-call-sites` contracts stay green, because the route calls `requireProjectAccess` and checks `.ok`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet"
git commit -m "feat(status-plans): Export sheet route (vector, source size)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Export sheet button on the plan page

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/_components/ExportSheetButton.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/_components/ExportSheetButton.test.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx` (slice 2/3)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/_components/ExportSheetButton.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportSheetButton } from './ExportSheetButton'

afterEach(() => { vi.unstubAllGlobals() })

describe('ExportSheetButton', () => {
  it('downloads the sheet with the server filename', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/s')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-disposition': 'attachment; filename="mb-3-1-p1-2026-10-09.pdf"' }),
      blob: () => Promise.resolve(new Blob(['%PDF'])),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ExportSheetButton projectId="p" planId="s" />)
    await userEvent.click(screen.getByRole('button', { name: /export sheet/i }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p/status-plans/s/sheet')
    const a = click.mock.contexts[0] as HTMLAnchorElement
    expect(a.download).toBe('mb-3-1-p1-2026-10-09.pdf')
  })
  it('shows the server sentence when the sheet cannot be exported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: () => Promise.resolve({ error: 'This sheet could not be exported: the drawing PDF is password-protected.' }) }))
    render(<ExportSheetButton projectId="p" planId="s" />)
    await userEvent.click(screen.getByRole('button', { name: /export sheet/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('password-protected')
  })
})
```

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/status-plans/[planId]/_components/ExportSheetButton.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

```tsx
// apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/_components/ExportSheetButton.tsx
'use client'

/**
 * "Export sheet" — the plan as a PDF at the drawing's own size. fetch → blob (not a bare <a href>) so a
 * refusal shows its sentence instead of downloading a JSON file named .pdf.
 * Props are strings only (page.tsx → client component must be JSON).
 */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'

export function ExportSheetButton({ projectId, planId }: { projectId: string; planId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportSheet() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/status-plans/${planId}/sheet`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Export failed (HTTP ${res.status}).`)
        return
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'status-plan.pdf'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError('Export failed — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button variant="secondary" size="sm" onClick={exportSheet} isLoading={busy} disabled={busy}>Export sheet</Button>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
    </span>
  )
}
```

- [ ] **Step 3: Mount it**

In `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx` (slice 2/3), import the button and render it in the page header next to the plan title:

```tsx
{plan.purpose === 'distribution_schematic' && <ExportSheetButton projectId={projectId} planId={plan.id} />}
```

The route serves tenant layouts too. Spec §8 asks for the button on schematic plans only. Note in the PR that showing it on tenant layouts is a one-line owner choice. Pass strings only (the JSON-props contract).

- [ ] **Step 4: Run and confirm green**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/status-plans"`
Expected: PASS, including slice 2's page tests and the JSON-props contract test.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]"
git commit -m "feat(status-plans): Export sheet button on schematic plans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Client portal — read-only plan view

**Files:**
- Modify: `apps/web/src/lib/portal/data.ts`
- Create: `apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.ts`
- Test: `apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.test.ts`
- Create: `apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.tsx`
- Test: `apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.test.tsx`
- Modify: `apps/web/src/components/portal/PortalProjectNav.tsx`

- [ ] **Step 1: Write the failing route test**

```ts
// apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ portal: vi.fn(), load: vi.fn(), render: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ tag: 'session' }), createServiceClient: () => ({ storage: {} }) }))
vi.mock('@/lib/portal/data', () => ({ requirePortalAccess: m.portal }))
vi.mock('@/lib/status-plans/plan-render-data', () => ({ loadStatusPlanRenderInputs: m.load }))
vi.mock('@/lib/status-plans/render-plan-page', async () => {
  const actual = await vi.importActual<typeof import('@/lib/status-plans/render-plan-page')>('@/lib/status-plans/render-plan-page')
  return { ...actual, renderStatusPlanPdf: m.render }
})

import { GET } from './route'

const call = () => GET(new NextRequest('http://localhost/api/portal/p1/status-plans/s1/pdf'), { params: Promise.resolve({ projectId: 'p1', planId: 's1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.portal.mockResolvedValue({ userId: 'u', organisationId: 'o', projectId: 'p1' })
  m.load.mockResolvedValue({ inputs: [{ planName: 'Ground floor', pageIndex: 1 }], omitted: [] })
  m.render.mockResolvedValue(new Uint8Array([0x25]))
})

describe('GET portal status plan PDF', () => {
  it('only a client viewer with an active membership on THIS project gets it', async () => {
    m.portal.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.load).not.toHaveBeenCalled()
    expect(m.portal).toHaveBeenCalledWith('p1')
  })
  it('renders A3 inline', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.render.mock.calls[0]![1]).toBe('a3')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
  })
  it('a drawing that cannot be used → 422 sentence, not a 500', async () => {
    m.load.mockResolvedValue({ inputs: [], omitted: [{ title: 't', reason: 'the drawing is no longer available' }] })
    const res = await call()
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('This plan cannot be shown: the drawing is no longer available.')
  })
})
```

Run: `pnpm --filter web exec vitest run "src/app/api/portal"`
Expected: FAIL — route not found.

- [ ] **Step 2: Implement the route**

```ts
// apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.ts
/**
 * Client portal: one status plan as an A3 PDF, inline (spec §7). Gate = requirePortalAccess
 * (client_viewer in the active org AND an active project_members row on THIS project). Plan rows
 * then read through the viewer's own session (00245 SELECT admits client_viewer, so RLS stays the
 * second gate); facts and drawing bytes with the service client, as the portal's other curated reads.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { STATUS_PLAN_PURPOSES } from '@esite/shared/status-plans'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requirePortalAccess } from '@/lib/portal/data'
import { loadStatusPlanRenderInputs, type StorageLike } from '@/lib/status-plans/plan-render-data'
import { renderStatusPlanPdf, StatusPlanSourceError } from '@/lib/status-plans/render-plan-page'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string; planId: string }> }) {
  const { projectId, planId } = await params
  const access = await requirePortalAccess(projectId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await createClient()
  const service = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const load = await loadStatusPlanRenderInputs(
    { db: session, facts: service, storage: service.storage as unknown as StorageLike },
    { projectId, today, purposes: STATUS_PLAN_PURPOSES, planIds: [planId], maxPlans: 1 },
  ).catch((err: unknown) => { console.error('[portal/status-plans] load error', err); return null })
  if (!load) return NextResponse.json({ error: 'This plan could not be loaded — try again.' }, { status: 500 })

  const input = load.inputs[0]
  if (!input) {
    const reason = load.omitted[0]?.reason
    return reason
      ? NextResponse.json({ error: `This plan cannot be shown: ${reason}.` }, { status: 422 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const bytes = await renderStatusPlanPdf(input, 'a3')
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="status-plan.pdf"', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if (err instanceof StatusPlanSourceError) return NextResponse.json({ error: `This plan cannot be shown: ${err.message}.` }, { status: 422 })
    console.error('[portal/status-plans] render error', err)
    return NextResponse.json({ error: 'The plan could not be drawn.' }, { status: 500 })
  }
}
```

- [ ] **Step 3: The portal list — data function, page and test**

Append to `apps/web/src/lib/portal/data.ts`:

```ts
/** Status plans (spec 2026-10-09 §7) — read via the USER client: 00245's SELECT admits client_viewer. */
export async function listPortalStatusPlans(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('tenants')
    .from('status_plans')
    .select('id, name, purpose, page_index, updated_at, floor_plans(name)')
    .eq('project_id', projectId)
    .order('purpose')
    .order('name')
  return (data ?? []) as Array<{
    id: string; name: string; purpose: 'tenant_layout' | 'distribution_schematic'; page_index: number; updated_at: string
    floor_plans: { name: string | null } | null
  }>
}
```

```tsx
// apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const list = vi.hoisted(() => vi.fn())
vi.mock('@/lib/portal/data', () => ({ listPortalStatusPlans: list }))

import PortalStatusPlansPage from './page'

describe('portal status plans', () => {
  it('lists each plan with a link that opens its PDF', async () => {
    list.mockResolvedValue([{ id: 's1', name: 'Ground floor', purpose: 'tenant_layout', page_index: 1, updated_at: '2026-10-09T00:00:00Z', floor_plans: { name: 'Tenant layout' } }])
    render(await PortalStatusPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    const link = screen.getByRole('link', { name: /open ground floor/i })
    expect(link.getAttribute('href')).toBe('/api/portal/p1/status-plans/s1/pdf')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('Tenant layout')).toBeDefined()
  })
  it('empty state', async () => {
    list.mockResolvedValue([])
    render(await PortalStatusPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(screen.getByText(/no status plans on this site yet/i)).toBeDefined()
  })
})
```

```tsx
// apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.tsx
import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import { listPortalStatusPlans } from '@/lib/portal/data'
import { PortalCard, EmptyState, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Status plans — coloured drawings, read-only; each opens as a PDF (computed for today). */
export default async function PortalStatusPlansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const plans = await listPortalStatusPlans(projectId)

  return (
    <PortalCard>
      {plans.length === 0 ? (
        <EmptyState label="No status plans on this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Kind</th>
                <th style={thStyle}>Drawing</th>
                <th style={thStyle}>Page</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{PURPOSE_LABEL[p.purpose]}</td>
                  <td style={tdStyle}>{p.floor_plans?.name ?? '—'}</td>
                  <td style={tdStyle}>{p.page_index}</td>
                  <td style={tdStyle}>{fmtDate(p.updated_at)}</td>
                  <td style={tdStyle}>
                    <a href={`/api/portal/${projectId}/status-plans/${p.id}/pdf`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.name}`}>
                      Open PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  )
}
```

> The `(portal)/portal/[projectId]/layout.tsx` gate (`requirePortalAccess`) already runs before this page.
>
> The PDF opens in a new tab rather than an `<iframe>`, because every same-origin response carries `X-Frame-Options: DENY`.
>
> `PURPOSE_LABEL['tenant_layout']` must be 'Tenant layout' for the test's `getByText('Tenant layout')`. If slice 1's label differs, assert the slice-1 value instead.

In `PortalProjectNav.tsx`, add `{ slug: 'status-plans', label: 'Status Plans' },` after the `tenant-schedule` entry.

- [ ] **Step 4: Run and confirm green**

Run: `pnpm --filter web exec vitest run "src/app/api/portal" "src/app/(portal)" src/lib/auth`
Expected: PASS. In `service-client-gates`, the portal route contains `requirePortalAccess`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/portal/data.ts "apps/web/src/app/api/portal" "apps/web/src/app/(portal)/portal/[projectId]/status-plans" apps/web/src/components/portal/PortalProjectNav.tsx
git commit -m "feat(portal): read-only status plans (PDF per plan)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: RBAC matrix

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Add the rows**

Add to the **API routes** table (columns: owner | admin | project_manager | contractor | inspector | supplier | client_viewer):

```markdown
| `GET /api/projects/[id]/tenant-schedule/report-preview` · `POST /api/projects/[id]/tenant-schedule/reports` (`?tenantPlans=1` / `?schematicPlans=1` append the status plans — spec 2026-10-09 §8) | R | R | R | R | R | — | R²¹ |
| `GET /api/projects/[id]/status-plans/[planId]/sheet` (Export sheet — the plan at the drawing's own size) | R | R | R | R | R | — | R²¹ |
```

Add to the **portal** table (columns: client_viewer | all other roles):

```markdown
| `/portal/[projectId]/status-plans` | R | → `/dashboard` |
| `GET /api/portal/[projectId]/status-plans/[planId]/pdf` | R | 404 (`requirePortalAccess`) |
```

Add a footnote under the API table:

```markdown
> ²¹ **Status plans in PDF (slice 4).**
> - **Report routes.** Their existing view-level gate is unchanged. The appendix adds `requireProjectAccess` (as the caller, site-scoped) before anything is read.
> - **Export sheet.** Gated by `requireProjectAccess` alone, the same set that can open the plan page.
> - **Reads.** Plan, shape, drawing and node rows go through the caller's session (00245 SELECT, which admits every project role including client_viewer). Order and scope facts and the drawing bytes in the `drawings` bucket use the service client, after the gate.
> - **No writes on any of these paths** apart from the existing report save. The saved report's `summary` gains `statusPlans` / `statusPlansNotIncluded` counts.
> - Colours are computed at render time, so a saved report version is a snapshot of that day.
```

**Before committing, verify the report-route cells against the gate.** The gate is `gatherTenantScheduleReportData` → `projectService.getById` under RLS plus site_scope. The client_viewer `R²¹` is reachable by API only (the admin page bounces a client viewer). If a role's cell does not match what RLS admits, fix the cell and leave the code alone.

- [ ] **Step 2: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): status plan PDF routes and portal view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Full verification

- [ ] **Step 1: All three suites** (memory: `packages/db` holds repo-wide guards)

```bash
pnpm --filter web test
pnpm --filter @esite/shared test
pnpm --filter @esite/db test:ci
```

Expected: all green. The web count rises by about 65 tests from this slice.

- [ ] **Step 2: Types, lint, build**

```bash
pnpm --filter web type-check
pnpm --filter web lint
pnpm --filter web build
```

Expected: `tsc` 0 errors; eslint clean; `next build` exit 0.

- The build matters here. It is the only check that catches a non-async export from a `'use server'` file, and a server-only import (pdf-lib, `node:zlib`) leaking into a client chunk.
- `appendix-options.ts` is the one status-plans module the dialog imports. Confirm it pulls in no pdf-lib: `grep -l "pdf-lib" .next/static/chunks/*.js` should show no new chunk naming `appendix-options`.

- [ ] **Step 3: Size check on a realistic sheet (Assumption 9)**

1. Write a throwaway script in the session scratchpad (outside the repo) that builds an A0 source PDF with pdf-lib: 2384 × 3370 pt, `/Rotate 90`, and about 50 000 line segments. It renders 150 rect shapes with `renderStatusPlanPdf(…, 'source')` and with `'a3'`, then prints the byte sizes and the render time.
2. Record the figures in the PR body.
3. If either output exceeds 4 MB, stop and raise it with the owner before merging. The fallback is to upload to `reports` and `302` to a signed URL, which changes both routes, and the decision is the owner's, not a silent patch.

- [ ] **Step 4: PR body must state**

- Mutation results from Tasks 1, 2 and 4.
- Which loader served schematic order status (Assumption 4).
- The size measurements.
- Known gaps: JPEG EXIF orientation; label collision on dense plans (labels may overlap; there is no layout solver); the portal shows both purposes (owner may hide schematics); Export sheet appears on schematic plans only (one line to widen).
- **Not verified, and owed by the owner on production:**
  1. On KINGSWALK, Tenant Schedule → Generate report → see "Tenant status plans" ticked → the appendix divider and A3 pages → tick "Distribution schematics" → the 643/E/300 page appears → Save to project.
  2. Open a schematic plan → Export sheet → the PDF opens at the sheet's size, and the hatches sit on the drawn blocks (the drawing is `/Rotate 90`).
  3. As a client viewer → portal → Status Plans → Open PDF.

- [ ] **Step 5: Final commit (only if Steps 1–3 changed anything)**

```bash
git add -A apps/web docs
git commit -m "chore(status-plans): slice 4 verification fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
