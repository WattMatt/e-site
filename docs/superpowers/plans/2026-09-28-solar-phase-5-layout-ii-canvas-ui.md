# Solar Phase 5-ii — Layout tab: roof sources, canvas, export, 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Solar Layout tab (functional spec §6) on top of plan 5-i: roof sources on Site & Supply (drawing picker, calibrate via the existing `calibrateFloorPlanAction`, north, server-side Mapbox satellite capture), the layout list, a Konva `SolarCanvas` with every §6.3 tool, properties + summary + BOM CSV, undo/redo, IndexedDB drafts, stale-refusing save, the `solar_layout_sheet` PDF, an optional read-only 3D preview, readiness wiring, the RBAC matrix, and the draft PR.

**Architecture:** Server pages load everything as JSON (never a function prop across the server → client boundary — the PR #201 rule). A client `LayoutWorkspace` owns the object list, snapshot history and draft; `SolarCanvas` (sibling of `RouteCanvas`, built on `lib/sheet/use-sheet-image`, `use-sheet-viewport`, `draft-store`) only renders and emits intents. All editing rules are pure functions in `@esite/shared` (`solar/layout/doc.ts`) or `apps/web/src/lib/solar/*` and are unit-tested; Konva is not (the same gap `RouteCanvas` carries). Every action re-checks `requireSolarLevel` and writes through the caller's session so 00212's RLS and bind triggers decide.

**Tech Stack:** Next.js 15 (App Router, server actions), React 19, Konva/react-konva, pdf-lib, Vitest + Testing Library, optional three + @react-three/fiber 9.

---

## Read this first

- **Prerequisite:** plan 5-i is complete on `feat/solar-phase-5` in `~/.config/superpowers/worktrees/esite/solar-phase-5` (shared geometry, `00212`, `isAnnotated()`, report gate). Run every command from that worktree root.
- **Mirror these, do not reinvent:** sheet loading `apps/web/src/lib/sheet/use-sheet-image.ts:33-134` (fixed `scale: 2` raster = image space; signed URL through a ref), viewport `apps/web/src/lib/sheet/use-sheet-viewport.ts:26-349` (wheel/pinch/middle-drag/space-drag; F/0 fit — Task 3 makes the fit keys configurable because Solar's `F` is Auto-fill), drafts `apps/web/src/lib/sheet/draft-store.ts` (same DB/store names; keys are the caller's), the canvas shape `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/measure/RouteCanvas.tsx` (select on `mousedown`, `getRelativePointerPosition()` for image coords, `isPrimaryDrawPress`/`isTouchEvent`/`rollbackPinchVertex` from `floor-plans/[planId]/canvas-input`, export by resetting stage scale then `toDataURL` at lines 350-376), snapshot undo/redo `apps/web/src/lib/cable-route/route-history.ts`, `next/dynamic` with `ssr: false` for Konva (`RouteMeasureWorkspace.tsx:21-28`), stale writes conditioned on `updated_at` (`apps/web/src/actions/solar-site.actions.ts:44-58`), report versioning (`apps/web/src/actions/cable-route.actions.ts:861-930`), the two-step inline confirm `solar/_components/useArmedConfirm.ts` (never `window.confirm` — Safari suppresses it), `useSolarDirtyGuard` (`lib/solar/dirty-store.ts`).
- **Calibration stays where it is.** `calibrateFloorPlanAction` (`apps/web/src/actions/cable-route.actions.ts:506-600`) is gated on `ORG_WRITE_ROLES` (owner/admin/PM) and writes page 1 to `tenants.floor_plans` and page ≥ 2 to `tenants.floor_plan_page_scales`. A Solar Edit contractor sees its refusal sentence. That is deliberate (a scale is a property of the drawing that cable routes share) — see Open question 3.
- **Konva `click` is not synthesised reliably** — select on `onMouseDown`/`onTouchStart`. `Konva.stages[0]` may be a destroyed stage — always use the component's own `stageRef`.
- **Mapbox token:** server-only env var `MAPBOX_ACCESS_TOKEN` (not `NEXT_PUBLIC_`). Unset → the capture route answers `503 {"error":"Satellite capture is not configured"}` before touching the session, and the panel disables the button with that reason. Setting it in Vercel is an owner step.
- **Signed-in walks are OWNER steps.** The agent does not enter passwords. The final task lists exactly what the owner must walk (desktop + tablet/touch).

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/solar/layout/doc.ts` | Pure editing ops: remove objects/modules with string re-indexing, translate, rotate about a pivot, diff, apply delta, clone with id remap, string colours |
| `packages/shared/src/solar/layout/scene3d.ts` | Pure 3D scene: roof planes at height (pitched along the fall line), tilted module quads, obstruction prisms (Task 14) |
| `apps/web/src/lib/solar/layout-errors.ts` | Postgres/PostgREST errors from 00212 → one sentence |
| `apps/web/src/lib/solar/layout-history.ts` | Generic snapshot undo/redo (route-history pattern) |
| `apps/web/src/lib/sheet/viewport-math.ts` | + `viewportKeyAction` (configurable fit keys) |
| `apps/web/src/lib/sheet/use-sheet-viewport.ts` | + `fitKeys` option |
| `apps/web/src/lib/solar/layout-loader.ts` | Server loaders: roof sources, layout list, editor data (JSON only) |
| `apps/web/src/lib/solar/layout-readiness.ts` | Aggregate for the Layout readiness step |
| `apps/web/src/lib/solar/auto-fill-plan.ts` | Auto-fill request → array object (px), including D-11 pitch and facing rules |
| `apps/web/src/lib/solar/block-plan.ts` | Manual block (tool A): rectangle → modules, start snapped to the roof edge setback |
| `apps/web/src/lib/solar/layout-sheet-pdf.ts` | pdf-lib render of the layout sheet (winAnsiSafe everywhere) |
| `apps/web/src/actions/solar-roof-sources.actions.ts` | Add drawing roof source, remove, set north |
| `apps/web/src/actions/solar-layout.actions.ts` | Create, duplicate, rename, delete, save objects |
| `apps/web/src/actions/solar-layout-export.actions.ts` | Export layout sheet → `projects.reports` kind `solar_layout_sheet`, versioned |
| `apps/web/src/app/api/projects/[id]/solar/roof-sources/satellite/route.ts` | Mapbox capture (503 when unconfigured) |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site/RoofSourcesPanel.tsx` | Section C of Site & Supply |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/page.tsx` + `LayoutList.tsx` | Layout list, New / Duplicate / Rename / Delete |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/[layoutId]/page.tsx` | Editor page |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/sources/[roofSourceId]/page.tsx` + `SheetSettings.tsx` | Sheet page: calibrate + north |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/_components/SolarCanvas.tsx` | Konva canvas |
| `…/_components/LayoutWorkspace.tsx`, `LayoutToolbar.tsx`, `PropertiesPanel.tsx`, `SummaryPanel.tsx`, `AutoFillDialog.tsx`, `Layout3DPreview.tsx` | Editor chrome |
| `packages/shared/src/solar/entry.ts:30` | Layout tab `built: true` |
| `docs/rbac-matrix.md` | Solar rows for every new route, action and the API |
| `apps/web/.env.example` | `MAPBOX_ACCESS_TOKEN` |

---

### Task 1: Pure editing operations (`doc.ts`)

**Files:**
- Create: `packages/shared/src/solar/layout/doc.ts`
- Modify: `packages/shared/src/solar/layout/index.ts` (append `export * from './doc'`)
- Test: `packages/shared/src/solar/layout/doc.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/layout/doc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  removeObjects, removeModules, translateObjects, rotateObjects, selectionPivot, diffObjects,
  applyObjectDelta, cloneLayoutObjects, stringColour, STRING_COLOURS, stableStringify,
} from './doc'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type LayoutObject } from './types'

const q = (x: number, y: number) => [x, y, x + 10, y, x + 10, y + 20, x, y + 20]
const roof: LayoutObject = { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 100, 0, 100, 50, 0, 50] },
  props: { name: 'R', roofType: 'pitched', pitchDeg: 20, fallBearingDeg: 0, heightM: 5, setbackM: 0.3, maxLoadKgM2: null } }
const arr: LayoutObject = { id: 'A', kind: 'array', pixelsPerMeter: 10, geometry: { modules: [q(0, 0), q(10, 0), q(20, 0)] },
  props: { roofId: 'R', module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 20, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 2, gapM: 0.02 } }
const inv: LayoutObject = { id: 'I', kind: 'inverter', pixelsPerMeter: 10, geometry: { x: 50, y: 60 }, props: { name: 'INV', inverter: INV } }
const str: LayoutObject = { id: 'S', kind: 'string', pixelsPerMeter: 10, geometry: {},
  props: { inverterId: 'I', mppt: 1, modules: [{ arrayId: 'A', index: 0 }, { arrayId: 'A', index: 2 }] } }
const DOC = [roof, arr, inv, str]

describe('removeObjects', () => {
  it('deleting an inverter deletes its strings', () => {
    expect(removeObjects(DOC, ['I']).map((o) => o.id)).toEqual(['R', 'A'])
  })
  it('deleting an array drops its modules from strings, and an empty string goes too', () => {
    expect(removeObjects(DOC, ['A']).map((o) => o.id)).toEqual(['R', 'I'])
  })
})

describe('removeModules (Delete on selected modules)', () => {
  it('re-indexes the survivors in every string', () => {
    const out = removeModules(DOC, [{ arrayId: 'A', index: 1 }])
    const a = out.find((o) => o.id === 'A')!
    expect(a.kind === 'array' && a.geometry.modules.length).toBe(2)
    const s = out.find((o) => o.id === 'S')!
    expect(s.kind === 'string' && s.props.modules).toEqual([{ arrayId: 'A', index: 0 }, { arrayId: 'A', index: 1 }])
  })
  it('a string that loses every module is removed', () => {
    const out = removeModules(DOC, [{ arrayId: 'A', index: 0 }, { arrayId: 'A', index: 2 }])
    expect(out.find((o) => o.id === 'S')).toBeUndefined()
  })
})

describe('translate and rotate', () => {
  it('translates every geometry kind and leaves strings alone', () => {
    const out = translateObjects(DOC, ['R', 'A', 'I', 'S'], 5, -5)
    expect(out[0]!.kind === 'roof' && out[0]!.geometry.points.slice(0, 2)).toEqual([5, -5])
    expect(out[1]!.kind === 'array' && out[1]!.geometry.modules[0]!.slice(0, 2)).toEqual([5, -5])
    expect(out[2]!.kind === 'inverter' && out[2]!.geometry).toEqual({ x: 55, y: 55 })
    expect(out[3]).toBe(str)
  })
  it('rotates about the selection pivot and turns the array facing and the roof fall line with it', () => {
    const pivot = selectionPivot(DOC, ['A'])!
    expect(pivot).toEqual({ x: 15, y: 10 })
    const out = rotateObjects(DOC, ['R', 'A'], 90, { x: 0, y: 0 })
    const a = out.find((o) => o.id === 'A')!
    expect(a.kind === 'array' && a.props.facingSheetDeg).toBe(90)
    const r = out.find((o) => o.id === 'R')!
    expect(r.kind === 'roof' && r.props.fallBearingDeg).toBe(90)
    // (10, 0) → (0, 10) clockwise on screen
    expect(a.kind === 'array' && a.geometry.modules[0]![2]).toBeCloseTo(0, 9)
    expect(a.kind === 'array' && a.geometry.modules[0]![3]).toBeCloseTo(10, 9)
  })
})

describe('diff / apply / clone', () => {
  it('diffs by content, independent of key order', () => {
    const reordered: LayoutObject = { ...inv, props: { inverter: INV, name: 'INV' } } as LayoutObject
    expect(diffObjects(DOC, [roof, arr, reordered, str])).toEqual({ upserts: [], deletes: [] })
    const moved = translateObjects(DOC, ['I'], 1, 0)
    expect(diffObjects(DOC, moved).upserts.map((o) => o.id)).toEqual(['I'])
    expect(diffObjects(DOC, [roof, arr]).deletes).toEqual(['I', 'S'])
  })
  it('stableStringify sorts keys at every depth', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}')
  })
  it('applies a delta: keeps saved scales, stamps new objects with the given scale', () => {
    const neu: LayoutObject = { ...inv, id: 'I2', pixelsPerMeter: null }
    const out = applyObjectDelta(DOC, [{ ...roof, pixelsPerMeter: null }, neu], ['S'], 25)
    expect(out.map((o) => [o.id, o.pixelsPerMeter])).toEqual([['R', 10], ['A', 10], ['I', 10], ['I2', 25]])
  })
  it('clones with fresh ids and remaps every reference', () => {
    let n = 0
    const out = cloneLayoutObjects(DOC, () => `new-${++n}`)
    const ids = new Map(DOC.map((o, i) => [o.id, out[i]!.id]))
    const a = out[1]!
    expect(a.kind === 'array' && a.props.roofId).toBe(ids.get('R'))
    const s = out[3]!
    expect(s.kind === 'string' && s.props.inverterId).toBe(ids.get('I'))
    expect(s.kind === 'string' && s.props.modules[0]!.arrayId).toBe(ids.get('A'))
  })
  it('string colours cycle', () => {
    expect(stringColour(0)).toBe(STRING_COLOURS[0])
    expect(stringColour(STRING_COLOURS.length)).toBe(STRING_COLOURS[0])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/doc.test.ts`
Expected: FAIL — cannot resolve `./doc`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/layout/doc.ts`:

```ts
/**
 * Editing operations on a layout's object list (functional spec §6.3). Pure:
 * the workspace owns the state, this owns the rules (the lib/cable-route/
 * route-history.ts split). Every function returns a NEW array.
 */
import { flatToPts, ptsToFlat, rotateAbout, vertexMean } from './geometry'
import { mod360 } from './orientation'
import { isArrayObject, isCircleGeometry, type LayoutObject, type ModuleRef, type Pt } from './types'

/** Distinct on screen and in the PDF legend; cycles for more strings. */
export const STRING_COLOURS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
  '#f032e6', '#9a6324', '#800000', '#469990', '#000075', '#808000',
] as const

export function stringColour(i: number): string {
  const n = STRING_COLOURS.length
  return STRING_COLOURS[((i % n) + n) % n]!
}

/** JSON with keys sorted at every depth — jsonb reorders keys, so a plain stringify diff would lie. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

const sig = (o: LayoutObject) => stableStringify([o.kind, o.geometry, o.props])

function pruneStrings(objs: LayoutObject[]): LayoutObject[] {
  const arrays = new Map(objs.filter(isArrayObject).map((a) => [a.id, a.geometry.modules.length]))
  const inverters = new Set(objs.filter((o) => o.kind === 'inverter').map((o) => o.id))
  return objs.flatMap((o) => {
    if (o.kind !== 'string') return [o]
    if (!inverters.has(o.props.inverterId)) return []
    const modules = o.props.modules.filter((m) => m.index < (arrays.get(m.arrayId) ?? 0))
    return modules.length > 0 ? [{ ...o, props: { ...o.props, modules } }] : []
  })
}

/** Delete whole objects; strings lose modules of deleted arrays and die with their inverter or when empty. */
export function removeObjects(objs: LayoutObject[], ids: string[]): LayoutObject[] {
  const gone = new Set(ids)
  return pruneStrings(objs.filter((o) => !gone.has(o.id)))
}

/** Delete individual modules; every string's references are re-indexed so they keep pointing at the same panels. */
export function removeModules(objs: LayoutObject[], refs: ModuleRef[]): LayoutObject[] {
  const drop = new Map<string, Set<number>>()
  for (const r of refs) {
    const s = drop.get(r.arrayId) ?? new Set<number>()
    s.add(r.index)
    drop.set(r.arrayId, s)
  }
  const remap = new Map<string, Map<number, number>>()
  const next = objs.map((o) => {
    if (!isArrayObject(o) || !drop.has(o.id)) return o
    const d = drop.get(o.id)!
    const m = new Map<number, number>()
    const modules: number[][] = []
    o.geometry.modules.forEach((q, i) => {
      if (!d.has(i)) {
        m.set(i, modules.length)
        modules.push(q)
      }
    })
    remap.set(o.id, m)
    return { ...o, geometry: { modules } } as LayoutObject
  })
  return next.flatMap((o) => {
    if (o.kind !== 'string') return [o]
    const modules = o.props.modules.flatMap((r) => {
      const m = remap.get(r.arrayId)
      if (!m) return [r]
      const ni = m.get(r.index)
      return ni === undefined ? [] : [{ arrayId: r.arrayId, index: ni }]
    })
    return modules.length > 0 ? [{ ...o, props: { ...o.props, modules } }] : []
  })
}

const shift = (flat: number[], dx: number, dy: number) => flat.map((v, i) => (i % 2 === 0 ? v + dx : v + dy))

export function translateObjects(objs: LayoutObject[], ids: string[], dx: number, dy: number): LayoutObject[] {
  const s = new Set(ids)
  return objs.map((o): LayoutObject => {
    if (!s.has(o.id)) return o
    switch (o.kind) {
      case 'roof':
        return { ...o, geometry: { points: shift(o.geometry.points, dx, dy) } }
      case 'obstruction':
        return isCircleGeometry(o.geometry)
          ? { ...o, geometry: { ...o.geometry, cx: o.geometry.cx + dx, cy: o.geometry.cy + dy } }
          : { ...o, geometry: { points: shift(o.geometry.points, dx, dy) } }
      case 'array':
      case 'module_block':
        return { ...o, geometry: { modules: o.geometry.modules.map((q) => shift(q, dx, dy)) } }
      case 'inverter':
      case 'equipment':
        return { ...o, geometry: { x: o.geometry.x + dx, y: o.geometry.y + dy } }
      default:
        return o
    }
  })
}

/** A representative point of an object (image px), or null for a string. */
export function objectAnchor(o: LayoutObject): Pt | null {
  switch (o.kind) {
    case 'roof':
      return vertexMean(flatToPts(o.geometry.points))
    case 'obstruction':
      return isCircleGeometry(o.geometry) ? { x: o.geometry.cx, y: o.geometry.cy } : vertexMean(flatToPts(o.geometry.points))
    case 'array':
    case 'module_block':
      return o.geometry.modules.length ? vertexMean(o.geometry.modules.flatMap((q) => flatToPts(q))) : null
    case 'inverter':
    case 'equipment':
      return { x: o.geometry.x, y: o.geometry.y }
    default:
      return null
  }
}

export function selectionPivot(objs: LayoutObject[], ids: string[]): Pt | null {
  const pts = objs.filter((o) => ids.includes(o.id)).map(objectAnchor).filter((p): p is Pt => p !== null)
  return pts.length ? vertexMean(pts) : null
}

const rot = (flat: number[], pivot: Pt, deg: number) => ptsToFlat(flatToPts(flat).map((p) => rotateAbout(p, pivot, deg)))

/** Rotate about one pivot (the transformer's box centre), clockwise on screen. Facing and fall line turn with the geometry. */
export function rotateObjects(objs: LayoutObject[], ids: string[], deg: number, pivot: Pt): LayoutObject[] {
  const s = new Set(ids)
  return objs.map((o): LayoutObject => {
    if (!s.has(o.id)) return o
    switch (o.kind) {
      case 'roof':
        return {
          ...o,
          geometry: { points: rot(o.geometry.points, pivot, deg) },
          props: { ...o.props, fallBearingDeg: o.props.fallBearingDeg === null ? null : mod360(o.props.fallBearingDeg + deg) },
        }
      case 'obstruction': {
        if (isCircleGeometry(o.geometry)) {
          const c = rotateAbout({ x: o.geometry.cx, y: o.geometry.cy }, pivot, deg)
          return { ...o, geometry: { ...o.geometry, cx: c.x, cy: c.y } }
        }
        return { ...o, geometry: { points: rot(o.geometry.points, pivot, deg) } }
      }
      case 'array':
      case 'module_block':
        return {
          ...o,
          geometry: { modules: o.geometry.modules.map((q) => rot(q, pivot, deg)) },
          props: { ...o.props, facingSheetDeg: mod360(o.props.facingSheetDeg + deg) },
        }
      case 'inverter':
      case 'equipment': {
        const p = rotateAbout({ x: o.geometry.x, y: o.geometry.y }, pivot, deg)
        return { ...o, geometry: { x: p.x, y: p.y } }
      }
      default:
        return o
    }
  })
}

/** What to send: changed or new objects, and ids that are gone. */
export function diffObjects(saved: LayoutObject[], current: LayoutObject[]): { upserts: LayoutObject[]; deletes: string[] } {
  const before = new Map(saved.map((o) => [o.id, sig(o)]))
  const now = new Set(current.map((o) => o.id))
  return {
    upserts: current.filter((o) => before.get(o.id) !== sig(o)),
    deletes: saved.filter((o) => !now.has(o.id)).map((o) => o.id),
  }
}

/**
 * The object list the database will hold after a save — used server-side to
 * compute layouts.summary. Existing objects keep their stored scale (00212 pins
 * it); new ones take `newObjectPixelsPerMeter` (the sheet's current scale).
 */
export function applyObjectDelta(
  saved: LayoutObject[], upserts: LayoutObject[], deletes: string[], newObjectPixelsPerMeter: number | null,
): LayoutObject[] {
  const del = new Set(deletes)
  const up = new Map(upserts.map((o) => [o.id, o]))
  const out: LayoutObject[] = []
  for (const o of saved) {
    if (del.has(o.id)) continue
    const u = up.get(o.id)
    out.push(u ? ({ ...u, pixelsPerMeter: o.pixelsPerMeter } as LayoutObject) : o)
    up.delete(o.id)
  }
  for (const u of up.values()) out.push({ ...u, pixelsPerMeter: newObjectPixelsPerMeter } as LayoutObject)
  return out
}

/** Copy for Duplicate: new ids, every reference (roofId, inverterId, module arrayId) remapped. */
export function cloneLayoutObjects(objs: LayoutObject[], newId: () => string): LayoutObject[] {
  const ids = new Map(objs.map((o) => [o.id, newId()]))
  const map = (id: string) => ids.get(id) ?? id
  return objs.map((o): LayoutObject => {
    const id = map(o.id)
    if (isArrayObject(o)) return { ...o, id, props: { ...o.props, roofId: map(o.props.roofId) } }
    if (o.kind === 'string') {
      return { ...o, id, props: { ...o.props, inverterId: map(o.props.inverterId), modules: o.props.modules.map((m) => ({ arrayId: map(m.arrayId), index: m.index })) } }
    }
    return { ...o, id } as LayoutObject
  })
}
```

Append to `packages/shared/src/solar/layout/index.ts`:

```ts
export * from './doc'
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/doc.test.ts && pnpm --filter @esite/shared type-check`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/layout/doc.ts packages/shared/src/solar/layout/doc.test.ts packages/shared/src/solar/layout/index.ts
git commit -m "feat(solar-layout): pure editing ops — delete with string re-indexing, move, rotate, diff, clone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Error sentences and snapshot history

**Files:**
- Create: `apps/web/src/lib/solar/layout-errors.ts`
- Create: `apps/web/src/lib/solar/layout-history.ts`
- Test: `apps/web/src/lib/solar/layout-errors.test.ts`
- Test: `apps/web/src/lib/solar/layout-history.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/solar/layout-errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { humanLayoutError } from './layout-errors'

describe('humanLayoutError', () => {
  it('maps every 00212 sentence and never echoes a raw message', () => {
    expect(humanLayoutError({ code: '40001', message: 'solar.layouts: stale layout' })).toBe('Someone else changed this — reload to see their version.')
    expect(humanLayoutError({ code: '23514', message: 'solar.layout_objects: the roof source has no scale; calibrate this page first' }))
      .toBe('This drawing page has no scale yet — calibrate it before drawing.')
    expect(humanLayoutError({ code: '23514', message: 'solar.roof_sources: the drawing belongs to another project' })).toBe('That drawing belongs to another project.')
    expect(humanLayoutError({ code: '23514', message: 'solar.layout_objects: a DB symbol must link to a board' })).toBe('Link the DB symbol to a board.')
    expect(humanLayoutError({ code: '23505', message: 'duplicate key value violates unique constraint "layouts_study_name_key"' })).toBe('A layout with that name already exists.')
    expect(humanLayoutError({ code: '23505', message: 'duplicate key value violates unique constraint "roof_sources_drawing_page_key"' })).toBe('That drawing page is already a roof source.')
    expect(humanLayoutError({ code: '23503', message: 'update or delete on table "roof_sources" violates foreign key constraint "layouts_roof_source_id_fkey" on table "layouts"' }))
      .toBe('This roof source is used by a layout — delete the layout first.')
    expect(humanLayoutError({ code: '23503', message: 'update or delete on table "layouts" violates foreign key constraint "cases_layout_id_fkey" on table "cases"' }))
      .toBe('Used by a case — change the case first.')
    expect(humanLayoutError({ code: '42501', message: 'solar.layouts: you cannot edit this layout' })).toBe('You do not have permission to do that.')
    expect(humanLayoutError({ code: 'XX000', message: 'internal detail' })).toBe('Something went wrong — try again.')
  })
  it('a unique violation elsewhere does NOT become the access-request sentence', () => {
    expect(humanLayoutError({ code: '23505', message: 'something else' })).toBe('Something went wrong — try again.')
  })
})
```

`apps/web/src/lib/solar/layout-history.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { emptyHistory, pushHistory, undoHistory, redoHistory, HISTORY_LIMIT } from './layout-history'

describe('snapshot history', () => {
  it('push / undo / redo, with a no-change push ignored and redo discarded on a new push', () => {
    let h = emptyHistory([1])
    h = pushHistory(h, [1])
    expect(h.canUndo).toBe(false)
    h = pushHistory(h, [1, 2])
    h = pushHistory(h, [1, 2, 3])
    h = undoHistory(h)
    expect(h.present).toEqual([1, 2])
    expect(h.canRedo).toBe(true)
    h = redoHistory(h)
    expect(h.present).toEqual([1, 2, 3])
    h = undoHistory(undoHistory(h))
    h = pushHistory(h, [9])
    expect(h.canRedo).toBe(false)
    expect(h.past).toEqual([[1]])
  })
  it('is bounded', () => {
    let h = emptyHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i)
    expect(h.past.length).toBe(HISTORY_LIMIT)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/lib/solar/layout-errors.test.ts src/lib/solar/layout-history.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/solar/layout-errors.ts`:

```ts
/**
 * Errors from 00212 (roof sources, layouts, layout objects, the save RPC) → one
 * human sentence (spec §0.4 rule 5). Keyed on SQLSTATE plus the exact sentences
 * the bind triggers raise. Falls back to humanSolarError EXCEPT for 23505, whose
 * generic mapping there is the access-request sentence.
 */
import { GENERIC_ERROR, STALE_MESSAGE, humanSolarError } from './errors'

export function humanLayoutError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  const code = err?.code
  if (code === '40001' || m.includes('stale layout')) return STALE_MESSAGE
  if (m.includes('has no scale')) return 'This drawing page has no scale yet — calibrate it before drawing.'
  if (m.includes('drawing belongs to another project')) return 'That drawing belongs to another project.'
  if (m.includes('no longer active')) return 'That drawing has been removed from the project.'
  if (m.includes('stored under another project')) return 'The satellite image does not belong to this project.'
  if (m.includes('sheet of a roof source cannot change')) return 'A roof source keeps its sheet — add a new roof source instead.'
  if (m.includes('stays on the sheet')) return 'A layout stays on the sheet it was drawn on.'
  if (m.includes('roof source belongs to another study')) return 'That roof source belongs to another project.'
  if (m.includes('DB symbol must link to a board')) return 'Link the DB symbol to a board.'
  if (m.includes('equipment board belongs to another project')) return 'That board belongs to another project.'
  if (m.includes('belongs to another layout or changed kind')) return STALE_MESSAGE
  if (code === '23505' && m.includes('layouts_study_name_key')) return 'A layout with that name already exists.'
  if (code === '23505' && m.includes('roof_sources_drawing_page_key')) return 'That drawing page is already a roof source.'
  // "cases" first: a layout-delete FK message names both tables.
  if (code === '23503' && m.includes('"cases"')) return 'Used by a case — change the case first.'
  if (code === '23503' && m.includes('"layouts"')) return 'This roof source is used by a layout — delete the layout first.'
  if (code === 'P0002') return 'This layout no longer exists — reload.'
  if (code === '23505') return GENERIC_ERROR
  return humanSolarError(err)
}
```

`apps/web/src/lib/solar/layout-history.ts`:

```ts
/**
 * Undo/redo for the layout canvas — a history of SNAPSHOTS of the object list
 * (the lib/cable-route/route-history.ts pattern). One drag, one placed array or
 * one property edit is one step (functional spec §6.3). Pure.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
  canUndo: boolean
  canRedo: boolean
}

export const HISTORY_LIMIT = 100

function build<T>(past: T[], present: T, future: T[]): History<T> {
  return { past, present, future, canUndo: past.length > 0, canRedo: future.length > 0 }
}

export function emptyHistory<T>(present: T): History<T> {
  return build([], present, [])
}

export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (JSON.stringify(h.present) === JSON.stringify(next)) return h
  const past = [...h.past, h.present]
  return build(past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, next, [])
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  return build(h.past.slice(0, -1), h.past[h.past.length - 1]!, [h.present, ...h.future])
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const [next, ...rest] = h.future
  return build([...h.past, h.present], next!, rest)
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter web exec vitest run src/lib/solar/layout-errors.test.ts src/lib/solar/layout-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/layout-errors.ts apps/web/src/lib/solar/layout-errors.test.ts apps/web/src/lib/solar/layout-history.ts apps/web/src/lib/solar/layout-history.test.ts
git commit -m "feat(solar-layout): error sentences for 00212 and snapshot undo/redo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Configurable fit keys on the shared viewport

Solar's spec binds `F` to Auto-fill; the shared viewport binds `F`/`0` to Fit (`use-sheet-viewport.ts:314-330`). The default stays `F`/`0` so the markup and route canvases are unchanged; `SolarCanvas` passes `['0']`.

**Files:**
- Modify: `apps/web/src/lib/sheet/viewport-math.ts` (append)
- Modify: `apps/web/src/lib/sheet/use-sheet-viewport.ts:26-40` (signature) and `:314-330` (key handler)
- Test: `apps/web/src/lib/sheet/viewport-math.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

Append to `apps/web/src/lib/sheet/viewport-math.test.ts`:

```ts
import { viewportKeyAction, DEFAULT_FIT_KEYS } from './viewport-math'

describe('viewportKeyAction', () => {
  it('defaults: F, f and 0 fit; + = zoom in; - _ zoom out', () => {
    expect(DEFAULT_FIT_KEYS).toEqual(['f', 'F', '0'])
    expect(viewportKeyAction('f', DEFAULT_FIT_KEYS)).toBe('fit')
    expect(viewportKeyAction('0', DEFAULT_FIT_KEYS)).toBe('fit')
    expect(viewportKeyAction('=', DEFAULT_FIT_KEYS)).toBe('in')
    expect(viewportKeyAction('_', DEFAULT_FIT_KEYS)).toBe('out')
    expect(viewportKeyAction('x', DEFAULT_FIT_KEYS)).toBeNull()
  })
  it('a canvas that needs F for a tool keeps only 0 for fit', () => {
    expect(viewportKeyAction('f', ['0'])).toBeNull()
    expect(viewportKeyAction('F', ['0'])).toBeNull()
    expect(viewportKeyAction('0', ['0'])).toBe('fit')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/lib/sheet/viewport-math.test.ts`
Expected: FAIL — `viewportKeyAction` not exported.

- [ ] **Step 3: Implement the pure function (append to `viewport-math.ts`)**

```ts
/** The keys that fit the sheet unless a canvas needs one of them for a tool. */
export const DEFAULT_FIT_KEYS: readonly string[] = ['f', 'F', '0']

/** What a key does to the viewport, or null. Pure so the rule is testable without a DOM. */
export function viewportKeyAction(key: string, fitKeys: readonly string[]): 'fit' | 'in' | 'out' | null {
  if (fitKeys.includes(key)) return 'fit'
  if (key === '+' || key === '=') return 'in'
  if (key === '-' || key === '_') return 'out'
  return null
}
```

- [ ] **Step 4: Use it in the hook**

In `apps/web/src/lib/sheet/use-sheet-viewport.ts`:

1. Change the import line `import { fitTransform, zoomAbout } from './viewport-math'` to
   `import { DEFAULT_FIT_KEYS, fitTransform, viewportKeyAction, zoomAbout } from './viewport-math'`.
2. In the parameter destructuring add `fitKeys = DEFAULT_FIT_KEYS,` after `onPinchStart,`, and in the parameter type add after the `onPinchStart?` line:

```ts
  /** Keys that fit the sheet. Default F, f, 0; a canvas that binds F to a tool passes ['0']. */
  fitKeys?: readonly string[]
```

3. Replace the key-handler body block

```ts
      if (e.key === 'f' || e.key === 'F' || e.key === '0') {
        e.preventDefault()
        fitToView()
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomOut()
      }
```

with

```ts
      const act = viewportKeyAction(e.key, fitKeys)
      if (act === null) return
      e.preventDefault()
      if (act === 'fit') fitToView()
      else if (act === 'in') zoomIn()
      else zoomOut()
```

4. In that effect's dependency array add `fitKeys.join('|')` — i.e. `}, [fitToView, zoomIn, zoomOut, fitKeys.join('|')])` — so a new array identity each render does not re-bind (eslint's exhaustive-deps accepts a derived string; if it warns, hoist `const fitKeysKey = fitKeys.join('|')` above the effect and use it both inside (`fitKeysKey.split('|')`) and in the deps).

- [ ] **Step 5: Run the sheet and canvas tests**

Run: `pnpm --filter web exec vitest run src/lib/sheet src/app/\(admin\)/projects/\[id\]/floor-plans src/app/\(admin\)/projects/\[id\]/cables`
Expected: PASS (behaviour unchanged for both existing canvases, including `viewer-has-no-route-mode.contract.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sheet/viewport-math.ts apps/web/src/lib/sheet/viewport-math.test.ts apps/web/src/lib/sheet/use-sheet-viewport.ts
git commit -m "feat(sheet): configurable fit keys so a canvas can bind F to a tool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server loaders (JSON only) and the readiness aggregate

**Files:**
- Create: `apps/web/src/lib/solar/layout-loader.ts`
- Create: `apps/web/src/lib/solar/layout-readiness.ts`
- Test: `apps/web/src/lib/solar/layout-loader.test.ts`
- Test: `apps/web/src/lib/solar/layout-readiness.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/solar/layout-loader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { loadRoofSources, loadLayoutEditor, scaleForSource } from './layout-loader'
import { fakeSupabase } from '@/test/fake-supabase'
import { GENERIC_MODULE_550 } from '@esite/shared'

const P = 'p1'
const tables = {
  'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1', latitude: -26.2, longitude: 28.05 }],
  'solar.roof_sources': [
    { id: 'rs1', project_id: P, study_id: 's1', kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, file_path: 'a/v1.pdf', north_bearing_deg: 10, storage_path: null, m_per_px: null, attribution: null, updated_at: 'T1' },
    { id: 'rs2', project_id: P, study_id: 's1', kind: 'drawing', floor_plan_id: 'fp1', page_index: 2, file_path: 'a/v1.pdf', north_bearing_deg: null, storage_path: null, m_per_px: null, attribution: null, updated_at: 'T1' },
    { id: 'rs3', project_id: P, study_id: 's1', kind: 'satellite', floor_plan_id: null, page_index: 1, file_path: null, north_bearing_deg: 0, storage_path: 'o1/p1/sat.png', m_per_px: 0.05, attribution: '© Mapbox', updated_at: 'T1' },
  ],
  'tenants.floor_plans': [{ id: 'fp1', name: 'Roof', file_path: 'a/v2.pdf', pixels_per_meter: 50 }],
  'tenants.floor_plan_page_scales': [],
  'solar.layouts': [{ id: 'L1', project_id: P, name: 'A', roof_source_id: 'rs1', module_spec: GENERIC_MODULE_550, default_tilt_deg: 10, design_t_min_c: -5, design_t_amb_max_c: 35, summary: { dcKwp: 1.1 }, updated_at: 'T2' }],
  'solar.layout_objects': [{ id: 'o1', layout_id: 'L1', kind: 'inverter', geometry: { x: 1, y: 2 }, props: { name: 'I' }, pixels_per_meter: 50 }],
  'structure.nodes': [{ id: 'n1', project_id: P, code: 'MB1', name: 'Main', status: 'active' }],
  'solar.org_settings': [{ organisation_id: 'o1', settings: { version: 1, values: { edge_setback_flat_m: 0.6 } } }],
}

describe('scaleForSource', () => {
  it('page 1 uses the drawing scale, page 2 needs its own, satellite is 1 / m per px', () => {
    expect(scaleForSource({ kind: 'drawing', page_index: 1, floor_plan_id: 'fp1', m_per_px: null }, new Map([['fp1', 50]]), new Map())).toBe(50)
    expect(scaleForSource({ kind: 'drawing', page_index: 2, floor_plan_id: 'fp1', m_per_px: null }, new Map([['fp1', 50]]), new Map())).toBeNull()
    expect(scaleForSource({ kind: 'drawing', page_index: 2, floor_plan_id: 'fp1', m_per_px: null }, new Map([['fp1', 50]]), new Map([['fp1#2', 25]]))).toBe(25)
    expect(scaleForSource({ kind: 'satellite', page_index: 1, floor_plan_id: null, m_per_px: 0.05 }, new Map(), new Map())).toBe(20)
  })
})

describe('loadRoofSources', () => {
  it('labels, scale, north and the drawing-changed flag', async () => {
    const { client } = fakeSupabase({ tables })
    const r = await loadRoofSources(client as never, P)
    expect(r.studyId).toBe('s1')
    expect(r.sources.map((s) => [s.id, s.label, s.pixelsPerMeter, s.northSet, s.drawingChanged])).toEqual([
      ['rs1', 'Roof · page 1', 50, true, true],
      ['rs2', 'Roof · page 2', null, false, true],
      ['rs3', 'Satellite capture', 20, true, false],
    ])
  })
})

describe('loadLayoutEditor', () => {
  it('returns JSON the client can take, with a signed sheet URL and org defaults', async () => {
    const { client } = fakeSupabase({ tables })
    const sign = vi.fn(async (bucket: string, path: string) => `https://signed/${bucket}/${path}`)
    const d = await loadLayoutEditor(client as never, client as never, P, 'L1', sign)
    expect(d).not.toBeNull()
    expect(d!.source.sheet).toEqual({ key: 'rs1', signedUrl: 'https://signed/drawings/a/v2.pdf', isPdf: true, pageIndex: 1 })
    expect(d!.sheetPixelsPerMeter).toBe(50)
    expect(d!.drawingChanged).toBe(true)
    expect(d!.objects).toEqual([{ id: 'o1', kind: 'inverter', geometry: { x: 1, y: 2 }, props: { name: 'I' }, pixelsPerMeter: 50 }])
    expect(d!.setbackDefaults.flatM).toBe(0.6)
    expect(d!.shadeFree).toEqual({ fromHour: 9, toHour: 15 })
    expect(d!.nodes).toEqual([{ id: 'n1', label: 'MB1 — Main' }])
    expect(JSON.parse(JSON.stringify(d))).toEqual(d) // nothing a client component cannot receive
  })
  it('null for a layout of another project', async () => {
    const { client } = fakeSupabase({ tables })
    expect(await loadLayoutEditor(client as never, client as never, 'other', 'L1', vi.fn())).toBeNull()
  })
})
```

`apps/web/src/lib/solar/layout-readiness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadLayoutReadiness } from './layout-readiness'
import { fakeSupabase } from '@/test/fake-supabase'

describe('loadLayoutReadiness', () => {
  it('aggregates layouts.summary and the north of every roof source a layout uses', async () => {
    const { client } = fakeSupabase({ tables: {
      'solar.layouts': [
        { project_id: 'p', roof_source_id: 'rs1', summary: { arraysWithModules: 2, arrayOutsideRoof: false } },
        { project_id: 'p', roof_source_id: 'rs2', summary: { arraysWithModules: 1, arrayOutsideRoof: true } },
      ],
      'solar.roof_sources': [{ id: 'rs1', project_id: 'p', north_bearing_deg: 0 }, { id: 'rs2', project_id: 'p', north_bearing_deg: null }],
    } })
    expect(await loadLayoutReadiness(client as never, 'p')).toEqual({ layouts: 2, arraysWithModules: 3, northSet: false, arrayOutsideRoof: true })
  })
  it('no layouts → zero counts', async () => {
    const { client } = fakeSupabase({ tables: {} })
    expect(await loadLayoutReadiness(client as never, 'p')).toEqual({ layouts: 0, arraysWithModules: 0, northSet: false, arrayOutsideRoof: false })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/lib/solar/layout-loader.test.ts src/lib/solar/layout-readiness.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the loader**

`apps/web/src/lib/solar/layout-loader.ts`:

```ts
import 'server-only'
/**
 * Loaders for the Layout tab. Everything returned is JSON: a page hands it to a
 * 'use client' component, and a function prop across that boundary compiles
 * and fails at render (the PR #201 lesson). Reads go through the CALLER's
 * session so 00212's solar_can_view decides; only solar.org_settings (owner/
 * admin RLS, not secret) is read with the service client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings, type LayoutModuleSpec, type LayoutObject } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type SignUrl = (bucket: string, path: string) => Promise<string | null>

export interface RoofSourceRow {
  id: string
  kind: 'drawing' | 'satellite'
  floorPlanId: string | null
  pageIndex: number
  label: string
  pixelsPerMeter: number | null
  northBearingDeg: number | null
  northSet: boolean
  drawingChanged: boolean
  attribution: string | null
  updatedAt: string
}

type SourceDb = {
  id: string; kind: 'drawing' | 'satellite'; floor_plan_id: string | null; page_index: number; file_path: string | null
  north_bearing_deg: number | string | null; storage_path: string | null; m_per_px: number | string | null
  attribution: string | null; updated_at: string
}
const SOURCE_COLS = 'id, kind, floor_plan_id, page_index, file_path, north_bearing_deg, storage_path, m_per_px, attribution, updated_at'
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** The scale 00212's layout_objects_bind would stamp: page scale, else page 1 → drawing, satellite → 1 / m per px. */
export function scaleForSource(
  s: { kind: string; page_index: number; floor_plan_id: string | null; m_per_px: number | string | null },
  drawingScale: Map<string, number | null>,
  pageScale: Map<string, number>,
): number | null {
  if (s.kind === 'satellite') {
    const m = num(s.m_per_px)
    return m && m > 0 ? 1 / m : null
  }
  if (!s.floor_plan_id) return null
  const page = pageScale.get(`${s.floor_plan_id}#${s.page_index}`)
  if (page) return page
  return s.page_index === 1 ? (drawingScale.get(s.floor_plan_id) ?? null) : null
}

async function sourcesWithScales(supabase: AnyClient, rows: SourceDb[]) {
  const fpIds = [...new Set(rows.map((r) => r.floor_plan_id).filter((x): x is string => !!x))]
  const [{ data: plans }, { data: pages }] = await Promise.all([
    fpIds.length ? supabase.schema('tenants').from('floor_plans').select('id, name, file_path, pixels_per_meter').in('id', fpIds) : Promise.resolve({ data: [] }),
    fpIds.length ? supabase.schema('tenants').from('floor_plan_page_scales').select('floor_plan_id, page_index, pixels_per_meter').in('floor_plan_id', fpIds) : Promise.resolve({ data: [] }),
  ])
  const planRows = (plans ?? []) as Array<{ id: string; name: string; file_path: string; pixels_per_meter: number | string | null }>
  const planById = new Map(planRows.map((p) => [p.id, p]))
  const drawingScale = new Map(planRows.map((p) => [p.id, num(p.pixels_per_meter)]))
  const pageScale = new Map(((pages ?? []) as Array<{ floor_plan_id: string; page_index: number; pixels_per_meter: number | string }>)
    .map((p) => [`${p.floor_plan_id}#${p.page_index}`, Number(p.pixels_per_meter)]))
  const out: Array<RoofSourceRow & { currentFilePath: string | null; storagePath: string | null }> = rows.map((r) => {
    const plan = r.floor_plan_id ? planById.get(r.floor_plan_id) : undefined
    const north = num(r.north_bearing_deg)
    return {
      id: r.id,
      kind: r.kind,
      floorPlanId: r.floor_plan_id,
      pageIndex: r.page_index,
      label: r.kind === 'satellite' ? 'Satellite capture' : `${plan?.name ?? 'Drawing'} · page ${r.page_index}`,
      pixelsPerMeter: scaleForSource(r, drawingScale, pageScale),
      northBearingDeg: north,
      northSet: north !== null,
      drawingChanged: r.kind === 'drawing' && !!plan && plan.file_path !== r.file_path,
      attribution: r.attribution,
      updatedAt: r.updated_at,
      currentFilePath: plan?.file_path ?? null,
      storagePath: r.storage_path,
    }
  })
  return out
}

export async function loadRoofSources(supabase: AnyClient, projectId: string): Promise<{ studyId: string | null; sources: RoofSourceRow[] }> {
  const [{ data: study }, { data: rows }] = await Promise.all([
    supabase.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle(),
    supabase.schema('solar').from('roof_sources').select(SOURCE_COLS).eq('project_id', projectId).order('created_at'),
  ])
  const full = await sourcesWithScales(supabase, (rows ?? []) as SourceDb[])
  return {
    studyId: (study as { id?: string } | null)?.id ?? null,
    sources: full.map(({ currentFilePath: _c, storagePath: _s, ...r }) => r),
  }
}

export interface LayoutListRow {
  id: string
  name: string
  roofSourceId: string
  dcKwp: number | null
  moduleCount: number | null
  updatedAt: string
}

export async function loadLayoutList(supabase: AnyClient, projectId: string): Promise<LayoutListRow[]> {
  const { data } = await supabase.schema('solar').from('layouts')
    .select('id, name, roof_source_id, summary, updated_at').eq('project_id', projectId).order('name')
  return ((data ?? []) as Array<{ id: string; name: string; roof_source_id: string; summary: Record<string, unknown> | null; updated_at: string }>)
    .map((l) => ({
      id: l.id, name: l.name, roofSourceId: l.roof_source_id,
      dcKwp: num(l.summary?.dcKwp), moduleCount: num(l.summary?.moduleCount), updatedAt: l.updated_at,
    }))
}

export interface LayoutEditorData {
  projectId: string
  layout: { id: string; name: string; updatedAt: string; moduleSpec: LayoutModuleSpec; defaultTiltDeg: number; tMinC: number; tAmbMaxC: number }
  source: RoofSourceRow & { sheet: { key: string; signedUrl: string | null; isPdf: boolean; pageIndex: number } }
  sheetPixelsPerMeter: number | null
  drawingChanged: boolean
  objects: LayoutObject[]
  latitude: number | null
  shadeFree: { fromHour: number; toHour: number }
  setbackDefaults: { flatM: number; pitchedM: number }
  nodes: Array<{ id: string; label: string }>
}

export async function loadLayoutEditor(
  supabase: AnyClient, service: AnyClient, projectId: string, layoutId: string, sign: SignUrl,
): Promise<LayoutEditorData | null> {
  const { data: layout } = await supabase.schema('solar').from('layouts')
    .select('id, project_id, name, roof_source_id, module_spec, default_tilt_deg, design_t_min_c, design_t_amb_max_c, updated_at')
    .eq('id', layoutId).eq('project_id', projectId).maybeSingle()
  const l = layout as {
    id: string; name: string; roof_source_id: string; module_spec: LayoutModuleSpec; default_tilt_deg: number | string
    design_t_min_c: number | string; design_t_amb_max_c: number | string; updated_at: string
  } | null
  if (!l) return null

  const [{ data: srcRows }, { data: objRows }, { data: study }, { data: nodeRows }] = await Promise.all([
    supabase.schema('solar').from('roof_sources').select(SOURCE_COLS).eq('id', l.roof_source_id),
    supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', l.id),
    supabase.schema('solar').from('studies').select('latitude, organisation_id').eq('project_id', projectId).maybeSingle(),
    supabase.schema('structure').from('nodes').select('id, code, name').eq('project_id', projectId).eq('status', 'active').order('code'),
  ])
  const [src] = await sourcesWithScales(supabase, (srcRows ?? []) as SourceDb[])
  if (!src) return null

  const isPdf = src.kind === 'drawing' && /\.pdf$/i.test(src.currentFilePath ?? '')
  const signedUrl = src.kind === 'satellite'
    ? (src.storagePath ? await sign('solar-roof-images', src.storagePath) : null)
    : (src.currentFilePath ? await sign('drawings', src.currentFilePath) : null)

  const orgId = (study as { organisation_id?: string } | null)?.organisation_id ?? null
  const { data: settingsRow } = orgId
    ? await service.schema('solar').from('org_settings').select('settings').eq('organisation_id', orgId).maybeSingle()
    : { data: null }
  const settings = readSolarOrgSettings((settingsRow as { settings?: unknown } | null)?.settings)
  const n = (k: string, d: number) => (typeof settings[k] === 'number' ? (settings[k] as number) : d)

  const { currentFilePath: _c, storagePath: _s, ...sourceRow } = src
  return {
    projectId,
    layout: {
      id: l.id, name: l.name, updatedAt: l.updated_at, moduleSpec: l.module_spec,
      defaultTiltDeg: Number(l.default_tilt_deg), tMinC: Number(l.design_t_min_c), tAmbMaxC: Number(l.design_t_amb_max_c),
    },
    source: { ...sourceRow, sheet: { key: src.id, signedUrl, isPdf, pageIndex: src.pageIndex } },
    sheetPixelsPerMeter: src.pixelsPerMeter,
    drawingChanged: src.drawingChanged,
    objects: ((objRows ?? []) as Array<{ id: string; kind: string; geometry: unknown; props: unknown; pixels_per_meter: number | string | null }>)
      .map((o) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props, pixelsPerMeter: num(o.pixels_per_meter) }) as LayoutObject),
    latitude: num((study as { latitude?: unknown } | null)?.latitude),
    shadeFree: { fromHour: n('row_spacing_shade_free_from_hour', 9), toHour: n('row_spacing_shade_free_to_hour', 15) },
    setbackDefaults: { flatM: n('edge_setback_flat_m', 0.5), pitchedM: n('edge_setback_pitched_m', 0.3) },
    nodes: ((nodeRows ?? []) as Array<{ id: string; code: string; name: string | null }>)
      .map((x) => ({ id: x.id, label: x.name ? `${x.code} — ${x.name}` : x.code })),
  }
}
```

- [ ] **Step 4: Implement the readiness aggregate**

`apps/web/src/lib/solar/layout-readiness.ts`:

```ts
import 'server-only'
/**
 * The Layout readiness step from solar.layouts.summary (a server-computed cache,
 * 00212) and the roof sources' north — never the geometry, so the tab dot costs
 * two small reads on every Solar page. Returns null on a read error (the step
 * then stays grey rather than guessing).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LayoutReadinessInput } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function loadLayoutReadiness(supabase: AnyClient, projectId: string): Promise<LayoutReadinessInput | null> {
  const [lr, rr] = await Promise.all([
    supabase.schema('solar').from('layouts').select('roof_source_id, summary').eq('project_id', projectId),
    supabase.schema('solar').from('roof_sources').select('id, north_bearing_deg').eq('project_id', projectId),
  ])
  if (lr.error || rr.error) return null
  const layouts = (lr.data ?? []) as Array<{ roof_source_id: string; summary: Record<string, unknown> | null }>
  const north = new Map(((rr.data ?? []) as Array<{ id: string; north_bearing_deg: unknown }>).map((r) => [r.id, r.north_bearing_deg !== null]))
  return {
    layouts: layouts.length,
    arraysWithModules: layouts.reduce((s, l) => s + (Number(l.summary?.arraysWithModules) || 0), 0),
    northSet: layouts.length > 0 && layouts.every((l) => north.get(l.roof_source_id) === true),
    arrayOutsideRoof: layouts.some((l) => l.summary?.arrayOutsideRoof === true),
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter web exec vitest run src/lib/solar/layout-loader.test.ts src/lib/solar/layout-readiness.test.ts`
Expected: PASS. (`fakeSupabase` ignores `.order()`; its `in` filter is what the loader uses for plans and page scales.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/solar/layout-loader.ts apps/web/src/lib/solar/layout-loader.test.ts apps/web/src/lib/solar/layout-readiness.ts apps/web/src/lib/solar/layout-readiness.test.ts
git commit -m "feat(solar-layout): JSON-only loaders for roof sources, layouts, the editor and readiness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Roof source actions (add drawing, remove, set north)

**Files:**
- Create: `apps/web/src/actions/solar-roof-sources.actions.ts`
- Test: `apps/web/src/actions/solar-roof-sources.actions.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/actions/solar-roof-sources.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { addDrawingRoofSourceAction, removeRoofSourceAction, setRoofNorthAction } from './solar-roof-sources.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const FP = '22222222-2222-4222-8222-222222222222'
const RS = '33333333-3333-4333-8333-333333333333'

function setup(o: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables: { 'solar.studies': [{ id: 's1', project_id: P }] }, ...o })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('addDrawingRoofSourceAction', () => {
  it('re-checks Edit and inserts through the session (the trigger stamps the anchor)', async () => {
    const { calls } = setup({ writes: { 'solar.roof_sources:insert': { data: [{ id: RS }] } } })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 2 })).resolves.toEqual({ ok: true, id: RS })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(calls, 'solar.roof_sources', 'insert')[0]!.payload).toEqual({ study_id: 's1', kind: 'drawing', floor_plan_id: FP, page_index: 2 })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'roof_source_added', objectRef: { roofSourceId: RS } })
  })
  it('needs a study first', async () => {
    setup({ tables: {} })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 1 })).resolves.toEqual({ error: 'Save the site location in Site & Supply first.' })
  })
  it('refuses a malformed body with a sentence', async () => {
    setup()
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: 'x', pageIndex: 1 })).resolves.toEqual({ error: 'Choose a drawing.' })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 0 })).resolves.toEqual({ error: 'The page must be 1 or more.' })
  })
  it('maps a duplicate page', async () => {
    setup({ writes: { 'solar.roof_sources:insert': { error: { code: '23505', message: 'duplicate key value violates unique constraint "roof_sources_drawing_page_key"' } } } })
    await expect(addDrawingRoofSourceAction({ projectId: P, floorPlanId: FP, pageIndex: 1 })).resolves.toEqual({ error: 'That drawing page is already a roof source.' })
  })
})

describe('removeRoofSourceAction', () => {
  it('refuses when a layout uses it', async () => {
    setup({ writes: { 'solar.roof_sources:delete': { error: { code: '23503', message: 'update or delete on table "roof_sources" violates foreign key constraint "layouts_roof_source_id_fkey" on table "layouts"' } } } })
    await expect(removeRoofSourceAction({ projectId: P, roofSourceId: RS })).resolves.toEqual({ error: 'This roof source is used by a layout — delete the layout first.' })
  })
  it('reports when nothing was removed', async () => {
    setup({ writes: { 'solar.roof_sources:delete': { data: [] } } })
    await expect(removeRoofSourceAction({ projectId: P, roofSourceId: RS })).resolves.toEqual({ error: 'Nothing was removed — reload to see the current list.' })
  })
})

describe('setRoofNorthAction', () => {
  it('normalises the bearing and conditions on updated_at', async () => {
    const { calls } = setup({ writes: { 'solar.roof_sources:update': { data: [{ updated_at: 'T2' }] } } })
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: -30, points: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ ok: true, updatedAt: 'T2', bearingDeg: 330 })
    const c = callsTo(calls, 'solar.roof_sources', 'update')[0]!
    expect(c.payload).toEqual({ north_bearing_deg: 330, north_points: null })
    expect(c.filters).toEqual(expect.arrayContaining([['eq', 'id', RS], ['eq', 'project_id', P], ['eq', 'updated_at', 'T1']]))
  })
  it('stale when someone changed it', async () => {
    setup({ writes: { 'solar.roof_sources:update': { data: [] } } })
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: 0, points: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'Someone else changed this — reload to see their version.' })
  })
  it('refuses a non-number bearing and bad points', async () => {
    setup()
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: Number.NaN, points: null, expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'Enter north as degrees clockwise from the top of the sheet.' })
    await expect(setRoofNorthAction({ projectId: P, roofSourceId: RS, bearingDeg: 1, points: [1, 2, 3], expectedUpdatedAt: 'T1' }))
      .resolves.toEqual({ error: 'North is two points on the sheet.' })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/actions/solar-roof-sources.actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/actions/solar-roof-sources.actions.ts`:

```ts
'use server'
/**
 * Roof sources (functional spec §3.2 C). Each action re-checks Edit itself
 * (requireSolarLevel redirects a lower level to /solar/locked) and writes
 * through the caller's session: 00212's RLS decides who, roof_sources_bind
 * stamps the drawing anchor and binds the org. Calibration is NOT here — it is
 * calibrateFloorPlanAction (cable-route.actions.ts), role-gated per page.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { humanLayoutError } from '@/lib/solar/layout-errors'
import { mod360 } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

export async function addDrawingRoofSourceAction(input: { projectId: string; floorPlanId: string; pageIndex: number }):
  Promise<{ ok: true; id: string } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (typeof input.floorPlanId !== 'string' || !UUID.test(input.floorPlanId)) return { error: 'Choose a drawing.' }
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 1 || input.pageIndex > 500) return { error: 'The page must be 1 or more.' }
  const { data: study } = await supabase.schema('solar').from('studies').select('id').eq('project_id', input.projectId).maybeSingle()
  const studyId = (study as { id?: string } | null)?.id
  if (!studyId) return { error: 'Save the site location in Site & Supply first.' }
  const { data, error } = await supabase.schema('solar').from('roof_sources')
    .insert({ study_id: studyId, kind: 'drawing', floor_plan_id: input.floorPlanId, page_index: input.pageIndex })
    .select('id')
  if (error) return { error: humanLayoutError(error) }
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!id) return { error: 'Nothing was added — reload and try again.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'roof_source_added', objectRef: { roofSourceId: id } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id }
}

export async function removeRoofSourceAction(input: { projectId: string; roofSourceId: string }): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!UUID.test(String(input.roofSourceId))) return { error: 'Choose a roof source.' }
  const { data, error } = await supabase.schema('solar').from('roof_sources')
    .delete().eq('id', input.roofSourceId).eq('project_id', input.projectId).select('id')
  if (error) return { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was removed — reload to see the current list.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'roof_source_removed', objectRef: { roofSourceId: input.roofSourceId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

export async function setRoofNorthAction(input: {
  projectId: string; roofSourceId: string; bearingDeg: number; points: number[] | null; expectedUpdatedAt: string
}): Promise<{ ok: true; updatedAt: string; bearingDeg: number } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (typeof input.bearingDeg !== 'number' || !Number.isFinite(input.bearingDeg)) {
    return { error: 'Enter north as degrees clockwise from the top of the sheet.' }
  }
  if (input.points !== null && !(Array.isArray(input.points) && input.points.length === 4 && input.points.every((v) => typeof v === 'number' && Number.isFinite(v)))) {
    return { error: 'North is two points on the sheet.' }
  }
  const bearingDeg = Math.round(mod360(input.bearingDeg) * 100) / 100
  const { data, error } = await supabase.schema('solar').from('roof_sources')
    .update({ north_bearing_deg: bearingDeg, north_points: input.points })
    .eq('id', input.roofSourceId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt)
    .select('updated_at')
  if (error) return { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'roof_north_set', objectRef: { roofSourceId: input.roofSourceId, bearingDeg } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: data[0]!.updated_at as string, bearingDeg }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter web exec vitest run src/actions/solar-roof-sources.actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-roof-sources.actions.ts apps/web/src/actions/solar-roof-sources.actions.test.ts
git commit -m "feat(solar-layout): roof source actions — add drawing page, remove, set north (stale-refusing)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Satellite capture route (Mapbox, D-08) with the 503 path

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/solar/roof-sources/satellite/route.ts`
- Test: `apps/web/src/app/api/projects/[id]/solar/roof-sources/satellite/route.test.ts`
- Modify: `apps/web/.env.example` (append)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/app/api/projects/[id]/solar/roof-sources/satellite/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), getSolarAccessLevel: vi.fn(), rateLimit: vi.fn(() => true),
  audit: vi.fn(async () => {}), upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.getSolarAccessLevel }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))

import { POST } from './route'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const ORG = '99999999-9999-4999-8999-999999999999'
const ctx = { params: Promise.resolve({ id: P }) }
const req = (body: unknown = {}) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

function setup(o: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    userId: 'u1',
    tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: ORG, latitude: -26.2, longitude: 28.05 }] },
    writes: { 'solar.roof_sources:insert': { data: [{ id: 'rs-new' }] } },
    ...o,
  })
  h.createClient.mockResolvedValue(fake.client)
  h.createServiceClient.mockReturnValue({ storage: { from: () => ({ upload: h.upload, remove: h.remove }) } })
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MAPBOX_ACCESS_TOKEN = 'pk.test'
  h.getSolarAccessLevel.mockResolvedValue('edit')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } })))
})
afterEach(() => { vi.unstubAllGlobals(); delete process.env.MAPBOX_ACCESS_TOKEN })

describe('POST satellite capture', () => {
  it('503 before touching the session when the token is not configured', async () => {
    delete process.env.MAPBOX_ACCESS_TOKEN
    const res = await POST(req(), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Satellite capture is not configured' })
    expect(h.createClient).not.toHaveBeenCalled()
  })
  it('403 below Edit', async () => {
    setup()
    h.getSolarAccessLevel.mockResolvedValue('view')
    expect((await POST(req(), ctx)).status).toBe(403)
  })
  it('409 without a site location', async () => {
    setup({ tables: { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: ORG, latitude: null, longitude: null }] } })
    expect((await POST(req(), ctx)).status).toBe(409)
  })
  it('429 when rate limited', async () => {
    setup()
    h.rateLimit.mockReturnValueOnce(false)
    expect((await POST(req(), ctx)).status).toBe(429)
  })
  it('502 when Mapbox does not answer with an image', async () => {
    setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    expect((await POST(req(), ctx)).status).toBe(502)
  })
  it('201: stores the image under org/project, records m/px from the tile maths and the attribution', async () => {
    const { calls } = setup()
    const res = await POST(req({ zoom: 19 }), ctx)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ roofSourceId: 'rs-new' })
    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])
    expect(url).toContain('/static/28.05,-26.2,19,0,0/1280x1280@2x?access_token=pk.test')
    const path = (h.upload.mock.calls[0] as unknown[])[0] as string
    expect(path).toMatch(new RegExp(`^${ORG}/${P}/satellite-\\d+\\.png$`))
    const ins = callsTo(calls, 'solar.roof_sources', 'insert')[0]!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ study_id: 's1', kind: 'satellite', storage_path: path, attribution: '© Mapbox © OpenStreetMap © Maxar' })
    expect(ins.m_per_px as number).toBeCloseTo(0.0669763, 6)
  })
  it('removes the stored image when the row is refused', async () => {
    setup({ writes: { 'solar.roof_sources:insert': { error: { code: '42501', message: 'new row violates row-level security policy' } } } })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(403)
    expect(h.remove).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run "src/app/api/projects/[id]/solar/roof-sources/satellite/route.test.ts"`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Implement the route**

`apps/web/src/app/api/projects/[id]/solar/roof-sources/satellite/route.ts`:

```ts
/**
 * POST /api/projects/[id]/solar/roof-sources/satellite — capture a north-up
 * satellite picture of the site as a roof source (functional spec §3.2 C,
 * decision D-08: Mapbox, server-side, no html2canvas).
 *
 * app/api/* sits OUTSIDE (admin)/layout.tsx, so this route gates itself.
 * Order: token (503, before the session, so an unconfigured server is obvious
 * and cheap) → session (401) → Solar Edit (403) → rate limit (429) → site
 * location (409) → Mapbox (502) → service-role upload under <org>/<project>/ →
 * roof source row written through the CALLER's session so 00212's RLS and bind
 * trigger decide. A refused row removes its orphaned image.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { humanLayoutError } from '@/lib/solar/layout-errors'
import {
  MAPBOX_ATTRIBUTION, SATELLITE_CAPTURE, clampSatelliteZoom, mapboxStaticUrl, metresPerPixel, solarLevelAllows,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BYTES = 20 * 1024 * 1024
const BUCKET = 'solar-roof-images'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = process.env.MAPBOX_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'Satellite capture is not configured' }, { status: 503 })
  const { id: projectId } = await ctx.params
  if (!UUID.test(projectId)) return NextResponse.json({ error: 'Unknown project' }, { status: 400 })

  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You are not signed in.' }, { status: 401 })
  const level = await getSolarAccessLevel(projectId, supabase)
  if (!solarLevelAllows(level, 'edit')) return NextResponse.json({ error: 'You do not have Solar edit access on this project.' }, { status: 403 })
  if (!rateLimit(`solar-satellite:${user.id}`, 5, 60_000)) return NextResponse.json({ error: 'Too many captures — wait a minute.' }, { status: 429 })

  let body: { zoom?: unknown } = {}
  try { body = (await req.json()) as { zoom?: unknown } } catch { body = {} }
  const zoom = clampSatelliteZoom(Number(body.zoom ?? SATELLITE_CAPTURE.defaultZoom) || SATELLITE_CAPTURE.defaultZoom)

  const { data: study } = await supabase.schema('solar').from('studies')
    .select('id, organisation_id, latitude, longitude').eq('project_id', projectId).maybeSingle()
  const s = study as { id: string; organisation_id: string; latitude: number | string | null; longitude: number | string | null } | null
  const lat = s?.latitude == null ? null : Number(s.latitude)
  const lng = s?.longitude == null ? null : Number(s.longitude)
  if (!s || lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Set the site location in Site & Supply first.' }, { status: 409 })
  }

  let bytes: Uint8Array
  let contentType: string
  try {
    const res = await fetch(mapboxStaticUrl({ lat, lng, zoom, token }), { cache: 'no-store' })
    contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !/^image\/(png|jpeg)/.test(contentType)) {
      // The URL carries the token — never log it.
      console.error('[solar-satellite] mapbox refused', { status: res.status })
      return NextResponse.json({ error: 'The satellite service did not answer — try again.' }, { status: 502 })
    }
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'The satellite service did not answer — try again.' }, { status: 502 })
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: 'The satellite service did not answer — try again.' }, { status: 502 })
  }

  const ext = contentType.includes('png') ? 'png' : 'jpg'
  const path = `${s.organisation_id}/${projectId}/satellite-${Date.now()}.${ext}`
  const service = createServiceClient() as unknown as AnyClient
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false })
  if (upErr) return NextResponse.json({ error: 'Could not store the image — try again.' }, { status: 500 })

  const { data, error } = await supabase.schema('solar').from('roof_sources').insert({
    study_id: s.id,
    kind: 'satellite',
    storage_path: path,
    m_per_px: metresPerPixel(lat, zoom, SATELLITE_CAPTURE.retina),
    attribution: MAPBOX_ATTRIBUTION,
    capture_meta: { lat, lng, zoom, width: SATELLITE_CAPTURE.pixelSize, height: SATELLITE_CAPTURE.pixelSize, style: SATELLITE_CAPTURE.style },
  }).select('id')
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (error || !id) {
    await service.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: humanLayoutError(error) }, { status: error?.code === '42501' ? 403 : 400 })
  }
  await recordSolarAudit({ projectId, actorId: user.id, verb: 'roof_source_satellite_captured', objectRef: { roofSourceId: id, zoom } })
  return NextResponse.json({ roofSourceId: id }, { status: 201 })
}
```

- [ ] **Step 4: Document the env var**

Append to `apps/web/.env.example`:

```bash
# Solar satellite roof capture (decision D-08). SERVER-ONLY — never NEXT_PUBLIC_.
# Unset → POST /api/projects/[id]/solar/roof-sources/satellite answers 503
# "Satellite capture is not configured" and the Site & Supply button is disabled.
MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter web exec vitest run "src/app/api/projects/[id]/solar/roof-sources/satellite/route.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/api/projects/[id]/solar/roof-sources/satellite" apps/web/.env.example
git commit -m "feat(solar-layout): server-side Mapbox satellite capture as a roof source (503 when unconfigured)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Roof sources on Site & Supply (section C)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site/RoofSourcesPanel.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site/RoofSourcesPanel.test.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site/page.tsx`

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site/RoofSourcesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-roof-sources.actions', () => ({ addDrawingRoofSourceAction: h.add, removeRoofSourceAction: h.remove }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { RoofSourcesPanel } from './RoofSourcesPanel'
import type { RoofSourceRow } from '@/lib/solar/layout-loader'

const row: RoofSourceRow = {
  id: 'rs1', kind: 'drawing', floorPlanId: 'fp1', pageIndex: 1, label: 'Roof · page 1', pixelsPerMeter: 50,
  northBearingDeg: null, northSet: false, drawingChanged: false, attribution: null, updatedAt: 'T',
}
const base = { projectId: 'p1', drawings: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Roof plan' }], hasStudy: true, satelliteConfigured: true }

beforeEach(() => vi.clearAllMocks())

describe('RoofSourcesPanel', () => {
  it('empty state', () => {
    render(<RoofSourcesPanel {...base} canEdit sources={[]} />)
    expect(screen.getByText("Add the roof plan from the project's drawings")).toBeTruthy()
  })
  it('lists scale and north, links to the sheet', () => {
    render(<RoofSourcesPanel {...base} canEdit sources={[row]} />)
    expect(screen.getByText('Roof · page 1')).toBeTruthy()
    expect(screen.getByLabelText('Scale set')).toBeTruthy()
    expect(screen.getByLabelText('North not set')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open sheet' }).getAttribute('href')).toBe('/projects/p1/solar/layout/sources/rs1')
  })
  it('View level: no add, remove or capture', () => {
    render(<RoofSourcesPanel {...base} canEdit={false} sources={[row]} />)
    expect(screen.queryByRole('button', { name: 'Add roof drawing' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Capture satellite view' })).toBeNull()
  })
  it('adds a drawing page', async () => {
    h.add.mockResolvedValue({ ok: true, id: 'rs9' })
    render(<RoofSourcesPanel {...base} canEdit sources={[]} />)
    fireEvent.change(screen.getByLabelText('Drawing'), { target: { value: base.drawings[0]!.id } })
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add roof drawing' }))
    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ projectId: 'p1', floorPlanId: base.drawings[0]!.id, pageIndex: 2 }))
    expect(h.refresh).toHaveBeenCalled()
  })
  it('remove is two-step', async () => {
    h.remove.mockResolvedValue({ ok: true })
    render(<RoofSourcesPanel {...base} canEdit sources={[row]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(h.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith({ projectId: 'p1', roofSourceId: 'rs1' }))
  })
  it('satellite capture is disabled, with the reason, when not configured', () => {
    render(<RoofSourcesPanel {...base} canEdit sources={[]} satelliteConfigured={false} />)
    const b = screen.getByRole('button', { name: 'Capture satellite view' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(screen.getByText('Satellite capture is not configured on this server.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/site/RoofSourcesPanel.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

`apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site/RoofSourcesPanel.tsx`:

```tsx
'use client'
/**
 * Site & Supply — C. Roof sources (functional spec §3.2). Pick project drawings
 * (no upload here: uploads go through Floor Plans so Dropbox sync keeps
 * working), see scale and north per page, open the sheet to calibrate or set
 * north, or capture a satellite view (D-08). View level reads only.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SATELLITE_CAPTURE } from '@esite/shared'
import { addDrawingRoofSourceAction, removeRoofSourceAction } from '@/actions/solar-roof-sources.actions'
import type { RoofSourceRow } from '@/lib/solar/layout-loader'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

function Tick({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span aria-label={ok ? yes : no} style={{ color: ok ? 'var(--c-green, #16a34a)' : 'var(--c-red, #dc2626)' }}>{ok ? '✓' : '✗'}</span>
}

function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
  const { armed, arm, disarm } = useArmedConfirm()
  return armed
    ? <button type="button" onClick={() => { disarm(); onConfirm() }} style={{ color: '#dc2626' }}>Confirm remove</button>
    : <button type="button" onClick={arm}>Remove</button>
}

export function RoofSourcesPanel({
  projectId, canEdit, sources, drawings, hasStudy, satelliteConfigured,
}: {
  projectId: string
  canEdit: boolean
  sources: RoofSourceRow[]
  drawings: Array<{ id: string; name: string }>
  hasStudy: boolean
  satelliteConfigured: boolean
}) {
  const router = useRouter()
  const [drawingId, setDrawingId] = useState('')
  const [page, setPage] = useState('1')
  const [zoom, setZoom] = useState(String(SATELLITE_CAPTURE.defaultZoom))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true); setError(null)
    const res = await addDrawingRoofSourceAction({ projectId, floorPlanId: drawingId, pageIndex: Number(page) })
    setBusy(false)
    if ('error' in res) setError(res.error)
    else { setDrawingId(''); setPage('1'); router.refresh() }
  }
  async function remove(id: string) {
    setError(null)
    const res = await removeRoofSourceAction({ projectId, roofSourceId: id })
    if ('error' in res) setError(res.error)
    else router.refresh()
  }
  async function capture() {
    setBusy(true); setError(null)
    const res = await fetch(`/api/projects/${projectId}/solar/roof-sources/satellite`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zoom: Number(zoom) }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? 'Something went wrong — try again.')
    } else router.refresh()
  }

  const captureBlocked = !satelliteConfigured
    ? 'Satellite capture is not configured on this server.'
    : !hasStudy ? 'Save the site location above first.' : null

  return (
    <section aria-labelledby="roof-sources-h" style={{ marginTop: 24 }}>
      <h2 id="roof-sources-h" style={{ fontSize: 15, fontWeight: 600 }}>C. Roof sources</h2>
      {sources.length === 0 ? (
        <p style={{ color: 'var(--c-text-dim)' }}>Add the roof plan from the project&apos;s drawings</p>
      ) : (
        <table style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th align="left">Sheet</th><th>Scale</th><th>North</th><th /></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>{s.label}{s.drawingChanged && <span style={{ color: '#b45309' }}> · drawing changed</span>}</td>
                <td align="center"><Tick ok={s.pixelsPerMeter !== null} yes="Scale set" no="Scale not set" /></td>
                <td align="center"><Tick ok={s.northSet} yes="North set" no="North not set" /></td>
                <td align="right">
                  <Link href={`/projects/${projectId}/solar/layout/sources/${s.id}`}>Open sheet</Link>
                  {canEdit && <> · <RemoveButton onConfirm={() => void remove(s.id)} /></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', marginTop: 12 }}>
          <label>Drawing
            <select aria-label="Drawing" value={drawingId} onChange={(e) => setDrawingId(e.target.value)}>
              <option value="">Choose…</option>
              {drawings.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label>Page <input aria-label="Page" type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} style={{ width: 64 }} /></label>
          <button type="button" disabled={busy || !drawingId || !hasStudy} onClick={() => void add()}>Add roof drawing</button>
          <span style={{ width: 16 }} />
          <label>Zoom
            <select aria-label="Zoom" value={zoom} onChange={(e) => setZoom(e.target.value)}>
              {[17, 18, 19, 20].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || captureBlocked !== null} onClick={() => void capture()}>Capture satellite view</button>
          {captureBlocked && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{captureBlocked}</span>}
        </div>
      )}
      {!hasStudy && canEdit && <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Save the site location above before adding roof sources.</p>}
      {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
    </section>
  )
}
```

- [ ] **Step 4: Render it on the Site page**

In `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site/page.tsx`:

1. Add imports:

```tsx
import { loadRoofSources } from '@/lib/solar/layout-loader'
import { RoofSourcesPanel } from './RoofSourcesPanel'
```

2. Extend the `Promise.all` with two more reads (append inside the array):

```tsx
    loadRoofSources(supabase, id),
    supabase.schema('tenants').from('floor_plans').select('id, name, file_path')
      .eq('project_id', id).eq('is_active', true).order('name'),
```

and destructure them: `const [{ data: project }, { data: study }, { data: nodeRows }, roof, { data: planRows }] = await Promise.all([ … ])`.

3. Replace the `return ( <SiteSupplyForm … /> )` with:

```tsx
  const drawings = ((planRows ?? []) as Array<{ id: string; name: string; file_path: string }>)
    .filter((p) => /\.(pdf|png|jpe?g|webp)$/i.test(p.file_path))
    .map((p) => ({ id: p.id, name: p.name }))

  return (
    <>
      <SiteSupplyForm
        projectId={id}
        initialForm={siteSupplyFormFromRow(s)}
        updatedAt={(s?.updated_at as string | undefined) ?? null}
        canEdit={level !== 'view'}
        address={address}
        nodes={nodes}
        nmdPrefill={incomer ? { value: String(incomer.ratingKva), from: incomer.label } : null}
      />
      <RoofSourcesPanel
        projectId={id}
        canEdit={level !== 'view'}
        sources={roof.sources}
        drawings={drawings}
        hasStudy={roof.studyId !== null}
        satelliteConfigured={Boolean(process.env.MAPBOX_ACCESS_TOKEN)}
      />
    </>
  )
```

- [ ] **Step 5: Run the panel test and the existing Site test**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/site"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/site"
git commit -m "feat(solar-layout): Site & Supply section C — roof sources, satellite capture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Layout actions (create, duplicate, rename, delete, save)

**Files:**
- Create: `apps/web/src/actions/solar-layout.actions.ts`
- Test: `apps/web/src/actions/solar-layout.actions.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/actions/solar-layout.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GENERIC_MODULE_550 as M } from '@esite/shared'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { createLayoutAction, renameLayoutAction, deleteLayoutAction, saveLayoutObjectsAction, duplicateLayoutAction } from './solar-layout.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const RS = '33333333-3333-4333-8333-333333333333'
const L = '44444444-4444-4444-8444-444444444444'
const O = '55555555-5555-4555-8555-555555555555'
const STALE = 'Someone else changed this — reload to see their version.'

const TABLES = {
  'solar.studies': [{ id: 's1', project_id: P }],
  'solar.layouts': [{ id: L, project_id: P, study_id: 's1', name: 'Option A', roof_source_id: RS, module_spec: M, default_tilt_deg: 10, design_t_min_c: -5, design_t_amb_max_c: 35, updated_at: 'T1' }],
  'solar.roof_sources': [{ id: RS, project_id: P, kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, m_per_px: null }],
  'tenants.floor_plans': [{ id: 'fp1', pixels_per_meter: 10 }],
  'tenants.floor_plan_page_scales': [],
  'solar.layout_objects': [],
}
function setup(o: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables: TABLES, ...o })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

const roof = { id: O, kind: 'roof', geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
  props: { name: 'Main', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }

describe('createLayoutAction', () => {
  it('validates the name BEFORE saving, case-insensitively', async () => {
    const { calls } = setup()
    const res = await createLayoutAction({ projectId: P, name: '  option a ', roofSourceId: RS, module: M, defaultTiltDeg: 10 })
    expect(res).toEqual({ fieldErrors: { name: 'A layout with that name already exists.' } })
    expect(callsTo(calls, 'solar.layouts', 'insert')).toHaveLength(0)
  })
  it('refuses a bad module and tilt with field errors', async () => {
    setup()
    const res = await createLayoutAction({ projectId: P, name: 'B', roofSourceId: RS, module: { ...M, powerW: 0 }, defaultTiltDeg: 80 })
    expect(res).toEqual({ fieldErrors: { module: 'The module needs a positive power rating.', defaultTiltDeg: 'Tilt must be between 0° and 60°.' } })
  })
  it('inserts with the module snapshot', async () => {
    const { calls } = setup({ writes: { 'solar.layouts:insert': { data: [{ id: 'new' }] } } })
    await expect(createLayoutAction({ projectId: P, name: 'Option B', roofSourceId: RS, module: M, defaultTiltDeg: 12 })).resolves.toEqual({ ok: true, id: 'new' })
    expect(callsTo(calls, 'solar.layouts', 'insert')[0]!.payload).toEqual({ study_id: 's1', roof_source_id: RS, name: 'Option B', module_spec: M, default_tilt_deg: 12 })
  })
})

describe('renameLayoutAction / deleteLayoutAction', () => {
  it('rename is conditioned on updated_at', async () => {
    setup({ writes: { 'solar.layouts:update': { data: [] } } })
    await expect(renameLayoutAction({ projectId: P, layoutId: L, name: 'X', expectedUpdatedAt: 'T0' })).resolves.toEqual({ error: STALE })
  })
  it('delete maps a case FK to the spec sentence', async () => {
    setup({ writes: { 'solar.layouts:delete': { error: { code: '23503', message: 'update or delete on table "layouts" violates foreign key constraint "cases_layout_id_fkey" on table "cases"' } } } })
    await expect(deleteLayoutAction({ projectId: P, layoutId: L })).resolves.toEqual({ error: 'Used by a case — change the case first.' })
  })
})

describe('saveLayoutObjectsAction', () => {
  it('refuses a malformed object with its sentence and writes nothing', async () => {
    const { client } = setup()
    const res = await saveLayoutObjectsAction({ projectId: P, layoutId: L, expectedUpdatedAt: 'T1', upserts: [{ ...roof, id: 'bad' }], deletes: [] })
    expect(res).toEqual({ error: 'An object in the layout has an invalid id.' })
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('sends kind/geometry/props only (never a scale) and a server-computed summary', async () => {
    const { client } = setup({ rpc: { solar_save_layout_objects: { data: 'T2', error: null } } })
    const res = await saveLayoutObjectsAction({ projectId: P, layoutId: L, expectedUpdatedAt: 'T1', upserts: [{ ...roof, pixelsPerMeter: 999 }], deletes: [] })
    expect(res).toMatchObject({ ok: true, updatedAt: 'T2' })
    const args = (client.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0]![1]
    expect(args.p_upserts).toEqual([{ id: O, kind: 'roof', geometry: roof.geometry, props: roof.props }])
    expect(args.p_summary).toEqual({ moduleCount: 0, dcKwp: 0, acKw: 0, arraysWithModules: 0, arrayOutsideRoof: false, stringsFail: 0 })
    expect(args.p_expected_updated_at).toBe('T1')
  })
  it('stale maps to the stale sentence', async () => {
    setup({ rpc: { solar_save_layout_objects: { data: null, error: { code: '40001', message: 'solar.layouts: stale layout' } } } })
    await expect(saveLayoutObjectsAction({ projectId: P, layoutId: L, expectedUpdatedAt: 'T0', upserts: [], deletes: [] })).resolves.toEqual({ error: STALE })
  })
})

describe('duplicateLayoutAction', () => {
  it('creates the copy, then saves cloned objects into it', async () => {
    const { client, calls } = setup({
      tables: { ...TABLES, 'solar.layout_objects': [{ id: O, layout_id: L, kind: 'roof', geometry: roof.geometry, props: roof.props, pixels_per_meter: 10 }] },
      writes: { 'solar.layouts:insert': { data: [{ id: 'L2', updated_at: 'U1' }] } },
      rpc: { solar_save_layout_objects: { data: 'U2', error: null } },
    })
    await expect(duplicateLayoutAction({ projectId: P, layoutId: L, name: 'Option A (copy)' })).resolves.toEqual({ ok: true, id: 'L2' })
    expect(callsTo(calls, 'solar.layouts', 'insert')[0]!.payload).toMatchObject({ name: 'Option A (copy)', roof_source_id: RS })
    const args = (client.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0]![1]
    expect(args.p_layout_id).toBe('L2')
    expect((args.p_upserts as Array<{ id: string }>)[0]!.id).not.toBe(O)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/actions/solar-layout.actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/actions/solar-layout.actions.ts`:

```ts
'use server'
/**
 * Layouts (functional spec §6.2) and the save (§6.3 "Save"). Each action
 * re-checks Edit itself and writes through the caller's session. The save
 * goes through public.solar_save_layout_objects (00212): one transaction,
 * refused when updated_at moved (another tab / person), scale and anchor
 * stamped by the database. The summary stored with it is computed HERE from
 * the resulting object list — never taken from the browser.
 */
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { humanLayoutError } from '@/lib/solar/layout-errors'
import { scaleForSource } from '@/lib/solar/layout-loader'
import {
  applyObjectDelta, cloneLayoutObjects, layoutSummary, moduleSpecError, storedSummary, validateObjectInput,
  type LayoutModuleSpec, type LayoutObject,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_UPSERTS = 1000

export type LayoutResult<T = Record<string, never>> = ({ ok: true } & T) | { error: string } | { fieldErrors: Record<string, string> }

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

async function studyId(supabase: AnyClient, projectId: string): Promise<string | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

async function nameTaken(supabase: AnyClient, sid: string, name: string, exceptId: string | null): Promise<boolean> {
  const { data } = await supabase.schema('solar').from('layouts').select('id, name').eq('study_id', sid)
  const key = name.trim().toLowerCase()
  return ((data ?? []) as Array<{ id: string; name: string }>).some((l) => l.id !== exceptId && l.name.trim().toLowerCase() === key)
}

const toRow = (o: LayoutObject) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props })

async function sheetScale(supabase: AnyClient, roofSourceId: string): Promise<number | null> {
  const { data: rs } = await supabase.schema('solar').from('roof_sources').select('kind, floor_plan_id, page_index, m_per_px').eq('id', roofSourceId).maybeSingle()
  const r = rs as { kind: string; floor_plan_id: string | null; page_index: number; m_per_px: number | null } | null
  if (!r) return null
  if (r.kind === 'satellite' || !r.floor_plan_id) return scaleForSource(r, new Map(), new Map())
  const [{ data: plan }, { data: pages }] = await Promise.all([
    supabase.schema('tenants').from('floor_plans').select('id, pixels_per_meter').eq('id', r.floor_plan_id).maybeSingle(),
    supabase.schema('tenants').from('floor_plan_page_scales').select('page_index, pixels_per_meter').eq('floor_plan_id', r.floor_plan_id),
  ])
  const p = plan as { pixels_per_meter: number | string | null } | null
  return scaleForSource(r,
    new Map([[r.floor_plan_id, p?.pixels_per_meter == null ? null : Number(p.pixels_per_meter)]]),
    new Map(((pages ?? []) as Array<{ page_index: number; pixels_per_meter: number | string }>).map((x) => [`${r.floor_plan_id}#${x.page_index}`, Number(x.pixels_per_meter)])))
}

export async function createLayoutAction(input: {
  projectId: string; name: string; roofSourceId: string; module: LayoutModuleSpec; defaultTiltDeg: number
}): Promise<LayoutResult<{ id: string }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const fieldErrors: Record<string, string> = {}
  if (name.length < 1 || name.length > 120) fieldErrors.name = 'Give the layout a name (up to 120 characters).'
  const me = moduleSpecError(input.module)
  if (me) fieldErrors.module = me
  if (!(typeof input.defaultTiltDeg === 'number' && input.defaultTiltDeg >= 0 && input.defaultTiltDeg <= 60)) fieldErrors.defaultTiltDeg = 'Tilt must be between 0° and 60°.'
  if (!UUID.test(String(input.roofSourceId))) fieldErrors.roofSourceId = 'Choose a roof source.'
  if (Object.keys(fieldErrors).length) return { fieldErrors }
  const sid = await studyId(supabase, input.projectId)
  if (!sid) return { error: 'Save the site location in Site & Supply first.' }
  if (await nameTaken(supabase, sid, name, null)) return { fieldErrors: { name: 'A layout with that name already exists.' } }
  const { data, error } = await supabase.schema('solar').from('layouts')
    .insert({ study_id: sid, roof_source_id: input.roofSourceId, name, module_spec: input.module, default_tilt_deg: input.defaultTiltDeg })
    .select('id')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A layout with that name already exists.' } } : { error: humanLayoutError(error) }
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!id) return { error: 'Nothing was created — reload and try again.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_created', objectRef: { layoutId: id } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id }
}

export async function renameLayoutAction(input: { projectId: string; layoutId: string; name: string; expectedUpdatedAt: string }):
  Promise<LayoutResult<{ updatedAt: string }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 1 || name.length > 120) return { fieldErrors: { name: 'Give the layout a name (up to 120 characters).' } }
  const sid = await studyId(supabase, input.projectId)
  if (sid && await nameTaken(supabase, sid, name, input.layoutId)) return { fieldErrors: { name: 'A layout with that name already exists.' } }
  const { data, error } = await supabase.schema('solar').from('layouts').update({ name })
    .eq('id', input.layoutId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A layout with that name already exists.' } } : { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_renamed', objectRef: { layoutId: input.layoutId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

/**
 * "Refused if a case uses the layout" (§6.2) is enforced by the DATABASE: the
 * cases migration (Yield & Scenarios phase) must declare cases.layout_id
 * REFERENCES solar.layouts(id) with NO ACTION, and humanLayoutError maps that
 * 23503 to "Used by a case — change the case first."
 */
export async function deleteLayoutAction(input: { projectId: string; layoutId: string }): Promise<LayoutResult> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const { data, error } = await supabase.schema('solar').from('layouts').delete()
    .eq('id', input.layoutId).eq('project_id', input.projectId).select('id')
  if (error) return { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was deleted — reload to see the current list.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_deleted', objectRef: { layoutId: input.layoutId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

/** What saveCore needs about the layout — passed in, so Duplicate can save into a row it just created. */
interface SaveContext { layoutId: string; roofSourceId: string; tMinC: number; tAmbMaxC: number }

async function saveCore(
  supabase: AnyClient, ctx: SaveContext, expectedUpdatedAt: string, upserts: LayoutObject[], deletes: string[],
): Promise<{ updatedAt: string } | { error: string }> {
  const { data: current } = await supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', ctx.layoutId)
  const saved = ((current ?? []) as Array<{ id: string; kind: string; geometry: unknown; props: unknown; pixels_per_meter: number | string | null }>)
    .map((o) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props, pixelsPerMeter: o.pixels_per_meter == null ? null : Number(o.pixels_per_meter) }) as LayoutObject)
  const final = applyObjectDelta(saved, upserts, deletes, await sheetScale(supabase, ctx.roofSourceId))
  const summary = storedSummary(layoutSummary(final, { tMinC: ctx.tMinC, tAmbMaxC: ctx.tAmbMaxC }))
  const { data, error } = await supabase.rpc('solar_save_layout_objects', {
    p_layout_id: ctx.layoutId,
    p_expected_updated_at: expectedUpdatedAt,
    p_upserts: upserts.map(toRow),
    p_deletes: deletes,
    p_summary: summary,
  })
  if (error) return { error: humanLayoutError(error) }
  return { updatedAt: String(data) }
}

export async function saveLayoutObjectsAction(input: {
  projectId: string; layoutId: string; expectedUpdatedAt: string; upserts: unknown[]; deletes: unknown[]
}): Promise<LayoutResult<{ updatedAt: string; pixelsPerMeter: Record<string, number | null> }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!Array.isArray(input.upserts) || !Array.isArray(input.deletes)) return { error: 'The layout could not be read — reload.' }
  if (input.upserts.length > MAX_UPSERTS) return { error: `Save at most ${MAX_UPSERTS} changed objects at a time.` }
  for (const o of input.upserts) {
    const e = validateObjectInput(o)
    if (e) return { error: e }
  }
  if (!input.deletes.every((d) => typeof d === 'string' && UUID.test(d))) return { error: 'The layout could not be read — reload.' }
  const upserts = input.upserts as LayoutObject[]
  const { data: layout } = await supabase.schema('solar').from('layouts')
    .select('roof_source_id, design_t_min_c, design_t_amb_max_c').eq('id', input.layoutId).eq('project_id', input.projectId).maybeSingle()
  const l = layout as { roof_source_id: string; design_t_min_c: number | string; design_t_amb_max_c: number | string } | null
  if (!l) return { error: 'This layout no longer exists — reload.' }
  const res = await saveCore(supabase,
    { layoutId: input.layoutId, roofSourceId: l.roof_source_id, tMinC: Number(l.design_t_min_c), tAmbMaxC: Number(l.design_t_amb_max_c) },
    String(input.expectedUpdatedAt), upserts, input.deletes as string[])
  if ('error' in res) return res
  const ids = upserts.map((o) => o.id)
  const { data: stamped } = ids.length
    ? await supabase.schema('solar').from('layout_objects').select('id, pixels_per_meter').in('id', ids)
    : { data: [] }
  const pixelsPerMeter = Object.fromEntries(((stamped ?? []) as Array<{ id: string; pixels_per_meter: number | string | null }>)
    .map((r) => [r.id, r.pixels_per_meter == null ? null : Number(r.pixels_per_meter)]))
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_saved', objectRef: { layoutId: input.layoutId, upserts: upserts.length, deletes: input.deletes.length } })
  revalidatePath(`/projects/${input.projectId}/solar/layout`)
  return { ok: true, updatedAt: res.updatedAt, pixelsPerMeter }
}

/**
 * Duplicate (§6.2): a new layout on the same roof source with every object
 * copied under fresh ids. Objects are re-stamped with the sheet's CURRENT scale
 * (00212 never trusts a scale from a caller); if the page was recalibrated since
 * the original was drawn, the copy measures against the new scale.
 */
export async function duplicateLayoutAction(input: { projectId: string; layoutId: string; name: string }): Promise<LayoutResult<{ id: string }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 1 || name.length > 120) return { fieldErrors: { name: 'Give the layout a name (up to 120 characters).' } }
  const { data: src } = await supabase.schema('solar').from('layouts')
    .select('study_id, roof_source_id, module_spec, default_tilt_deg, design_t_min_c, design_t_amb_max_c')
    .eq('id', input.layoutId).eq('project_id', input.projectId).maybeSingle()
  const s = src as Record<string, unknown> | null
  if (!s) return { error: 'This layout no longer exists — reload.' }
  if (await nameTaken(supabase, String(s.study_id), name, null)) return { fieldErrors: { name: 'A layout with that name already exists.' } }
  const { data: created, error } = await supabase.schema('solar').from('layouts').insert({
    study_id: s.study_id, roof_source_id: s.roof_source_id, name, module_spec: s.module_spec,
    default_tilt_deg: s.default_tilt_deg, design_t_min_c: s.design_t_min_c, design_t_amb_max_c: s.design_t_amb_max_c,
  }).select('id, updated_at')
  if (error) return { error: humanLayoutError(error) }
  const row = Array.isArray(created) ? (created[0] as { id: string; updated_at: string } | undefined) : undefined
  if (!row) return { error: 'Nothing was created — reload and try again.' }
  const { data: objs } = await supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', input.layoutId)
  const copies = cloneLayoutObjects(((objs ?? []) as Array<{ id: string; kind: string; geometry: unknown; props: unknown }>)
    .map((o) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props, pixelsPerMeter: null }) as LayoutObject), randomUUID)
  if (copies.length > 0) {
    const res = await saveCore(supabase,
      { layoutId: row.id, roofSourceId: String(s.roof_source_id), tMinC: Number(s.design_t_min_c), tAmbMaxC: Number(s.design_t_amb_max_c) },
      row.updated_at, copies, [])
    if ('error' in res) {
      await supabase.schema('solar').from('layouts').delete().eq('id', row.id)
      return res
    }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_duplicated', objectRef: { layoutId: row.id, from: input.layoutId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id: row.id }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter web exec vitest run src/actions/solar-layout.actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-layout.actions.ts apps/web/src/actions/solar-layout.actions.test.ts
git commit -m "feat(solar-layout): layout actions — create, duplicate, rename, delete, atomic save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Auto-fill and manual-block planners (pure, web)

**Files:**
- Create: `apps/web/src/lib/solar/auto-fill-plan.ts`
- Create: `apps/web/src/lib/solar/block-plan.ts`
- Test: `apps/web/src/lib/solar/auto-fill-plan.test.ts`
- Test: `apps/web/src/lib/solar/block-plan.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/solar/auto-fill-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planAutoFill, type AutoFillRequest } from './auto-fill-plan'
import { GENERIC_MODULE_550 as M, type RoofObject } from '@esite/shared'

const PPM = 10
const flatRoof: RoofObject = { id: 'R', kind: 'roof', pixelsPerMeter: PPM, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
  props: { name: 'Flat', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }
const base: AutoFillRequest = {
  roof: flatRoof, obstructions: [], sheetPixelsPerMeter: PPM, latDeg: -26.2, northBearingDeg: 0, module: M,
  orientation: 'portrait', mode: 'racked', tiltDeg: 15, rowSpacing: { kind: 'auto' }, gapMm: 20, shadeFree: { fromHour: 9, toHour: 15 },
}

describe('planAutoFill', () => {
  it('racked on a flat roof: the hand-checked 48, rows at the D-11 pitch, facing north', () => {
    const p = planAutoFill(base, 'A')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.count).toBe(48)
    expect(p.object.props).toMatchObject({ roofId: 'R', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0 })
    expect(p.object.props.rowPitchM).toBeCloseTo(3.525643, 5)
    expect(p.object.geometry.modules).toHaveLength(48)
    // stored in IMAGE PIXELS: the first module is 0.5 m (5 px) in from the left edge
    expect(Math.min(...p.object.geometry.modules.flatMap((q) => [q[0]!, q[2]!, q[4]!, q[6]!]))).toBeCloseTo(5, 6)
  })
  it('racked needs north and a site latitude', () => {
    expect(planAutoFill({ ...base, northBearingDeg: null }, 'A')).toEqual({ ok: false, error: 'Set north first (N) — racked rows face the equator.' })
    expect(planAutoFill({ ...base, latDeg: null }, 'A')).toEqual({ ok: false, error: 'Set the site location in Site & Supply first — row spacing depends on latitude.' })
  })
  it('a pitched roof mounts flush along its drawn fall line', () => {
    const pitched: RoofObject = { ...flatRoof, geometry: { points: [0, 0, 120, 0, 120, 70, 0, 70] }, props: { ...flatRoof.props, roofType: 'pitched', pitchDeg: 30, fallBearingDeg: 0, setbackM: 0.3 } }
    const p = planAutoFill({ ...base, roof: pitched, mode: 'racked' }, 'A')
    expect(p.ok && p.count).toBe(27)
    expect(p.ok && p.object.props.mounting).toBe('flush')
    expect(p.ok && p.object.props.tiltDeg).toBe(30)
    expect(planAutoFill({ ...base, roof: { ...pitched, props: { ...pitched.props, fallBearingDeg: null } } }, 'A'))
      .toEqual({ ok: false, error: "Draw the roof's fall line first (Properties → Draw fall line)." })
  })
  it('manual pitch shorter than the module depth is refused with the engine sentence', () => {
    const p = planAutoFill({ ...base, rowSpacing: { kind: 'manual', pitchM: 1 } }, 'A')
    expect(p.ok).toBe(false)
  })
  it('an uncalibrated sheet cannot be filled', () => {
    expect(planAutoFill({ ...base, roof: { ...flatRoof, pixelsPerMeter: null }, sheetPixelsPerMeter: null }, 'A'))
      .toEqual({ ok: false, error: 'This drawing page has no scale yet — calibrate it before drawing.' })
  })
})
```

`apps/web/src/lib/solar/block-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planModuleBlock, snapToSetback } from './block-plan'
import { GENERIC_MODULE_550 as M, type RoofObject } from '@esite/shared'

const roof: RoofObject = { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
  props: { name: 'Flat', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }

describe('snapToSetback', () => {
  it('pulls a start point near an edge onto the setback line (metres)', () => {
    const p = snapToSetback({ x: 0.2, y: 3 }, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }], 0.5, 1)
    expect(p.x).toBeCloseTo(0.5, 9)
    expect(p.y).toBe(3)
  })
  it('leaves a point far from every edge alone', () => {
    expect(snapToSetback({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }], 0.5, 1)).toEqual({ x: 5, y: 5 })
  })
})

describe('planModuleBlock', () => {
  it('fills the dragged rectangle with whole modules from the snapped corner', () => {
    // Drag from (3 px, 5 px) → near the left edge → snapped to x = 5 px (0.5 m); to (60 px, 60 px).
    const p = planModuleBlock({ roof, obstructions: [], sheetPixelsPerMeter: 10, startPx: { x: 3, y: 5 }, endPx: { x: 60, y: 60 },
      module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, facingSheetDeg: 0, gapM: 0.02, rowPitchM: null }, 'B')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    // Across 0.5→6.0 m = 5.5 m: 4 columns (4 × 1.154 − 0.02 = 4.596 ≤ 5.5 < 5.75); along 0.5→6.0 m: 2 rows of 2.278 + gap.
    expect(p.object.geometry.modules).toHaveLength(8)
    expect(p.object.kind).toBe('module_block')
  })
  it('refuses a block with no room for one module', () => {
    const p = planModuleBlock({ roof, obstructions: [], sheetPixelsPerMeter: 10, startPx: { x: 50, y: 50 }, endPx: { x: 55, y: 55 },
      module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, facingSheetDeg: 0, gapM: 0.02, rowPitchM: null }, 'B')
    expect(p).toEqual({ ok: false, error: 'No whole module fits in that rectangle inside the roof setback.' })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/lib/solar/auto-fill-plan.test.ts src/lib/solar/block-plan.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the auto-fill planner**

`apps/web/src/lib/solar/auto-fill-plan.ts`:

```ts
/**
 * Auto-fill (functional spec §6.3 "F", engine spec §3.1) from the canvas's
 * objects to a new array object in IMAGE PIXELS. Pure; the dialog previews the
 * result and Place pushes it onto the history.
 *
 * Mounting rules:
 *   pitched roof           → flush, tilt = roof pitch, facing = drawn fall line
 *   mode 'racked'          → racked rows at `tiltDeg`, facing the equator
 *                            (needs north + latitude), row pitch D-11 or manual
 *   mode 'flat'            → flat-mounted (tilt 0), grid tried at 0° and 90°
 */
import {
  autoFill, autoRowPitch, equatorFacingAzimuth, isCircleGeometry, manualRowPitch, moduleFootprint, mToPx, pxToM,
  sheetBearingForAzimuth, type ArrayObject, type LayoutModuleSpec, type ModuleOrientation, type Obstacle,
  type ObstructionObject, type RoofObject,
} from '@esite/shared'

export interface AutoFillRequest {
  roof: RoofObject
  obstructions: ObstructionObject[]
  sheetPixelsPerMeter: number | null
  latDeg: number | null
  northBearingDeg: number | null
  module: LayoutModuleSpec
  orientation: ModuleOrientation
  mode: 'racked' | 'flat'
  tiltDeg: number
  rowSpacing: { kind: 'auto' } | { kind: 'manual'; pitchM: number }
  gapMm: number
  shadeFree: { fromHour: number; toHour: number }
}

export type AutoFillPlan =
  | { ok: true; object: ArrayObject; count: number; alphaDeg: number | null }
  | { ok: false; error: string }

export function obstaclesInMetres(obstructions: ObstructionObject[], fallbackPpm: number): Obstacle[] {
  return obstructions.map((o) => {
    const ppm = o.pixelsPerMeter ?? fallbackPpm
    return isCircleGeometry(o.geometry)
      ? { kind: 'circle' as const, centre: { x: o.geometry.cx / ppm, y: o.geometry.cy / ppm }, radiusM: o.geometry.r / ppm, setbackM: o.props.setbackM }
      : { kind: 'polygon' as const, points: pxToM(o.geometry.points, ppm), setbackM: o.props.setbackM }
  })
}

export function planAutoFill(req: AutoFillRequest, newId: string): AutoFillPlan {
  const ppm = req.roof.pixelsPerMeter ?? req.sheetPixelsPerMeter
  if (!ppm) return { ok: false, error: 'This drawing page has no scale yet — calibrate it before drawing.' }
  const gapM = req.gapMm / 1000
  const pitched = req.roof.props.roofType === 'pitched'
  let facingSheetDeg = 0
  let tiltDeg = 0
  let mounting: 'flush' | 'racked' = 'flush'
  let rotationsDeg = [0, 90]
  let rowPitchM: number | null = null
  let alphaDeg: number | null = null

  try {
    if (pitched) {
      if (req.roof.props.fallBearingDeg === null) return { ok: false, error: "Draw the roof's fall line first (Properties → Draw fall line)." }
      facingSheetDeg = req.roof.props.fallBearingDeg
      tiltDeg = req.roof.props.pitchDeg
      rotationsDeg = [0]
    } else if (req.mode === 'racked') {
      if (req.latDeg === null) return { ok: false, error: 'Set the site location in Site & Supply first — row spacing depends on latitude.' }
      if (req.northBearingDeg === null) return { ok: false, error: 'Set north first (N) — racked rows face the equator.' }
      mounting = 'racked'
      tiltDeg = req.tiltDeg
      facingSheetDeg = sheetBearingForAzimuth(equatorFacingAzimuth(req.latDeg), req.northBearingDeg)
      rotationsDeg = [0]
      const slope = req.orientation === 'portrait' ? req.module.lengthM : req.module.widthM
      const p = req.rowSpacing.kind === 'auto'
        ? autoRowPitch({ slopeLengthM: slope, tiltDeg, latDeg: req.latDeg, fromHour: req.shadeFree.fromHour, toHour: req.shadeFree.toHour })
        : manualRowPitch({ slopeLengthM: slope, tiltDeg, pitchM: req.rowSpacing.pitchM })
      rowPitchM = p.pitchM
      alphaDeg = p.alphaDeg
    }
    const footprint = moduleFootprint({ module: req.module, orientation: req.orientation, mounting, tiltDeg, gapM, rowPitchM })
    const result = autoFill({
      roof: pxToM(req.roof.geometry.points, ppm),
      setbackM: req.roof.props.setbackM,
      obstacles: obstaclesInMetres(req.obstructions, ppm),
      footprint,
      facingSheetDeg,
      rotationsDeg,
    })
    const object: ArrayObject = {
      id: newId,
      kind: 'array',
      pixelsPerMeter: null,
      geometry: { modules: result.modules.map((q) => mToPx(q, ppm)) },
      props: {
        roofId: req.roof.id, module: req.module, orientation: req.orientation, mounting, tiltDeg,
        facingSheetDeg: (facingSheetDeg + result.rotationDeg) % 360, azimuthOverrideDeg: null,
        rowPitchM: footprint.stepAlongM, gapM,
      },
    }
    return { ok: true, object, count: result.count, alphaDeg }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Auto-fill failed.' }
  }
}
```

- [ ] **Step 4: Implement the block planner**

`apps/web/src/lib/solar/block-plan.ts`:

```ts
/**
 * Place array (manual), tool A (functional spec §6.3): drag a rectangle in the
 * facing frame → rows × columns of whole modules, the first corner snapped to
 * the roof's setback line when dragged from within `snapM` of an edge. Every
 * module is still checked against the roof setback and obstructions.
 */
import {
  moduleFootprint, moduleIsLegal, mToPx, pointInPolygon, pointSegmentDistance, pxToM, rectQuad, sheetDirection,
  type LayoutModuleSpec, type ModuleOrientation, type MountingKind, type ModulesGeometry, type ArrayProps,
  type ObstructionObject, type Pt, type RoofObject,
} from '@esite/shared'
import { obstaclesInMetres } from './auto-fill-plan'

export function snapToSetback(p: Pt, roof: Pt[], setbackM: number, snapM: number): Pt {
  let best: { d: number; a: Pt; b: Pt } | null = null
  for (let i = 0; i < roof.length; i++) {
    const a = roof[i]!
    const b = roof[(i + 1) % roof.length]!
    const d = pointSegmentDistance(p, a, b)
    if (!best || d < best.d) best = { d, a, b }
  }
  if (!best || best.d > snapM) return p
  const len = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y)
  let n = { x: -(best.b.y - best.a.y) / len, y: (best.b.x - best.a.x) / len }
  const mid = { x: (best.a.x + best.b.x) / 2 + n.x * 1e-3, y: (best.a.y + best.b.y) / 2 + n.y * 1e-3 }
  if (!pointInPolygon(mid, roof)) n = { x: -n.x, y: -n.y }
  const signed = (p.x - best.a.x) * n.x + (p.y - best.a.y) * n.y
  const move = setbackM - signed
  return { x: p.x + n.x * move, y: p.y + n.y * move }
}

export function planModuleBlock(i: {
  roof: RoofObject; obstructions: ObstructionObject[]; sheetPixelsPerMeter: number | null
  startPx: Pt; endPx: Pt; module: LayoutModuleSpec; orientation: ModuleOrientation; mounting: MountingKind
  tiltDeg: number; facingSheetDeg: number; gapM: number; rowPitchM: number | null
}, newId: string): { ok: true; object: { id: string; kind: 'module_block'; pixelsPerMeter: null; geometry: ModulesGeometry; props: ArrayProps } } | { ok: false; error: string } {
  const ppm = i.roof.pixelsPerMeter ?? i.sheetPixelsPerMeter
  if (!ppm) return { ok: false, error: 'This drawing page has no scale yet — calibrate it before drawing.' }
  const roofM = pxToM(i.roof.geometry.points, ppm)
  let fp
  try {
    fp = moduleFootprint({ module: i.module, orientation: i.orientation, mounting: i.mounting, tiltDeg: i.tiltDeg, gapM: i.gapM, rowPitchM: i.rowPitchM })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The module does not fit.' }
  }
  const vh = sheetDirection(i.facingSheetDeg)
  const uh = sheetDirection(i.facingSheetDeg + 90)
  const start = snapToSetback({ x: i.startPx.x / ppm, y: i.startPx.y / ppm }, roofM, i.roof.props.setbackM, 1)
  const end = { x: i.endPx.x / ppm, y: i.endPx.y / ppm }
  const du = (end.x - start.x) * uh.x + (end.y - start.y) * uh.y
  const dv = (end.x - start.x) * vh.x + (end.y - start.y) * vh.y
  const su = Math.sign(du) || 1
  const sv = Math.sign(dv) || 1
  const cols = Math.floor((Math.abs(du) - fp.acrossM) / fp.stepAcrossM + 1e-9) + 1
  const rows = Math.floor((Math.abs(dv) - fp.alongM) / fp.stepAlongM + 1e-9) + 1
  const obstacles = obstaclesInMetres(i.obstructions, ppm)
  const modules: number[][] = []
  for (let r = 0; r < Math.max(0, rows); r++) {
    for (let c = 0; c < Math.max(0, cols); c++) {
      const u0 = su > 0 ? c * fp.stepAcrossM : -(c * fp.stepAcrossM + fp.acrossM)
      const v0 = sv > 0 ? r * fp.stepAlongM : -(r * fp.stepAlongM + fp.alongM)
      const corner = { x: start.x + uh.x * u0 + vh.x * v0, y: start.y + uh.y * u0 + vh.y * v0 }
      const quad = rectQuad(corner, uh, vh, fp.acrossM, fp.alongM)
      if (moduleIsLegal(quad, roofM, i.roof.props.setbackM, obstacles)) modules.push(mToPx(quad, ppm))
    }
  }
  if (modules.length === 0) return { ok: false, error: 'No whole module fits in that rectangle inside the roof setback.' }
  return {
    ok: true,
    object: {
      id: newId, kind: 'module_block', pixelsPerMeter: null, geometry: { modules },
      props: {
        roofId: i.roof.id, module: i.module, orientation: i.orientation, mounting: i.mounting, tiltDeg: i.tiltDeg,
        facingSheetDeg: i.facingSheetDeg, azimuthOverrideDeg: null, rowPitchM: fp.stepAlongM, gapM: i.gapM,
      },
    },
  }
}
```

(Block test arithmetic, for the reviewer: facing 0 → v points sheet-up, so a downward drag has `dv < 0`; |dv| = 5.5 m → rows = ⌊(5.5 − 2.278)/2.298⌋ + 1 = 2; |du| = 5.5 m → cols = ⌊(5.5 − 1.134)/1.154⌋ + 1 = 4; every module is ≥ 0.5 m from the edges → 8.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter web exec vitest run src/lib/solar/auto-fill-plan.test.ts src/lib/solar/block-plan.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/solar/auto-fill-plan.ts apps/web/src/lib/solar/auto-fill-plan.test.ts apps/web/src/lib/solar/block-plan.ts apps/web/src/lib/solar/block-plan.test.ts
git commit -m "feat(solar-layout): auto-fill and manual-block planners from canvas objects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `SolarCanvas` (Konva)

No unit test (Konva — the same gap `RouteCanvas` carries). Its rules live in Tasks 1, 2, 9; the owner walk in Task 16 covers the rest.

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/_components/SolarCanvas.tsx`

- [ ] **Step 1: Write the component**

`apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/_components/SolarCanvas.tsx`:

```tsx
'use client'
/**
 * THE SOLAR CANVAS — sibling of RouteCanvas (PR #201). It draws one sheet and
 * one layout and emits INTENTS; the workspace owns the object list, history and
 * saving. Sheet loading, zoom/pan and the image space are lib/sheet's, so this
 * canvas cannot drift from the markup and route canvases. F is Auto-fill here,
 * so the viewport's fit key is 0 only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Circle, Rect, Group, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import {
  flatToPts, isArrayObject, isCircleGeometry, stringColour, vertexMean, type LayoutObject, type ModuleRef, type Pt,
} from '@esite/shared'
import { isPrimaryDrawPress, isTouchEvent, rollbackPinchVertex } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { useSheetImage, backingSize } from '@/lib/sheet/use-sheet-image'
import { useSheetViewport } from '@/lib/sheet/use-sheet-viewport'

export type LayoutTool =
  | 'select' | 'north' | 'roof' | 'obstruction' | 'block' | 'inverter' | 'string' | 'equipment' | 'measure' | 'fall' | 'calibrate'

export interface Selection { ids: string[]; modules: ModuleRef[] }
export const EMPTY_SELECTION: Selection = { ids: [], modules: [] }

/**
 * JPEG (base64, no prefix) of the objects' bounding box + margin at native
 * resolution, capped at 4000 px. Handed to the parent through `onExporter`, not
 * a ref: the canvas is loaded with next/dynamic, and a callback survives that
 * wrapper where a forwarded ref is not guaranteed to.
 */
export type ExportJpeg = () => Promise<{ jpegBase64: string; crop: { x: number; y: number; w: number; h: number } } | null>

export interface SolarCanvasProps {
  sheet: { key: string; signedUrl: string | null; isPdf: boolean; pageIndex: number }
  objects: LayoutObject[]
  preview: number[][] | null
  selection: Selection
  tool: LayoutTool
  readOnly: boolean
  circleMode: boolean
  sheetPixelsPerMeter: number | null
  onSelect(sel: Selection): void
  onPolygon(kind: 'roof' | 'obstruction', points: number[]): void
  onCircle(cx: number, cy: number, r: number): void
  onPoint(kind: 'inverter' | 'equipment', x: number, y: number): void
  onBlock(a: Pt, b: Pt): void
  onTwoPoints(purpose: 'north' | 'fall' | 'calibrate', points: number[]): void
  onModuleClick(ref: ModuleRef): void
  onTranslate(ids: string[], dx: number, dy: number): void
  /** The transformer's result, applied to image coords as p' = rotate(p, deg about 0,0) + (dx, dy). */
  onTransform(ids: string[], deg: number, dx: number, dy: number): void
  onExporter?(fn: ExportJpeg | null): void
  height?: string
}

const ROOF = '#f59e0b'
const OBST = '#dc2626'
const MODULE = '#1d4ed8'
const SEL = '#10b981'

function centroidOf(q: number[]): Pt { return vertexMean(flatToPts(q)) }

export function SolarCanvas(p: SolarCanvasProps) {
  const { img, loadError } = useSheetImage({ planId: p.sheet.key, signedUrl: p.sheet.signedUrl, isPdf: p.sheet.isPdf, initialPage: p.sheet.pageIndex })
  const [imgW, imgH] = backingSize(img)
  const image = useMemo(() => (img ? { w: imgW, h: imgH } : null), [img, imgW, imgH])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const groupRef = useRef<Konva.Group | null>(null)
  const trRef = useRef<Konva.Transformer | null>(null)

  const [draft, setDraft] = useState<number[]>([])
  const [dragStart, setDragStart] = useState<Pt | null>(null)
  const [dragNow, setDragNow] = useState<Pt | null>(null)
  const [exporting, setExporting] = useState(false)
  const lenBeforeTouch = useRef<number | null>(null)
  const onPinchStart = useCallback(() => {
    setDraft((pts) => rollbackPinchVertex(pts, lenBeforeTouch.current))
    lenBeforeTouch.current = null
  }, [])
  const vp = useSheetViewport({ containerRef, image, resetKey: `${p.sheet.key}:${p.sheet.pageIndex}`, onPinchStart, fitKeys: ['0'] })

  const selected = useMemo(() => new Set(p.selection.ids), [p.selection.ids])
  const moduleSel = useMemo(() => new Set(p.selection.modules.map((m) => `${m.arrayId}#${m.index}`)), [p.selection.modules])
  const stringOf = useMemo(() => {
    const m = new Map<string, number>()
    let i = 0
    for (const o of p.objects) if (o.kind === 'string') { for (const r of o.props.modules) m.set(`${r.arrayId}#${r.index}`, i); i++ }
    return m
  }, [p.objects])

  // Transformer (rotate only) follows the selection group — re-bound whenever the
  // selection, tool or edit right changes, and detached when nothing is selected
  // so it never draws an empty box at the origin.
  const selectionKey = p.selection.ids.join(',')
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const on = !p.readOnly && p.tool === 'select' && p.selection.ids.length > 0 && groupRef.current
    tr.nodes(on ? [groupRef.current as Konva.Group] : [])
    tr.getLayer()?.batchDraw()
  }, [selectionKey, p.readOnly, p.tool, p.selection.ids.length])

  function pointer(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): Pt | null {
    const stage = e.target.getStage()
    const pos = stage?.getRelativePointerPosition()
    return pos ? { x: pos.x, y: pos.y } : null
  }

  function finishPolygon() {
    if (draft.length >= 6 && (p.tool === 'roof' || (p.tool === 'obstruction' && !p.circleMode))) p.onPolygon(p.tool, draft)
    setDraft([])
  }

  function onDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isPrimaryDrawPress(e.evt) || vp.panningRef.current) return
    if (isTouchEvent(e.evt) && vp.touchCountRef.current > 1) return
    const pt = pointer(e)
    if (!pt) return
    lenBeforeTouch.current = isTouchEvent(e.evt) ? draft.length : null
    if (p.readOnly && p.tool !== 'measure' && p.tool !== 'select') return
    switch (p.tool) {
      case 'select':
        if (e.target === e.target.getStage() || e.target.getClassName() === 'Image') {
          setDragStart(pt); setDragNow(pt)
          if (!(e.evt as MouseEvent).shiftKey) p.onSelect({ ids: [], modules: [] })
        }
        return
      case 'roof':
      case 'obstruction':
        if (p.tool === 'obstruction' && p.circleMode) { setDragStart(pt); setDragNow(pt); return }
        setDraft((d) => [...d, pt.x, pt.y])
        return
      case 'block':
        setDragStart(pt); setDragNow(pt)
        return
      case 'inverter':
      case 'equipment':
        p.onPoint(p.tool, pt.x, pt.y)
        return
      case 'north':
      case 'fall':
      case 'calibrate':
      case 'measure': {
        const next = draft.length >= 4 ? [pt.x, pt.y] : [...draft, pt.x, pt.y]
        setDraft(next)
        if (next.length === 4 && p.tool !== 'measure') { p.onTwoPoints(p.tool, next); setDraft([]) }
        return
      }
      default:
        return
    }
  }

  function onMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!dragStart) return
    const pt = pointer(e)
    if (pt) setDragNow(pt)
  }

  function onUp() {
    if (!dragStart || !dragNow) { setDragStart(null); return }
    const a = dragStart
    const b = dragNow
    setDragStart(null); setDragNow(null)
    if (p.tool === 'block' && Math.hypot(b.x - a.x, b.y - a.y) > 4) p.onBlock(a, b)
    if (p.tool === 'obstruction' && p.circleMode) {
      const r = Math.hypot(b.x - a.x, b.y - a.y)
      if (r > 2) p.onCircle(a.x, a.y, r)
    }
    if (p.tool === 'select' && Math.abs(b.x - a.x) > 4 && Math.abs(b.y - a.y) > 4) {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
      const inBox = (q: Pt) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1
      const ids = p.objects.filter((o) => {
        if (o.kind === 'string') return false
        if (isArrayObject(o)) return o.geometry.modules.length > 0 && inBox(centroidOf(o.geometry.modules.flat()))
        if (o.kind === 'roof') return inBox(vertexMean(flatToPts(o.geometry.points)))
        if (o.kind === 'obstruction') return inBox(isCircleGeometry(o.geometry) ? { x: o.geometry.cx, y: o.geometry.cy } : vertexMean(flatToPts(o.geometry.points)))
        return inBox({ x: o.geometry.x, y: o.geometry.y })
      }).map((o) => o.id)
      p.onSelect({ ids: [...new Set([...p.selection.ids, ...ids])], modules: [] })
    }
  }

  function pressObject(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, id: string) {
    if (p.tool !== 'select' && p.tool !== 'string') return
    e.cancelBubble = true
    const shift = (e.evt as MouseEvent).shiftKey
    p.onSelect({ ids: shift ? [...new Set([...p.selection.ids, id])] : [id], modules: [] })
  }

  function pressModule(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, ref: ModuleRef) {
    e.cancelBubble = true
    if (p.tool === 'string') { p.onModuleClick(ref); return }
    if (p.tool !== 'select') return
    const shift = (e.evt as MouseEvent).shiftKey
    p.onSelect({ ids: [], modules: shift ? [...p.selection.modules, ref] : [ref] })
  }

  const exportJpeg = useCallback<ExportJpeg>(async () => {
      const stage = stageRef.current
      if (!stage || !img) return null
      const pts = p.objects.flatMap((o) => {
        if (o.kind === 'roof') return flatToPts(o.geometry.points)
        if (o.kind === 'obstruction') return isCircleGeometry(o.geometry) ? [{ x: o.geometry.cx - o.geometry.r, y: o.geometry.cy - o.geometry.r }, { x: o.geometry.cx + o.geometry.r, y: o.geometry.cy + o.geometry.r }] : flatToPts(o.geometry.points)
        if (isArrayObject(o)) return o.geometry.modules.flatMap((q) => flatToPts(q))
        if (o.kind === 'inverter' || o.kind === 'equipment') return [{ x: o.geometry.x, y: o.geometry.y }]
        return []
      })
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y)
      const [x0, x1, y0, y1] = pts.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, imgW, 0, imgH]
      const mx = (x1 - x0) * 0.05 + 20, my = (y1 - y0) * 0.05 + 20
      const crop = { x: Math.max(0, x0 - mx), y: Math.max(0, y0 - my), w: 0, h: 0 }
      crop.w = Math.min(imgW, x1 + mx) - crop.x
      crop.h = Math.min(imgH, y1 + my) - crop.y
      setExporting(true)
      await new Promise((r) => setTimeout(r, 60)) // redraw without selection chrome
      const savedScale = stage.scaleX()
      const savedPos = stage.position()
      try {
        stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 }); stage.draw()
        const pixelRatio = Math.min(1, 4000 / Math.max(crop.w, crop.h))
        const url = stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.85, x: crop.x, y: crop.y, width: crop.w, height: crop.h, pixelRatio })
        return { jpegBase64: url.split(',')[1] ?? '', crop }
      } finally {
        stage.scale({ x: savedScale, y: savedScale }); stage.position(savedPos); stage.draw()
        setExporting(false)
      }
  }, [img, imgW, imgH, p.objects])
  const { onExporter } = p
  useEffect(() => {
    onExporter?.(exportJpeg)
    return () => onExporter?.(null)
  }, [exportJpeg, onExporter])

  const strokeW = 2 / vp.scale
  const renderObject = (o: LayoutObject) => {
    const sel = !exporting && selected.has(o.id)
    switch (o.kind) {
      case 'roof':
        return <Line key={o.id} points={o.geometry.points} closed stroke={sel ? SEL : ROOF} strokeWidth={strokeW} fill="rgba(245,158,11,0.08)"
          onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)} />
      case 'obstruction':
        return isCircleGeometry(o.geometry)
          ? <Circle key={o.id} x={o.geometry.cx} y={o.geometry.cy} radius={o.geometry.r} stroke={sel ? SEL : OBST} strokeWidth={strokeW} fill="rgba(220,38,38,0.15)"
              onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)} />
          : <Line key={o.id} points={o.geometry.points} closed stroke={sel ? SEL : OBST} strokeWidth={strokeW} fill="rgba(220,38,38,0.15)"
              onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)} />
      case 'array':
      case 'module_block':
        return (
          <Group key={o.id} onDblClick={() => p.onSelect({ ids: [o.id], modules: [] })} onDblTap={() => p.onSelect({ ids: [o.id], modules: [] })}>
            {o.geometry.modules.map((q, i) => {
              const k = `${o.id}#${i}`
              const s = stringOf.get(k)
              const hot = !exporting && (sel || moduleSel.has(k))
              return <Line key={k} points={q} closed stroke={hot ? SEL : MODULE} strokeWidth={strokeW / 2}
                fill={s === undefined ? 'rgba(29,78,216,0.35)' : stringColour(s)} opacity={s === undefined ? 1 : 0.8}
                onMouseDown={(e) => pressModule(e, { arrayId: o.id, index: i })} onTouchStart={(e) => pressModule(e, { arrayId: o.id, index: i })} />
            })}
          </Group>
        )
      case 'inverter':
      case 'equipment': {
        const label = o.kind === 'inverter' ? 'INV' : o.props.equipmentKind === 'db' ? 'DB' : o.props.equipmentKind === 'battery' ? 'BAT' : 'CB'
        const size = 24 / vp.scale
        return (
          <Group key={o.id} x={o.geometry.x} y={o.geometry.y} onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)}>
            <Rect x={-size / 2} y={-size / 2} width={size} height={size} fill="white" stroke={sel ? SEL : '#111'} strokeWidth={strokeW} />
            <Text x={-size / 2} y={-size / 4} width={size} align="center" text={label} fontSize={size / 3} />
          </Group>
        )
      }
      default:
        return null
    }
  }

  const arraysById = useMemo(() => new Map(p.objects.filter(isArrayObject).map((a) => [a.id, a])), [p.objects])
  const stringLines = p.objects.filter((o) => o.kind === 'string').map((s, i) => {
    if (s.kind !== 'string') return null
    const pts = s.props.modules.flatMap((m) => {
      const q = arraysById.get(m.arrayId)?.geometry.modules[m.index]
      if (!q) return []
      const c = centroidOf(q)
      return [c.x, c.y]
    })
    return <Line key={s.id} points={pts} stroke={stringColour(i)} strokeWidth={strokeW * 1.5} listening={false} />
  })

  const measureLabel = p.tool === 'measure' && draft.length === 4 && p.sheetPixelsPerMeter
    ? `${(Math.hypot(draft[2]! - draft[0]!, draft[3]! - draft[1]!) / p.sheetPixelsPerMeter).toFixed(2)} m` : null
  const movable = p.objects.filter((o) => selected.has(o.id))
  const still = p.objects.filter((o) => !selected.has(o.id))

  return (
    <div ref={containerRef} style={{ position: 'relative', height: p.height ?? '70vh', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden', touchAction: 'none' }}>
      {loadError ? (
        <div role="alert" style={{ padding: 48, textAlign: 'center', color: '#dc2626' }}>{loadError}</div>
      ) : !img ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>{p.sheet.isPdf ? 'Rendering PDF…' : 'Loading sheet…'}</div>
      ) : (
        <Stage ref={stageRef} width={vp.viewport.w} height={vp.viewport.h} scaleX={vp.scale} scaleY={vp.scale} x={vp.offset.x} y={vp.offset.y}
          onMouseDown={onDown} onTouchStart={onDown} onMouseMove={onMove} onTouchMove={onMove} onMouseUp={onUp} onTouchEnd={onUp}
          onDblClick={finishPolygon} onDblTap={finishPolygon}
          style={{ cursor: vp.panning || vp.gestureActive ? 'grabbing' : p.tool === 'select' ? 'default' : 'crosshair', background: 'white' }}>
          <Layer>
            <KonvaImage image={img} listening={p.tool === 'select'} />
            {still.map(renderObject)}
            <Group ref={groupRef} draggable={!p.readOnly && p.tool === 'select' && movable.length > 0}
              onDragEnd={(e) => {
                const g = e.target as Konva.Group
                const dx = g.x(), dy = g.y()
                g.position({ x: 0, y: 0 })
                if (dx !== 0 || dy !== 0) p.onTranslate(p.selection.ids, dx, dy)
              }}
              onTransformEnd={() => {
                // The group's transform is translate(x, y) · rotate(θ) about the
                // group origin (0,0) = image origin, so the geometry maps exactly
                // as p' = rotate(p, θ) + (x, y). Hand that over and reset.
                const g = groupRef.current
                if (!g) return
                const deg = g.rotation()
                const dx = g.x(), dy = g.y()
                g.rotation(0); g.position({ x: 0, y: 0 }); g.scale({ x: 1, y: 1 })
                if (deg !== 0 || dx !== 0 || dy !== 0) p.onTransform(p.selection.ids, deg, dx, dy)
              }}>
              {movable.map(renderObject)}
            </Group>
            {stringLines}
            {p.preview && p.preview.map((q, i) => <Line key={`pv${i}`} points={q} closed stroke={SEL} dash={[4 / vp.scale, 4 / vp.scale]} strokeWidth={strokeW / 2} listening={false} />)}
            {draft.length >= 2 && <Line points={draft} stroke={SEL} strokeWidth={strokeW} dash={[6 / vp.scale, 4 / vp.scale]} listening={false} />}
            {measureLabel && <Text x={draft[2]!} y={draft[3]!} text={measureLabel} fontSize={14 / vp.scale} fill="#111" listening={false} />}
            {dragStart && dragNow && (p.tool === 'block' || p.tool === 'select') && (
              <Rect x={Math.min(dragStart.x, dragNow.x)} y={Math.min(dragStart.y, dragNow.y)} width={Math.abs(dragNow.x - dragStart.x)} height={Math.abs(dragNow.y - dragStart.y)}
                stroke={SEL} dash={[4 / vp.scale, 4 / vp.scale]} strokeWidth={strokeW / 2} listening={false} />
            )}
            {dragStart && dragNow && p.tool === 'obstruction' && p.circleMode && (
              <Circle x={dragStart.x} y={dragStart.y} radius={Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y)} stroke={OBST} dash={[4 / vp.scale, 4 / vp.scale]} strokeWidth={strokeW} listening={false} />
            )}
            {!exporting && <Transformer ref={trRef} resizeEnabled={false} rotateEnabled flipEnabled={false} />}
          </Layer>
        </Stage>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web type-check`
Expected: 0 errors. (The workspace that calls `onTransform` lands in Task 11; until then nothing imports this file.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/_components/SolarCanvas.tsx"
git commit -m "feat(solar-layout): SolarCanvas on the shared sheet primitives — every drawing tool as intents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Workspace, toolbar, properties, summary, auto-fill dialog, editor page

**Files:**
- Create: `…/layout/_components/LayoutToolbar.tsx`, `PropertiesPanel.tsx`, `SummaryPanel.tsx`, `AutoFillDialog.tsx`, `LayoutWorkspace.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/[layoutId]/page.tsx`
- Test: `…/layout/_components/SummaryPanel.test.tsx`, `…/layout/_components/LayoutToolbar.test.tsx`

(`…` = `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout`.)

- [ ] **Step 1: Write the failing panel tests**

`…/layout/_components/SummaryPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SummaryPanel } from './SummaryPanel'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type LayoutObject } from '@esite/shared'

const q = (x: number, y: number) => [x, y, x + 10, y, x + 10, y + 20, x, y + 20]
const objs: LayoutObject[] = [
  { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] }, props: { name: 'R', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } },
  { id: 'A', kind: 'array', pixelsPerMeter: 10, geometry: { modules: [q(10, 10), q(30, 10)] }, props: { roofId: 'R', module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 } },
  { id: 'I', kind: 'inverter', pixelsPerMeter: 10, geometry: { x: 110, y: 10 }, props: { name: 'INV-1', inverter: INV } },
]

describe('SummaryPanel', () => {
  it('shows kWp, AC, ratio, counts, utilisation and a disabled Push to case with its reason', () => {
    render(<SummaryPanel objects={objs} conditions={{ tMinC: -5, tAmbMaxC: 35 }} layoutName="Option A" onDownloadBom={vi.fn()} />)
    expect(screen.getByText('1.10 kWp')).toBeTruthy()
    expect(screen.getByText('50.0 kW')).toBeTruthy()
    expect(screen.getByText('0.02')).toBeTruthy()
    expect(screen.getByText('2 modules')).toBeTruthy()
    expect(screen.getByText('1.7 %')).toBeTruthy()
    const push = screen.getByRole('button', { name: 'Push to case' }) as HTMLButtonElement
    expect(push.disabled).toBe(true)
    expect(push.title).toBe('Cases arrive with Yield & Scenarios.')
  })
})
```

`…/layout/_components/LayoutToolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayoutToolbar } from './LayoutToolbar'

describe('LayoutToolbar', () => {
  it('View level shows only navigation tools', () => {
    render(<LayoutToolbar tool="select" onTool={vi.fn()} readOnly calibrated canUndo={false} canRedo={false} dirty={false} saving={false}
      circleMode={false} onCircleMode={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onSave={vi.fn()} onAutoFill={vi.fn()} onExport={vi.fn()} on3d={vi.fn()} traceHref="/x" />)
    expect(screen.getByRole('button', { name: 'Select (V)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Measure (M)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Roof area (R)' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
  })
  it('drawing tools are disabled with the reason on an uncalibrated sheet', () => {
    render(<LayoutToolbar tool="select" onTool={vi.fn()} readOnly={false} calibrated={false} canUndo={false} canRedo={false} dirty={false} saving={false}
      circleMode={false} onCircleMode={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onSave={vi.fn()} onAutoFill={vi.fn()} onExport={vi.fn()} on3d={vi.fn()} traceHref="/x" />)
    const roof = screen.getByRole('button', { name: 'Roof area (R)' }) as HTMLButtonElement
    expect(roof.disabled).toBe(true)
    expect(roof.title).toBe('Calibrate this page first')
  })
  it('Save shows the dirty state and fires', () => {
    const onSave = vi.fn()
    render(<LayoutToolbar tool="select" onTool={vi.fn()} readOnly={false} calibrated canUndo canRedo={false} dirty saving={false}
      circleMode={false} onCircleMode={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onSave={onSave} onAutoFill={vi.fn()} onExport={vi.fn()} on3d={vi.fn()} traceHref="/x" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save (⌘S) •' }))
    expect(onSave).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/layout/_components"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the toolbar**

`…/layout/_components/LayoutToolbar.tsx`:

```tsx
'use client'
/** Toolbar (functional spec §6.3). Drawing tools need a scale; View level gets navigation only. */
import Link from 'next/link'
import type { LayoutTool } from './SolarCanvas'

const DRAW: Array<{ tool: LayoutTool; label: string }> = [
  { tool: 'north', label: 'Set north (N)' },
  { tool: 'roof', label: 'Roof area (R)' },
  { tool: 'obstruction', label: 'Obstruction (O)' },
  { tool: 'block', label: 'Place array (A)' },
  { tool: 'inverter', label: 'Inverter (I)' },
  { tool: 'string', label: 'Assign strings (S)' },
  { tool: 'equipment', label: 'Battery / DB / combiner (B)' },
]

export function LayoutToolbar(p: {
  tool: LayoutTool; onTool(t: LayoutTool): void; readOnly: boolean; calibrated: boolean
  canUndo: boolean; canRedo: boolean; dirty: boolean; saving: boolean
  circleMode: boolean; onCircleMode(v: boolean): void
  onUndo(): void; onRedo(): void; onSave(): void; onAutoFill(): void; onExport(): void; on3d(): void
  traceHref: string
}) {
  const btn = (active: boolean) => ({ padding: '4px 8px', fontSize: 12, border: '1px solid var(--c-border)', borderRadius: 6, background: active ? 'var(--c-amber)' : 'transparent' })
  return (
    <div role="toolbar" aria-label="Layout tools" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 8 }}>
      <button type="button" style={btn(p.tool === 'select')} onClick={() => p.onTool('select')}>Select (V)</button>
      <button type="button" style={btn(p.tool === 'measure')} onClick={() => p.onTool('measure')}>Measure (M)</button>
      {!p.readOnly && (
        <>
          {DRAW.map((d) => (
            <button key={d.tool} type="button" style={btn(p.tool === d.tool)} disabled={!p.calibrated && d.tool !== 'north'}
              title={!p.calibrated && d.tool !== 'north' ? 'Calibrate this page first' : undefined} onClick={() => p.onTool(d.tool)}>{d.label}</button>
          ))}
          {p.tool === 'obstruction' && (
            <label style={{ fontSize: 12 }}><input type="checkbox" checked={p.circleMode} onChange={(e) => p.onCircleMode(e.target.checked)} /> Circle</label>
          )}
          <button type="button" style={btn(false)} disabled={!p.calibrated} title={!p.calibrated ? 'Calibrate this page first' : undefined} onClick={p.onAutoFill}>Auto-fill array (F)</button>
          <Link href={p.traceHref} style={{ fontSize: 12 }} title="Create the inverter → point-of-connection supply in the cable schedule, then trace it on its measure page">Trace AC cable</Link>
          <span style={{ width: 8 }} />
          <button type="button" style={btn(false)} disabled={!p.canUndo} onClick={p.onUndo}>Undo (⌘Z)</button>
          <button type="button" style={btn(false)} disabled={!p.canRedo} onClick={p.onRedo}>Redo (⇧⌘Z)</button>
          <button type="button" style={btn(p.dirty)} disabled={p.saving || !p.dirty} onClick={p.onSave}>{p.saving ? 'Saving…' : `Save (⌘S)${p.dirty ? ' •' : ''}`}</button>
          <button type="button" style={btn(false)} disabled={p.dirty} title={p.dirty ? 'Save before exporting' : undefined} onClick={p.onExport}>Export layout sheet</button>
        </>
      )}
      <button type="button" style={btn(false)} onClick={p.on3d}>3D preview</button>
    </div>
  )
}
```

- [ ] **Step 4: Implement the summary panel**

`…/layout/_components/SummaryPanel.tsx`:

```tsx
'use client'
/** Summary (functional spec §6.4). Computed from the CURRENT (unsaved) objects so it moves as you draw. */
import { layoutSummary, type DesignConditions, type LayoutObject } from '@esite/shared'

export function SummaryPanel({ objects, conditions, onDownloadBom }: {
  objects: LayoutObject[]; conditions: DesignConditions; layoutName: string; onDownloadBom(): void
}) {
  const s = layoutSummary(objects, conditions)
  const row = (k: string, v: string) => <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--c-text-dim)' }}>{k}</span><span>{v}</span></div>
  return (
    <section aria-label="Summary" style={{ fontSize: 13, display: 'grid', gap: 4 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600 }}>Summary</h3>
      {row('DC', `${s.dcKwp.toFixed(2)} kWp`)}
      {row('AC', `${s.acKw.toFixed(1)} kW`)}
      {row('DC/AC', s.dcAcRatio === null ? '—' : s.dcAcRatio.toFixed(2))}
      {row('Modules', `${s.moduleCount} modules`)}
      {s.modulesByType.map((t) => row(`· ${t.label}`, `${t.count}`))}
      {row('Inverters', String(s.inverterCount))}
      {row('Strings', `${s.strings.pass} pass · ${s.strings.warn} warn · ${s.strings.fail} fail`)}
      {row('Unstrung modules', String(s.unstrungModules))}
      {row('Roof utilisation', s.utilisationPct === null ? '—' : `${s.utilisationPct.toFixed(1)} %`)}
      {s.arraysOutsideRoof.length > 0 && <p role="alert" style={{ color: '#dc2626' }}>An array lies outside every roof area.</p>}
      <button type="button" onClick={onDownloadBom}>Download BOM CSV</button>
      <button type="button" disabled title="Cases arrive with Yield & Scenarios.">Push to case</button>
    </section>
  )
}
```

- [ ] **Step 5: Implement the properties panel**

`…/layout/_components/PropertiesPanel.tsx`:

```tsx
'use client'
/** Properties of the selection (functional spec §6.4). Every commit is one history step. */
import { useEffect, useState } from 'react'
import {
  EQUIPMENT_KINDS, ROOF_TYPES, arrayAzimuth, isArrayObject, stringCheck, trueAzimuth, sheetBearingForAzimuth,
  type DesignConditions, type LayoutObject,
} from '@esite/shared'

function Num({ label, value, onCommit, step = 0.1, disabled }: { label: string; value: number | null; onCommit(v: number | null): void; step?: number; disabled?: boolean }) {
  const [v, setV] = useState(value === null ? '' : String(value))
  useEffect(() => setV(value === null ? '' : String(value)), [value])
  const commit = () => {
    const n = v.trim() === '' ? null : Number(v)
    if (n === null || Number.isFinite(n)) onCommit(n)
    else setV(value === null ? '' : String(value))
  }
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>{label}
      <input type="number" step={step} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }} style={{ width: 90 }} />
    </label>
  )
}

function Txt({ label, value, onCommit, disabled }: { label: string; value: string; onCommit(v: string): void; disabled?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>{label}
      <input value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={(e) => { if (e.key === 'Enter') onCommit(v) }} style={{ width: 140 }} />
    </label>
  )
}

export function PropertiesPanel({
  object, objects, northBearingDeg, conditions, nodes, readOnly, onChange, onDrawFallLine, onAutoString,
}: {
  object: LayoutObject | null; objects: LayoutObject[]; northBearingDeg: number | null; conditions: DesignConditions
  nodes: Array<{ id: string; label: string }>; readOnly: boolean
  onChange(next: LayoutObject): void; onDrawFallLine(roofId: string): void; onAutoString(inverterId: string): void
}) {
  if (!object) return <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Select an object to see its properties.</p>
  const d = readOnly
  const set = (patch: Record<string, unknown>) => onChange({ ...object, props: { ...object.props, ...patch } } as LayoutObject)
  const box = { display: 'grid', gap: 6, fontSize: 13 } as const

  if (object.kind === 'roof') {
    const p = object.props
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>Roof</h3>
        <Txt label="Name" value={p.name} disabled={d} onCommit={(name) => set({ name })} />
        <label style={{ display: 'flex', justifyContent: 'space-between' }}>Type
          <select value={p.roofType} disabled={d} onChange={(e) => set({ roofType: e.target.value })}>{ROOF_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <Num label="Pitch °" value={p.pitchDeg} disabled={d} onCommit={(v) => set({ pitchDeg: v ?? 0 })} />
        <Num label="Pitch direction (azimuth °)" disabled={d || northBearingDeg === null}
          value={p.fallBearingDeg === null || northBearingDeg === null ? null : Math.round(trueAzimuth(p.fallBearingDeg, northBearingDeg) * 10) / 10}
          onCommit={(v) => set({ fallBearingDeg: v === null || northBearingDeg === null ? null : sheetBearingForAzimuth(v, northBearingDeg) })} />
        {!d && <button type="button" onClick={() => onDrawFallLine(object.id)}>Draw fall line</button>}
        <Num label="Height m" value={p.heightM} disabled={d} onCommit={(v) => set({ heightM: v ?? 0 })} />
        <Num label="Edge setback m" value={p.setbackM} disabled={d} onCommit={(v) => set({ setbackM: Math.max(0, v ?? 0) })} />
        <Num label="Max load kg/m² (note)" value={p.maxLoadKgM2} disabled={d} onCommit={(v) => set({ maxLoadKgM2: v })} />
      </div>
    )
  }
  if (object.kind === 'obstruction') {
    const p = object.props
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>Obstruction</h3>
        <Txt label="Name" value={p.name} disabled={d} onCommit={(name) => set({ name })} />
        <Num label="Setback m" value={p.setbackM} disabled={d} onCommit={(v) => set({ setbackM: Math.max(0, v ?? 0) })} />
        <Num label="Height m" value={p.heightM} disabled={d} onCommit={(v) => set({ heightM: Math.max(0, v ?? 0) })} />
      </div>
    )
  }
  if (isArrayObject(object)) {
    const p = object.props
    const az = arrayAzimuth(p, northBearingDeg)
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>{object.kind === 'array' ? 'Array' : 'Module block'}</h3>
        <div>{p.module.make} {p.module.model}</div>
        <div>{object.geometry.modules.length} modules · {((object.geometry.modules.length * p.module.powerW) / 1000).toFixed(2)} kWp</div>
        <div>{p.orientation} · {p.mounting} · tilt {p.tiltDeg}° · row pitch {p.rowPitchM.toFixed(2)} m</div>
        <div>Azimuth {az === null ? 'needs north' : `${az.toFixed(1)}°`}</div>
        <Num label="Azimuth override °" value={p.azimuthOverrideDeg} disabled={d} onCommit={(v) => set({ azimuthOverrideDeg: v })} />
      </div>
    )
  }
  if (object.kind === 'inverter') {
    const inv = object.props.inverter
    const setInv = (patch: Record<string, unknown>) => set({ inverter: { ...inv, ...patch } })
    const strings = objects.filter((o) => o.kind === 'string' && o.props.inverterId === object.id)
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>Inverter</h3>
        <Txt label="Name" value={object.props.name} disabled={d} onCommit={(name) => set({ name })} />
        <Txt label="Model" value={inv.model} disabled={d} onCommit={(model) => setInv({ model })} />
        <Num label="AC kW" value={inv.acKw} disabled={d} onCommit={(v) => setInv({ acKw: v ?? inv.acKw })} />
        <Num label="MPPTs" step={1} value={inv.mppts} disabled={d} onCommit={(v) => setInv({ mppts: Math.max(1, Math.round(v ?? 1)) })} />
        <Num label="Max DC V" value={inv.vDcMax} disabled={d} onCommit={(v) => setInv({ vDcMax: v ?? inv.vDcMax })} />
        <Num label="MPPT min V" value={inv.vMpptMin} disabled={d} onCommit={(v) => setInv({ vMpptMin: v ?? inv.vMpptMin })} />
        <Num label="MPPT max V" value={inv.vMpptMax} disabled={d} onCommit={(v) => setInv({ vMpptMax: v ?? inv.vMpptMax })} />
        <Num label="Max input A / MPPT" value={inv.iMpptMax} disabled={d} onCommit={(v) => setInv({ iMpptMax: v ?? inv.iMpptMax })} />
        <div>Strings per MPPT: {Array.from({ length: inv.mppts }, (_, i) => strings.filter((s) => s.kind === 'string' && s.props.mppt === i + 1).length).join(' · ')}</div>
        {!d && <button type="button" onClick={() => onAutoString(object.id)}>Auto-string</button>}
      </div>
    )
  }
  if (object.kind === 'string') {
    const inv = objects.find((o) => o.id === object.props.inverterId)
    const first = objects.find((o) => o.id === object.props.modules[0]?.arrayId)
    const onMppt = objects.filter((o) => o.kind === 'string' && o.props.inverterId === object.props.inverterId && o.props.mppt === object.props.mppt).length
    const r = inv?.kind === 'inverter' && first && isArrayObject(first) && object.props.modules.length > 0
      ? stringCheck(first.props.module, inv.props.inverter, object.props.modules.length, onMppt, first.props.mounting, conditions) : null
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>String</h3>
        <div>{object.props.modules.length} modules on MPPT {object.props.mppt}</div>
        <Num label="MPPT" step={1} value={object.props.mppt} disabled={d} onCommit={(v) => set({ mppt: Math.max(1, Math.round(v ?? 1)) })} />
        {r && (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {r.checks.map((c) => <li key={c.id} style={{ color: c.status === 'fail' ? '#dc2626' : c.status === 'warn' ? '#b45309' : 'inherit' }}>
              {c.id === 'voc-cold' ? 'Voc (cold)' : c.id === 'vmp-hot' ? 'Vmp (hot)' : c.id === 'vmp-cold' ? 'Vmp (cold)' : 'Current'}: {c.value.toFixed(1)} vs {c.limit} — {c.status}
            </li>)}
          </ul>
        )}
      </div>
    )
  }
  const p = object.props
  return (
    <div style={box}>
      <h3 style={{ fontSize: 13, fontWeight: 600 }}>Equipment</h3>
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>Kind
        <select value={p.equipmentKind} disabled={d} onChange={(e) => set({ equipmentKind: e.target.value })}>{EQUIPMENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      </label>
      <Txt label="Name" value={p.name} disabled={d} onCommit={(name) => set({ name })} />
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>Board
        <select value={p.nodeId ?? ''} disabled={d} onChange={(e) => set({ nodeId: e.target.value || null })}>
          <option value="">— none —</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </label>
      {p.equipmentKind === 'db' && !p.nodeId && <p role="alert" style={{ color: '#dc2626' }}>Link the DB symbol to a board.</p>}
    </div>
  )
}
```

- [ ] **Step 6: Implement the auto-fill dialog**

`…/layout/_components/AutoFillDialog.tsx`:

```tsx
'use client'
/** Auto-fill dialog (functional spec §6.3 "F"): options → live preview on the canvas → Place. */
import { useEffect, useMemo, useState } from 'react'
import { planAutoFill, type AutoFillPlan, type AutoFillRequest } from '@/lib/solar/auto-fill-plan'
import type { LayoutModuleSpec, ObstructionObject, RoofObject } from '@esite/shared'

export function AutoFillDialog(p: {
  roof: RoofObject; obstructions: ObstructionObject[]; sheetPixelsPerMeter: number | null; latDeg: number | null
  northBearingDeg: number | null; module: LayoutModuleSpec; defaultTiltDeg: number; shadeFree: { fromHour: number; toHour: number }
  newId: string; onPreview(quads: number[][] | null): void; onPlace(plan: Extract<AutoFillPlan, { ok: true }>): void; onClose(): void
}) {
  const pitched = p.roof.props.roofType === 'pitched'
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [mode, setMode] = useState<'racked' | 'flat'>(pitched ? 'flat' : 'racked')
  const [tilt, setTilt] = useState(String(p.defaultTiltDeg))
  const [spacing, setSpacing] = useState<'auto' | 'manual'>('auto')
  const [pitch, setPitch] = useState('4')
  const [gap, setGap] = useState('20')

  const req: AutoFillRequest = {
    roof: p.roof, obstructions: p.obstructions, sheetPixelsPerMeter: p.sheetPixelsPerMeter, latDeg: p.latDeg,
    northBearingDeg: p.northBearingDeg, module: p.module, orientation, mode, tiltDeg: Number(tilt) || 0,
    rowSpacing: spacing === 'auto' ? { kind: 'auto' } : { kind: 'manual', pitchM: Number(pitch) || 0 },
    gapMm: Number(gap) || 0, shadeFree: p.shadeFree,
  }
  const plan = useMemo(() => planAutoFill(req, p.newId), [JSON.stringify(req), p.newId]) // eslint-disable-line react-hooks/exhaustive-deps
  const { onPreview } = p
  useEffect(() => { onPreview(plan.ok ? plan.object.geometry.modules : null) }, [plan, onPreview])
  useEffect(() => () => onPreview(null), [onPreview])

  return (
    <div role="dialog" aria-label="Auto-fill array" style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, display: 'grid', gap: 6, fontSize: 13, background: 'var(--c-surface, white)' }}>
      <strong>Auto-fill {p.roof.props.name}</strong>
      {pitched
        ? <div>Flush on the {p.roof.props.pitchDeg}° pitch, along the drawn fall line.</div>
        : (
          <label>Layout <select value={mode} onChange={(e) => setMode(e.target.value as 'racked' | 'flat')}>
            <option value="racked">Tilted racking rows</option><option value="flat">Flat-mount</option></select></label>
        )}
      <label>Orientation <select value={orientation} onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}>
        <option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      {!pitched && mode === 'racked' && (
        <>
          <label>Tilt ° <input type="number" value={tilt} onChange={(e) => setTilt(e.target.value)} style={{ width: 70 }} /></label>
          <label>Row spacing <select value={spacing} onChange={(e) => setSpacing(e.target.value as 'auto' | 'manual')}>
            <option value="auto">Auto — no shade {p.shadeFree.fromHour}:00–{p.shadeFree.toHour}:00 on 21 June</option><option value="manual">Manual pitch</option></select></label>
          {spacing === 'manual' && <label>Pitch m <input type="number" value={pitch} onChange={(e) => setPitch(e.target.value)} style={{ width: 70 }} /></label>}
        </>
      )}
      <label>Module gap mm <input type="number" value={gap} onChange={(e) => setGap(e.target.value)} style={{ width: 70 }} /></label>
      {plan.ok
        ? <div>{plan.count} modules · {((plan.count * p.module.powerW) / 1000).toFixed(2)} kWp{plan.alphaDeg !== null ? ` · design sun ${plan.alphaDeg.toFixed(1)}°` : ''}</div>
        : <p role="alert" style={{ color: '#dc2626' }}>{plan.error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!plan.ok || plan.count === 0} onClick={() => { if (plan.ok) p.onPlace(plan) }}>Place</button>
        <button type="button" onClick={p.onClose}>Cancel</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Implement the workspace**

`…/layout/_components/LayoutWorkspace.tsx`:

```tsx
'use client'
/**
 * The Layout editor (functional spec §6.1): list + layers left, canvas centre,
 * properties + summary right. Owns the object list, snapshot history, IndexedDB
 * draft, dirty guard and the save. Everything it receives is JSON.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GENERIC_INVERTER_50KW, autoString, bomToCsv, diffObjects, isArrayObject, layoutBom, layoutSummary,
  removeModules, removeObjects, rotateObjects, sheetBearing, translateObjects,
  type LayoutObject, type ModuleRef, type ObstructionObject, type RoofObject,
} from '@esite/shared'
import { saveLayoutObjectsAction } from '@/actions/solar-layout.actions'
import { setRoofNorthAction } from '@/actions/solar-roof-sources.actions'
import { exportLayoutSheetAction } from '@/actions/solar-layout-export.actions'
import { emptyHistory, pushHistory, redoHistory, undoHistory } from '@/lib/solar/layout-history'
import { planModuleBlock } from '@/lib/solar/block-plan'
import { getDraft, setDraft, clearDraft } from '@/lib/sheet/draft-store'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import type { LayoutEditorData } from '@/lib/solar/layout-loader'
import { EMPTY_SELECTION, type ExportJpeg, type LayoutTool, type Selection } from './SolarCanvas'
import { LayoutToolbar } from './LayoutToolbar'
import { PropertiesPanel } from './PropertiesPanel'
import { SummaryPanel } from './SummaryPanel'
import { AutoFillDialog } from './AutoFillDialog'

const SolarCanvas = dynamic(() => import('./SolarCanvas').then((m) => m.SolarCanvas), {
  ssr: false,
  loading: () => <div style={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-dim)' }}>Loading canvas…</div>,
})
const Layout3DPreview = dynamic(() => import('./Layout3DPreview').then((m) => m.Layout3DPreview), { ssr: false })

type Draft = { objects: LayoutObject[]; basedOn: string; savedAt: string }
const uuid = () => crypto.randomUUID()

export function LayoutWorkspace({ data, canEdit }: { data: LayoutEditorData; canEdit: boolean }) {
  const readOnly = !canEdit
  const draftKey = `solar-layout:${data.layout.id}`
  const [saved, setSaved] = useState<LayoutObject[]>(data.objects)
  const [hist, setHist] = useState(() => emptyHistory<LayoutObject[]>(data.objects))
  const objects = hist.present
  const [updatedAt, setUpdatedAt] = useState(data.layout.updatedAt)
  const [north, setNorth] = useState<number | null>(data.source.northBearingDeg)
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState(data.source.updatedAt)
  const [tool, setTool] = useState<LayoutTool>('select')
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [circleMode, setCircleMode] = useState(false)
  const [fallFor, setFallFor] = useState<string | null>(null)
  const [stringDraft, setStringDraft] = useState<{ inverterId: string | null; modules: ModuleRef[] }>({ inverterId: null, modules: [] })
  const [autoFillRoof, setAutoFillRoof] = useState<RoofObject | null>(null)
  const [preview, setPreview] = useState<number[][] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [restorable, setRestorable] = useState<Draft | null>(null)
  const [show3d, setShow3d] = useState(false)
  const [northInput, setNorthInput] = useState(north === null ? '' : String(north))
  const exporterRef = useRef<ExportJpeg | null>(null)
  const onExporter = useCallback((fn: ExportJpeg | null) => { exporterRef.current = fn }, [])
  const conditions = { tMinC: data.layout.tMinC, tAmbMaxC: data.layout.tAmbMaxC }
  const calibrated = data.sheetPixelsPerMeter !== null

  const diff = useMemo(() => diffObjects(saved, objects), [saved, objects])
  const dirty = diff.upserts.length > 0 || diff.deletes.length > 0
  useSolarDirtyGuard(dirty && canEdit)

  const commit = useCallback((next: LayoutObject[]) => setHist((h) => pushHistory(h, next)), [])

  // Drafts: autosave every change; offer a restore when a draft for THIS server version differs.
  useEffect(() => {
    void getDraft<Draft>(draftKey).then((d) => {
      if (d && d.basedOn === data.layout.updatedAt && diffObjects(data.objects, d.objects).upserts.length + diffObjects(data.objects, d.objects).deletes.length > 0) setRestorable(d)
    })
  }, [draftKey, data.layout.updatedAt, data.objects])
  useEffect(() => {
    if (!canEdit) return
    const t = setTimeout(() => { if (dirty) void setDraft<Draft>(draftKey, { objects, basedOn: updatedAt, savedAt: new Date().toISOString() }) }, 500)
    return () => clearTimeout(t)
  }, [objects, dirty, draftKey, updatedAt, canEdit])

  const roofs = objects.filter((o): o is RoofObject => o.kind === 'roof')
  const obstructions = objects.filter((o): o is ObstructionObject => o.kind === 'obstruction')
  const selectedObject = selection.ids.length === 1 ? objects.find((o) => o.id === selection.ids[0]) ?? null : null
  const roofUnder = (x: number, y: number) => roofs.find((r) => {
    const pts = r.geometry.points
    let inside = false
    for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
      const xi = pts[2 * i]!, yi = pts[2 * i + 1]!, xj = pts[2 * j]!, yj = pts[2 * j + 1]!
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }) ?? null

  async function save() {
    if (!dirty || saving) return
    setSaving(true); setMessage(null)
    const res = await saveLayoutObjectsAction({ projectId: data.projectId, layoutId: data.layout.id, expectedUpdatedAt: updatedAt,
      upserts: diff.upserts.map(({ id, kind, geometry, props }) => ({ id, kind, geometry, props })), deletes: diff.deletes })
    setSaving(false)
    if ('error' in res) { setMessage(res.error); return }
    if ('fieldErrors' in res) { setMessage(Object.values(res.fieldErrors)[0] ?? 'Could not save.'); return }
    const stamped = objects.map((o) => (o.id in res.pixelsPerMeter ? ({ ...o, pixelsPerMeter: res.pixelsPerMeter[o.id] ?? null } as LayoutObject) : o))
    setSaved(stamped)
    setHist((h) => ({ ...h, present: stamped }))
    setUpdatedAt(res.updatedAt)
    await clearDraft(draftKey)
    setMessage('Saved.')
  }

  async function saveNorth(bearingDeg: number, points: number[] | null) {
    const res = await setRoofNorthAction({ projectId: data.projectId, roofSourceId: data.source.id, bearingDeg, points, expectedUpdatedAt: sourceUpdatedAt })
    if ('error' in res) { setMessage(res.error); return }
    setNorth(res.bearingDeg); setNorthInput(String(res.bearingDeg)); setSourceUpdatedAt(res.updatedAt); setMessage(`North set to ${res.bearingDeg}°.`)
  }

  function deleteSelection() {
    if (selection.modules.length) commit(removeModules(objects, selection.modules))
    else if (selection.ids.length) commit(removeObjects(objects, selection.ids))
    setSelection(EMPTY_SELECTION)
  }

  function finishString() {
    if (!stringDraft.inverterId || stringDraft.modules.length === 0) return
    const inv = objects.find((o) => o.id === stringDraft.inverterId)
    if (!inv || inv.kind !== 'inverter') return
    const used = new Map<number, number>()
    for (const s of objects) if (s.kind === 'string' && s.props.inverterId === inv.id) used.set(s.props.mppt, (used.get(s.props.mppt) ?? 0) + 1)
    let mppt = 1
    for (let m = 1; m <= inv.props.inverter.mppts; m++) if ((used.get(m) ?? 0) < (used.get(mppt) ?? 0)) mppt = m
    commit([...objects, { id: uuid(), kind: 'string', pixelsPerMeter: null, geometry: {}, props: { inverterId: inv.id, mppt, modules: stringDraft.modules } }])
    setStringDraft({ inverterId: inv.id, modules: [] })
  }

  function runAutoString(inverterId: string) {
    const inv = objects.find((o) => o.id === inverterId)
    const first = objects.find(isArrayObject)
    if (!inv || inv.kind !== 'inverter' || !first) { setMessage('Place an array and an inverter first.'); return }
    const sameModule = objects.filter(isArrayObject).filter((a) => a.props.module.model === first.props.module.model && a.props.module.make === first.props.module.make)
    try {
      const r = autoString({
        arrays: sameModule.map((a) => ({ id: a.id, quads: a.geometry.modules, facingSheetDeg: a.props.facingSheetDeg })),
        existingStrings: objects.flatMap((o) => (o.kind === 'string' ? [o.props] : [])),
        inverterId, inverter: inv.props.inverter, module: first.props.module, mounting: first.props.mounting, conditions,
      })
      commit([...objects, ...r.strings.map((s) => ({ id: uuid(), kind: 'string' as const, pixelsPerMeter: null, geometry: {} as Record<string, never>, props: { inverterId, mppt: s.mppt, modules: s.modules } }))])
      setMessage(`${r.strings.length} strings of ${r.stringLength}.${r.reason ? ` ${r.reason}` : ''}`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Auto-string failed.')
    }
  }

  async function exportSheet() {
    const shot = await exporterRef.current?.()
    if (!shot) { setMessage('The sheet is not ready yet.'); return }
    const res = await exportLayoutSheetAction({ projectId: data.projectId, layoutId: data.layout.id, jpegBase64: shot.jpegBase64, crop: shot.crop })
    setMessage('error' in res ? res.error : `Saved as version ${res.version} — listed under Exported sheets below.`)
  }

  function downloadBom() {
    const csv = bomToCsv(layoutBom(objects, layoutSummary(objects, conditions)))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${data.layout.name.replace(/[^\w.-]+/g, '_')}-bom.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function openAutoFill() {
    const roof = selectedObject?.kind === 'roof' ? selectedObject : roofs.length === 1 ? roofs[0]! : null
    if (!roof) { setMessage('Select a roof area to fill.'); return }
    setAutoFillRoof(roof)
  }

  // Keyboard (§6.3 keys). Skipped while typing. ⌘/Ctrl for undo/redo/save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); setHist((h) => (e.shiftKey ? redoHistory(h) : undoHistory(h))); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return }
      if (mod || e.altKey) return
      if (e.key === 'Escape') { setTool('select'); setStringDraft({ inverterId: null, modules: [] }); setAutoFillRoof(null); return }
      if (e.key === 'Enter' && tool === 'string') { finishString(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) { e.preventDefault(); deleteSelection(); return }
      const map: Record<string, LayoutTool> = { v: 'select', m: 'measure', n: 'north', r: 'roof', o: 'obstruction', a: 'block', i: 'inverter', s: 'string', b: 'equipment' }
      const k = e.key.toLowerCase()
      if (k === 'f' && !readOnly && calibrated) { e.preventDefault(); openAutoFill(); return }
      const next = map[k]
      if (next && (!readOnly || next === 'select' || next === 'measure') && (calibrated || next === 'select' || next === 'measure' || next === 'north')) setTool(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const defaultSetback = (roofType: string) => (roofType === 'pitched' ? data.setbackDefaults.pitchedM : data.setbackDefaults.flatM)

  return (
    <div>
      {data.drawingChanged && (
        <p role="alert" style={{ padding: 8, border: '1px solid #b45309', color: '#b45309', borderRadius: 6 }}>
          The drawing has changed since this layout was drawn. The layout is shown where it was drawn and is not realigned.
        </p>
      )}
      {!calibrated && <p role="alert">This sheet has no scale yet. <a href={`/projects/${data.projectId}/solar/layout/sources/${data.source.id}`}>Calibrate it</a> before drawing.</p>}
      {restorable && (
        <p role="status">Unsaved changes from {new Date(restorable.savedAt).toLocaleString('en-ZA')} were found.{' '}
          <button type="button" onClick={() => { commit(restorable.objects); setRestorable(null) }}>Restore</button>{' '}
          <button type="button" onClick={() => { void clearDraft(draftKey); setRestorable(null) }}>Discard</button>
        </p>
      )}
      <LayoutToolbar tool={tool} onTool={(t) => { setTool(t); if (t !== 'string') setStringDraft({ inverterId: null, modules: [] }) }}
        readOnly={readOnly} calibrated={calibrated} canUndo={hist.canUndo} canRedo={hist.canRedo} dirty={dirty} saving={saving}
        circleMode={circleMode} onCircleMode={setCircleMode} onUndo={() => setHist(undoHistory)} onRedo={() => setHist(redoHistory)}
        onSave={() => void save()} onAutoFill={openAutoFill} onExport={() => void exportSheet()} on3d={() => setShow3d((v) => !v)}
        traceHref={`/projects/${data.projectId}/cables`} />
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
          North (° clockwise from sheet-up) <input type="number" value={northInput} onChange={(e) => setNorthInput(e.target.value)} style={{ width: 70 }} />
          <button type="button" onClick={() => void saveNorth(Number(northInput), null)} disabled={northInput.trim() === '' || !Number.isFinite(Number(northInput))}>Set</button>
          {tool === 'string' && <span>{stringDraft.inverterId ? `String: ${stringDraft.modules.length} modules — Enter to finish` : 'Click an inverter, then modules in order'}</span>}
        </div>
      )}
      {message && <p role="status" style={{ fontSize: 12 }}>{message}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 12 }}>
        <div>
          <SolarCanvas onExporter={onExporter} sheet={data.source.sheet} objects={objects} preview={preview} selection={selection} tool={tool}
            readOnly={readOnly} circleMode={circleMode} sheetPixelsPerMeter={data.sheetPixelsPerMeter}
            onSelect={(sel) => {
              setSelection(sel)
              const one = sel.ids.length === 1 ? objects.find((o) => o.id === sel.ids[0]) : undefined
              if (tool === 'string' && one?.kind === 'inverter') setStringDraft({ inverterId: one.id, modules: [] })
            }}
            onPolygon={(kind, points) => {
              const id = uuid()
              commit([...objects, kind === 'roof'
                ? { id, kind: 'roof', pixelsPerMeter: null, geometry: { points }, props: { name: `Roof ${roofs.length + 1}`, roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: defaultSetback('flat'), maxLoadKgM2: null } }
                : { id, kind: 'obstruction', pixelsPerMeter: null, geometry: { points }, props: { name: `Obstruction ${obstructions.length + 1}`, setbackM: 0.5, heightM: 1 } }])
              setSelection({ ids: [id], modules: [] })
            }}
            onCircle={(cx, cy, r) => commit([...objects, { id: uuid(), kind: 'obstruction', pixelsPerMeter: null, geometry: { cx, cy, r }, props: { name: `Obstruction ${obstructions.length + 1}`, setbackM: 0.3, heightM: 1 } }])}
            onPoint={(kind, x, y) => commit([...objects, kind === 'inverter'
              ? { id: uuid(), kind: 'inverter', pixelsPerMeter: null, geometry: { x, y }, props: { name: `INV-${objects.filter((o) => o.kind === 'inverter').length + 1}`, inverter: GENERIC_INVERTER_50KW } }
              : { id: uuid(), kind: 'equipment', pixelsPerMeter: null, geometry: { x, y }, props: { equipmentKind: 'combiner', name: 'Combiner', nodeId: null } }])}
            onBlock={(a, b) => {
              const roof = roofUnder(a.x, a.y)
              if (!roof) { setMessage('Start the block inside a roof area.'); return }
              const plan = planModuleBlock({ roof, obstructions, sheetPixelsPerMeter: data.sheetPixelsPerMeter, startPx: a, endPx: b,
                module: data.layout.moduleSpec, orientation: 'portrait', mounting: 'flush', tiltDeg: roof.props.roofType === 'pitched' ? roof.props.pitchDeg : 0,
                facingSheetDeg: roof.props.fallBearingDeg ?? 0, gapM: 0.02, rowPitchM: null }, uuid())
              if (plan.ok) commit([...objects, plan.object])
              else setMessage(plan.error)
            }}
            onTwoPoints={(purpose, pts) => {
              const bearing = sheetBearing({ x: pts[0]!, y: pts[1]! }, { x: pts[2]!, y: pts[3]! })
              if (purpose === 'north') void saveNorth(bearing, pts)
              if (purpose === 'fall' && fallFor) {
                commit(objects.map((o) => (o.id === fallFor && o.kind === 'roof' ? { ...o, props: { ...o.props, fallBearingDeg: bearing } } : o)))
                setFallFor(null); setTool('select')
              }
            }}
            onModuleClick={(ref) => {
              if (!stringDraft.inverterId) { setMessage('Click an inverter first.'); return }
              if (stringDraft.modules.some((m) => m.arrayId === ref.arrayId && m.index === ref.index)) return
              setStringDraft((d) => ({ ...d, modules: [...d.modules, ref] }))
            }}
            onTranslate={(ids, dx, dy) => commit(translateObjects(objects, ids, dx, dy))}
            onTransform={(ids, deg, dx, dy) => commit(translateObjects(rotateObjects(objects, ids, deg, { x: 0, y: 0 }), ids, dx, dy))}
          />
          {show3d && <Layout3DPreview objects={objects} />}
        </div>
        <aside style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {autoFillRoof && (
            <AutoFillDialog roof={autoFillRoof} obstructions={obstructions} sheetPixelsPerMeter={data.sheetPixelsPerMeter} latDeg={data.latitude}
              northBearingDeg={north} module={data.layout.moduleSpec} defaultTiltDeg={data.layout.defaultTiltDeg} shadeFree={data.shadeFree}
              newId={uuid()} onPreview={setPreview} onClose={() => setAutoFillRoof(null)}
              onPlace={(plan) => { commit([...objects, plan.object]); setAutoFillRoof(null); setPreview(null) }} />
          )}
          <PropertiesPanel object={selectedObject} objects={objects} northBearingDeg={north} conditions={conditions} nodes={data.nodes} readOnly={readOnly}
            onChange={(next) => commit(objects.map((o) => (o.id === next.id ? next : o)))}
            onDrawFallLine={(roofId) => { setFallFor(roofId); setTool('fall') }} onAutoString={runAutoString} />
          <SummaryPanel objects={objects} conditions={conditions} layoutName={data.layout.name} onDownloadBom={downloadBom} />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Implement the editor page**

`apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/[layoutId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadLayoutEditor } from '@/lib/solar/layout-loader'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { LayoutWorkspace } from '../_components/LayoutWorkspace'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Layout editor (functional spec §6). View reads; Edit edits. Props handed to the client are JSON only. */
export default async function SolarLayoutEditorPage({ params }: { params: Promise<{ id: string; layoutId: string }> }) {
  const { id, layoutId } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const service = createServiceClient() as unknown as AnyClient
  const data = await loadLayoutEditor(supabase, service, id, layoutId, async (bucket, path) => {
    const { data: s } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
    return s?.signedUrl ?? null
  })
  if (!data) notFound()
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12 }}><Link href={`/projects/${id}/solar/layout`}>← Layouts</Link> · {data.layout.name} · {data.source.label}</div>
      <LayoutWorkspace data={data} canEdit={level !== 'view'} />
      <SavedReportsPanel projectId={id} kind="solar_layout_sheet" source={{ table: 'solar.layouts', id: layoutId }} canManage={false} title="Exported sheets" />
    </div>
  )
}
```

- [ ] **Step 9: Run the panel tests and type-check**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/layout/_components" && pnpm --filter web type-check`
Expected: PASS; type-check reports only the missing `Layout3DPreview` and `solar-layout-export.actions` modules (created in Tasks 13–14). To keep the tree compiling between tasks, create these two stubs now and replace them in Tasks 13/14:

`…/layout/_components/Layout3DPreview.tsx`:

```tsx
'use client'
import type { LayoutObject } from '@esite/shared'
/** Replaced in Task 14 by the react-three-fiber preview. */
export function Layout3DPreview(_: { objects: LayoutObject[] }) {
  return <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>3D preview is not available in this build.</p>
}
```

`apps/web/src/actions/solar-layout-export.actions.ts`:

```ts
'use server'
/** Replaced in Task 13 by the real export. */
export async function exportLayoutSheetAction(_: { projectId: string; layoutId: string; jpegBase64: string; crop: { x: number; y: number; w: number; h: number } }):
  Promise<{ ok: true; version: number; reportId: string } | { error: string }> {
  return { error: 'Export is not available in this build.' }
}
```

Re-run `pnpm --filter web type-check` → 0 errors.

- [ ] **Step 10: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout" apps/web/src/actions/solar-layout-export.actions.ts
git commit -m "feat(solar-layout): editor workspace — toolbar, properties, summary + BOM, auto-fill, undo/redo, drafts, save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Layout list page and the sheet page (calibrate + north)

**Files:**
- Create: `…/layout/page.tsx`, `…/layout/LayoutList.tsx`, `…/layout/LayoutList.test.tsx`
- Create: `…/layout/sources/[roofSourceId]/page.tsx`, `…/layout/sources/[roofSourceId]/SheetSettings.tsx`

- [ ] **Step 1: Write the failing list test**

`…/layout/LayoutList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ create: vi.fn(), dup: vi.fn(), rename: vi.fn(), del: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-layout.actions', () => ({ createLayoutAction: h.create, duplicateLayoutAction: h.dup, renameLayoutAction: h.rename, deleteLayoutAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))

import { LayoutList } from './LayoutList'

const sources = [{ id: 'rs1', label: 'Roof · page 1', pixelsPerMeter: 50 }]
const layouts = [{ id: 'L1', name: 'Option A', roofSourceId: 'rs1', dcKwp: 26.4, moduleCount: 48, updatedAt: '2026-09-28T10:00:00Z' }]
beforeEach(() => vi.clearAllMocks())

describe('LayoutList', () => {
  it('lists name, roof source, kWp and links to the editor', () => {
    render(<LayoutList projectId="p1" canEdit layouts={layouts} sources={sources} />)
    expect(screen.getByRole('link', { name: 'Option A' }).getAttribute('href')).toBe('/projects/p1/solar/layout/L1')
    expect(screen.getByText('Roof · page 1')).toBeTruthy()
    expect(screen.getByText('26.40 kWp')).toBeTruthy()
  })
  it('View level: no write controls', () => {
    render(<LayoutList projectId="p1" canEdit={false} layouts={layouts} sources={sources} />)
    for (const n of ['New layout', 'Duplicate', 'Rename', 'Delete']) expect(screen.queryByRole('button', { name: n })).toBeNull()
  })
  it('New layout shows the name error BEFORE anything is created and does not close', async () => {
    h.create.mockResolvedValue({ fieldErrors: { name: 'A layout with that name already exists.' } })
    render(<LayoutList projectId="p1" canEdit layouts={layouts} sources={sources} />)
    fireEvent.click(screen.getByRole('button', { name: 'New layout' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'option a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.getByText('A layout with that name already exists.')).toBeTruthy())
    expect(h.push).not.toHaveBeenCalled()
  })
  it('creates and opens the editor', async () => {
    h.create.mockResolvedValue({ ok: true, id: 'L9' })
    render(<LayoutList projectId="p1" canEdit layouts={[]} sources={sources} />)
    fireEvent.click(screen.getByRole('button', { name: 'New layout' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Option B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/layout/L9'))
    expect(h.create.mock.calls[0]![0]).toMatchObject({ projectId: 'p1', name: 'Option B', roofSourceId: 'rs1', defaultTiltDeg: 10 })
  })
  it('delete is two-step', async () => {
    h.del.mockResolvedValue({ ok: true })
    render(<LayoutList projectId="p1" canEdit layouts={layouts} sources={sources} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', layoutId: 'L1' }))
  })
  it('no roof source yet: explains where to add one', () => {
    render(<LayoutList projectId="p1" canEdit layouts={[]} sources={[]} />)
    expect(screen.getByText('Add a roof source in Site & Supply first.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/layout/LayoutList.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the list**

`…/layout/LayoutList.tsx`:

```tsx
'use client'
/** Layout list (functional spec §6.2): several design options per project. */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GENERIC_MODULE_550, type LayoutModuleSpec } from '@esite/shared'
import { createLayoutAction, deleteLayoutAction, duplicateLayoutAction, renameLayoutAction } from '@/actions/solar-layout.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

type Row = { id: string; name: string; roofSourceId: string; dcKwp: number | null; moduleCount: number | null; updatedAt: string }
type Source = { id: string; label: string; pixelsPerMeter: number | null }

const MODULE_FIELDS: Array<{ key: keyof LayoutModuleSpec; label: string }> = [
  { key: 'make', label: 'Make' }, { key: 'model', label: 'Model' }, { key: 'powerW', label: 'Power W' },
  { key: 'lengthM', label: 'Length m' }, { key: 'widthM', label: 'Width m' }, { key: 'vocStc', label: 'Voc V' },
  { key: 'vmpStc', label: 'Vmp V' }, { key: 'iscStc', label: 'Isc A' }, { key: 'betaVocPerC', label: 'β Voc /°C' }, { key: 'gammaVmpPerC', label: 'γ Vmp /°C' },
]

function DeleteButton({ onConfirm }: { onConfirm(): void }) {
  const { armed, arm, disarm } = useArmedConfirm()
  return armed ? <button type="button" onClick={() => { disarm(); onConfirm() }} style={{ color: '#dc2626' }}>Confirm delete</button>
    : <button type="button" onClick={arm}>Delete</button>
}

export function LayoutList({ projectId, canEdit, layouts, sources }: { projectId: string; canEdit: boolean; layouts: Row[]; sources: Source[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [tilt, setTilt] = useState('10')
  const [module, setModule] = useState<LayoutModuleSpec>(GENERIC_MODULE_550)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string; updatedAt: string } | null>(null)
  const label = new Map(sources.map((s) => [s.id, s.label]))

  async function create() {
    setErrors({}); setError(null)
    const res = await createLayoutAction({ projectId, name, roofSourceId: sourceId, module, defaultTiltDeg: Number(tilt) })
    if ('fieldErrors' in res) setErrors(res.fieldErrors)
    else if ('error' in res) setError(res.error)
    else router.push(`/projects/${projectId}/solar/layout/${res.id}`)
  }
  async function act(p: Promise<{ ok: true } | { error: string } | { fieldErrors: Record<string, string> }>) {
    const res = await p
    if ('error' in res) setError(res.error)
    else if ('fieldErrors' in res) setError(Object.values(res.fieldErrors)[0] ?? 'Could not save.')
    else { setRenaming(null); router.refresh() }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {sources.length === 0 && <p>Add a roof source in Site &amp; Supply first.</p>}
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead><tr><th align="left">Layout</th><th align="left">Roof source</th><th align="right">DC</th><th align="right">Updated</th><th /></tr></thead>
        <tbody>
          {layouts.map((l) => (
            <tr key={l.id}>
              <td>{renaming?.id === l.id
                ? <><input aria-label="New name" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                    <button type="button" onClick={() => void act(renameLayoutAction({ projectId, layoutId: l.id, name: renaming.name, expectedUpdatedAt: renaming.updatedAt }))}>Save name</button></>
                : <Link href={`/projects/${projectId}/solar/layout/${l.id}`}>{l.name}</Link>}</td>
              <td>{label.get(l.roofSourceId) ?? '—'}</td>
              <td align="right">{l.dcKwp === null ? '—' : `${l.dcKwp.toFixed(2)} kWp`}</td>
              <td align="right">{new Date(l.updatedAt).toLocaleDateString('en-ZA')}</td>
              <td align="right">{canEdit && <>
                <button type="button" onClick={() => void act(duplicateLayoutAction({ projectId, layoutId: l.id, name: `${l.name} (copy)` }))}>Duplicate</button>{' '}
                <button type="button" onClick={() => setRenaming({ id: l.id, name: l.name, updatedAt: l.updatedAt })}>Rename</button>{' '}
                <DeleteButton onConfirm={() => void act(deleteLayoutAction({ projectId, layoutId: l.id }))} />
              </>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && sources.length > 0 && !creating && <button type="button" onClick={() => setCreating(true)}>New layout</button>}
      {creating && (
        <div role="dialog" aria-label="New layout" style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, display: 'grid', gap: 6, fontSize: 13 }}>
          <label>Name <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          {errors.name && <span role="alert" style={{ color: '#dc2626' }}>{errors.name}</span>}
          <label>Roof source <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.label}{s.pixelsPerMeter === null ? ' (no scale yet)' : ''}</option>)}</select></label>
          <fieldset style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}><legend>Module</legend>
            {MODULE_FIELDS.map((f) => (
              <label key={f.key}>{f.label} <input value={String(module[f.key])} onChange={(e) => setModule({ ...module, [f.key]: typeof GENERIC_MODULE_550[f.key] === 'number' ? Number(e.target.value) : e.target.value })} style={{ width: 110 }} /></label>
            ))}
          </fieldset>
          {errors.module && <span role="alert" style={{ color: '#dc2626' }}>{errors.module}</span>}
          <label>Default tilt ° <input value={tilt} onChange={(e) => setTilt(e.target.value)} style={{ width: 60 }} /></label>
          {errors.defaultTiltDeg && <span role="alert" style={{ color: '#dc2626' }}>{errors.defaultTiltDeg}</span>}
          <div><button type="button" onClick={() => void create()}>Create</button> <button type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </div>
      )}
      {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Implement the list page**

`…/layout/page.tsx`:

```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadLayoutList, loadRoofSources } from '@/lib/solar/layout-loader'
import { LayoutList } from './LayoutList'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Layout tab (functional spec §6.2). View lists and opens read-only; Edit creates and manages. */
export default async function SolarLayoutListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const [layouts, roof] = await Promise.all([loadLayoutList(supabase, id), loadRoofSources(supabase, id)])
  return (
    <LayoutList projectId={id} canEdit={level !== 'view'} layouts={layouts}
      sources={roof.sources.map((s) => ({ id: s.id, label: s.label, pixelsPerMeter: s.pixelsPerMeter }))} />
  )
}
```

- [ ] **Step 5: Implement the sheet page (calibrate + north)**

`…/layout/sources/[roofSourceId]/SheetSettings.tsx`:

```tsx
'use client'
/**
 * One roof sheet: calibrate its scale (drawing pages only, through the existing
 * role-gated calibrateFloorPlanAction — owner/admin/PM) and set north.
 */
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sheetBearing } from '@esite/shared'
import { calibrateFloorPlanAction } from '@/actions/cable-route.actions'
import { setRoofNorthAction } from '@/actions/solar-roof-sources.actions'
import type { RoofSourceRow } from '@/lib/solar/layout-loader'
import { EMPTY_SELECTION, type LayoutTool } from '../../_components/SolarCanvas'

const SolarCanvas = dynamic(() => import('../../_components/SolarCanvas').then((m) => m.SolarCanvas), { ssr: false })

export function SheetSettings({ projectId, source, sheet, canEdit }: {
  projectId: string; source: RoofSourceRow; sheet: { key: string; signedUrl: string | null; isPdf: boolean; pageIndex: number }; canEdit: boolean
}) {
  const router = useRouter()
  const [tool, setTool] = useState<LayoutTool>('select')
  const [points, setPoints] = useState<number[] | null>(null)
  const [metres, setMetres] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState(source.updatedAt)

  async function calibrate() {
    if (!points || !source.floorPlanId) return
    const res = await calibrateFloorPlanAction({ floorPlanId: source.floorPlanId, points, realMetres: Number(metres), pageIndex: source.pageIndex })
    setMsg(res.error ?? `Scale set: ${res.pixelsPerMeter?.toFixed(1)} px/m.`)
    if (!res.error) { setPoints(null); setTool('select'); router.refresh() }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ fontSize: 13 }}>{source.label} · scale {source.pixelsPerMeter === null ? 'not set' : `${source.pixelsPerMeter.toFixed(1)} px/m`} · north {source.northSet ? `${source.northBearingDeg}°` : 'not set'}</p>
      {canEdit && (
        <div style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'center' }}>
          {source.kind === 'drawing' && <button type="button" onClick={() => { setPoints(null); setTool('calibrate') }}>Calibrate scale</button>}
          <button type="button" onClick={() => setTool('north')}>Set north (click two points: from, then towards north)</button>
          {tool === 'calibrate' && points && (<>
            <label>Real distance m <input type="number" value={metres} onChange={(e) => setMetres(e.target.value)} style={{ width: 80 }} /></label>
            <button type="button" disabled={!(Number(metres) > 0)} onClick={() => void calibrate()}>Save scale</button>
          </>)}
        </div>
      )}
      {msg && <p role="status" style={{ fontSize: 12 }}>{msg}</p>}
      <SolarCanvas sheet={sheet} objects={[]} preview={null} selection={EMPTY_SELECTION} tool={tool} readOnly={!canEdit} circleMode={false}
        sheetPixelsPerMeter={source.pixelsPerMeter}
        onSelect={() => {}} onPolygon={() => {}} onCircle={() => {}} onPoint={() => {}} onBlock={() => {}} onModuleClick={() => {}} onTranslate={() => {}} onTransform={() => {}}
        onTwoPoints={(purpose, pts) => {
          if (purpose === 'calibrate') { setPoints(pts); return }
          if (purpose === 'north') {
            void setRoofNorthAction({ projectId, roofSourceId: source.id, bearingDeg: sheetBearing({ x: pts[0]!, y: pts[1]! }, { x: pts[2]!, y: pts[3]! }), points: pts, expectedUpdatedAt: updatedAt })
              .then((res) => {
                if ('error' in res) setMsg(res.error)
                else { setUpdatedAt(res.updatedAt); setMsg(`North set to ${res.bearingDeg}°.`); setTool('select'); router.refresh() }
              })
          }
        }} />
    </div>
  )
}
```

`…/layout/sources/[roofSourceId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadRoofSources } from '@/lib/solar/layout-loader'
import { SheetSettings } from './SheetSettings'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export default async function SolarRoofSheetPage({ params }: { params: Promise<{ id: string; roofSourceId: string }> }) {
  const { id, roofSourceId } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const { sources } = await loadRoofSources(supabase, id)
  const source = sources.find((s) => s.id === roofSourceId)
  if (!source) notFound()
  const { data: row } = await supabase.schema('solar').from('roof_sources').select('storage_path').eq('id', roofSourceId).maybeSingle()
  const { data: plan } = source.floorPlanId
    ? await supabase.schema('tenants').from('floor_plans').select('file_path').eq('id', source.floorPlanId).maybeSingle()
    : { data: null }
  const bucket = source.kind === 'satellite' ? 'solar-roof-images' : 'drawings'
  const path = source.kind === 'satellite' ? (row as { storage_path?: string } | null)?.storage_path : (plan as { file_path?: string } | null)?.file_path
  const { data: signed } = path ? await supabase.storage.from(bucket).createSignedUrl(path, 3600) : { data: null }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12 }}><Link href={`/projects/${id}/solar/site`}>← Site &amp; Supply</Link></div>
      <SheetSettings projectId={id} source={source} canEdit={level !== 'view'}
        sheet={{ key: source.id, signedUrl: signed?.signedUrl ?? null, isPdf: /\.pdf$/i.test(path ?? ''), pageIndex: source.pageIndex }} />
    </div>
  )
}
```

- [ ] **Step 6: Run the tests and type-check**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/layout" && pnpm --filter web type-check`
Expected: PASS, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout"
git commit -m "feat(solar-layout): layout list (new/duplicate/rename/delete) and the roof sheet page (calibrate, north)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Export layout sheet → `projects.reports` kind `solar_layout_sheet`

**Files:**
- Create: `apps/web/src/test/fixtures/jpeg-1px.ts` (extracted, not hand-typed)
- Create: `apps/web/src/lib/solar/layout-sheet-pdf.ts`
- Test: `apps/web/src/lib/solar/layout-sheet-pdf.test.ts`
- Replace: `apps/web/src/actions/solar-layout-export.actions.ts` (the Task 11 stub)
- Test: `apps/web/src/actions/solar-layout-export.actions.test.ts`

- [ ] **Step 1: Extract the existing 1-px JPEG fixture**

```bash
mkdir -p apps/web/src/test/fixtures
grep -m1 "const JPEG_1PX = '/9j/" apps/web/src/actions/cable-route.actions.test.ts | sed 's/^ *const/export const/' > apps/web/src/test/fixtures/jpeg-1px.ts
head -c 60 apps/web/src/test/fixtures/jpeg-1px.ts
```

Expected: `export const JPEG_1PX = '/9j/4AAQSkZJRgABAQAASABIAAD/4Q…`

- [ ] **Step 2: Write the failing renderer test**

`apps/web/src/lib/solar/layout-sheet-pdf.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderLayoutSheetPdf, niceScaleBar, A3_LANDSCAPE } from './layout-sheet-pdf'
import { JPEG_1PX } from '@/test/fixtures/jpeg-1px'

describe('niceScaleBar', () => {
  it('picks the longest round length that fits', () => {
    expect(niceScaleBar(0.1, 150)).toEqual({ metres: 10, widthPt: 100 })
    expect(niceScaleBar(0.01, 150)).toEqual({ metres: 1, widthPt: 100 })
    expect(niceScaleBar(1, 150)).toEqual({ metres: 100, widthPt: 100 })
  })
})

describe('renderLayoutSheetPdf', () => {
  it('one A3 landscape page with the image, and never throws on non-WinAnsi text', async () => {
    const bytes = await renderLayoutSheetPdf({
      jpegBase64: JPEG_1PX, imageWidthPx: 1, imageHeightPx: 1, metresPerImagePx: 0.02, northBearingDeg: 30,
      projectName: '(P1) Ωmega ≤ → Mall', layoutName: 'Option A', sourceLabel: 'Roof · page 1', version: 2, dateIso: '2026-09-28',
      summaryLines: ['26.40 kWp DC · 50.0 kW AC', 'Strings: 3 pass · 0 fail'], legend: [{ colour: '#e6194b', label: 'INV-1 MPPT 1 · 20 modules' }],
      attribution: '© Mapbox © OpenStreetMap © Maxar', warnings: ['The scale changed since this layout was drawn.'],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]
    expect([Math.round(w), Math.round(h)]).toEqual([Math.round(A3_LANDSCAPE[0]), Math.round(A3_LANDSCAPE[1])])
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/lib/solar/layout-sheet-pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the renderer**

`apps/web/src/lib/solar/layout-sheet-pdf.ts`:

```ts
/**
 * The Solar layout sheet (functional spec §6.3 "Export layout sheet"): drawing
 * crop with arrays and string colours (rasterised by the browser — the same
 * reason as exportRouteSheetAction: one renderer, not two), plus a vector
 * legend, north arrow, scale bar and title block computed here from the
 * database. Every string goes through winAnsiSafe: pdf-lib standard fonts throw
 * on Ω / ≤ / → (PR #154).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe } from '@/lib/pdf/winansi'

export const A3_LANDSCAPE: [number, number] = [1190.55, 841.89]

export interface LayoutSheetInput {
  jpegBase64: string
  imageWidthPx: number
  imageHeightPx: number
  /** Metres per IMAGE pixel of the crop (1 / sheet px-per-m); null → no scale bar. */
  metresPerImagePx: number | null
  northBearingDeg: number | null
  projectName: string
  layoutName: string
  sourceLabel: string
  version: number
  dateIso: string
  summaryLines: string[]
  legend: Array<{ colour: string; label: string }>
  attribution: string | null
  warnings: string[]
}

export function niceScaleBar(metresPerPt: number, maxWidthPt: number): { metres: number; widthPt: number } {
  const steps = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5]
  for (const m of steps) {
    const w = m / metresPerPt
    if (w <= maxWidthPt) return { metres: m, widthPt: Math.round(w * 1000) / 1000 }
  }
  return { metres: 0.5, widthPt: 0.5 / metresPerPt }
}

function hex(c: string) {
  const n = parseInt(c.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function renderLayoutSheetPdf(i: LayoutSheetInput): Promise<Uint8Array> {
  const T = (s: string) => winAnsiSafe(s)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const jpg = await doc.embedJpg(i.jpegBase64) // base64, not a Buffer (jsdom realm)
  const [W, H] = A3_LANDSCAPE
  const page = doc.addPage(A3_LANDSCAPE)
  const m = 28
  const panel = 260
  const box = { x: m, y: m + 40, w: W - 2 * m - panel - 12, h: H - 2 * m - 40 }
  const s = Math.min(box.w / i.imageWidthPx, box.h / i.imageHeightPx)
  const dw = i.imageWidthPx * s
  const dh = i.imageHeightPx * s
  const ix = box.x + (box.w - dw) / 2
  const iy = box.y + (box.h - dh) / 2
  page.drawImage(jpg, { x: ix, y: iy, width: dw, height: dh })
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 })

  if (i.metresPerImagePx) {
    const bar = niceScaleBar(i.metresPerImagePx / s, box.w / 4)
    page.drawRectangle({ x: box.x, y: m + 16, width: bar.widthPt, height: 5, color: rgb(0, 0, 0) })
    page.drawText(T(`${bar.metres} m`), { x: box.x + bar.widthPt + 6, y: m + 15, size: 9, font })
  }
  if (i.northBearingDeg !== null) {
    const cx = box.x + box.w - 30
    const cy = box.y + box.h - 40
    const r = (i.northBearingDeg * Math.PI) / 180
    const tip = { x: cx + Math.sin(r) * 20, y: cy + Math.cos(r) * 20 }
    const back = { x: cx - Math.sin(r) * 14, y: cy - Math.cos(r) * 14 }
    page.drawLine({ start: back, end: tip, thickness: 2, color: rgb(0, 0, 0) })
    page.drawCircle({ x: tip.x, y: tip.y, size: 3, color: rgb(0, 0, 0) })
    page.drawText('N', { x: tip.x + Math.sin(r) * 8 - 3, y: tip.y + Math.cos(r) * 8 - 3, size: 11, font: bold })
  }

  const px = W - m - panel
  let y = H - m - 14
  const line = (t: string, size = 9, f = font) => { page.drawText(T(t), { x: px, y, size, font: f, maxWidth: panel }); y -= size + 5 }
  line('PV layout sheet', 14, bold)
  line(i.projectName, 10, bold)
  line(`Layout: ${i.layoutName}`)
  line(`Sheet: ${i.sourceLabel}`)
  line(`Version ${i.version} · ${i.dateIso}`)
  y -= 6
  for (const s2 of i.summaryLines) line(s2)
  y -= 6
  if (i.legend.length) line('Strings', 10, bold)
  for (const l of i.legend.slice(0, 40)) {
    page.drawRectangle({ x: px, y: y - 1, width: 10, height: 8, color: hex(l.colour) })
    page.drawText(T(l.label), { x: px + 14, y, size: 8, font, maxWidth: panel - 14 })
    y -= 12
  }
  if (i.legend.length > 40) line(`… and ${i.legend.length - 40} more strings`)
  for (const w of i.warnings) { y -= 4; page.drawText(T(w), { x: px, y, size: 8, font, color: rgb(0.7, 0.35, 0), maxWidth: panel }); y -= 12 }
  if (i.attribution) page.drawText(T(i.attribution), { x: px, y: m, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  page.drawText(T('Positions are image pixels of the sheet at its recorded scale. Not for construction without verification.'),
    { x: m, y: m, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  return doc.save()
}
```

- [ ] **Step 5: Run the renderer test**

Run: `pnpm --filter web exec vitest run src/lib/solar/layout-sheet-pdf.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing action test**

`apps/web/src/actions/solar-layout-export.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JPEG_1PX } from '@/test/fixtures/jpeg-1px'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), createServiceClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn(),
  upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { exportLayoutSheetAction } from './solar-layout-export.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const P = '11111111-1111-4111-8111-111111111111'
const L = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
  const session = fakeSupabase({ userId: 'u1', tables: {
    'solar.layouts': [{ id: L, project_id: P, organisation_id: 'o1', name: 'Option A', roof_source_id: 'rs1', design_t_min_c: -5, design_t_amb_max_c: 35 }],
    'solar.roof_sources': [{ id: 'rs1', kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, m_per_px: null, north_bearing_deg: 0, attribution: null }],
    'tenants.floor_plans': [{ id: 'fp1', name: 'Roof', pixels_per_meter: 50 }],
    'tenants.floor_plan_page_scales': [],
    'solar.layout_objects': [],
    'projects.projects': [{ id: P, name: '(P1) Mall' }],
  } })
  h.createClient.mockResolvedValue(session.client)
  const service = fakeSupabase({ tables: { 'projects.reports': [] }, writes: { 'projects.reports:insert': { data: [{ id: 'rep1' }] } } })
  h.createServiceClient.mockReturnValue({ ...service.client, storage: { from: () => ({ upload: h.upload, remove: h.remove }) } })
  ;(globalThis as { __svcCalls?: unknown }).__svcCalls = service.calls
})

describe('exportLayoutSheetAction', () => {
  it('re-checks Edit, renders, stores v1 under org/project and inserts kind solar_layout_sheet', async () => {
    const res = await exportLayoutSheetAction({ projectId: P, layoutId: L, jpegBase64: JPEG_1PX, crop: { x: 0, y: 0, w: 1, h: 1 } })
    expect(res).toEqual({ ok: true, version: 1, reportId: 'rep1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect((h.upload.mock.calls[0] as unknown[])[0]).toBe(`o1/${P}/solar-layout-sheets/${L}-v1.pdf`)
    const calls = (globalThis as { __svcCalls?: Parameters<typeof callsTo>[0] }).__svcCalls!
    expect(callsTo(calls, 'projects.reports', 'insert')[0]!.payload).toMatchObject({
      kind: 'solar_layout_sheet', source_table: 'solar.layouts', source_id: L, version: 1, status: 'issued', organisation_id: 'o1', project_id: P,
    })
  })
  it('refuses a malformed image', async () => {
    await expect(exportLayoutSheetAction({ projectId: P, layoutId: L, jpegBase64: 'x', crop: { x: 0, y: 0, w: 1, h: 1 } }))
      .resolves.toEqual({ error: 'The sheet image could not be read — try again.' })
  })
})
```

- [ ] **Step 7: Replace the stub with the action**

`apps/web/src/actions/solar-layout-export.actions.ts`:

```ts
'use server'
/**
 * Export layout sheet (functional spec §6.3): the browser's rasterised crop +
 * a legend/title block computed HERE from the stored layout, saved as the next
 * version in projects.reports kind 'solar_layout_sheet' (source solar.layouts).
 * Writing needs Solar Edit; reading follows the Solar level (00212 +
 * report-kind-access.ts SOLAR_READ_REPORT_KINDS).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { scaleForSource } from '@/lib/solar/layout-loader'
import { renderLayoutSheetPdf } from '@/lib/solar/layout-sheet-pdf'
import { isArrayObject, layoutSummary, stringColour, type LayoutObject } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
// The kind is written as a LITERAL at each .from('reports') call on purpose:
// report-kind-access.contract.test.ts finds writers by scanning for
// `kind: '<literal>'` / `.eq('kind', '<literal>')`; a constant would hide this
// writer from the contract.

export async function exportLayoutSheetAction(input: {
  projectId: string; layoutId: string; jpegBase64: string; crop: { x: number; y: number; w: number; h: number }; note?: string | null
}): Promise<{ ok: true; version: number; reportId: string } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (typeof input.jpegBase64 !== 'string' || input.jpegBase64.length < 100 || input.jpegBase64.length > 9_500_000) return { error: 'The sheet image could not be read — try again.' }
  const c = input.crop
  if (!c || ![c.x, c.y, c.w, c.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || c.w <= 0 || c.h <= 0) return { error: 'The sheet image could not be read — try again.' }

  const { data: layout } = await supabase.schema('solar').from('layouts')
    .select('id, project_id, organisation_id, name, roof_source_id, design_t_min_c, design_t_amb_max_c').eq('id', input.layoutId).eq('project_id', input.projectId).maybeSingle()
  const l = layout as { organisation_id: string; name: string; roof_source_id: string; design_t_min_c: number; design_t_amb_max_c: number } | null
  if (!l) return { error: 'This layout no longer exists — reload.' }
  const [{ data: rs }, { data: objs }, { data: project }] = await Promise.all([
    supabase.schema('solar').from('roof_sources').select('id, kind, floor_plan_id, page_index, m_per_px, north_bearing_deg, attribution').eq('id', l.roof_source_id).maybeSingle(),
    supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', input.layoutId),
    supabase.schema('projects').from('projects').select('name').eq('id', input.projectId).maybeSingle(),
  ])
  const src = rs as { kind: string; floor_plan_id: string | null; page_index: number; m_per_px: number | null; north_bearing_deg: number | null; attribution: string | null } | null
  if (!src) return { error: 'This layout no longer exists — reload.' }
  let ppm: number | null = null
  let sourceLabel = 'Satellite capture'
  if (src.kind === 'drawing' && src.floor_plan_id) {
    const [{ data: plan }, { data: pages }] = await Promise.all([
      supabase.schema('tenants').from('floor_plans').select('id, name, pixels_per_meter').eq('id', src.floor_plan_id).maybeSingle(),
      supabase.schema('tenants').from('floor_plan_page_scales').select('page_index, pixels_per_meter').eq('floor_plan_id', src.floor_plan_id),
    ])
    const p = plan as { name: string; pixels_per_meter: number | null } | null
    sourceLabel = `${p?.name ?? 'Drawing'} · page ${src.page_index}`
    ppm = scaleForSource(src, new Map([[src.floor_plan_id, p?.pixels_per_meter == null ? null : Number(p.pixels_per_meter)]]),
      new Map(((pages ?? []) as Array<{ page_index: number; pixels_per_meter: number }>).map((x) => [`${src.floor_plan_id}#${x.page_index}`, Number(x.pixels_per_meter)])))
  } else ppm = scaleForSource(src, new Map(), new Map())

  const objects = ((objs ?? []) as Array<{ id: string; kind: string; geometry: unknown; props: unknown; pixels_per_meter: number | null }>)
    .map((o) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props, pixelsPerMeter: o.pixels_per_meter == null ? null : Number(o.pixels_per_meter) }) as LayoutObject)
  const s = layoutSummary(objects, { tMinC: Number(l.design_t_min_c), tAmbMaxC: Number(l.design_t_amb_max_c) })
  const inverters = new Map(objects.filter((o) => o.kind === 'inverter').map((o) => [o.id, o.kind === 'inverter' ? o.props.name : '']))
  const legend = objects.filter((o) => o.kind === 'string').map((o, i) => ({
    colour: stringColour(i),
    label: o.kind === 'string' ? `${inverters.get(o.props.inverterId) ?? 'Inverter'} MPPT ${o.props.mppt} · ${o.props.modules.length} modules` : '',
  }))
  const scaleChanged = ppm !== null && objects.some((o) => o.pixelsPerMeter !== null && Math.abs(o.pixelsPerMeter - ppm!) > 1e-6)

  const service = createServiceClient() as unknown as AnyClient
  const { data: prior } = await service.schema('projects').from('reports').select('id, version')
    .eq('project_id', input.projectId).eq('kind', 'solar_layout_sheet').eq('source_id', input.layoutId).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as { version: number }).version) + 1 : 1

  let pdf: Uint8Array
  try {
    pdf = await renderLayoutSheetPdf({
      jpegBase64: input.jpegBase64, imageWidthPx: c.w, imageHeightPx: c.h, metresPerImagePx: ppm ? 1 / ppm : null,
      northBearingDeg: src.north_bearing_deg == null ? null : Number(src.north_bearing_deg),
      projectName: (project as { name?: string } | null)?.name ?? '', layoutName: l.name, sourceLabel, version,
      dateIso: new Date().toISOString().slice(0, 10),
      summaryLines: [
        `${s.dcKwp.toFixed(2)} kWp DC · ${s.acKw.toFixed(1)} kW AC${s.dcAcRatio === null ? '' : ` · DC/AC ${s.dcAcRatio.toFixed(2)}`}`,
        `${s.moduleCount} modules · ${s.inverterCount} inverters`,
        `Strings: ${s.strings.pass} pass · ${s.strings.warn} warn · ${s.strings.fail} fail`,
        s.utilisationPct === null ? 'Roof utilisation: —' : `Roof utilisation: ${s.utilisationPct.toFixed(1)} %`,
      ],
      legend, attribution: src.attribution,
      warnings: [
        ...(scaleChanged ? ['The sheet scale changed since some objects were drawn; lengths use each object’s recorded scale.'] : []),
        ...(s.arraysOutsideRoof.length ? ['An array lies outside every roof area.'] : []),
      ],
    })
  } catch {
    return { error: 'The sheet image could not be read — try again.' }
  }

  const storagePath = `${l.organisation_id}/${input.projectId}/solar-layout-sheets/${input.layoutId}-v${version}.pdf`
  const { error: upErr } = await service.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: 'Could not store the sheet — try again.' }
  const { data: rep, error: insErr } = await service.schema('projects').from('reports').insert({
    organisation_id: l.organisation_id,
    project_id: input.projectId,
    kind: 'solar_layout_sheet',
    source_table: 'solar.layouts',
    source_id: input.layoutId,
    title: `PV layout — ${l.name}`,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version,
    summary: { modules: s.moduleCount, kwp: s.dcKwp, strings: s.strings.total },
    note: input.note ?? null,
    generated_by: user.id,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await service.storage.from('reports').remove([storagePath])
    return { error: 'Could not save the sheet — try again.' }
  }
  if (prior) await service.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', (prior as { id: string }).id)
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'layout_sheet_exported', objectRef: { layoutId: input.layoutId, version } })
  revalidatePath(`/projects/${input.projectId}/solar/layout/${input.layoutId}`)
  return { ok: true, version, reportId }
}
```

- [ ] **Step 8: Run the tests, including the report-kind contract**

Run: `pnpm --filter web exec vitest run src/lib/solar/layout-sheet-pdf.test.ts src/actions/solar-layout-export.actions.test.ts src/lib/reports/report-kind-access.contract.test.ts`
Expected: PASS — the contract scanner now finds `kind: 'solar_layout_sheet'` after `.from('reports')` and it is declared in `SOLAR_READ_REPORT_KINDS` (5-i Task 14). Mutation: temporarily remove `solar_layout_sheet` from `SOLAR_READ_REPORT_KINDS` → the contract fails naming `solar-layout-export.actions.ts`; restore.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/test/fixtures/jpeg-1px.ts apps/web/src/lib/solar/layout-sheet-pdf.ts apps/web/src/lib/solar/layout-sheet-pdf.test.ts apps/web/src/actions/solar-layout-export.actions.ts apps/web/src/actions/solar-layout-export.actions.test.ts
git commit -m "feat(solar-layout): versioned layout sheet PDF (legend, north arrow, scale bar, title block)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14 (optional, separable): Read-only 3D preview

The repo has **no** `three` / `@react-three/fiber` today (`apps/web/package.json`). Adding them is justified because the preview is loaded with `next/dynamic` + `ssr: false` only when the user opens it (zero cost to every other page) and fiber 9 is the React 19 line. If the owner declines new dependencies, skip this task: the Task 11 stub already renders "3D preview is not available in this build." and nothing else depends on it.

**Files:**
- Modify: `apps/web/package.json` (deps)
- Create: `packages/shared/src/solar/layout/scene3d.ts` (+ export) and `scene3d.test.ts`
- Replace: `…/layout/_components/Layout3DPreview.tsx`

- [ ] **Step 1: Write the failing scene test**

`packages/shared/src/solar/layout/scene3d.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildScene3d, roofHeightAt } from './scene3d'
import { GENERIC_MODULE_550 as M, type LayoutObject, type RoofObject } from './types'

const pitched: RoofObject = { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 120, 0, 120, 70, 0, 70] },
  props: { name: 'P', roofType: 'pitched', pitchDeg: 30, fallBearingDeg: 0, heightM: 5, setbackM: 0.3, maxLoadKgM2: null } }

describe('scene3d', () => {
  it('pitched roof: eaves (downhill, north edge) at height, ridge side higher by depth × tan(pitch)', () => {
    expect(roofHeightAt(pitched, { x: 6, y: 0 })).toBeCloseTo(5, 9)
    expect(roofHeightAt(pitched, { x: 6, y: 7 })).toBeCloseTo(5 + 7 * Math.tan(Math.PI / 6), 9)
  })
  it('a racked module raises its back edge by slope × sin(tilt)', () => {
    const flat: RoofObject = { ...pitched, props: { ...pitched.props, roofType: 'flat', pitchDeg: 0, fallBearingDeg: null } }
    const arr: LayoutObject = { id: 'A', kind: 'array', pixelsPerMeter: 10, geometry: { modules: [[10, 10, 21.34, 10, 21.34, 32.0, 10, 32.0]] },
      props: { roofId: 'R', module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 } }
    const scene = buildScene3d([flat, arr])
    const zs = scene.modules[0]!.corners.map((c) => c[2])
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2.278 * Math.sin(Math.PI / 12), 6)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/scene3d.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scene builder**

`packages/shared/src/solar/layout/scene3d.ts`:

```ts
/**
 * A read-only 3D scene for the Layout preview (functional spec §6.3 "3D
 * preview"): roofs as planes at their height (pitched ones rising up-slope
 * from the eaves), modules lying on them (flush) or tilted on racks, and
 * obstructions as prisms. Metres; x east-ish = plan x, y = −plan y, z up. Pure.
 */
import { flatToPts, pointInPolygon, pxToM, vertexMean } from './geometry'
import { sheetDirection } from './orientation'
import { isArrayObject, isCircleGeometry, type LayoutObject, type Pt, type RoofObject } from './types'

export type Vec3 = [number, number, number]
export interface Scene3D {
  roofs: Array<{ id: string; top: Vec3[] }>
  modules: Array<{ arrayId: string; corners: Vec3[] }>
  obstructions: Array<{ id: string; base: Vec3[]; heightM: number }>
}

const RACK_CLEARANCE_M = 0.1
const FLUSH_STANDOFF_M = 0.05

function roofM(r: RoofObject): Pt[] {
  return r.pixelsPerMeter ? pxToM(r.geometry.points, r.pixelsPerMeter) : []
}

/** Roof surface height at a plan point (metres). */
export function roofHeightAt(r: RoofObject, p: Pt): number {
  if (r.props.roofType !== 'pitched' || r.props.fallBearingDeg === null || r.props.pitchDeg === 0) return r.props.heightM
  const d = sheetDirection(r.props.fallBearingDeg)
  const maxProj = Math.max(...roofM(r).map((v) => v.x * d.x + v.y * d.y))
  return r.props.heightM + (maxProj - (p.x * d.x + p.y * d.y)) * Math.tan((r.props.pitchDeg * Math.PI) / 180)
}

const v3 = (p: Pt, z: number): Vec3 => [p.x, -p.y, z]

export function buildScene3d(objects: LayoutObject[]): Scene3D {
  const roofs = objects.filter((o): o is RoofObject => o.kind === 'roof' && o.pixelsPerMeter !== null)
  const roofOf = (p: Pt) => roofs.find((r) => pointInPolygon(p, roofM(r)))
  const scene: Scene3D = { roofs: [], modules: [], obstructions: [] }
  for (const r of roofs) scene.roofs.push({ id: r.id, top: roofM(r).map((p) => v3(p, roofHeightAt(r, p))) })
  for (const a of objects.filter(isArrayObject)) {
    if (!a.pixelsPerMeter) continue
    const f = sheetDirection(a.props.facingSheetDeg)
    const rise = a.props.mounting === 'racked'
      ? (a.props.orientation === 'portrait' ? a.props.module.lengthM : a.props.module.widthM) * Math.sin((a.props.tiltDeg * Math.PI) / 180)
      : 0
    for (const q of a.geometry.modules) {
      const pts = pxToM(q, a.pixelsPerMeter)
      const proj = pts.map((p) => p.x * f.x + p.y * f.y)
      const lo = Math.min(...proj), hi = Math.max(...proj)
      const roof = roofOf(vertexMean(pts))
      scene.modules.push({
        arrayId: a.id,
        corners: pts.map((p, i) => {
          const base = roof ? roofHeightAt(roof, p) : 0
          if (a.props.mounting === 'flush') return v3(p, base + FLUSH_STANDOFF_M)
          const t = hi > lo ? (proj[i]! - lo) / (hi - lo) : 0
          return v3(p, base + RACK_CLEARANCE_M + (1 - t) * rise)
        }),
      })
    }
  }
  for (const o of objects) {
    if (o.kind !== 'obstruction' || !o.pixelsPerMeter) continue
    const ppm = o.pixelsPerMeter
    const pts = isCircleGeometry(o.geometry)
      ? Array.from({ length: 16 }, (_, i) => ({ x: (o.geometry as { cx: number }).cx / ppm + Math.cos((i / 16) * 2 * Math.PI) * (o.geometry as { r: number }).r / ppm, y: (o.geometry as { cy: number }).cy / ppm + Math.sin((i / 16) * 2 * Math.PI) * (o.geometry as { r: number }).r / ppm }))
      : flatToPts(o.geometry.points).map((p) => ({ x: p.x / ppm, y: p.y / ppm }))
    const roof = roofOf(vertexMean(pts))
    const z = roof ? roofHeightAt(roof, vertexMean(pts)) : 0
    scene.obstructions.push({ id: o.id, base: pts.map((p) => v3(p, z)), heightM: o.props.heightM })
  }
  return scene
}
```

Append `export * from './scene3d'` to `packages/shared/src/solar/layout/index.ts`.

- [ ] **Step 4: Run the scene test**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/scene3d.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the dependencies**

```bash
pnpm --filter web add three@^0.170.0 @react-three/fiber@^9.0.0
pnpm --filter web add -D @types/three@^0.170.0
```

Expected: `apps/web/package.json` gains the three entries; `pnpm-lock.yaml` updates.

- [ ] **Step 6: Replace the preview stub**

`…/layout/_components/Layout3DPreview.tsx`:

```tsx
'use client'
/**
 * Read-only 3D preview (functional spec §6.3): roof planes at their heights,
 * tilted module rows, obstructions; orbit/zoom, Reset view, Screenshot to PNG.
 * Loaded with next/dynamic (ssr: false) only when opened.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildScene3d, type LayoutObject, type Vec3 } from '@esite/shared'

function polygonMesh(top: Vec3[], color: string) {
  const shape2d = top.map((v) => new THREE.Vector2(v[0], v[1]))
  const tris = THREE.ShapeUtils.triangulateShape(shape2d, [])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(top.flatMap((v) => v), 3))
  g.setIndex(tris.flat())
  g.computeVertexNormals()
  return <mesh geometry={g}><meshStandardMaterial color={color} side={THREE.DoubleSide} /></mesh>
}

function Controls({ resetRef, target }: { resetRef: React.MutableRefObject<(() => void) | null>; target: THREE.Vector3 }) {
  const { camera, gl } = useThree()
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.target.copy(target)
    c.update()
    c.saveState()
    resetRef.current = () => c.reset()
    return () => c.dispose()
  }, [camera, gl, target, resetRef])
  return null
}

export function Layout3DPreview({ objects }: { objects: LayoutObject[] }) {
  const scene = useMemo(() => buildScene3d(objects), [objects])
  const resetRef = useRef<(() => void) | null>(null)
  const glRef = useRef<HTMLCanvasElement | null>(null)
  const all = [...scene.roofs.flatMap((r) => r.top), ...scene.modules.flatMap((m) => m.corners)]
  const cx = all.length ? all.reduce((s, v) => s + v[0], 0) / all.length : 0
  const cy = all.length ? all.reduce((s, v) => s + v[1], 0) / all.length : 0
  const target = useMemo(() => new THREE.Vector3(cx, 0, -cy), [cx, cy])

  function screenshot() {
    const url = glRef.current?.toDataURL('image/png')
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = 'layout-3d.png'
    a.click()
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, fontSize: 12, marginBottom: 4 }}>
        <button type="button" onClick={() => resetRef.current?.()}>Reset view</button>
        <button type="button" onClick={screenshot}>Screenshot</button>
      </div>
      <div style={{ height: 420, border: '1px solid var(--c-border)', borderRadius: 8 }}>
        <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [cx + 30, 40, -cy + 30], fov: 45 }}
          onCreated={({ gl }) => { glRef.current = gl.domElement }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[20, 40, 10]} intensity={0.8} />
          <group rotation={[-Math.PI / 2, 0, 0]}>
            {scene.roofs.map((r) => <group key={r.id}>{polygonMesh(r.top, '#d6d3d1')}</group>)}
            {scene.modules.map((m, i) => <group key={`${m.arrayId}-${i}`}>{polygonMesh(m.corners, '#1d4ed8')}</group>)}
            {scene.obstructions.map((o) => <group key={o.id}>{polygonMesh(o.base.map((v) => [v[0], v[1], v[2] + o.heightM] as Vec3), '#dc2626')}</group>)}
          </group>
          <Controls resetRef={resetRef} target={target} />
        </Canvas>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Build check**

Run: `pnpm --filter @esite/shared test && pnpm --filter web type-check && pnpm --filter web build`
Expected: green; the build succeeds (the dynamic import keeps three out of the server bundle).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/solar/layout/scene3d.ts packages/shared/src/solar/layout/scene3d.test.ts packages/shared/src/solar/layout/index.ts apps/web/package.json pnpm-lock.yaml "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout/_components/Layout3DPreview.tsx"
git commit -m "feat(solar-layout): read-only 3D preview (react-three-fiber, loaded on demand)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Tab live, readiness wired, RBAC matrix

**Files:**
- Modify: `packages/shared/src/solar/entry.ts:30`
- Modify: `packages/shared/src/solar/readiness.test.ts:15-16`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx:53`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.test.tsx` (mock)
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/overview/page.tsx:22-35`
- Modify: `docs/rbac-matrix.md` (Solar section)

- [ ] **Step 1: Flip the tab and its test**

In `packages/shared/src/solar/entry.ts` line 30 change `built: false` to `built: true` for `slug: 'layout'`. In `packages/shared/src/solar/readiness.test.ts` change the test at lines 15-16 to:

```ts
  it('Overview, Site & Supply and Layout are built (Phase 5)', () => {
    expect(SOLAR_TABS.filter((t) => t.built).map((t) => t.slug)).toEqual(['overview', 'site', 'layout'])
```

Run: `pnpm --filter @esite/shared test` → PASS.

- [ ] **Step 2: Feed the Layout readiness step on every Solar page**

In `(gated)/layout.tsx`, add the import `import { loadLayoutReadiness } from '@/lib/solar/layout-readiness'`, add `loadLayoutReadiness(supabase, id)` as a fourth element of the existing `Promise.all` (destructure as `layoutReady`), and change line 53 to:

```tsx
  const readiness = computeSolarReadiness(toSiteReadinessInput(study), level, layoutReady)
```

In `(gated)/overview/page.tsx`, add the same import, add `loadLayoutReadiness(supabase, id)` as a fifth element of its `Promise.all` (destructure as `layoutReady`), and change the checklist line to:

```tsx
      <ReadinessChecklist projectId={id} steps={computeSolarReadiness(toSiteReadinessInput(study), level, layoutReady)} />
```

In `(gated)/layout.test.tsx`, add next to its other `vi.mock` calls:

```ts
vi.mock('@/lib/solar/layout-readiness', () => ({ loadLayoutReadiness: vi.fn(async () => null) }))
```

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar"` → PASS.

- [ ] **Step 3: RBAC matrix rows**

In `docs/rbac-matrix.md`, in the Solar route table (after the `/solar/site` row, line ~128) add:

```markdown
| `/projects/[id]/solar/layout` | W | W | W | R (list; opens read-only) | → locked | → locked | → locked |
| `/projects/[id]/solar/layout/[layoutId]` | W | W | W | R (canvas read-only; Select, Measure, 3D; no Save/Export) | → locked | → locked | → locked |
| `/projects/[id]/solar/layout/sources/[roofSourceId]` | W | W | W (north; **Calibrate** needs owner/admin/PM — `calibrateFloorPlanAction`, `ORG_WRITE_ROLES`) | R | → locked | → locked | → locked |
```

and replace the sentence "Tabs other than Overview and Site & Supply have **no route** in Phase 1" with "Tabs other than Overview, Site & Supply and Layout have **no route** yet".

In the "Solar server actions" table add:

```markdown
| `addDrawingRoofSourceAction` / `removeRoofSourceAction` / `setRoofNorthAction` (`solar-roof-sources.actions.ts`) | `requireSolarLevel(project, 'edit')`; north conditioned on `updated_at` | `roof_sources_*_authz` (RESTRICTIVE, `solar_can_edit`); `roof_sources_bind` stamps `file_path`/`source_revision_id`, binds the org, refuses another project's drawing; `layouts.roof_source_id` NO ACTION refuses removing a used source |
| `createLayoutAction` / `duplicateLayoutAction` / `renameLayoutAction` / `deleteLayoutAction` (`solar-layout.actions.ts`) | `requireSolarLevel(project, 'edit')`; name validated before save; rename conditioned on `updated_at` | `layouts_*_authz`; `layouts_bind` pins study + roof source |
| `saveLayoutObjectsAction` | `requireSolarLevel(project, 'edit')`; payload shape-checked (`validateObjectInput`); summary computed server-side | `public.solar_save_layout_objects` (SECURITY INVOKER): `solar_can_edit` + `FOR UPDATE` + `updated_at` compare (40001 = stale); `layout_objects_bind` stamps scale/anchor on insert and pins them on update; DB symbols must link to a board of the project |
| `exportLayoutSheetAction` (`solar-layout-export.actions.ts`) | `requireSolarLevel(project, 'edit')` | writes `projects.reports` with the service client; READ of `solar_layout_sheet` = `solar_can_view` (00212 `user_can_read_report_kind`; `report-kind-access.ts` `SOLAR_READ_REPORT_KINDS`) |
```

In the API table (next to `POST /api/paystack/solar-subscribe`) add:

```markdown
| `POST /api/projects/[id]/solar/roof-sources/satellite` | W | W | W | — | — | — | — |¹⁷
```

and the footnote:

```markdown
> **¹⁷ Satellite roof capture (decision D-08).** `503 {"error":"Satellite capture is not configured"}` when the server-only `MAPBOX_ACCESS_TOKEN` is unset — evaluated before the session. Then `401` unauthenticated; `403` below Solar Edit (`getSolarAccessLevel` + `solarLevelAllows`); `429` past `rateLimit('solar-satellite:<user id>', 5, 60_000)`; `409` without a site latitude/longitude; `502` when Mapbox does not answer with an image (the token is never logged). The image is uploaded by the service role to private `solar-roof-images` under `<org>/<project>/`; the roof source row is written through the CALLER's session so 00212 decides, and a refused row deletes its image. Reads of the bucket: `solar_can_view` on the path's project segment.
```

- [ ] **Step 4: Run the web suite**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/entry.ts packages/shared/src/solar/readiness.test.ts "apps/web/src/app/(admin)/projects/[id]/solar/(gated)" docs/rbac-matrix.md
git commit -m "feat(solar-layout): Layout tab live, readiness step wired, RBAC matrix rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Verify everything, push, draft PR

**Files:** none

- [ ] **Step 1: Three suites, type-check, lint, build**

```bash
pnpm --filter @esite/shared test
pnpm --filter @esite/db test
pnpm --filter web test
pnpm --filter @esite/shared type-check && pnpm --filter web type-check
pnpm --filter web lint
pnpm --filter web build
```

Expected: all green. Record the counts against the Task 0 baseline for the PR body.

- [ ] **Step 2: Re-run the SQL dry run on today's schema**

```bash
S=$(mktemp -d)
cat apps/edge-functions/supabase/migrations/00208_solar_foundation.sql \
    apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql \
    apps/edge-functions/supabase/migrations/00212_solar_layouts.sql > "$S/combo.sql"
scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-solar-layouts-roles.sql scripts/db/assert-solar-foundation-roles.sql scripts/db/assert-solar-org-settings-roles.sql
```

Expected: `0 failed` in every file.

- [ ] **Step 3: Push**

```bash
git push git@github.com:WattMatt/e-site.git feat/solar-phase-5
```

- [ ] **Step 4: Open the DRAFT PR against `feat/solar-phase-1c`**

```bash
gh pr create --draft --base feat/solar-phase-1c --head feat/solar-phase-5 \
  --title "Solar Phase 5 — Layout tab (PV design on project drawings)" \
  --body-file - <<'EOF'
## What
Functional spec §6 (Layout tab) and §3.2 C (roof sources); engine spec §3.1–3.3; data model §3.

- `@esite/shared` `solar/layout/*`: auto-fill packing (setbacks, polygon + circle obstructions with their own setbacks, 0/90° × 8 offsets, tie → fewer partial rows), D-11 row pitch from the 21 June sun at the site latitude (09:00–15:00 solar time, org-configurable), foreshortening along the fall line only (WM's across-the-slope bug pinned), azimuth from the north reference, §3.3 string checks + serpentine auto-string onto MPPTs, summary, BOM CSV, satellite tile maths, 3D scene. Three hand-checked roofs: flat racked 48, pitched flush 27 (WM would give 22), irregular L with plant room + skylight 25.
- Migration `00212_solar_layouts.sql`: `solar.roof_sources`, `solar.layouts`, `solar.layout_objects`, `public.solar_save_layout_objects` (atomic, stale-refusing, SECURITY INVOKER), private `solar-roof-images`, and `solar_layout_sheet` reads on `solar_can_view`. Per-verb PERMISSIVE `solar_can_view` + RESTRICTIVE `solar_can_edit`, FORCE RLS, bind triggers pin org/project/anchor/scale; drawings cannot be hard-deleted under a layout (NO ACTION). Dry-run 48/48 against 00208+00209+00212; six mutations recorded below.
- `cloud-sync-project` `isAnnotated()` now queries `solar.roof_sources` and `solar.layout_objects` (the schema-derived contract test named both on its own).
- Web: Site & Supply section C (drawing picker, Open sheet → calibrate via `calibrateFloorPlanAction` + north, Mapbox capture with a 503 path), layout list, Konva `SolarCanvas` on `lib/sheet` (every §6.3 tool; F = Auto-fill, so the shared viewport's fit keys became configurable), properties, summary + BOM CSV, undo/redo, IndexedDB drafts, versioned layout sheet PDF, optional 3D preview.

## Mutation ledger
<paste Task 11 Step 3 table with the red check names observed>

## Test counts
web <n> (was <n>) · shared <n> (was <n>) · db <n> (was <n>); tsc 0; lint clean; `next build` exit 0.

## OWNER steps (in this order)
1. Claim the migration number at apply time (ledger `max(version)`, `origin/main`, open-PR filenames). `00208`/`00209` first. Renumber `00212` if taken.
2. Apply `00212`; run `scripts/verify-migration-applied.ts` — every block ≥ 00185 green.
3. Pre-deploy check: service-role PostgREST `GET /rest/v1/roof_sources` and `/layout_objects` with `Accept-Profile: solar` → both `200`. A 406 means schema `solar` is not exposed; deploying then makes EVERY drawing read as annotated (fail-closed) and stops Dropbox auto-adopt platform-wide.
4. `cd apps/edge-functions && ./deploy.sh cloud-sync-project`; read back `version` (+1) and `verify_jwt` (unchanged) from the Management API; confirm `roof_sources` and `layout_objects` appear in the deployed `/functions/cloud-sync-project/body`.
5. Watch the next `cloud-sync-poll` tick: adopt counts unchanged for projects with no Solar layouts.
6. Set `MAPBOX_ACCESS_TOKEN` (server-only) in Vercel production + preview; confirm the Site & Supply button enables.
7. **Signed-in desktop walk (from the empty state, not a deep link):** Solar → Site & Supply → Add roof drawing → Open sheet → Calibrate (as owner/admin/PM) → Set north → Layout → New layout → draw a roof (R, double-click to close) → obstruction (O, polygon and circle) → F auto-fill → Place → I inverter → Auto-string → move (drag, one undo step) and rotate (transformer) → ⌘Z/⇧⌘Z → ⌘S → reload (same pixels) → Download BOM CSV → Export layout sheet → open v1 from Exported sheets → 3D preview (Reset, Screenshot). Then as a View user: list opens, canvas read-only, sheet downloads; as a project member without a grant: redirected to /solar/locked and the sheet is not listed.
8. **Tablet/touch walk:** pinch-zoom, two-finger pan, tap-to-place vertices (a pinch must not leave a stray vertex), drag-move, transformer rotate.

## Known gaps
- `SolarCanvas` and `Layout3DPreview` have no component tests (Konva/WebGL — same gap as `RouteCanvas`); their rules are unit-tested in `doc.ts`, planners and history.
- "Push to case" is a disabled button until cases exist; "Trace AC cable" links to the cable schedule (a supply is created in §7.6).
- `packages/db/src/types.ts` not regenerated (actions cast `.schema('solar')`).
- `string-sizing.ts` is a byte-identical copy of Phase 4a's file; the merge is an identical add.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Expected: a draft PR URL. Fill the two `<…>` placeholders in the body with the observed numbers via `gh pr edit --body-file` before requesting review.

---

## Self-review (recorded for the reviewer)

- **Spec coverage.** §6.1 layout (Task 11 grid), §6.2 list/new (name validated before save)/duplicate/rename/delete two-step + case refusal via FK (Tasks 8, 12), §6.3 every row: Select/move/multi/box + transformer rotate, one undo per drag (Tasks 10, 11); pan/zoom/fit/touch (lib/sheet, Task 3); Set north two points or typed (Tasks 11, 12); Roof R with every property (Task 11 Properties); Obstruction O polygon/circle + setback + height; Auto-fill F with orientation, flat/racked, tilt, auto/manual spacing, gap, preview → Place (Tasks 9, 11); Place array A with snap (Task 9); Delete on every type incl. strings re-indexed (Task 1); Inverter I with every spec field; Assign strings S click-in-order + Auto-string with Voc/Vmp pass/fail (Tasks 1-5 of 5-i, 11); Battery/DB/combiner B with DB → `structure.nodes` enforced in SQL; Trace AC cable (link — Open question 5); Measure M (not saved); Undo/Redo; Save ⌘S with expectedUpdatedAt + drafts + leave prompt; 3D preview (Task 14); Export sheet (Task 13). §6.4 properties + summary + BOM + Push to case (disabled with reason). §6.5 anchors/warning/isAnnotated/scale snapshot (5-i + Task 11 banner). §3.2 C roof sources rows (Tasks 5–7, 12). RBAC matrix (Task 15). Final three suites + draft PR (Task 16).
- **Placeholders.** None in code steps. The PR body's two `<…>` count fields are filled from the run, as instructed in Task 16 Step 4.
- **Type consistency.** `LayoutEditorData`, `RoofSourceRow`, `Selection`, `LayoutTool`, `ExportJpeg` (via `onExporter`), `onTransform(ids, deg, dx, dy)`, `saveLayoutObjectsAction(…)→{updatedAt,pixelsPerMeter}`, `exportLayoutSheetAction(…)→{version,reportId}`, `planAutoFill`/`planModuleBlock` shapes are used identically across Tasks 4–13.

## Open questions (each has the default this plan builds)

1. **`solar_layout_sheet` read gate** — the brief suggested `REPORT_KIND_READ_ROLES` / `report_kind_is_sensitive`. Those gate on E-Site roles, which would let a PM with no Solar grant read the sheet and refuse a contractor holding a View grant. **Default built:** a third explicit set, `SOLAR_READ_REPORT_KINDS` (read = `solar_can_view`), mirrored in 00212's `user_can_read_report_kind` and pinned against the FINAL SQL definition by the contract test.
2. **Where north lives** — the data model lists both `roof_sources.north_bearing_deg` and a `north` object kind. **Default:** north is a property of the SHEET (roof source), shared by every layout on it; `north` stays in the kind CHECK as reserved and `validateObjectInput` refuses it.
3. **Calibration by Solar Edit contractors** — `calibrateFloorPlanAction` is `ORG_WRITE_ROLES` because cable routes share the scale. **Default:** unchanged; contractors see its refusal sentence and ask an owner/admin/PM.
4. **Equipment catalogue** — not built until the Financials phase. **Default:** generic 550 W module / 50 kW inverter presets, edited per layout and snapshotted in `layouts.module_spec` / inverter props; `layouts.module_id` is a nullable UUID whose FK the catalogue migration adds.
5. **Trace AC cable** — creating a `cable_schedule` supply belongs to §7.6. **Default:** the button links to the project's cable schedule with a tooltip; no supply is created from the layout.
6. **Design temperatures for string checks** — the weather year arrives with the engine. **Default:** per-layout columns `design_t_min_c` (−5 °C inland) and `design_t_amb_max_c` (35 °C), not yet editable in the UI; the yield phase replaces them with TMY extremes.
7. **D-11 hours as solar time** — the rule is read as local SOLAR time (hour angle), which is what "at the site latitude" implies. **Default:** solar time; clock time would add a longitude/SAST dependency.
8. **"0/90° grid" for racked rows** — rotating racked rows 90° would change their azimuth. **Default:** 0/90° is tried for flat-mounted modules only; racked rows and flush-on-pitch keep the facing fixed and vary the 8 offsets.
9. **Roof source created before anything is drawn blocks Dropbox auto-adopt** (fail-closed `isAnnotated`). **Default:** accepted — a sheet chosen as a roof plan is pinned like a calibrated one.
10. **"Delete refused if a case uses the layout"** — cases do not exist yet. **Default:** enforced later by the cases migration's `layout_id` FK with NO ACTION; the error sentence is already mapped.
11. **3D preview dependencies** (`three`, `@react-three/fiber` 9) — **Default:** added in the separable Task 14, loaded on demand; skip the task if the owner declines new dependencies.
12. **Product events** — new `solar_layout_*` verbs would need `product_events_event_check` re-declared in full (00209 did), colliding with sibling migrations. **Default:** `solar.audit_events` only in this phase.
