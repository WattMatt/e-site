# Solar Phase 5-i — Layout geometry, schema and drawing protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build everything under the Solar Layout tab that is not a canvas: the pure PV-layout geometry in `@esite/shared` (auto-fill packing with setbacks and obstructions, the D-11 row-pitch rule, fall-line-only foreshortening, azimuth, string checks and auto-stringing, summary, BOM, satellite tile maths), migration `00211_solar_layouts.sql` (roof sources, layouts, layout objects, an atomic stale-refusing save, the `solar-roof-images` bucket, the Solar read gate on `solar_layout_sheet` reports), the `isAnnotated()` registration in `cloud-sync-project`, and the application half of the report read gate.

**Architecture:** Geometry lives in `packages/shared/src/solar/layout/` as small pure modules working in plan metres (x right, y down, the sheet's image space divided by pixels-per-metre); every stored coordinate is image pixels and every object carries the scale the DATABASE stamped when it was first saved. The migration follows 00207's shape exactly: per-verb PERMISSIVE policies on `solar_can_view` plus per-verb RESTRICTIVE policies on `solar_can_edit`, FORCE RLS, bind triggers that pin org/project/anchor/created fields, and no BEGIN/COMMIT. Plan 5-ii (`2026-09-28-solar-phase-5-layout-ii-canvas-ui.md`) builds the actions, pages, Konva canvas, export and 3D preview on top of this.

**Tech Stack:** TypeScript (strict), Vitest, PostgreSQL 15 / Supabase (RLS, PL/pgSQL), Deno edge function (`cloud-sync-project`), pnpm + Turborepo.

---

## Read this first (context an engineer new to this repo will not have)

- **Worktree and branch.** Work in a NEW worktree `~/.config/superpowers/worktrees/esite/solar-phase-5` on branch `feat/solar-phase-5`, created from `origin/feat/solar-phase-1c` (Task 0). Never touch the canonical `esite/` checkout; other sessions own it. Run every command from the worktree root unless a step says otherwise.
- **What Phase 1 gives you** (on `feat/solar-phase-1c`): migration `00207_solar_foundation.sql` (schema `solar`, `solar.studies`, the helpers `public.solar_can_view/_edit/_see_money(project_id)`, `public.solar_access_level`), `00208_solar_org_settings.sql` (`solar.org_settings`), the gated layout `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx`, `apps/web/src/lib/solar/access.ts` (`requireSolarLevel`, `getSolarAccessLevel`), and `@esite/shared` `solar/*` (access levels, tabs, readiness, org settings).
- **00207 and 00208 are NOT in the production ledger yet.** Every dry run in this plan concatenates `00207 + 00208 + 00211` (Task 11 shows how). If the owner has applied them by the time you run it, dry-run `00211` alone.
- **Migration number `00211`.** `00209` (tariffs, plan 2a-i) and `00210` (meter data, plan 3a-ii) are claimed by sibling plans. Numbers are claimed **at apply time**, not now: before the owner applies, re-check THREE places — the ledger `max(version)`, `origin/main`'s migration filenames, and the migration filenames in every open PR. If `00211` is taken, rename the file and every reference (the assertion file header, the contract test in Task 14, this plan's commands). *Claiming a number is not holding it: the head moves when someone APPLIES.*
- **00207's schema-wide `@verify` directives are re-checked on EVERY deploy** (`00207_solar_foundation.sql:99-115`). This migration must conform: FORCE RLS on every new table in `solar`; no RESTRICTIVE policy covering SELECT or ALL anywhere in `solar`; every SECURITY DEFINER function in `solar` revokes EXECUTE from PUBLIC and anon.
- **A RESTRICTIVE `FOR ALL` policy narrows reads too** (the 00205/00206 lesson). Every write gate here is one policy per verb (`INSERT`, `UPDATE`, `DELETE`), never `FOR ALL`.
- **`isAnnotated()` fails CLOSED.** It is the only thing that stops Dropbox auto-adopt swapping a drawing file under pixel-anchored geometry (`apps/edge-functions/supabase/functions/cloud-sync-project/index.ts:785-873`). If the new lookups error — `00211` not applied, or schema `solar` not exposed to PostgREST — EVERY drawing reads as annotated and auto-adopt silently stops platform-wide. The deploy order is therefore fixed: migration → verify → edge function (Task 15, owner steps).
- **Edge functions do not deploy on merge.** `cloud-sync-project` is deployed by hand from `apps/edge-functions/deploy.sh` and read back from the Management API. That is an OWNER step here, not something this plan's executor does.
- **Three suites on any migration work:** `web`, `@esite/shared` AND `@esite/db`. `packages/db` holds the repo-wide migration guards (`packages/db/src/__tests__/security/*`) and reads migration TEXT.
- **Phase 4a (engine) is not pushed.** `origin/feat/solar-phase-4a` does not exist today. This plan needs its §3.3 string-sizing functions, so Task 6 places a BYTE-IDENTICAL copy of `packages/shared/src/services/solar/pv/string-sizing.ts` (4a commit `c8665929`) at the same path, so the later merge is a clean identical add. If `origin/feat/solar-phase-4a` exists when you execute, check the file out from it instead (Task 6 Step 1 says how).
- **What is decided and must not be re-asked:** D-08 keep Mapbox (server-side static image for satellite capture), D-11 no inter-row shade 09:00–15:00 on 21 June at the site latitude, azimuth 0 = N clockwise (engine spec §3.2), foreshortening along the fall line only (engine spec §3.1: WM applied it across the slope — that is the bug we pin).

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/solar/layout/types.ts` | Layout object shapes (image-pixel geometry + props), module/inverter spec shapes, generic presets, design-temperature defaults |
| `packages/shared/src/solar/layout/geometry.ts` | Plane geometry in plan metres: px↔m, area, point-in-polygon, segment distances, quad containment/clearance, rotation, simple-polygon test |
| `packages/shared/src/solar/layout/orientation.ts` | Sheet bearings ↔ image vectors, true azimuth from a north reference, equator-facing default |
| `packages/shared/src/solar/layout/row-pitch.ts` | D-11: solstice solar elevation at the site latitude, auto/manual row pitch |
| `packages/shared/src/solar/layout/footprint.ts` | A module's on-plan footprint and steps for flush (fall-line foreshortening only) and racked mounting |
| `packages/shared/src/solar/layout/packing.ts` | Auto-fill: grid over 0/90° × 8 offsets, setbacks, obstructions, tie-break rule |
| `packages/shared/src/services/solar/pv/string-sizing.ts` | Engine spec §3.3 checks — byte-identical copy of Phase 4a's file |
| `packages/shared/src/solar/layout/strings.ts` | Per-string checks from layout specs, recommended length, serpentine ordering, auto-string onto MPPTs |
| `packages/shared/src/solar/layout/summary.ts` | kWp / AC kW / DC:AC / counts / string pass-fail / utilisation / arrays outside roofs; BOM rows + CSV; stored-summary shape |
| `packages/shared/src/solar/layout/readiness.ts` | Layout step status for the Overview checklist and tab dot |
| `packages/shared/src/solar/layout/satellite.ts` | Mapbox static-image URL and metres-per-pixel tile maths |
| `packages/shared/src/solar/layout/validate.ts` | Refuses malformed object payloads with a sentence before they reach SQL |
| `packages/shared/src/solar/layout/index.ts` | Barrel |
| `packages/shared/src/solar/index.ts` | Add `export * from './layout'` |
| `packages/shared/src/solar/readiness.ts` | `computeSolarReadiness` takes an optional layout input |
| `apps/edge-functions/supabase/migrations/00211_solar_layouts.sql` | The migration |
| `scripts/db/assert-solar-layouts-roles.sql` | Behavioural assertions as real roles (red → green) |
| `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` | `isAnnotated()` queries `solar.roof_sources` and `solar.layout_objects` |
| `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts` | Discovery must find the two Solar tables |
| `apps/web/src/lib/reports/report-kind-access.ts` | `SOLAR_READ_REPORT_KINDS` — a third, explicit read-policy set |
| `apps/web/src/lib/reports/report-kind-access.contract.test.ts` | Solar kinds mirrored in the FINAL `user_can_read_report_kind()` |
| `apps/web/src/actions/project-reports.actions.ts` | List/URL actions check the Solar level for Solar kinds |
| `apps/web/src/actions/project-reports.solar-gate.test.ts` | Tests for the above |

---

### Task 0: Worktree, branch, baseline

**Files:** none (environment only)

- [ ] **Step 1: Create the worktree from Phase 1C**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-1c
git fetch origin
git worktree add ~/.config/superpowers/worktrees/esite/solar-phase-5 -b feat/solar-phase-5 origin/feat/solar-phase-1c
cd ~/.config/superpowers/worktrees/esite/solar-phase-5
pnpm install --frozen-lockfile
```

Expected: `Preparing worktree (new branch 'feat/solar-phase-5')`, install completes.

- [ ] **Step 2: Baseline — all three suites and type-check green before any change**

```bash
pnpm --filter @esite/shared test
pnpm --filter @esite/db test
pnpm --filter web test
pnpm --filter @esite/shared type-check && pnpm --filter web type-check
```

Expected: every suite passes (record the web/shared/db counts; the final task compares against them). If anything is red on the base branch, STOP and report — do not build on a red base.

---

### Task 1: Layout types and plane geometry

**Files:**
- Create: `packages/shared/src/solar/layout/types.ts`
- Create: `packages/shared/src/solar/layout/geometry.ts`
- Test: `packages/shared/src/solar/layout/geometry.test.ts`

- [ ] **Step 1: Write the types (no behaviour, so no test of their own)**

`packages/shared/src/solar/layout/types.ts`:

```ts
/**
 * Solar Layout — shared shapes (functional spec §6, data model §3).
 *
 * Stored geometry is IMAGE PIXELS of the sheet: the fixed scale-2 raster that
 * apps/web/src/lib/sheet/use-sheet-image.ts defines (a PDF page at
 * getViewport({ scale: 2 }), a raster at its natural size). Metres come from
 * each object's own `pixelsPerMeter`, which the DATABASE stamps when the object
 * is first saved (00211 layout_objects_bind) — never from the browser.
 *
 * Plan metres (what the geometry modules compute in) are image pixels divided
 * by that scale: x to the right, y DOWN the sheet.
 */
export interface Pt {
  x: number
  y: number
}

/** Mirrors the CHECK on solar.layout_objects.kind (00211). 'north' is reserved: the north reference lives on the roof source. */
export const LAYOUT_OBJECT_KINDS = [
  'roof', 'obstruction', 'array', 'module_block', 'inverter', 'string', 'equipment', 'north',
] as const
export type LayoutObjectKind = (typeof LAYOUT_OBJECT_KINDS)[number]

export const ROOF_TYPES = ['flat', 'pitched', 'carport', 'ground'] as const
export type RoofType = (typeof ROOF_TYPES)[number]

export type ModuleOrientation = 'portrait' | 'landscape'
export type MountingKind = 'flush' | 'racked'

export const EQUIPMENT_KINDS = ['battery', 'db', 'combiner'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

/** A PV module as the layout needs it: size, power and the §3.3 string-sizing figures. */
export interface LayoutModuleSpec {
  make: string
  model: string
  /** Long side, metres. */
  lengthM: number
  /** Short side, metres. */
  widthM: number
  /** STC rating, watts. */
  powerW: number
  vocStc: number
  vmpStc: number
  iscStc: number
  /** Voc temperature coefficient, fraction per °C (negative). */
  betaVocPerC: number
  /** Vmp temperature coefficient, fraction per °C (negative). */
  gammaVmpPerC: number
}

/** An inverter as the layout needs it (functional spec §6.3 "Inverter"). Every MPPT has the same limits. */
export interface LayoutInverterSpec {
  make: string
  model: string
  acKw: number
  mppts: number
  vDcMax: number
  vMpptMin: number
  vMpptMax: number
  /** Maximum input current per MPPT, amps. */
  iMpptMax: number
}

export interface RoofProps {
  name: string
  roofType: RoofType
  /** Degrees from horizontal; 0 for flat, carport and ground unless stated. */
  pitchDeg: number
  /** Sheet bearing (° clockwise from sheet-up) of the DOWNHILL direction; null until drawn. */
  fallBearingDeg: number | null
  heightM: number
  setbackM: number
  /** Note only (functional spec §6.3). */
  maxLoadKgM2: number | null
}

export interface ObstructionProps {
  name: string
  setbackM: number
  heightM: number
}

export interface ArrayProps {
  /** The roof object this array was placed on. */
  roofId: string
  module: LayoutModuleSpec
  orientation: ModuleOrientation
  mounting: MountingKind
  /** Module tilt from horizontal. Flush = the roof pitch; racked = the rack tilt. */
  tiltDeg: number
  /** Sheet bearing the modules FACE (flush: the roof's fall line; racked: the row normal). */
  facingSheetDeg: number
  /** A true azimuth the user typed over the derived one (functional spec §6.4). */
  azimuthOverrideDeg: number | null
  /** Centre-to-centre spacing of rows along the facing direction, metres on plan. */
  rowPitchM: number
  /** Gap between modules, metres (default 0.02). */
  gapM: number
}

export interface InverterProps {
  name: string
  inverter: LayoutInverterSpec
}

/** A module inside an array or module block, by position in that object's `modules` list. */
export interface ModuleRef {
  arrayId: string
  index: number
}

export interface StringProps {
  inverterId: string
  /** 1-based MPPT input on that inverter. */
  mppt: number
  /** In series order. */
  modules: ModuleRef[]
}

export interface EquipmentProps {
  equipmentKind: EquipmentKind
  name: string
  /** structure.nodes id — REQUIRED for a DB symbol (00211 refuses a free-floating DB). */
  nodeId: string | null
}

export interface PolygonGeometry { points: number[] }
export interface CircleGeometry { cx: number; cy: number; r: number }
/** Each module is one quad: [x1,y1,x2,y2,x3,y3,x4,y4] in image pixels. */
export interface ModulesGeometry { modules: number[][] }
export interface PointGeometry { x: number; y: number }

interface ObjectBase {
  id: string
  /** The scale stamped by the database on first save; null only before the first save. */
  pixelsPerMeter: number | null
}
export type RoofObject = ObjectBase & { kind: 'roof'; geometry: PolygonGeometry; props: RoofProps }
export type ObstructionObject = ObjectBase & { kind: 'obstruction'; geometry: PolygonGeometry | CircleGeometry; props: ObstructionProps }
export type ArrayObject = ObjectBase & { kind: 'array' | 'module_block'; geometry: ModulesGeometry; props: ArrayProps }
export type InverterObject = ObjectBase & { kind: 'inverter'; geometry: PointGeometry; props: InverterProps }
export type StringObject = ObjectBase & { kind: 'string'; geometry: Record<string, never>; props: StringProps }
export type EquipmentObject = ObjectBase & { kind: 'equipment'; geometry: PointGeometry; props: EquipmentProps }

export type LayoutObject = RoofObject | ObstructionObject | ArrayObject | InverterObject | StringObject | EquipmentObject

export function isCircleGeometry(g: PolygonGeometry | CircleGeometry): g is CircleGeometry {
  return typeof (g as CircleGeometry).r === 'number'
}

export function isArrayObject(o: LayoutObject): o is ArrayObject {
  return o.kind === 'array' || o.kind === 'module_block'
}

/**
 * A generic 550 W mono module so a layout can start before the equipment
 * catalogue exists (it arrives with the Financials phase). The user edits these
 * figures to the datasheet in the New layout dialog; they are snapshotted on the
 * layout, so a later catalogue never changes a saved design.
 */
export const GENERIC_MODULE_550: LayoutModuleSpec = {
  make: 'Generic',
  model: '550 W mono (edit to the datasheet)',
  lengthM: 2.278,
  widthM: 1.134,
  powerW: 550,
  vocStc: 49.9,
  vmpStc: 41.96,
  iscStc: 13.95,
  betaVocPerC: -0.0027,
  gammaVmpPerC: -0.0035,
}

export const GENERIC_INVERTER_50KW: LayoutInverterSpec = {
  make: 'Generic',
  model: '50 kW three-phase (edit to the datasheet)',
  acKw: 50,
  mppts: 4,
  vDcMax: 1100,
  vMpptMin: 200,
  vMpptMax: 1000,
  iMpptMax: 40,
}

/**
 * Design temperatures for string checks until the weather year exists
 * (engine spec §3.3: T_min default −5 °C inland; max ambient 35 °C). Stored per
 * layout (solar.layouts.design_t_min_c / design_t_amb_max_c) and editable.
 */
export const LAYOUT_DEFAULT_DESIGN_TEMPS = { tMinC: -5, tAmbMaxC: 35 } as const

/** Default gap between modules, metres (engine spec §3.1: 20 mm). */
export const DEFAULT_MODULE_GAP_M = 0.02
```

- [ ] **Step 2: Write the failing geometry tests**

`packages/shared/src/solar/layout/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  flatToPts, ptsToFlat, pxToM, mToPx, distance, polygonArea, vertexMean, pointInPolygon,
  pointSegmentDistance, segmentsCross, segmentDistance, onBoundary, quadInsideRoof,
  quadClearOfPolygon, quadClearOfCircle, rotateAbout, isSimplePolygon, rectQuad,
} from './geometry'
import type { Pt } from './types'

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
]
const L_ROOF: Pt[] = [
  { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 12 }, { x: 0, y: 12 },
]

describe('point lists', () => {
  it('round-trips flat ↔ points and refuses an odd count', () => {
    expect(flatToPts([1, 2, 3, 4])).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }])
    expect(ptsToFlat([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([1, 2, 3, 4])
    expect(() => flatToPts([1, 2, 3])).toThrow('even number')
  })
  it('converts pixels to metres and back with the object’s own scale', () => {
    expect(pxToM([100, 50], 50)).toEqual([{ x: 2, y: 1 }])
    expect(mToPx([{ x: 2, y: 1 }], 50)).toEqual([100, 50])
    expect(() => pxToM([1, 1], 0)).toThrow('positive')
  })
})

describe('measures', () => {
  it('distance and shoelace area (orientation-independent)', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(polygonArea(rect(0, 0, 20, 12))).toBe(240)
    expect(polygonArea([...rect(0, 0, 20, 12)].reverse())).toBe(240)
    expect(polygonArea(L_ROOF)).toBe(144)
  })
  it('vertexMean is the average vertex', () => {
    expect(vertexMean(rect(0, 0, 2, 4))).toEqual({ x: 1, y: 2 })
  })
})

describe('pointInPolygon', () => {
  it('handles a concave (L-shaped) roof', () => {
    expect(pointInPolygon({ x: 4, y: 9 }, L_ROOF)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 3 }, L_ROOF)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 9 }, L_ROOF)).toBe(false)
  })
})

describe('segments', () => {
  it('point to segment distance clamps to the ends', () => {
    expect(pointSegmentDistance({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(1)
    expect(pointSegmentDistance({ x: 3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(2)
  })
  it('only a PROPER crossing counts as crossing (touching and collinear do not)', () => {
    expect(segmentsCross({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 })).toBe(true)
    expect(segmentsCross({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(false)
    expect(segmentsCross({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).toBe(false)
  })
  it('segment distance is 0 when crossing, else the nearest endpoint projection', () => {
    expect(segmentDistance({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 })).toBe(0)
    expect(segmentDistance({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(1)
  })
  it('onBoundary detects a point on an edge', () => {
    expect(onBoundary({ x: 5, y: 0 }, rect(0, 0, 10, 10))).toBe(true)
    expect(onBoundary({ x: 5, y: 5 }, rect(0, 0, 10, 10))).toBe(false)
  })
})

describe('quad against roof and obstructions', () => {
  const roof = rect(0, 0, 20, 12)
  it('inside with clearance', () => {
    expect(quadInsideRoof(rect(1, 1, 3, 3), roof, 0.5)).toBe(true)
    expect(quadInsideRoof(rect(1, 1, 3, 3), roof, 1.5)).toBe(false) // only 1 m from the edge
    expect(quadInsideRoof(rect(0.5, 0.5, 2, 2), roof, 0.5)).toBe(true) // exactly the setback
  })
  it('refuses the notch of an L roof and a quad straddling the inner corner', () => {
    expect(quadInsideRoof(rect(10, 8, 12, 10), L_ROOF, 0.5)).toBe(false)
    expect(quadInsideRoof(rect(7, 5, 9, 7), L_ROOF, 0)).toBe(false)
  })
  it('keeps the obstruction setback, and refuses a quad that swallows the obstruction', () => {
    const plant = rect(3, 2, 5, 4)
    expect(quadClearOfPolygon(rect(5.5, 2, 7, 4), plant, 0.6)).toBe(false) // 0.5 m away
    expect(quadClearOfPolygon(rect(5.7, 2, 7, 4), plant, 0.6)).toBe(true)
    expect(quadClearOfPolygon(rect(2, 1, 6, 5), plant, 0.6)).toBe(false)
  })
  it('keeps the radius plus setback clear of a circular obstruction', () => {
    const c = { x: 4, y: 9 }
    expect(quadClearOfCircle(rect(4.7, 8, 6, 10), c, 0.5, 0.3)).toBe(false) // 0.7 < 0.8
    expect(quadClearOfCircle(rect(4.8, 8, 6, 10), c, 0.5, 0.3)).toBe(true)
    expect(quadClearOfCircle(rect(3, 8, 5, 10), c, 0.5, 0.3)).toBe(false) // centre inside
  })
})

describe('rotation and simplicity', () => {
  it('rotates clockwise ON SCREEN (image y points down)', () => {
    const p = rotateAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0, 12)
    expect(p.y).toBeCloseTo(1, 12)
  })
  it('refuses a bow-tie and accepts the L roof', () => {
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toBe(false)
    expect(isSimplePolygon(L_ROOF)).toBe(true)
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false)
  })
  it('rectQuad builds a quad from a corner and two axis vectors', () => {
    expect(rectQuad({ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 2, 3)).toEqual(rect(1, 1, 3, 4))
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./geometry"`.

- [ ] **Step 4: Implement `geometry.ts`**

`packages/shared/src/solar/layout/geometry.ts`:

```ts
/**
 * Plane geometry for the Solar layout (engine spec §3.1). Pure; no I/O.
 *
 * Coordinates are metres on PLAN: x to the right, y DOWN (the sheet's image
 * space divided by its pixels-per-metre). Only pxToM / mToPx know about pixels.
 *
 * Containment is judged by PROPER crossings plus explicit vertex tests, so a
 * module that exactly touches a setback line is allowed and one that crosses
 * an edge anywhere is not. EPS absorbs floating-point noise at the boundary.
 */
import type { Pt } from './types'

export const EPS = 1e-9

export function flatToPts(flat: readonly number[]): Pt[] {
  if (flat.length % 2 !== 0) throw new Error('A point list needs an even number of values')
  const out: Pt[] = []
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! })
  return out
}

export function ptsToFlat(pts: readonly Pt[]): number[] {
  return pts.flatMap((p) => [p.x, p.y])
}

export function pxToM(flat: readonly number[], pixelsPerMeter: number): Pt[] {
  if (!(pixelsPerMeter > 0)) throw new Error('pixels per metre must be positive')
  return flatToPts(flat).map((p) => ({ x: p.x / pixelsPerMeter, y: p.y / pixelsPerMeter }))
}

export function mToPx(pts: readonly Pt[], pixelsPerMeter: number): number[] {
  if (!(pixelsPerMeter > 0)) throw new Error('pixels per metre must be positive')
  return pts.flatMap((p) => [p.x * pixelsPerMeter, p.y * pixelsPerMeter])
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Absolute shoelace area. */
export function polygonArea(poly: readonly Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

export function vertexMean(poly: readonly Pt[]): Pt {
  const n = poly.length
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n }
}

/** Even-odd ray cast. A point exactly on an edge may report either way — use onBoundary where it matters. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  let t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy)
}

function orient(a: Pt, b: Pt, c: Pt): -1 | 0 | 1 {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (Math.abs(v) < EPS) return 0
  return v > 0 ? 1 : -1
}

/** True only for a PROPER crossing: interiors intersect at one point. Touching or collinear overlap is not a crossing. */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0
}

export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b),
  )
}

function edges(poly: readonly Pt[]): Array<[Pt, Pt]> {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as [Pt, Pt])
}

export function onBoundary(p: Pt, poly: readonly Pt[]): boolean {
  return edges(poly).some(([a, b]) => pointSegmentDistance(p, a, b) < EPS)
}

function boundaryDistance(a: readonly Pt[], b: readonly Pt[]): number {
  let m = Infinity
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) m = Math.min(m, segmentDistance(p, q, r, s))
  return m
}

function anyCrossing(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) if (segmentsCross(p, q, r, s)) return true
  return false
}

const strictlyInside = (p: Pt, poly: readonly Pt[]) => pointInPolygon(p, poly) && !onBoundary(p, poly)

/**
 * A module quad lies inside the roof with at least `clearance` metres to every
 * roof edge: all corners inside (or on) the roof, no roof vertex poking into
 * the quad, no edge crossing, and the boundary gap ≥ clearance.
 */
export function quadInsideRoof(quad: readonly Pt[], roof: readonly Pt[], clearance: number): boolean {
  if (!quad.every((p) => pointInPolygon(p, roof) || onBoundary(p, roof))) return false
  if (roof.some((v) => strictlyInside(v, quad))) return false
  if (anyCrossing(quad, roof)) return false
  return boundaryDistance(quad, roof) >= clearance - EPS
}

/** The quad keeps `clearance` metres from a polygonal obstruction and does not overlap or contain it. */
export function quadClearOfPolygon(quad: readonly Pt[], obstruction: readonly Pt[], clearance: number): boolean {
  if (obstruction.some((v) => strictlyInside(v, quad))) return false
  if (quad.some((p) => pointInPolygon(p, obstruction) || onBoundary(p, obstruction))) return false
  if (anyCrossing(quad, obstruction)) return false
  return boundaryDistance(quad, obstruction) >= clearance - EPS
}

/** The quad keeps radius + clearance from a circular obstruction's centre. */
export function quadClearOfCircle(quad: readonly Pt[], centre: Pt, radius: number, clearance: number): boolean {
  if (pointInPolygon(centre, quad)) return false
  let m = Infinity
  for (const [a, b] of edges(quad)) m = Math.min(m, pointSegmentDistance(centre, a, b))
  return m >= radius + clearance - EPS
}

/** Rotate `p` about `about` by `deg` — clockwise on screen, because image y points down. */
export function rotateAbout(p: Pt, about: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180
  const dx = p.x - about.x
  const dy = p.y - about.y
  return { x: about.x + dx * Math.cos(r) - dy * Math.sin(r), y: about.y + dx * Math.sin(r) + dy * Math.cos(r) }
}

/** At least three vertices and no two non-adjacent edges crossing. */
export function isSimplePolygon(poly: readonly Pt[]): boolean {
  if (poly.length < 3) return false
  const e = edges(poly)
  for (let i = 0; i < e.length; i++) {
    for (let j = i + 1; j < e.length; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === e.length - 1)
      if (adjacent) continue
      if (segmentsCross(e[i]![0], e[i]![1], e[j]![0], e[j]![1])) return false
    }
  }
  return polygonArea(poly) > EPS
}

/** Quad from a corner and two unit axis vectors: corner, +w·u, +w·u + h·v, +h·v. */
export function rectQuad(corner: Pt, u: Pt, v: Pt, w: number, h: number): Pt[] {
  return [
    corner,
    { x: corner.x + u.x * w, y: corner.y + u.y * w },
    { x: corner.x + u.x * w + v.x * h, y: corner.y + u.y * w + v.y * h },
    { x: corner.x + v.x * h, y: corner.y + v.y * h },
  ]
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/geometry.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/solar/layout/types.ts packages/shared/src/solar/layout/geometry.ts packages/shared/src/solar/layout/geometry.test.ts
git commit -m "feat(solar-layout): layout object shapes and plane geometry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Orientation and azimuth (engine spec §3.2)

**Files:**
- Create: `packages/shared/src/solar/layout/orientation.ts`
- Test: `packages/shared/src/solar/layout/orientation.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/layout/orientation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mod360, sheetDirection, sheetBearing, trueAzimuth, sheetBearingForAzimuth, equatorFacingAzimuth, arrayAzimuth } from './orientation'
import { GENERIC_MODULE_550, type ArrayProps } from './types'

describe('sheet bearings (° clockwise from sheet-up, image y down)', () => {
  it('mod360 wraps negatives and 360', () => {
    expect(mod360(-90)).toBe(270)
    expect(mod360(360)).toBe(0)
    expect(mod360(725)).toBe(5)
  })
  it('sheetDirection points up for 0 and right for 90', () => {
    const up = sheetDirection(0)
    expect(up.x).toBeCloseTo(0, 12); expect(up.y).toBeCloseTo(-1, 12)
    const right = sheetDirection(90)
    expect(right.x).toBeCloseTo(1, 12); expect(right.y).toBeCloseTo(0, 12)
  })
  it('sheetBearing of a drawn vector', () => {
    const o = { x: 0, y: 0 }
    expect(sheetBearing(o, { x: 0, y: -1 })).toBeCloseTo(0, 9)
    expect(sheetBearing(o, { x: 1, y: 0 })).toBeCloseTo(90, 9)
    expect(sheetBearing(o, { x: 0, y: 1 })).toBeCloseTo(180, 9)
    expect(sheetBearing(o, { x: -1, y: 0 })).toBeCloseTo(270, 9)
  })
})

describe('true azimuth (0 = N, 90 = E, clockwise)', () => {
  it('north up: sheet-down faces south', () => {
    expect(trueAzimuth(180, 0)).toBe(180)
  })
  it('north pointing sheet-right: sheet-up faces west', () => {
    expect(trueAzimuth(0, 90)).toBe(270)
  })
  it('inverts', () => {
    for (const [az, n] of [[0, 0], [180, 37], [90, 300], [271.5, 12.25]] as const) {
      expect(trueAzimuth(sheetBearingForAzimuth(az, n), n)).toBeCloseTo(az, 9)
    }
  })
  it('equator-facing default: north in the southern hemisphere', () => {
    expect(equatorFacingAzimuth(-26.2)).toBe(0)
    expect(equatorFacingAzimuth(40)).toBe(180)
  })
})

describe('arrayAzimuth', () => {
  const props: ArrayProps = {
    roofId: 'r', module: GENERIC_MODULE_550, orientation: 'portrait', mounting: 'flush', tiltDeg: 30,
    facingSheetDeg: 30, azimuthOverrideDeg: null, rowPitchM: 2, gapM: 0.02,
  }
  it('is null until north is set', () => {
    expect(arrayAzimuth(props, null)).toBeNull()
  })
  it('derives from the facing bearing and north', () => {
    expect(arrayAzimuth(props, 30)).toBe(0)
  })
  it('an override wins even without north', () => {
    expect(arrayAzimuth({ ...props, azimuthOverrideDeg: 15 }, null)).toBe(15)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/orientation.test.ts`
Expected: FAIL — cannot resolve `./orientation`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/layout/orientation.ts`:

```ts
/**
 * Directions on the sheet vs true azimuth (engine spec §3.2).
 *
 * A SHEET BEARING is degrees clockwise from sheet-up. The north reference of a
 * roof source (solar.roof_sources.north_bearing_deg) is the sheet bearing that
 * points to true north. A TRUE AZIMUTH is 0 = north, 90 = east, clockwise.
 *   azimuth = sheetBearing − northBearing   (mod 360)
 * Check: north up (0) and a direction pointing sheet-down (180) → 180, south.
 */
import type { ArrayProps, Pt } from './types'

export function mod360(deg: number): number {
  const r = ((deg % 360) + 360) % 360
  return r === 360 ? 0 : r
}

/** Unit vector in IMAGE coordinates (x right, y down) for a sheet bearing. */
export function sheetDirection(bearingDeg: number): Pt {
  const r = (bearingDeg * Math.PI) / 180
  return { x: Math.sin(r), y: -Math.cos(r) }
}

/** Sheet bearing of the vector from `a` to `b`. */
export function sheetBearing(a: Pt, b: Pt): number {
  return mod360((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI)
}

export function trueAzimuth(sheetBearingDeg: number, northBearingDeg: number): number {
  return mod360(sheetBearingDeg - northBearingDeg)
}

export function sheetBearingForAzimuth(azimuthDeg: number, northBearingDeg: number): number {
  return mod360(azimuthDeg + northBearingDeg)
}

/** The default facing for racked rows: towards the equator. */
export function equatorFacingAzimuth(latDeg: number): number {
  return latDeg < 0 ? 0 : 180
}

/** The azimuth the simulation uses for this array, or null while no north reference exists (§6.3 "Set north"). */
export function arrayAzimuth(props: ArrayProps, northBearingDeg: number | null): number | null {
  if (props.azimuthOverrideDeg !== null) return mod360(props.azimuthOverrideDeg)
  if (northBearingDeg === null) return null
  return trueAzimuth(props.facingSheetDeg, northBearingDeg)
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/orientation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/layout/orientation.ts packages/shared/src/solar/layout/orientation.test.ts
git commit -m "feat(solar-layout): sheet bearings and true azimuth from the north reference

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Row pitch — rule D-11

**Files:**
- Create: `packages/shared/src/solar/layout/row-pitch.ts`
- Test: `packages/shared/src/solar/layout/row-pitch.test.ts`

Hand check (Johannesburg, latitude −26.2°, 09:00 solar time on 21 June, declination +23.44°, hour angle −45°):
`sin α = sin(−26.2°)·sin(23.44°) + cos(26.2°)·cos(23.44°)·cos(45°) = −0.17562 + 0.58211 = 0.40649` → **α = 23.98355°**, `tan α = 0.444885`.
Module 2.278 m up the slope, tilt 15°: `L_proj = 2.278 × cos 15° = 2.200379 m`, `d = 2.278 × sin 15° / tan α = 0.589593 / 0.444885 = 1.325264 m`, **pitch = 3.525643 m**.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/layout/row-pitch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { solsticeElevationDeg, shadeFreeElevationDeg, autoRowPitch, manualRowPitch, JUNE_SOLSTICE_DECLINATION_DEG } from './row-pitch'

describe('solstice solar elevation at the site latitude (D-11)', () => {
  it('uses the June solstice declination', () => {
    expect(JUNE_SOLSTICE_DECLINATION_DEG).toBe(23.44)
  })
  it('Johannesburg at 09:00 solar time (hand-checked)', () => {
    expect(solsticeElevationDeg(-26.2, 9)).toBeCloseTo(23.98355, 4)
  })
  it('is symmetric about solar noon', () => {
    expect(solsticeElevationDeg(-26.2, 15)).toBeCloseTo(solsticeElevationDeg(-26.2, 9), 12)
  })
  it('Cape Town is lower, the equator higher', () => {
    expect(solsticeElevationDeg(-33.9, 9)).toBeCloseTo(18.4580, 3)
    expect(solsticeElevationDeg(0, 9)).toBeCloseTo(40.4477, 3)
  })
  it('the shade-free window uses the LOWER of its two ends', () => {
    // 10:00 is higher than 15:00, so 15:00 governs.
    expect(shadeFreeElevationDeg(-26.2, 10, 15)).toBeCloseTo(solsticeElevationDeg(-26.2, 15), 12)
  })
})

describe('row pitch', () => {
  it('auto: L_proj + L·sin(tilt)/tan(α), hand-checked', () => {
    const p = autoRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, latDeg: -26.2, fromHour: 9, toHour: 15 })
    expect(p.alphaDeg).toBeCloseTo(23.98355, 4)
    expect(p.projM).toBeCloseTo(2.200379, 5)
    expect(p.gapM).toBeCloseTo(1.325264, 5)
    expect(p.pitchM).toBeCloseTo(3.525643, 5)
  })
  it('a flat-mounted module needs no shading gap', () => {
    const p = autoRowPitch({ slopeLengthM: 2.278, tiltDeg: 0, latDeg: -26.2, fromHour: 9, toHour: 15 })
    expect(p.gapM).toBe(0)
    expect(p.pitchM).toBeCloseTo(2.278, 12)
  })
  it('refuses when the sun is too low to design against', () => {
    expect(() => autoRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, latDeg: -70, fromHour: 9, toHour: 15 }))
      .toThrow('enter a manual row pitch')
  })
  it('manual pitch must clear the module’s own projection', () => {
    expect(manualRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, pitchM: 4 }).pitchM).toBe(4)
    expect(() => manualRowPitch({ slopeLengthM: 2.278, tiltDeg: 15, pitchM: 2 })).toThrow('shorter than')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/row-pitch.test.ts`
Expected: FAIL — cannot resolve `./row-pitch`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/layout/row-pitch.ts`:

```ts
/**
 * Racked-row spacing (engine spec §3.1, decision D-11).
 *
 *   pitch = L_proj + d,  L_proj = L_slope·cos(tilt),  d = L_slope·sin(tilt)/tan(α)
 *
 * α is the solar elevation on 21 June at the SITE LATITUDE at the ends of the
 * shade-free window (default 09:00–15:00, org settings
 * row_spacing_shade_free_from_hour / _to_hour), taken as LOCAL SOLAR TIME
 * (hour angle 15° per hour from solar noon): the rule is a latitude rule, so it
 * does not depend on longitude or the SAST offset. The lower of the two ends
 * governs.
 */
export const JUNE_SOLSTICE_DECLINATION_DEG = 23.44

/** Below this elevation the gap explodes; the user must choose a pitch. */
const MIN_DESIGN_ELEVATION_DEG = 1

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function solsticeElevationDeg(latDeg: number, solarHour: number): number {
  const h = rad(15 * (solarHour - 12))
  const d = rad(JUNE_SOLSTICE_DECLINATION_DEG)
  const phi = rad(latDeg)
  return deg(Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h)))
}

export function shadeFreeElevationDeg(latDeg: number, fromHour: number, toHour: number): number {
  return Math.min(solsticeElevationDeg(latDeg, fromHour), solsticeElevationDeg(latDeg, toHour))
}

export interface RowPitch {
  /** Module depth on plan. */
  projM: number
  /** Shading gap behind the row. */
  gapM: number
  pitchM: number
  /** Design solar elevation; null for a manual pitch. */
  alphaDeg: number | null
}

export function autoRowPitch(i: { slopeLengthM: number; tiltDeg: number; latDeg: number; fromHour: number; toHour: number }): RowPitch {
  const projM = i.slopeLengthM * Math.cos(rad(i.tiltDeg))
  const alphaDeg = shadeFreeElevationDeg(i.latDeg, i.fromHour, i.toHour)
  if (i.tiltDeg === 0) return { projM, gapM: 0, pitchM: projM, alphaDeg }
  if (!(alphaDeg > MIN_DESIGN_ELEVATION_DEG)) {
    throw new Error('The winter sun is too low at this latitude for the shade-free window; enter a manual row pitch.')
  }
  const gapM = (i.slopeLengthM * Math.sin(rad(i.tiltDeg))) / Math.tan(rad(alphaDeg))
  return { projM, gapM, pitchM: projM + gapM, alphaDeg }
}

export function manualRowPitch(i: { slopeLengthM: number; tiltDeg: number; pitchM: number }): RowPitch {
  const projM = i.slopeLengthM * Math.cos(rad(i.tiltDeg))
  if (!(i.pitchM >= projM)) {
    throw new Error(`A row pitch of ${i.pitchM} m is shorter than the module's own depth on plan (${projM.toFixed(2)} m).`)
  }
  return { projM, gapM: i.pitchM - projM, pitchM: i.pitchM, alphaDeg: null }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/row-pitch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/layout/row-pitch.ts packages/shared/src/solar/layout/row-pitch.test.ts
git commit -m "feat(solar-layout): D-11 row pitch from the winter-solstice sun at the site latitude

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Module footprint — foreshortening along the fall line only

**Files:**
- Create: `packages/shared/src/solar/layout/footprint.ts`
- Test: `packages/shared/src/solar/layout/footprint.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/layout/footprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { moduleFootprint } from './footprint'
import { GENERIC_MODULE_550 as M } from './types'

describe('moduleFootprint', () => {
  it('flush on a 30° roof: ALONG the fall line foreshortened by cos(pitch), ACROSS untouched', () => {
    const f = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 30, gapM: 0.02, rowPitchM: null })
    expect(f.slopeLengthM).toBe(2.278)
    expect(f.alongM).toBeCloseTo(1.972806, 6)
    expect(f.stepAlongM).toBeCloseTo(1.990126, 6)
    // The WM bug was foreshortening this dimension. It must be exactly the module width.
    expect(f.acrossM).toBe(1.134)
    expect(f.stepAcrossM).toBeCloseTo(1.154, 12)
  })
  it('landscape swaps which side runs up the slope', () => {
    const f = moduleFootprint({ module: M, orientation: 'landscape', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    expect(f.slopeLengthM).toBe(1.134)
    expect(f.alongM).toBe(1.134)
    expect(f.acrossM).toBe(2.278)
  })
  it('racked: depth is the projection at the rack tilt, step is the row pitch', () => {
    const f = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: 3.525643 })
    expect(f.alongM).toBeCloseTo(2.200379, 6)
    expect(f.stepAlongM).toBe(3.525643)
  })
  it('racked needs a pitch at least the module depth', () => {
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: null }))
      .toThrow('row pitch')
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: 2 }))
      .toThrow('row pitch')
  })
  it('refuses nonsense dimensions and tilts', () => {
    expect(() => moduleFootprint({ module: { ...M, lengthM: 0 }, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })).toThrow('size')
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 90, gapM: 0.02, rowPitchM: null })).toThrow('tilt')
    expect(() => moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 10, gapM: -1, rowPitchM: null })).toThrow('gap')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/footprint.test.ts`
Expected: FAIL — cannot resolve `./footprint`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/layout/footprint.ts`:

```ts
/**
 * A module's footprint on PLAN (engine spec §3.1).
 *
 * "Along" is the facing direction (down the fall line for flush, the row
 * normal for racked); "across" is perpendicular to it.
 *   flush:  along = slope side × cos(roof pitch)  ← foreshortened
 *           across = the other side               ← NOT foreshortened
 *           (WM applied cos(pitch) across the slope; that is the bug pinned by
 *           footprint.test.ts and the pitched-roof case in packing.test.ts.)
 *   racked: along = slope side × cos(rack tilt); rows repeat every rowPitchM.
 * For flush, `tiltDeg` IS the roof pitch.
 */
import type { LayoutModuleSpec, ModuleOrientation, MountingKind } from './types'

export interface Footprint {
  /** The module side that runs up the slope, metres (true length). */
  slopeLengthM: number
  acrossM: number
  alongM: number
  stepAcrossM: number
  stepAlongM: number
}

export function moduleFootprint(i: {
  module: LayoutModuleSpec
  orientation: ModuleOrientation
  mounting: MountingKind
  tiltDeg: number
  gapM: number
  rowPitchM: number | null
}): Footprint {
  if (!(i.module.lengthM > 0 && i.module.widthM > 0)) throw new Error('The module size must be positive.')
  if (!(i.tiltDeg >= 0 && i.tiltDeg < 90)) throw new Error('The tilt must be at least 0° and less than 90°.')
  if (!(i.gapM >= 0)) throw new Error('The module gap cannot be negative.')
  const slope = i.orientation === 'portrait' ? i.module.lengthM : i.module.widthM
  const across = i.orientation === 'portrait' ? i.module.widthM : i.module.lengthM
  const cos = Math.cos((i.tiltDeg * Math.PI) / 180)
  const alongM = slope * cos
  if (i.mounting === 'flush') {
    return { slopeLengthM: slope, acrossM: across, alongM, stepAcrossM: across + i.gapM, stepAlongM: (slope + i.gapM) * cos }
  }
  if (i.rowPitchM === null || !(i.rowPitchM >= alongM)) {
    throw new Error('Racked rows need a row pitch at least the module depth on plan.')
  }
  return { slopeLengthM: slope, acrossM: across, alongM, stepAcrossM: across + i.gapM, stepAlongM: i.rowPitchM }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/footprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/layout/footprint.ts packages/shared/src/solar/layout/footprint.test.ts
git commit -m "feat(solar-layout): module footprint, foreshortened along the fall line only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Auto-fill packing with three hand-checked roofs

**Files:**
- Create: `packages/shared/src/solar/layout/packing.ts`
- Test: `packages/shared/src/solar/layout/packing.test.ts`

The algorithm (engine spec §3.1): work in a frame whose `v` axis is the facing direction and `u` axis is 90° clockwise of it. For each grid rotation (0°, plus 90° for flat-mounted modules on a flat roof) and each of 8 origin offsets `k` (`du = (k mod 4)/4 · stepAcross`, `dv = ⌊k/4⌋/2 · stepAlong`), rows start at `minV + setback + dv`, columns at `minU + setback + du`. A module is kept when it is inside the roof with the edge setback and clear of every obstruction by that obstruction's setback. Best = most modules; ties → fewer partial rows; still tied → the earlier candidate.

**The three hand-checked roofs** (module 2.278 × 1.134 m, gap 0.02 m, facing north with north = sheet-up):

1. **Flat, racked** — 20 × 12 m, setback 0.5, tilt 15°, D-11 pitch 3.525643 m at −26.2°. Across: usable 19 m → `⌊(19 − 1.134)/1.154⌋ + 1 = 16`. Along: rows at v = 0.5, 4.0256, 7.5513 from the edge; the third ends at 9.7517 ≤ 11.5, a fourth would end at 13.28 → **3 rows × 16 = 48**.
2. **Pitched 30°, flush** — 12 × 7 m on plan, setback 0.3. Across: `⌊(11.4 − 1.134)/1.154⌋ + 1 = 9`. Along (foreshortened): `⌊(6.4 − 1.972806)/1.990126⌋ + 1 = 3` → **27**. With WM's bug (foreshortening across instead) the same roof gives 11 × 2 = **22**.
3. **Irregular L with obstructions, flat-mounted (tilt 0)** — L roof (0,0)(16,0)(16,6)(8,6)(8,12)(0,12), setback 0.5; plant room (3,2)–(5,4) setback 0.6 (keep-out x 2.4–5.6, y 1.4–4.6); skylight circle (4,9) r 0.5 setback 0.3 (keep-out radius 0.8).
   - Rotation 0°, offset 0: rows (from the top of the sheet) cover y 9.222–11.5 → 4 (columns at x 2.808 and 3.962 hit the skylight); y 6.924–9.202 → 4 (same); y 4.626–6.904 → 6 (x ≤ 7.5 past the inner corner); y 2.328–4.606 → 9 (13 columns minus the 4 in the plant keep-out) → **23**.
   - Rotation 90°, offset 1 (du = 0.2885): columns x 0.5 → 5 (y 5.40…10.02), x 2.798 → 3 (plant below, skylight at y 7.71 and 8.87), x 5.096 → 5, x 7.394, 9.692, 11.99 → 4 each (y ≤ 4.366 for the inner corner) → **25**, the best over all 16 candidates.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/layout/packing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { autoFill, placeGrid, compareCandidates, gridOffset, GRID_OFFSETS, type Obstacle, type AutoFillInput } from './packing'
import { moduleFootprint, type Footprint } from './footprint'
import { quadInsideRoof, quadClearOfPolygon, quadClearOfCircle } from './geometry'
import { GENERIC_MODULE_550 as M, type Pt } from './types'

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
]
const L_ROOF: Pt[] = [
  { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 12 }, { x: 0, y: 12 },
]
const OBSTACLES: Obstacle[] = [
  { kind: 'polygon', points: rect(3, 2, 5, 4), setbackM: 0.6 },
  { kind: 'circle', centre: { x: 4, y: 9 }, radiusM: 0.5, setbackM: 0.3 },
]

function everyModuleIsLegal(input: AutoFillInput, modules: Pt[][]) {
  for (const q of modules) {
    expect(quadInsideRoof(q, input.roof, input.setbackM)).toBe(true)
    for (const o of input.obstacles) {
      if (o.kind === 'polygon') expect(quadClearOfPolygon(q, o.points, o.setbackM)).toBe(true)
      else expect(quadClearOfCircle(q, o.centre, o.radiusM, o.setbackM)).toBe(true)
    }
  }
}

describe('grid offsets', () => {
  it('eight offsets: quarter steps across × half steps along', () => {
    expect(GRID_OFFSETS).toBe(8)
    expect(gridOffset(0, 1, 2)).toEqual({ du: 0, dv: 0 })
    expect(gridOffset(3, 1, 2)).toEqual({ du: 0.75, dv: 0 })
    expect(gridOffset(5, 1, 2)).toEqual({ du: 0.25, dv: 1 })
  })
})

describe('hand-checked roof 1 — flat, racked 15°, D-11 pitch', () => {
  const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, gapM: 0.02, rowPitchM: 3.525643 })
  const input: AutoFillInput = { roof: rect(0, 0, 20, 12), setbackM: 0.5, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }
  it('places 3 rows of 16 = 48 modules', () => {
    const r = autoFill(input)
    expect(r.count).toBe(48)
    expect(r.rowCounts).toEqual([16, 16, 16])
    expect(r.rotationDeg).toBe(0)
    expect(r.offsetIndex).toBe(0)
    everyModuleIsLegal(input, r.modules)
  })
  it('rows are one pitch apart along the facing direction', () => {
    const r = autoFill(input)
    const ys = [...new Set(r.modules.map((q) => Math.round(Math.max(...q.map((p) => p.y)) * 1e6) / 1e6))].sort((a, b) => b - a)
    expect(ys[0]! - ys[1]!).toBeCloseTo(3.525643, 6)
  })
})

describe('hand-checked roof 2 — pitched 30°, flush', () => {
  const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 30, gapM: 0.02, rowPitchM: null })
  const input: AutoFillInput = { roof: rect(0, 0, 12, 7), setbackM: 0.3, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }
  it('places 9 × 3 = 27 modules', () => {
    const r = autoFill(input)
    expect(r.count).toBe(27)
    expect(r.rowCounts).toEqual([9, 9, 9])
    everyModuleIsLegal(input, r.modules)
  })
  it('the WM bug (foreshortening across the slope) would have placed 22 — pinned so it cannot come back', () => {
    const c = Math.cos(Math.PI / 6)
    const wm: Footprint = { slopeLengthM: 2.278, acrossM: 1.134 * c, stepAcrossM: 1.154 * c, alongM: 2.278, stepAlongM: 2.298 }
    expect(autoFill({ ...input, footprint: wm }).count).toBe(22)
    expect(autoFill(input).count).not.toBe(22)
  })
})

describe('hand-checked roof 3 — irregular L with a plant room and a skylight', () => {
  const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
  const input: AutoFillInput = { roof: L_ROOF, setbackM: 0.5, obstacles: OBSTACLES, footprint: fp, facingSheetDeg: 0, rotationsDeg: [0, 90] }
  it('rotation 0°, offset 0 gives 23 in rows 4, 4, 6, 9 (hand count)', () => {
    const g = placeGrid(input, 0, 0)
    expect(g.modules.length).toBe(23)
    expect(g.rowCounts).toEqual([4, 4, 6, 9])
  })
  it('rotation 90°, offset 1 gives 25 in rows 5, 3, 5, 4, 4, 4 (hand count)', () => {
    const g = placeGrid(input, 90, 1)
    expect(g.modules.length).toBe(25)
    expect(g.rowCounts).toEqual([5, 3, 5, 4, 4, 4])
  })
  it('auto-fill picks the best of 2 rotations × 8 offsets: 25 at 90°, offset 1', () => {
    const r = autoFill(input)
    expect(r.count).toBe(25)
    expect(r.rotationDeg).toBe(90)
    expect(r.offsetIndex).toBe(1)
    everyModuleIsLegal(input, r.modules)
  })
  it('the obstructions cost modules (39 without them)', () => {
    expect(autoFill({ ...input, obstacles: [] }).count).toBe(39)
  })
})

describe('tie-break and edge cases', () => {
  it('more modules wins; equal count prefers fewer partial rows; still equal keeps the first', () => {
    const a = { count: 10, partialRows: 1 }
    expect(compareCandidates({ count: 11, partialRows: 5 }, a)).toBeLessThan(0)
    expect(compareCandidates({ count: 10, partialRows: 0 }, a)).toBeLessThan(0)
    expect(compareCandidates({ count: 10, partialRows: 1 }, a)).toBe(0)
  })
  it('a symmetric square ties 0° and 90°, and 0° (the first candidate) is kept', () => {
    const fp: Footprint = { slopeLengthM: 1, acrossM: 1, alongM: 1, stepAcrossM: 1, stepAlongM: 1 }
    const r = autoFill({ roof: rect(0, 0, 10.2, 10.2), setbackM: 0.1, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0, 90] })
    expect(r.count).toBe(100)
    expect(r.rotationDeg).toBe(0)
    expect(r.offsetIndex).toBe(0)
  })
  it('a roof smaller than one module places nothing', () => {
    const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    expect(autoFill({ roof: rect(0, 0, 1, 1), setbackM: 0.3, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }).count).toBe(0)
  })
  it('refuses a roof that is not a simple polygon', () => {
    const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    expect(() => autoFill({ roof: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 0 }, { x: 0, y: 5 }], setbackM: 0, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] }))
      .toThrow('roof outline crosses itself')
  })
  it('works for a roof that faces a skewed bearing (rotated frame)', () => {
    const fp = moduleFootprint({ module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 0, gapM: 0.02, rowPitchM: null })
    // The 20 × 12 roof rotated 30° about the origin, facing 30°: same count as the unrotated roof facing 0°.
    const rot = (p: Pt): Pt => ({ x: p.x * Math.cos(Math.PI / 6) - p.y * Math.sin(Math.PI / 6), y: p.x * Math.sin(Math.PI / 6) + p.y * Math.cos(Math.PI / 6) })
    const straight = autoFill({ roof: rect(0, 0, 20, 12), setbackM: 0.5, obstacles: [], footprint: fp, facingSheetDeg: 0, rotationsDeg: [0] })
    const skewed = autoFill({ roof: rect(0, 0, 20, 12).map(rot), setbackM: 0.5, obstacles: [], footprint: fp, facingSheetDeg: 30, rotationsDeg: [0] })
    expect(skewed.count).toBe(straight.count)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/packing.test.ts`
Expected: FAIL — cannot resolve `./packing`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/layout/packing.ts`:

```ts
/**
 * Array auto-fill (engine spec §3.1).
 *
 * Usable area = roof inset by its edge setback, minus each obstruction grown by
 * its own setback. Implemented as a per-module test (quadInsideRoof /
 * quadClear…) rather than polygon offsetting, which is exact for concave roofs
 * and needs no clipping library.
 *
 * Frame: v = the facing direction, u = 90° clockwise of it (both unit vectors
 * in plan metres). Rows advance along v by the footprint's stepAlong; modules
 * advance along u by stepAcross. The grid origin is the roof's frame bounding
 * box corner inset by the setback, shifted by one of 8 offsets.
 *
 * Candidates: every rotation in `rotationsDeg` × GRID_OFFSETS. Best = most
 * modules; tie → fewer partial rows (a row shorter than the longest); tie → the
 * earlier candidate (rotation order, then offset order), so the result is
 * deterministic.
 */
import { EPS, isSimplePolygon, quadClearOfCircle, quadClearOfPolygon, quadInsideRoof, rectQuad } from './geometry'
import { sheetDirection } from './orientation'
import type { Footprint } from './footprint'
import type { Pt } from './types'

export type Obstacle =
  | { kind: 'polygon'; points: Pt[]; setbackM: number }
  | { kind: 'circle'; centre: Pt; radiusM: number; setbackM: number }

export interface AutoFillInput {
  /** Roof outline, plan metres. */
  roof: Pt[]
  setbackM: number
  obstacles: Obstacle[]
  footprint: Footprint
  /** Sheet bearing the modules face. */
  facingSheetDeg: number
  /** [0] when the facing is fixed (racked rows, flush on a pitch); [0, 90] for flat-mounted modules. */
  rotationsDeg: number[]
}

export interface GridResult {
  modules: Pt[][]
  rowCounts: number[]
}

export interface AutoFillResult extends GridResult {
  count: number
  rotationDeg: number
  offsetIndex: number
}

export const GRID_OFFSETS = 8

export function gridOffset(k: number, stepAcross: number, stepAlong: number): { du: number; dv: number } {
  return { du: ((k % 4) / 4) * stepAcross, dv: (Math.floor(k / 4) / 2) * stepAlong }
}

export function moduleIsLegal(quad: Pt[], roof: Pt[], setbackM: number, obstacles: Obstacle[]): boolean {
  if (!quadInsideRoof(quad, roof, setbackM)) return false
  for (const o of obstacles) {
    if (o.kind === 'polygon' && !quadClearOfPolygon(quad, o.points, o.setbackM)) return false
    if (o.kind === 'circle' && !quadClearOfCircle(quad, o.centre, o.radiusM, o.setbackM)) return false
  }
  return true
}

export function placeGrid(input: AutoFillInput, rotationDeg: number, offsetIndex: number): GridResult {
  const f = input.footprint
  const vh = sheetDirection(input.facingSheetDeg + rotationDeg)
  const uh = sheetDirection(input.facingSheetDeg + rotationDeg + 90)
  const us = input.roof.map((p) => p.x * uh.x + p.y * uh.y)
  const vs = input.roof.map((p) => p.x * vh.x + p.y * vh.y)
  const minU = Math.min(...us)
  const maxU = Math.max(...us)
  const minV = Math.min(...vs)
  const maxV = Math.max(...vs)
  const { du, dv } = gridOffset(offsetIndex, f.stepAcrossM, f.stepAlongM)
  const toPlan = (u: number, v: number): Pt => ({ x: u * uh.x + v * vh.x, y: u * uh.y + v * vh.y })

  const modules: Pt[][] = []
  const rowCounts: number[] = []
  for (let v = minV + input.setbackM + dv; v + f.alongM <= maxV - input.setbackM + EPS; v += f.stepAlongM) {
    let n = 0
    for (let u = minU + input.setbackM + du; u + f.acrossM <= maxU - input.setbackM + EPS; u += f.stepAcrossM) {
      const quad = rectQuad(toPlan(u, v), uh, vh, f.acrossM, f.alongM)
      if (moduleIsLegal(quad, input.roof, input.setbackM, input.obstacles)) {
        modules.push(quad)
        n++
      }
    }
    rowCounts.push(n)
  }
  return { modules, rowCounts }
}

function partialRows(rowCounts: number[]): number {
  const longest = Math.max(0, ...rowCounts)
  return rowCounts.filter((n) => n > 0 && n < longest).length
}

/** Negative when `a` is better than `b`; 0 when equal (the caller keeps the earlier one). */
export function compareCandidates(a: { count: number; partialRows: number }, b: { count: number; partialRows: number }): number {
  if (a.count !== b.count) return b.count - a.count
  return a.partialRows - b.partialRows
}

export function autoFill(input: AutoFillInput): AutoFillResult {
  if (!isSimplePolygon(input.roof)) throw new Error('The roof outline crosses itself; redraw it.')
  if (!(input.setbackM >= 0)) throw new Error('The edge setback cannot be negative.')
  let best: (AutoFillResult & { partialRows: number }) | null = null
  for (const rotationDeg of input.rotationsDeg) {
    for (let k = 0; k < GRID_OFFSETS; k++) {
      const g = placeGrid(input, rotationDeg, k)
      const cand = { ...g, count: g.modules.length, rotationDeg, offsetIndex: k, partialRows: partialRows(g.rowCounts) }
      if (best === null || compareCandidates(cand, best) < 0) best = cand
    }
  }
  if (best === null) return { modules: [], rowCounts: [], count: 0, rotationDeg: 0, offsetIndex: 0 }
  const { partialRows: _p, ...result } = best
  return result
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/packing.test.ts`
Expected: PASS. If the roof-3 hand counts disagree, the implementation is wrong, not the test — the counts were checked by hand against the keep-out zones listed above.

- [ ] **Step 5: Mutation check (the test must be able to fail)**

Temporarily change `stepAcrossM: across + i.gapM` in `footprint.ts` flush branch to `stepAcrossM: (across + i.gapM) * cos` (the WM bug) and re-run `packing.test.ts` + `footprint.test.ts`.
Expected: FAIL in roof 2 (`27` expected) and in footprint. Revert and re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/solar/layout/packing.ts packages/shared/src/solar/layout/packing.test.ts
git commit -m "feat(solar-layout): auto-fill packing with setbacks, obstructions, 0/90° x 8 offsets

Three hand-checked roofs: flat racked (48), pitched flush (27, WM's
across-the-slope foreshortening would give 22), irregular L with a plant
room and a skylight (25).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: String sizing (4a copy) and auto-stringing

**Files:**
- Create: `packages/shared/src/services/solar/pv/string-sizing.ts` (byte-identical to Phase 4a)
- Create: `packages/shared/src/solar/layout/strings.ts`
- Test: `packages/shared/src/solar/layout/strings.test.ts`

- [ ] **Step 1: Bring in Phase 4a's string sizing, byte-identical**

If `git rev-parse --verify origin/feat/solar-phase-4a` succeeds:

```bash
git checkout origin/feat/solar-phase-4a -- packages/shared/src/services/solar/pv/string-sizing.ts
```

Otherwise create `packages/shared/src/services/solar/pv/string-sizing.ts` with EXACTLY this content (it is Phase 4a commit `c8665929`; do not reformat — an identical add merges cleanly, a reformatted one conflicts):

```ts
/**
 * String sizing per inverter MPPT (engine spec §3.3):
 *   Voc_cold = Voc_STC × (1 + β_Voc × (T_min − 25)) × n        ≤ V_dc_max       hard fail
 *   Vmp_hot  = Vmp_STC × (1 + γ_Vmp × (T_cell_max − 25)) × n    ≥ V_mppt_min     fail
 *   Vmp_cold = Vmp_STC × (1 + γ_Vmp × (T_min − 25)) × n         ≤ V_mppt_max     warn
 *   strings_parallel × Isc_STC × 1.25                           ≤ I_mppt_max     fail
 * T_cell_max = T_amb,max + 35 °C (racked) / + 45 °C (flush).
 */

export interface StringModuleSpec {
  vocStc: number
  vmpStc: number
  iscStc: number
  /** Voc temperature coefficient, fraction per °C (negative), e.g. −0.0027. */
  betaVocPerC: number
  /** Vmp temperature coefficient, fraction per °C (negative), e.g. −0.0035. */
  gammaVmpPerC: number
}

export interface MpptSpec {
  vDcMax: number
  vMpptMin: number
  vMpptMax: number
  iMpptMax: number
}

export type Mounting = 'racked' | 'flush'

export interface StringSizingInput {
  module: StringModuleSpec
  mppt: MpptSpec
  modulesInSeries: number
  stringsInParallel: number
  tMinC: number
  tAmbMaxC: number
  mounting: Mounting
}

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface StringCheck {
  id: 'voc-cold' | 'vmp-hot' | 'vmp-cold' | 'current'
  value: number
  limit: number
  status: CheckStatus
}

export interface StringSizingResult {
  vocCold: number
  vmpHot: number
  vmpCold: number
  current: number
  checks: StringCheck[]
  /** No check failed (warnings allowed). */
  ok: boolean
}

/** Default site minimum ambient when no weather is loaded (spec §3.3). */
export const DEFAULT_T_MIN_C = { inland: -5, coastal: 0 } as const

export function cellTempMax(tAmbMaxC: number, mounting: Mounting): number {
  return tAmbMaxC + (mounting === 'racked' ? 35 : 45)
}

export function checkStringSizing(i: StringSizingInput): StringSizingResult {
  if (!Number.isInteger(i.modulesInSeries) || i.modulesInSeries < 1) throw new Error('modulesInSeries must be a positive integer')
  if (!Number.isInteger(i.stringsInParallel) || i.stringsInParallel < 1) throw new Error('stringsInParallel must be a positive integer')
  const n = i.modulesInSeries
  const tHot = cellTempMax(i.tAmbMaxC, i.mounting)
  const vocCold = i.module.vocStc * (1 + i.module.betaVocPerC * (i.tMinC - 25)) * n
  const vmpHot = i.module.vmpStc * (1 + i.module.gammaVmpPerC * (tHot - 25)) * n
  const vmpCold = i.module.vmpStc * (1 + i.module.gammaVmpPerC * (i.tMinC - 25)) * n
  const current = i.stringsInParallel * i.module.iscStc * 1.25
  const checks: StringCheck[] = [
    { id: 'voc-cold', value: vocCold, limit: i.mppt.vDcMax, status: vocCold <= i.mppt.vDcMax ? 'pass' : 'fail' },
    { id: 'vmp-hot', value: vmpHot, limit: i.mppt.vMpptMin, status: vmpHot >= i.mppt.vMpptMin ? 'pass' : 'fail' },
    { id: 'vmp-cold', value: vmpCold, limit: i.mppt.vMpptMax, status: vmpCold <= i.mppt.vMpptMax ? 'pass' : 'warn' },
    { id: 'current', value: current, limit: i.mppt.iMpptMax, status: current <= i.mppt.iMpptMax ? 'pass' : 'fail' },
  ]
  return { vocCold, vmpHot, vmpCold, current, checks, ok: checks.every((c) => c.status !== 'fail') }
}

/** Largest modules-in-series that passes every hard check, or null if none does (spec §3.3). */
export function recommendedModulesInSeries(i: Omit<StringSizingInput, 'modulesInSeries'>, maxN = 200): number | null {
  for (let n = maxN; n >= 1; n--) {
    if (checkStringSizing({ ...i, modulesInSeries: n }).ok) return n
  }
  return null
}
```

Verify byte identity when the 4a worktree is present locally:

```bash
if [ -d ~/.config/superpowers/worktrees/esite/solar-phase-4a ]; then
  git -C ~/.config/superpowers/worktrees/esite/solar-phase-4a show c8665929:packages/shared/src/services/solar/pv/string-sizing.ts \
    | diff - packages/shared/src/services/solar/pv/string-sizing.ts && echo IDENTICAL
fi
```

Expected: `IDENTICAL` (or no 4a worktree present — then trust the content above).

- [ ] **Step 2: Write the failing strings tests**

Hand check (generic 550 W module, T_min −5 °C, max ambient 35 °C, racked → T_cell 70 °C): Voc_cold per module = 49.9 × (1 + 0.0027 × 30) = 53.9419 V; Vmp_hot per module = 41.96 × (1 − 0.0035 × 45) = 35.3513 V; Vmp_cold per module = 46.3658 V; 1.25 × Isc = 17.4375 A. With the generic 50 kW inverter (1100 V, 200–1000 V MPPT, 40 A per MPPT): n = 20 → Voc 1078.84 V ✓ (21 → 1132.78 ✗), Vmp_hot 707.03 ✓, Vmp_cold 927.32 ✓ → **recommended 20**; ⌊40 / 17.4375⌋ = **2 strings per MPPT**.

`packages/shared/src/solar/layout/strings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { stringCheck, recommendedStringLength, maxStringsPerMppt, serpentineOrder, autoString } from './strings'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type StringProps } from './types'

const COND = { tMinC: -5, tAmbMaxC: 35 }
const quad = (x: number, y: number, w = 10, h = 18) => [x, y, x + w, y, x + w, y + h, x, y + h]

describe('string checks from layout specs (engine spec §3.3, hand-checked)', () => {
  it('20 × 550 W on the generic 50 kW inverter passes; Voc_cold 1078.84 V', () => {
    const r = stringCheck(M, INV, 20, 1, 'racked', COND)
    expect(r.vocCold).toBeCloseTo(1078.838, 3)
    expect(r.vmpHot).toBeCloseTo(707.026, 3)
    expect(r.vmpCold).toBeCloseTo(927.316, 3)
    expect(r.ok).toBe(true)
  })
  it('21 in series exceeds 1100 V (hard fail)', () => {
    const r = stringCheck(M, INV, 21, 1, 'racked', COND)
    expect(r.checks.find((c) => c.id === 'voc-cold')?.status).toBe('fail')
    expect(r.ok).toBe(false)
  })
  it('flush mounting runs 10 °C hotter (Vmp_hot drops)', () => {
    expect(stringCheck(M, INV, 20, 1, 'flush', COND).vmpHot).toBeCloseTo(677.654, 3)
  })
  it('recommended length is the largest that passes every hard check', () => {
    expect(recommendedStringLength(M, INV, 'racked', COND)).toBe(20)
  })
  it('strings per MPPT from the current limit', () => {
    expect(maxStringsPerMppt(M, INV)).toBe(2)
    expect(maxStringsPerMppt(M, { ...INV, iMpptMax: 10 })).toBe(0)
  })
})

describe('serpentine order', () => {
  it('facing north (sheet-up): the southernmost row first, then snake back', () => {
    // Top row (y 0) indices 0,1,2; bottom row (y 20) indices 3,4,5.
    const quads = [quad(0, 0), quad(10, 0), quad(20, 0), quad(0, 20), quad(10, 20), quad(20, 20)]
    expect(serpentineOrder(quads, 0)).toEqual([3, 4, 5, 2, 1, 0])
  })
})

describe('autoString', () => {
  // An inverter that makes the recommended length 2 so the example stays small:
  // 2 × 53.94 = 107.9 V ≤ 110; 3 × would be 161.8. Vmp_hot 70.7 ≥ 60; Vmp_cold 92.7 ≤ 100.
  const small = { ...INV, mppts: 1, vDcMax: 110, vMpptMin: 60, vMpptMax: 100, iMpptMax: 40 }
  const quads = [quad(0, 0), quad(10, 0), quad(20, 0), quad(0, 20), quad(10, 20), quad(20, 20)]

  it('fills strings of the recommended length in serpentine order onto free MPPT inputs', () => {
    const r = autoString({
      arrays: [{ id: 'A', quads, facingSheetDeg: 0 }], existingStrings: [], inverterId: 'I', inverter: small,
      module: M, mounting: 'racked', conditions: COND,
    })
    expect(r.stringLength).toBe(2)
    expect(r.strings).toEqual([
      { mppt: 1, modules: [{ arrayId: 'A', index: 3 }, { arrayId: 'A', index: 4 }] },
      { mppt: 1, modules: [{ arrayId: 'A', index: 5 }, { arrayId: 'A', index: 2 }] },
    ])
    // Two strings fill MPPT 1 (current limit); the third complete string has nowhere to go.
    expect(r.unstrung).toEqual([{ arrayId: 'A', index: 1 }, { arrayId: 'A', index: 0 }])
    expect(r.reason).toBe('The inverter has no free MPPT input for the remaining modules.')
  })

  it('skips modules already in a string and counts existing strings against MPPT capacity', () => {
    const existing: StringProps[] = [{ inverterId: 'I', mppt: 1, modules: [{ arrayId: 'A', index: 3 }, { arrayId: 'A', index: 4 }] }]
    const r = autoString({
      arrays: [{ id: 'A', quads, facingSheetDeg: 0 }], existingStrings: existing, inverterId: 'I', inverter: small,
      module: M, mounting: 'racked', conditions: COND,
    })
    expect(r.strings).toEqual([{ mppt: 1, modules: [{ arrayId: 'A', index: 5 }, { arrayId: 'A', index: 2 }] }])
    expect(r.unstrung).toEqual([{ arrayId: 'A', index: 1 }, { arrayId: 'A', index: 0 }])
  })

  it('a remainder shorter than a string stays unstrung with its own reason', () => {
    const roomy = { ...small, mppts: 4 }
    const r = autoString({
      arrays: [{ id: 'A', quads: quads.slice(0, 5), facingSheetDeg: 0 }], existingStrings: [], inverterId: 'I', inverter: roomy,
      module: M, mounting: 'racked', conditions: COND,
    })
    expect(r.strings).toHaveLength(2)
    expect(r.unstrung).toHaveLength(1)
    expect(r.reason).toBe('1 module is left over — fewer than one string of 2.')
  })

  it('refuses when no string length passes', () => {
    expect(() => autoString({
      arrays: [{ id: 'A', quads, facingSheetDeg: 0 }], existingStrings: [], inverterId: 'I', inverter: { ...small, vDcMax: 40 },
      module: M, mounting: 'racked', conditions: COND,
    })).toThrow('No string length passes')
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/strings.test.ts`
Expected: FAIL — cannot resolve `./strings`.

- [ ] **Step 4: Implement**

`packages/shared/src/solar/layout/strings.ts`:

```ts
/**
 * Strings on the layout (functional spec §6.3 "Assign strings", engine §3.3).
 *
 * The check itself is Phase 4a's checkStringSizing (services/solar/pv/
 * string-sizing.ts); this module adapts layout specs to it, orders modules for
 * wiring, and fills MPPT inputs. Pure.
 */
import {
  checkStringSizing,
  recommendedModulesInSeries,
  type StringSizingResult,
} from '../../services/solar/pv/string-sizing'
import { flatToPts, vertexMean, distance } from './geometry'
import { sheetDirection } from './orientation'
import type { LayoutInverterSpec, LayoutModuleSpec, ModuleRef, MountingKind, StringProps } from './types'

export interface DesignConditions {
  tMinC: number
  tAmbMaxC: number
}

function mpptOf(inv: LayoutInverterSpec) {
  return { vDcMax: inv.vDcMax, vMpptMin: inv.vMpptMin, vMpptMax: inv.vMpptMax, iMpptMax: inv.iMpptMax }
}

export function stringCheck(
  module: LayoutModuleSpec, inverter: LayoutInverterSpec, modulesInSeries: number, stringsOnMppt: number,
  mounting: MountingKind, c: DesignConditions,
): StringSizingResult {
  return checkStringSizing({
    module, mppt: mpptOf(inverter), modulesInSeries, stringsInParallel: stringsOnMppt,
    tMinC: c.tMinC, tAmbMaxC: c.tAmbMaxC, mounting,
  })
}

export function recommendedStringLength(
  module: LayoutModuleSpec, inverter: LayoutInverterSpec, mounting: MountingKind, c: DesignConditions,
): number | null {
  return recommendedModulesInSeries({
    module, mppt: mpptOf(inverter), stringsInParallel: 1, tMinC: c.tMinC, tAmbMaxC: c.tAmbMaxC, mounting,
  })
}

export function maxStringsPerMppt(module: LayoutModuleSpec, inverter: LayoutInverterSpec): number {
  return Math.max(0, Math.floor(inverter.iMpptMax / (module.iscStc * 1.25) + 1e-9))
}

/**
 * Wiring order: rows along the facing direction (the row nearest the back of
 * the array first), snaking — even rows left→right across, odd rows back.
 * `quads` are image-pixel quads; returns indices into `quads`.
 */
export function serpentineOrder(quads: number[][], facingSheetDeg: number): number[] {
  if (quads.length === 0) return []
  const vh = sheetDirection(facingSheetDeg)
  const uh = sheetDirection(facingSheetDeg + 90)
  const items = quads.map((q, i) => {
    const pts = flatToPts(q)
    const c = vertexMean(pts)
    return { i, u: c.x * uh.x + c.y * uh.y, v: c.x * vh.x + c.y * vh.y, h: Math.min(distance(pts[0]!, pts[1]!), distance(pts[1]!, pts[2]!)) }
  })
  items.sort((a, b) => a.v - b.v || a.u - b.u)
  const tol = items[0]!.h / 2
  const rows: Array<typeof items> = []
  for (const it of items) {
    const row = rows[rows.length - 1]
    if (row && it.v - row[0]!.v <= tol) row.push(it)
    else rows.push([it])
  }
  return rows.flatMap((row, r) => {
    const sorted = [...row].sort((a, b) => a.u - b.u)
    return (r % 2 === 0 ? sorted : sorted.reverse()).map((x) => x.i)
  })
}

export interface AutoStringInput {
  arrays: Array<{ id: string; quads: number[][]; facingSheetDeg: number }>
  existingStrings: StringProps[]
  inverterId: string
  inverter: LayoutInverterSpec
  module: LayoutModuleSpec
  mounting: MountingKind
  conditions: DesignConditions
}

export interface AutoStringResult {
  stringLength: number
  strings: Array<{ mppt: number; modules: ModuleRef[] }>
  unstrung: ModuleRef[]
  /** Why anything is unstrung, as a sentence; null when everything was strung. */
  reason: string | null
}

export function autoString(i: AutoStringInput): AutoStringResult {
  const n = recommendedStringLength(i.module, i.inverter, i.mounting, i.conditions)
  if (n === null) throw new Error('No string length passes the checks for this module on this inverter.')
  const perMppt = maxStringsPerMppt(i.module, i.inverter)

  const taken = new Set(i.existingStrings.flatMap((s) => s.modules.map((m) => `${m.arrayId}#${m.index}`)))
  const queue: ModuleRef[] = i.arrays.flatMap((a) =>
    serpentineOrder(a.quads, a.facingSheetDeg)
      .map((index) => ({ arrayId: a.id, index }))
      .filter((m) => !taken.has(`${m.arrayId}#${m.index}`)),
  )

  const used = new Map<number, number>()
  for (const s of i.existingStrings) if (s.inverterId === i.inverterId) used.set(s.mppt, (used.get(s.mppt) ?? 0) + 1)
  const nextMppt = (): number | null => {
    for (let m = 1; m <= i.inverter.mppts; m++) if ((used.get(m) ?? 0) < perMppt) return m
    return null
  }

  const strings: AutoStringResult['strings'] = []
  let cursor = 0
  let full = false
  while (queue.length - cursor >= n) {
    const mppt = nextMppt()
    if (mppt === null) { full = true; break }
    strings.push({ mppt, modules: queue.slice(cursor, cursor + n) })
    used.set(mppt, (used.get(mppt) ?? 0) + 1)
    cursor += n
  }
  const unstrung = queue.slice(cursor)
  let reason: string | null = null
  if (full) reason = 'The inverter has no free MPPT input for the remaining modules.'
  else if (unstrung.length > 0) {
    reason = `${unstrung.length} module${unstrung.length === 1 ? ' is' : 's are'} left over — fewer than one string of ${n}.`
  }
  return { stringLength: n, strings, unstrung, reason }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/strings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/solar/pv/string-sizing.ts packages/shared/src/solar/layout/strings.ts packages/shared/src/solar/layout/strings.test.ts
git commit -m "feat(solar-layout): string checks from layout specs, serpentine auto-string onto MPPTs

string-sizing.ts is a byte-identical copy of Phase 4a (c8665929) so the
merge is an identical add.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Summary, BOM and layout readiness

**Files:**
- Create: `packages/shared/src/solar/layout/summary.ts`
- Create: `packages/shared/src/solar/layout/readiness.ts`
- Test: `packages/shared/src/solar/layout/summary.test.ts`
- Test: `packages/shared/src/solar/layout/readiness.test.ts`

- [ ] **Step 1: Write the failing summary tests**

`packages/shared/src/solar/layout/summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { layoutSummary, layoutBom, bomToCsv, storedSummary, DC_ROUTING_FACTOR } from './summary'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type LayoutObject } from './types'

const PPM = 10 // 10 px per metre
const quad = (x: number, y: number) => [x, y, x + 10, y, x + 10, y + 20, x, y + 20] // 1 m × 2 m
const ROOF: LayoutObject = {
  id: 'roof1', kind: 'roof', pixelsPerMeter: PPM,
  geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] }, // 20 m × 12 m
  props: { name: 'Main', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null },
}
const ARRAY: LayoutObject = {
  id: 'arr1', kind: 'array', pixelsPerMeter: PPM,
  geometry: { modules: [quad(10, 10), quad(30, 10)] },
  props: { roofId: 'roof1', module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 },
}
const INVERTER: LayoutObject = { id: 'inv1', kind: 'inverter', pixelsPerMeter: PPM, geometry: { x: 110, y: 10 }, props: { name: 'INV-1', inverter: INV } }
const STRING: LayoutObject = {
  id: 's1', kind: 'string', pixelsPerMeter: PPM, geometry: {},
  props: { inverterId: 'inv1', mppt: 1, modules: [{ arrayId: 'arr1', index: 0 }, { arrayId: 'arr1', index: 1 }] },
}
const COND = { tMinC: -5, tAmbMaxC: 35 }

describe('layoutSummary', () => {
  it('totals kWp, AC, ratio, counts and utilisation', () => {
    const s = layoutSummary([ROOF, ARRAY, INVERTER, STRING], COND)
    expect(s.moduleCount).toBe(2)
    expect(s.dcKwp).toBeCloseTo(1.1, 12)
    expect(s.acKw).toBe(50)
    expect(s.dcAcRatio).toBeCloseTo(0.022, 12)
    expect(s.modulesByType).toEqual([{ label: 'Generic 550 W mono (edit to the datasheet)', count: 2, kwp: 1.1 }])
    expect(s.inverterCount).toBe(1)
    expect(s.roofAreaM2).toBe(240)
    expect(s.moduleAreaM2).toBe(4)
    expect(s.utilisationPct).toBeCloseTo((4 / 240) * 100, 12)
    expect(s.arraysWithModules).toBe(1)
    expect(s.arraysOutsideRoof).toEqual([])
    expect(s.unstrungModules).toBe(0)
  })
  it('string checks: 2 × 550 W cannot reach the 200 V MPPT minimum when hot — fail', () => {
    const s = layoutSummary([ROOF, ARRAY, INVERTER, STRING], COND)
    expect(s.strings).toEqual({ total: 1, pass: 0, warn: 0, fail: 1 })
  })
  it('flags an array with a module outside every roof', () => {
    const outside: LayoutObject = { ...ARRAY, id: 'arr2', geometry: { modules: [quad(400, 400)] } } as LayoutObject
    expect(layoutSummary([ROOF, ARRAY, outside], COND).arraysOutsideRoof).toEqual(['arr2'])
  })
  it('counts modules not in any string', () => {
    expect(layoutSummary([ROOF, ARRAY, INVERTER], COND).unstrungModules).toBe(2)
  })
  it('no roofs → no utilisation; no inverter → no ratio', () => {
    const s = layoutSummary([ARRAY], COND)
    expect(s.utilisationPct).toBeNull()
    expect(s.dcAcRatio).toBeNull()
  })
})

describe('BOM', () => {
  it('lists modules, inverters, mounting and a DC cable estimate', () => {
    const objs = [ROOF, ARRAY, INVERTER, STRING]
    const rows = layoutBom(objs, layoutSummary(objs, COND))
    expect(rows.map((r) => r.item)).toEqual(['Module', 'Inverter', 'Mounting', 'DC cable'])
    expect(rows[0]).toEqual({ item: 'Module', description: 'Generic 550 W mono (edit to the datasheet)', quantity: 2, unit: 'ea' })
    expect(rows[2]).toEqual({ item: 'Mounting', description: 'Racking positions (estimate)', quantity: 2, unit: 'ea' })
    // Module centres (1.5, 2) and (3.5, 2) m → string centre (2.5, 2); inverter (11, 1) m:
    // Manhattan 8.5 + 1 = 9.5 m, × 2 conductors × routing factor.
    expect(rows[3]!.quantity).toBeCloseTo(9.5 * 2 * DC_ROUTING_FACTOR, 6)
  })
  it('CSV quotes fields that carry commas or quotes', () => {
    const csv = bomToCsv([{ item: 'Module', description: 'Brand "X", 550', quantity: 2, unit: 'ea' }])
    expect(csv).toBe('Item,Description,Quantity,Unit\r\nModule,"Brand ""X"", 550",2,ea\r\n')
  })
})

describe('storedSummary', () => {
  it('keeps only the figures the list and readiness read', () => {
    const s = storedSummary(layoutSummary([ROOF, ARRAY, INVERTER, STRING], COND))
    expect(s).toEqual({ moduleCount: 2, dcKwp: 1.1, acKw: 50, arraysWithModules: 1, arrayOutsideRoof: false, stringsFail: 1 })
  })
})
```

- [ ] **Step 2: Write the failing readiness tests**

`packages/shared/src/solar/layout/readiness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { layoutReadiness } from './readiness'

describe('layoutReadiness (functional spec readiness table, Layout row)', () => {
  it('grey until a layout exists', () => {
    expect(layoutReadiness(null).status).toBe('grey')
    expect(layoutReadiness({ layouts: 0, arraysWithModules: 0, northSet: false, arrayOutsideRoof: false }).status).toBe('grey')
  })
  it('amber: started but no north reference', () => {
    expect(layoutReadiness({ layouts: 1, arraysWithModules: 2, northSet: false, arrayOutsideRoof: false }))
      .toEqual({ status: 'amber', reason: 'Layout started but no north reference' })
  })
  it('amber: north set but no array has modules', () => {
    expect(layoutReadiness({ layouts: 1, arraysWithModules: 0, northSet: true, arrayOutsideRoof: false }))
      .toEqual({ status: 'amber', reason: 'Layout started but no array has modules yet' })
  })
  it('red: an array lies outside every roof area', () => {
    expect(layoutReadiness({ layouts: 1, arraysWithModules: 1, northSet: true, arrayOutsideRoof: true }))
      .toEqual({ status: 'red', reason: 'An array lies outside every roof area' })
  })
  it('green: ≥ 1 array with modules and a north reference', () => {
    expect(layoutReadiness({ layouts: 2, arraysWithModules: 3, northSet: true, arrayOutsideRoof: false }))
      .toEqual({ status: 'green', reason: '3 arrays placed with a north reference' })
  })
})
```

- [ ] **Step 3: Run both to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/summary.test.ts src/solar/layout/readiness.test.ts`
Expected: FAIL — cannot resolve `./summary` / `./readiness`.

- [ ] **Step 4: Implement `summary.ts`**

`packages/shared/src/solar/layout/summary.ts`:

```ts
/**
 * Layout Summary and BOM (functional spec §6.4). Pure.
 *
 * Every metre figure uses the object's OWN pixelsPerMeter snapshot. An object
 * without one (unsaved) is skipped from metre figures but still counted.
 * Utilisation = module plan area / roof plan area — for a flush array on a
 * pitched roof both are foreshortened the same way, so the ratio is the true one.
 */
import { flatToPts, pointInPolygon, polygonArea, pxToM, vertexMean } from './geometry'
import { stringCheck, type DesignConditions } from './strings'
import { isArrayObject, type ArrayObject, type LayoutObject } from './types'

/** Detour allowance for DC home runs (trays, risers). An estimate, labelled as one. */
export const DC_ROUTING_FACTOR = 1.1

export interface LayoutSummary {
  moduleCount: number
  dcKwp: number
  acKw: number
  dcAcRatio: number | null
  modulesByType: Array<{ label: string; count: number; kwp: number }>
  inverterCount: number
  strings: { total: number; pass: number; warn: number; fail: number }
  roofAreaM2: number
  moduleAreaM2: number
  utilisationPct: number | null
  arraysWithModules: number
  arraysOutsideRoof: string[]
  unstrungModules: number
}

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp

export function layoutSummary(objects: LayoutObject[], conditions: DesignConditions): LayoutSummary {
  const arrays = objects.filter(isArrayObject)
  const roofs = objects.filter((o) => o.kind === 'roof')
  const inverters = objects.filter((o) => o.kind === 'inverter')
  const strings = objects.filter((o) => o.kind === 'string')

  const byType = new Map<string, { label: string; count: number; kwp: number }>()
  let moduleCount = 0
  let dcKwp = 0
  let moduleAreaM2 = 0
  for (const a of arrays) {
    const n = a.geometry.modules.length
    moduleCount += n
    const kwp = (n * a.props.module.powerW) / 1000
    dcKwp += kwp
    const label = `${a.props.module.make} ${a.props.module.model}`
    const t = byType.get(label) ?? { label, count: 0, kwp: 0 }
    t.count += n
    t.kwp = round(t.kwp + kwp)
    byType.set(label, t)
    if (a.pixelsPerMeter) for (const q of a.geometry.modules) moduleAreaM2 += polygonArea(pxToM(q, a.pixelsPerMeter))
  }

  let roofAreaM2 = 0
  for (const r of roofs) if (r.pixelsPerMeter && r.kind === 'roof') roofAreaM2 += polygonArea(pxToM(r.geometry.points, r.pixelsPerMeter))

  const acKw = inverters.reduce((s, o) => s + (o.kind === 'inverter' ? o.props.inverter.acKw : 0), 0)

  const roofPolys = roofs.map((r) => (r.kind === 'roof' ? flatToPts(r.geometry.points) : []))
  const arraysOutsideRoof = arrays
    .filter((a) => a.geometry.modules.some((q) => !roofPolys.some((poly) => pointInPolygon(vertexMean(flatToPts(q)), poly))))
    .map((a) => a.id)

  const arrayById = new Map<string, ArrayObject>(arrays.map((a) => [a.id, a]))
  const inverterById = new Map(inverters.map((o) => [o.id, o]))
  const counts = { total: 0, pass: 0, warn: 0, fail: 0 }
  const perMppt = new Map<string, number>()
  for (const s of strings) if (s.kind === 'string') perMppt.set(`${s.props.inverterId}#${s.props.mppt}`, (perMppt.get(`${s.props.inverterId}#${s.props.mppt}`) ?? 0) + 1)
  const strung = new Set<string>()
  for (const s of strings) {
    if (s.kind !== 'string') continue
    counts.total++
    for (const m of s.props.modules) strung.add(`${m.arrayId}#${m.index}`)
    const inv = inverterById.get(s.props.inverterId)
    const first = s.props.modules[0] ? arrayById.get(s.props.modules[0].arrayId) : undefined
    if (!inv || inv.kind !== 'inverter' || !first || s.props.modules.length === 0) { counts.fail++; continue }
    const r = stringCheck(first.props.module, inv.props.inverter, s.props.modules.length,
      perMppt.get(`${s.props.inverterId}#${s.props.mppt}`) ?? 1, first.props.mounting, conditions)
    if (!r.ok) counts.fail++
    else if (r.checks.some((c) => c.status === 'warn')) counts.warn++
    else counts.pass++
  }
  let unstrungModules = 0
  for (const a of arrays) for (let i = 0; i < a.geometry.modules.length; i++) if (!strung.has(`${a.id}#${i}`)) unstrungModules++

  return {
    moduleCount,
    dcKwp: round(dcKwp),
    acKw: round(acKw),
    dcAcRatio: acKw > 0 ? round(dcKwp / acKw, 9) : null,
    modulesByType: [...byType.values()],
    inverterCount: inverters.length,
    strings: counts,
    roofAreaM2: round(roofAreaM2),
    moduleAreaM2: round(moduleAreaM2),
    utilisationPct: roofAreaM2 > 0 ? (round(moduleAreaM2) / round(roofAreaM2)) * 100 : null,
    arraysWithModules: arrays.filter((a) => a.geometry.modules.length > 0).length,
    arraysOutsideRoof,
    unstrungModules,
  }
}

/** What solar.layouts.summary stores (00211): the list and readiness read it without loading geometry. */
export interface StoredLayoutSummary {
  moduleCount: number
  dcKwp: number
  acKw: number
  arraysWithModules: number
  arrayOutsideRoof: boolean
  stringsFail: number
}

export function storedSummary(s: LayoutSummary): StoredLayoutSummary {
  return {
    moduleCount: s.moduleCount,
    dcKwp: s.dcKwp,
    acKw: s.acKw,
    arraysWithModules: s.arraysWithModules,
    arrayOutsideRoof: s.arraysOutsideRoof.length > 0,
    stringsFail: s.strings.fail,
  }
}

export interface BomRow {
  item: string
  description: string
  quantity: number
  unit: string
}

export function layoutBom(objects: LayoutObject[], summary: LayoutSummary): BomRow[] {
  const rows: BomRow[] = summary.modulesByType.map((t) => ({ item: 'Module', description: t.label, quantity: t.count, unit: 'ea' }))
  const invs = new Map<string, number>()
  for (const o of objects) if (o.kind === 'inverter') {
    const label = `${o.props.inverter.make} ${o.props.inverter.model}`
    invs.set(label, (invs.get(label) ?? 0) + 1)
  }
  for (const [label, n] of invs) rows.push({ item: 'Inverter', description: label, quantity: n, unit: 'ea' })

  const arrays = objects.filter(isArrayObject)
  const racked = arrays.filter((a) => a.props.mounting === 'racked').reduce((s, a) => s + a.geometry.modules.length, 0)
  const flushRailM = arrays.filter((a) => a.props.mounting === 'flush')
    .reduce((s, a) => s + a.geometry.modules.length * 2 * ((a.props.orientation === 'portrait' ? a.props.module.widthM : a.props.module.lengthM) + a.props.gapM), 0)
  if (racked > 0) rows.push({ item: 'Mounting', description: 'Racking positions (estimate)', quantity: racked, unit: 'ea' })
  if (flushRailM > 0) rows.push({ item: 'Mounting', description: 'Flush rail, two rails per module row (estimate)', quantity: round(flushRailM, 2), unit: 'm' })

  const arrayById = new Map(arrays.map((a) => [a.id, a]))
  const invById = new Map(objects.filter((o) => o.kind === 'inverter').map((o) => [o.id, o]))
  let dcM = 0
  for (const s of objects) {
    if (s.kind !== 'string') continue
    const inv = invById.get(s.props.inverterId)
    const pts = s.props.modules.flatMap((m) => {
      const a = arrayById.get(m.arrayId)
      const q = a?.geometry.modules[m.index]
      return a && q && a.pixelsPerMeter ? [vertexMean(pxToM(q, a.pixelsPerMeter))] : []
    })
    if (!inv || inv.kind !== 'inverter' || !inv.pixelsPerMeter || pts.length === 0) continue
    const c = vertexMean(pts)
    const ip = { x: inv.geometry.x / inv.pixelsPerMeter, y: inv.geometry.y / inv.pixelsPerMeter }
    dcM += (Math.abs(c.x - ip.x) + Math.abs(c.y - ip.y)) * 2 * DC_ROUTING_FACTOR
  }
  if (dcM > 0) rows.push({ item: 'DC cable', description: 'String home runs, + and −, Manhattan route × 1.1 (estimate)', quantity: round(dcM, 2), unit: 'm' })
  return rows
}

function csvField(v: string | number): string {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function bomToCsv(rows: BomRow[]): string {
  const lines = [['Item', 'Description', 'Quantity', 'Unit'], ...rows.map((r) => [r.item, r.description, r.quantity, r.unit])]
  return lines.map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n'
}
```

- [ ] **Step 5: Implement `readiness.ts`**

`packages/shared/src/solar/layout/readiness.ts`:

```ts
/**
 * The Layout step of the readiness checklist (functional spec, readiness
 * table: green ≥ 1 array with ≥ 1 module and a north reference; amber layout
 * started but no north reference; red an array lies outside every roof area).
 * Input is aggregated from solar.layouts.summary and solar.roof_sources, so
 * no geometry is loaded to render a tab dot.
 */
import type { ReadinessStatus } from '../readiness'

export interface LayoutReadinessInput {
  layouts: number
  arraysWithModules: number
  northSet: boolean
  arrayOutsideRoof: boolean
}

export function layoutReadiness(l: LayoutReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!l || l.layouts === 0) return { status: 'grey', reason: 'Not started' }
  if (l.arrayOutsideRoof) return { status: 'red', reason: 'An array lies outside every roof area' }
  if (!l.northSet) return { status: 'amber', reason: 'Layout started but no north reference' }
  if (l.arraysWithModules === 0) return { status: 'amber', reason: 'Layout started but no array has modules yet' }
  return {
    status: 'green',
    reason: `${l.arraysWithModules} array${l.arraysWithModules === 1 ? '' : 's'} placed with a north reference`,
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/summary.test.ts src/solar/layout/readiness.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/solar/layout/summary.ts packages/shared/src/solar/layout/summary.test.ts packages/shared/src/solar/layout/readiness.ts packages/shared/src/solar/layout/readiness.test.ts
git commit -m "feat(solar-layout): summary, BOM CSV and the Layout readiness step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Satellite tile maths and payload validation

**Files:**
- Create: `packages/shared/src/solar/layout/satellite.ts`
- Create: `packages/shared/src/solar/layout/validate.ts`
- Test: `packages/shared/src/solar/layout/satellite.test.ts`
- Test: `packages/shared/src/solar/layout/validate.test.ts`

- [ ] **Step 1: Write the failing satellite tests**

Hand check: Web-Mercator 512-px tiles, `m/px = 40 075 016.686 · cos(lat) / (512 · 2^zoom)`, halved for `@2x`. At the equator, zoom 0, 1×: 78 271.517 m/px. At −26.2°, zoom 19, @2x: 0.0669763 m/px (a 2560-px image covers ≈ 171 m).

`packages/shared/src/solar/layout/satellite.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { metresPerPixel, mapboxStaticUrl, SATELLITE_CAPTURE, MAPBOX_ATTRIBUTION, clampSatelliteZoom } from './satellite'

describe('satellite capture maths (D-08)', () => {
  it('equator, zoom 0, standard resolution', () => {
    expect(metresPerPixel(0, 0, false)).toBeCloseTo(78271.517, 3)
  })
  it('Johannesburg, zoom 19, @2x (hand-checked)', () => {
    expect(metresPerPixel(-26.2, 19, true)).toBeCloseTo(0.0669763, 7)
  })
  it('the capture is 1280 × 1280 @2x = 2560 px, north up', () => {
    expect(SATELLITE_CAPTURE).toMatchObject({ width: 1280, height: 1280, retina: true, defaultZoom: 19 })
    expect(SATELLITE_CAPTURE.pixelSize).toBe(2560)
  })
  it('clamps the zoom to what the capture allows', () => {
    expect(clampSatelliteZoom(25)).toBe(20)
    expect(clampSatelliteZoom(3)).toBe(16)
    expect(clampSatelliteZoom(18.6)).toBe(19)
  })
  it('builds the static-image URL with bearing 0, pitch 0 and the token encoded', () => {
    expect(mapboxStaticUrl({ lat: -26.2, lng: 28.05, zoom: 19, token: 'pk.a/b' })).toBe(
      'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/28.05,-26.2,19,0,0/1280x1280@2x?access_token=pk.a%2Fb&attribution=true&logo=true',
    )
  })
  it('attribution text is WinAnsi-printable (© is 0xA9)', () => {
    expect(MAPBOX_ATTRIBUTION).toBe('© Mapbox © OpenStreetMap © Maxar')
  })
})
```

- [ ] **Step 2: Write the failing validation tests**

`packages/shared/src/solar/layout/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateObjectInput, moduleSpecError, inverterSpecError, MAX_MODULES_PER_ARRAY } from './validate'
import { GENERIC_MODULE_550 as M, GENERIC_INVERTER_50KW as INV } from './types'

const ID = '11111111-1111-4111-8111-111111111111'
const roofProps = { name: 'Main', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null }
const arrayProps = { roofId: ID, module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 }

describe('validateObjectInput', () => {
  it('accepts a well-formed roof, array, inverter, string and equipment', () => {
    expect(validateObjectInput({ id: ID, kind: 'roof', geometry: { points: [0, 0, 10, 0, 10, 10] }, props: roofProps })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: [[0, 0, 1, 0, 1, 1, 0, 1]] }, props: arrayProps })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'inverter', geometry: { x: 1, y: 2 }, props: { name: 'INV', inverter: INV } })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'string', geometry: {}, props: { inverterId: ID, mppt: 1, modules: [{ arrayId: ID, index: 0 }] } })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'equipment', geometry: { x: 1, y: 2 }, props: { equipmentKind: 'db', name: 'DB-1', nodeId: ID } })).toBeNull()
  })
  it('refuses with a sentence, never a TypeError', () => {
    expect(validateObjectInput(null)).toBe('An object in the layout is malformed.')
    expect(validateObjectInput({ id: 'x', kind: 'roof', geometry: { points: [] }, props: roofProps })).toBe('An object in the layout has an invalid id.')
    expect(validateObjectInput({ id: ID, kind: 'wall', geometry: {}, props: {} })).toBe('An object in the layout has an unknown kind.')
    expect(validateObjectInput({ id: ID, kind: 'north', geometry: {}, props: {} })).toBe('North is set on the roof source, not drawn as an object.')
    expect(validateObjectInput({ id: ID, kind: 'roof', geometry: { points: [0, 0, 10, 0] }, props: roofProps })).toBe('A roof outline needs at least three points.')
    expect(validateObjectInput({ id: ID, kind: 'roof', geometry: { points: [0, 0, 10, 0, 10, Number.NaN] }, props: roofProps })).toBe('A roof outline has a point that is not a number.')
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: [[0, 0, 1]] }, props: arrayProps })).toBe('Every module needs four corners.')
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: Array.from({ length: MAX_MODULES_PER_ARRAY + 1 }, () => [0, 0, 1, 0, 1, 1, 0, 1]) }, props: arrayProps }))
      .toBe(`An array can hold at most ${MAX_MODULES_PER_ARRAY} modules; split it.`)
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: [] }, props: { ...arrayProps, module: { ...M, powerW: 0 } } })).toBe('The module needs a positive power rating.')
    expect(validateObjectInput({ id: ID, kind: 'string', geometry: {}, props: { inverterId: ID, mppt: 0, modules: [] } })).toBe('A string must sit on MPPT 1 or higher.')
    expect(validateObjectInput({ id: ID, kind: 'obstruction', geometry: { cx: 1, cy: 1, r: -1 }, props: { name: 'x', setbackM: 0, heightM: 0 } })).toBe('A circular obstruction needs a positive radius.')
  })
  it('spec checks are usable on their own (New layout dialog)', () => {
    expect(moduleSpecError(M)).toBeNull()
    expect(moduleSpecError({ ...M, vocStc: 'x' })).toBe('The module datasheet figures must be numbers.')
    expect(inverterSpecError(INV)).toBeNull()
    expect(inverterSpecError({ ...INV, mppts: 0 })).toBe('The inverter needs at least one MPPT.')
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/satellite.test.ts src/solar/layout/validate.test.ts`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 4: Implement `satellite.ts`**

`packages/shared/src/solar/layout/satellite.ts`:

```ts
/**
 * Satellite roof capture (functional spec §3.2 C, decision D-08: keep Mapbox).
 *
 * The server fetches ONE Static Images API picture, north up (bearing 0, pitch
 * 0), stores it, and records metres-per-pixel from the tile maths below — so a
 * satellite roof source has a scale without calibration. Mapbox's attribution
 * and logo stay IN the image (attribution=true&logo=true) and the text is also
 * stored and printed on every exported sheet.
 */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.686
export const MAPBOX_TILE_SIZE = 512

export const SATELLITE_CAPTURE = {
  style: 'mapbox/satellite-v9',
  width: 1280,
  height: 1280,
  retina: true,
  pixelSize: 2560,
  minZoom: 16,
  maxZoom: 20,
  defaultZoom: 19,
} as const

export const MAPBOX_ATTRIBUTION = '© Mapbox © OpenStreetMap © Maxar'

export function metresPerPixel(latDeg: number, zoom: number, retina: boolean): number {
  const mpp = (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180)) / (MAPBOX_TILE_SIZE * 2 ** zoom)
  return retina ? mpp / 2 : mpp
}

export function clampSatelliteZoom(zoom: number): number {
  return Math.min(SATELLITE_CAPTURE.maxZoom, Math.max(SATELLITE_CAPTURE.minZoom, Math.round(zoom)))
}

export function mapboxStaticUrl(i: { lat: number; lng: number; zoom: number; token: string }): string {
  const c = SATELLITE_CAPTURE
  return `https://api.mapbox.com/styles/v1/${c.style}/static/${i.lng},${i.lat},${i.zoom},0,0/${c.width}x${c.height}${c.retina ? '@2x' : ''}` +
    `?access_token=${encodeURIComponent(i.token)}&attribution=true&logo=true`
}
```

- [ ] **Step 5: Implement `validate.ts`**

`packages/shared/src/solar/layout/validate.ts`:

```ts
/**
 * Shape check for one layout object on its way to solar_save_layout_objects
 * (00211). Server actions are directly invocable, so a malformed body must get
 * a sentence, never a TypeError or a raw Postgres error. The database still
 * binds everything that matters (scale, anchor, project); this only refuses
 * garbage early. Returns null when valid.
 */
import { LAYOUT_OBJECT_KINDS, type LayoutObjectKind } from './types'

export const MAX_MODULES_PER_ARRAY = 5000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const allFinite = (a: unknown): a is number[] => Array.isArray(a) && a.every(finite)

/** Exported for the New layout dialog and createLayoutAction (5-ii). */
export function moduleSpecError(m: unknown): string | null {
  if (!isRec(m)) return 'The module specification is missing.'
  if (!(finite(m.lengthM) && m.lengthM > 0 && finite(m.widthM) && m.widthM > 0)) return 'The module needs a positive size.'
  if (!(finite(m.powerW) && m.powerW > 0)) return 'The module needs a positive power rating.'
  for (const k of ['vocStc', 'vmpStc', 'iscStc', 'betaVocPerC', 'gammaVmpPerC']) if (!finite(m[k])) return 'The module datasheet figures must be numbers.'
  return null
}

export function inverterSpecError(v: unknown): string | null {
  if (!isRec(v)) return 'The inverter specification is missing.'
  if (!(finite(v.acKw) && v.acKw > 0)) return 'The inverter needs a positive AC rating.'
  if (!(Number.isInteger(v.mppts) && (v.mppts as number) >= 1)) return 'The inverter needs at least one MPPT.'
  for (const k of ['vDcMax', 'vMpptMin', 'vMpptMax', 'iMpptMax']) if (!(finite(v[k]) && (v[k] as number) > 0)) return 'The inverter datasheet figures must be positive numbers.'
  return null
}

export function validateObjectInput(o: unknown): string | null {
  if (!isRec(o) || !isRec(o.geometry) || !isRec(o.props)) return 'An object in the layout is malformed.'
  if (typeof o.id !== 'string' || !UUID.test(o.id)) return 'An object in the layout has an invalid id.'
  if (!(LAYOUT_OBJECT_KINDS as readonly string[]).includes(String(o.kind))) return 'An object in the layout has an unknown kind.'
  const kind = o.kind as LayoutObjectKind
  const g = o.geometry
  const p = o.props
  switch (kind) {
    case 'north':
      return 'North is set on the roof source, not drawn as an object.'
    case 'roof': {
      if (!Array.isArray(g.points) || g.points.length < 6 || g.points.length % 2 !== 0) return 'A roof outline needs at least three points.'
      if (!allFinite(g.points)) return 'A roof outline has a point that is not a number.'
      if (!(finite(p.setbackM) && p.setbackM >= 0)) return 'A roof needs an edge setback of 0 m or more.'
      if (!(finite(p.pitchDeg) && p.pitchDeg >= 0 && p.pitchDeg < 90)) return 'A roof pitch must be between 0° and 90°.'
      return null
    }
    case 'obstruction': {
      if ('r' in g) {
        if (!(finite(g.cx) && finite(g.cy) && finite(g.r) && g.r > 0)) return 'A circular obstruction needs a positive radius.'
      } else if (!Array.isArray(g.points) || g.points.length < 6 || !allFinite(g.points)) {
        return 'An obstruction outline needs at least three points.'
      }
      if (!(finite(p.setbackM) && p.setbackM >= 0)) return 'An obstruction needs a setback of 0 m or more.'
      return null
    }
    case 'array':
    case 'module_block': {
      if (!Array.isArray(g.modules)) return 'An array needs a module list.'
      if (g.modules.length > MAX_MODULES_PER_ARRAY) return `An array can hold at most ${MAX_MODULES_PER_ARRAY} modules; split it.`
      if (!g.modules.every((q) => Array.isArray(q) && q.length === 8 && allFinite(q))) return 'Every module needs four corners.'
      const me = moduleSpecError(p.module)
      if (me) return me
      if (typeof p.roofId !== 'string' || !UUID.test(p.roofId)) return 'An array must belong to a roof.'
      if (!(finite(p.tiltDeg) && p.tiltDeg >= 0 && p.tiltDeg < 90)) return 'An array tilt must be between 0° and 90°.'
      return null
    }
    case 'inverter':
    case 'equipment': {
      if (!finite(g.x) || !finite(g.y)) return 'A symbol needs a position.'
      if (kind === 'inverter') return inverterSpecError(p.inverter)
      if (!['battery', 'db', 'combiner'].includes(String(p.equipmentKind))) return 'Equipment must be a battery, DB or combiner.'
      if (p.nodeId !== null && (typeof p.nodeId !== 'string' || !UUID.test(p.nodeId))) return 'A DB symbol links to a board by its id.'
      return null
    }
    case 'string': {
      if (typeof p.inverterId !== 'string' || !UUID.test(p.inverterId)) return 'A string must belong to an inverter.'
      if (!(Number.isInteger(p.mppt) && (p.mppt as number) >= 1)) return 'A string must sit on MPPT 1 or higher.'
      if (!Array.isArray(p.modules) || !p.modules.every((m) => isRec(m) && typeof m.arrayId === 'string' && UUID.test(m.arrayId) && Number.isInteger(m.index) && (m.index as number) >= 0)) {
        return 'A string lists its modules by array and position.'
      }
      return null
    }
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/layout/satellite.test.ts src/solar/layout/validate.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/solar/layout/satellite.ts packages/shared/src/solar/layout/satellite.test.ts packages/shared/src/solar/layout/validate.ts packages/shared/src/solar/layout/validate.test.ts
git commit -m "feat(solar-layout): satellite tile maths (D-08) and object payload validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Barrel exports and readiness wiring

**Files:**
- Create: `packages/shared/src/solar/layout/index.ts`
- Modify: `packages/shared/src/solar/index.ts` (append one line)
- Modify: `packages/shared/src/solar/readiness.ts:100-107` (`computeSolarReadiness`)
- Test: `packages/shared/src/solar/readiness.test.ts` (append)

- [ ] **Step 1: Write the failing readiness test (append to the existing file)**

Append to `packages/shared/src/solar/readiness.test.ts`:

```ts
describe('computeSolarReadiness — Layout step (Phase 5)', () => {
  const site = { latitude: -26, longitude: 28, licenseeName: 'City Power', nmdKva: 400 }
  it('without layout input the Layout step stays grey, as before', () => {
    const step = computeSolarReadiness(site, 'edit').find((s) => s.slug === 'layout')
    expect(step?.status).toBe('grey')
  })
  it('with layout input it reports the layout rule', () => {
    const step = computeSolarReadiness(site, 'edit', { layouts: 1, arraysWithModules: 1, northSet: false, arrayOutsideRoof: false })
      .find((s) => s.slug === 'layout')
    expect(step).toMatchObject({ status: 'amber', reason: 'Layout started but no north reference' })
  })
})
```

(`computeSolarReadiness` is already imported at the top of that file; if the import line lacks it, add it to the existing `import { … } from './readiness'`.)

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/readiness.test.ts`
Expected: FAIL — the second test reports `grey` (the third argument is ignored).

- [ ] **Step 3: Create the barrel and export it**

`packages/shared/src/solar/layout/index.ts`:

```ts
export * from './types'
export * from './geometry'
export * from './orientation'
export * from './row-pitch'
export * from './footprint'
export * from './packing'
export * from './strings'
export * from './summary'
export * from './readiness'
export * from './satellite'
export * from './validate'
```

Append to `packages/shared/src/solar/index.ts`:

```ts
export * from './layout'
```

- [ ] **Step 4: Wire readiness**

In `packages/shared/src/solar/readiness.ts`, add the import at the top (after the existing imports):

```ts
import { layoutReadiness, type LayoutReadinessInput } from './layout/readiness'
```

and replace `computeSolarReadiness` (currently lines 100-107) with:

```ts
export function computeSolarReadiness(
  site: SiteReadinessInput | null,
  level: SolarAccessLevel,
  layout?: LayoutReadinessInput | null,
): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      // The Layout step is live once the tab is built (5-ii flips SOLAR_TABS); its
      // status is only computed when the caller passes the aggregate.
      if (t.slug === 'layout' && layout !== undefined) return { slug: t.slug, label: t.label, live: t.built, ...layoutReadiness(layout) }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
```

- [ ] **Step 5: Run the shared suite and type-check**

Run: `pnpm --filter @esite/shared test && pnpm --filter @esite/shared type-check`
Expected: PASS, 0 type errors. (A name collision between `solar/layout` exports and existing root exports would show here as `TS2308`; rename the layout export, not the existing one.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/solar/layout/index.ts packages/shared/src/solar/index.ts packages/shared/src/solar/readiness.ts packages/shared/src/solar/readiness.test.ts
git commit -m "feat(solar-layout): export the layout modules and feed the Layout readiness step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Behavioural assertions for 00211 — written first, run RED

**Files:**
- Create: `scripts/db/assert-solar-layouts-roles.sql`

- [ ] **Step 1: Write the assertion file**

`scripts/db/assert-solar-layouts-roles.sql`:

```sql
-- BEHAVIOURAL assertions for 00211_solar_layouts, run as real roles.
--   S=$(mktemp -d)
--   cat apps/edge-functions/supabase/migrations/00207_solar_foundation.sql \
--       apps/edge-functions/supabase/migrations/00208_solar_org_settings.sql > "$S/base.sql"
--   scripts/db/dry-run-migration.sh "$S/base.sql" scripts/db/assert-solar-layouts-roles.sql          (expect RED)
--   cat "$S/base.sql" apps/edge-functions/supabase/migrations/00211_solar_layouts.sql > "$S/combo.sql"
--   scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-solar-layouts-roles.sql         (expect GREEN)
-- (Once 00207/00208 are in the ledger, use 00211 alone and /tmp/noop.sql for the red run.)
-- Fixtures are minted inside the transaction and rolled back; WM-Consulting is
-- not used (it bypasses the paywall, so it has no negative case).
-- REFUSAL PATTERN (as 00207's file): a "…_REFUSED" check catches only the
-- SQLSTATE the design promises; if the statement is wrongly allowed the block
-- raises P0001 itself so the write is rolled back and later checks still run.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p1      UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- org admin: grantor, implicit edit_financials
  v_editor  UUID := gen_random_uuid();   -- contractor with an EDIT grant on P1
  v_viewer  UUID := gen_random_uuid();   -- project_manager with a VIEW grant on P1
  v_nogrant UUID := gen_random_uuid();   -- contractor, project member, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on P1
  v_foreign UUID := gen_random_uuid();   -- admin of another org
  v_fp1     UUID := gen_random_uuid();   -- P1 drawing, page 1 scale 50 px/m, page 2 scale 25
  v_fp2     UUID := gen_random_uuid();   -- P2 drawing
  v_fp3     UUID := gen_random_uuid();   -- P1 drawing, uncalibrated
  v_node1   UUID := gen_random_uuid();
  v_node2   UUID := gen_random_uuid();
  v_s1      UUID := gen_random_uuid();
  v_s2      UUID := gen_random_uuid();
  v_rs1     UUID := gen_random_uuid();
  v_rs2     UUID := gen_random_uuid();
  v_rs3     UUID := gen_random_uuid();
  v_rs_p2   UUID := gen_random_uuid();
  v_l1      UUID := gen_random_uuid();
  v_l2      UUID := gen_random_uuid();
  v_l3      UUID := gen_random_uuid();
  v_l_p2    UUID := gen_random_uuid();
  v_o_roof  UUID := gen_random_uuid();
  v_o_arr   UUID := gen_random_uuid();
  v_o_new   UUID := gen_random_uuid();
  v_t0      TIMESTAMPTZ;
  v_t1      TIMESTAMPTZ;
  v_t2      TIMESTAMPTZ;
  v_n       INT;
  v_num     NUMERIC;
  u         UUID;
  c_roof    JSONB;
  c_arr     JSONB;
BEGIN
  -- ── Fixtures (as postgres, before any impersonation) ─────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-layout-probe-org'), (v_org2, 'solar-layout-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_editor, v_viewer, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-layout-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_editor, v_org, 'contractor', TRUE), (v_viewer, v_org, 'project_manager', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p1, v_org, 'solar-layout-probe-p1', v_admin), (v_p2, v_org, 'solar-layout-probe-p2', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p1, v_editor, v_org, 'contractor', TRUE), (v_p1, v_viewer, v_org, 'project_manager', TRUE),
    (v_p1, v_nogrant, v_org, 'contractor', TRUE), (v_p1, v_client, v_org, 'client_viewer', TRUE),
    (v_p2, v_editor, v_org, 'contractor', TRUE);
  INSERT INTO structure.nodes (id, project_id, organisation_id, kind, code) VALUES
    (v_node1, v_p1, v_org, 'main_board', 'SOLAR-LAYOUT-MB1'), (v_node2, v_p2, v_org, 'main_board', 'SOLAR-LAYOUT-MB2');
  INSERT INTO tenants.floor_plans (id, organisation_id, project_id, name, file_path, uploaded_by, pixels_per_meter, source_revision_id) VALUES
    (v_fp1, v_org, v_p1, 'Roof plan', 'probe/p1/roof-v1.pdf', v_admin, 50, 'rev-1'),
    (v_fp2, v_org, v_p2, 'Other roof', 'probe/p2/roof.pdf', v_admin, 40, NULL),
    (v_fp3, v_org, v_p1, 'Uncalibrated', 'probe/p1/uncal.pdf', v_admin, NULL, NULL);
  INSERT INTO tenants.floor_plan_page_scales (floor_plan_id, page_index, organisation_id, pixels_per_meter) VALUES (v_fp1, 2, v_org, 25);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
    VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO solar.studies (id, project_id) VALUES (v_s1, v_p1), (v_s2, v_p2);
  -- A saved layout sheet on P1, for the report read gate.
  INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p1, 'solar_layout_sheet', 'probe sheet', 'probe/p1/sheet.pdf', 'issued', 1);

  c_roof := jsonb_build_object('id', v_o_roof, 'kind', 'roof',
    'geometry', jsonb_build_object('points', jsonb_build_array(0, 0, 1000, 0, 1000, 600, 0, 600)),
    'props', jsonb_build_object('name', 'Main roof'),
    'pixels_per_meter', 999);   -- a forged scale: must be ignored
  c_arr := jsonb_build_object('id', v_o_arr, 'kind', 'array',
    'geometry', jsonb_build_object('modules', jsonb_build_array(jsonb_build_array(50, 50, 107, 50, 107, 160, 50, 160))),
    'props', '{}'::jsonb);

  -- ── Grants (as the org admin, through 00207's own path) ──────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_p1, v_editor, 'edit'), (v_p1, v_viewer, 'view'), (v_p2, v_editor, 'edit');
  RESET ROLE;

  -- ── 1. Roof sources: anchor stamped from the drawing, org bound ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id, page_index, file_path, source_revision_id, organisation_id)
    VALUES (v_rs1, v_s1, 'drawing', v_fp1, 1, 'forged/path.pdf', 'forged-rev', v_org2);
  SELECT count(*) INTO v_n FROM solar.roof_sources
   WHERE id = v_rs1 AND organisation_id = v_org AND project_id = v_p1 AND file_path = 'probe/p1/roof-v1.pdf' AND source_revision_id = 'rev-1';
  INSERT INTO _r VALUES ('roof_source_anchor_and_org_bound', v_n = 1);
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id, page_index) VALUES (v_rs2, v_s1, 'drawing', v_fp1, 2);
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id, page_index) VALUES (v_rs3, v_s1, 'drawing', v_fp3, 1);

  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, floor_plan_id) VALUES (v_s1, 'drawing', v_fp2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('roof_source_foreign_drawing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('roof_source_foreign_drawing_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, floor_plan_id, page_index) VALUES (v_s1, 'drawing', v_fp1, 1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('roof_source_duplicate_page_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('roof_source_duplicate_page_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, storage_path, m_per_px) VALUES (v_s1, 'satellite', v_org || '/' || v_p1 || '/sat.png', 0.067);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('satellite_without_attribution_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('satellite_without_attribution_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, storage_path, m_per_px, attribution) VALUES (v_s1, 'satellite', v_org2 || '/' || v_p1 || '/sat.png', 0.067, '© Mapbox');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('satellite_foreign_storage_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('satellite_foreign_storage_path_REFUSED', false);
  END;
  INSERT INTO solar.roof_sources (study_id, kind, storage_path, m_per_px, attribution) VALUES (v_s1, 'satellite', v_org || '/' || v_p1 || '/sat.png', 0.067, '© Mapbox');
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE study_id = v_s1 AND kind = 'satellite' AND north_bearing_deg = 0;
  INSERT INTO _r VALUES ('satellite_defaults_north_up', v_n = 1);
  UPDATE solar.roof_sources SET north_bearing_deg = 12.5 WHERE id = v_rs1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('editor_sets_north', v_n = 1);
  BEGIN
    UPDATE solar.roof_sources SET page_index = 2 WHERE id = v_rs1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('roof_source_sheet_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('roof_source_sheet_immutable_REFUSED', false);
  END;
  UPDATE solar.roof_sources SET file_path = 'forged.pdf' WHERE id = v_rs1;
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE id = v_rs1 AND file_path = 'probe/p1/roof-v1.pdf';
  INSERT INTO _r VALUES ('roof_source_anchor_pinned_on_update', v_n = 1);

  -- ── 2. Layouts ────────────────────────────────────────────────────────────
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec, organisation_id)
    VALUES (v_l1, v_s1, v_rs1, 'Option A', '{"make":"x"}'::jsonb, v_org2);
  SELECT count(*) INTO v_n FROM solar.layouts WHERE id = v_l1 AND organisation_id = v_org AND project_id = v_p1;
  INSERT INTO _r VALUES ('layout_org_bound', v_n = 1);
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec) VALUES (v_l2, v_s1, v_rs2, 'Page two', '{}'::jsonb);
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec) VALUES (v_l3, v_s1, v_rs3, 'Uncalibrated', '{}'::jsonb);
  BEGIN
    INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_s1, v_rs1, '  option a ', '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('layout_name_unique_per_study_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_name_unique_per_study_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.layouts SET roof_source_id = v_rs2 WHERE id = v_l1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('layout_roof_source_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_roof_source_immutable_REFUSED', false);
  END;
  RESET ROLE;
  -- a roof source of ANOTHER study (P2), made as postgres, cannot carry a P1 layout
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id) VALUES (v_rs_p2, v_s2, 'drawing', v_fp2);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_s1, v_rs_p2, 'Cross', '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('layout_foreign_roof_source_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_foreign_roof_source_REFUSED', false);
  END;

  -- ── 3. Saving objects: scale and anchor stamped by the database ──────────
  SELECT updated_at INTO v_t0 FROM solar.layouts WHERE id = v_l1;
  BEGIN
    v_t1 := public.solar_save_layout_objects(v_l1, v_t0, jsonb_build_array(c_roof, c_arr), ARRAY[]::uuid[], '{"moduleCount":1}'::jsonb);
    INSERT INTO _r VALUES ('editor_saves_objects', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_saves_objects', false);
  END;
  SELECT count(*) INTO v_n FROM solar.layout_objects
   WHERE layout_id = v_l1 AND pixels_per_meter = 50 AND floor_plan_id = v_fp1 AND page_index = 1 AND project_id = v_p1 AND organisation_id = v_org;
  INSERT INTO _r VALUES ('objects_scale_and_anchor_stamped', v_n = 2);
  INSERT INTO _r VALUES ('save_returns_a_newer_token', v_t1 IS NOT NULL AND v_t1 > v_t0);
  SELECT count(*) INTO v_n FROM solar.layouts WHERE id = v_l1 AND summary->>'moduleCount' = '1' AND updated_at = v_t1;
  INSERT INTO _r VALUES ('summary_and_token_saved_together', v_n = 1);
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t0, '[]'::jsonb, ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('stale_save_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('stale_save_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('stale_save_changed_nothing', v_n = 2);
  -- page 2 takes its own page scale
  SELECT updated_at INTO v_t2 FROM solar.layouts WHERE id = v_l2;
  PERFORM public.solar_save_layout_objects(v_l2, v_t2,
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'roof', 'geometry', jsonb_build_object('points', jsonb_build_array(0, 0, 10, 0, 10, 10)), 'props', '{}'::jsonb)),
    ARRAY[]::uuid[], '{}'::jsonb);
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l2 AND pixels_per_meter = 25 AND page_index = 2;
  INSERT INTO _r VALUES ('page_two_uses_its_page_scale', v_n = 1);
  -- an uncalibrated page refuses objects
  SELECT updated_at INTO v_t2 FROM solar.layouts WHERE id = v_l3;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l3, v_t2,
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'roof', 'geometry', jsonb_build_object('points', jsonb_build_array(0, 0, 10, 0, 10, 10)), 'props', '{}'::jsonb)),
      ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('uncalibrated_sheet_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('uncalibrated_sheet_REFUSED', false);
  END;
  -- an object id from another layout cannot be hijacked; kind cannot change
  SELECT updated_at INTO v_t2 FROM solar.layouts WHERE id = v_l2;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l2, v_t2, jsonb_build_array(c_roof), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('cross_layout_object_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('cross_layout_object_REFUSED', false);
  END;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t1, jsonb_build_array(jsonb_set(c_roof, '{kind}', '"obstruction"')), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('object_kind_change_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('object_kind_change_REFUSED', false);
  END;
  -- equipment: a DB symbol must link to a board of THIS project
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t1, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'equipment',
      'geometry', jsonb_build_object('x', 1, 'y', 1), 'props', jsonb_build_object('equipmentKind', 'db', 'name', 'DB', 'nodeId', NULL))), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('free_floating_db_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('free_floating_db_REFUSED', false);
  END;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t1, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'equipment',
      'geometry', jsonb_build_object('x', 1, 'y', 1), 'props', jsonb_build_object('equipmentKind', 'db', 'name', 'DB', 'nodeId', v_node2))), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_board_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_board_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. The scale snapshot survives a recalibration ────────────────────────
  UPDATE tenants.floor_plans SET pixels_per_meter = 100 WHERE id = v_fp1;
  SET LOCAL ROLE authenticated;
  v_t2 := public.solar_save_layout_objects(v_l1, v_t1,
    jsonb_build_array(jsonb_set(c_roof, '{geometry}', jsonb_build_object('points', jsonb_build_array(0, 0, 900, 0, 900, 600, 0, 600))),
                      jsonb_build_object('id', v_o_new, 'kind', 'obstruction', 'geometry', jsonb_build_object('cx', 5, 'cy', 5, 'r', 2), 'props', '{}'::jsonb)),
    ARRAY[v_o_arr], '{}'::jsonb);
  SELECT pixels_per_meter INTO v_num FROM solar.layout_objects WHERE id = v_o_roof;
  INSERT INTO _r VALUES ('object_scale_pinned_on_update', v_num = 50);
  SELECT pixels_per_meter INTO v_num FROM solar.layout_objects WHERE id = v_o_new;
  INSERT INTO _r VALUES ('new_object_takes_current_scale', v_num = 100);
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE id = v_o_arr;
  INSERT INTO _r VALUES ('delete_list_applied', v_n = 0);
  RESET ROLE;

  -- ── 5. View reads; View cannot write ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('viewer_reads_objects', v_n = 2);
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE study_id = v_s1;
  INSERT INTO _r VALUES ('viewer_reads_roof_sources', v_n = 4);
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t2, '[]'::jsonb, ARRAY[v_o_roof], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_save_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_save_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.layout_objects (layout_id, kind, geometry, props) VALUES (v_l1, 'roof', '{"points":[0,0,1,0,1,1]}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_direct_object_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_direct_object_insert_REFUSED', false);
  END;
  UPDATE solar.layouts SET name = 'hijacked' WHERE id = v_l1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_update_affects_nothing', v_n = 0);
  DELETE FROM solar.layout_objects WHERE layout_id = v_l1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_delete_affects_nothing', v_n = 0);
  SELECT count(*) INTO v_n FROM projects.reports WHERE project_id = v_p1 AND kind = 'solar_layout_sheet';
  INSERT INTO _r VALUES ('viewer_reads_layout_sheet', v_n = 1);
  RESET ROLE;

  -- ── 6. No grant, client viewer, foreign admin: nothing ────────────────────
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM solar.roof_sources WHERE study_id = v_s1)
         + (SELECT count(*) FROM solar.layouts WHERE study_id = v_s1)
         + (SELECT count(*) FROM solar.layout_objects WHERE project_id = v_p1)
         + (SELECT count(*) FROM projects.reports WHERE project_id = v_p1 AND kind = 'solar_layout_sheet')
      INTO v_n;
    INSERT INTO _r VALUES ('no_level_reads_nothing_' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END, v_n = 0);
    RESET ROLE;
  END LOOP;

  -- ── 7. Lapse: hidden but kept ──────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('lapsed_editor_sees_nothing', v_n = 0);
  UPDATE solar.layouts SET name = 'while lapsed' WHERE id = v_l1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('lapsed_editor_update_affects_nothing', v_n = 0);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('lapsed_rows_kept', v_n = 2);
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() + interval '1 year' WHERE organisation_id = v_org;

  -- ── 8. Drawing protection and cascades ─────────────────────────────────────
  BEGIN
    DELETE FROM tenants.floor_plans WHERE id = v_fp1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('drawing_delete_with_layout_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('drawing_delete_with_layout_REFUSED', false);
  END;
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec) VALUES (v_l_p2, v_s2, v_rs_p2, 'P2', '{}'::jsonb);
  INSERT INTO solar.layout_objects (layout_id, kind, geometry, props) VALUES (v_l_p2, 'roof', '{"points":[0,0,1,0,1,1]}'::jsonb, '{}'::jsonb);
  BEGIN
    DELETE FROM projects.projects WHERE id = v_p2;
    SELECT count(*) INTO v_n FROM solar.layouts WHERE id = v_l_p2;
    INSERT INTO _r VALUES ('project_delete_cascades_layouts', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('project_delete_cascades_layouts', false);
  END;

  -- ── 9. Service role bypasses (asserted AFTER rows exist); anon refused ────
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('service_role_reads_objects', v_n = 2);
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE floor_plan_id = v_fp1;
  INSERT INTO _r VALUES ('service_role_reads_roof_sources', v_n = 2);
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.layout_objects LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;
  INSERT INTO _r VALUES ('anon_cannot_execute_save',
    NOT has_function_privilege('anon', 'public.solar_save_layout_objects(uuid, timestamptz, jsonb, uuid[], jsonb)', 'EXECUTE'));
  INSERT INTO _r VALUES ('roof_images_bucket_private',
    EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'solar-roof-images' AND public = false));
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Run it RED (no 00211 yet)**

```bash
S=$(mktemp -d)
cat apps/edge-functions/supabase/migrations/00207_solar_foundation.sql \
    apps/edge-functions/supabase/migrations/00208_solar_org_settings.sql > "$S/base.sql"
scripts/db/dry-run-migration.sh "$S/base.sql" scripts/db/assert-solar-layouts-roles.sql
```

Expected: RED — the file aborts (`relation "solar.roof_sources" does not exist`) and the harness reports it as one failed assertion. A check you have never seen fail is decorative.

- [ ] **Step 3: Commit the assertions alone**

```bash
git add scripts/db/assert-solar-layouts-roles.sql
git commit -m "test(solar-layout): behavioural assertions for 00211, red before the migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Migration `00211_solar_layouts.sql` — GREEN, then mutations

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00211_solar_layouts.sql`

- [ ] **Step 1: Write the migration**

`apps/edge-functions/supabase/migrations/00211_solar_layouts.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Migration 00211: Solar layouts on drawings (Solar Phase 5)
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claim it at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR (00209 tariffs and
-- 00210 meter data are claimed by sibling Solar branches). If 00211 is taken,
-- renumber this file and the header of scripts/db/assert-solar-layouts-roles.sql.
-- Claiming a number is not holding it: the head moves when someone APPLIES.
--
-- DEPENDS ON 00207 (schema solar, solar.studies, public.solar_can_view/_edit).
-- While 00207/00208 are not in the ledger, dry runs concatenate 00207 + 00208
-- + 00211.
--
-- Spec: docs/solar/01-functional-spec.md §6 (Layout tab) and §3.2 C (roof
-- sources); 02-calculation-engine-spec.md §3.1-§3.3; 03-data-model-and-
-- security.md §3 (roof_sources, layouts, layout_objects), §3.1 (RLS pattern),
-- §3.2 (solar-roof-images bucket).
--
-- WHAT.
--   1. solar.roof_sources: the sheet a layout is drawn on. A drawing page is
--      anchored like tenants.floor_plan_markups (00205): file_path and
--      source_revision_id are STAMPED from the drawing at creation and pinned,
--      so the page can warn "The drawing has changed since this layout was
--      drawn". A satellite capture carries its own metres-per-pixel and its
--      attribution. North lives here (it belongs to the sheet).
--   2. solar.layouts: named design options per study, bound to one roof source
--      for life (changing it would misalign every object). `summary` is a
--      server-computed cache so the list and readiness never load geometry.
--   3. solar.layout_objects: geometry in IMAGE PIXELS, with the scale stamped by
--      the database at first save and pinned forever after (a recalibration
--      never moves a saved design's metres). floor_plan_id and page_index are
--      denormalised from the roof source so cloud-sync's isAnnotated() can see
--      them with one lookup.
--   4. public.solar_save_layout_objects(): one atomic, stale-refusing save
--      (upserts + deletes + summary). SECURITY INVOKER: RLS decides.
--   5. solar-roof-images: private bucket, read-gated on solar_can_view by the
--      path's project segment; writes only through the service role.
--   6. public.user_can_read_report_kind(): 'solar_layout_sheet' reads follow the
--      Solar level (solar_can_view), not an E-Site role. Mirrored in
--      apps/web/src/lib/reports/report-kind-access.ts SOLAR_READ_REPORT_KINDS.
--
-- DRAWING DELETES. floor_plan_id FKs are NO ACTION (not CASCADE): a stray hard
-- delete of a drawing must not silently destroy a PV design. NO ACTION is
-- checked at the END of the statement, so deleting the whole project (which
-- cascades to both the drawing and the study) still works.
--
-- 00207's schema-wide @verify directives (re-run on every deploy) are honoured:
-- FORCE RLS on each new table; no RESTRICTIVE policy covering SELECT or ALL
-- anywhere in solar; each SECURITY DEFINER function in solar revokes EXECUTE
-- from PUBLIC and anon; solar.studies still has exactly one SELECT policy.
--
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.roof_sources
-- table: solar.layouts
-- table: solar.layout_objects
-- column: solar.layout_objects.floor_plan_id
-- column: solar.layout_objects.pixels_per_meter
-- column: solar.roof_sources.file_path
-- column: solar.layouts.summary
-- constraint: roof_sources_shape ON solar.roof_sources
-- constraint: layouts_name_not_blank ON solar.layouts
-- constraint: layout_objects_kind_check ON solar.layout_objects
-- index: roof_sources_drawing_page_key ON solar.roof_sources
-- index: layouts_study_name_key ON solar.layouts
-- index: layout_objects_layout_idx ON solar.layout_objects
-- index: layout_objects_floor_plan_idx ON solar.layout_objects
-- function: solar.roof_sources_bind()
-- function: solar.layouts_bind()
-- function: solar.layout_objects_bind()
-- function: public.solar_save_layout_objects(uuid, timestamptz, jsonb, uuid[], jsonb)
-- function: public.user_can_read_report_kind(uuid, text)
-- trigger: roof_sources_bind ON solar.roof_sources
-- trigger: layouts_bind ON solar.layouts
-- trigger: layout_objects_bind ON solar.layout_objects
-- policy: roof_sources_select ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_insert ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_update ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_delete ON solar.roof_sources PERMISSIVE
-- policy: roof_sources_insert_authz ON solar.roof_sources RESTRICTIVE
-- policy: roof_sources_update_authz ON solar.roof_sources RESTRICTIVE
-- policy: roof_sources_delete_authz ON solar.roof_sources RESTRICTIVE
-- policy: layouts_select ON solar.layouts PERMISSIVE
-- policy: layouts_insert ON solar.layouts PERMISSIVE
-- policy: layouts_update ON solar.layouts PERMISSIVE
-- policy: layouts_delete ON solar.layouts PERMISSIVE
-- policy: layouts_insert_authz ON solar.layouts RESTRICTIVE
-- policy: layouts_update_authz ON solar.layouts RESTRICTIVE
-- policy: layouts_delete_authz ON solar.layouts RESTRICTIVE
-- policy: layout_objects_select ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_insert ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_update ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_delete ON solar.layout_objects PERMISSIVE
-- policy: layout_objects_insert_authz ON solar.layout_objects RESTRICTIVE
-- policy: layout_objects_update_authz ON solar.layout_objects RESTRICTIVE
-- policy: layout_objects_delete_authz ON solar.layout_objects RESTRICTIVE
-- grant_absent: anon SELECT ON solar.roof_sources
-- grant_absent: anon SELECT ON solar.layouts
-- grant_absent: anon SELECT ON solar.layout_objects
-- grant_absent: anon EXECUTE ON public.solar_save_layout_objects(uuid, timestamptz, jsonb, uuid[], jsonb)
-- grant_absent: anon EXECUTE ON solar.roof_sources_bind()
-- grant_absent: anon EXECUTE ON solar.layouts_bind()
-- grant_absent: anon EXECUTE ON solar.layout_objects_bind()
-- grant_absent: anon EXECUTE ON public.user_can_read_report_kind(uuid, text)
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid IN ('solar.roof_sources'::regclass, 'solar.layouts'::regclass, 'solar.layout_objects'::regclass))
-- sql: (SELECT count(*) = 3 FROM pg_policy WHERE polrelid IN ('solar.roof_sources'::regclass, 'solar.layouts'::regclass, 'solar.layout_objects'::regclass) AND polcmd IN ('r', '*'))
-- sql: (SELECT confdeltype = 'a' FROM pg_constraint WHERE conrelid = 'solar.roof_sources'::regclass AND contype = 'f' AND confrelid = 'tenants.floor_plans'::regclass)
-- sql: (SELECT prosrc LIKE '%solar_layout_sheet%' AND prosrc LIKE '%solar_can_view%' FROM pg_proc WHERE oid = 'public.user_can_read_report_kind(uuid, text)'::regprocedure)
-- sql: EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'solar-roof-images' AND public = false)
-- behaviour: scripts/db/assert-solar-layouts-roles.sql, every row ok
-- @verify:end

-- ── 0. Storage: satellite roof captures (private) ───────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('solar-roof-images', 'solar-roof-images', false, 20971520, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Path: <organisation_id>/<project_id>/<file>. Reads need a Solar level on the
-- project in segment 2; a non-uuid segment reads nothing (never a cast error).
-- No INSERT/UPDATE/DELETE policy: only the service role writes (the capture route).
DROP POLICY IF EXISTS solar_roof_images_select ON storage.objects;
CREATE POLICY solar_roof_images_select ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'solar-roof-images'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.solar_can_view(((storage.foldername(name))[2])::uuid)
    );

-- ── 1. Roof sources ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.roof_sources (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    kind                TEXT NOT NULL CHECK (kind IN ('drawing', 'satellite')),
    floor_plan_id       UUID REFERENCES tenants.floor_plans(id),     -- NO ACTION, see header
    page_index          INTEGER NOT NULL DEFAULT 1 CHECK (page_index >= 1),
    /* The file this sheet was when the roof source was made. Stamped from the
       drawing by the bind trigger and pinned; compared on open (00205 pattern). */
    file_path           TEXT,
    source_revision_id  TEXT,
    storage_path        TEXT,
    m_per_px            NUMERIC CHECK (m_per_px > 0),
    north_bearing_deg   NUMERIC CHECK (north_bearing_deg >= 0 AND north_bearing_deg < 360),
    north_points        JSONB CHECK (north_points IS NULL OR (jsonb_typeof(north_points) = 'array' AND jsonb_array_length(north_points) = 4)),
    attribution         TEXT,
    capture_meta        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capture_meta) = 'object'),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roof_sources_shape CHECK (
        (kind = 'drawing' AND floor_plan_id IS NOT NULL AND file_path IS NOT NULL AND storage_path IS NULL AND m_per_px IS NULL)
        OR (kind = 'satellite' AND floor_plan_id IS NULL AND storage_path IS NOT NULL AND m_per_px IS NOT NULL
            AND attribution IS NOT NULL AND length(btrim(attribution)) > 0)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS roof_sources_drawing_page_key
    ON solar.roof_sources (study_id, floor_plan_id, page_index) WHERE kind = 'drawing';
CREATE INDEX IF NOT EXISTS roof_sources_floor_plan_idx ON solar.roof_sources (floor_plan_id);

CREATE OR REPLACE FUNCTION solar.roof_sources_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_fp_project UUID;
    v_fp_path    TEXT;
    v_fp_rev     TEXT;
    v_fp_active  BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.study_id IS DISTINCT FROM OLD.study_id OR NEW.kind IS DISTINCT FROM OLD.kind
           OR NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id OR NEW.page_index IS DISTINCT FROM OLD.page_index
           OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.m_per_px IS DISTINCT FROM OLD.m_per_px THEN
            RAISE EXCEPTION 'solar.roof_sources: the sheet of a roof source cannot change; add a new roof source instead'
                USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.file_path := OLD.file_path;
        NEW.source_revision_id := OLD.source_revision_id;
        NEW.attribution := OLD.attribution;
        NEW.capture_meta := OLD.capture_meta;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.roof_sources: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        IF NEW.kind = 'drawing' THEN
            SELECT fp.project_id, fp.file_path, fp.source_revision_id, fp.is_active
              INTO v_fp_project, v_fp_path, v_fp_rev, v_fp_active
              FROM tenants.floor_plans fp WHERE fp.id = NEW.floor_plan_id;
            IF v_fp_project IS NULL OR v_fp_project <> NEW.project_id THEN
                RAISE EXCEPTION 'solar.roof_sources: the drawing belongs to another project' USING ERRCODE = '23514';
            END IF;
            IF NOT v_fp_active THEN
                RAISE EXCEPTION 'solar.roof_sources: the drawing is no longer active' USING ERRCODE = '23514';
            END IF;
            NEW.file_path := v_fp_path;
            NEW.source_revision_id := v_fp_rev;
        ELSE
            NEW.file_path := NULL;
            NEW.source_revision_id := NULL;
            IF split_part(COALESCE(NEW.storage_path, ''), '/', 1) <> NEW.organisation_id::text
               OR split_part(COALESCE(NEW.storage_path, ''), '/', 2) <> NEW.project_id::text THEN
                RAISE EXCEPTION 'solar.roof_sources: the satellite image is stored under another project' USING ERRCODE = '23514';
            END IF;
            NEW.north_bearing_deg := COALESCE(NEW.north_bearing_deg, 0);
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.roof_sources_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.roof_sources_bind() FROM anon;
CREATE TRIGGER roof_sources_bind BEFORE INSERT OR UPDATE ON solar.roof_sources
    FOR EACH ROW EXECUTE FUNCTION solar.roof_sources_bind();

ALTER TABLE solar.roof_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.roof_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY roof_sources_select ON solar.roof_sources FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY roof_sources_insert ON solar.roof_sources FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY roof_sources_update ON solar.roof_sources FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY roof_sources_delete ON solar.roof_sources FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY roof_sources_insert_authz ON solar.roof_sources AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY roof_sources_update_authz ON solar.roof_sources AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY roof_sources_delete_authz ON solar.roof_sources AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 2. Layouts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.layouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            UUID NOT NULL REFERENCES solar.studies(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    roof_source_id      UUID NOT NULL REFERENCES solar.roof_sources(id),   -- NO ACTION: a used roof source cannot be removed
    name                TEXT NOT NULL,
    /* Equipment catalogue arrives with the Financials phase; the FK is added then.
       module_spec is the snapshot the design was made with and never follows the catalogue. */
    module_id           UUID,
    module_spec         JSONB NOT NULL CHECK (jsonb_typeof(module_spec) = 'object'),
    default_tilt_deg    NUMERIC(4,1) NOT NULL DEFAULT 10 CHECK (default_tilt_deg >= 0 AND default_tilt_deg <= 60),
    design_t_min_c      NUMERIC(4,1) NOT NULL DEFAULT -5 CHECK (design_t_min_c BETWEEN -40 AND 30),
    design_t_amb_max_c  NUMERIC(4,1) NOT NULL DEFAULT 35 CHECK (design_t_amb_max_c BETWEEN 10 AND 60),
    summary             JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT layouts_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS layouts_study_name_key ON solar.layouts (study_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS layouts_roof_source_idx ON solar.layouts (roof_source_id);

CREATE OR REPLACE FUNCTION solar.layouts_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_rs_study UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.study_id IS DISTINCT FROM OLD.study_id OR NEW.roof_source_id IS DISTINCT FROM OLD.roof_source_id THEN
            RAISE EXCEPTION 'solar.layouts: a layout stays on the sheet it was drawn on' USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT s.project_id, s.organisation_id INTO NEW.project_id, NEW.organisation_id
          FROM solar.studies s WHERE s.id = NEW.study_id;
        IF NEW.project_id IS NULL THEN
            RAISE EXCEPTION 'solar.layouts: study % not found', NEW.study_id USING ERRCODE = '23503';
        END IF;
        SELECT rs.study_id INTO v_rs_study FROM solar.roof_sources rs WHERE rs.id = NEW.roof_source_id;
        IF v_rs_study IS NULL OR v_rs_study <> NEW.study_id THEN
            RAISE EXCEPTION 'solar.layouts: the roof source belongs to another study' USING ERRCODE = '23514';
        END IF;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    NEW.name := btrim(NEW.name);
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.layouts_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.layouts_bind() FROM anon;
CREATE TRIGGER layouts_bind BEFORE INSERT OR UPDATE ON solar.layouts
    FOR EACH ROW EXECUTE FUNCTION solar.layouts_bind();

ALTER TABLE solar.layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY layouts_select ON solar.layouts FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layouts_insert ON solar.layouts FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layouts_update ON solar.layouts FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layouts_delete ON solar.layouts FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layouts_insert_authz ON solar.layouts AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layouts_update_authz ON solar.layouts AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layouts_delete_authz ON solar.layouts AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- ── 3. Layout objects ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.layout_objects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layout_id           UUID NOT NULL REFERENCES solar.layouts(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    /* Denormalised from the roof source by the bind trigger, never trusted from
       the caller: cloud-sync-project's isAnnotated() looks the drawing up here. */
    floor_plan_id       UUID REFERENCES tenants.floor_plans(id),     -- NO ACTION, see header
    page_index          INTEGER,
    kind                TEXT NOT NULL CONSTRAINT layout_objects_kind_check
                          CHECK (kind IN ('roof', 'obstruction', 'array', 'module_block', 'inverter', 'string', 'equipment', 'north')),
    geometry            JSONB NOT NULL CHECK (jsonb_typeof(geometry) = 'object'),
    /* Image pixels per metre when the object was FIRST saved; pinned on update. */
    pixels_per_meter    NUMERIC CHECK (pixels_per_meter > 0),
    props               JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object'),
    created_by          UUID REFERENCES auth.users(id),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS layout_objects_layout_idx ON solar.layout_objects (layout_id);
CREATE INDEX IF NOT EXISTS layout_objects_floor_plan_idx ON solar.layout_objects (floor_plan_id);

CREATE OR REPLACE FUNCTION solar.layout_objects_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_project UUID;
    v_org     UUID;
    v_kind    TEXT;
    v_fp      UUID;
    v_page    INTEGER;
    v_mpp     NUMERIC;
    v_ppm     NUMERIC;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.layout_id IS DISTINCT FROM OLD.layout_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
            RAISE EXCEPTION 'solar.layout_objects: an object cannot move to another layout or change kind' USING ERRCODE = '42501';
        END IF;
        NEW.project_id := OLD.project_id;
        NEW.organisation_id := OLD.organisation_id;
        NEW.floor_plan_id := OLD.floor_plan_id;
        NEW.page_index := OLD.page_index;
        NEW.pixels_per_meter := OLD.pixels_per_meter;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT l.project_id, l.organisation_id, rs.kind, rs.floor_plan_id, rs.page_index, rs.m_per_px
          INTO v_project, v_org, v_kind, v_fp, v_page, v_mpp
          FROM solar.layouts l JOIN solar.roof_sources rs ON rs.id = l.roof_source_id
         WHERE l.id = NEW.layout_id;
        IF v_project IS NULL THEN
            RAISE EXCEPTION 'solar.layout_objects: layout % not found', NEW.layout_id USING ERRCODE = '23503';
        END IF;
        NEW.project_id := v_project;
        NEW.organisation_id := v_org;
        NEW.floor_plan_id := v_fp;
        NEW.page_index := CASE WHEN v_kind = 'drawing' THEN v_page ELSE NULL END;
        IF v_kind = 'satellite' THEN
            v_ppm := 1 / v_mpp;
        ELSE
            -- A page other than 1 has its own scale (00199); page 1 falls back to
            -- the drawing's. The caller's idea of the scale is never consulted.
            SELECT ps.pixels_per_meter INTO v_ppm
              FROM tenants.floor_plan_page_scales ps
             WHERE ps.floor_plan_id = v_fp AND ps.page_index = v_page;
            IF v_ppm IS NULL AND v_page = 1 THEN
                SELECT fp.pixels_per_meter INTO v_ppm FROM tenants.floor_plans fp WHERE fp.id = v_fp;
            END IF;
        END IF;
        IF v_ppm IS NULL AND NEW.kind <> 'north' THEN
            RAISE EXCEPTION 'solar.layout_objects: the roof source has no scale; calibrate this page first' USING ERRCODE = '23514';
        END IF;
        NEW.pixels_per_meter := v_ppm;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    IF NEW.kind = 'equipment' THEN
        IF NEW.props->>'equipmentKind' = 'db' AND NULLIF(NEW.props->>'nodeId', '') IS NULL THEN
            RAISE EXCEPTION 'solar.layout_objects: a DB symbol must link to a board' USING ERRCODE = '23514';
        END IF;
        IF NULLIF(NEW.props->>'nodeId', '') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM structure.nodes n WHERE n.id::text = NEW.props->>'nodeId' AND n.project_id = NEW.project_id) THEN
            RAISE EXCEPTION 'solar.layout_objects: the equipment board belongs to another project' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.layout_objects_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.layout_objects_bind() FROM anon;
CREATE TRIGGER layout_objects_bind BEFORE INSERT OR UPDATE ON solar.layout_objects
    FOR EACH ROW EXECUTE FUNCTION solar.layout_objects_bind();

ALTER TABLE solar.layout_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.layout_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY layout_objects_select ON solar.layout_objects FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layout_objects_insert ON solar.layout_objects FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layout_objects_update ON solar.layout_objects FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY layout_objects_delete ON solar.layout_objects FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY layout_objects_insert_authz ON solar.layout_objects AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layout_objects_update_authz ON solar.layout_objects AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY layout_objects_delete_authz ON solar.layout_objects AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON solar.roof_sources, solar.layouts, solar.layout_objects TO authenticated;
GRANT ALL ON solar.roof_sources, solar.layouts, solar.layout_objects TO service_role;
REVOKE ALL ON solar.roof_sources, solar.layouts, solar.layout_objects FROM anon;

-- ── 4. The save: one transaction, stale-refusing, RLS-decided ────────────────
CREATE OR REPLACE FUNCTION public.solar_save_layout_objects(
    p_layout_id           UUID,
    p_expected_updated_at TIMESTAMPTZ,
    p_upserts             JSONB,
    p_deletes             UUID[],
    p_summary             JSONB
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_project UUID;
    v_updated TIMESTAMPTZ;
    v_obj     JSONB;
    v_n       INTEGER;
BEGIN
    IF p_upserts IS NULL OR jsonb_typeof(p_upserts) <> 'array' THEN
        RAISE EXCEPTION 'solar_save_layout_objects: upserts must be an array' USING ERRCODE = '22023';
    END IF;
    IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN
        RAISE EXCEPTION 'solar_save_layout_objects: summary must be an object' USING ERRCODE = '22023';
    END IF;
    SELECT l.project_id INTO v_project FROM solar.layouts l WHERE l.id = p_layout_id;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'solar.layouts: layout not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.solar_can_edit(v_project) THEN
        RAISE EXCEPTION 'solar.layouts: you cannot edit this layout' USING ERRCODE = '42501';
    END IF;
    SELECT l.updated_at INTO v_updated FROM solar.layouts l WHERE l.id = p_layout_id FOR UPDATE;
    IF v_updated IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'solar.layouts: stale layout' USING ERRCODE = '40001';
    END IF;
    DELETE FROM solar.layout_objects o
     WHERE o.layout_id = p_layout_id AND o.id = ANY (COALESCE(p_deletes, ARRAY[]::uuid[]));
    FOR v_obj IN SELECT value FROM jsonb_array_elements(p_upserts) LOOP
        INSERT INTO solar.layout_objects AS o (id, layout_id, kind, geometry, props)
        VALUES ((v_obj->>'id')::uuid, p_layout_id, v_obj->>'kind', v_obj->'geometry', COALESCE(v_obj->'props', '{}'::jsonb))
        ON CONFLICT (id) DO UPDATE SET geometry = EXCLUDED.geometry, props = EXCLUDED.props
         WHERE o.layout_id = EXCLUDED.layout_id AND o.kind = EXCLUDED.kind;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN
            RAISE EXCEPTION 'solar.layout_objects: object % belongs to another layout or changed kind', v_obj->>'id'
                USING ERRCODE = '42501';
        END IF;
    END LOOP;
    UPDATE solar.layouts l SET summary = p_summary WHERE l.id = p_layout_id RETURNING l.updated_at INTO v_updated;
    RETURN v_updated;
END $$;
REVOKE ALL ON FUNCTION public.solar_save_layout_objects(UUID, TIMESTAMPTZ, JSONB, UUID[], JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_save_layout_objects(UUID, TIMESTAMPTZ, JSONB, UUID[], JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_save_layout_objects(UUID, TIMESTAMPTZ, JSONB, UUID[], JSONB) TO authenticated, service_role;

-- ── 5. Saved layout sheets read like the Solar module ────────────────────────
-- Redefines 00183's function IN FULL (a CREATE OR REPLACE replaces the body).
-- Every branch 00183 had is kept byte-for-byte in meaning; the new first branch
-- gates exactly one kind. A future Solar kind carrying money (a proposal) must
-- use solar_can_see_money, so this names the kind rather than matching solar_%.
CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(_project_id UUID, _kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT CASE
    WHEN _kind = 'solar_layout_sheet' THEN COALESCE(public.solar_can_view(_project_id), FALSE)
    WHEN NOT public.report_kind_is_sensitive(_kind) THEN TRUE
    ELSE COALESCE(
      public.user_effective_project_role(_project_id)
        IN ('owner', 'admin', 'project_manager'),
      FALSE)
  END
$function$;
REVOKE ALL ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_read_report_kind(UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Dry-run GREEN**

```bash
S=$(mktemp -d)
cat apps/edge-functions/supabase/migrations/00207_solar_foundation.sql \
    apps/edge-functions/supabase/migrations/00208_solar_org_settings.sql \
    apps/edge-functions/supabase/migrations/00211_solar_layouts.sql > "$S/combo.sql"
scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-solar-layouts-roles.sql
```

Expected: every check `✓`, `0 failed` (48 checks). Then prove 00211 changes nothing Phase 1 asserted:

```bash
scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-solar-foundation-roles.sql scripts/db/assert-solar-org-settings-roles.sql
```

Expected: both files `0 failed`.

- [ ] **Step 3: Mutation runs — each must turn named checks red, then revert**

Make each edit in a COPY (`cp apps/edge-functions/supabase/migrations/00211_solar_layouts.sql "$S/m.sql"`, edit `$S/m.sql`, then `cat base.sql m.sql > "$S/mcombo.sql"` and dry-run it). Record the red checks in the PR body.

| # | Mutation in the copy | Must go red |
|---|---|---|
| M1 | Delete the `layout_objects_insert_authz` policy | `viewer_direct_object_insert_REFUSED` |
| M2 | Delete the `IF NOT public.solar_can_edit(v_project)` block in `solar_save_layout_objects` | `viewer_save_REFUSED` |
| M3 | In `layout_objects_bind` UPDATE branch, delete `NEW.pixels_per_meter := OLD.pixels_per_meter;` and add `NEW.pixels_per_meter := COALESCE((NEW.props->>'ppm')::numeric, OLD.pixels_per_meter) * 2;` | `object_scale_pinned_on_update` |
| M4 | Delete the `WHEN _kind = 'solar_layout_sheet'` branch | `no_level_reads_nothing_nogrant` |
| M5 | Add `ON DELETE CASCADE` to BOTH `floor_plan_id` FKs (roof_sources, layout_objects) AND to `layouts.roof_source_id` (otherwise the layouts FK still refuses at end of statement and the mutation proves nothing) | `drawing_delete_with_layout_REFUSED` |
| M6 | In `roof_sources_bind`, delete the two `NEW.file_path := v_fp_path; NEW.source_revision_id := v_fp_rev;` lines | `roof_source_anchor_and_org_bound` |

Expected: each mutation turns at least its named check red; the original file is untouched throughout (`git diff --stat` shows no change to the migration).

- [ ] **Step 4: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00211_solar_layouts.sql
git commit -m "feat(solar-layout): 00211 roof sources, layouts, layout objects, atomic save

Per-verb RLS on solar_can_view / solar_can_edit, FORCE RLS, bind triggers
pin org/project/anchor/scale; drawings cannot be hard-deleted under a
layout; solar_layout_sheet reports read on the Solar level. Dry-run 48/48
against 00207+00208+00211; six mutations each turned their check red.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `@verify` block parses, and the migration guards stay green

**Files:** none new (runs the existing contract tests over the new migration)

- [ ] **Step 1: Run the verify-block contract test**

Run: `pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts`
Expected: PASS. It parses every migration ≥ `00185` with `parseVerifyBlock` (`packages/shared/src/lib/migrations/verify-header.ts`); a failure names `@verify line N` (unknown directive word, prose-only line, or an em dash inside a `sql:` payload — the 00204 failure). The `behaviour:` line above deliberately uses a comma, not an em dash.

- [ ] **Step 2: Run the whole `@esite/db` suite**

Run: `pnpm --filter @esite/db test`
Expected: PASS, including `anon-execute-secdef.test.ts` (it reads migration TEXT for `REVOKE … FROM anon` on every SECURITY DEFINER function — all three bind functions and the redefined `user_can_read_report_kind` carry one) and `floor-plan-annotated-predicate.contract.test.ts`, which now FAILS — see Task 13. If `anon-execute-secdef` fails, the message names the function; add the explicit `REVOKE … FROM anon` line, never a dynamic `EXECUTE format()` (the static scanner cannot see it).

- [ ] **Step 3: Note the expected red**

The annotated-predicate contract test should now be RED, naming `solar.roof_sources (defined in 00211_solar_layouts.sql)` and `solar.layout_objects (defined in 00211_solar_layouts.sql)`. That is the schema-derived guard catching the new tables on its own — the intended behaviour. Do not commit until Task 13 turns it green.

---

### Task 13: Register the layout tables in `isAnnotated()`

**Files:**
- Modify: `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts:785-873` (`isAnnotated`)
- Modify: `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts` (the "discovers the tables we know are there" list)

- [ ] **Step 1: Strengthen the contract test's discovery list (red stays red)**

In `floor-plan-annotated-predicate.contract.test.ts`, inside `it('discovers the tables we know are there', …)`, add two entries to the array so discovery itself is pinned:

```ts
        'tenants.floor_plan_versions',
        'solar.roof_sources',
        'solar.layout_objects',
```

(the first line already exists; add the two after it).

- [ ] **Step 2: Run the contract test to confirm it is red for the right reason**

Run: `pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`
Expected: FAIL in `queries, or explicitly exempts, every table…` listing `solar.roof_sources` and `solar.layout_objects`; the discovery test PASSES.

- [ ] **Step 3: Add the two lookups to `isAnnotated()`**

In `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts`, extend the doc comment's list (line ~776) with `, a Solar roof source or layout object` and insert immediately BEFORE the final `return false` of `isAnnotated()` (after the `floor_plan_markups` block):

```ts
  // A Solar roof source (00211): this drawing page is the sheet a PV layout is
  // (or is about to be) drawn on. Its file_path records the revision the layout
  // belongs to and the layout page warns when they diverge — but, as for markup
  // layers, not adopting silently is the actual protection.
  const { data: roofSource, error: rse } = await supabase
    .schema('solar')
    .from('roof_sources')
    .select('id')
    .eq('floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (rse || roofSource) return true

  // Solar layout geometry (00211): roofs, arrays, strings in raw image pixels of
  // THIS file. Covered by the roof source above today (the FK chain), queried in
  // its own right so a future path that writes objects cannot make it blind.
  const { data: layoutObject, error: loe } = await supabase
    .schema('solar')
    .from('layout_objects')
    .select('id')
    .eq('floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (loe || layoutObject) return true
```

- [ ] **Step 4: Run the contract test green**

Run: `pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`
Expected: PASS — coverage, fail-closed structure (two new `.from(` lookups each with a `return true`, still exactly one `return false`), discovery.

- [ ] **Step 5: Mutation — remove the `layout_objects` block and re-run**

Expected: FAIL naming `solar.layout_objects`. Restore; PASS.

- [ ] **Step 6: Type-check the edge function**

Run: `deno check apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` (if `deno` is not installed, skip and state so in the PR — the web/shared type-checks do not cover Deno code).
Expected: `Check …index.ts` with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/edge-functions/supabase/functions/cloud-sync-project/index.ts packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
git commit -m "fix(cloud-sync): isAnnotated() sees Solar roof sources and layout objects

The schema-derived contract test named both 00211 tables on its own.
Deploy is a manual owner step AFTER 00211 is applied: the lookups fail
closed, so deploying first would stop auto-adopt platform-wide.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Report read gate — application half

**Files:**
- Modify: `apps/web/src/lib/reports/report-kind-access.ts`
- Modify: `apps/web/src/lib/reports/report-kind-access.contract.test.ts`
- Modify: `apps/web/src/actions/project-reports.actions.ts:1-6` (imports), `:116-125` (list gate), `:176-184` (URL gate)
- Test: `apps/web/src/actions/project-reports.solar-gate.test.ts`

Why a third set and not `REPORT_KIND_READ_ROLES`: that map gates on E-Site ROLES (owner/admin/PM). Solar is gated per USER per project (00207, D-04): a contractor holding a Solar View grant must read the sheet, and a project manager WITHOUT a grant must not. Putting `solar_layout_sheet` in the role map would get both wrong.

- [ ] **Step 1: Write the failing contract assertions (append inside the existing `describe`)**

Append to `apps/web/src/lib/reports/report-kind-access.contract.test.ts`, inside `describe('report kind read policy contract', …)`:

```ts
  it('a kind is in exactly one of the three sets', () => {
    const solar = Object.keys(SOLAR_READ_REPORT_KINDS)
    for (const k of solar) {
      expect(k in REPORT_KIND_READ_ROLES, `${k} is both Solar-gated and role-gated`).toBe(false)
      expect(OPEN_READ_REPORT_KINDS.includes(k), `${k} is both Solar-gated and open`).toBe(false)
    }
  })

  it('every Solar-gated kind is gated in the FINAL user_can_read_report_kind()', () => {
    const dir = path.resolve(SRC_ROOT, '../../edge-functions/supabase/migrations')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    let body: string | null = null
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8')
      // The CREATE, not a later REVOKE/GRANT that also names the function.
      const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.user_can_read_report_kind(')
      if (i === -1) continue
      const start = sql.indexOf('$function$', i)
      const end = sql.indexOf('$function$', start + 10)
      if (start !== -1 && end !== -1) body = sql.slice(start + 10, end)
    }
    expect(body, 'user_can_read_report_kind() not found in any migration').toBeTruthy()
    for (const [kind, level] of Object.entries(SOLAR_READ_REPORT_KINDS)) {
      const helper = level === 'view' ? 'solar_can_view' : level === 'edit' ? 'solar_can_edit' : 'solar_can_see_money'
      expect(body!, `${kind} is not gated in the final user_can_read_report_kind()`).toMatch(
        new RegExp(`_kind = '${kind}' THEN COALESCE\\(public\\.${helper}\\(_project_id\\), FALSE\\)`),
      )
    }
  })
```

and add `SOLAR_READ_REPORT_KINDS` to the file's existing import from `./report-kind-access`.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/lib/reports/report-kind-access.contract.test.ts`
Expected: FAIL — `SOLAR_READ_REPORT_KINDS` is not exported.

- [ ] **Step 3: Implement the set**

In `apps/web/src/lib/reports/report-kind-access.ts`, change the import line to:

```ts
import { ORG_WRITE_ROLES, COST_VIEW_ROLES, type OrgRole, type SolarAccessLevel } from '@esite/shared'
```

and append after `OPEN_READ_REPORT_KINDS`:

```ts
/**
 * Kinds whose read follows the Solar module's own gate: the caller's per-user
 * Solar level on the project (00207, decision D-04), not an E-Site role. A
 * contractor with a View grant reads a layout sheet; a project manager with no
 * grant does not. Mirrored in public.user_can_read_report_kind() (00211) and
 * pinned by report-kind-access.contract.test.ts against the FINAL definition.
 */
export const SOLAR_READ_REPORT_KINDS: Readonly<Record<string, SolarAccessLevel>> = {
  // A drawing crop with arrays, strings, a legend and a title block — no rand
  // values, so View is enough (the Layout tab itself is tech-read).
  solar_layout_sheet: 'view',
}

/** The Solar level required to read this kind, or null when it is not a Solar kind. */
export function solarLevelForKind(kind: string): SolarAccessLevel | null {
  return SOLAR_READ_REPORT_KINDS[kind] ?? null
}
```

and change `hasDeclaredReadPolicy` to:

```ts
export function hasDeclaredReadPolicy(kind: string): boolean {
  return kind in REPORT_KIND_READ_ROLES || OPEN_READ_REPORT_KINDS.includes(kind) || kind in SOLAR_READ_REPORT_KINDS
}
```

- [ ] **Step 4: Run the contract test**

Run: `pnpm --filter web exec vitest run src/lib/reports/report-kind-access.contract.test.ts`
Expected: PASS (the final definition is 00211's).

- [ ] **Step 5: Write the failing action-gate tests**

`apps/web/src/actions/project-reports.solar-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getSolarAccessLevel: vi.fn(),
  requireEffectiveRole: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.getSolarAccessLevel }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.requireEffectiveRole, requireRole: h.requireRole }))

import { listProjectReportsAction, getProjectReportUrlAction } from './project-reports.actions'
import { fakeSupabase } from '@/test/fake-supabase'

const P = '00000000-0000-0000-0000-000000000011'
const R = '00000000-0000-0000-0000-000000000055'
const ROW = {
  id: R, project_id: P, organisation_id: 'o', kind: 'solar_layout_sheet', title: 'Layout — A', storage_path: 'o/p/s.pdf',
  mime_type: 'application/pdf', size_bytes: 1, status: 'issued', version: 1, generated_by: null, generated_at: 't', created_at: 't',
}

beforeEach(() => {
  vi.clearAllMocks()
  const { client } = fakeSupabase({ tables: { 'projects.reports': [ROW] } })
  h.createClient.mockResolvedValue(client)
  h.createServiceClient.mockReturnValue({
    storage: { from: () => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed' }, error: null })) }) },
  })
})

describe('Solar report kinds read on the Solar level', () => {
  it('lists solar_layout_sheet for a caller with a View level (and never asks the role gate)', async () => {
    h.getSolarAccessLevel.mockResolvedValue('view')
    const res = await listProjectReportsAction(P, 'solar_layout_sheet')
    expect(Array.isArray(res)).toBe(true)
    expect(h.requireEffectiveRole).not.toHaveBeenCalled()
  })
  it('refuses the list without a Solar level', async () => {
    h.getSolarAccessLevel.mockResolvedValue(null)
    await expect(listProjectReportsAction(P, 'solar_layout_sheet')).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('refuses the signed URL without a Solar level', async () => {
    h.getSolarAccessLevel.mockResolvedValue(null)
    await expect(getProjectReportUrlAction(P, R)).resolves.toEqual({ error: 'You do not have Solar access on this project.' })
  })
  it('mints the signed URL with a View level', async () => {
    h.getSolarAccessLevel.mockResolvedValue('view')
    await expect(getProjectReportUrlAction(P, R)).resolves.toEqual({ url: 'https://signed' })
  })
  it('does not consult Solar for an ordinary kind', async () => {
    await listProjectReportsAction(P, 'tenant_schedule')
    expect(h.getSolarAccessLevel).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run to confirm failure**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.solar-gate.test.ts`
Expected: FAIL — the no-level cases return rows / a URL.

- [ ] **Step 7: Implement the gate in the actions**

In `apps/web/src/actions/project-reports.actions.ts`, replace the import line
`import { readRolesForKind } from '@/lib/reports/report-kind-access'` with:

```ts
import { readRolesForKind, solarLevelForKind } from '@/lib/reports/report-kind-access'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { solarLevelAllows } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

const NO_SOLAR_ACCESS = 'You do not have Solar access on this project.'

/** Solar kinds read on the caller's Solar level (00211 mirrors this in SQL). Null when allowed or not a Solar kind. */
async function solarReadDenied(supabase: unknown, projectId: string, kind: string): Promise<string | null> {
  const need = solarLevelForKind(kind)
  if (!need) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
  return solarLevelAllows(level, need) ? null : NO_SOLAR_ACCESS
}
```

In `listProjectReportsAction`, immediately after `const supabase = await createClient()` add:

```ts
  const solarDenied = await solarReadDenied(supabase, projectId, kind)
  if (solarDenied) return { error: solarDenied }
```

In `getProjectReportUrlAction`, immediately after `if (!report) return { error: 'Not found' }` add:

```ts
  const solarDenied = await solarReadDenied(supabase, projectId, report.kind)
  if (solarDenied) return { error: solarDenied }
```

(`@/lib/solar/access` imports `next/navigation` for `requireSolarLevel`; this file only uses `getSolarAccessLevel`, which never redirects.)

- [ ] **Step 8: Run the new and existing report tests**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.solar-gate.test.ts src/actions/project-reports.actions.test.ts src/lib/reports/report-kind-access.contract.test.ts`
Expected: PASS (the existing suite never uses a Solar kind, so `getSolarAccessLevel` is not reached; it is unmocked there, which is fine because `solarLevelForKind` returns null first).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/reports/report-kind-access.ts apps/web/src/lib/reports/report-kind-access.contract.test.ts apps/web/src/actions/project-reports.actions.ts apps/web/src/actions/project-reports.solar-gate.test.ts
git commit -m "feat(reports): solar_layout_sheet reads on the Solar level, app half

A third explicit read-policy set; the contract test pins it against the
FINAL user_can_read_report_kind() (00211), not a hand-written mirror.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: 5-i checkpoint — three suites, type-check, owner steps written down

**Files:** none

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @esite/shared test
pnpm --filter @esite/db test
pnpm --filter web test
pnpm --filter @esite/shared type-check && pnpm --filter web type-check
pnpm --filter web lint
```

Expected: all green; counts = baseline + the new tests. Any red → fix before 5-ii.

- [ ] **Step 2: Record the OWNER steps for the PR body (do not perform them)**

These go verbatim into the PR description in 5-ii's final task:

1. **Claim the number at apply time.** Re-check the ledger `max(version)`, `origin/main`, and open-PR migration filenames. `00207` and `00208` must be applied first (`00209`/`00210` are independent). Renumber `00211` if taken.
2. **Apply** `00211` through the deploy workflow (or Management API), then `pnpm tsx scripts/verify-migration-applied.ts` → every directive of `00211` green AND every block ≥ `00185` still green (00207's schema-wide directives included).
3. **Pre-deploy check for the edge function** — as `service_role`, over PostgREST:
   `curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/rest/v1/roof_sources?select=id&limit=1" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Accept-Profile: solar"` and the same for `layout_objects`. Both must be `200`. A `406`/`PGRST106` means schema `solar` is not in the PostgREST `db_schema` list — deploying then would make EVERY drawing read as annotated (fail-closed) and silently stop Dropbox auto-adopt platform-wide.
4. **Deploy** `cd apps/edge-functions && ./deploy.sh cloud-sync-project`, then read back from the Management API: `GET /v1/projects/cbskbnvvgcybmfikxgky/functions/cloud-sync-project` → `version` incremented, `verify_jwt` unchanged; pull `/functions/cloud-sync-project/body` and confirm the needles `roof_sources` and `layout_objects` are in the deployed bundle (the deployed artefact, not the repo).
5. **Watch the next `cloud-sync-poll` tick** (every 15 min): runs complete with the same `seen`/`adopted` pattern as before; a project whose adopt count drops to 0 across the board is the fail-closed symptom — roll back the function.

- [ ] **Step 3: Push the branch so far**

```bash
git push git@github.com:WattMatt/e-site.git feat/solar-phase-5
```

Expected: branch published. (The draft PR is opened at the end of 5-ii.)

---

## Self-review (done while writing; recorded for the reviewer)

- **Spec coverage (5-i scope):** engine §3.1 — setbacks (Task 5 `quadInsideRoof`), obstruction polygon + circle with own setback (Tasks 1, 5), D-11 pitch (Task 3), foreshortening along the fall line only with the WM regression pinned (Tasks 4, 5), 0/90° × 8 offsets and tie rule (Task 5). §3.2 azimuth (Task 2). §3.3 checks + recommended n (Task 6). Functional §6.4 summary + BOM CSV (Task 7), §6.5 anchor + scale snapshot + isAnnotated (Tasks 11, 13). §3.2 C satellite maths (Task 8). Data model §3 tables, §3.1 RLS shape, §3.2 bucket (Task 11). Report kind gate (Task 14). Readiness row (Tasks 7, 9). Canvas/tools/pages/export/3D/rbac-matrix are 5-ii.
- **Placeholders:** none; every code step carries its code and every run step its command and expected result.
- **Type consistency:** `LayoutObject`, `ArrayProps.facingSheetDeg`, `Footprint`, `AutoFillInput.rotationsDeg`, `DesignConditions`, `StoredLayoutSummary`, `solar_save_layout_objects(uuid, timestamptz, jsonb, uuid[], jsonb)` are used with the same names and signatures in 5-ii.
