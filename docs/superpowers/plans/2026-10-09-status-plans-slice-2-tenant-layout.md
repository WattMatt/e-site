# Status Plans — Slice 2 (tenant layout UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a project a **Status plans** section where an owner, admin or project manager picks a drawing page, draws shop and area shapes over it, links each shop shape to its tenant board, and sees it coloured live from the tenant schedule (complete / in progress / overdue / unassigned / area type) with measured vs scheduled area. Every other project role sees the same page read-only. Distribution-schematic plans open in the same canvas (rectangles, DB-order hatching); automatic block detection is **slice 3** and gets a named seam here.

**Architecture:** Two routes under `apps/web/src/app/(admin)/projects/[id]/status-plans/`. The canvas page is a server component that loads everything through the caller's session (RLS + site scope are the read gate), assembles **JSON-only** props in one pure function, and hands them to one client workspace. The workspace owns state; every rule it applies (shape colour, legend counts, node options, tool behaviour, error sentences) lives in pure modules under `apps/web/src/lib/status-plans/` with vitest coverage, and the Konva component only draws and forwards input. Writes are per-shape server actions returning `{ ok, error }`, conditional on the row's `updated_at`; the workspace folds each result into local state and never calls `router.refresh()`. Colours, hatches and areas are never stored: they come from `@esite/shared/status-plans` (slice 1) at draw time.

**Tech Stack:** Next.js 15 app router (server components + `'use server'` actions), React 19, react-konva, pdfjs via `lib/sheet/`, zod, Supabase PostgREST, vitest + Testing Library (jsdom / node), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-10-09-status-plans-design.md` — §3.1 (tenant layout rules), §7 (web), §9 (error handling), §10 (testing), §11 slice 2.
**Builds on:** `docs/superpowers/plans/2026-10-09-status-plans-slice-1-data.md` → "Interfaces for later slices". Every name used from `@esite/shared/status-plans`, `lib/tenant-schedule/shop-facts.ts` and `lib/status-plans/shop-link.ts` is quoted from that section.

**Out of scope (later slices):** block detection, matcher and review UI (slice 3); the pdf-lib plan renderer, report appendix, schematic Export sheet and the client-portal read-only view (slice 4). Undo/redo, vertex insert/remove and whole-shape move are not in this slice (follow-ups listed at the end).

---

## Rules this plan follows (read once before Task 1)

From `CLAUDE.md`; each was paid for by a real incident.

1. **Page → client props must be JSON.** No functions, `Map`, `Set`, `Date`, `undefined`, `NaN`. A function prop passes `tsc` and `next build` and fails only at render (PR #201). Task 12 adds a runtime check on the assembled props and Task 17 a source-level check on both pages.
2. **Server actions return `{ ok, error }` and never throw for an expected refusal.** Production replaces a thrown message with a generic sentence (PR #266). A `'use server'` file exports **only async functions** — types are fine, a `const` is not (it passes tsc/vitest and fails only `next build`).
3. **No `router.refresh()` after a save on a canvas page.** It re-mints the drawing's signed URL and re-renders under the canvas. Fold the action's result into local state. Shape actions also skip `revalidatePath` for the same reason. Selection is mirrored to the URL with `window.history.replaceState`, which Next 15 integrates without a server round trip.
4. **`requireEffectiveRole` returns an object.** Bind it (`const gate = await requireEffectiveRole(…)`) and read `gate.ok`. `lib/auth/role-gate-call-sites.contract.test.ts` fails the build on a bare truthiness check.
5. **Two-step inline confirms**, never `window.confirm` (Safari suppresses it): first press arms for 4 s, second press commits.
6. **Konva selects on `mousedown`**, never `click` (not synthesised reliably). Shapes `cancelBubble` on their own press so the stage press means "empty canvas".
7. **`docs/rbac-matrix.md` is updated in the same PR** as the new routes and actions (Task 20).
8. **Phone shell:** no fixed-bottom element is added. If one is ever added to this page it must clear `calc(72px + env(safe-area-inset-bottom))`. The canvas/side-panel grid uses the existing `stack-below-lg` class so it stacks below 1024 px.
9. **PostgREST caps every read at 1 000 rows** whatever `.range()` says. Whole-set reads (shapes, nodes, orders, drawings) page through `readAll` from `@/lib/tender/read-all` with a stable order.
10. **Image space is fixed** by `useSheetImage` (PDF at `getViewport({ scale: 2 })`, rasters at natural size). Points are stored in it; nothing here may rescale it.
11. **Run all three suites** (`web`, `@esite/shared`, `@esite/db`) before calling anything green, then `tsc`, `eslint`, `next build`.
12. **Worktree hygiene:** `pnpm install` in this worktree; never symlink another worktree's `node_modules`; `TMPDIR` on the SSD.

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
| `apps/web/src/lib/sheet/page-scale.ts` (+ `.test.ts`) | `pageScaleFor` (lifted from the measure page) and `withPageScale` |
| `apps/web/src/lib/status-plans/types.ts` | JSON prop types for the pages and `ActionResult` |
| `apps/web/src/lib/status-plans/json-safe.ts` (+ `.test.ts`) | `jsonUnsafePath` — finds the first non-JSON value in a props tree |
| `apps/web/src/lib/status-plans/plan-urls.ts` (+ `.test.ts`) | Route builders, drawing-type checks, `fileLabel` |
| `apps/web/src/lib/status-plans/write-errors.ts` (+ `.test.ts`) | Postgres error → sentence |
| `apps/web/src/lib/status-plans/canvas-shape.ts` (+ `.test.ts`) | Row → `CanvasShape`, `shapePatchRow`, `roundPoints`, `SHAPE_COLUMNS` |
| `apps/web/src/lib/status-plans/__fixtures__/fake-client.ts` | PostgREST-shaped fake used by loader and action tests |
| `apps/web/src/lib/status-plans/project-db-orders.ts` (+ `.test.ts`) | `loadProjectDbOrderStatus` — DB order per node for schematic plans |
| `apps/web/src/lib/status-plans/shape-view.ts` (+ `.test.ts`) | `resolveShapeView`, `legendSummary`, `needsAttention`, `fillRgba`, `swatchCss` |
| `apps/web/src/lib/status-plans/node-options.ts` (+ `.test.ts`) | Assign list: `buildNodeOptions`, `filterNodeOptions`, `nodeLabel` |
| `apps/web/src/lib/status-plans/canvas-reducer.ts` (+ `.test.ts`) | Tool state machine + `dragVertex` |
| `apps/web/src/actions/status-plan.actions.ts` (+ `.test.ts`) | Plan create/rename/delete/re-anchor; shape create/update/delete |
| `apps/web/src/lib/status-plans/load-plan-page.ts` (+ `.test.ts`) | `buildStatusPlanPageProps` (pure) + `loadStatusPlanPage` (I/O) |
| `apps/web/src/lib/status-plans/plan-list.ts` (+ `.test.ts`) | `planListRows`, `defaultPlanName`, `loadStatusPlanList` |
| `apps/web/src/lib/status-plans/on-plan-links.ts` (+ `.test.ts`) | `pickOnPlanLinks` + `loadOnPlanLinks` for the tenant schedule |
| `apps/web/src/lib/status-plans/page-props.contract.test.ts` | Source-level: the two pages pass no function to a client component |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/page.tsx` | List + "New status plan" |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.tsx` (+ `.test.tsx`) | Drawing → page → purpose → name |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx` | Loads props, renders the workspace |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanWorkspace.tsx` (+ `.test.tsx`) | State, actions, banners, header |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanCanvas.tsx` | Konva: draws, forwards input |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/ShapePanel.tsx` (+ `.test.tsx`) | Selected shape: facts, area, assign, delete; slice-3 slot |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/PlanLegend.tsx` (+ `.test.tsx`) | Live legend, total area, needs attention |

**Modify**

| Path | Change |
|---|---|
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/measure/route-canvas-logic.ts` | `pageScaleFor` becomes a re-export of `lib/sheet/page-scale` |
| `apps/web/src/components/layout/Sidebar.tsx` (+ `Sidebar.test.tsx`) | "Status plans" after "Tenant Schedule" |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx` | Loads `onPlanByNode` |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx` (+ test) | "On plan ↗" link per row |
| `docs/rbac-matrix.md` | Page routes + server actions rows; slice-1 note updated |

---

### Task 0: Preconditions and baseline

**Files:** none

- [ ] **Step 1: Confirm slice 1 is in this branch**

```bash
ls packages/shared/src/status-plans/index.ts \
   apps/web/src/lib/tenant-schedule/shop-facts.ts \
   apps/web/src/lib/status-plans/shop-link.ts
grep -n '"./status-plans"' packages/shared/package.json
grep -n "status_plan_shapes: {" packages/db/src/types.ts
```

Expected: three paths listed, one `package.json` line, one `types.ts` line. **If any is missing, stop**: this plan is written against slice 1's interfaces and cannot start before slice 1 is merged into this branch.

- [ ] **Step 2: Install and take the baseline**

```bash
pnpm install
pnpm --filter web test 2>&1 | tail -5
pnpm --filter @esite/shared test 2>&1 | tail -5
pnpm --filter @esite/db test:ci 2>&1 | tail -5
```

Expected: all three end in `Test Files … passed`. Write the three counts down; Task 21 compares against them. A red baseline is not this plan's to fix: stop and report it.

---

### Task 1: Lift `pageScaleFor` into `lib/sheet/`

The measure page's `pageScaleFor` decides which scale is in force on a PDF page (the page's own `00199` scale, else the drawing's on page 1 only). Status plans need the same rule; importing it from a cables route would couple two features, so it moves to `lib/sheet/` and the measure page re-exports it.

**Files:**
- Create: `apps/web/src/lib/sheet/page-scale.ts`
- Test: `apps/web/src/lib/sheet/page-scale.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/measure/route-canvas-logic.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { pageScaleFor, withPageScale } from './page-scale'

const sheet = { pixels_per_meter: 20, page_scales: [{ pageIndex: 3, pixelsPerMeter: 41.25 }] }

describe('pageScaleFor', () => {
  it('a page with its own scale uses it', () => {
    expect(pageScaleFor(sheet, 3)).toBe(41.25)
  })
  it('page 1 falls back to the drawing scale', () => {
    expect(pageScaleFor(sheet, 1)).toBe(20)
  })
  it('page 2+ without its own scale is unscaled', () => {
    expect(pageScaleFor(sheet, 2)).toBeNull()
  })
  it('a page-1 entry beats the drawing scale', () => {
    expect(pageScaleFor({ pixels_per_meter: 20, page_scales: [{ pageIndex: 1, pixelsPerMeter: 22 }] }, 1)).toBe(22)
  })
})

describe('withPageScale', () => {
  it('records a page-2 calibration without touching the drawing scale', () => {
    const next = withPageScale(sheet, 2, 18.5)
    expect(pageScaleFor(next, 2)).toBe(18.5)
    expect(next.pixels_per_meter).toBe(20)
    expect(sheet.page_scales).toHaveLength(1) // not mutated
  })
  it('a page-1 calibration wins over any stale page-1 entry', () => {
    const stale = { pixels_per_meter: 20, page_scales: [{ pageIndex: 1, pixelsPerMeter: 22 }] }
    const next = withPageScale(stale, 1, 25)
    expect(pageScaleFor(next, 1)).toBe(25)
    expect(next.pixels_per_meter).toBe(25)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/sheet/page-scale.test.ts
```

Expected: FAIL with `Failed to resolve import "./page-scale"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Which scale is in force on a page of a drawing.
 *
 * A PDF page other than 1 needs its own scale (tenants.floor_plan_page_scales,
 * 00199); page 1 falls back to the drawing's own floor_plans.pixels_per_meter.
 * Page 2+ without its own scale is UNSCALED: anything measured there would be
 * a guess, and every consumer must treat null as "no area / no length".
 *
 * Shared by the cable measure page and status plans so the two can never
 * disagree about the scale of the same page.
 */
export interface PageScaleRow {
  pageIndex: number
  pixelsPerMeter: number
}

export interface ScaledSheet {
  pixels_per_meter: number | null
  page_scales: ReadonlyArray<PageScaleRow>
}

export function pageScaleFor(sheet: ScaledSheet, page: number): number | null {
  const own = sheet.page_scales.find((s) => s.pageIndex === page)
  if (own) return own.pixelsPerMeter
  return page === 1 ? sheet.pixels_per_meter : null
}

/**
 * The sheet after a calibration was saved on `pageIndex`. The page's own entry
 * is always written, so `pageScaleFor` returns the new figure whichever table
 * the server wrote; page 1 also updates the drawing-level figure.
 */
export function withPageScale<S extends ScaledSheet>(sheet: S, pageIndex: number, pixelsPerMeter: number): S {
  const rest = sheet.page_scales.filter((s) => s.pageIndex !== pageIndex)
  return {
    ...sheet,
    pixels_per_meter: pageIndex === 1 ? pixelsPerMeter : sheet.pixels_per_meter,
    page_scales: [...rest, { pageIndex, pixelsPerMeter }],
  } as S
}
```

- [ ] **Step 4: Make the measure page re-export it**

In `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/measure/route-canvas-logic.ts`, replace this exact block:

```ts
/**
 * The scale in force on a page of the sheet: the page's own (00199) when it
 * has one, else the drawing-level scale on page 1 only. Page 2+ without its
 * own scale is UNSCALED, and a leg traced there is refused by the server.
 */
export function pageScaleFor(sheet: Pick<ActiveSheet, 'pixels_per_meter' | 'page_scales'>, page: number): number | null {
  const own = sheet.page_scales.find((s) => s.pageIndex === page)
  if (own) return own.pixelsPerMeter
  return page === 1 ? sheet.pixels_per_meter : null
}
```

with:

```ts
/**
 * The scale in force on a page of the sheet. Lives in lib/sheet so status
 * plans read the same rule; a leg traced on an unscaled page is refused by
 * the server.
 */
export { pageScaleFor } from '@/lib/sheet/page-scale'
```

`ActiveSheet` is still imported by the file's other functions, so its import line stays.

- [ ] **Step 5: Run both suites that touch it**

```bash
pnpm --filter web test src/lib/sheet "src/app/(admin)/projects/[id]/cables/[revisionId]/measure"
pnpm --filter web type-check
```

Expected: PASS (the measure page's existing `route-canvas-logic.test.ts` is unchanged and green); `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sheet/page-scale.ts apps/web/src/lib/sheet/page-scale.test.ts \
  "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/measure/route-canvas-logic.ts"
git commit -m "refactor(sheet): lift pageScaleFor into lib/sheet for status plans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Prop types and the JSON check

**Files:**
- Create: `apps/web/src/lib/status-plans/types.ts`
- Create: `apps/web/src/lib/status-plans/json-safe.ts`
- Test: `apps/web/src/lib/status-plans/json-safe.test.ts`

- [ ] **Step 1: Write the types (no test of their own; `tsc` checks them)**

```ts
/**
 * The shapes the status-plan pages hand their client components, and the
 * result type every status-plan action returns.
 *
 * EVERYTHING HERE MUST SURVIVE JSON. A page.tsx → 'use client' prop that is a
 * function, Map, Date or undefined passes tsc and next build and fails only at
 * render (PR #201). `jsonUnsafePath` (json-safe.ts) checks the assembled props
 * at runtime in the loader's test.
 */
import type {
  AreaType,
  NodeOrderStatus,
  ShapeKind,
  ShapeSource,
  ShopLink,
  StatusPlanPurpose,
} from '@esite/shared/status-plans'
import type { PageScaleRow } from '@/lib/sheet/page-scale'

/** Never thrown: production redacts thrown server-action messages. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; conflict?: boolean }

/** The drawing page under the plan. snake_case scale fields match `ScaledSheet`. */
export interface PlanSheet {
  floorPlanId: string
  name: string
  signedUrl: string | null
  isPdf: boolean
  widthPx: number | null
  heightPx: number | null
  /** The drawing's file NOW; compared with the plan's sourceFilePath. */
  currentFilePath: string
  pixels_per_meter: number | null
  page_scales: PageScaleRow[]
}

export interface PlanHeader {
  id: string
  name: string
  purpose: StatusPlanPurpose
  pageIndex: number
  /** The drawing's file when the plan was created (or last re-anchored). */
  sourceFilePath: string
  updatedAt: string
}

export interface CanvasShape {
  id: string
  shape: ShapeKind
  /** Image space, flat [x0, y0, x1, y1, …]. */
  points: number[]
  nodeId: string | null
  areaType: AreaType | null
  detectedTag: string | null
  source: ShapeSource
  /** The concurrency token every write must present. */
  updatedAt: string
}

/** A live (not soft-deleted) project node a shape may link to. */
export interface PlanNode {
  id: string
  code: string
  kind: string
  shopNumber: string | null
  shopName: string | null
  /** structure.nodes.shop_area_m2 — the scheduled area. */
  scheduledM2: number | null
  decommissioned: boolean
}

export interface StatusPlanPageProps {
  projectId: string
  plan: PlanHeader
  sheet: PlanSheet
  shapes: CanvasShape[]
  /** tenant_db nodes on a tenant layout; every live node on a schematic. */
  nodes: PlanNode[]
  /** nodeId → link, tenant layout only ({} on a schematic). */
  shopLinks: Record<string, ShopLink>
  /** nodeId → DB order status, schematic only ({} on a tenant layout). */
  dbOrders: Record<string, NodeOrderStatus>
  /** yyyy-mm-dd, the server's date: overdue is decided against it. */
  today: string
  canEdit: boolean
  /** From ?shape=, only when that shape is on this plan. */
  initialShapeId: string | null
}
```

- [ ] **Step 2: Write the failing JSON-check test**

```ts
import { describe, it, expect } from 'vitest'
import { jsonUnsafePath } from './json-safe'

describe('jsonUnsafePath', () => {
  it('accepts plain JSON', () => {
    expect(jsonUnsafePath({ a: 1, b: 'x', c: null, d: [true, { e: -0.5 }] })).toBeNull()
  })
  it('names the path of a function', () => {
    expect(jsonUnsafePath({ a: { onSave: () => 1 } })).toBe('$.a.onSave')
  })
  it('rejects undefined, NaN and Infinity', () => {
    expect(jsonUnsafePath({ a: undefined })).toBe('$.a')
    expect(jsonUnsafePath({ a: [1, Number.NaN] })).toBe('$.a[1]')
    expect(jsonUnsafePath({ a: Infinity })).toBe('$.a')
  })
  it('rejects Map, Set and Date', () => {
    expect(jsonUnsafePath({ m: new Map() })).toBe('$.m')
    expect(jsonUnsafePath({ s: new Set() })).toBe('$.s')
    expect(jsonUnsafePath({ d: new Date(0) })).toBe('$.d')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/json-safe.test.ts
```

Expected: FAIL with `Failed to resolve import "./json-safe"`.

- [ ] **Step 4: Implement**

```ts
/**
 * The first value in `value` that would not survive a server → client
 * component boundary as JSON, as a path like `$.shapes[3].points[0]`, or null
 * when everything is plain JSON. Plain objects only: a class instance (Map,
 * Set, Date) is reported even though JSON.stringify would silently mangle it.
 */
export function jsonUnsafePath(value: unknown, path = '$'): string | null {
  if (value === null) return null
  const t = typeof value
  if (t === 'string' || t === 'boolean') return null
  if (t === 'number') return Number.isFinite(value as number) ? null : path
  if (t !== 'object') return path
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = jsonUnsafePath(value[i], `${path}[${i}]`)
      if (p) return p
    }
    return null
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return path
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = jsonUnsafePath(v, `${path}.${k}`)
    if (p) return p
  }
  return null
}
```

- [ ] **Step 5: Run it and watch it pass, then type-check**

```bash
pnpm --filter web test src/lib/status-plans/json-safe.test.ts
pnpm --filter web type-check
```

Expected: PASS (4 tests); `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/types.ts apps/web/src/lib/status-plans/json-safe.ts apps/web/src/lib/status-plans/json-safe.test.ts
git commit -m "feat(status-plans): page prop types and a JSON-safety check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: URLs and drawing types

**Files:**
- Create: `apps/web/src/lib/status-plans/plan-urls.ts`
- Test: `apps/web/src/lib/status-plans/plan-urls.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { statusPlansHref, statusPlanHref, isPdfPath, isRenderableDrawing, fileLabel } from './plan-urls'

describe('status plan urls', () => {
  it('builds the list and plan routes', () => {
    expect(statusPlansHref('p1')).toBe('/projects/p1/status-plans')
    expect(statusPlanHref('p1', 'pl1')).toBe('/projects/p1/status-plans/pl1')
    expect(statusPlanHref('p1', 'pl1', 's1')).toBe('/projects/p1/status-plans/pl1?shape=s1')
    expect(statusPlanHref('p1', 'pl1', null)).toBe('/projects/p1/status-plans/pl1')
  })
  it('encodes ids so they cannot break out of the path', () => {
    expect(statusPlanHref('a/b', 'c?d', 'e&f')).toBe('/projects/a%2Fb/status-plans/c%3Fd?shape=e%26f')
  })
})

describe('drawing types', () => {
  it('knows what the canvas can render', () => {
    expect(isPdfPath('x/E-300.PDF')).toBe(true)
    expect(isRenderableDrawing('x/plan.webp')).toBe(true)
    expect(isRenderableDrawing('x/plan.dwg')).toBe(false)
  })
  it('labels a file by its last path segment', () => {
    expect(fileLabel('org/proj/drawings/643-E-300 rev B.pdf')).toBe('643-E-300 rev B.pdf')
    expect(fileLabel('plain.pdf')).toBe('plain.pdf')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/plan-urls.test.ts
```

Expected: FAIL with `Failed to resolve import "./plan-urls"`.

- [ ] **Step 3: Implement**

```ts
/** Routes and drawing-type checks for status plans. Pure; safe on client and server. */

export const isPdfPath = (p: string): boolean => /\.pdf$/i.test(p)
export const isImagePath = (p: string): boolean => /\.(png|jpe?g|webp|svg)$/i.test(p)
/** The canvas renders PDFs (via pdfjs) and rasters; DWG and friends are not drawable. */
export const isRenderableDrawing = (p: string): boolean => isPdfPath(p) || isImagePath(p)

export function statusPlansHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/status-plans`
}

/** A plan, optionally with one shape selected (`?shape=` — the tenant schedule's "On plan" link). */
export function statusPlanHref(projectId: string, planId: string, shapeId?: string | null): string {
  const base = `${statusPlansHref(projectId)}/${encodeURIComponent(planId)}`
  return shapeId ? `${base}?shape=${encodeURIComponent(shapeId)}` : base
}

/** "643-E-300 rev B.pdf" from a storage path, for the drawing-changed banner. */
export function fileLabel(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/plan-urls.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/plan-urls.ts apps/web/src/lib/status-plans/plan-urls.test.ts
git commit -m "feat(status-plans): route builders and drawing-type checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Postgres error → sentence

Slice 1's triggers and constraints raise `23514` (refusals), `23505` (duplicates), `23503` (missing parent) and RLS raises `42501`. A raw message names constraints; the user needs a sentence. Rules are matched on code AND a distinctive substring, so two different `23514` refusals never share a sentence; an unknown error never leaks its raw text.

**Files:**
- Create: `apps/web/src/lib/status-plans/write-errors.ts`
- Test: `apps/web/src/lib/status-plans/write-errors.test.ts`

- [ ] **Step 1: Write the failing test**

The messages below are the exact texts slice 1's migration raises (`00245_status_plans.sql`) and PostgREST's own formats for unique / FK / RLS violations.

```ts
import { describe, it, expect } from 'vitest'
import { statusPlanWriteError } from './write-errors'

const cases: Array<[string, string, 'plan' | 'shape', RegExp]> = [
  ['23505', 'duplicate key value violates unique constraint "status_plans_drawing_page_purpose_key"', 'plan', /already has a plan for that purpose/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"', 'shape', /already on this plan/],
  ['23514', 'status_plans: that drawing belongs to another project', 'plan', /belongs to another project/],
  ['23514', 'status_plans: the drawing, page and purpose of a plan are fixed; create a new plan instead', 'plan', /cannot change/],
  ['23514', "status_plans: a plan can only be re-anchored to its drawing's current file", 'plan', /current file/],
  ['23514', 'status_plan_shapes: a shape cannot move to another plan', 'shape', /cannot move/],
  ['23514', 'status_plan_shapes: area types belong on tenant layout plans only', 'shape', /tenant layout plans only/],
  ['23514', 'status_plan_shapes: that board is not on this project', 'shape', /not on this project/],
  ['23514', 'status_plan_shapes: that board has been deleted', 'shape', /has been deleted/],
  ['23514', 'status_plan_shapes: a tenant layout links tenant boards only', 'shape', /tenant boards only/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_points_shape"', 'shape', /outline is not valid/],
  ['23514', 'new row for relation "status_plans" violates check constraint "status_plans_name_not_blank"', 'plan', /Give the plan a name/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_link_or_area"', 'shape', /either a shop or an area/],
  ['23503', 'status_plans: drawing 6c1b… not found', 'plan', /drawing no longer exists/],
  ['23503', 'status_plan_shapes: status plan 6c1b… not found', 'shape', /plan no longer exists/],
  ['23503', 'insert or update on table "status_plan_shapes" violates foreign key constraint "status_plan_shapes_node_id_fkey"', 'shape', /board no longer exists/],
  ['42501', 'new row violates row-level security policy for table "status_plan_shapes"', 'shape', /owner, admin or project manager/],
]

describe('statusPlanWriteError', () => {
  for (const [code, message, target, expected] of cases) {
    it(`${code} ${message.slice(0, 60)}`, () => {
      expect(statusPlanWriteError({ code, message }, target)).toMatch(expected)
    })
  }

  it('never leaks a raw message, even for an unknown error', () => {
    const s = statusPlanWriteError({ code: 'XX000', message: 'internal: relation tenants.secret_thing' }, 'shape')
    expect(s).not.toMatch(/secret_thing|relation/)
    expect(s).toMatch(/shape could not be saved/)
  })

  it('falls back per code when the message is unfamiliar', () => {
    expect(statusPlanWriteError({ code: '23514', message: 'something new' }, 'plan')).toMatch(/refused/)
    expect(statusPlanWriteError({ code: '23505', message: 'something new' }, 'plan')).toMatch(/duplicate/)
    expect(statusPlanWriteError({ code: '23503', message: 'something new' }, 'plan')).toMatch(/no longer exists/)
  })

  it('handles a missing code and message', () => {
    expect(statusPlanWriteError({}, 'plan')).toMatch(/plan could not be saved/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/write-errors.test.ts
```

Expected: FAIL with `Failed to resolve import "./write-errors"`.

- [ ] **Step 3: Implement**

```ts
/**
 * A Postgres / PostgREST refusal on a status-plan write, as a sentence.
 *
 * Codes come from slice 1 (00245): 23514 for trigger and CHECK refusals, 23505
 * for the two unique keys, 23503 for a missing drawing / plan / board, and
 * 42501 from RLS. Each rule needs the code AND a distinctive substring, so two
 * different refusals with one code never share a sentence. The raw message is
 * never returned: it names constraints and tables, which mean nothing to the
 * person drawing and leak schema to anyone else.
 */
export type WriteTarget = 'plan' | 'shape'

export interface PgErrorLike {
  code?: string | null
  message?: string | null
}

const RULES: ReadonlyArray<{ code: string; match?: RegExp; sentence: string }> = [
  { code: '23505', match: /status_plans_drawing_page_purpose_key/, sentence: 'This page of the drawing already has a plan for that purpose. Open the existing plan instead.' },
  { code: '23505', match: /status_plan_shapes_plan_node_key/, sentence: 'That board is already on this plan. Select its shape instead of linking it twice.' },
  { code: '23514', match: /belongs to another project/, sentence: 'That drawing belongs to another project.' },
  { code: '23514', match: /are fixed/, sentence: "A plan's drawing, page and purpose cannot change. Create a new plan instead." },
  { code: '23514', match: /re-anchored/, sentence: "A plan can only be moved onto its drawing's current file. Reload and try again." },
  { code: '23514', match: /cannot move to another plan/, sentence: 'A shape cannot move to another plan.' },
  { code: '23514', match: /area types belong on tenant layout/, sentence: 'Area types are for tenant layout plans only.' },
  { code: '23514', match: /not on this project/, sentence: 'That board is not on this project.' },
  { code: '23514', match: /has been deleted/, sentence: 'That board has been deleted. Pick another, or leave the shape unassigned.' },
  { code: '23514', match: /tenant boards only/, sentence: 'A tenant layout links tenant boards only.' },
  { code: '23514', match: /status_plan_shapes_points_shape/, sentence: "That shape's outline is not valid: it needs at least 3 corners, and a rectangle exactly 4." },
  { code: '23514', match: /status_plans_name_not_blank/, sentence: 'Give the plan a name.' },
  { code: '23514', match: /status_plan_shapes_link_or_area/, sentence: 'A shape is either a shop or an area, not both.' },
  { code: '23503', match: /status plan .* not found|status_plan_id_fkey/, sentence: 'That plan no longer exists. Go back to the list and reload.' },
  { code: '23503', match: /drawing .* not found|floor_plan_id_fkey/, sentence: 'That drawing no longer exists, or you cannot see it.' },
  { code: '23503', match: /node_id_fkey/, sentence: 'That board no longer exists. Pick another.' },
  { code: '42501', sentence: 'Only an owner, admin or project manager can change status plans on this project.' },
]

const BY_CODE: Record<string, string> = {
  '23514': 'The database refused that change. Reload and check the plan.',
  '23505': 'That would duplicate something already on this plan.',
  '23503': 'Something this refers to no longer exists. Reload and try again.',
}

export function statusPlanWriteError(err: PgErrorLike, target: WriteTarget): string {
  const code = err.code ?? ''
  const message = err.message ?? ''
  for (const r of RULES) {
    if (r.code === code && (!r.match || r.match.test(message))) return r.sentence
  }
  return BY_CODE[code] ?? (target === 'plan'
    ? 'The plan could not be saved. Reload and try again.'
    : 'The shape could not be saved. Reload and try again.')
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/write-errors.test.ts
```

Expected: PASS (21 tests).

- [ ] **Step 5: Mutation check**

Temporarily change `return r.sentence` to `return message`. Re-run: expect every `cases` row whose sentence differs from the raw text, plus "never leaks a raw message", to FAIL. Restore and re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/write-errors.ts apps/web/src/lib/status-plans/write-errors.test.ts
git commit -m "feat(status-plans): map Postgres refusals on plan writes to sentences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shape rows and patches

**Files:**
- Create: `apps/web/src/lib/status-plans/canvas-shape.ts`
- Test: `apps/web/src/lib/status-plans/canvas-shape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { toCanvasShape, shapePatchRow, roundPoints, SHAPE_COLUMNS } from './canvas-shape'

const ROW = {
  id: 's1', status_plan_id: 'pl1', shape: 'polygon' as const,
  points: [612.375, -0.5, 1024.125, 2383.9375, 300, 300],
  node_id: 'n1', area_type: null, detected_tag: null, source: 'manual' as const,
  created_by: 'u1', created_at: '2026-10-09T08:00:00.000001+00:00', updated_at: '2026-10-09T09:15:42.123456+00:00',
}

describe('toCanvasShape', () => {
  it('keeps every coordinate exactly and carries updated_at as the write token', () => {
    expect(toCanvasShape(ROW)).toEqual({
      id: 's1', shape: 'polygon',
      points: [612.375, -0.5, 1024.125, 2383.9375, 300, 300],
      nodeId: 'n1', areaType: null, detectedTag: null, source: 'manual',
      updatedAt: '2026-10-09T09:15:42.123456+00:00',
    })
  })
  it('refuses points the database would refuse (slice 1 statusPlanShapeFromRow)', () => {
    expect(() => toCanvasShape({ ...ROW, shape: 'rect' })).toThrow()
  })
  it('selects every column the mapper reads', () => {
    for (const k of Object.keys(ROW)) expect(SHAPE_COLUMNS).toContain(k)
  })
})

describe('roundPoints', () => {
  it('rounds to 2 dp without moving a coordinate by more than 0.005 px', () => {
    expect(roundPoints([612.3751, -0.4949, 10])).toEqual([612.38, -0.49, 10])
  })
})

describe('shapePatchRow', () => {
  it('geometry only', () => {
    expect(shapePatchRow({ points: [1, 2, 3, 4, 5, 6] })).toEqual({ points: [1, 2, 3, 4, 5, 6] })
  })
  it('linking a board clears any area type', () => {
    expect(shapePatchRow({ nodeId: 'n1' })).toEqual({ node_id: 'n1', area_type: null })
  })
  it('setting an area type clears any board', () => {
    expect(shapePatchRow({ areaType: 'common' })).toEqual({ area_type: 'common', node_id: null })
  })
  it('unassign clears both', () => {
    expect(shapePatchRow({ nodeId: null, areaType: null })).toEqual({ node_id: null, area_type: null })
  })
  it('an empty patch writes nothing', () => {
    expect(shapePatchRow({})).toEqual({})
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/canvas-shape.test.ts
```

Expected: FAIL with `Failed to resolve import "./canvas-shape"`.

- [ ] **Step 3: Implement**

```ts
/**
 * tenants.status_plan_shapes rows ↔ what the canvas holds.
 * The shared mapper (slice 1) validates points exactly as the CHECK does.
 */
import { statusPlanShapeFromRow, type AreaType, type StatusPlanShapeRow } from '@esite/shared/status-plans'
import type { CanvasShape } from './types'

export const SHAPE_COLUMNS =
  'id, status_plan_id, shape, points, node_id, area_type, detected_tag, source, created_by, created_at, updated_at'

export function toCanvasShape(row: StatusPlanShapeRow): CanvasShape {
  const s = statusPlanShapeFromRow(row)
  return {
    id: s.id,
    shape: s.shape,
    points: s.points,
    nodeId: s.nodeId,
    areaType: s.areaType,
    detectedTag: s.detectedTag,
    source: s.source,
    updatedAt: s.updatedAt,
  }
}

/** 0.01 image px is far below anything a mouse can place; it keeps the JSON short. */
export function roundPoints(points: readonly number[], dp = 2): number[] {
  const f = 10 ** dp
  return points.map((v) => Math.round(v * f) / f)
}

export interface ShapePatch {
  points?: number[]
  /** null unlinks. A board link clears the area type (CHECK link_or_area). */
  nodeId?: string | null
  /** null clears. An area type clears the board link. */
  areaType?: AreaType | null
}

export function shapePatchRow(p: ShapePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (p.points !== undefined) row.points = p.points
  if (p.nodeId !== undefined) {
    row.node_id = p.nodeId
    if (p.nodeId !== null) row.area_type = null
  }
  if (p.areaType !== undefined) {
    row.area_type = p.areaType
    if (p.areaType !== null) row.node_id = null
  }
  return row
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/canvas-shape.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/canvas-shape.ts apps/web/src/lib/status-plans/canvas-shape.test.ts
git commit -m "feat(status-plans): shape row mapping and patch rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: A PostgREST-shaped fake for loader and action tests

**Files:**
- Create: `apps/web/src/lib/status-plans/__fixtures__/fake-client.ts`

No test of its own: Tasks 7, 10, 12, 13 and 15 exercise it, and every one of them asserts on the recorded calls, so a fake that silently swallowed a filter would turn those assertions red.

- [ ] **Step 1: Write the fake**

```ts
/**
 * A tiny PostgREST-shaped fake: `.schema(s).from(t)` builders that record
 * every chained call, answer from a responder at await time, and look enough
 * like supabase-js for the status-plan loaders and actions.
 *
 * Responses are keyed `${schema}.${table}:${op}`. `queued` serves each key's
 * list in order and repeats the last entry, so a readAll page loop that gets a
 * short page stops after one call.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  ops: Array<[string, unknown[]]>
  payload?: unknown
}

export interface FakeResponse {
  data?: unknown
  error?: { code?: string; message: string } | null
}

export type Responder = (call: FakeCall) => FakeResponse

export const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001'

export function queued(map: Record<string, FakeResponse[]>): Responder {
  const queues = new Map(Object.entries(map).map(([k, v]) => [k, [...v]]))
  return (call) => {
    const q = queues.get(`${call.table}:${call.op}`)
    if (!q || q.length === 0) return { data: null, error: null }
    return q.length === 1 ? q[0]! : q.shift()!
  }
}

export function fakeClient(respond: Responder, opts: { userId?: string | null } = {}) {
  const calls: FakeCall[] = []
  const table = (schema: string) => (name: string) => {
    const call: FakeCall = { table: `${schema}.${name}`, op: 'select', ops: [] }
    calls.push(call)
    const b: any = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'range', 'limit']) {
      b[m] = (...args: unknown[]) => {
        call.ops.push([m, args])
        return b
      }
    }
    b.insert = (p: unknown) => { call.op = 'insert'; call.payload = p; return b }
    b.update = (p: unknown) => { call.op = 'update'; call.payload = p; return b }
    b.delete = () => { call.op = 'delete'; return b }
    const result = () => {
      const r = respond(call)
      return { data: r.data ?? null, error: r.error ?? null }
    }
    b.maybeSingle = async () => {
      const r = result()
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }
    }
    b.then = (ok: any, ko: any) => Promise.resolve(result()).then(ok, ko)
    return b
  }
  const userId = opts.userId === undefined ? FAKE_USER_ID : opts.userId
  const client = {
    schema: (s: string) => ({ from: table(s) }),
    from: table('public'),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null }),
      }),
    },
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
  }
  return { client, calls }
}

/** The ops of the first call to `table` with `op`, for assertions. */
export function opsOf(calls: FakeCall[], table: string, op: FakeCall['op'] = 'select'): Array<[string, unknown[]]> {
  return calls.find((c) => c.table === table && c.op === op)?.ops ?? []
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web type-check
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/status-plans/__fixtures__/fake-client.ts
git commit -m "test(status-plans): PostgREST-shaped fake for loader and action tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: DB order status for schematic plans — `loadProjectDbOrderStatus`

Slice 1's `loadTenantShopFacts` reads tenant nodes only. A distribution schematic links main boards and common-area boards too, so slice 2 needs the DB order for **any** project node. This is the minimal loader slice 1 left to a later slice; slice 3 reuses it rather than adding another.

`structure.node_orders` (00083) carries `project_id` and is unique per `(node_id, scope_item_type_id)`, so one query by project and the org's `db` scope type answers it, paged past `max_rows`.

**Files:**
- Create: `apps/web/src/lib/status-plans/project-db-orders.ts`
- Test: `apps/web/src/lib/status-plans/project-db-orders.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { loadProjectDbOrderStatus } from './project-db-orders'

const ARGS = { projectId: 'p-1', orgId: 'org-1' }

describe('loadProjectDbOrderStatus', () => {
  it('maps every node with a DB order to its status, main boards included', async () => {
    const { client, calls } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: [{ id: 'st-db' }] }],
      'structure.node_orders:select': [{ data: [
        { id: 'o1', node_id: 'n-tenant', status: 'ordered' },
        { id: 'o2', node_id: 'n-main', status: 'received' },
      ] }],
    }))
    expect(await loadProjectDbOrderStatus(client, ARGS)).toEqual({ 'n-tenant': 'ordered', 'n-main': 'received' })

    expect(opsOf(calls, 'structure.scope_item_types')).toEqual(expect.arrayContaining([
      ['eq', ['organisation_id', 'org-1']], ['eq', ['key', 'db']],
    ]))
    const orders = opsOf(calls, 'structure.node_orders')
    expect(orders).toContainEqual(['eq', ['project_id', 'p-1']])
    expect(orders).toContainEqual(['in', ['scope_item_type_id', ['st-db']]])
    expect(orders).toContainEqual(['order', ['id']])
    expect(orders).toContainEqual(['range', [0, 999]])
  })

  it('returns nothing, and reads no orders, when the org has no DB scope type', async () => {
    const { client, calls } = fakeClient(queued({ 'structure.scope_item_types:select': [{ data: [] }] }))
    expect(await loadProjectDbOrderStatus(client, ARGS)).toEqual({})
    expect(calls.map((c) => c.table)).not.toContain('structure.node_orders')
  })

  it('pages past the 1 000-row cap', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `o${i}`, node_id: `n${i}`, status: 'required' }))
    const { client, calls } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: [{ id: 'st-db' }] }],
      'structure.node_orders:select': [{ data: page1 }, { data: [{ id: 'o1000', node_id: 'n1000', status: 'by_tenant' }] }],
    }))
    const out = await loadProjectDbOrderStatus(client, ARGS)
    expect(Object.keys(out)).toHaveLength(1001)
    expect(out.n1000).toBe('by_tenant')
    expect(calls.filter((c) => c.table === 'structure.node_orders')).toHaveLength(2)
  })

  it('throws a named error when a read fails, rather than showing every block as unordered', async () => {
    const { client } = fakeClient(queued({
      'structure.scope_item_types:select': [{ data: [{ id: 'st-db' }] }],
      'structure.node_orders:select': [{ error: { message: 'boom' } }],
    }))
    await expect(loadProjectDbOrderStatus(client, ARGS)).rejects.toThrow(/DB orders: boom/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/project-db-orders.test.ts
```

Expected: FAIL with `Failed to resolve import "./project-db-orders"`.

- [ ] **Step 3: Implement**

```ts
/**
 * loadProjectDbOrderStatus — the DB order status of every node on a project
 * that has one, for distribution-schematic plans (spec §3.2).
 *
 * The tenant schedule's loadTenantShopFacts reads tenant nodes only; a
 * schematic links main boards and common-area boards too. "DB order" is the
 * node_orders row whose scope item type has key 'db' in the project's org
 * (00083: unique per node and scope type, so a node has at most one).
 *
 * A failed read THROWS: answering {} would draw every block as "No DB order",
 * a confident wrong picture. The caller must have gated project access; RLS on
 * the session client is that gate here.
 */
import type { NodeOrderStatus } from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ProjectDbOrderArgs {
  projectId: string
  orgId: string
}

export async function loadProjectDbOrderStatus(
  client: unknown,
  args: ProjectDbOrderArgs,
): Promise<Record<string, NodeOrderStatus>> {
  const db = client as any
  const types = await db.schema('structure').from('scope_item_types')
    .select('id').eq('organisation_id', args.orgId).eq('key', 'db')
  if (types.error) throw new Error(`DB orders: ${types.error.message}`)
  const typeIds = ((types.data ?? []) as Array<{ id: string }>).map((t) => t.id)
  if (typeIds.length === 0) return {}

  const rows = await readAll<{ id: string; node_id: string; status: NodeOrderStatus }>((from, to) =>
    db.schema('structure').from('node_orders')
      .select('id, node_id, status')
      .eq('project_id', args.projectId)
      .in('scope_item_type_id', typeIds)
      .order('id')
      .range(from, to),
  )
  if ('error' in rows) throw new Error(`DB orders: ${rows.error}`)

  const out: Record<string, NodeOrderStatus> = {}
  for (const r of rows.data) out[r.node_id] = r.status
  return out
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/project-db-orders.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/project-db-orders.ts apps/web/src/lib/status-plans/project-db-orders.test.ts
git commit -m "feat(status-plans): DB order status for every project node (schematic plans)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: What each shape looks like — `shape-view.ts`

One pure function decides a shape's style, label, legend bucket, measured area and area check, from live facts. The canvas, the legend and the side panel all read its output, so they cannot disagree.

**Files:**
- Create: `apps/web/src/lib/status-plans/shape-view.ts`
- Test: `apps/web/src/lib/status-plans/shape-view.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  tenantShapeStyle, areaShapeStyle, dbBlockStyle, COLOURS, TENANT_LEGEND, SCHEMATIC_LEGEND,
} from '@esite/shared/status-plans'
import { resolveShapeView, legendSummary, needsAttention, fillRgba, swatchCss, type ShapeViewContext } from './shape-view'
import type { CanvasShape, PlanNode } from './types'

// A 10 m × 8 m rectangle at 20 px/m = 200 × 160 px → 80 m².
const RECT = [100, 100, 300, 100, 300, 260, 100, 260]
const shape = (o: Partial<CanvasShape>): CanvasShape => ({
  id: 's1', shape: 'rect', points: RECT, nodeId: null, areaType: null,
  detectedTag: null, source: 'manual', updatedAt: 't', ...o,
})
const node = (o: Partial<PlanNode>): PlanNode => ({
  id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books',
  scheduledM2: 80, decommissioned: false, ...o,
})
const DONE = { scope: 'received', layoutIssued: true, db: 'received', lights: 'by_tenant', boDate: '2026-05-01' } as const
const OPEN = { scope: 'awaited', layoutIssued: false, db: 'ordered', lights: null, boDate: '2026-05-01' } as const

function ctx(o: Partial<ShapeViewContext> = {}): ShapeViewContext {
  return {
    purpose: 'tenant_layout',
    nodesById: new Map([['n1', node({})]]),
    shopLinks: { n1: { state: 'active', facts: DONE } },
    dbOrders: {},
    today: '2026-06-20',
    pixelsPerMeter: 20,
    ...o,
  }
}

describe('tenant layout shapes', () => {
  it('a complete shop: green, labelled, measured, area matches', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx())
    expect(v.style).toEqual(tenantShapeStyle({ status: 'complete', overdue: false }))
    expect(v.legendKey).toBe('complete')
    expect(v.labelLines).toEqual(['ZZ01', 'Lantern Books', '80.0 m²'])
    expect(v.areaM2).toBeCloseTo(80, 9)
    expect(v.check?.state).toBe('matches')
    expect(v.statusLabel).toBe('Complete')
  })

  it('an open shop past its BO date is in progress AND overdue', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ shopLinks: { n1: { state: 'active', facts: OPEN } } }))
    expect(v.style).toEqual(tenantShapeStyle({ status: 'in_progress', overdue: true }))
    expect(v.legendKey).toBe('in_progress')
    expect(v.overdue).toBe(true)
    expect(v.statusLabel).toBe('In progress · overdue')
  })

  it('area differs beyond 2 % is flagged (panel and legend only)', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ nodesById: new Map([['n1', node({ scheduledM2: 70 })]]) }))
    expect(v.check?.state).toBe('differs')
  })

  it('no scale: no area, no comparison, no m² line', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ pixelsPerMeter: null }))
    expect(v.areaM2).toBeNull()
    expect(v.check?.state).toBe('no_scale')
    expect(v.labelLines).toEqual(['ZZ01', 'Lantern Books'])
  })

  it('an unassigned shape is grey and says so', () => {
    const v = resolveShapeView(shape({}), ctx())
    expect(v.style).toEqual(tenantShapeStyle({ status: 'unlinked', overdue: false }))
    expect(v.legendKey).toBe('unlinked')
    expect(v.labelLines[0]).toBe('Unassigned')
    expect(v.linkedNodeMissing).toBe(false)
  })

  it('a link to a board that is no longer live falls to unlinked and needs attention', () => {
    const v = resolveShapeView(shape({ nodeId: 'gone' }), ctx())
    expect(v.legendKey).toBe('unlinked')
    expect(v.linkedNodeMissing).toBe(true)
    expect(v.statusLabel).toBe('Board deleted')
  })

  it('a decommissioned shop strikes its label', () => {
    const v = resolveShapeView(shape({ nodeId: 'n1' }), ctx({ shopLinks: { n1: { state: 'decommissioned' } } }))
    expect(v.style.strikeLabel).toBe(true)
    expect(v.legendKey).toBe('decommissioned')
  })

  it('an area shape uses the area palette and is measured but never checked', () => {
    const v = resolveShapeView(shape({ areaType: 'plant_room' }), ctx())
    expect(v.style).toEqual(areaShapeStyle('plant_room'))
    expect(v.legendKey).toBe('plant_room')
    expect(v.labelLines).toEqual(['Plant / electrical room', '80.0 m²'])
    expect(v.check).toBeNull()
  })
})

describe('distribution schematic shapes', () => {
  const sctx = (o: Partial<ShapeViewContext> = {}) => ctx({
    purpose: 'distribution_schematic',
    nodesById: new Map([['m1', node({ id: 'm1', code: 'MB-3.1', kind: 'main_board', shopNumber: null, shopName: null })]]),
    shopLinks: {},
    ...o,
  })

  it('a linked block takes its DB order hatch and the board code', () => {
    const v = resolveShapeView(shape({ nodeId: 'm1' }), sctx({ dbOrders: { m1: 'ordered' } }))
    expect(v.style).toEqual(dbBlockStyle('ordered'))
    expect(v.legendKey).toBe('ordered')
    expect(v.labelLines).toEqual(['MB-3.1'])
    expect(v.areaM2).toBeNull()
  })

  it('a linked board without a DB order is "no order"', () => {
    expect(resolveShapeView(shape({ nodeId: 'm1' }), sctx()).legendKey).toBe('no_order')
  })

  it('an unlinked block shows its detected tag as a hint', () => {
    const v = resolveShapeView(shape({ detectedTag: 'DB-90/91' }), sctx())
    expect(v.legendKey).toBe('unlinked')
    expect(v.labelLines).toEqual(['DB-90/91'])
  })
})

describe('legendSummary', () => {
  it('counts every legend key, overdue on top of its base status, and sums area', () => {
    const views = [
      resolveShapeView(shape({ id: 'a', nodeId: 'n1' }), ctx()),
      resolveShapeView(shape({ id: 'b', nodeId: 'n1' }), ctx({ shopLinks: { n1: { state: 'active', facts: OPEN } } })),
      resolveShapeView(shape({ id: 'c', areaType: 'common' }), ctx()),
      resolveShapeView(shape({ id: 'd' }), ctx({ pixelsPerMeter: null })),
    ]
    const s = legendSummary(views, 'tenant_layout')
    expect(Object.keys(s.counts).sort()).toEqual(TENANT_LEGEND.map((e) => e.key).sort())
    expect(s.counts).toMatchObject({ complete: 1, in_progress: 1, overdue: 1, common: 1, unlinked: 1 })
    expect(s.totalM2).toBeCloseTo(240, 9)
    expect(s.unmeasured).toBe(1)
  })

  it('a schematic summary has the schematic keys and no area', () => {
    const s = legendSummary([], 'distribution_schematic')
    expect(Object.keys(s.counts).sort()).toEqual(SCHEMATIC_LEGEND.map((e) => e.key).sort())
    expect(s.totalM2).toBe(0)
  })
})

describe('needsAttention', () => {
  it('lists deleted boards and area mismatches, nothing else', () => {
    const shapes = [shape({ id: 'ok', nodeId: 'n1' }), shape({ id: 'gone', nodeId: 'x' }), shape({ id: 'off', nodeId: 'n2' })]
    const c = ctx({
      nodesById: new Map([['n1', node({})], ['n2', node({ id: 'n2', shopNumber: 'ZZ02', scheduledM2: 60 })]]),
      shopLinks: { n1: { state: 'active', facts: DONE }, n2: { state: 'active', facts: DONE } },
    })
    const views = Object.fromEntries(shapes.map((s) => [s.id, resolveShapeView(s, c)]))
    const items = needsAttention(shapes, views)
    expect(items.map((i) => i.shapeId)).toEqual(['gone', 'off'])
    expect(items[0]!.reason).toMatch(/deleted/)
    expect(items[1]!.reason).toMatch(/80\.0 m² measured, 60\.0 m² scheduled \(\+33\.3 %\)/)
  })
})

describe('colour helpers', () => {
  it('fillRgba applies the style opacity; no fill is transparent', () => {
    expect(fillRgba({ ...tenantShapeStyle({ status: 'complete', overdue: false }), fill: COLOURS.complete, fillOpacity: 0.5 }))
      .toBe('rgba(46, 158, 79, 0.5)')
    expect(fillRgba(dbBlockStyle('required'))).toBe('transparent')
  })
  it('swatchCss marks dashed outlines and hatches', () => {
    expect(swatchCss(dbBlockStyle('unlinked')).border).toMatch(/dashed/)
    expect(swatchCss(dbBlockStyle('ordered')).backgroundImage).toMatch(/repeating-linear-gradient/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/shape-view.test.ts
```

Expected: FAIL with `Failed to resolve import "./shape-view"`.

- [ ] **Step 3: Implement**

```ts
/**
 * What a status-plan shape looks like, computed from live facts.
 *
 * Nothing here is stored (spec §2): the plan holds geometry + link + type, and
 * colour, hatch, label and area are derived at draw time, so a plan can never
 * lag the tenant schedule. The canvas, the legend and the side panel all read
 * resolveShapeView's output, so they cannot disagree with one another.
 */
import {
  AREA_TYPE_LABEL,
  DB_BLOCK_STATUS_LABEL,
  SCHEMATIC_LEGEND,
  SHOP_STATUS_LABEL,
  TENANT_LEGEND,
  areaCheck,
  areaShapeStyle,
  dbBlockStatus,
  dbBlockStyle,
  hexToRgb01,
  shapeAreaM2,
  shopStatus,
  tenantShapeStyle,
  totalMeasuredM2,
  type AreaCheck,
  type NodeOrderStatus,
  type ShapeStyle,
  type ShopLink,
  type StatusPlanPurpose,
} from '@esite/shared/status-plans'
import type { CanvasShape, PlanNode } from './types'

export interface ShapeView {
  id: string
  style: ShapeStyle
  /** The legend entry this shape counts under (TENANT_LEGEND / SCHEMATIC_LEGEND key). */
  legendKey: string
  overdue: boolean
  statusLabel: string
  /** Drawn at the shape's visual centre. */
  labelLines: string[]
  /** Null without a scale, and always on a schematic. */
  areaM2: number | null
  /** Shop shapes on a tenant layout only. */
  check: AreaCheck | null
  /** node_id is set but the board is not live (soft-deleted, or not visible). */
  linkedNodeMissing: boolean
}

export interface ShapeViewContext {
  purpose: StatusPlanPurpose
  nodesById: ReadonlyMap<string, PlanNode>
  shopLinks: Readonly<Record<string, ShopLink>>
  dbOrders: Readonly<Record<string, NodeOrderStatus>>
  today: string
  pixelsPerMeter: number | null
}

const m2 = (v: number): string => `${v.toFixed(1)} m²`

export function resolveShapeView(s: CanvasShape, ctx: ShapeViewContext): ShapeView {
  const node = s.nodeId ? ctx.nodesById.get(s.nodeId) ?? null : null
  const linkedNodeMissing = s.nodeId !== null && node === null

  if (ctx.purpose === 'distribution_schematic') {
    const status = dbBlockStatus(node !== null, node ? ctx.dbOrders[node.id] ?? null : null)
    return {
      id: s.id,
      style: dbBlockStyle(status),
      legendKey: status,
      overdue: false,
      statusLabel: linkedNodeMissing ? 'Board deleted' : DB_BLOCK_STATUS_LABEL[status],
      labelLines: [node ? node.code : s.detectedTag ?? 'Unlinked'],
      areaM2: null,
      check: null,
      linkedNodeMissing,
    }
  }

  const areaM2 = shapeAreaM2(s.points, ctx.pixelsPerMeter)
  const areaLine = areaM2 === null ? [] : [m2(areaM2)]

  if (s.areaType) {
    return {
      id: s.id,
      style: areaShapeStyle(s.areaType),
      legendKey: s.areaType,
      overdue: false,
      statusLabel: AREA_TYPE_LABEL[s.areaType],
      labelLines: [AREA_TYPE_LABEL[s.areaType], ...areaLine],
      areaM2,
      check: null,
      linkedNodeMissing: false,
    }
  }

  const link: ShopLink = node ? ctx.shopLinks[node.id] ?? { state: 'unlinked' } : { state: 'unlinked' }
  const result = shopStatus(link, ctx.today)
  const statusLabel = linkedNodeMissing
    ? 'Board deleted'
    : `${SHOP_STATUS_LABEL[result.status]}${result.overdue ? ' · overdue' : ''}`
  const nameLines = node
    ? [node.shopNumber ?? node.code, node.shopName ?? ''].filter((l) => l !== '')
    : ['Unassigned']

  return {
    id: s.id,
    style: tenantShapeStyle(result),
    legendKey: result.status,
    overdue: result.overdue,
    statusLabel,
    labelLines: [...nameLines, ...areaLine],
    areaM2,
    check: node ? areaCheck(areaM2, node.scheduledM2) : null,
    linkedNodeMissing,
  }
}

export interface LegendSummary {
  /** Every legend key for the purpose, zero included. Overdue counts on top of its base status. */
  counts: Record<string, number>
  totalM2: number
  unmeasured: number
}

export function legendSummary(views: ReadonlyArray<ShapeView>, purpose: StatusPlanPurpose): LegendSummary {
  const legend = purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND
  const counts: Record<string, number> = Object.fromEntries(legend.map((e) => [e.key, 0]))
  for (const v of views) {
    counts[v.legendKey] = (counts[v.legendKey] ?? 0) + 1
    if (v.overdue) counts.overdue = (counts.overdue ?? 0) + 1
  }
  if (purpose !== 'tenant_layout') return { counts, totalM2: 0, unmeasured: 0 }
  const { totalM2, unmeasured } = totalMeasuredM2(views.map((v) => v.areaM2))
  return { counts, totalM2, unmeasured }
}

export interface AttentionItem {
  shapeId: string
  label: string
  reason: string
}

/** Shapes a person should look at: a deleted board, or an area that differs from the schedule. */
export function needsAttention(
  shapes: ReadonlyArray<CanvasShape>,
  views: Readonly<Record<string, ShapeView>>,
): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const s of shapes) {
    const v = views[s.id]
    if (!v) continue
    const label = v.labelLines[0] ?? 'Shape'
    if (v.linkedNodeMissing) {
      out.push({ shapeId: s.id, label, reason: 'The board this shape was linked to has been deleted. Link another or leave it unassigned.' })
    } else if (v.check?.state === 'differs' && v.check.measuredM2 !== null && v.check.scheduledM2 !== null) {
      const pct = v.check.deltaPct ?? 0
      out.push({
        shapeId: s.id,
        label,
        reason: `Area differs: ${m2(v.check.measuredM2)} measured, ${m2(v.check.scheduledM2)} scheduled (${pct >= 0 ? '+' : ''}${pct.toFixed(1)} %)`,
      })
    }
  }
  return out
}

/** The fill as a CSS / Konva colour with the style's opacity applied. */
export function fillRgba(style: ShapeStyle): string {
  if (!style.fill) return 'transparent'
  const { r, g, b } = hexToRgb01(style.fill)
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${style.fillOpacity})`
}

/** A legend swatch approximating the canvas style in CSS. */
export function swatchCss(style: ShapeStyle): Record<string, string> {
  const css: Record<string, string> = {
    backgroundColor: fillRgba(style),
    border: `2px ${style.dash ? 'dashed' : 'solid'} ${style.stroke}`,
  }
  if (style.hatches.length > 0) {
    css.backgroundImage = style.hatches
      .map((h) => `repeating-linear-gradient(${90 - h.angleDeg}deg, ${h.color} 0 1.5px, transparent 1.5px 6px)`)
      .join(', ')
  }
  return css
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/shape-view.test.ts
```

Expected: PASS (16 tests). If the `fillRgba` expectation fails only on the RGB triple, slice 1's `COLOURS.complete` is not `#2E9E4F`: update the literal to the palette's value, never the function.

- [ ] **Step 5: Mutation check**

Temporarily make `resolveShapeView` ignore `ctx.today` by passing `'1900-01-01'` to `shopStatus`. Re-run: "an open shop past its BO date…" and the `legendSummary` overdue count must FAIL. Restore; PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/shape-view.ts apps/web/src/lib/status-plans/shape-view.test.ts
git commit -m "feat(status-plans): derive shape style, label, legend bucket and area from live facts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The assign list — `node-options.ts`

**Files:**
- Create: `apps/web/src/lib/status-plans/node-options.ts`
- Test: `apps/web/src/lib/status-plans/node-options.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildNodeOptions, filterNodeOptions } from './node-options'
import type { CanvasShape, PlanNode } from './types'

const n = (o: Partial<PlanNode>): PlanNode => ({
  id: 'x', code: 'DB-X', kind: 'tenant_db', shopNumber: null, shopName: null, scheduledM2: null, decommissioned: false, ...o,
})
const NODES: PlanNode[] = [
  n({ id: 'n10', code: 'DB-10', shopNumber: '10', shopName: 'Copper Kettle' }),
  n({ id: 'n2', code: 'DB-2', shopNumber: '2', shopName: 'Lantern Books' }),
  n({ id: 'n3', code: 'DB-3', shopNumber: '3', shopName: 'Old Mill', decommissioned: true }),
  n({ id: 'm1', code: 'MB-3.1', kind: 'main_board' }),
]
const s = (id: string, nodeId: string | null): CanvasShape => ({
  id, shape: 'polygon', points: [0, 0, 1, 0, 1, 1], nodeId, areaType: null, detectedTag: null, source: 'manual', updatedAt: 't',
})

describe('buildNodeOptions', () => {
  it('tenant layout: tenant boards only, natural order, number — name', () => {
    const opts = buildNodeOptions(NODES, [], null, 'tenant_layout')
    expect(opts.map((o) => o.label)).toEqual(['2 — Lantern Books', '3 — Old Mill', '10 — Copper Kettle'])
    expect(opts.find((o) => o.id === 'n3')!.sub).toBe('DB-3 · decommissioned')
  })

  it('a board already on another shape is disabled with a reason', () => {
    const opts = buildNodeOptions(NODES, [s('a', 'n2'), s('b', null)], 'b', 'tenant_layout')
    const n2 = opts.find((o) => o.id === 'n2')!
    expect(n2.disabled).toBe(true)
    expect(n2.reason).toBe('Already on this plan')
  })

  it("the selected shape's own board stays enabled", () => {
    const opts = buildNodeOptions(NODES, [s('a', 'n2')], 'a', 'tenant_layout')
    expect(opts.find((o) => o.id === 'n2')!.disabled).toBe(false)
  })

  it('schematic: every board, labelled by code with its kind', () => {
    const opts = buildNodeOptions(NODES, [], null, 'distribution_schematic')
    expect(opts.map((o) => o.label)).toEqual(['DB-2', 'DB-3', 'DB-10', 'MB-3.1'])
    expect(opts.find((o) => o.id === 'm1')!.sub).toBe('Main board')
  })
})

describe('filterNodeOptions', () => {
  const opts = buildNodeOptions(NODES, [], null, 'tenant_layout')
  it('empty query keeps everything', () => {
    expect(filterNodeOptions(opts, '   ')).toHaveLength(3)
  })
  it('every term must match, case-insensitive, label or sub', () => {
    expect(filterNodeOptions(opts, 'lantern').map((o) => o.id)).toEqual(['n2'])
    expect(filterNodeOptions(opts, 'db-3 DECOMM').map((o) => o.id)).toEqual(['n3'])
    expect(filterNodeOptions(opts, 'kettle mill')).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/node-options.test.ts
```

Expected: FAIL with `Failed to resolve import "./node-options"`.

- [ ] **Step 3: Implement**

```ts
/**
 * The searchable list a shape is linked from. A tenant layout links tenant
 * boards only (the slice-1 trigger refuses anything else); a schematic links
 * any live board. A board is on a plan at most once (unique key), so a board
 * held by ANOTHER shape is listed but disabled — hiding it would make a person
 * think the board is missing from the schedule.
 */
import type { StatusPlanPurpose } from '@esite/shared/status-plans'
import type { CanvasShape, PlanNode } from './types'

export interface NodeOption {
  id: string
  label: string
  sub: string | null
  disabled: boolean
  reason: string | null
}

const KIND_LABEL: Record<string, string> = {
  tenant_db: 'Tenant DB',
  main_board: 'Main board',
  common_area_board: 'Common area board',
  common_area_lighting: 'Common area lighting',
}

export function nodeLabel(n: PlanNode, purpose: StatusPlanPurpose): string {
  return purpose === 'tenant_layout' ? `${n.shopNumber ?? n.code} — ${n.shopName ?? 'No name'}` : n.code
}

export function buildNodeOptions(
  nodes: ReadonlyArray<PlanNode>,
  shapes: ReadonlyArray<CanvasShape>,
  selectedShapeId: string | null,
  purpose: StatusPlanPurpose,
): NodeOption[] {
  const holder = new Map<string, string>()
  for (const s of shapes) if (s.nodeId) holder.set(s.nodeId, s.id)

  return nodes
    .filter((n) => purpose !== 'tenant_layout' || n.kind === 'tenant_db')
    .map((n) => {
      const heldBy = holder.get(n.id)
      const used = heldBy !== undefined && heldBy !== selectedShapeId
      const sub = purpose === 'tenant_layout'
        ? [n.code, n.decommissioned ? 'decommissioned' : null].filter(Boolean).join(' · ')
        : [KIND_LABEL[n.kind] ?? n.kind, n.shopName].filter(Boolean).join(' · ')
      return {
        id: n.id,
        label: nodeLabel(n, purpose),
        sub: sub || null,
        disabled: used,
        reason: used ? 'Already on this plan' : null,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' }))
}

export function filterNodeOptions(options: ReadonlyArray<NodeOption>, query: string): NodeOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...options]
  return options.filter((o) => {
    const hay = `${o.label} ${o.sub ?? ''}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/node-options.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/node-options.ts apps/web/src/lib/status-plans/node-options.test.ts
git commit -m "feat(status-plans): searchable assign list with used boards disabled

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Canvas interaction rules — `canvas-reducer.ts`

The Konva component has no tests in this repo, so it must hold no rules. Every decision about a press, a drag, a double-click or a key lives here.

**Files:**
- Create: `apps/web/src/lib/status-plans/canvas-reducer.ts`
- Test: `apps/web/src/lib/status-plans/canvas-reducer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { canvasReducer, initialCanvasState, isIdle, dragVertex, type CanvasState, type CanvasEvent } from './canvas-reducer'

const TOL = 5
function run(state: CanvasState, events: CanvasEvent[]) {
  let s = state
  const commits = []
  for (const e of events) {
    const step = canvasReducer(s, e)
    s = step.state
    if (step.commit) commits.push(step.commit)
  }
  return { state: s, commits }
}
const press = (x: number, y: number): CanvasEvent => ({ type: 'press', x, y, tolPx: TOL })

describe('polygon tool', () => {
  it('clicks place corners; pressing the first corner closes and commits', () => {
    const { state, commits } = run(initialCanvasState('polygon'), [press(0, 0), press(100, 0), press(100, 50), press(2, 1)])
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50] }])
    expect(state.draft).toEqual([])
  })

  it('double-click (two presses on one spot, then finish) commits once without a zero-length edge', () => {
    const { commits } = run(initialCanvasState('polygon'), [
      press(0, 0), press(100, 0), press(100, 50), press(100.5, 50.5), { type: 'finish', tolPx: TOL },
    ])
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50] }])
  })

  it('finishing with fewer than 3 corners discards', () => {
    const { state, commits } = run(initialCanvasState('polygon'), [press(0, 0), press(10, 0), { type: 'finish', tolPx: TOL }])
    expect(commits).toEqual([])
    expect(state.draft).toEqual([])
  })

  it('undoPoint drops the last corner; escape drops the draft', () => {
    const a = run(initialCanvasState('polygon'), [press(0, 0), press(10, 0), { type: 'undoPoint' }])
    expect(a.state.draft).toEqual([0, 0])
    const b = run(a.state, [{ type: 'escape' }])
    expect(b.state.draft).toEqual([])
    expect(isIdle(b.state)).toBe(true)
  })
})

describe('rectangle tool', () => {
  it('press-drag-release commits a normalised rectangle', () => {
    const { commits, state } = run(initialCanvasState('rect'), [
      press(300, 260), { type: 'move', x: 200, y: 200 }, { type: 'release', x: 100, y: 100, tolPx: TOL },
    ])
    expect(commits).toEqual([{ shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260] }])
    expect(state.rect).toBeNull()
  })

  it('a click without a drag commits nothing', () => {
    const { commits } = run(initialCanvasState('rect'), [press(10, 10), { type: 'release', x: 12, y: 11, tolPx: TOL }])
    expect(commits).toEqual([])
  })

  it('move without a press changes nothing (same state object)', () => {
    const s = initialCanvasState('rect')
    expect(canvasReducer(s, { type: 'move', x: 1, y: 1 }).state).toBe(s)
  })
})

describe('calibrate, select, pan and tool changes', () => {
  it('calibrate keeps two points; a third press starts over', () => {
    expect(run(initialCanvasState('calibrate'), [press(1, 2), press(3, 4)]).state.calib).toEqual([1, 2, 3, 4])
    expect(run(initialCanvasState('calibrate'), [press(1, 2), press(3, 4), press(5, 6)]).state.calib).toEqual([5, 6])
  })
  it('select and pan presses change nothing', () => {
    for (const tool of ['select', 'pan'] as const) {
      const s = initialCanvasState(tool)
      expect(canvasReducer(s, press(1, 1)).state).toBe(s)
    }
  })
  it('changing tool abandons anything in progress', () => {
    const a = run(initialCanvasState('polygon'), [press(0, 0), { type: 'tool', tool: 'rect' }])
    expect(a.state).toEqual(initialCanvasState('rect'))
  })
})

describe('dragVertex', () => {
  it('moves one polygon corner', () => {
    expect(dragVertex({ shape: 'polygon', points: [0, 0, 10, 0, 10, 10] }, 1, 12.5, -1)).toEqual([0, 0, 12.5, -1, 10, 10])
  })
  it('a rectangle stays a rectangle: the opposite corner is the anchor', () => {
    // TL,TR,BR,BL; drag BR (index 2) past TL
    expect(dragVertex({ shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260] }, 2, 50, 40))
      .toEqual([50, 40, 100, 40, 100, 100, 50, 100])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/canvas-reducer.test.ts
```

Expected: FAIL with `Failed to resolve import "./canvas-reducer"`.

- [ ] **Step 3: Implement**

```ts
/**
 * The status-plan canvas's interaction rules, without Konva or a DOM.
 *
 * The component turns pointer and key input into events in IMAGE space and
 * applies the returned state; a `commit` is a finished shape for the caller
 * to save. Tolerances arrive in image pixels (the component divides a screen
 * distance by the zoom), so the rules hold at any zoom.
 */
import { dedupeConsecutivePoints } from '@esite/shared'
import { rectToPoints } from '@esite/shared/status-plans'

export type CanvasTool = 'select' | 'polygon' | 'rect' | 'pan' | 'calibrate'

export interface CanvasState {
  tool: CanvasTool
  /** Polygon corners placed so far, flat. */
  draft: number[]
  /** Rectangle being dragged. */
  rect: { x0: number; y0: number; x1: number; y1: number } | null
  /** Calibration points, flat, at most two. */
  calib: number[]
}

export interface ShapeCommit {
  shape: 'polygon' | 'rect'
  points: number[]
}

export type CanvasEvent =
  | { type: 'tool'; tool: CanvasTool }
  | { type: 'press'; x: number; y: number; tolPx: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'release'; x: number; y: number; tolPx: number }
  | { type: 'finish'; tolPx: number }
  | { type: 'escape' }
  | { type: 'undoPoint' }

export interface CanvasStep {
  state: CanvasState
  commit: ShapeCommit | null
}

export function initialCanvasState(tool: CanvasTool = 'select'): CanvasState {
  return { tool, draft: [], rect: null, calib: [] }
}

/** Nothing in progress: Escape should fall through to "deselect". */
export function isIdle(s: CanvasState): boolean {
  return s.draft.length === 0 && s.rect === null && s.calib.length === 0
}

/**
 * The polygon a draft becomes, or null when it has fewer than 3 corners. A
 * double-click stamps extra presses on the last corner, and a press on the
 * first corner is the close gesture, not a corner: both are removed.
 */
function closePolygon(draft: number[], tolPx: number): number[] | null {
  let pts = dedupeConsecutivePoints(draft, tolPx)
  const n = pts.length
  if (n >= 8 && Math.hypot(pts[0]! - pts[n - 2]!, pts[1]! - pts[n - 1]!) <= tolPx) pts = pts.slice(0, -2)
  return pts.length >= 6 ? pts : null
}

const same = (state: CanvasState): CanvasStep => ({ state, commit: null })

export function canvasReducer(s: CanvasState, e: CanvasEvent): CanvasStep {
  switch (e.type) {
    case 'tool':
      return same(initialCanvasState(e.tool))

    case 'press': {
      if (s.tool === 'polygon') {
        const n = s.draft.length
        if (n >= 6 && Math.hypot(e.x - s.draft[0]!, e.y - s.draft[1]!) <= e.tolPx) {
          const pts = closePolygon(s.draft, e.tolPx)
          return { state: { ...s, draft: [] }, commit: pts ? { shape: 'polygon', points: pts } : null }
        }
        return same({ ...s, draft: [...s.draft, e.x, e.y] })
      }
      if (s.tool === 'rect') return same({ ...s, rect: { x0: e.x, y0: e.y, x1: e.x, y1: e.y } })
      if (s.tool === 'calibrate') return same({ ...s, calib: s.calib.length < 4 ? [...s.calib, e.x, e.y] : [e.x, e.y] })
      return same(s)
    }

    case 'move':
      if (!s.rect) return same(s)
      return same({ ...s, rect: { ...s.rect, x1: e.x, y1: e.y } })

    case 'release': {
      if (!s.rect) return same(s)
      const { x0, y0 } = s.rect
      const next = { ...s, rect: null }
      if (Math.abs(e.x - x0) < e.tolPx || Math.abs(e.y - y0) < e.tolPx) return same(next)
      return { state: next, commit: { shape: 'rect', points: rectToPoints(x0, y0, e.x, e.y) } }
    }

    case 'finish': {
      if (s.tool !== 'polygon' || s.draft.length === 0) return same(s)
      const pts = closePolygon(s.draft, e.tolPx)
      return { state: { ...s, draft: [] }, commit: pts ? { shape: 'polygon', points: pts } : null }
    }

    case 'escape':
      if (s.draft.length) return same({ ...s, draft: [] })
      if (s.rect) return same({ ...s, rect: null })
      if (s.calib.length) return same({ ...s, calib: [] })
      return same(s)

    case 'undoPoint':
      return s.draft.length ? same({ ...s, draft: s.draft.slice(0, -2) }) : same(s)
  }
}

/**
 * A shape's points after dragging vertex `index` to (x, y). A rectangle stays
 * axis-aligned: the opposite corner is the anchor and the four corners are
 * re-derived, so a drag can never store a rect the CHECK would refuse.
 */
export function dragVertex(shape: { shape: 'polygon' | 'rect'; points: readonly number[] }, index: number, x: number, y: number): number[] {
  if (shape.shape === 'rect') {
    const o = (index + 2) % 4
    return rectToPoints(shape.points[o * 2]!, shape.points[o * 2 + 1]!, x, y)
  }
  const out = shape.points.slice()
  out[index * 2] = x
  out[index * 2 + 1] = y
  return out
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/canvas-reducer.test.ts
```

Expected: PASS (13 tests). If the double-click test fails with a 4-corner polygon, `dedupeConsecutivePoints` compares with `<` not `<=`: keep the test and use a press at `(100.5, 50.5)` → `(100.2, 50.2)`, never weaken the expectation.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/canvas-reducer.ts apps/web/src/lib/status-plans/canvas-reducer.test.ts
git commit -m "feat(status-plans): canvas tool rules as a pure reducer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Server actions — `status-plan.actions.ts`

**Files:**
- Create: `apps/web/src/actions/status-plan.actions.ts`
- Test: `apps/web/src/actions/status-plan.actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeClient, queued, opsOf, type FakeResponse } from '@/lib/status-plans/__fixtures__/fake-client'

/**
 * Three things a mocked test CAN see and must pin:
 *  - the gate is consulted with ORG_WRITE_ROLES on the plan's own project, and
 *    a refusal writes nothing;
 *  - shape writes are conditional on updated_at in the SAME statement, and a
 *    zero-row answer is reported as a conflict, not as success;
 *  - organisation_id / created_by / source_file_path are never sent (the
 *    slice-1 triggers bind them).
 * The role helper is mocked with the OBJECT it really returns — a boolean mock
 * is how an inert gate passed tests before (role-gate-call-sites contract).
 */

const { createClientMock, requireEffectiveRoleMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a) }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))

import {
  createStatusPlanAction,
  renameStatusPlanAction,
  deleteStatusPlanAction,
  reanchorStatusPlanAction,
  createStatusPlanShapeAction,
  updateStatusPlanShapeAction,
  deleteStatusPlanShapeAction,
} from './status-plan.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const FP = '22222222-2222-4222-8222-222222222222'
const PL = '33333333-3333-4333-8333-333333333333'
const S = '44444444-4444-4444-8444-444444444444'
const N = '55555555-5555-4555-8555-555555555555'
const TS = '2026-10-09T09:15:42.123456+00:00'
const TS2 = '2026-10-09T09:16:00.000001+00:00'
const TRI = [10, 10, 200.123, 10, 200, 150]

const PLAN = { id: PL, project_id: P, purpose: 'tenant_layout', floor_plan_id: FP }
const SHAPE_ROW = {
  id: S, status_plan_id: PL, shape: 'polygon', points: [10, 10, 200.12, 10, 200, 150], node_id: null, area_type: null,
  detected_tag: null, source: 'manual', created_by: 'u', created_at: TS, updated_at: TS,
}

let calls: ReturnType<typeof fakeClient>['calls']
function setup(map: Record<string, FakeResponse[]>, userId?: string | null) {
  const f = fakeClient(queued(map), { userId })
  calls = f.calls
  createClientMock.mockResolvedValue(f.client)
}
const writes = () => calls.filter((c) => c.op !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
})

describe('createStatusPlanAction', () => {
  const input = { projectId: P, floorPlanId: FP, pageIndex: 2, purpose: 'tenant_layout' as const, name: '  Ground floor  ' }

  it('creates the plan with only the columns the client may choose', async () => {
    setup({
      'tenants.floor_plans:select': [{ data: { id: FP, project_id: P, file_path: 'x/E-100.pdf' } }],
      'tenants.status_plans:insert': [{ data: { id: PL } }],
    })
    expect(await createStatusPlanAction(input)).toEqual({ ok: true, data: { id: PL } })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
    expect(writes()[0]!.payload).toEqual({ project_id: P, floor_plan_id: FP, page_index: 2, purpose: 'tenant_layout', name: 'Ground floor' })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${P}/status-plans`)
  })

  it('refuses a non-writer and writes nothing', async () => {
    setup({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const res = await createStatusPlanAction(input)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/owner, admin or project manager/) })
    expect(writes()).toEqual([])
  })

  it('refuses a drawing from another project and a drawing the canvas cannot render', async () => {
    setup({ 'tenants.floor_plans:select': [{ data: { id: FP, project_id: 'other', file_path: 'x.pdf' } }] })
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: 'That drawing is not on this project.' })
    setup({ 'tenants.floor_plans:select': [{ data: { id: FP, project_id: P, file_path: 'x.dwg' } }] })
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/PDF or image/) })
  })

  it('maps the duplicate-plan key to a sentence', async () => {
    setup({
      'tenants.floor_plans:select': [{ data: { id: FP, project_id: P, file_path: 'x.pdf' } }],
      'tenants.status_plans:insert': [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "status_plans_drawing_page_purpose_key"' } }],
    })
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/already has a plan/) })
  })

  it('rejects bad input before touching the database', async () => {
    setup({})
    expect(await createStatusPlanAction({ ...input, name: '   ' })).toMatchObject({ ok: false, error: 'Give the plan a name.' })
    expect(await createStatusPlanAction({ ...input, pageIndex: 0 })).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })

  it('a signed-out caller is told so', async () => {
    setup({}, null)
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/Sign in/) })
  })
})

describe('plan rename / delete / re-anchor', () => {
  it('rename returns the stored name and updated_at', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plans:update': [{ data: { name: 'Level 1', updated_at: TS2 } }],
    })
    expect(await renameStatusPlanAction({ planId: PL, name: 'Level 1' })).toEqual({ ok: true, data: { name: 'Level 1', updatedAt: TS2 } })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
  })

  it('delete reports a plan that was already gone', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plans:delete': [{ data: null }] })
    expect(await deleteStatusPlanAction({ planId: PL })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) })
  })

  it("re-anchor writes the drawing's CURRENT file, read on the server", async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.floor_plans:select': [{ data: { file_path: 'x/E-100 rev C.pdf' } }],
      'tenants.status_plans:update': [{ data: { source_file_path: 'x/E-100 rev C.pdf' } }],
    })
    expect(await reanchorStatusPlanAction({ planId: PL })).toEqual({ ok: true, data: { sourceFilePath: 'x/E-100 rev C.pdf' } })
    expect(writes()[0]!.payload).toEqual({ source_file_path: 'x/E-100 rev C.pdf' })
  })
})

describe('createStatusPlanShapeAction', () => {
  it('rounds points, validates them, and returns the stored shape', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_shapes:insert': [{ data: SHAPE_ROW }],
    })
    const res = await createStatusPlanShapeAction({ planId: PL, shape: 'polygon', points: TRI })
    expect(res).toMatchObject({ ok: true, data: { id: S, points: [10, 10, 200.12, 10, 200, 150], updatedAt: TS } })
    expect(writes()[0]!.payload).toEqual({
      status_plan_id: PL, shape: 'polygon', points: [10, 10, 200.12, 10, 200, 150], node_id: null, area_type: null, source: 'manual',
    })
  })

  it('refuses a rectangle that is not 4 corners without a round trip', async () => {
    setup({})
    const res = await createStatusPlanShapeAction({ planId: PL, shape: 'rect', points: TRI })
    expect(res.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses an area type on a schematic plan', async () => {
    setup({ 'tenants.status_plans:select': [{ data: { ...PLAN, purpose: 'distribution_schematic' } }] })
    expect(await createStatusPlanShapeAction({ planId: PL, shape: 'polygon', points: TRI, areaType: 'common' }))
      .toMatchObject({ ok: false, error: 'Area types are for tenant layout plans only.' })
    expect(writes()).toEqual([])
  })
})

describe('updateStatusPlanShapeAction', () => {
  const base = {
    'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }],
    'tenants.status_plans:select': [{ data: PLAN }],
  }

  it('links a board, clears the area type, and is conditional on updated_at', async () => {
    setup({ ...base, 'tenants.status_plan_shapes:update': [{ data: { ...SHAPE_ROW, node_id: N, updated_at: TS2 } }] })
    const res = await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, nodeId: N })
    expect(res).toMatchObject({ ok: true, data: { nodeId: N, updatedAt: TS2 } })
    const upd = calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ node_id: N, area_type: null })
    expect(upd.ops).toContainEqual(['eq', ['id', S]])
    expect(upd.ops).toContainEqual(['eq', ['updated_at', TS]])
  })

  it('zero rows with the shape still there is a conflict', async () => {
    setup({
      ...base,
      'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }, { data: { id: S } }],
      'tenants.status_plan_shapes:update': [{ data: null }],
    })
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, points: TRI })).toEqual({
      ok: false, error: 'This shape was changed by someone else — reload to see it.', conflict: true,
    })
  })

  it('zero rows with the shape gone says so', async () => {
    setup({
      ...base,
      'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }, { data: null }],
      'tenants.status_plan_shapes:update': [{ data: null }],
    })
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, points: TRI }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/deleted by someone else/), conflict: true })
  })

  it('maps "board already on this plan"', async () => {
    setup({ ...base, 'tenants.status_plan_shapes:update': [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"' } }] })
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, nodeId: N }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/already on this plan/) })
  })

  it('a patch with nothing in it is refused', async () => {
    setup({})
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS })).toMatchObject({ ok: false, error: 'Nothing to change.' })
  })

  it('validates new points against the STORED shape kind', async () => {
    setup({ ...base, 'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'rect' } }] })
    const res = await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, points: TRI })
    expect(res.ok).toBe(false)
    expect(writes()).toEqual([])
  })
})

describe('deleteStatusPlanShapeAction', () => {
  it('is conditional on updated_at', async () => {
    setup({
      'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_shapes:delete': [{ data: { id: S } }],
    })
    expect(await deleteStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS })).toEqual({ ok: true, data: { id: S } })
    expect(opsOf(calls, 'tenants.status_plan_shapes', 'delete')).toContainEqual(['eq', ['updated_at', TS]])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/actions/status-plan.actions.test.ts
```

Expected: FAIL with `Failed to resolve import "./status-plan.actions"`.

- [ ] **Step 3: Implement**

```ts
'use server'

/**
 * Status plans — the write path (spec 2026-10-09 §7, §9; slice 2).
 *
 * Every action:
 *  - returns { ok, error } and never throws for an expected refusal. Next.js
 *    replaces a thrown message with a generic sentence in production (PR #266).
 *  - gates on requireEffectiveRole(…, ORG_WRITE_ROLES) and reads `.ok`: the
 *    helper returns an OBJECT, so a truthiness check would gate nothing.
 *    The RESTRICTIVE per-verb policies of 00245 are the database backstop.
 *  - never sends organisation_id, created_by or source_file_path on insert:
 *    the slice-1 triggers bind them from the drawing and the session.
 *  - turns a Postgres refusal into a sentence (lib/status-plans/write-errors).
 *
 * Shape writes carry the row's updated_at and are CONDITIONAL on it
 * (`.eq('updated_at', expected)`), so the stale check and the write are one
 * statement. Zero rows back means someone else moved or deleted the shape.
 *
 * Shape actions do NOT call revalidatePath: the canvas page folds each result
 * into its own state, and a revalidation would re-render the page under the
 * canvas and re-mint the drawing's signed URL (the router.refresh() trap).
 *
 * This file exports async functions only ('use server'); types live in
 * lib/status-plans/types.ts.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { AREA_TYPES, SHAPE_KINDS, STATUS_PLAN_PURPOSES, pointsError } from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHAPE_COLUMNS, roundPoints, shapePatchRow, toCanvasShape } from '@/lib/status-plans/canvas-shape'
import { isRenderableDrawing, statusPlansHref } from '@/lib/status-plans/plan-urls'
import type { ActionResult, CanvasShape } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const uuid = z.string().uuid()
const planName = z.string().trim().min(1, 'Give the plan a name.').max(120, 'Keep the plan name under 120 characters.')

const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change status plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Go back to the list and reload.'
const SHAPE_GONE = 'This shape has been deleted by someone else — reload to see the plan.'
const SHAPE_STALE = 'This shape was changed by someone else — reload to see it.'

type Fail = { ok: false; error: string; conflict?: boolean }
const fail = (error: string, conflict?: boolean): Fail => (conflict ? { ok: false, error, conflict } : { ok: false, error })
const invalid = (e: z.ZodError): Fail => fail(e.issues[0]?.message ?? 'That request was not valid.')

async function signedIn(): Promise<any | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? supabase : null
}

async function mayWrite(supabase: any, projectId: string): Promise<boolean> {
  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  return gate.ok
}

type PlanCtx = { id: string; project_id: string; purpose: string; floor_plan_id: string }

async function planContext(supabase: any, planId: string): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans')
    .select('id, project_id, purpose, floor_plan_id').eq('id', planId).maybeSingle()
  return (data as PlanCtx | null) ?? null
}

type ShapeCtx = { shape: { id: string; status_plan_id: string; shape: 'polygon' | 'rect' }; plan: PlanCtx }

async function shapeContext(supabase: any, shapeId: string): Promise<ShapeCtx | Fail> {
  const { data: shape } = await supabase.schema('tenants').from('status_plan_shapes')
    .select('id, status_plan_id, shape').eq('id', shapeId).maybeSingle()
  if (!shape) return fail(SHAPE_GONE, true)
  const plan = await planContext(supabase, shape.status_plan_id)
  if (!plan) return fail(PLAN_GONE)
  return { shape, plan }
}

/** A conditional write answered zero rows: moved on, or deleted? */
async function staleOrGone(supabase: any, shapeId: string): Promise<Fail> {
  const { data } = await supabase.schema('tenants').from('status_plan_shapes').select('id').eq('id', shapeId).maybeSingle()
  return data ? fail(SHAPE_STALE, true) : fail(SHAPE_GONE, true)
}

// ── Plans ──────────────────────────────────────────────────────────────────

const createPlanSchema = z.object({
  projectId: uuid,
  floorPlanId: uuid,
  pageIndex: z.number().int().min(1, 'Pages are numbered from 1.').max(500, 'That page number is too high.'),
  purpose: z.enum(STATUS_PLAN_PURPOSES),
  name: planName,
})

export async function createStatusPlanAction(input: z.input<typeof createPlanSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = createPlanSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const { projectId, floorPlanId, pageIndex, purpose, name } = parsed.data
  if (!(await mayWrite(supabase, projectId))) return fail(NOT_ALLOWED)

  const { data: drawing } = await supabase.schema('tenants').from('floor_plans')
    .select('id, project_id, file_path').eq('id', floorPlanId).maybeSingle()
  if (!drawing || drawing.project_id !== projectId) return fail('That drawing is not on this project.')
  if (!isRenderableDrawing(String(drawing.file_path ?? ''))) {
    return fail('A status plan needs a PDF or image drawing (PDF, PNG, JPG, WebP or SVG).')
  }

  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .insert({ project_id: projectId, floor_plan_id: floorPlanId, page_index: pageIndex, purpose, name })
    .select('id').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(NOT_ALLOWED)
  revalidatePath(statusPlansHref(projectId))
  return { ok: true, data: { id: data.id as string } }
}

export async function renameStatusPlanAction(input: { planId: string; name: string }): Promise<ActionResult<{ name: string; updatedAt: string }>> {
  const parsed = z.object({ planId: uuid, name: planName }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .update({ name: parsed.data.name }).eq('id', plan.id).select('name, updated_at').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(PLAN_GONE)
  revalidatePath(statusPlansHref(plan.project_id))
  return { ok: true, data: { name: data.name as string, updatedAt: data.updated_at as string } }
}

export async function deleteStatusPlanAction(input: { planId: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ planId: uuid }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  // Shapes go with the plan (ON DELETE CASCADE).
  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .delete().eq('id', plan.id).select('id').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(PLAN_GONE)
  revalidatePath(statusPlansHref(plan.project_id))
  return { ok: true, data: { id: plan.id } }
}

/**
 * "The drawing changed; I have checked the shapes": move the plan's anchor to
 * the drawing's CURRENT file. The file is read here, never taken from the
 * client, and the slice-1 trigger refuses any other value.
 */
export async function reanchorStatusPlanAction(input: { planId: string }): Promise<ActionResult<{ sourceFilePath: string }>> {
  const parsed = z.object({ planId: uuid }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  const { data: drawing } = await supabase.schema('tenants').from('floor_plans')
    .select('file_path').eq('id', plan.floor_plan_id).maybeSingle()
  if (!drawing?.file_path) return fail('That drawing no longer exists, or you cannot see it.')

  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .update({ source_file_path: drawing.file_path }).eq('id', plan.id).select('source_file_path').maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(PLAN_GONE)
  return { ok: true, data: { sourceFilePath: data.source_file_path as string } }
}

// ── Shapes ─────────────────────────────────────────────────────────────────

const createShapeSchema = z
  .object({
    planId: uuid,
    shape: z.enum(SHAPE_KINDS),
    points: z.array(z.number()),
    nodeId: uuid.nullable().optional(),
    areaType: z.enum(AREA_TYPES).nullable().optional(),
  })
  .refine((v) => !(v.nodeId && v.areaType), { message: 'A shape is either a shop or an area, not both.' })

export async function createStatusPlanShapeAction(input: z.input<typeof createShapeSchema>): Promise<ActionResult<CanvasShape>> {
  const parsed = createShapeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { planId, shape, nodeId, areaType } = parsed.data
  const points = roundPoints(parsed.data.points)
  const bad = pointsError(shape, points)
  if (bad) return fail(bad)

  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planContext(supabase, planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)
  if (areaType && plan.purpose !== 'tenant_layout') return fail('Area types are for tenant layout plans only.')

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .insert({ status_plan_id: planId, shape, points, node_id: nodeId ?? null, area_type: areaType ?? null, source: 'manual' })
    .select(SHAPE_COLUMNS).maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'shape'))
  if (!data) return fail(NOT_ALLOWED)
  return { ok: true, data: toCanvasShape(data) }
}

const updateShapeSchema = z
  .object({
    shapeId: uuid,
    expectedUpdatedAt: z.string().min(1),
    points: z.array(z.number()).optional(),
    nodeId: uuid.nullable().optional(),
    areaType: z.enum(AREA_TYPES).nullable().optional(),
  })
  .refine((v) => !(v.nodeId && v.areaType), { message: 'A shape is either a shop or an area, not both.' })
  .refine((v) => v.points !== undefined || v.nodeId !== undefined || v.areaType !== undefined, { message: 'Nothing to change.' })

export async function updateStatusPlanShapeAction(input: z.input<typeof updateShapeSchema>): Promise<ActionResult<CanvasShape>> {
  const parsed = updateShapeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { shapeId, expectedUpdatedAt, nodeId, areaType } = parsed.data

  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await shapeContext(supabase, shapeId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  let points: number[] | undefined
  if (parsed.data.points !== undefined) {
    points = roundPoints(parsed.data.points)
    const bad = pointsError(ctx.shape.shape, points)
    if (bad) return fail(bad)
  }
  if (areaType && ctx.plan.purpose !== 'tenant_layout') return fail('Area types are for tenant layout plans only.')

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .update(shapePatchRow({ points, nodeId, areaType }))
    .eq('id', shapeId)
    .eq('updated_at', expectedUpdatedAt)
    .select(SHAPE_COLUMNS)
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'shape'))
  if (!data) return staleOrGone(supabase, shapeId)
  return { ok: true, data: toCanvasShape(data) }
}

export async function deleteStatusPlanShapeAction(input: { shapeId: string; expectedUpdatedAt: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ shapeId: uuid, expectedUpdatedAt: z.string().min(1) }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await shapeContext(supabase, parsed.data.shapeId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .delete()
    .eq('id', parsed.data.shapeId)
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select('id')
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'shape'))
  if (!data) return staleOrGone(supabase, parsed.data.shapeId)
  return { ok: true, data: { id: parsed.data.shapeId } }
}
```

- [ ] **Step 4: Run it, then the two repo-wide guards this file falls under**

```bash
pnpm --filter web test src/actions/status-plan.actions.test.ts
pnpm --filter web test src/lib/auth/role-gate-call-sites.contract.test.ts src/lib/auth/service-client-gates.contract.test.ts
```

Expected: PASS (21 tests), then both contract tests PASS (this file binds `gate` and reads `gate.ok`, and never names the service client).

- [ ] **Step 5: Mutation check**

Delete `.eq('updated_at', expectedUpdatedAt)` from the update. Re-run: "links a board…" must FAIL on the `updated_at` op. Restore. Then change `return gate.ok` to `return true`: "refuses a non-writer" must FAIL. Restore; PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/actions/status-plan.actions.ts apps/web/src/actions/status-plan.actions.test.ts
git commit -m "feat(status-plans): plan and shape server actions with stale-write refusal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The canvas page's props — `load-plan-page.ts`

**Files:**
- Create: `apps/web/src/lib/status-plans/load-plan-page.ts`
- Test: `apps/web/src/lib/status-plans/load-plan-page.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeClient, queued, opsOf, type FakeResponse } from './__fixtures__/fake-client'
import { jsonUnsafePath } from './json-safe'

const { requireEffectiveRoleMock, loadTenantShopFactsMock, loadProjectDbOrderStatusMock } = vi.hoisted(() => ({
  requireEffectiveRoleMock: vi.fn(),
  loadTenantShopFactsMock: vi.fn(),
  loadProjectDbOrderStatusMock: vi.fn(),
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a) }))
vi.mock('@/lib/tenant-schedule/shop-facts', () => ({ loadTenantShopFacts: (...a: unknown[]) => loadTenantShopFactsMock(...a) }))
vi.mock('@/lib/status-plans/project-db-orders', () => ({ loadProjectDbOrderStatus: (...a: unknown[]) => loadProjectDbOrderStatusMock(...a) }))

import { loadStatusPlanPage } from './load-plan-page'

const PLAN_ROW = {
  id: 'pl1', project_id: 'p1', organisation_id: 'org-1', floor_plan_id: 'fp1', page_index: 2, purpose: 'tenant_layout',
  name: 'Ground floor', source_file_path: 'org/p1/E-100 rev B.pdf', created_by: 'u', created_at: 't0', updated_at: 't1',
}
const SHAPE_ROW = {
  id: 's1', status_plan_id: 'pl1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260],
  node_id: 'n1', area_type: null, detected_tag: null, source: 'manual', created_by: 'u', created_at: 't0', updated_at: 't2',
}
const FACTS = {
  activeNodes: [{ id: 'n1', shopNumber: 'ZZ01', shopName: 'Lantern Books', glaM2: 80, breakerA: null, poleConfig: null, loadA: null }],
  decommissionedCount: 0,
  decommissionedNodeIds: [],
  scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
  detailsByNode: new Map([['n1', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }]]),
  orderStatusByNodeScope: new Map([['n1:tdb', 'received'], ['n1:tlt', 'received']]),
  boByNode: new Map([['n1', { effectiveDate: '2026-05-01' }]]),
}

function tables(o: Record<string, FakeResponse[]> = {}) {
  return {
    'tenants.status_plans:select': [{ data: PLAN_ROW }],
    'tenants.floor_plans:select': [{ data: { id: 'fp1', name: 'E-100 Ground', file_path: 'org/p1/E-100 rev C.pdf', width_px: null, height_px: null, pixels_per_meter: 20 } }],
    'tenants.floor_plan_page_scales:select': [{ data: [{ page_index: 2, pixels_per_meter: 31.5 }] }],
    'tenants.status_plan_shapes:select': [{ data: [SHAPE_ROW] }],
    'projects.projects:select': [{ data: { id: 'p1', organisation_id: 'org-1', opening_date: '2026-09-01' } }],
    'structure.nodes:select': [{ data: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shop_number: 'ZZ01', shop_name: 'Lantern Books', name: null, shop_area_m2: '80.00', status: 'active' }] }],
    ...o,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
  loadTenantShopFactsMock.mockResolvedValue(FACTS)
  loadProjectDbOrderStatusMock.mockResolvedValue({ m1: 'ordered' })
})

describe('loadStatusPlanPage', () => {
  it('assembles JSON-only props for a tenant layout', async () => {
    const { client, calls } = fakeClient(queued(tables()))
    const props = await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: 's1' })
    expect(props).not.toBeNull()
    expect(jsonUnsafePath(props)).toBeNull()
    expect(JSON.parse(JSON.stringify(props))).toEqual(props)

    expect(props!.plan).toEqual({ id: 'pl1', name: 'Ground floor', purpose: 'tenant_layout', pageIndex: 2, sourceFilePath: 'org/p1/E-100 rev B.pdf', updatedAt: 't1' })
    expect(props!.sheet).toMatchObject({
      floorPlanId: 'fp1', name: 'E-100 Ground', isPdf: true, currentFilePath: 'org/p1/E-100 rev C.pdf',
      signedUrl: 'https://signed.test/drawings/org/p1/E-100 rev C.pdf',
      pixels_per_meter: 20, page_scales: [{ pageIndex: 2, pixelsPerMeter: 31.5 }],
    })
    expect(props!.shapes.map((s) => s.id)).toEqual(['s1'])
    expect(props!.nodes).toEqual([{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 80, decommissioned: false }])
    expect(props!.shopLinks.n1).toEqual({ state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } })
    expect(props!.dbOrders).toEqual({})
    expect(props!.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(props!.canEdit).toBe(true)
    expect(props!.initialShapeId).toBe('s1')

    expect(opsOf(calls, 'structure.nodes')).toContainEqual(['eq', ['kind', 'tenant_db']])
    expect(opsOf(calls, 'structure.nodes')).toContainEqual(['is', ['deleted_at', null]])
    expect(loadTenantShopFactsMock).toHaveBeenCalledWith(client, { projectId: 'p1', orgId: 'org-1', openingDate: '2026-09-01' })
    expect(loadProjectDbOrderStatusMock).not.toHaveBeenCalled()
  })

  it('reads a schematic with every live node and DB orders, not tenant facts', async () => {
    const { client, calls } = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: { ...PLAN_ROW, purpose: 'distribution_schematic' } }] })))
    const props = await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null })
    expect(props!.dbOrders).toEqual({ m1: 'ordered' })
    expect(props!.shopLinks).toEqual({})
    expect(opsOf(calls, 'structure.nodes')).not.toContainEqual(['eq', ['kind', 'tenant_db']])
    expect(loadTenantShopFactsMock).not.toHaveBeenCalled()
  })

  it('a read-only role gets the same props with canEdit false', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const { client } = fakeClient(queued(tables()))
    expect((await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null }))!.canEdit).toBe(false)
  })

  it('a ?shape= that is not on this plan selects nothing', async () => {
    const { client } = fakeClient(queued(tables()))
    expect((await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: 'elsewhere' }))!.initialShapeId).toBeNull()
  })

  it('null (→ 404) when the plan is invisible or belongs to another project', async () => {
    const a = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: null }] })))
    expect(await loadStatusPlanPage(a.client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null })).toBeNull()
    const b = fakeClient(queued(tables()))
    expect(await loadStatusPlanPage(b.client, { projectId: 'other', planId: 'pl1', requestedShapeId: null })).toBeNull()
  })

  it('a drawing the canvas cannot render gets no signed URL', async () => {
    const { client } = fakeClient(queued(tables({
      'tenants.floor_plans:select': [{ data: { id: 'fp1', name: 'E-100', file_path: 'x/E-100.dwg', width_px: null, height_px: null, pixels_per_meter: null } }],
    })))
    expect((await loadStatusPlanPage(client, { projectId: 'p1', planId: 'pl1', requestedShapeId: null }))!.sheet.signedUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/load-plan-page.test.ts
```

Expected: FAIL with `Failed to resolve import "./load-plan-page"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Everything the status-plan canvas page needs, read through the CALLER'S
 * session: RLS and site scope (00238, 00245) are the read gate, so a plan the
 * caller may not see is simply absent and the page 404s. No service client.
 *
 * buildStatusPlanPageProps is the only place the props are assembled, and it
 * produces JSON only (checked in the test with jsonUnsafePath): page.tsx
 * spreads its result into one client component and adds nothing.
 */
import { ORG_WRITE_ROLES } from '@esite/shared'
import {
  statusPlanFromRow,
  type NodeOrderStatus,
  type ShopLink,
  type StatusPlan,
  type StatusPlanRow,
  type StatusPlanShapeRow,
} from '@esite/shared/status-plans'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { readAll } from '@/lib/tender/read-all'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import type { PageScaleRow } from '@/lib/sheet/page-scale'
import { shopLinkFor } from './shop-link'
import { loadProjectDbOrderStatus } from './project-db-orders'
import { SHAPE_COLUMNS, toCanvasShape } from './canvas-shape'
import { isPdfPath, isRenderableDrawing } from './plan-urls'
import type { CanvasShape, PlanNode, StatusPlanPageProps } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SIGNED_URL_SECONDS = 3600

export interface PlanPageRaw {
  projectId: string
  plan: StatusPlan
  drawing: { id: string; name: string; filePath: string; widthPx: number | null; heightPx: number | null; pixelsPerMeter: number | null }
  signedUrl: string | null
  pageScales: PageScaleRow[]
  shapes: CanvasShape[]
  nodes: PlanNode[]
  shopLinks: Record<string, ShopLink>
  dbOrders: Record<string, NodeOrderStatus>
  today: string
  canEdit: boolean
  requestedShapeId: string | null
}

export function buildStatusPlanPageProps(raw: PlanPageRaw): StatusPlanPageProps {
  return {
    projectId: raw.projectId,
    plan: {
      id: raw.plan.id,
      name: raw.plan.name,
      purpose: raw.plan.purpose,
      pageIndex: raw.plan.pageIndex,
      sourceFilePath: raw.plan.sourceFilePath,
      updatedAt: raw.plan.updatedAt,
    },
    sheet: {
      floorPlanId: raw.drawing.id,
      name: raw.drawing.name,
      signedUrl: raw.signedUrl,
      isPdf: isPdfPath(raw.drawing.filePath),
      widthPx: raw.drawing.widthPx,
      heightPx: raw.drawing.heightPx,
      currentFilePath: raw.drawing.filePath,
      pixels_per_meter: raw.drawing.pixelsPerMeter,
      page_scales: raw.pageScales,
    },
    shapes: raw.shapes,
    nodes: raw.nodes,
    shopLinks: raw.shopLinks,
    dbOrders: raw.dbOrders,
    today: raw.today,
    canEdit: raw.canEdit,
    initialShapeId: raw.requestedShapeId && raw.shapes.some((s) => s.id === raw.requestedShapeId) ? raw.requestedShapeId : null,
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export async function loadStatusPlanPage(
  client: unknown,
  args: { projectId: string; planId: string; requestedShapeId: string | null },
): Promise<StatusPlanPageProps | null> {
  const db = client as any

  const { data: planRow } = await db.schema('tenants').from('status_plans')
    .select('id, project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path, created_by, created_at, updated_at')
    .eq('id', args.planId).maybeSingle()
  if (!planRow || planRow.project_id !== args.projectId) return null
  const plan = statusPlanFromRow(planRow as StatusPlanRow)

  const { data: drawingRow } = await db.schema('tenants').from('floor_plans')
    .select('id, name, file_path, width_px, height_px, pixels_per_meter')
    .eq('id', plan.floorPlanId).maybeSingle()
  if (!drawingRow) return null
  const filePath = String(drawingRow.file_path ?? '')

  let signedUrl: string | null = null
  if (isRenderableDrawing(filePath)) {
    const { data } = await db.storage.from('drawings').createSignedUrl(filePath, SIGNED_URL_SECONDS)
    signedUrl = data?.signedUrl ?? null
  }

  const [scalesRes, shapesRes, projectRes] = await Promise.all([
    db.schema('tenants').from('floor_plan_page_scales').select('page_index, pixels_per_meter').eq('floor_plan_id', plan.floorPlanId),
    readAll<StatusPlanShapeRow>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS)
        .eq('status_plan_id', plan.id).order('created_at').order('id').range(from, to)),
    db.schema('projects').from('projects').select('id, organisation_id, opening_date').eq('id', args.projectId).maybeSingle(),
  ])
  if ('error' in shapesRes) throw new Error(`status plan shapes: ${shapesRes.error}`)
  if (!projectRes.data) return null
  const orgId = projectRes.data.organisation_id as string
  const openingDate = (projectRes.data.opening_date as string | null) ?? null

  const nodesRes = await readAll<any>((from, to) => {
    let q = db.schema('structure').from('nodes')
      .select('id, code, kind, shop_number, shop_name, name, shop_area_m2, status')
      .eq('project_id', args.projectId).is('deleted_at', null)
    if (plan.purpose === 'tenant_layout') q = q.eq('kind', 'tenant_db')
    return q.order('id').range(from, to)
  })
  if ('error' in nodesRes) throw new Error(`status plan nodes: ${nodesRes.error}`)
  const nodes: PlanNode[] = nodesRes.data.map((n) => ({
    id: n.id,
    code: n.code ?? '—',
    kind: n.kind,
    shopNumber: n.shop_number ?? null,
    shopName: n.shop_name ?? n.name ?? null,
    scheduledM2: num(n.shop_area_m2),
    decommissioned: n.status === 'decommissioned',
  }))

  let shopLinks: Record<string, ShopLink> = {}
  let dbOrders: Record<string, NodeOrderStatus> = {}
  if (plan.purpose === 'tenant_layout') {
    const facts = await loadTenantShopFacts(client, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries(nodes.map((n) => [n.id, shopLinkFor(facts, n.id)]))
  } else {
    dbOrders = await loadProjectDbOrderStatus(client, { projectId: args.projectId, orgId })
  }

  const gate = await requireEffectiveRole(db, args.projectId, ORG_WRITE_ROLES)

  return buildStatusPlanPageProps({
    projectId: args.projectId,
    plan,
    drawing: {
      id: drawingRow.id,
      name: drawingRow.name ?? 'Drawing',
      filePath,
      widthPx: num(drawingRow.width_px),
      heightPx: num(drawingRow.height_px),
      pixelsPerMeter: num(drawingRow.pixels_per_meter),
    },
    signedUrl,
    pageScales: ((scalesRes.data ?? []) as any[]).map((r) => ({ pageIndex: Number(r.page_index), pixelsPerMeter: Number(r.pixels_per_meter) })),
    shapes: shapesRes.data.map(toCanvasShape),
    nodes,
    shopLinks,
    dbOrders,
    today: new Date().toISOString().slice(0, 10),
    canEdit: gate.ok,
    requestedShapeId: args.requestedShapeId,
  })
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/load-plan-page.test.ts src/lib/auth
```

Expected: PASS (6 tests), and the auth contract tests stay green (`gate` is bound and `.ok` read).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/load-plan-page.ts apps/web/src/lib/status-plans/load-plan-page.test.ts
git commit -m "feat(status-plans): load JSON-only props for the plan canvas page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The list's data — `plan-list.ts`

**Files:**
- Create: `apps/web/src/lib/status-plans/plan-list.ts`
- Test: `apps/web/src/lib/status-plans/plan-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { planListRows, defaultPlanName, loadStatusPlanList } from './plan-list'

const PLANS = [
  { id: 'a', name: 'Ground', purpose: 'tenant_layout', page_index: 1, floor_plan_id: 'fp1', updated_at: '2026-10-09T10:00:00+00:00' },
  { id: 'b', name: '300 sheet 1', purpose: 'distribution_schematic', page_index: 1, floor_plan_id: 'fp-old', updated_at: '2026-10-08T10:00:00+00:00' },
]
const SHAPES = [
  { id: 's1', status_plan_id: 'a', node_id: 'n1', area_type: null },
  { id: 's2', status_plan_id: 'a', node_id: null, area_type: 'common' },
  { id: 's3', status_plan_id: 'a', node_id: null, area_type: null },
]

describe('planListRows', () => {
  it('counts shapes, linked shops and areas per plan, and names the drawing', () => {
    expect(planListRows(PLANS, [{ id: 'fp1', name: 'E-100 Ground' }], SHAPES)).toEqual([
      { id: 'a', name: 'Ground', purpose: 'tenant_layout', purposeLabel: 'Tenant layout', pageIndex: 1, drawingName: 'E-100 Ground', shapes: 3, linked: 1, areas: 1, updatedAt: '2026-10-09T10:00:00+00:00' },
      { id: 'b', name: '300 sheet 1', purpose: 'distribution_schematic', purposeLabel: 'Distribution schematic', pageIndex: 1, drawingName: 'Drawing not available', shapes: 0, linked: 0, areas: 0, updatedAt: '2026-10-08T10:00:00+00:00' },
    ])
  })
})

describe('defaultPlanName', () => {
  it('names by drawing and purpose, adding the page only past page 1', () => {
    expect(defaultPlanName('E-100 Ground', 'tenant_layout', 1)).toBe('E-100 Ground — Tenant layout')
    expect(defaultPlanName('643-E-300', 'distribution_schematic', 3)).toBe('643-E-300 — Distribution schematic (page 3)')
  })
  it('never exceeds the 120-character limit', () => {
    expect(defaultPlanName('x'.repeat(200), 'tenant_layout', 1).length).toBeLessThanOrEqual(120)
  })
})

describe('loadStatusPlanList', () => {
  it('reads plans, drawings and shapes for the project; offers active drawings only', async () => {
    const { client, calls } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: PLANS }],
      'tenants.floor_plans:select': [{ data: [
        { id: 'fp1', name: 'E-100 Ground', file_path: 'x/E-100.pdf', is_active: true },
        { id: 'fp2', name: 'Site DWG', file_path: 'x/site.dwg', is_active: true },
        { id: 'fp-old', name: 'Retired', file_path: 'x/old.pdf', is_active: false },
      ] }],
      'tenants.status_plan_shapes:select': [{ data: SHAPES }],
    }))
    const out = await loadStatusPlanList(client, 'p1')
    expect(out.rows.map((r) => [r.id, r.drawingName, r.shapes])).toEqual([['a', 'E-100 Ground', 3], ['b', 'Retired', 0]])
    expect(out.drawings).toEqual([
      { id: 'fp1', name: 'E-100 Ground', renderable: true },
      { id: 'fp2', name: 'Site DWG', renderable: false },
    ])
    expect(opsOf(calls, 'tenants.status_plans')).toContainEqual(['eq', ['project_id', 'p1']])
    expect(opsOf(calls, 'tenants.status_plan_shapes')).toContainEqual(['in', ['status_plan_id', ['a', 'b']]])
  })

  it('reads no shapes when there are no plans', async () => {
    const { client, calls } = fakeClient(queued({ 'tenants.status_plans:select': [{ data: [] }], 'tenants.floor_plans:select': [{ data: [] }] }))
    expect((await loadStatusPlanList(client, 'p1')).rows).toEqual([])
    expect(calls.map((c) => c.table)).not.toContain('tenants.status_plan_shapes')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/plan-list.test.ts
```

Expected: FAIL with `Failed to resolve import "./plan-list"`.

- [ ] **Step 3: Implement**

```ts
/**
 * The status plans list page: one row per plan with its drawing and counts,
 * and the drawings a new plan can be made on. Read through the caller's
 * session (RLS is the gate). Drawing names include retired drawings, because a
 * plan may still sit on one; the New-plan picker offers active drawings only.
 */
import { PURPOSE_LABEL, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'
import { isRenderableDrawing } from './plan-urls'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PlanListRow {
  id: string
  name: string
  purpose: StatusPlanPurpose
  purposeLabel: string
  pageIndex: number
  drawingName: string
  shapes: number
  linked: number
  areas: number
  updatedAt: string
}

export interface DrawingOption {
  id: string
  name: string
  /** PDF or image: the canvas can draw it. Others are listed, disabled. */
  renderable: boolean
}

type PlanRowIn = { id: string; name: string; purpose: string; page_index: number; floor_plan_id: string; updated_at: string }
type ShapeRowIn = { status_plan_id: string; node_id: string | null; area_type: string | null }

export function planListRows(
  plans: ReadonlyArray<PlanRowIn>,
  drawings: ReadonlyArray<{ id: string; name: string | null }>,
  shapes: ReadonlyArray<ShapeRowIn>,
): PlanListRow[] {
  const drawingName = new Map(drawings.map((d) => [d.id, d.name ?? 'Drawing']))
  const counts = new Map<string, { shapes: number; linked: number; areas: number }>()
  for (const s of shapes) {
    const c = counts.get(s.status_plan_id) ?? { shapes: 0, linked: 0, areas: 0 }
    c.shapes += 1
    if (s.node_id) c.linked += 1
    if (s.area_type) c.areas += 1
    counts.set(s.status_plan_id, c)
  }
  return plans.map((p) => {
    const purpose = p.purpose as StatusPlanPurpose
    const c = counts.get(p.id) ?? { shapes: 0, linked: 0, areas: 0 }
    return {
      id: p.id,
      name: p.name,
      purpose,
      purposeLabel: PURPOSE_LABEL[purpose] ?? p.purpose,
      pageIndex: Number(p.page_index),
      drawingName: drawingName.get(p.floor_plan_id) ?? 'Drawing not available',
      ...c,
      updatedAt: p.updated_at,
    }
  })
}

export function defaultPlanName(drawingName: string, purpose: StatusPlanPurpose, pageIndex: number): string {
  const suffix = ` — ${PURPOSE_LABEL[purpose]}${pageIndex > 1 ? ` (page ${pageIndex})` : ''}`
  return `${drawingName.slice(0, 120 - suffix.length)}${suffix}`
}

export async function loadStatusPlanList(client: unknown, projectId: string): Promise<{ rows: PlanListRow[]; drawings: DrawingOption[] }> {
  const db = client as any
  const [plansRes, drawingsRes] = await Promise.all([
    db.schema('tenants').from('status_plans')
      .select('id, name, purpose, page_index, floor_plan_id, updated_at')
      .eq('project_id', projectId).order('name'),
    readAll<{ id: string; name: string | null; file_path: string | null; is_active: boolean | null }>((from, to) =>
      db.schema('tenants').from('floor_plans').select('id, name, file_path, is_active')
        .eq('project_id', projectId).order('name').order('id').range(from, to)),
  ])
  if (plansRes.error) throw new Error(`status plans: ${plansRes.error.message}`)
  if ('error' in drawingsRes) throw new Error(`drawings: ${drawingsRes.error}`)
  const plans = (plansRes.data ?? []) as PlanRowIn[]

  let shapes: ShapeRowIn[] = []
  if (plans.length > 0) {
    const ids = plans.map((p) => p.id)
    const res = await readAll<ShapeRowIn>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select('id, status_plan_id, node_id, area_type')
        .in('status_plan_id', ids).order('id').range(from, to))
    if ('error' in res) throw new Error(`status plan shapes: ${res.error}`)
    shapes = res.data
  }

  return {
    rows: planListRows(plans, drawingsRes.data, shapes),
    drawings: drawingsRes.data
      .filter((d) => d.is_active !== false)
      .map((d) => ({ id: d.id, name: d.name ?? 'Drawing', renderable: isRenderableDrawing(String(d.file_path ?? '')) })),
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/plan-list.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/plan-list.ts apps/web/src/lib/status-plans/plan-list.test.ts
git commit -m "feat(status-plans): list rows, default plan names and the list loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The list page and the New-plan form

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.test.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/page.tsx`

- [ ] **Step 1: Write the failing form test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }))
const createStatusPlanAction = vi.fn()
vi.mock('@/actions/status-plan.actions', () => ({ createStatusPlanAction: (...a: unknown[]) => createStatusPlanAction(...a) }))

import { NewStatusPlanForm } from './NewStatusPlanForm'

const DRAWINGS = [
  { id: 'fp1', name: 'E-100 Ground', renderable: true },
  { id: 'fp2', name: 'Site DWG', renderable: false },
]

beforeEach(() => vi.clearAllMocks())

describe('NewStatusPlanForm', () => {
  it('walks drawing → page → purpose → name and opens the new plan', async () => {
    createStatusPlanAction.mockResolvedValue({ ok: true, data: { id: 'pl9' } })
    render(<NewStatusPlanForm projectId="p1" drawings={DRAWINGS} />)
    fireEvent.click(screen.getByRole('button', { name: /new status plan/i }))

    expect((screen.getByLabelText('Drawing') as HTMLSelectElement).value).toBe('fp1')
    expect(screen.getByRole('option', { name: /Site DWG/ })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText(/Distribution schematic/))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('E-100 Ground — Distribution schematic (page 2)')

    fireEvent.click(screen.getByRole('button', { name: /create plan/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p1/status-plans/pl9'))
    expect(createStatusPlanAction).toHaveBeenCalledWith({
      projectId: 'p1', floorPlanId: 'fp1', pageIndex: 2, purpose: 'distribution_schematic',
      name: 'E-100 Ground — Distribution schematic (page 2)',
    })
  })

  it("shows the action's sentence and stays open on a refusal", async () => {
    createStatusPlanAction.mockResolvedValue({ ok: false, error: 'This page of the drawing already has a plan for that purpose. Open the existing plan instead.' })
    render(<NewStatusPlanForm projectId="p1" drawings={DRAWINGS} />)
    fireEvent.click(screen.getByRole('button', { name: /new status plan/i }))
    fireEvent.click(screen.getByRole('button', { name: /create plan/i }))
    // No jest-dom in this repo (vitest.config.ts has no setupFiles): assert on textContent.
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has a plan/)
    expect(push).not.toHaveBeenCalled()
  })

  it('says what to do when no drawing can be drawn on', () => {
    render(<NewStatusPlanForm projectId="p1" drawings={[DRAWINGS[1]!]} />)
    fireEvent.click(screen.getByRole('button', { name: /new status plan/i }))
    expect(screen.getByText(/Upload a PDF or image drawing under Floor Plans first/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.test.tsx"
```

Expected: FAIL with `Failed to resolve import "./NewStatusPlanForm"`.

- [ ] **Step 3: Implement the form**

```tsx
'use client'

/**
 * "New status plan": pick drawing → page → purpose → name (spec §7).
 * The page number is typed, not picked: the PDF's page count is only known
 * once pdfjs opens it, and opening an A1 here would take 20-60 s. The canvas
 * says so if the page does not exist.
 */
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { PURPOSE_LABEL, STATUS_PLAN_PURPOSES, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { createStatusPlanAction } from '@/actions/status-plan.actions'
import { defaultPlanName, type DrawingOption } from '@/lib/status-plans/plan-list'
import { statusPlanHref } from '@/lib/status-plans/plan-urls'

const PURPOSE_HINT: Record<StatusPlanPurpose, string> = {
  tenant_layout: 'Mask each shop and area on an architectural tenant layout; shops colour by tenant progress.',
  distribution_schematic: 'Box each DB block on a 300-series schematic; blocks hatch by DB order status.',
}

export function NewStatusPlanForm({ projectId, drawings }: { projectId: string; drawings: DrawingOption[] }) {
  const router = useRouter()
  const usable = drawings.filter((d) => d.renderable)
  const [open, setOpen] = useState(false)
  const [drawingId, setDrawingId] = useState(usable[0]?.id ?? '')
  const [page, setPage] = useState('1')
  const [purpose, setPurpose] = useState<StatusPlanPurpose>('tenant_layout')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drawing = usable.find((d) => d.id === drawingId) ?? null
  const pageIndex = Number.parseInt(page, 10)
  const pageOk = Number.isInteger(pageIndex) && pageIndex >= 1
  const suggested = drawing ? defaultPlanName(drawing.name, purpose, pageOk ? pageIndex : 1) : ''
  const effectiveName = nameEdited ? name : suggested

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!drawing) { setError('Pick a drawing first.'); return }
    if (!pageOk) { setError('Enter a page number of 1 or more.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await createStatusPlanAction({ projectId, floorPlanId: drawing.id, pageIndex, purpose, name: effectiveName })
      if (!res.ok) { setError(res.error); return }
      router.push(statusPlanHref(projectId, res.data.id))
    } catch {
      setError('The server did not answer. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return <button type="button" className="btn-primary-amber" onClick={() => setOpen(true)}>+ New status plan</button>
  }

  if (usable.length === 0) {
    return (
      <div className="data-panel" style={{ padding: 12, fontSize: 13 }}>
        No drawing on this project can be shown here. Upload a PDF or image drawing under Floor Plans first.{' '}
        <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: 8 }}>Close</button>
      </div>
    )
  }

  const label = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 } as const
  return (
    <form onSubmit={submit} className="data-panel" style={{ padding: 14, display: 'grid', gap: 12, maxWidth: 560 }}>
      <div>
        <label htmlFor="sp-drawing" style={label}>Drawing</label>
        <select id="sp-drawing" className="ob-input" value={drawingId} onChange={(e) => setDrawingId(e.target.value)} style={{ width: '100%' }}>
          {drawings.map((d) => (
            <option key={d.id} value={d.id} disabled={!d.renderable}>
              {d.name}{d.renderable ? '' : ' (not a PDF or image)'}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="sp-page" style={label}>Page</label>
        <input id="sp-page" className="ob-input" type="number" min={1} step={1} value={page} onChange={(e) => setPage(e.target.value)} style={{ width: 120 }} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={label}>Purpose</legend>
        {STATUS_PLAN_PURPOSES.map((p) => (
          <label key={p} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, marginBottom: 6 }}>
            <input type="radio" name="sp-purpose" value={p} checked={purpose === p} onChange={() => setPurpose(p)} />
            <span>
              <strong>{PURPOSE_LABEL[p]}</strong>
              <span style={{ display: 'block', color: 'var(--c-text-dim)', fontSize: 12 }}>{PURPOSE_HINT[p]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="sp-name" style={label}>Name</label>
        <input
          id="sp-name"
          className="ob-input"
          value={effectiveName}
          maxLength={120}
          onChange={(e) => { setNameEdited(true); setName(e.target.value) }}
          style={{ width: '100%' }}
        />
      </div>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 12, margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn-primary-amber" disabled={saving}>{saving ? 'Creating…' : 'Create plan'}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run the form test**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.test.tsx"
```

Expected: PASS (3 tests).

- [ ] **Step 5: Write the list page**

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { loadStatusPlanList } from '@/lib/status-plans/plan-list'
import { statusPlanHref } from '@/lib/status-plans/plan-urls'
import { NewStatusPlanForm } from './NewStatusPlanForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Status plans' }

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Status plans for a project (spec 2026-10-09 §7). Every project role reads;
 * owner/admin/PM create. RLS is the read gate: the list is read through the
 * caller's session, so a role that may not see a plan never sees its row.
 */
export default async function StatusPlansPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: project } = await (supabase as any)
    .schema('projects').from('projects').select('id, name').eq('id', projectId).maybeSingle()
  if (!project) notFound()

  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  const canEdit = gate.ok
  const { rows, drawings } = await loadStatusPlanList(supabase, projectId)

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link href={`/projects/${projectId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          ← {project.name}
        </Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Status plans</h1>
          <p className="page-subtitle">
            Shops and DB blocks drawn over the project&apos;s drawings, coloured live from the tenant schedule.
          </p>
        </div>
      </div>

      {canEdit && (
        <div style={{ marginBottom: 16 }}>
          <NewStatusPlanForm projectId={projectId} drawings={drawings} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="data-panel" style={{ padding: 24, fontSize: 13, color: 'var(--c-text-mid)' }}>
          No status plans yet.{' '}
          {canEdit
            ? 'Press “New status plan”, pick the tenant layout drawing, and mask each shop.'
            : 'An owner, admin or project manager can create one.'}
        </div>
      ) : (
        <div className="data-panel" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)', fontSize: 11 }}>
                <th style={{ padding: '8px 12px' }}>Name</th>
                <th style={{ padding: '8px 12px' }}>Drawing</th>
                <th style={{ padding: '8px 12px' }}>Page</th>
                <th style={{ padding: '8px 12px' }}>Purpose</th>
                <th style={{ padding: '8px 12px' }}>Shapes</th>
                <th style={{ padding: '8px 12px' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <Link href={statusPlanHref(projectId, r.id)} style={{ fontWeight: 600 }}>{r.name}</Link>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{r.drawingName}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{r.pageIndex}</td>
                  <td style={{ padding: '8px 12px' }}>{r.purposeLabel}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                    {r.shapes}
                    <span style={{ color: 'var(--c-text-dim)' }}>
                      {' '}· {r.linked} linked{r.purpose === 'tenant_layout' ? ` · ${r.areas} areas` : ''}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--c-text-dim)' }}>{r.updatedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

Add `/* eslint-disable @typescript-eslint/no-explicit-any */` as the first line if the project's lint config flags the one `as any` (the tenant schedule page uses the same cast without it; follow whatever `pnpm --filter web lint` says in Task 21).

- [ ] **Step 6: Type-check and commit**

```bash
pnpm --filter web type-check
git add "apps/web/src/app/(admin)/projects/[id]/status-plans/page.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.test.tsx"
git commit -m "feat(status-plans): list page and the New status plan flow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `tsc` exits 0.

---

### Task 15: Side panel and legend components

Plain React (no Konva), so both get Testing Library tests.

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/ShapePanel.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/ShapePanel.test.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/PlanLegend.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/PlanLegend.test.tsx`

- [ ] **Step 1: Write the failing panel test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { resolveShapeView } from '@/lib/status-plans/shape-view'
import { buildNodeOptions } from '@/lib/status-plans/node-options'
import type { CanvasShape, PlanNode } from '@/lib/status-plans/types'
import { ShapePanel, type ShapePanelProps } from './ShapePanel'

const NODE: PlanNode = { id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 70, decommissioned: false }
const OTHER: PlanNode = { ...NODE, id: 'n2', code: 'DB-ZZ02', shopNumber: 'ZZ02', shopName: 'Copper Kettle' }
const SHAPE: CanvasShape = { id: 's1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], nodeId: 'n1', areaType: null, detectedTag: null, source: 'manual', updatedAt: 't' }
const OPEN = { state: 'active', facts: { scope: 'awaited', layoutIssued: false, db: 'ordered', lights: null, boDate: '2026-05-01' } } as const

function props(o: Partial<ShapePanelProps> = {}): ShapePanelProps {
  const view = resolveShapeView(SHAPE, {
    purpose: 'tenant_layout', nodesById: new Map([['n1', NODE]]), shopLinks: { n1: OPEN }, dbOrders: {}, today: '2026-06-20', pixelsPerMeter: 20,
  })
  return {
    purpose: 'tenant_layout', shape: SHAPE, view, node: NODE, link: OPEN,
    options: buildNodeOptions([NODE, OTHER], [SHAPE], 's1', 'tenant_layout'),
    canEdit: true, busy: false, deleteArmed: false, hasScale: true,
    onAssignNode: vi.fn(), onSetAreaType: vi.fn(), onUnassign: vi.fn(), onDelete: vi.fn(),
    ...o,
  }
}

describe('ShapePanel', () => {
  it('shows the shop, its status facts and the area check', () => {
    render(<ShapePanel {...props()} />)
    expect(screen.getByRole('heading', { name: /ZZ01/ })).toBeTruthy()
    expect(screen.getByText('In progress · overdue')).toBeTruthy()
    expect(screen.getByText('Awaited')).toBeTruthy()          // scope
    expect(screen.getByText('Ordered')).toBeTruthy()          // DB order
    expect(screen.getByText('No order yet')).toBeTruthy()     // lights
    expect(screen.getByText('80.0 m²')).toBeTruthy()
    expect(screen.getByText(/differs from the schedule by \+10\.0 m² \(\+14\.3 %\)/)).toBeTruthy()
  })

  it('assigns from the searchable list', () => {
    const onAssignNode = vi.fn()
    render(<ShapePanel {...props({ onAssignNode })} />)
    fireEvent.change(screen.getByLabelText(/find a shop/i), { target: { value: 'kettle' } })
    fireEvent.click(screen.getByRole('button', { name: /ZZ02 — Copper Kettle/ }))
    expect(onAssignNode).toHaveBeenCalledWith('n2')
  })

  it('a board used by another shape is listed but disabled with the reason', () => {
    const p = props({ options: buildNodeOptions([NODE, OTHER], [SHAPE, { ...SHAPE, id: 's2', nodeId: 'n2' }], 's1', 'tenant_layout') })
    render(<ShapePanel {...p} />)
    const btn = screen.getByRole('button', { name: /ZZ02 — Copper Kettle/ })
    expect(btn).toHaveProperty('disabled', true)
    expect(screen.getByText(/Already on this plan/)).toBeTruthy()
  })

  it('area types are offered on a tenant layout', () => {
    const onSetAreaType = vi.fn()
    render(<ShapePanel {...props({ onSetAreaType })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Plant / electrical room' }))
    expect(onSetAreaType).toHaveBeenCalledWith('plant_room')
  })

  it('delete reads as a two-step confirm', () => {
    const { rerender } = render(<ShapePanel {...props()} />)
    expect(screen.getByRole('button', { name: 'Delete shape' })).toBeTruthy()
    rerender(<ShapePanel {...props({ deleteArmed: true })} />)
    expect(screen.getByRole('button', { name: 'Press again to delete' })).toBeTruthy()
  })

  it('read-only: facts, no controls', () => {
    render(<ShapePanel {...props({ canEdit: false })} />)
    expect(screen.queryByLabelText(/find a shop/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete shape' })).toBeNull()
  })

  it('renders the extra slot (slice 3 seam) with or without a selection', () => {
    render(<ShapePanel {...props({ shape: null, view: null, node: null, link: null, extra: <p>detect here</p> })} />)
    expect(screen.getByText('detect here')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Write the failing legend test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { PlanLegend } from './PlanLegend'

/** The text of one legend row. No jest-dom here, so textContent, not toHaveTextContent. */
const legendRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Legend entries' })).getByText(label).closest('li')!.textContent

describe('PlanLegend', () => {
  const summary = { counts: { complete: 2, in_progress: 3, overdue: 1, decommissioned: 0, unlinked: 1, common: 1, plant_room: 0, services: 0, vacant: 0 }, totalM2: 1234.56, unmeasured: 0 }

  it('lists every tenant legend entry with its live count and the total area', () => {
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Complete')).toBe('Complete2')
    expect(legendRow('Overdue (past BO date)')).toBe('Overdue (past BO date)1')
    expect(screen.getByText(/Total measured: 1234\.6 m²/)).toBeTruthy()
  })

  it('without a scale says how to get one instead of a total', () => {
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale={false} attention={[]} onSelectShape={vi.fn()} />)
    expect(screen.getByText(/Set the page scale to measure areas/)).toBeTruthy()
  })

  it('needs-attention rows select their shape', () => {
    const onSelectShape = vi.fn()
    render(<PlanLegend purpose="tenant_layout" summary={summary} hasScale attention={[{ shapeId: 's9', label: 'ZZ09', reason: 'Area differs' }]} onSelectShape={onSelectShape} />)
    fireEvent.click(screen.getByRole('button', { name: /ZZ09/ }))
    expect(onSelectShape).toHaveBeenCalledWith('s9')
  })

  it('a schematic legend has the DB order entries and no area line', () => {
    render(<PlanLegend purpose="distribution_schematic" summary={{ counts: { required: 4 }, totalM2: 0, unmeasured: 0 }} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Required')).toBe('Required4')
    expect(screen.queryByText(/Total measured/)).toBeNull()
  })
})
```

- [ ] **Step 3: Run both and watch them fail**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/status-plans/[planId]/ShapePanel.test.tsx" "src/app/(admin)/projects/[id]/status-plans/[planId]/PlanLegend.test.tsx"
```

Expected: FAIL with `Failed to resolve import "./ShapePanel"` and `"./PlanLegend"`.

- [ ] **Step 4: Implement `ShapePanel.tsx`**

```tsx
'use client'

/**
 * The selected shape: what it is, how the shop stands, its measured vs
 * scheduled area, and (for writers) assign / area type / unassign / delete.
 * `extra` is the slice-3 seam: the schematic "Detect blocks" panel renders
 * there. Every rule this panel shows comes from shape-view / node-options.
 */
import { useState, type ReactNode } from 'react'
import { AREA_TYPES, AREA_TYPE_LABEL, type AreaType, type NodeOrderStatus, type ShopLink, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { filterNodeOptions, type NodeOption } from '@/lib/status-plans/node-options'
import { swatchCss, type ShapeView } from '@/lib/status-plans/shape-view'
import type { CanvasShape, PlanNode } from '@/lib/status-plans/types'

export interface ShapePanelProps {
  purpose: StatusPlanPurpose
  shape: CanvasShape | null
  view: ShapeView | null
  node: PlanNode | null
  link: ShopLink | null
  options: NodeOption[]
  canEdit: boolean
  busy: boolean
  /** The workspace's two-step delete is armed for this shape. */
  deleteArmed: boolean
  hasScale: boolean
  onAssignNode: (nodeId: string) => void
  onSetAreaType: (t: AreaType) => void
  onUnassign: () => void
  onDelete: () => void
  /** Slice 3 seam (schematic block detection). */
  extra?: ReactNode
}

const LIST_LIMIT = 40

const ORDER_LABEL: Record<NodeOrderStatus, string> = { required: 'Required', ordered: 'Ordered', received: 'Received', by_tenant: 'By tenant' }
const SCOPE_LABEL = { awaited: 'Awaited', received: 'Received', not_required: 'Not required' } as const

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: 'var(--c-text-dim)' }}>{k}</span>
      <span>{v}</span>
    </div>
  )
}

const signed = (v: number, unit: string) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}${unit}`

export function ShapePanel(p: ShapePanelProps) {
  const [query, setQuery] = useState('')

  if (!p.shape || !p.view) {
    return (
      <div className="data-panel" style={{ padding: 12, fontSize: 13, color: 'var(--c-text-mid)' }}>
        {p.canEdit
          ? p.purpose === 'tenant_layout'
            ? 'Select a shape to see its shop, or draw one with Polygon or Rectangle.'
            : 'Select a block to see its board, or draw one with Rectangle.'
          : 'Select a shape to see its shop.'}
        {p.extra}
      </div>
    )
  }

  const { view, shape } = p
  const facts = p.link?.state === 'active' ? p.link.facts : null
  const filtered = filterNodeOptions(p.options, query)

  return (
    <div className="data-panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 15 }}>{view.labelLines.filter((l) => !l.endsWith('m²')).join(' — ') || 'Shape'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12 }}>
          <span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, display: 'inline-block', ...swatchCss(view.style) }} />
          <span>{view.statusLabel}</span>
          {shape.source === 'detected' && <span style={{ color: 'var(--c-text-dim)' }}>· detected{shape.detectedTag ? ` (${shape.detectedTag})` : ''}</span>}
        </div>
      </div>

      {facts && (
        <div>
          <Row k="Scope" v={SCOPE_LABEL[facts.scope]} />
          <Row k="Layout" v={facts.layoutIssued ? 'Issued' : 'Not issued'} />
          <Row k="DB order" v={facts.db ? ORDER_LABEL[facts.db] : 'No order yet'} />
          <Row k="Lights order" v={facts.lights ? ORDER_LABEL[facts.lights] : 'No order yet'} />
          <Row k="BO date" v={facts.boDate ?? '—'} />
        </div>
      )}

      {p.purpose === 'tenant_layout' && (
        <div>
          <Row k="Measured" v={view.areaM2 !== null ? `${view.areaM2.toFixed(1)} m²` : p.hasScale ? '—' : '— (no scale on this page)'} />
          {p.node && <Row k="Scheduled" v={p.node.scheduledM2 !== null ? `${p.node.scheduledM2.toFixed(1)} m²` : '—'} />}
          {view.check?.state === 'differs' && view.check.deltaM2 !== null && view.check.deltaPct !== null && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-amber)' }}>
              Area differs from the schedule by {signed(view.check.deltaM2, ' m²')} ({signed(view.check.deltaPct, ' %')}).
            </p>
          )}
        </div>
      )}

      {p.canEdit && (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            {p.purpose === 'tenant_layout' ? 'Find a shop' : 'Find a board'}
            <input
              className="ob-input"
              aria-label={p.purpose === 'tenant_layout' ? 'Find a shop' : 'Find a board'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Number, name or code"
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
            {filtered.slice(0, LIST_LIMIT).map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={o.disabled || p.busy || o.id === shape.nodeId}
                  onClick={() => p.onAssignNode(o.id)}
                  style={{ width: '100%', textAlign: 'left', padding: '6px 8px', background: o.id === shape.nodeId ? 'var(--c-amber-mid)' : 'none', border: 0, borderBottom: '1px solid var(--c-border)', cursor: o.disabled ? 'not-allowed' : 'pointer', fontSize: 12 }}
                >
                  <span>{o.label}</span>
                  {(o.sub || o.reason) && (
                    <span style={{ display: 'block', color: 'var(--c-text-dim)', fontSize: 11 }}>
                      {[o.sub, o.reason].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li style={{ padding: 8, fontSize: 12, color: 'var(--c-text-dim)' }}>Nothing matches.</li>}
            {filtered.length > LIST_LIMIT && (
              <li style={{ padding: 8, fontSize: 12, color: 'var(--c-text-dim)' }}>{filtered.length - LIST_LIMIT} more — refine the search.</li>
            )}
          </ul>

          {p.purpose === 'tenant_layout' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {AREA_TYPES.map((t) => (
                <button key={t} type="button" disabled={p.busy || shape.areaType === t} onClick={() => p.onSetAreaType(t)} style={{ fontSize: 11, padding: '4px 8px' }}>
                  {AREA_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(shape.nodeId || shape.areaType) && (
              <button type="button" disabled={p.busy} onClick={p.onUnassign} style={{ fontSize: 12 }}>Unassign</button>
            )}
            <button
              type="button"
              disabled={p.busy}
              onClick={p.onDelete}
              style={{ fontSize: 12, color: '#dc2626', fontWeight: p.deleteArmed ? 700 : 400 }}
            >
              {p.deleteArmed ? 'Press again to delete' : 'Delete shape'}
            </button>
          </div>
        </div>
      )}

      {p.extra}
    </div>
  )
}
```

- [ ] **Step 5: Implement `PlanLegend.tsx`**

```tsx
'use client'

/** The plan's live legend: every entry with its count, total measured area, and what needs attention. */
import { SCHEMATIC_LEGEND, TENANT_LEGEND, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { swatchCss, type AttentionItem, type LegendSummary } from '@/lib/status-plans/shape-view'

export interface PlanLegendProps {
  purpose: StatusPlanPurpose
  summary: LegendSummary
  hasScale: boolean
  attention: AttentionItem[]
  onSelectShape: (shapeId: string) => void
}

export function PlanLegend({ purpose, summary, hasScale, attention, onSelectShape }: PlanLegendProps) {
  const legend = purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND
  return (
    <div className="data-panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 13 }}>Legend</h2>
      <ul aria-label="Legend entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {legend.map((e) => (
          <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span aria-hidden style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(e.style) }} />
            <span style={{ flex: 1 }}>{e.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{summary.counts[e.key] ?? 0}</span>
          </li>
        ))}
      </ul>
      {purpose === 'tenant_layout' && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-mid)' }}>
          {hasScale
            ? `Total measured: ${summary.totalM2.toFixed(1)} m²${summary.unmeasured ? ` (${summary.unmeasured} shape${summary.unmeasured === 1 ? '' : 's'} unmeasured)` : ''}`
            : 'Set the page scale to measure areas.'}
        </p>
      )}
      {attention.length > 0 && (
        <div>
          <h3 style={{ margin: '4px 0', fontSize: 12, color: 'var(--c-amber)' }}>Needs attention ({attention.length})</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {attention.map((a) => (
              <li key={a.shapeId}>
                <button type="button" onClick={() => onSelectShape(a.shapeId)} style={{ textAlign: 'left', fontSize: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                  <strong>{a.label}</strong> — {a.reason}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run both and watch them pass**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/status-plans/[planId]/ShapePanel.test.tsx" "src/app/(admin)/projects/[id]/status-plans/[planId]/PlanLegend.test.tsx"
```

Expected: PASS (7 + 4 tests).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/ShapePanel.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/ShapePanel.test.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/PlanLegend.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/PlanLegend.test.tsx"
git commit -m "feat(status-plans): shape side panel and live legend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The Konva canvas — `StatusPlanCanvas.tsx`

No component test: Konva is not testable in this repo's jsdom setup, which is why every rule it applies was built and tested in Tasks 8 and 10. This file only draws views and forwards input as `CanvasEvent`s. Study `cables/[revisionId]/measure/RouteCanvas.tsx` alongside it: sheet loading, viewport, pointer gating, the Stage drag-bubble guard and the calibration panel follow it line for line.

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanCanvas.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

/**
 * THE STATUS PLAN CANVAS — draws a drawing page with its shapes, coloured
 * from live facts, and turns pointer/keyboard input into CanvasEvents.
 *
 * It holds no rules. Styles, labels and areas arrive as ShapeViews
 * (lib/status-plans/shape-view); what a press, drag, double-click or key
 * means is canvas-reducer's. Writes go to the parent, which calls the
 * server actions and hands back the stored shapes.
 *
 * Sheet loading, zoom, pan and pinch come from lib/sheet, like the cable
 * measure page, so image space (PDF at scale 2) is the same everywhere.
 * Shapes are selected on MOUSEDOWN (Konva's click is not synthesised
 * reliably) and cancelBubble so a stage press always means empty canvas.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Shape } from 'react-konva'
import type Konva from 'konva'
import { hatchSegments, rectToPoints, visualCentre, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { calibrateFloorPlanAction } from '@/actions/cable-route.actions'
import { isPrimaryDrawPress, isTouchEvent } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { Tooltip } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/markup-tooltip'
import { useSheetImage, backingSize } from '@/lib/sheet/use-sheet-image'
import { useSheetViewport } from '@/lib/sheet/use-sheet-viewport'
import {
  canvasReducer,
  dragVertex,
  initialCanvasState,
  isIdle,
  type CanvasEvent,
  type CanvasState,
  type CanvasTool,
  type ShapeCommit,
} from '@/lib/status-plans/canvas-reducer'
import { fillRgba, type ShapeView } from '@/lib/status-plans/shape-view'
import type { CanvasShape, PlanSheet } from '@/lib/status-plans/types'

export interface StatusPlanCanvasProps {
  sheet: PlanSheet
  pageIndex: number
  purpose: StatusPlanPurpose
  shapes: CanvasShape[]
  views: Record<string, ShapeView>
  selectedId: string | null
  canEdit: boolean
  /** A write is in flight: editing pauses until it answers. */
  busy: boolean
  /** The workspace asks for a tool (e.g. "Set scale" from the no-scale banner). */
  requestedTool: { tool: CanvasTool; nonce: number } | null
  onSelect: (id: string | null) => void
  onCreate: (c: ShapeCommit) => Promise<{ error?: string }>
  onReshape: (shapeId: string, points: number[]) => Promise<{ error?: string }>
  /** Delete/Backspace on a selection: the workspace's two-step delete. */
  onDeleteRequest: () => void
  onCalibrated: (c: { pageIndex: number; pixelsPerMeter: number }) => void
  height?: string
}

/** Screen pixels within which a press counts as "on" a corner. */
const HIT_PX = 8
const SELECT_COLOUR = '#2563EB'

export function StatusPlanCanvas(p: StatusPlanCanvasProps) {
  const { sheet, pageIndex, purpose, shapes, views, selectedId, canEdit, busy } = p
  const drawTools: CanvasTool[] = purpose === 'tenant_layout' ? ['polygon', 'rect'] : ['rect']

  const [cs, setCs] = useState<CanvasState>(() => initialCanvasState('select'))
  const csRef = useRef(cs)
  csRef.current = cs
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<{ id: string; points: number[] } | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [calibMetres, setCalibMetres] = useState('')
  const [calibSaving, setCalibSaving] = useState(false)

  // ── The sheet (fixed page: a plan is one page of one drawing) ──────────────
  const { img, loadError, pageCount } = useSheetImage({
    planId: sheet.floorPlanId,
    signedUrl: sheet.signedUrl,
    isPdf: sheet.isPdf,
    initialPage: pageIndex,
  })
  const [imgW, imgH] = backingSize(img)
  const naturalW = sheet.widthPx || imgW || 800
  const naturalH = sheet.heightPx || imgH || 600
  const image = useMemo(() => (img ? { w: imgW, h: imgH } : null), [img, imgW, imgH])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const vp = useSheetViewport({ containerRef, image, resetKey: `${sheet.floorPlanId}:${pageIndex}` })
  const { scale, offset, viewport } = vp
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // ── Events into the reducer ────────────────────────────────────────────────
  function send(e: CanvasEvent) {
    const step = canvasReducer(csRef.current, e)
    if (step.state !== csRef.current) {
      csRef.current = step.state
      setCs(step.state)
    }
    if (step.commit) void commit(step.commit)
  }
  async function commit(c: ShapeCommit) {
    setLocalError(null)
    const res = await p.onCreate(c)
    if (res.error) setLocalError(res.error)
  }
  const tol = () => HIT_PX / scaleRef.current

  useEffect(() => {
    if (p.requestedTool) send({ type: 'tool', tool: p.requestedTool.tool })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.requestedTool?.nonce])

  function imagePos(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    return e.target.getStage()?.getRelativePointerPosition() ?? null
  }
  function onDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isPrimaryDrawPress(e.evt)) return
    if (vp.panningRef.current) return
    if (isTouchEvent(e.evt) && vp.touchCountRef.current > 1) return
    const pos = imagePos(e)
    if (!pos) return
    const tool = csRef.current.tool
    if (tool === 'select') { p.onSelect(null); return } // shapes cancelBubble their own press
    if (!canEdit || busy || tool === 'pan') return
    send({ type: 'press', x: pos.x, y: pos.y, tolPx: tol() })
  }
  function onMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const s = csRef.current
    if (!s.rect && !(s.tool === 'polygon' && s.draft.length > 0)) return
    const pos = imagePos(e)
    if (!pos) return
    if (s.rect) send({ type: 'move', x: pos.x, y: pos.y })
    else setHover(pos)
  }
  function onUp(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!csRef.current.rect) return
    const pos = imagePos(e)
    if (pos) send({ type: 'release', x: pos.x, y: pos.y, tolPx: tol() })
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const s = csRef.current
      if (e.key === 'Escape') {
        e.preventDefault()
        if (isIdle(s)) p.onSelect(null)
        else send({ type: 'escape' })
        return
      }
      if (e.key === 'Enter' && s.draft.length >= 6) { e.preventDefault(); send({ type: 'finish', tolPx: tol() }); return }
      if (e.key === 'Backspace' && s.draft.length > 0) { e.preventDefault(); send({ type: 'undoPoint' }); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && canEdit && !busy) {
        e.preventDefault()
        p.onDeleteRequest()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, canEdit, busy, p.onSelect, p.onDeleteRequest])

  // ── Derived drawing data (memoised: hatching 150 blocks is not free) ───────
  const drawn = useMemo(
    () => shapes.map((s) => (preview && preview.id === s.id ? { ...s, points: preview.points } : s)),
    [shapes, preview],
  )
  const hatchById = useMemo(() => {
    const m = new Map<string, Array<{ color: string; width: number; segs: number[][] }>>()
    for (const s of drawn) {
      const v = views[s.id]
      if (!v || v.style.hatches.length === 0) continue
      m.set(s.id, v.style.hatches.map((h) => ({
        color: h.color,
        width: h.width,
        segs: hatchSegments(s.points, { angleDeg: h.angleDeg, spacing: h.spacing }),
      })))
    }
    return m
  }, [drawn, views])
  const centreById = useMemo(() => new Map(drawn.map((s) => [s.id, visualCentre(s.points)])), [drawn])

  // ── Vertex drag (selected shape, Select tool, writers only) ────────────────
  const selected = drawn.find((s) => s.id === selectedId) ?? null
  const handlesEditable = canEdit && !busy && cs.tool === 'select'
  async function endDrag(index: number, e: Konva.KonvaEventObject<DragEvent>) {
    e.cancelBubble = true
    if (!selected) return
    const shape = shapes.find((s) => s.id === selected.id)
    if (!shape) return
    const pts = dragVertex(shape, index, e.target.x(), e.target.y())
    // Put the handle back where the props say it is; the preview (then the
    // stored shape) decides where it is drawn.
    e.target.position({ x: shape.points[index * 2]!, y: shape.points[index * 2 + 1]! })
    setPreview({ id: shape.id, points: pts })
    setLocalError(null)
    const res = await p.onReshape(shape.id, pts)
    if (res.error) setLocalError(res.error)
    setPreview(null)
  }

  // ── Calibration (through the role-gated action, this page only) ────────────
  async function saveCalibration() {
    const c = cs.calib
    if (c.length !== 4) { setLocalError('Pick two points first.'); return }
    const metres = Number.parseFloat(calibMetres)
    if (!(metres > 0)) { setLocalError('Enter a positive distance in metres.'); return }
    const px = Math.hypot(c[2]! - c[0]!, c[3]! - c[1]!)
    if (px < 4) { setLocalError('The two points are too close together.'); return }
    setCalibSaving(true)
    setLocalError(null)
    try {
      const res = await calibrateFloorPlanAction({ floorPlanId: sheet.floorPlanId, points: c, realMetres: metres, pageIndex })
      if (res.error) { setLocalError(res.error); return }
      p.onCalibrated({ pageIndex, pixelsPerMeter: res.pixelsPerMeter ?? px / metres })
      setCalibMetres('')
      send({ type: 'tool', tool: 'select' })
    } catch {
      setLocalError('The server did not answer. Check your connection and try again.')
    } finally {
      setCalibSaving(false)
    }
  }

  const hint =
    cs.tool === 'polygon' ? (cs.draft.length ? `${cs.draft.length / 2} corners — click the first corner, double-click or Enter to finish; Backspace removes the last` : 'Click each corner of the shop')
    : cs.tool === 'rect' ? 'Drag a rectangle over the shop or DB block'
    : cs.tool === 'pan' ? 'Drag to move the drawing'
    : cs.tool === 'calibrate' ? 'Click two points whose real distance you know'
    : canEdit ? 'Press a shape to select it; drag its corners to reshape' : 'Press a shape to see its shop'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="data-panel" style={{ padding: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <TbButton active={cs.tool === 'select'} onClick={() => send({ type: 'tool', tool: 'select' })} title="Select (Esc deselects)">↖ Select</TbButton>
          {canEdit && drawTools.includes('polygon') && (
            <TbButton active={cs.tool === 'polygon'} disabled={busy} onClick={() => send({ type: 'tool', tool: 'polygon' })} title="Polygon: click corners, double-click or Enter to finish">⬠ Polygon</TbButton>
          )}
          {canEdit && (
            <TbButton active={cs.tool === 'rect'} disabled={busy} onClick={() => send({ type: 'tool', tool: 'rect' })} title="Rectangle: drag">▭ Rectangle</TbButton>
          )}
          <TbButton active={cs.tool === 'pan'} onClick={() => send({ type: 'tool', tool: 'pan' })} title="Pan (or hold Space, or middle-drag)">✋ Pan</TbButton>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <TbButton onClick={vp.zoomOut} title="Zoom out (-)">−</TbButton>
          <TbButton onClick={vp.fitToView} title="Fit to view (F)">⤢</TbButton>
          <TbButton onClick={vp.zoomIn} title="Zoom in (+)">+</TbButton>
          <span style={{ minWidth: 44, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }} aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-mid)' }}>Page {pageIndex}</span>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{hint}</span>
      </div>

      {cs.tool === 'calibrate' && (
        <div className="data-panel" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {cs.calib.length < 4 ? (
            <span style={{ fontSize: 13 }}>Click two points on page {pageIndex} whose real distance you know{cs.calib.length === 2 ? ' (one more)' : ''}.</span>
          ) : (
            <>
              <input type="number" step="0.01" className="ob-input" value={calibMetres} onChange={(e) => setCalibMetres(e.target.value)} placeholder="metres" aria-label="Real distance in metres" style={{ width: 120 }} />
              <button type="button" className="btn-primary-amber" disabled={calibSaving} onClick={() => void saveCalibration()}>
                {calibSaving ? 'Saving…' : 'Save scale'}
              </button>
            </>
          )}
          <button type="button" onClick={() => send({ type: 'tool', tool: 'select' })}>Cancel</button>
        </div>
      )}

      {localError && <div role="alert" className="data-panel" style={{ padding: '8px 12px', color: '#dc2626', fontSize: 12 }}>{localError}</div>}
      {img && pageCount < pageIndex && (
        <div role="alert" className="data-panel" style={{ padding: '8px 12px', fontSize: 12 }}>
          This drawing has {pageCount} page{pageCount === 1 ? '' : 's'}; the plan is on page {pageIndex}. The drawing may have been replaced with a shorter file.
        </div>
      )}

      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: p.height ?? '70vh', background: 'var(--c-base)', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden', touchAction: 'none', WebkitUserSelect: 'none' }}
      >
        {!sheet.signedUrl ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>This drawing cannot be shown here. Status plans need a PDF or image drawing.</div>
        ) : loadError ? (
          <div role="alert" style={{ padding: 48, textAlign: 'center', color: '#dc2626' }}>{loadError}</div>
        ) : !img ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>{sheet.isPdf ? 'Rendering PDF…' : 'Loading drawing…'}</div>
        ) : (
          <Stage
            width={viewport.w}
            height={viewport.h}
            scaleX={scale}
            scaleY={scale}
            x={offset.x}
            y={offset.y}
            draggable={(cs.tool === 'select' || cs.tool === 'pan') && !vp.gestureActive}
            onDragEnd={(e) => {
              // Drag events BUBBLE: a dragged handle would otherwise write its
              // image coordinates into the pan offset.
              if (e.target !== e.target.getStage()) return
              vp.setOffsetFromStage({ x: e.target.x(), y: e.target.y() })
            }}
            onMouseDown={onDown}
            onTouchStart={onDown}
            onMouseMove={onMove}
            onTouchMove={onMove}
            onMouseUp={onUp}
            onTouchEnd={onUp}
            onDblClick={cs.tool === 'polygon' ? () => send({ type: 'finish', tolPx: tol() }) : cs.tool === 'select' ? vp.fitToView : undefined}
            onDblTap={cs.tool === 'polygon' ? () => send({ type: 'finish', tolPx: tol() }) : undefined}
            style={{ cursor: vp.panning || vp.gestureActive ? 'grabbing' : cs.tool === 'pan' || vp.spaceHeld ? 'grab' : cs.tool === 'select' ? 'default' : 'crosshair', background: 'white' }}
          >
            <Layer listening={false}>
              <KonvaImage image={img} width={naturalW} height={naturalH} />
            </Layer>

            {/* Shapes: listening only in Select, so a drawing tool's press reaches the stage. */}
            <Layer listening={cs.tool === 'select'}>
              {drawn.map((s) => {
                const v = views[s.id]
                if (!v) return null
                const select = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
                  if (!isPrimaryDrawPress(e.evt)) return
                  e.cancelBubble = true
                  p.onSelect(s.id)
                }
                return (
                  <Line
                    key={s.id}
                    points={s.points}
                    closed
                    fill={fillRgba(v.style)}
                    stroke={v.style.stroke}
                    strokeWidth={v.style.strokeWidth / scale}
                    dash={v.style.dash ? v.style.dash.map((d) => d / scale) : undefined}
                    onMouseDown={select}
                    onTouchStart={select}
                  />
                )
              })}
            </Layer>

            <Layer listening={false}>
              {drawn.map((s) => {
                const groups = hatchById.get(s.id)
                return groups?.map((g, i) => (
                  <Shape
                    key={`${s.id}:h${i}`}
                    stroke={g.color}
                    strokeWidth={g.width / scale}
                    sceneFunc={(ctx, shape) => {
                      ctx.beginPath()
                      for (const seg of g.segs) {
                        ctx.moveTo(seg[0]!, seg[1]!)
                        ctx.lineTo(seg[2]!, seg[3]!)
                      }
                      ctx.strokeShape(shape)
                    }}
                  />
                ))
              })}
              {drawn.map((s) => {
                const v = views[s.id]
                const c = centreById.get(s.id)
                if (!v || !c) return null
                const fontSize = 12 / scale
                const width = 180 / scale
                return (
                  <Text
                    key={`${s.id}:label`}
                    x={c.x - width / 2}
                    y={c.y - (v.labelLines.length * fontSize * 1.2) / 2}
                    width={width}
                    align="center"
                    text={v.labelLines.join('\n')}
                    fontSize={fontSize}
                    lineHeight={1.2}
                    fill="#111827"
                    stroke="white"
                    strokeWidth={3 / scale}
                    fillAfterStrokeEnabled
                    textDecoration={v.style.strikeLabel ? 'line-through' : ''}
                  />
                )
              })}
              {selected && (
                <Line points={selected.points} closed stroke={SELECT_COLOUR} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
              )}
              {/* Drafts */}
              {cs.draft.length > 0 && (
                <>
                  <Line points={hover ? [...cs.draft, hover.x, hover.y] : cs.draft} stroke={SELECT_COLOUR} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
                  {Array.from({ length: cs.draft.length / 2 }, (_, i) => (
                    <Circle key={i} x={cs.draft[i * 2]} y={cs.draft[i * 2 + 1]} radius={(i === 0 && cs.draft.length >= 6 ? 7 : 4) / scale} fill={i === 0 ? SELECT_COLOUR : 'white'} stroke={SELECT_COLOUR} strokeWidth={1.5 / scale} />
                  ))}
                </>
              )}
              {cs.rect && (
                <Line points={rectToPoints(cs.rect.x0, cs.rect.y0, cs.rect.x1, cs.rect.y1)} closed stroke={SELECT_COLOUR} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
              )}
              {cs.tool === 'calibrate' && cs.calib.length >= 2 && (
                <>
                  <Circle x={cs.calib[0]} y={cs.calib[1]} radius={6 / scale} fill="#f59e0b" stroke="white" strokeWidth={2 / scale} />
                  {cs.calib.length === 4 && (
                    <>
                      <Circle x={cs.calib[2]} y={cs.calib[3]} radius={6 / scale} fill="#f59e0b" stroke="white" strokeWidth={2 / scale} />
                      <Line points={cs.calib} stroke="#f59e0b" strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
                    </>
                  )}
                </>
              )}
            </Layer>

            {/* Corner handles: their own listening layer, above everything. */}
            {selected && handlesEditable && (
              <Layer>
                {Array.from({ length: selected.points.length / 2 }, (_, i) => (
                  <Circle
                    key={i}
                    x={shapes.find((s) => s.id === selected.id)!.points[i * 2]}
                    y={shapes.find((s) => s.id === selected.id)!.points[i * 2 + 1]}
                    radius={6 / scale}
                    fill="white"
                    stroke={SELECT_COLOUR}
                    strokeWidth={2 / scale}
                    draggable
                    onMouseDown={(e) => { e.cancelBubble = true }}
                    onTouchStart={(e) => { e.cancelBubble = true }}
                    onDragMove={(e) => {
                      const shape = shapes.find((s) => s.id === selected.id)
                      if (shape) setPreview({ id: shape.id, points: dragVertex(shape, i, e.target.x(), e.target.y()) })
                    }}
                    onDragEnd={(e) => void endDrag(i, e)}
                  />
                ))}
              </Layer>
            )}
          </Stage>
        )}
      </div>
    </div>
  )
}

function TbButton({ children, active, disabled, onClick, title }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void; title?: string }) {
  return (
    <Tooltip label={title ?? ''}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        aria-pressed={active}
        style={{
          minWidth: 30, height: 30, padding: '0 8px',
          background: active ? 'var(--c-amber-mid)' : 'var(--c-panel)',
          color: active ? 'var(--c-amber)' : disabled ? 'var(--c-text-dim)' : 'var(--c-text-mid)',
          border: '1px solid var(--c-border)', borderRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12, opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}
```

- [ ] **Step 2: Type-check and lint the file**

```bash
pnpm --filter web type-check
pnpm --filter web exec eslint "src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanCanvas.tsx"
```

Expected: both exit 0. If `tsc` reports that `isPrimaryDrawPress` / `isTouchEvent` want a different argument type, pass `e.evt` exactly as `RouteCanvas.tsx` does (they accept the same `PressLike`). If `Text` rejects `fillAfterStrokeEnabled`, the installed Konva predates it: remove that prop and the white `stroke`, and add a `shadowColor="white" shadowBlur={2 / scale}` instead.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanCanvas.tsx"
git commit -m "feat(status-plans): Konva canvas (select, polygon, rectangle, pan, vertex drag, scale)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The workspace, the canvas page, and the JSON contract

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanWorkspace.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanWorkspace.test.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx`
- Create: `apps/web/src/lib/status-plans/page-props.contract.test.ts`

- [ ] **Step 1: Write the failing workspace test**

The canvas is stubbed through `next/dynamic` (the measure page's pattern). The stub exposes buttons that call the props the real canvas would call, so the workspace's wiring is what is under test.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { StatusPlanPageProps, CanvasShape } from '@/lib/status-plans/types'

// No jest-dom in this repo (vitest.config.ts has no setupFiles): assert on textContent.
const legendRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Legend entries' })).getByText(label).closest('li')!.textContent
const canvasText = () => screen.getByTestId('canvas').textContent ?? ''

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }))
vi.mock('next/dynamic', () => ({
  default: () => (props: { shapes: CanvasShape[]; selectedId: string | null; onSelect: (id: string | null) => void; onCreate: (c: unknown) => void; onDeleteRequest: () => void; requestedTool: { tool: string } | null }) => (
    <div data-testid="canvas">
      shapes:{props.shapes.length} selected:{props.selectedId ?? 'none'} tool:{props.requestedTool?.tool ?? 'none'}
      <button onClick={() => props.onSelect('s1')}>stub-select-s1</button>
      <button onClick={() => props.onCreate({ shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10] })}>stub-create</button>
      <button onClick={() => props.onDeleteRequest()}>stub-delete-key</button>
    </div>
  ),
}))
const actions = vi.hoisted(() => ({
  createStatusPlanShapeAction: vi.fn(),
  updateStatusPlanShapeAction: vi.fn(),
  deleteStatusPlanShapeAction: vi.fn(),
  renameStatusPlanAction: vi.fn(),
  deleteStatusPlanAction: vi.fn(),
  reanchorStatusPlanAction: vi.fn(),
}))
vi.mock('@/actions/status-plan.actions', () => actions)

import { StatusPlanWorkspace } from './StatusPlanWorkspace'

const SHAPE: CanvasShape = { id: 's1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], nodeId: null, areaType: null, detectedTag: null, source: 'manual', updatedAt: 't1' }

function props(o: Partial<StatusPlanPageProps> = {}): StatusPlanPageProps {
  return {
    projectId: 'p1',
    plan: { id: 'pl1', name: 'Ground floor', purpose: 'tenant_layout', pageIndex: 1, sourceFilePath: 'x/E-100.pdf', updatedAt: 't0' },
    sheet: { floorPlanId: 'fp1', name: 'E-100', signedUrl: 'https://s/x', isPdf: true, widthPx: null, heightPx: null, currentFilePath: 'x/E-100.pdf', pixels_per_meter: 20, page_scales: [] },
    shapes: [SHAPE],
    nodes: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 80, decommissioned: false }],
    shopLinks: { n1: { state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } } },
    dbOrders: {},
    today: '2026-06-20',
    canEdit: true,
    initialShapeId: null,
    ...o,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('StatusPlanWorkspace', () => {
  it('shows the legend counts from live facts', () => {
    render(<StatusPlanWorkspace {...props()} />)
    expect(legendRow('Unassigned')).toBe('Unassigned1')
    expect(legendRow('Complete')).toBe('Complete0')
  })

  it('assigning a shop folds the stored shape into state, with no refresh', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, nodeId: 'n1', updatedAt: 't2' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    await waitFor(() => expect(legendRow('Complete')).toBe('Complete1'))
    expect(actions.updateStatusPlanShapeAction).toHaveBeenCalledWith({ shapeId: 's1', expectedUpdatedAt: 't1', nodeId: 'n1' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('a conflict shows the sentence and a Reload button', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: false, error: 'This shape was changed by someone else — reload to see it.', conflict: true })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    expect(await screen.findByText(/changed by someone else/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('deleting a shape takes two presses (Delete key arms, panel confirms)', async () => {
    actions.deleteStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { id: 's1' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByText('stub-delete-key'))
    expect(actions.deleteStatusPlanShapeAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Press again to delete' }))
    await waitFor(() => expect(canvasText()).toContain('shapes:0'))
    expect(actions.deleteStatusPlanShapeAction).toHaveBeenCalledWith({ shapeId: 's1', expectedUpdatedAt: 't1' })
  })

  it('a created shape is added and selected', async () => {
    actions.createStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, id: 's2' } })
    render(<StatusPlanWorkspace {...props()} />)
    await act(async () => { fireEvent.click(screen.getByText('stub-create')) })
    expect(canvasText()).toMatch(/shapes:2\s+selected:s2/)
  })

  it('warns when the drawing file changed since the plan was drawn, and re-anchors on request', async () => {
    actions.reanchorStatusPlanAction.mockResolvedValue({ ok: true, data: { sourceFilePath: 'x/E-100 rev C.pdf' } })
    render(<StatusPlanWorkspace {...props({ sheet: { ...props().sheet, currentFilePath: 'x/E-100 rev C.pdf' } })} />)
    expect(screen.getByText(/E-100\.pdf/)).toBeTruthy()
    expect(screen.getByText(/E-100 rev C\.pdf/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /shapes checked/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /shapes checked/i })).toBeNull())
  })

  it('no scale: banner, and "Set scale" asks the canvas for the calibrate tool', () => {
    render(<StatusPlanWorkspace {...props({ sheet: { ...props().sheet, pixels_per_meter: null } })} />)
    expect(screen.getByText(/Calibrate this page on the drawing to measure areas/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set scale' }))
    expect(canvasText()).toContain('tool:calibrate')
  })

  it('a schematic plan shows the detection seam and no scale banner', () => {
    render(<StatusPlanWorkspace {...props({ plan: { ...props().plan, purpose: 'distribution_schematic' }, shopLinks: {}, sheet: { ...props().sheet, pixels_per_meter: null } })} />)
    expect(screen.getByText(/Automatic block detection is not available yet/)).toBeTruthy()
    expect(screen.queryByText(/Calibrate this page/)).toBeNull()
  })

  it('read-only: no rename, no delete plan, no Set scale', () => {
    render(<StatusPlanWorkspace {...props({ canEdit: false, sheet: { ...props().sheet, pixels_per_meter: null } })} />)
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete plan/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
  })

  it('selection is mirrored to ?shape= without a navigation', () => {
    const spy = vi.spyOn(window.history, 'replaceState')
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    // history.state may be null in jsdom, so only the URL argument is asserted.
    expect(spy.mock.calls.at(-1)?.[2]).toBe('/projects/p1/status-plans/pl1?shape=s1')
    expect(push).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Write the failing source-level contract test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/**
 * PAGE → CLIENT PROPS MUST BE JSON. A function passed from a page.tsx to a
 * 'use client' component passes tsc AND next build and fails only at render
 * (PR #201). The runtime half of this guard is load-plan-page.test.ts
 * (jsonUnsafePath on the assembled props); this half reads the two pages and
 * fails if any client component they render is handed an arrow function,
 * a function expression or a server action by name.
 */
const ROUTE = resolve(__dirname, '../../app/(admin)/projects/[id]/status-plans')
const PAGES = [resolve(ROUTE, 'page.tsx'), resolve(ROUTE, '[planId]/page.tsx')]

function clientComponents(src: string, dir: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'(\.[^']+)'/g)) {
    const base = resolve(dir, m[2]!)
    const file = ['.tsx', '.ts'].map((e) => base + e).find((f) => existsSync(f))
    if (!file || !/^\s*['"]use client['"]/.test(readFileSync(file, 'utf8'))) continue
    out.push(...m[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean))
  }
  return out
}

/** Every opening tag of <Name …>, braces respected, so `=>` inside {} does not end it. */
function openingTags(src: string, name: string): string[] {
  const tags: string[] = []
  const re = new RegExp(`<${name}\\b`, 'g')
  for (const m of src.matchAll(re)) {
    let depth = 0
    let j = m.index! + name.length + 1
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(src.slice(m.index!, j + 1))
  }
  return tags
}

describe('status plan pages hand their client components JSON only', () => {
  for (const page of PAGES) {
    it(page.slice(ROUTE.length) || '/page.tsx', () => {
      const src = readFileSync(page, 'utf8')
      const names = clientComponents(src, dirname(page))
      expect(names.length, 'expected the page to render a client component').toBeGreaterThan(0)
      for (const n of names) {
        const tags = openingTags(src, n)
        expect(tags.length, `${n} is imported but never rendered`).toBeGreaterThan(0)
        for (const tag of tags) expect(tag, `${n} receives a function`).not.toMatch(/=>|\bfunction\b|Action\b/)
      }
    })
  }

  it('the canvas page spreads the assembled props and adds nothing', () => {
    expect(openingTags(readFileSync(PAGES[1]!, 'utf8'), 'StatusPlanWorkspace')).toEqual(['<StatusPlanWorkspace {...props} />'])
  })
})
```

- [ ] **Step 3: Run both and watch them fail**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanWorkspace.test.tsx" src/lib/status-plans/page-props.contract.test.ts
```

Expected: FAIL — `Failed to resolve import "./StatusPlanWorkspace"`, and the contract test fails with `ENOENT … [planId]/page.tsx`.

- [ ] **Step 4: Implement the workspace**

```tsx
'use client'

/**
 * The status plan page's client side: state, writes, banners and layout.
 *
 * Every write is a per-shape server action whose result is FOLDED INTO LOCAL
 * STATE. There is no router.refresh(): it would re-render the server page
 * under the canvas and re-mint the drawing's signed URL. Selection is
 * mirrored to ?shape= with history.replaceState (no server round trip), so a
 * link from the tenant schedule and a reload land on the same shape.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PURPOSE_LABEL, type AreaType } from '@esite/shared/status-plans'
import {
  createStatusPlanShapeAction,
  deleteStatusPlanAction,
  deleteStatusPlanShapeAction,
  reanchorStatusPlanAction,
  renameStatusPlanAction,
  updateStatusPlanShapeAction,
} from '@/actions/status-plan.actions'
import { pageScaleFor, withPageScale } from '@/lib/sheet/page-scale'
import { legendSummary, needsAttention, resolveShapeView, type ShapeView } from '@/lib/status-plans/shape-view'
import { buildNodeOptions } from '@/lib/status-plans/node-options'
import { fileLabel, statusPlanHref, statusPlansHref } from '@/lib/status-plans/plan-urls'
import type { CanvasTool, ShapeCommit } from '@/lib/status-plans/canvas-reducer'
import type { ActionResult, CanvasShape, PlanSheet, StatusPlanPageProps } from '@/lib/status-plans/types'
import { ShapePanel } from './ShapePanel'
import { PlanLegend } from './PlanLegend'

const StatusPlanCanvas = dynamic(() => import('./StatusPlanCanvas').then((m) => m.StatusPlanCanvas), {
  ssr: false,
  loading: () => <div className="data-panel" style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>Loading the drawing…</div>,
})

const ARM_MS = 4000
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function StatusPlanWorkspace(props: StatusPlanPageProps) {
  const { projectId, plan, canEdit, today } = props
  const purpose = plan.purpose
  const router = useRouter()

  const [shapes, setShapes] = useState<CanvasShape[]>(props.shapes)
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const [sheet, setSheet] = useState<PlanSheet>(props.sheet)
  const [planName, setPlanName] = useState(plan.name)
  const [sourceFilePath, setSourceFilePath] = useState(plan.sourceFilePath)
  const [selectedId, setSelectedId] = useState<string | null>(props.initialShapeId)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; conflict: boolean } | null>(null)
  const [armedShape, setArmedShape] = useState<string | null>(null)
  const [armedPlan, setArmedPlan] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(plan.name)
  const [requestedTool, setRequestedTool] = useState<{ tool: CanvasTool; nonce: number } | null>(null)

  useEffect(() => {
    if (!armedShape) return
    const t = setTimeout(() => setArmedShape(null), ARM_MS)
    return () => clearTimeout(t)
  }, [armedShape])
  useEffect(() => {
    if (!armedPlan) return
    const t = setTimeout(() => setArmedPlan(false), ARM_MS)
    return () => clearTimeout(t)
  }, [armedPlan])

  // ?shape= mirrors the selection without a navigation.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', statusPlanHref(projectId, plan.id, selectedId))
    } catch {
      /* a sandboxed frame may refuse; the selection still works */
    }
  }, [projectId, plan.id, selectedId])

  // ── Derived ──────────────────────────────────────────────────────────────
  const nodesById = useMemo(() => new Map(props.nodes.map((n) => [n.id, n])), [props.nodes])
  const pixelsPerMeter = pageScaleFor(sheet, plan.pageIndex)
  const views = useMemo(() => {
    const ctx = { purpose, nodesById, shopLinks: props.shopLinks, dbOrders: props.dbOrders, today, pixelsPerMeter }
    const out: Record<string, ShapeView> = {}
    for (const s of shapes) out[s.id] = resolveShapeView(s, ctx)
    return out
  }, [shapes, purpose, nodesById, props.shopLinks, props.dbOrders, today, pixelsPerMeter])
  const summary = useMemo(() => legendSummary(Object.values(views), purpose), [views, purpose])
  const attention = useMemo(() => needsAttention(shapes, views), [shapes, views])
  const selected = shapes.find((s) => s.id === selectedId) ?? null
  const options = useMemo(() => buildNodeOptions(props.nodes, shapes, selectedId, purpose), [props.nodes, shapes, selectedId, purpose])
  const drawingChanged = sheet.currentFilePath !== sourceFilePath

  // ── Writes ───────────────────────────────────────────────────────────────
  async function run<T>(fn: () => Promise<ActionResult<T>>, onOk: (d: T) => void): Promise<{ error?: string }> {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fn()
      if (!res.ok) {
        setNotice({ text: res.error, conflict: res.conflict === true })
        return { error: res.error }
      }
      onOk(res.data)
      return {}
    } catch {
      setNotice({ text: NO_ANSWER, conflict: false })
      return { error: NO_ANSWER }
    } finally {
      setBusy(false)
    }
  }
  const replaceShape = (s: CanvasShape) => setShapes((prev) => prev.map((x) => (x.id === s.id ? s : x)))

  const onCreate = (c: ShapeCommit) =>
    run(() => createStatusPlanShapeAction({ planId: plan.id, shape: c.shape, points: c.points }), (s) => {
      setShapes((prev) => [...prev, s])
      setSelectedId(s.id)
    })

  const onReshape = (shapeId: string, points: number[]) => {
    const s = shapesRef.current.find((x) => x.id === shapeId)
    if (!s) return Promise.resolve({ error: 'That shape is gone — reload to see the plan.' })
    return run(() => updateStatusPlanShapeAction({ shapeId, expectedUpdatedAt: s.updatedAt, points }), replaceShape)
  }

  function patchSelected(patch: { nodeId?: string | null; areaType?: AreaType | null }) {
    const s = selected
    if (!s) return
    void run(() => updateStatusPlanShapeAction({ shapeId: s.id, expectedUpdatedAt: s.updatedAt, ...patch }), replaceShape)
  }

  const requestDelete = useCallback(() => {
    const s = shapesRef.current.find((x) => x.id === selectedId)
    if (!s) return
    if (armedShape !== s.id) { setArmedShape(s.id); return }
    setArmedShape(null)
    void run(() => deleteStatusPlanShapeAction({ shapeId: s.id, expectedUpdatedAt: s.updatedAt }), () => {
      setShapes((prev) => prev.filter((x) => x.id !== s.id))
      setSelectedId(null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, armedShape])

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    setArmedShape(null)
  }, [])

  function rename() {
    void run(() => renameStatusPlanAction({ planId: plan.id, name: nameDraft }), (d) => {
      setPlanName(d.name)
      setRenaming(false)
    })
  }
  function deletePlan() {
    if (!armedPlan) { setArmedPlan(true); return }
    setArmedPlan(false)
    void run(() => deleteStatusPlanAction({ planId: plan.id }), () => router.push(statusPlansHref(projectId)))
  }
  function reanchor() {
    void run(() => reanchorStatusPlanAction({ planId: plan.id }), (d) => setSourceFilePath(d.sourceFilePath))
  }

  // Slice 3 seam: the schematic "Detect blocks" panel replaces this note.
  const schematicSlot = purpose === 'distribution_schematic' ? (
    <p data-slot="schematic-detection" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--c-text-dim)' }}>
      Automatic block detection is not available yet — draw a rectangle over each DB block and link it to its board.
    </p>
  ) : null

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        {renaming ? (
          <>
            <input className="ob-input" aria-label="Plan name" value={nameDraft} maxLength={120} onChange={(e) => setNameDraft(e.target.value)} />
            <button type="button" className="btn-primary-amber" disabled={busy} onClick={rename}>Save</button>
            <button type="button" onClick={() => { setRenaming(false); setNameDraft(planName) }}>Cancel</button>
          </>
        ) : (
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{planName}</h1>
        )}
        <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>
          {PURPOSE_LABEL[purpose]} · {sheet.name} · page {plan.pageIndex}
        </span>
        {canEdit && !renaming && (
          <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
            <button type="button" onClick={() => setRenaming(true)}>Rename</button>
            <button type="button" disabled={busy} onClick={deletePlan} style={{ color: '#dc2626', fontWeight: armedPlan ? 700 : 400 }}>
              {armedPlan ? 'Press again to delete the plan' : 'Delete plan'}
            </button>
          </span>
        )}
      </div>

      {drawingChanged && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, borderColor: 'var(--c-amber)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            This plan was drawn on <strong>{fileLabel(sourceFilePath)}</strong>; the drawing is now <strong>{fileLabel(sheet.currentFilePath)}</strong>.
            Shapes are shown where they were drawn — check them against the new sheet.
          </span>
          {canEdit && <button type="button" disabled={busy} onClick={reanchor}>Shapes checked — use the new file</button>}
        </div>
      )}

      {purpose === 'tenant_layout' && pixelsPerMeter === null && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Calibrate this page on the drawing to measure areas. Until then areas show “—”.</span>
          {canEdit && (
            <button type="button" onClick={() => setRequestedTool({ tool: 'calibrate', nonce: Date.now() })}>Set scale</button>
          )}
        </div>
      )}

      {notice && (
        <div role="alert" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, color: '#dc2626', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>{notice.text}</span>
          {notice.conflict && <button type="button" onClick={() => window.location.reload()}>Reload</button>}
        </div>
      )}

      <div className="stack-below-lg" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 12, alignItems: 'start' }}>
        <StatusPlanCanvas
          sheet={sheet}
          pageIndex={plan.pageIndex}
          purpose={purpose}
          shapes={shapes}
          views={views}
          selectedId={selectedId}
          canEdit={canEdit}
          busy={busy}
          requestedTool={requestedTool}
          onSelect={onSelect}
          onCreate={onCreate}
          onReshape={onReshape}
          onDeleteRequest={requestDelete}
          onCalibrated={(c) => setSheet((s) => withPageScale(s, c.pageIndex, c.pixelsPerMeter))}
        />
        <aside style={{ display: 'grid', gap: 12 }}>
          <ShapePanel
            purpose={purpose}
            shape={selected}
            view={selected ? views[selected.id] ?? null : null}
            node={selected?.nodeId ? nodesById.get(selected.nodeId) ?? null : null}
            link={selected?.nodeId ? props.shopLinks[selected.nodeId] ?? null : null}
            options={options}
            canEdit={canEdit}
            busy={busy}
            deleteArmed={selected !== null && armedShape === selected.id}
            hasScale={pixelsPerMeter !== null}
            onAssignNode={(nodeId) => patchSelected({ nodeId })}
            onSetAreaType={(areaType) => patchSelected({ areaType })}
            onUnassign={() => patchSelected({ nodeId: null, areaType: null })}
            onDelete={requestDelete}
            extra={schematicSlot}
          />
          <PlanLegend purpose={purpose} summary={summary} hasScale={pixelsPerMeter !== null} attention={attention} onSelectShape={onSelect} />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Write the canvas page**

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadStatusPlanPage } from '@/lib/status-plans/load-plan-page'
import { statusPlansHref } from '@/lib/status-plans/plan-urls'
import { StatusPlanWorkspace } from './StatusPlanWorkspace'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Status plan' }

interface Props {
  params: Promise<{ id: string; planId: string }>
  /** `?shape=` selects a shape — the tenant schedule's "On plan" link. */
  searchParams: Promise<{ shape?: string }>
}

/**
 * One status plan: the drawing page with its shapes coloured from live facts.
 * Every project role reads (RLS + site scope through the caller's session);
 * owner/admin/PM edit. The props are assembled in loadStatusPlanPage and are
 * JSON only — this page adds nothing to them (page-props.contract.test.ts).
 */
export default async function StatusPlanPage({ params, searchParams }: Props) {
  const { id: projectId, planId } = await params
  const { shape } = await searchParams
  const supabase = await createClient()
  const props = await loadStatusPlanPage(supabase, { projectId, planId, requestedShapeId: shape ?? null })
  if (!props) notFound()

  return (
    <div style={{ padding: '16px 20px' }}>
      <Link href={statusPlansHref(projectId)} style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
        ← Status plans
      </Link>
      <div style={{ marginTop: 8 }}>
        <StatusPlanWorkspace {...props} />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the workspace and contract tests**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/status-plans" src/lib/status-plans
```

Expected: PASS — workspace (10 tests), contract (3 tests), and everything from Tasks 2–15.

- [ ] **Step 7: Mutation check on the contract**

In `[planId]/page.tsx` temporarily change the render to `<StatusPlanWorkspace {...props} onDone={() => null} />`. Re-run the contract test: both the "receives a function" case for `[planId]/page.tsx` and "spreads the assembled props" must FAIL. Restore; PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanWorkspace.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/StatusPlanWorkspace.test.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx" \
  apps/web/src/lib/status-plans/page-props.contract.test.ts
git commit -m "feat(status-plans): plan workspace and canvas page; JSON-props contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Sidebar entry

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Test: `apps/web/src/components/layout/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/layout/Sidebar.test.tsx`:

```tsx
describe('Sidebar — Status plans', () => {
  it('sits right after Tenant Schedule inside a project, for writers and readers', () => {
    pathname = '/projects/p1/tenant-schedule'
    for (const role of ['owner', 'contractor'] as const) {
      const { unmount } = render(<Sidebar role={role} />)
      const order = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
      expect(order.indexOf('/projects/p1/status-plans')).toBe(order.indexOf('/projects/p1/tenant-schedule') + 1)
      unmount()
    }
  })

  it('marks Status plans active on a plan page', () => {
    pathname = '/projects/p1/status-plans/pl1'
    render(<Sidebar role="owner" />)
    expect(screen.getByRole('link', { name: 'Status plans' }).getAttribute('aria-current')).toBe('page')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/components/layout/Sidebar.test.tsx
```

Expected: FAIL — `indexOf('/projects/p1/status-plans')` is `-1`; `Unable to find … name "Status plans"`.

- [ ] **Step 3: Add the entry**

In `apps/web/src/components/layout/Sidebar.tsx`, add `Layers,` to the `lucide-react` import (after `Receipt, Activity,`), then replace:

```ts
    { href: `/projects/${id}/tenant-schedule`,    label: 'Tenant Schedule',    Icon: Store,         exact: false },
```

with:

```ts
    { href: `/projects/${id}/tenant-schedule`,    label: 'Tenant Schedule',    Icon: Store,         exact: false },
    { href: `/projects/${id}/status-plans`,       label: 'Status plans',       Icon: Layers,        exact: false },
```

`MobileProjectBar` and the phone ordering read `projectNav`, so they pick the entry up; `lib/mobile/shell.test.ts` derives its "rest" list from `projectNav` and stays green.

- [ ] **Step 4: Run the sidebar and phone-shell tests**

```bash
pnpm --filter web test src/components/layout src/lib/mobile
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.test.tsx
git commit -m "feat(status-plans): Status plans in the project sidebar after Tenant Schedule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: "On plan ↗" on the tenant schedule

**Files:**
- Create: `apps/web/src/lib/status-plans/on-plan-links.ts`
- Test: `apps/web/src/lib/status-plans/on-plan-links.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx`

- [ ] **Step 1: Write the failing loader test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { pickOnPlanLinks, loadOnPlanLinks } from './on-plan-links'

const PLANS = [
  { id: 'old', name: 'Ground (2025)', updated_at: '2026-01-01T00:00:00+00:00' },
  { id: 'new', name: 'Ground', updated_at: '2026-10-09T00:00:00+00:00' },
]
const SHAPES = [
  { id: 's-old', status_plan_id: 'old', node_id: 'n1' },
  { id: 's-new', status_plan_id: 'new', node_id: 'n1' },
  { id: 's-2', status_plan_id: 'old', node_id: 'n2' },
]

describe('pickOnPlanLinks', () => {
  it('a shop on several plans links to the most recently updated one', () => {
    expect(pickOnPlanLinks(PLANS, SHAPES)).toEqual({
      n1: { planId: 'new', planName: 'Ground', shapeId: 's-new' },
      n2: { planId: 'old', planName: 'Ground (2025)', shapeId: 's-2' },
    })
  })
})

describe('loadOnPlanLinks', () => {
  it('reads tenant-layout plans of the project and their linked shapes', async () => {
    const { client, calls } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: PLANS }],
      'tenants.status_plan_shapes:select': [{ data: SHAPES }],
    }))
    expect(Object.keys(await loadOnPlanLinks(client, 'p1'))).toEqual(['n1', 'n2'])
    expect(opsOf(calls, 'tenants.status_plans')).toEqual(expect.arrayContaining([
      ['eq', ['project_id', 'p1']], ['eq', ['purpose', 'tenant_layout']],
    ]))
    expect(opsOf(calls, 'tenants.status_plan_shapes')).toContainEqual(['not', ['node_id', 'is', null]])
  })

  it('never breaks the schedule: a read error is an empty map', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ error: { message: 'relation does not exist' } }] }))
    expect(await loadOnPlanLinks(client, 'p1')).toEqual({})
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web test src/lib/status-plans/on-plan-links.test.ts
```

Expected: FAIL with `Failed to resolve import "./on-plan-links"`.

- [ ] **Step 3: Implement**

```ts
/**
 * For the tenant schedule: which tenant-layout status plan shows each shop,
 * so a row can link straight to its shape (?shape=). A shop on several plans
 * links to the most recently updated one.
 *
 * Best-effort by design: any read error answers {} and the schedule renders
 * without links. The schedule must never fail because of a plan.
 */
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OnPlanLink {
  planId: string
  planName: string
  shapeId: string
}

export function pickOnPlanLinks(
  plans: ReadonlyArray<{ id: string; name: string; updated_at: string }>,
  shapes: ReadonlyArray<{ id: string; status_plan_id: string; node_id: string | null }>,
): Record<string, OnPlanLink> {
  const newestFirst = [...plans].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const out: Record<string, OnPlanLink> = {}
  for (const p of newestFirst) {
    for (const s of shapes) {
      if (s.status_plan_id !== p.id || !s.node_id || out[s.node_id]) continue
      out[s.node_id] = { planId: p.id, planName: p.name, shapeId: s.id }
    }
  }
  return out
}

export async function loadOnPlanLinks(client: unknown, projectId: string): Promise<Record<string, OnPlanLink>> {
  try {
    const db = client as any
    const plansRes = await db.schema('tenants').from('status_plans')
      .select('id, name, updated_at').eq('project_id', projectId).eq('purpose', 'tenant_layout')
    if (plansRes.error || !plansRes.data?.length) return {}
    const ids = (plansRes.data as Array<{ id: string }>).map((p) => p.id)
    const shapes = await readAll<{ id: string; status_plan_id: string; node_id: string | null }>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select('id, status_plan_id, node_id')
        .in('status_plan_id', ids).not('node_id', 'is', null).order('id').range(from, to))
    if ('error' in shapes) return {}
    return pickOnPlanLinks(plansRes.data, shapes.data)
  } catch {
    return {}
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm --filter web test src/lib/status-plans/on-plan-links.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing ScheduleTable test**

Append to `ScheduleTable.test.tsx`:

```tsx
describe('ScheduleTable status plan link', () => {
  it('links a shop that is on a plan to that plan with its shape selected', () => {
    render(
      <ScheduleTable
        nodes={[tenant({})]}
        {...base}
        onPlanByNode={{ n1: { planId: 'pl1', planName: 'Ground floor', shapeId: 's1' } }}
      />,
    )
    const link = screen.getByRole('link', { name: /on plan/i })
    expect(link.getAttribute('href')).toBe('/projects/p1/status-plans/pl1?shape=s1')
    expect(link.getAttribute('title')).toBe('Shown on Ground floor')
  })

  it('shows no link for a shop that is on no plan', () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)
    expect(screen.queryByRole('link', { name: /on plan/i })).toBeNull()
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx"
```

Expected: the first new test FAILS (`Unable to find role "link" … /on plan/i`); `tsc` would also reject the unknown prop.

- [ ] **Step 7: Add the link to `ScheduleTable.tsx`**

1. Imports — after `import { useState, Fragment } from 'react'` add:

```ts
import Link from 'next/link'
import { statusPlanHref } from '@/lib/status-plans/plan-urls'
import type { OnPlanLink } from '@/lib/status-plans/on-plan-links'
```

2. Props — after the `readOnly?: boolean` member of `interface Props` add:

```ts
  /** node_id → the tenant-layout status plan showing this shop (status plans slice 2). */
  onPlanByNode?: Record<string, OnPlanLink>
```

3. Destructuring — replace `  readOnly = false,\n}: Props) {` with:

```ts
  readOnly = false,
  onPlanByNode = {},
}: Props) {
```

4. Row actions — immediately before this exact text:

```tsx
                          <button
                            onClick={() => toggleLegend(node.id)}
```

insert:

```tsx
                          {onPlanByNode[node.id] && (
                            <Link
                              href={statusPlanHref(projectId, onPlanByNode[node.id]!.planId, onPlanByNode[node.id]!.shapeId)}
                              title={`Shown on ${onPlanByNode[node.id]!.planName}`}
                              style={{
                                border: '1px solid var(--c-border)',
                                borderRadius: 5,
                                padding: '4px 10px',
                                fontSize: 11,
                                color: 'var(--c-text-dim)',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                textDecoration: 'none',
                              }}
                            >
                              On plan ↗
                            </Link>
                          )}
```

The actions cell renders only for active shops, so a decommissioned shop gets no link (its shape is struck on the plan itself).

- [ ] **Step 8: Pass the links from the tenant schedule page**

In `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx`:

Add the import after `import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'`:

```ts
import { loadOnPlanLinks } from '@/lib/status-plans/on-plan-links'
```

Replace:

```ts
  const writeGuard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  const canWrite = writeGuard.ok
```

with:

```ts
  const writeGuard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  const canWrite = writeGuard.ok
  // Which status plan shows each shop (best-effort: {} on any error, so the
  // schedule never fails because of a plan).
  const onPlanByNode = await loadOnPlanLinks(supabase, projectId)
```

and add `onPlanByNode={onPlanByNode}` as the last prop of `<ScheduleTable … />`, after `readOnly={!canWrite}`.

- [ ] **Step 9: Run the tenant-schedule tests**

```bash
pnpm --filter web test "src/app/(admin)/projects/[id]/tenant-schedule" src/lib/status-plans/on-plan-links.test.ts
pnpm --filter web type-check
```

Expected: PASS (existing ScheduleTable tests unchanged and green, plus the 2 new); `tsc` exits 0.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/status-plans/on-plan-links.ts apps/web/src/lib/status-plans/on-plan-links.test.ts \
  "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx"
git commit -m "feat(status-plans): On plan link per shop on the tenant schedule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: RBAC matrix

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Page routes**

In the `## Page routes` table, immediately after the row that starts with `` | `/projects/[id]/tenant-schedule` | ``, insert:

```markdown
| `/projects/[id]/status-plans` (status plans list + "New status plan": drawing → page → purpose → name; added 2026-10-09, slice 2). Read through the caller's session (RLS `status_plans_select` + `site_scope`). The New control renders only for `ORG_WRITE_ROLES` (`requireEffectiveRole(…).ok`) | W | W | W | R | R | R | → `/portal` |
| `/projects/[id]/status-plans/[planId]` (status plan canvas + side panel + legend; `?shape=` selects a shape — the tenant schedule's "On plan ↗" link). Editing (draw, reshape, link, area type, delete, rename, delete plan, re-anchor, Set scale) needs `ORG_WRITE_ROLES`; every other project role gets the same page read-only. `client_viewer` never reaches `(admin)` routes; the portal read-only view is slice 4 | W | W | W | R | R | R | → `/portal` |
```

- [ ] **Step 2: Server actions**

Immediately before the line `### Work items (\`work-items.actions.ts\`)`, insert:

```markdown
### Status plans (`status-plan.actions.ts`, slice 2, migration `00245`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `createStatusPlanAction` | W | W | W | — | — | — | — |
| `renameStatusPlanAction` | W | W | W | — | — | — | — |
| `deleteStatusPlanAction` | W | W | W | — | — | — | — |
| `reanchorStatusPlanAction` | W | W | W | — | — | — | — |
| `createStatusPlanShapeAction` | W | W | W | — | — | — | — |
| `updateStatusPlanShapeAction` | W | W | W | — | — | — | — |
| `deleteStatusPlanShapeAction` | W | W | W | — | — | — | — |
| `calibrateFloorPlanAction` (reused by the status plan canvas's **Set scale**) | W | W | W | — | — | — | — |

> **Added 2026-10-09 (status plans slice 2).** Every action gates on `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` and reads `.ok`, resolving the project from the plan (or the shape's plan) on the server; the RESTRICTIVE per-verb policies of `00245` are the database backstop. Actions return `{ ok, error }` and never throw for a refusal; Postgres codes `23514`/`23505`/`23503`/`42501` become sentences (`lib/status-plans/write-errors.ts`), and a raw message is never shown. Shape update and delete are **conditional on the row's `updated_at`** in the same statement; zero rows back is reported as "changed by someone else" (or "deleted by someone else") with a Reload control, never merged. `organisation_id`, `source_file_path` and `created_by` are never sent: the slice-1 triggers bind them. `reanchorStatusPlanAction` writes the drawing's *current* `file_path`, read on the server. Shape actions do not revalidate the canvas page (the result is folded into client state). Reads are not actions: both pages read through the caller's session, so RLS + `site_scope` decide visibility. The tenant schedule's "On plan ↗" link (`loadOnPlanLinks`) reads the same way and degrades to no link on any error.
```

- [ ] **Step 3: Update slice 1's note**

In the `### Status plans (\`tenants.status_plans\` …)` section slice 1 added, replace the sentence that starts `No page, action or route exists yet;` and ends `give every other role the same page read-only.` with:

```markdown
Slice 2 added the pages `/projects/[id]/status-plans` and `/projects/[id]/status-plans/[planId]` and `status-plan.actions.ts` (see Page routes and Server actions above); writes gate on `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` (`.ok`) and every other project role gets the same page read-only.
```

- [ ] **Step 4: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): status plans pages and actions (slice 2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Everything green

**Files:** none (fix forward in the file a failure names; never weaken a test to pass)

- [ ] **Step 1: All three suites**

```bash
pnpm --filter web test 2>&1 | tail -8
pnpm --filter @esite/shared test 2>&1 | tail -8
pnpm --filter @esite/db test:ci 2>&1 | tail -8
```

Expected: all three PASS. Web's count is the Task 0 baseline plus this plan's new tests (≈ 150); shared and db are unchanged from the baseline (this slice adds no migration and no shared code). If `@esite/db` is red, it is a repo-wide guard reading files this slice touched — read its message before touching anything.

- [ ] **Step 2: Type-check and lint**

```bash
pnpm --filter web type-check
pnpm --filter @esite/shared type-check
pnpm --filter web lint
```

Expected: all exit 0 with no new warnings in `status-plans` paths.

- [ ] **Step 3: Production build**

```bash
pnpm --filter web build 2>&1 | tail -30
```

Expected: exit 0, and the route list includes `/projects/[id]/status-plans` and `/projects/[id]/status-plans/[planId]`. This is the only check that catches a non-async export from `status-plan.actions.ts`. If the build stops on missing `NEXT_PUBLIC_*` environment variables, copy `apps/web/.env.local` from the canonical checkout into this worktree (it is gitignored; never commit it) and re-run.

- [ ] **Step 4: Owner walk (cannot be done by the agent — it does not sign in)**

Hand this list to the owner, from the empty state on KINGSWALK, not a deep link:

1. Project sidebar → **Status plans** (after Tenant Schedule) → "No status plans yet".
2. **New status plan** → the Tenant Layout drawing → page 1 → Tenant layout → Create → the canvas opens.
3. If "Calibrate this page…" shows: **Set scale**, click two points of a known dimension, enter metres → areas appear.
4. **Polygon**: mask three shops; select each → find the shop → it turns green/orange; a shop past its BO date shows the red hatch. **Rectangle**: draw one mall area → *Mall / common area*.
5. Drag a corner; reload the page; the shape is where it was left.
6. Delete a shape: first press shows "Press again to delete"; wait 4 s and it disarms.
7. Tenant Schedule → a masked shop's **On plan ↗** → the plan opens with that shape selected.
8. As `rbac-test` (contractor): the same plan opens read-only (no tools, no assign list, no Delete plan).
9. New status plan → 643/E/300 sheet 1 → Distribution schematic → draw a rectangle over one DB block → link it → the hatch matches its DB order.

- [ ] **Step 5: Final commit (only if Steps 1–3 required fixes)**

```bash
git status --short
git add -A apps/web docs
git commit -m "fix(status-plans): green across web, shared, db, tsc, eslint and next build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Follow-ups (not in this slice)

- Undo/redo of shape edits (the measure page's snapshot history is the model), vertex insert/remove, whole-shape move.
- Centre the viewport on `?shape=` when the page opens from the tenant schedule link.
- Detection, matcher and review UI (slice 3) — plugs into `ShapePanel`'s `extra` slot.
- Portal read-only view, pdf-lib renderer, report appendix, schematic Export sheet (slice 4).

---

## Interfaces for later slices

Slices 3–4 are planned against these names. Changing any of them is a breaking change to those plans.

**Web — pure (`apps/web/src/lib/…`)**

```ts
// lib/sheet/page-scale.ts
export interface PageScaleRow { pageIndex: number; pixelsPerMeter: number }
export interface ScaledSheet { pixels_per_meter: number | null; page_scales: ReadonlyArray<PageScaleRow> }
export function pageScaleFor(sheet: ScaledSheet, page: number): number | null
export function withPageScale<S extends ScaledSheet>(sheet: S, pageIndex: number, pixelsPerMeter: number): S

// lib/status-plans/types.ts
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean }
export interface PlanSheet { floorPlanId; name; signedUrl: string | null; isPdf: boolean; widthPx: number | null; heightPx: number | null; currentFilePath: string; pixels_per_meter: number | null; page_scales: PageScaleRow[] }
export interface PlanHeader { id; name; purpose: StatusPlanPurpose; pageIndex: number; sourceFilePath: string; updatedAt: string }
export interface CanvasShape { id; shape: ShapeKind; points: number[]; nodeId: string | null; areaType: AreaType | null; detectedTag: string | null; source: ShapeSource; updatedAt: string }
export interface PlanNode { id; code; kind; shopNumber: string | null; shopName: string | null; scheduledM2: number | null; decommissioned: boolean }
export interface StatusPlanPageProps { projectId; plan: PlanHeader; sheet: PlanSheet; shapes: CanvasShape[]; nodes: PlanNode[]; shopLinks: Record<string, ShopLink>; dbOrders: Record<string, NodeOrderStatus>; today: string; canEdit: boolean; initialShapeId: string | null }

// lib/status-plans/json-safe.ts
export function jsonUnsafePath(value: unknown, path?: string): string | null

// lib/status-plans/plan-urls.ts
export const isPdfPath: (p: string) => boolean
export const isImagePath: (p: string) => boolean
export const isRenderableDrawing: (p: string) => boolean
export function statusPlansHref(projectId: string): string
export function statusPlanHref(projectId: string, planId: string, shapeId?: string | null): string
export function fileLabel(path: string): string

// lib/status-plans/write-errors.ts
export type WriteTarget = 'plan' | 'shape'
export interface PgErrorLike { code?: string | null; message?: string | null }
export function statusPlanWriteError(err: PgErrorLike, target: WriteTarget): string

// lib/status-plans/canvas-shape.ts
export const SHAPE_COLUMNS: string
export function toCanvasShape(row: StatusPlanShapeRow): CanvasShape
export function roundPoints(points: readonly number[], dp?: number /* 2 */): number[]
export interface ShapePatch { points?: number[]; nodeId?: string | null; areaType?: AreaType | null }
export function shapePatchRow(p: ShapePatch): Record<string, unknown>

// lib/status-plans/shape-view.ts
export interface ShapeView { id; style: ShapeStyle; legendKey: string; overdue: boolean; statusLabel: string; labelLines: string[]; areaM2: number | null; check: AreaCheck | null; linkedNodeMissing: boolean }
export interface ShapeViewContext { purpose; nodesById: ReadonlyMap<string, PlanNode>; shopLinks: Readonly<Record<string, ShopLink>>; dbOrders: Readonly<Record<string, NodeOrderStatus>>; today: string; pixelsPerMeter: number | null }
export function resolveShapeView(s: CanvasShape, ctx: ShapeViewContext): ShapeView
export interface LegendSummary { counts: Record<string, number>; totalM2: number; unmeasured: number }
export function legendSummary(views: ReadonlyArray<ShapeView>, purpose: StatusPlanPurpose): LegendSummary
export interface AttentionItem { shapeId: string; label: string; reason: string }
export function needsAttention(shapes: ReadonlyArray<CanvasShape>, views: Readonly<Record<string, ShapeView>>): AttentionItem[]
export function fillRgba(style: ShapeStyle): string
export function swatchCss(style: ShapeStyle): Record<string, string>

// lib/status-plans/node-options.ts
export interface NodeOption { id; label: string; sub: string | null; disabled: boolean; reason: string | null }
export function nodeLabel(n: PlanNode, purpose: StatusPlanPurpose): string
export function buildNodeOptions(nodes, shapes, selectedShapeId: string | null, purpose): NodeOption[]
export function filterNodeOptions(options: ReadonlyArray<NodeOption>, query: string): NodeOption[]

// lib/status-plans/canvas-reducer.ts
export type CanvasTool = 'select' | 'polygon' | 'rect' | 'pan' | 'calibrate'
export interface CanvasState { tool: CanvasTool; draft: number[]; rect: { x0; y0; x1; y1 } | null; calib: number[] }
export interface ShapeCommit { shape: 'polygon' | 'rect'; points: number[] }
export type CanvasEvent = { type: 'tool'; tool } | { type: 'press'; x; y; tolPx } | { type: 'move'; x; y } | { type: 'release'; x; y; tolPx } | { type: 'finish'; tolPx } | { type: 'escape' } | { type: 'undoPoint' }
export function initialCanvasState(tool?: CanvasTool): CanvasState
export function isIdle(s: CanvasState): boolean
export function canvasReducer(s: CanvasState, e: CanvasEvent): { state: CanvasState; commit: ShapeCommit | null }
export function dragVertex(shape: { shape: 'polygon' | 'rect'; points: readonly number[] }, index: number, x: number, y: number): number[]

// lib/status-plans/plan-list.ts
export interface PlanListRow { id; name; purpose; purposeLabel; pageIndex; drawingName; shapes; linked; areas; updatedAt }
export interface DrawingOption { id: string; name: string; renderable: boolean }
export function planListRows(plans, drawings, shapes): PlanListRow[]
export function defaultPlanName(drawingName: string, purpose: StatusPlanPurpose, pageIndex: number): string

// lib/status-plans/on-plan-links.ts
export interface OnPlanLink { planId: string; planName: string; shapeId: string }
export function pickOnPlanLinks(plans, shapes): Record<string, OnPlanLink>
```

**Web — I/O (session client; the caller's RLS is the gate)**

```ts
// lib/status-plans/project-db-orders.ts   ← the schematic loader slice 1 deferred; slice 3 reuses it
export interface ProjectDbOrderArgs { projectId: string; orgId: string }
export async function loadProjectDbOrderStatus(client: unknown, args: ProjectDbOrderArgs): Promise<Record<string, NodeOrderStatus>>
//   node_orders where project_id = projectId and scope_item_type_id ∈ (org's scope_item_types with key 'db'),
//   paged past max_rows; THROWS on a read error (never {} — that would draw every block "No DB order").

// lib/status-plans/load-plan-page.ts
export interface PlanPageRaw { … }   // see file
export function buildStatusPlanPageProps(raw: PlanPageRaw): StatusPlanPageProps   // the ONLY props assembler (JSON only)
export async function loadStatusPlanPage(client: unknown, args: { projectId: string; planId: string; requestedShapeId: string | null }): Promise<StatusPlanPageProps | null>

// lib/status-plans/plan-list.ts
export async function loadStatusPlanList(client: unknown, projectId: string): Promise<{ rows: PlanListRow[]; drawings: DrawingOption[] }>

// lib/status-plans/on-plan-links.ts
export async function loadOnPlanLinks(client: unknown, projectId: string): Promise<Record<string, OnPlanLink>>   // {} on any error
```

**Server actions (`apps/web/src/actions/status-plan.actions.ts`)** — all gate `ORG_WRITE_ROLES` via `.ok`, all return `ActionResult`:

```ts
createStatusPlanAction({ projectId, floorPlanId, pageIndex, purpose, name }): ActionResult<{ id }>
renameStatusPlanAction({ planId, name }): ActionResult<{ name; updatedAt }>
deleteStatusPlanAction({ planId }): ActionResult<{ id }>
reanchorStatusPlanAction({ planId }): ActionResult<{ sourceFilePath }>
createStatusPlanShapeAction({ planId, shape, points, nodeId?, areaType? }): ActionResult<CanvasShape>   // source is always 'manual' in slice 2
updateStatusPlanShapeAction({ shapeId, expectedUpdatedAt, points?, nodeId?, areaType? }): ActionResult<CanvasShape>   // conflict: true on a stale or deleted row
deleteStatusPlanShapeAction({ shapeId, expectedUpdatedAt }): ActionResult<{ id }>
```

Slice 3 adds its own action to write `source: 'detected'` + `detected_tag` (batch accept); it should reuse `statusPlanWriteError`, `SHAPE_COLUMNS`, `toCanvasShape`, `roundPoints` and the same `mayWrite`-style `.ok` gate rather than widen `createStatusPlanShapeAction`.

**Components (`apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/`)**

```ts
StatusPlanWorkspace(props: StatusPlanPageProps)        // page.tsx renders exactly <StatusPlanWorkspace {...props} />
StatusPlanCanvas(props: StatusPlanCanvasProps)         // { sheet, pageIndex, purpose, shapes, views, selectedId, canEdit, busy,
                                                       //   requestedTool: { tool: CanvasTool; nonce } | null,
                                                       //   onSelect, onCreate, onReshape, onDeleteRequest, onCalibrated, height? }
ShapePanel(props: ShapePanelProps)                     // `extra?: ReactNode` IS THE SLICE-3 SEAM
PlanLegend(props: PlanLegendProps)                     // { purpose, summary, hasScale, attention, onSelectShape }
```

**Slice-3 seam, exactly:** in `StatusPlanWorkspace`, `schematicSlot` (the `<p data-slot="schematic-detection">` note, rendered only when `purpose === 'distribution_schematic'`) is passed as `ShapePanel`'s `extra`. Slice 3 replaces that element with its "Detect blocks" panel and, to draw proposals, adds an optional `proposals?: …` prop to `StatusPlanCanvas` drawn in its own non-listening layer; nothing else in the canvas needs to change. The rectangle tool, `dbBlockStyle` rendering, node linking and DB order status (`loadProjectDbOrderStatus`) already work on schematic plans in this slice.

**Contract tests that will hold later slices to these rules**

- `lib/status-plans/page-props.contract.test.ts` — any `page.tsx` under `status-plans/` handing a function, a `function` expression or an `…Action` to a local `'use client'` component fails; the canvas page must render exactly `<StatusPlanWorkspace {...props} />`. Slice 4's portal page should get the same test.
- `load-plan-page.test.ts` — `jsonUnsafePath(props) === null` on the assembled props.
- `lib/auth/role-gate-call-sites.contract.test.ts` (existing) — covers every new `requireEffectiveRole` call.
