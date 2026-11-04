# Floor-Plan Label Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an editable tenant floor plan, find every `SHOP nn` label in the PDF text layer, link the hand-drawn shape that contains it, prompt a draw for the rest, and offer a flood-fill outline per shop behind the GLA gate.

**Architecture:** Pure label detection and review live in `@esite/shared/status-plans` beside the 300's detector and reuse its matcher. The browser reads the text layer with the existing `extractPageText`, runs the fill on the bitmap the canvas already holds, and writes through two new server actions (link/unlink, compensation-style like `realignShapesAction`) plus the existing create-shape action. A `ShopsPanel` replaces nothing: it renders only for `tenant_layout`, where the 300 panels render only for `distribution_schematic`.

**Tech Stack:** TypeScript, Next.js 15 server actions, zod, Supabase (no migration), pdf.js 5.7.284, Konva canvas, vitest (+ RTL for `.tsx`).

**Spec:** `docs/superpowers/specs/2026-10-21-floor-plan-label-detection-design.md`

## Global Constraints

- No migration. Writes must satisfy 00245's constraints: `shape IN ('polygon','rect')`, `source IN ('manual','detected')`, `detected_tag` ≤ 64, points 6–4000 values, partial unique `(status_plan_id, node_id)`; 00249's trigger refuses a non-`tenant_db` node on a `tenant_layout` plan.
- Every coordinate is image space at `IMAGE_SPACE_SCALE = 2`; labels come through `textItemsToImageSpace` unchanged.
- Role gate: `canEdit` in the workspace; server actions call `requireEffectiveRole(…, ORG_WRITE_ROLES)` and refuse `purpose !== 'tenant_layout'`.
- A `'use server'` file exports only async functions. Server tests that handle bytes carry `// @vitest-environment node`.
- Constants (spec §4.1, §4.6): `NEAR_PX = 120`, `INK_LUMA = 170`, dilate 1 px, seed grid ±24 × ±16 px step 8, `LEAK_CAP = 0.015` of page pixels, grow 2 px, Douglas–Peucker ε = 2 px, `MAX_VERTICES = 1000`, gate band `0.80 ≤ fill/GLA ≤ 1.20`, `AREA_TOLERANCE = 0.02` (existing).
- Nothing is saved with `source: 'detected'` except from the Accept handler (contract test, Task 8).
- Run `pnpm --filter @esite/shared test`, `pnpm --filter web test`, `pnpm --filter web type-check` and lint before every commit that touches those packages.

## Review Focus

1. A label split across two text items ("SHOP" then "92A") on one baseline: joined, not dropped (Task 1 test `joins a split run on one baseline`).
2. A sheet whose labels are rotated or whose text layer is empty: the panel says "No SHOP labels found on this sheet; draw the shops by hand" and offers nothing (Task 2 `summary for zero labels`, Task 7 render test).
3. A tenant decommissioned on the schedule whose label is still on the drawing: `not_on_schedule` with the reason "decommissioned", never a link (Task 2 test).
4. Two people linking the same tenant at once: the unique index raises 23505 mid-batch; the action puts back completed links and reports a conflict (Task 3 test).
5. The label anchor lands on a glyph of its own text: the seed probe finds the white around it instead of reporting no region (Task 4 test `seeds from a grid when the anchor is ink`).

---

### Task 1: Shop label detection (shared)

**Files:**
- Create: `packages/shared/src/status-plans/detect-shop-labels.ts`
- Test: `packages/shared/src/status-plans/detect-shop-labels.test.ts`
- Modify: `packages/shared/src/status-plans/index.ts` (add `export * from './detect-shop-labels'`)

**Interfaces:**
- Consumes: `ImageTextItem { str, x, baseline, top, width, height }` from `text-space.ts`; `Box`, `Pt` from `geometry.ts`.
- Produces:
  ```ts
  export const SHOP_LABEL_RE = /^SHOP\s*([0-9A-Z][0-9A-Z/.\-]*)$/i
  export const NEAR_PX = 120
  export interface DetectedShopLabel { tag: string; box: Box; anchor: Pt; name: string | null; drawingAreaM2: number | null }
  export interface ShopLabelResult { labels: DetectedShopLabel[]; duplicates: Record<string, number>; textItemCount: number }
  export function parseAreaM2(str: string): number | null
  export function detectShopLabels(items: readonly ImageTextItem[]): ShopLabelResult
  ```
  `duplicates` is keyed by `normaliseTag(tag)` (from `match-nodes.ts`) with the count, for every tag seen more than once; all of its labels stay in `labels`.

- [ ] **Step 1: Write the failing tests**

Fixtures are strings lifted from the production sheets. Build items with a helper `item(str, x, baseline, w = str.length * 6, h = 10)`.

```ts
describe('detectShopLabels', () => {
  it('finds SHOP labels in both cases and keeps the tag as printed', () => {
    const r = detectShopLabels([item('SHOP 92A', 100, 100), item('Shop 10a', 300, 100), item('SHOP K04', 500, 100), item('SHOP 20/21', 700, 100)])
    expect(r.labels.map((l) => l.tag)).toEqual(['92A', '10a', 'K04', '20/21'])
    expect(r.textItemCount).toBe(4)
  })
  it('ignores bare numbers, DB tags and prose', () => {
    expect(detectShopLabels([item('92A', 0, 0), item('DB-10A', 0, 20), item('SHOPFRONT', 0, 40), item('SHOP', 0, 60)]).labels).toEqual([])
  })
  it('anchor is the centre of the label box', () => {
    const [l] = detectShopLabels([item('SHOP 46', 100, 110, 48, 10)]).labels
    expect(l.box).toEqual({ minX: 100, minY: 100, maxX: 148, maxY: 110 })
    expect(l.anchor).toEqual({ x: 124, y: 105 })
  })
  it('takes the nearest name and the m² figure within NEAR_PX', () => {
    const [l] = detectShopLabels([item('SHOP 38', 1000, 1000), item('PnP LIQUOR', 1000, 985), item('304.52 m²', 1000, 1015), item('281.15 m²', 1200, 1000), item('SHOP 38A', 1090, 1000)]).labels
    expect(l.name).toBe('PnP LIQUOR'); expect(l.drawingAreaM2).toBe(304.52)
  })
  it('parses the three m² spellings on the sheets', () => {
    expect(parseAreaM2('31.67 m²')).toBe(31.67); expect(parseAreaM2('2,825 m2')).toBe(2825); expect(parseAreaM2('28 m²')).toBe(28); expect(parseAreaM2('m²')).toBeNull(); expect(parseAreaM2('340 mm')).toBeNull()
  })
  it('reports duplicates and keeps both labels', () => {
    const r = detectShopLabels([item('SHOP 12', 0, 0), item('SHOP 012', 900, 900)])
    expect(r.labels).toHaveLength(2); expect(r.duplicates).toEqual({ [normaliseTag('12')]: 2 })
  })
  it('joins a split run on one baseline (synthetic; the real sheets do not split)', () => {
    const [l] = detectShopLabels([item('SHOP', 100, 100, 30, 10), item('92A', 134, 100, 20, 10)]).labels
    expect(l.tag).toBe('92A'); expect(l.box.maxX).toBe(154)
  })
  it('does not join across a gap wider than one label height', () => {
    expect(detectShopLabels([item('SHOP', 100, 100, 30, 10), item('92A', 150, 100, 20, 10)]).labels).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- detect-shop-labels`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `detectShopLabels` and `parseAreaM2`**

Join rule: a `SHOP` item followed by a tag-shaped item whose `baseline` is within 0.35 × height and whose left edge is within one height of the `SHOP` item's right edge. Name rule: nearest item by anchor distance ≤ `NEAR_PX` that is not a label, not `parseAreaM2`-parsable, and has at least one letter. Area rule: nearest parsable item ≤ `NEAR_PX`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- detect-shop-labels`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/detect-shop-labels.ts packages/shared/src/status-plans/detect-shop-labels.test.ts packages/shared/src/status-plans/index.ts
git commit -m "feat(status-plans): detect SHOP labels on the floor plan text layer"
```

---

### Task 2: Shop review (shared)

**Files:**
- Create: `packages/shared/src/status-plans/review-shop-labels.ts`
- Test: `packages/shared/src/status-plans/review-shop-labels.test.ts`
- Modify: `packages/shared/src/status-plans/index.ts`

**Interfaces:**
- Consumes: Task 1's `ShopLabelResult`, `DetectedShopLabel`; `MatchableNode`, `buildNodeIndex`, `matchBlock`, `normaliseTag` from `match-nodes.ts`; `pointInShape`, `shapeAreaPx` from `geometry.ts`; `AREA_TOLERANCE` from `area-check.ts`.
- Produces:
  ```ts
  export type ShopRowState = 'linked' | 'linked_outside' | 'link' | 'conflict' | 'draw' | 'needs_you' | 'not_on_schedule' | 'moved'
  export interface ShopReviewShape { id: string; points: readonly number[]; nodeId: string | null; areaType: string | null }
  export interface ShopReviewNode extends MatchableNode { scheduledM2: number | null; decommissioned: boolean }
  export interface ShopReviewInput { labels: ShopLabelResult; nodes: readonly ShopReviewNode[]; shapes: readonly ShopReviewShape[]; replaced: boolean }
  export interface ShopReviewRow {
    key: string; label: DetectedShopLabel; state: ShopRowState
    nodeId: string | null; shapeId: string | null; otherShapeId: string | null
    candidateIds: string[]; reason: string | null; areaNote: string | null
  }
  export interface ShopReview { rows: ShopReviewRow[]; unlabelled: string[]; counts: Record<ShopRowState, number>; duplicates: Record<string, number>; labelCount: number; textItemCount: number }
  export function reviewShopLabels(input: ShopReviewInput): ShopReview
  export function shopReviewSummary(r: ShopReview): string
  ```

- [ ] **Step 1: Write the failing tests**

Helpers: `rect(id, x0, y0, x1, y1, nodeId = null)` → `ShopReviewShape`; `node(id, shop_number, scheduledM2 = null, decommissioned = false)`; `label(tag, x, y, drawingAreaM2 = null)`; `review(labels, nodes, shapes, replaced = false)`.

```ts
it('linked: the containing shape already carries the matched node', …)       // state 'linked', shapeId set
it('link: containing shape is unlinked and the node is free', …)              // state 'link', shapeId set, nodeId set
it('conflict: containing shape is linked to another tenant', …)               // state 'conflict', otherShapeId null, reason names both tags
it('conflict: node already on a different shape while an unlinked shape contains the label', …) // otherShapeId = the linked shape
it('linked_outside: node linked elsewhere and nothing contains the label', …) // not conflict; reason 'label outside the shape'
it('moved: linked_outside on a replaced sheet', …)                             // replaced: true → 'moved'
it('draw: unique match, nothing contains the label', …)
it('needs_you: ambiguous match lists candidates; duplicate label never links', …) // duplicates {12:2} → both rows needs_you
it('not_on_schedule: no node for the tag; decommissioned node gives the reason "decommissioned"', …)
it('the smaller of two containing shapes wins; the larger is reported unlabelled', …)
it('area-typed shapes are never unlabelled and never contain a shop', …)
it('areaNote when drawing m² and scheduled m² differ by more than 2 %', …)   // "drawing says 304.52 m², schedule says 281.15 m²"
it('no areaNote within 2 % or when either figure is missing', …)
it('summary for zero labels tells the person to draw by hand', () => {
  expect(shopReviewSummary(review([], [], []))).toBe('No SHOP labels found on this sheet; draw the shops by hand.')
})
it('summary counts every state', () => { /* '109 labels · 1,949 items read · 3 on the plan · 42 to link · 64 to draw · 0 conflicts · 0 need you · 1 not on the schedule · 0 duplicates' */ })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- review-shop-labels`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `reviewShopLabels` and `shopReviewSummary`**

Order of decision per label: duplicate → `needs_you`; match via `matchBlock({ tag, name })` over `buildNodeIndex(nodes.filter(!decommissioned))` → `needs_you` / `not_on_schedule`; then the containing shape (smallest by `shapeAreaPx` among non-area shapes with `pointInShape(anchor)`), the node's current shape (`shapes.find(s => s.nodeId === nodeId)`), and `replaced` decide the rest per the table in spec §4.3. `key` is `normaliseTag(tag)` plus an index for duplicates.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- review-shop-labels`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/review-shop-labels.ts packages/shared/src/status-plans/review-shop-labels.test.ts packages/shared/src/status-plans/index.ts
git commit -m "feat(status-plans): review floor-plan labels against the schedule and the drawn shapes"
```

---

### Task 3: Link and unlink actions; create-shape accepts source and tag

**Files:**
- Create: `apps/web/src/actions/status-plan-link.actions.ts`
- Test: `apps/web/src/actions/status-plan-link.actions.test.ts`
- Modify: `apps/web/src/actions/status-plan.actions.ts:89-120` (`createShapeSchema` gains `source: z.enum(SHAPE_SOURCES).optional()` and `detectedTag: z.string().trim().max(DETECTED_TAG_MAX).nullable().optional()`; the insert writes them, defaulting to `'manual'` / `null`)
- Test: `apps/web/src/actions/status-plan.actions.test.ts` (one new case)

**Interfaces:**
- Consumes: `realignShapesAction` as the pattern (`status-plan-realign.actions.ts`: `requireEffectiveRole`, `statusPlanWriteError`, `SHAPE_COLUMNS`, `toCanvasShape`, `READ_CHUNK = 100`, `WRITE_CHUNK = 10`); the fake client in `apps/web/src/lib/status-plans/__fixtures__/fake-client.ts`.
- Produces:
  ```ts
  export const MAX_LINKS = 500
  export async function linkShapesByLabelAction(input: { sheetId: string; links: Array<{ shapeId: string; nodeId: string; detectedTag: string | null; expectedUpdatedAt: string }> }): Promise<ActionResult<CanvasShape[]>>
  export async function unlinkShapesAction(input: { sheetId: string; unlinks: Array<{ shapeId: string; expectedUpdatedAt: string }> }): Promise<ActionResult<CanvasShape[]>>
  ```
  Error copy: `NOT_ALLOWED` as in the realign action; `'This sheet is not a floor plan.'`; `'Someone changed N of these shapes — reload and try again. Nothing was linked.'` (`conflict: true`); `'SHOP <tag> is already linked to another shape on this plan.'` for 23505; put-back failures appended as `'N could not be put back: <ids>.'`.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
describe('linkShapesByLabelAction', () => {
  it('refuses a plan whose purpose is not tenant_layout', …)
  it('refuses a caller outside ORG_WRITE_ROLES', …)
  it('refuses duplicate shape ids and duplicate node ids within the batch before reading', …)
  it('refuses the whole batch when any shape is already linked, on another sheet, or stale', …)
  it('links every shape conditionally on updated_at, sets detected_tag, keeps source manual, returns canvas shapes', …)
  it('on 23505 mid-batch puts back every completed link and reports the tag', () => {
    // 3 links; fake client fails the second update with code 23505; expect first put back (node_id null, detected_tag null), result { ok:false, conflict:true, error: /already linked/ }
  })
  it('reports put-backs that fail by shape id', …)
})
describe('unlinkShapesAction', () => {
  it('clears node_id and detected_tag conditionally and returns the shapes', …)
  it('refuses a stale row and leaves the rest untouched', …)
})
describe('createStatusPlanShapeAction', () => {
  it('writes source detected and the tag when given, manual and null otherwise', …)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- status-plan-link status-plan.actions`
Expected: FAIL, module not found / schema rejects `source`.

- [ ] **Step 3: Implement both actions and the schema change**

Mirror the realign action's phases: validate → session → sheet → plan + purpose → role → read all (`READ_CHUNK`) and refuse → write (`WRITE_CHUNK`, `.eq('updated_at', expected)`) → compensate on the first failure. Only async functions are exported.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter web test -- status-plan-link status-plan.actions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/status-plan-link.actions.ts apps/web/src/actions/status-plan-link.actions.test.ts apps/web/src/actions/status-plan.actions.ts apps/web/src/actions/status-plan.actions.test.ts
git commit -m "feat(status-plans): link and unlink floor-plan shapes by label, all-or-nothing by compensation"
```

---

### Task 4: Flood-fill outline (web lib, pure)

**Files:**
- Create: `apps/web/src/lib/status-plans/fill-outline.ts`
- Test: `apps/web/src/lib/status-plans/fill-outline.test.ts`

**Interfaces:**
- Consumes: `Pt` from `@esite/shared/status-plans`; `shapeAreaPx` for the round-trip assertion.
- Produces:
  ```ts
  export const INK_LUMA = 170; export const LEAK_CAP = 0.015; export const GROW_PX = 2; export const SIMPLIFY_EPS_PX = 2; export const MAX_VERTICES = 1000
  export const SEED_GRID = { dx: 24, dy: 16, step: 8 }
  export const GATE_BAND = { min: 0.8, max: 1.2 }
  export interface InkMask { width: number; height: number; ink: Uint8Array }          // 1 = ink after 1 px dilation
  export function inkMaskFromImageData(d: { width: number; height: number; data: Uint8ClampedArray }): InkMask
  export type FillOutcome = { kind: 'ok'; pixels: number; polygon: number[] } | { kind: 'leak' } | { kind: 'no_region' }
  export function fillFromAnchor(mask: InkMask, anchor: Pt): FillOutcome
  export type SuggestionGate =
    | { offered: true; fillM2: number; glaM2: number }
    | { offered: false; reason: string; fillM2: number | null }
  export function gateSuggestion(outcome: FillOutcome, pixelsPerMeter: number | null, glaM2: number | null): SuggestionGate
  ```
  Gate copy: `'Calibrate the sheet first.'`, `'No GLA on the schedule for this shop.'`, `'The fill ran into the mall; draw this shop by hand.'`, `'The fill came to <fill> m² for a <gla> m² shop, not offered.'`, `'No white space at the label.'`.

- [ ] **Step 1: Write the failing tests**

Build rasters with a helper `raster(w, h, draw: (set: (x, y) => void) => void)` that returns `ImageData`-shaped data (white 255, ink 0). Draw a room as 1 px walls.

```ts
it('inkMaskFromImageData thresholds at INK_LUMA and dilates by one pixel', …)
it('fills a closed 120×80 room from its centre: pixels within 1 % of the interior, polygon area within 1 % of the pixel count', …)
it('seeds from a grid when the anchor is ink', …)                 // draw a glyph blob at the anchor
it('a 3 px gap in one wall leaks', …)                            // outcome.kind === 'leak' (room is inside a 400×300 page so the outside exceeds LEAK_CAP)
it('an interior line halves the region, so the gate refuses it with the numbers', …)
it('polygon is grown by GROW_PX, simplified at SIMPLIFY_EPS_PX, and capped at MAX_VERTICES', …)
it('gate: no scale, no GLA, leak, out of band, in band', …)       // five assertions on reason copy and offered
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- fill-outline`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Scanline flood fill over a `Uint8Array` visited map; abort at `LEAK_CAP × width × height`. Region → boundary: grow the region mask by `GROW_PX` (square dilation), trace the outer boundary with Moore-neighbour tracing starting from the top-most left-most region pixel, then Douglas–Peucker at `SIMPLIFY_EPS_PX`; if the result exceeds `MAX_VERTICES`, double ε and retry. Return flat `[x0, y0, …]` with pixel centres (`+0.5`).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter web test -- fill-outline`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/fill-outline.ts apps/web/src/lib/status-plans/fill-outline.test.ts
git commit -m "feat(status-plans): flood-fill shop outline from a label with the GLA gate"
```

---

### Task 5: Pending link in the canvas reducer and the workspace commit

**Files:**
- Modify: `apps/web/src/lib/status-plans/canvas-reducer.ts:13-45` and the reducer's `tool` / `escape` / polygon-finish arms
- Test: `apps/web/src/lib/status-plans/canvas-reducer.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx:158-160` (`onCreate` passes `nodeId` and `detectedTag` from the commit)

**Interfaces:**
- Produces:
  ```ts
  export interface PendingLink { nodeId: string; detectedTag: string }
  // CanvasState gains: pendingLink: PendingLink | null   (initialCanvasState sets null)
  // ShapeCommit gains: link: PendingLink | null
  // CanvasEvent gains: { type: 'armDraw'; link: PendingLink }
  ```
  Rules: `armDraw` sets `tool: 'polygon'`, clears `draft`, sets `pendingLink`. `tool`, `escape` clear `pendingLink`. A polygon commit carries `link` and clears it. `rect` tool is never armed.

- [ ] **Step 1: Write the failing tests**

```ts
it('armDraw switches to polygon with the link pending', …)
it('a polygon commit carries the link and clears it', …)
it('tool change and escape clear the pending link', …)
it('a commit without armDraw carries link null', …)
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- canvas-reducer`
Expected: FAIL on the `armDraw` type.

- [ ] **Step 3: Implement the reducer change and pass the link in `onCreate`**

`onCreate` calls `createStatusPlanShapeAction({ sheetId, shape, points, nodeId: c.link?.nodeId ?? null, detectedTag: c.link?.detectedTag ?? null })` (source stays `'manual'`: the geometry is the person's).

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter web test -- canvas-reducer StatusPlanWorkspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/canvas-reducer.ts apps/web/src/lib/status-plans/canvas-reducer.test.ts 'apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.tsx'
git commit -m "feat(status-plans): arm the polygon tool with a pending tenant link"
```

---

### Task 6: Auto-scan for the floor plan

**Files:**
- Modify: `apps/web/src/lib/status-plans/auto-scan.ts:10-22`
- Test: `apps/web/src/lib/status-plans/auto-scan.test.ts`

**Interfaces:**
- Produces: `AutoScanInput` gains `linkedShapeCount: number; replaced: boolean`. Rule: schematic unchanged (`shapeCount === 0`); `tenant_layout` scans when `canEdit && isPdf && hasFileUrl && (linkedShapeCount === 0 || replaced)`.

- [ ] **Step 1: Write the failing tests** — four cases: floor plan with no linked shapes scans; with one linked shape and not replaced does not; replaced scans; area-typed shapes do not count (caller passes `linkedShapeCount`, so the test is on the workspace helper `countLinkedShapes(shapes)` added beside it: `nodeId !== null`).
- [ ] **Step 2: Run** `pnpm --filter web test -- auto-scan` — FAIL on the new fields.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(status-plans): scan a floor plan on open until its shops are linked"`

---

### Task 7: ShopsPanel and workspace wiring

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ShopsPanel.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ShopsPanel.test.tsx`
- Modify: `StatusPlanWorkspace.tsx` (render `ShopsPanel` only when `purpose === 'tenant_layout'`; pass live shapes, nodes with `scheduledM2`/`decommissioned`, `pixelsPerMeter`, `replaced: sheet.replacedAt !== null`, the canvas backing, `onLinked`, `onCreated`, `onFocus = showBox`, `onArmDraw`, `onPreview`; scan-once memo keyed on `sheet.id`)
- Modify: `StatusPlanCanvas.tsx:54-64, 89` (new prop `onBacking?: (b: SheetBacking | null) => void`, called when `img` changes; preview polygon drawn through the existing `overlay` in the pending style)
- Test: `StatusPlanWorkspace.test.tsx` (panel presence by purpose)

**Interfaces:**
- Consumes: Tasks 1–6; `extractPageText({ url }, pageIndex)`; `showBox` (workspace focus); `import * as Sentry from '@sentry/nextjs'` for `Sentry.addBreadcrumb({ category: 'status-plans', message: 'shops-scan', data: counts })` (no panel does this yet; `@/lib/sentry` exports only `captureError`). The workspace maps `PlanNode` → `ShopReviewNode` as `toDetectNode` does plus `scheduledM2: n.scheduledM2, decommissioned: n.decommissioned`.
- Produces:
  ```ts
  export interface ShopsPanelProps {
    sheetId: string; pageIndex: number; pdfUrl: string | null; isPdf: boolean
    nodes: ShopReviewNode[]; shapes: ShopReviewShape[]; shapesById: ReadonlyMap<string, CanvasShape>
    pixelsPerMeter: number | null; replaced: boolean; backing: SheetBacking | null; canEdit: boolean; autoScan: boolean
    onLinked: (shapes: CanvasShape[]) => void; onCreated: (shape: CanvasShape) => void
    onFocus: (box: Box) => void; onArmDraw: (link: PendingLink) => void; onPreview: (polygon: number[] | null) => void
  }
  export function ShopsPanel(p: ShopsPanelProps): JSX.Element
  ```
  Behaviour: Scan (auto once when `autoScan`, button always) → `extractPageText` → `detectShopLabels` → `reviewShopLabels` → sections per spec §5 with the summary sentence. **Link N shapes** calls `linkShapesByLabelAction` for every `link` row; on success shows **Undo** (calls `unlinkShapesAction` for that batch) until the next scan. `draw` rows: Show → `onFocus(padBox(label.box, DRAW_PAD_PX))` (`DRAW_PAD_PX = 400`, my call); Draw → `onArmDraw` + focus; Suggest → `inkMaskFromImageData` once per backing (cached in a ref), `fillFromAnchor`, `gateSuggestion`; an offered suggestion previews via `onPreview` and shows **Accept** (calls `createStatusPlanShapeAction({ shape: 'polygon', points, nodeId, detectedTag, source: 'detected' })`) and **Dismiss**; a refused one shows the reason. **Suggest all** runs the `draw` rows in sequence with "Suggesting i of n". `conflict`, `needs_you` (with the candidate picker and Link singly), `not_on_schedule`, `moved` (Show both, Redraw = armDraw) and area notes render as lists. Sentry breadcrumb `status-plans.shops-scan` with the counts only.

- [ ] **Step 1: Write the failing render tests (RTL, mocked `extractPageText`, actions and fill)**

```ts
it('scans on mount when autoScan and shows the summary and the Link button with the count', …)
it('zero labels shows the draw-by-hand sentence and no buttons', …)
it('Link N calls linkShapesByLabelAction with every link row and then offers Undo', …)
it('Draw arms the polygon tool with the node and tag and focuses the padded label box', …)
it('Suggest with no scale shows "Calibrate the sheet first." and never calls the fill', …)
it('an offered suggestion previews, and Accept creates a detected polygon linked to the node', …)
it('Dismiss clears the preview and saves nothing', …)
it('conflict rows render both names and no Link control', …)
it('needs_you rows offer the candidate picker', …)
it('moved rows render only on a replaced sheet', …)
```
Workspace test: `renders ShopsPanel for tenant_layout and not DetectBlocksPanel; the reverse for distribution_schematic`.

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter web test -- ShopsPanel StatusPlanWorkspace` — FAIL, module not found.
- [ ] **Step 3: Implement the panel, the canvas `onBacking` prop, the overlay preview and the workspace wiring.** Mirror `DetectBlocksPanel`'s structure and styles (`muted`, `sectionTitle`, `rowStyle`).
- [ ] **Step 4: Run** `pnpm --filter web test -- ShopsPanel StatusPlanWorkspace StatusPlanCanvas` and `pnpm --filter web type-check` — PASS, 0 errors.
- [ ] **Step 5: Commit** `git commit -m "feat(status-plans): Shops panel on the floor plan — scan, link, draw prompts, suggested outlines"`

---

### Task 8: Contract tests

**Files:**
- Create: `apps/web/src/lib/status-plans/detected-source-only-from-accept.contract.test.ts`

- [ ] **Step 1: Write the test.** Read every `.ts`/`.tsx` under `apps/web/src` (comments stripped as `snag-photo-type.contract.test.ts` does), find each call of `createStatusPlanShapeAction(` whose argument text contains `source: 'detected'`, and assert the only file is `ShopsPanel.tsx` and the only enclosing function is named `acceptSuggestion`. Prove it can fail by temporarily adding a second call site in a scratch copy (do not commit that).
- [ ] **Step 2: Run** `pnpm --filter web test -- detected-source-only` — PASS; with the scratch call site — FAIL naming the file.
- [ ] **Step 3: Commit** `git commit -m "test(status-plans): a detected outline is saved only from Accept"`

---

### Task 9: Production acceptance run (read-only) and tuning

**Files:**
- Create: `apps/web/scripts/status-plans/shop-labels-acceptance.ts`

**Interfaces:**
- Consumes: the service key from `.secrets/supabase.md` via env (`SUPABASE_SERVICE_ROLE_KEY`), `extractPageText` with the pdf.js legacy build (as `extract-page-text.test.ts` injects it), `detectShopLabels`, `reviewShopLabels`, `fillFromAnchor`, `gateSuggestion`. Rasterise with pdf.js and `@napi-rs/canvas` if it resolves from `apps/web`; otherwise shell out to `pdftoppm -r 144 -png` and decode with `pngjs` (both present in the pnpm store; the builder picks what resolves and records which).
- Produces: a console table per sheet with the review counts and, for `draw` rows, the gate outcome with its numbers. Writes nothing.

- [ ] **Step 1: Write the script** taking `--sheet <id>` (repeatable) and `--fill`.
- [ ] **Step 2: Run on the two production sheets** (`27b2f3fa-8c38-4d89-9bec-97fa94e7ad31` KINGSWALK, `c3a8329b-7026-4bff-aa14-ef94764fb61d` SAXBY).
  Expected: KINGSWALK `link` = 42, `linked` = 3, `conflict` = 0, `linked_outside` = 0, `not_on_schedule` = 0; SAXBY `linked` = 28, `not_on_schedule` = 1 (shop 31), `conflict` = 0. Any `conflict`/`linked_outside` is a review bug: fix Task 2 and re-run.
- [ ] **Step 3: Run with `--fill` on KINGSWALK.** Expected: offered ≥ 45 of the 64 `draw` rows. If below, tune only within `GATE_BAND` 0.80–1.20 and `GROW_PX` 1–3 and re-run; still below → treat as a Task 4 defect. Record SAXBY's number without a target.
- [ ] **Step 4: Paste both tables into the PR body** and commit the script: `git commit -m "chore(status-plans): read-only acceptance run for floor-plan labels"`

> **Note (2026-10-21):** Pass marks superseded by Tasks 11–12; see the ledger rulings dated 2026-10-21. The first run found two defects rather than a tuning gap: rotated labels never reached the detector (Task 11), and the fill seeded only a free anchor and gated on the ungrown region (Task 12). The `not_on_schedule` expectation became "the decommissioned tenants present on the drawing" (KINGSWALK's 7 kiosks K01–K06, K08; SAXBY's SHOP 13). The "≥ 45 of 64" fill target was withdrawn: the run reports the offered count and each refusal's reason, and the band stays 0.80–1.20.

---

### Task 10: Docs and PR

- [ ] **Step 1:** `docs/rbac-matrix.md`: no new route; add one line under Tenant plans that the Shops panel and both link actions follow the existing floor-plan write gate.
- [ ] **Step 2:** CLAUDE.md "Shipped" entry (the spec's §1 table, the acceptance numbers, what is not verified: the signed-in walk) and a vault `sessions.md` entry.
- [ ] **Step 3:** Run the three suites (`web`, `@esite/shared`, `@esite/db`), type-check and lint; `next build` once because a `'use server'` file was added.
- [ ] **Step 4:** Push `feat/floor-plan-label-detection` over SSH, open the PR into `main` as ready (not draft), bind it, and request review. The owner's walk (spec §6) is listed in the PR as not verified.

---

> Tasks 11 and 12 were added on 2026-10-21 after the Task 9 acceptance run, and are recorded here as executed (brief text unchanged, with an "As executed" note under each).

### Task 11: Rotated labels reach the shop detector

**Why:** the acceptance run (Task 9) found that `extractPageText` → `textItemsToImageSpace` keeps only near-horizontal runs (`MAX_SKEW = 0.09` in `packages/shared/src/status-plans/text-space.ts`). On the production floor plans 25 of 109 KINGSWALK labels and 13 of 29 SAXBY labels are rotated (±45°, −90°) and were never seen. A scratch simulation feeding the rotated runs in gives 109/109 and 29/29 with no new conflicts.

**Files:**
- Modify: `packages/shared/src/status-plans/text-space.ts` (add a second export; leave `textItemsToImageSpace` byte-identical in behaviour)
- Test: `packages/shared/src/status-plans/text-space.test.ts`
- Modify: `apps/web/src/lib/status-plans/extract-page-text.ts` (`PageTextResult` gains `allItems`)
- Test: `apps/web/src/lib/status-plans/extract-page-text.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ShopsPanel.tsx` (scan passes `page.allItems` to `detectShopLabels`)
- Test: `ShopsPanel.test.tsx` (the mocked `extractPageText` result carries `allItems`; one test proves a rotated label is detected)
- Modify: `apps/web/scripts/status-plans/shop-labels-acceptance.ts` (uses `allItems`)

**Interfaces:**
- Produces in `text-space.ts`:
  ```ts
  /** Every text run on the page, at any rotation. box = bounding box of the run's four corners under the viewport transform. */
  export function allTextItemsToImageSpace(items: readonly unknown[], viewportTransform: Matrix): ImageTextItem[]
  ```
  For an upright run the result is identical to `textItemsToImageSpace`'s item. For a rotated run: `x = minX`, `top = minY`, `width = maxX − minX`, `height = maxY − minY`, `baseline = maxY`, `str` unchanged. Runs with a degenerate transform (zero width or height) are dropped as today.
- Produces in `extract-page-text.ts`: `PageTextResult` gains `allItems: ImageTextItem[]`; `items` is unchanged (the 300 detector keeps reading `items`).
- Consumes: pdf.js text items `{ str, transform: [a,b,c,d,e,f], width, height }`. The run's corners in PDF user space are `o = (e, f)`, `o + u·width`, `o + v·height`, `o + u·width + v·height` where `u = (a, b) / |(a, b)|` and `v = (c, d) / |(c, d)|`; apply the viewport transform to each, then take the bounding box.

- [ ] **Step 1: Failing tests.** `text-space.test.ts`: `allTextItemsToImageSpace` returns the same item as `textItemsToImageSpace` for an upright run; a −90° run (`transform: [0, s, −s, 0, e, f]`) yields a box whose width is the run's font height and whose height is its advance width, with `x/top/baseline` as defined; a 45° run yields the rotated rectangle's bounding box (assert minX/maxX/minY/maxY within 0.01). `extract-page-text.test.ts`: the rotated fixture sheet already used there yields `allItems.length ≥ items.length`, and a label rotated −90° appears in `allItems` and not in `items`. `ShopsPanel.test.tsx`: a mocked page whose `allItems` holds `SHOP 7` rotated and whose `items` does not → the panel lists shop 7.
- [ ] **Step 2: Run red** (`pnpm --filter @esite/shared exec vitest run text-space`, `pnpm --filter web exec vitest run extract-page-text ShopsPanel`).
- [ ] **Step 3: Implement.** Keep `textItemsToImageSpace` as it is; share the per-item corner maths between the two functions without changing the upright function's output.
- [ ] **Step 4: Run green**, then `pnpm --filter @esite/shared test`, `pnpm --filter web test`, both type-checks, eslint on touched files.
- [ ] **Step 5: Commit** `feat(status-plans): read rotated SHOP labels on the floor plan`.

> **As executed:** commit `7b60e627`. `items` stayed byte-identical over 400k random runs; the Shops panel and the acceptance script read `allItems`. Deferred: the split-run join on a rotated box uses the advance as the "height", so a split rotated label never joins (neither production sheet splits a label).

---

### Task 12: Fill seeds every grid point, the gate judges the saved polygon, acceptance re-run

**Why:** the acceptance run (Task 9) found two fill defects. (1) When the anchor pixel is free, `seedsFor` (`apps/web/src/lib/status-plans/fill-outline.ts` ~:157) seeds only there; on KINGSWALK shops 24A, 45A, 45B, 48C and 92A the anchor is the 2–4 px gap between two glyphs, the fill reports `ok` at 0.0 m², the gate refuses with a misleading reason, and the real room is never tried. (2) The gate measures the UNGROWN region (`~:352`), so `GROW_PX` never reaches it and the wall-ink-plus-dilation bias (about 0.4 m per side at 2 px/pt) survives, pushing most fills to ~0.85 × GLA.

**Files:**
- Modify: `apps/web/src/lib/status-plans/fill-outline.ts`
- Test: `apps/web/src/lib/status-plans/fill-outline.test.ts`
- Modify (re-run only, no code change expected): `apps/web/scripts/status-plans/shop-labels-acceptance.ts` — if its gate call or table needs the new field, change it.

**Interfaces (unchanged names, changed rules):**
- `fillFromAnchor(mask, anchor)`: every seed in `SEED_GRID` (the anchor plus ±24 × ±16 in steps of 8) is evaluated whether or not the anchor pixel is ink; the largest `ok` region under the cap wins; the leak-mark rule from Task 4's fix round stands (a seed that meets another seed's aborted marks is a leak, and once a seed leaks no later seed may report `ok` for that area).
- `gateSuggestion(outcome, pixelsPerMeter, glaM2)`: `fillM2 = shapeAreaPx(outcome.polygon) / pixelsPerMeter²` (the polygon that Accept would save; it already equals `grownPixels` plus any holes). `pixels` stays on the outcome for diagnostics. Sentences and the band are unchanged.
- Constants unchanged: `GATE_BAND` 0.80–1.20, `GROW_PX = 2`.

- [ ] **Step 1: Failing tests.** (a) `seeds the whole grid when the anchor is free but sits between two glyphs`: a closed room with two ink blobs at the anchor separated by a 3 px free gap; the anchor is in the gap; expect `ok` with `pixels` within 1 % of the room's interior count, not the gap. (b) `the gate measures the grown polygon`: a closed room whose ungrown interior is 0.78 × GLA and whose grown polygon is 0.84 × GLA (pick a room size and GLA so both hold at ppm = 10 with `GROW_PX = 2`); expect `offered: true` and `fillM2` equal to `shapeAreaPx(polygon)/100` within 0.5 %. Keep every existing test green (the interior-line test must still refuse; adjust its GLA if the grown polygon now lands inside the band, and say so).
- [ ] **Step 2: Run red** (`pnpm --filter web exec vitest run fill-outline`).
- [ ] **Step 3: Implement** the two rule changes.
- [ ] **Step 4: Run green**, then `pnpm --filter web test`, type-check, eslint.
- [ ] **Step 5: Re-run the acceptance script** on both production sheets with `--fill` (read-only; env `SUPABASE_SERVICE_ROLE_KEY` from `/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite/.secrets/supabase.md`, never persisted). Record verbatim: review counts per sheet, `draw` rows with each gate outcome (fill m², GLA m², reason), the offered count, and the explained `linked_outside`/`conflict` rows. There is no numeric target: report the number and, for every refused `draw` row, which of leak / out-of-band / no scale / no GLA it was.
- [ ] **Step 6: Commit** `fix(status-plans): fill seeds the whole grid and the gate judges the saved polygon`.

> **As executed:** commit `fc47379c`, then two fix rounds from the controller's rulings.
>
> - **`acdd8007`:** an outline that encloses another shop's label anchor is refused ("The fill covers SHOP <other> as well; draw this shop by hand."). SHOP 64 had been offered at 1.158 × GLA with a polygon that also covered SHOP 62. A glyph counter left over after a seed leaked is reported as `leak`, not "out of band".
> - **`02252d88`:** the minimum region depends on the scale, not the label box: `minRegionPixels(ppm) = max(MIN_REGION_PX 100, MIN_SHOP_M2 2 × ppm²)`, or 100 px without a scale. A 45° label's box is 16–42 m², which would have refused small shops.
>
> Final re-run on `02252d88`:
>
> - **KINGSWALK:** 109/109 labels read; `link` 43, `linked` 3, `conflict` 0, `linked_outside` 0, `not_on_schedule` 7 (decommissioned kiosks K01–K06, K08), `draw` 56. Fill offered on **32 of 56**; the 24 refusals are covers another shop 12, leak 7, out of band 5 (89C, 18, 68, 45B, 80A), no scale 0, no GLA 0.
> - **SAXBY:** 29/29 labels read; `linked` 27, `linked_outside` 1 (SHOP 10a: label 1.85 m below its 10 m² ATM outline), `not_on_schedule` 1 (SHOP 13, decommissioned), `conflict` 0, `draw` 0.
