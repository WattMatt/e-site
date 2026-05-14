# Auto-Parallel Cables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a supply's design load exceeds one cable's rating, the Add-cable form computes the grouping-aware parallel count and creates the whole set in one action; the schedule grid flags under-rated supplies.

**Architecture:** One pure iterative calc (`requiredParallelSet`) + a pure sum (`supplyParallelCapacity`) in `@esite/shared`, reused three ways: a read-only `previewParallelCableSet` server action the form debounce-calls, a batch `addParallelCableSetAction`, and `page.tsx`'s grid under-rating computation. A shared `resolveCableElectricals` helper is extracted from `addCableAction` so the SANS-lookup → derating block isn't duplicated. No DB migration, no RLS changes.

**Tech Stack:** Next.js 15 (App Router, server + client components), TypeScript, Supabase JS client, `vitest` for the pure-function unit tests, CSS-variable styling.

**Spec:** `docs/superpowers/specs/2026-05-14-auto-parallel-cables-design.md`

**Branch:** `feat/powersync` (work on the current branch — no worktree).

---

## Conventions for every task

- All commands run from repo root `/Users/spud/Documents/DEVELOPER/E-SITE CO/esite`.
- **Web typecheck:** `pnpm --filter web exec tsc --noEmit` — the web app's pnpm package name is `web`, **not** `@esite/web`.
- **Known pre-existing typecheck baseline:** the web app has **5 pre-existing errors** from schema type drift, unrelated to this work — in `src/actions/onboarding.actions.ts`, `src/actions/supplier.actions.ts`, `src/app/(admin)/procurement/NewProcurementForm.tsx`, `src/app/(marketplace)/supplier/profile/page.tsx`, `src/app/api/paystack/subaccount/route.ts`. Pass criterion for every task: **no NEW errors beyond these 5**, and zero errors in any file the task touched. Do not fix the 5.
- **Shared typecheck / tests:** `pnpm --filter @esite/shared exec tsc --noEmit` (stays clean, 0 errors) and `pnpm --filter @esite/shared exec vitest run <path>`.
- When running a command, paste its **literal** output + exit code — do not summarize or characterize.
- **Preview note:** the dev server currently cannot reach the Supabase backend (auth fails with "Failed to fetch") — an env/infra issue. Per-task preview verification is therefore best-effort; if it can't run, say so and rely on typecheck + unit tests. The real UI walkthrough is deferred to whenever the dev env is connected.
- Commit messages follow the repo convention: `feat(cable-schedule): ...` / `fix(cable-schedule): ...` / `refactor(cable-schedule): ...`.
- Do **not** run `git push` (the controller pushes once at the very end).
- There is unrelated pre-existing cruft in the working tree (iCloud `* 2.*` files, `.env*.bak`, etc.). Stage **only** the exact files named in each task with explicit `git add` paths — never `git add -A` / `git add .`.
- The amber/charcoal CSS variables (`--c-amber`, `--c-panel`, `--c-border`, `--c-text-mid`, `--c-text-dim`, `--c-base`, `--c-warning`, `--c-red`, etc.) and shared classes (`.data-panel`, `.ob-input`, `.ob-label`, `.btn-primary-amber`, `.badge`) already exist in `apps/web/src/app/globals.css` — reuse them.

---

## File structure

| File | Responsibility after this plan |
|---|---|
| `packages/shared/src/services/cable-calc.service.ts` | + `requiredParallelSet` (pure iterative grouping-aware count) and `supplyParallelCapacity` (pure sum) + the `ParallelSetResult` type |
| `packages/shared/src/services/cable-calc.service.test.ts` | + unit tests for the two new helpers |
| `apps/web/src/actions/cable-entities.actions.ts` | + `resolveCableElectricals` module-private helper (extracted from `addCableAction`); `addCableAction` rewired to use it; + `previewParallelCableSet` (read-only) and `addParallelCableSetAction` (batch create) server actions |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | `CableForm` gains a debounced live readout, an editable count field, and a mode-aware Add button |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | computes per-supply `combinedCapacity` + `underRated`, threads them into each `ScheduleRow` |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` | `ScheduleRow` gains `combined_capacity_a` + `supply_under_rated`; renders the under-rating flag; `utilisationPct` becomes supply-level |

---

## Task 1: Pure calc — `requiredParallelSet` + `supplyParallelCapacity`

**Files:**
- Modify: `packages/shared/src/services/cable-calc.service.ts`
- Modify: `packages/shared/src/services/cable-calc.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/services/cable-calc.service.test.ts` — first extend the import line `import { activeLengthM, type CableForCalc } from './cable-calc.service'` to also import the new symbols:

```ts
import {
  activeLengthM,
  requiredParallelSet,
  supplyParallelCapacity,
  type CableForCalc,
} from './cable-calc.service'
```

Then append these two `describe` blocks at the end of the file:

```ts
describe('requiredParallelSet', () => {
  it('returns N=1 when one cable already carries the load', () => {
    const r = requiredParallelSet(300, () => 340)
    expect(r).toEqual({ count: 1, perCableRatingA: 340, combinedRatingA: 340, insufficient: false })
  })

  it('rounds up to the smallest N that carries the load (constant rating)', () => {
    // load 1100, each cable 250A -> 5 x 250 = 1250 >= 1100
    const r = requiredParallelSet(1100, () => 250)
    expect(r?.count).toBe(5)
    expect(r?.combinedRatingA).toBe(1250)
    expect(r?.insufficient).toBe(false)
  })

  it('needs a higher N when grouping derates each cable as N rises', () => {
    // rating(n) = 300 - (n-1)*30  ->  n=1:300 n=2:2*270=540 n=3:3*240=720
    // n=4:4*210=840 n=5:5*180=900 n=6:6*150=900 ... load 880 first met at n=5
    const ratingForN = (n: number) => 300 - (n - 1) * 30
    const r = requiredParallelSet(880, ratingForN)
    expect(r?.count).toBe(5)
    expect(r?.insufficient).toBe(false)
  })

  it('flags insufficient when even maxN cannot carry the load', () => {
    const r = requiredParallelSet(10_000, () => 10, 16)
    expect(r?.count).toBe(16)
    expect(r?.insufficient).toBe(true)
    expect(r?.combinedRatingA).toBe(160)
  })

  it('returns null when no base rating resolves (rating at N=1 is null)', () => {
    expect(requiredParallelSet(1000, () => null)).toBeNull()
  })
})

describe('supplyParallelCapacity', () => {
  it('sums the stored derated ratings, treating null as 0', () => {
    expect(supplyParallelCapacity([
      { derated_current_rating_a: 340 },
      { derated_current_rating_a: 340 },
      { derated_current_rating_a: null },
    ])).toBe(680)
  })

  it('is 0 for a supply with no cables', () => {
    expect(supplyParallelCapacity([])).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-calc.service.test.ts`
Expected: FAIL — `requiredParallelSet` / `supplyParallelCapacity` are not exported yet (compile error or "is not a function").

- [ ] **Step 3: Implement the two helpers**

Append to the end of `packages/shared/src/services/cable-calc.service.ts`:

```ts
/**
 * Result of sizing a parallel cable set against a design load.
 */
export interface ParallelSetResult {
  /** Number of cables in parallel (1..maxN). */
  count: number
  /** Per-cable derated rating at this group size, in A. */
  perCableRatingA: number
  /** count * perCableRatingA, in A. */
  combinedRatingA: number
  /** True when even maxN cables cannot carry the design load. */
  insufficient: boolean
}

/**
 * Smallest number of parallel cables that carries `designLoadA`.
 *
 * Pure + grouping-aware: `ratingForN(n)` must return the per-cable derated
 * rating *when n cables are grouped together* (the grouping derate factor
 * worsens as n rises, so the caller bakes that into ratingForN). Iterates
 * n = 1..maxN and returns the first n where n * ratingForN(n) >= designLoadA.
 * If maxN is still short, returns that n with `insufficient: true`.
 * Returns null when no base rating resolves (ratingForN(1) is null/<=0).
 */
export function requiredParallelSet(
  designLoadA: number,
  ratingForN: (n: number) => number | null,
  maxN = 16,
): ParallelSetResult | null {
  const r1 = ratingForN(1)
  if (r1 == null || !Number.isFinite(r1) || r1 <= 0) return null

  for (let n = 1; n <= maxN; n++) {
    const r = ratingForN(n)
    if (r == null || !Number.isFinite(r) || r <= 0) continue
    if (n * r >= designLoadA) {
      return { count: n, perCableRatingA: r, combinedRatingA: n * r, insufficient: false }
    }
  }

  const rMax = ratingForN(maxN) ?? 0
  return { count: maxN, perCableRatingA: rMax, combinedRatingA: rMax * maxN, insufficient: true }
}

/**
 * Combined current capacity of a supply's parallel cable set: the sum of
 * each cable's already-stored derated rating (each parallel cable's stored
 * value already includes its grouping derate). Null ratings count as 0.
 */
export function supplyParallelCapacity(
  cables: Array<{ derated_current_rating_a: number | null }>,
): number {
  return cables.reduce((sum, c) => sum + (c.derated_current_rating_a ?? 0), 0)
}
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-calc.service.test.ts`
Expected: PASS — all tests (the 4 existing `activeLengthM` tests + 5 `requiredParallelSet` + 2 `supplyParallelCapacity`).

- [ ] **Step 5: Typecheck shared**

Run: `pnpm --filter @esite/shared exec tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/cable-calc.service.ts packages/shared/src/services/cable-calc.service.test.ts
git commit -m "feat(cable-schedule): requiredParallelSet + supplyParallelCapacity calc helpers"
```

---

## Task 2: Extract `resolveCableElectricals` helper, rewire `addCableAction`

Pure refactor — no behaviour change. `addCableAction`'s SANS-lookup → derating → `deratedRating` block is extracted into a module-private async helper so `addParallelCableSetAction` (Task 4) can reuse it.

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts`

- [ ] **Step 1: Add the `resolveCableElectricals` helper**

In `apps/web/src/actions/cable-entities.actions.ts`, add this module-private async helper. Place it just above `addCableAction` (after the `cableSchema` definition). It reproduces exactly the logic currently inside `addCableAction` (lines ~434–471) — `lookupCableProperties`, `lookupDeratingFactors`, `deratedRating`, and `standard` are already imported at the top of the file:

```ts
/**
 * Resolves a cable's electrical fields from the SANS library: ohm/km (or a
 * manual override), the four derate factors, the grouping-aware derated
 * current rating, and the standard string. Shared by addCableAction and
 * addParallelCableSetAction so the lookup logic lives in one place.
 */
async function resolveCableElectricals(
  supabase: any,
  args: {
    conductor: 'CU' | 'AL'
    insulation: 'PVC' | 'XLPE' | 'PILC'
    cores: '3' | '3+E' | '4'
    sizeMm2: number
    installationMethod: 'DIRECT_IN_GROUND' | 'DUCT' | 'LADDER' | 'TRAY' | 'CLIPPED' | null
    depthMm: number | null
    thermalResistivityKmw: number
    ambientTempC: number
    groupedWith: number
    ohmPerKmOverride: number | null
    projectId: string
  },
): Promise<{
  ohm_per_km: number | null
  derate_depth: number
  derate_thermal: number
  derate_grouping: number
  derate_temp: number
  derated_current_rating_a: number | null
  standard: string
  manual_override: boolean
}> {
  const props = await lookupCableProperties(supabase, {
    conductor: args.conductor,
    insulation: args.insulation,
    cores: args.cores,
    size_mm2: args.sizeMm2,
    projectId: args.projectId,
  })

  const manualOverride = args.ohmPerKmOverride != null
  const ohmPerKm = manualOverride
    ? args.ohmPerKmOverride!
    : props?.ac_resistance ?? props?.dc_resistance ?? null

  const baseRating =
    args.installationMethod === 'DIRECT_IN_GROUND' ? props?.rating_direct_buried
    : args.installationMethod === 'DUCT'           ? props?.rating_in_duct
    : props?.rating_in_air

  const derate = await lookupDeratingFactors(supabase, {
    depth_mm: args.depthMm ?? 500,
    thermal_resistivity_kmw: args.thermalResistivityKmw,
    grouped_with: args.groupedWith,
    ambient_c: args.ambientTempC,
    insulation: args.insulation,
  })

  const deratedA = deratedRating(baseRating ?? null, {
    depth: derate.depth,
    thermal: derate.thermal,
    grouping: derate.grouping,
    temperature: derate.temperature,
  })

  const standard =
    args.insulation === 'XLPE' ? 'SANS 1507-4'
    : args.insulation === 'PVC' ? 'SANS 1507-3'
    : 'SANS 97'

  return {
    ohm_per_km: ohmPerKm,
    derate_depth: derate.depth,
    derate_thermal: derate.thermal,
    derate_grouping: derate.grouping,
    derate_temp: derate.temperature,
    derated_current_rating_a: deratedA,
    standard,
    manual_override: manualOverride,
  }
}
```

- [ ] **Step 2: Rewire `addCableAction` to use it**

In `addCableAction`, replace the block that currently spans from the `// SANS lookup for ohm_per_km + base rating + derate factors` comment through the `standard` const (the `props` / `manualOverride` / `ohmPerKm` / `baseRating` / `derate` / `deratedA` / `standard` declarations, ~lines 434–471) with a single call:

```ts
  // SANS lookup for ohm_per_km + base rating + derate factors
  const elec = await resolveCableElectricals(supabase as any, {
    conductor: parsed.data.conductor,
    insulation: parsed.data.insulation,
    cores: parsed.data.cores,
    sizeMm2: parsed.data.sizeMm2,
    installationMethod: parsed.data.installationMethod ?? null,
    depthMm: parsed.data.depthMm ?? null,
    thermalResistivityKmw: parsed.data.thermalResistivityKmw,
    ambientTempC: parsed.data.ambientTempC,
    groupedWith: parsed.data.groupedWith,
    ohmPerKmOverride: parsed.data.ohmPerKmOverride ?? null,
    projectId: guard.projectId,
  })
```

Then update the `.insert({ ... })` object in `addCableAction` so the electrical fields read from `elec` instead of the old locals:
- `standard: elec.standard,`
- `ohm_per_km: elec.ohm_per_km,`
- `derate_depth: elec.derate_depth,`
- `derate_thermal: elec.derate_thermal,`
- `derate_grouping: elec.derate_grouping,`
- `derate_temp: elec.derate_temp,`
- `derated_current_rating_a: elec.derated_current_rating_a,`
- `manual_override: elec.manual_override,`

All other insert fields (`supply_id`, `cable_no`, `size_mm2`, `cores`, etc.) stay exactly as they are. The behaviour is identical — same lookups, same values, just relocated.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing errors, zero errors in `cable-entities.actions.ts`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/actions/cable-entities.actions.ts"
git commit -m "refactor(cable-schedule): extract resolveCableElectricals from addCableAction"
```

---

## Task 3: `previewParallelCableSet` server action (read-only)

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts`

- [ ] **Step 1: Add the preview schema + action**

In `apps/web/src/actions/cable-entities.actions.ts`, add this near the other supply/cable schemas and actions (e.g. just after `addParallelCableSetAction` will go — placement is not critical, anywhere in the module after `resolveCableElectricals` and the `uuid` helper). It imports nothing new — `z`, `createClient`, `requiredParallelSet`, `assertDraft` are already in the file (`requiredParallelSet` must be added to the existing `@esite/shared` import line at the top of the file: change `import { lookupCableProperties, lookupDeratingFactors, deratedRating } from '@esite/shared'` to also import `requiredParallelSet`):

```ts
const previewParallelSchema = z.object({
  revisionId: uuid,
  fromSourceId: uuid.nullable().optional(),
  fromBoardId: uuid.nullable().optional(),
  toBoardId: uuid,
  designLoadA: z.number().positive(),
  sizeMm2: z.number().positive(),
  cores: z.enum(['3', '3+E', '4']),
  conductor: z.enum(['CU', 'AL']),
  insulation: z.enum(['PVC', 'XLPE', 'PILC']),
  installationMethod: z.enum(['DIRECT_IN_GROUND', 'DUCT', 'LADDER', 'TRAY', 'CLIPPED']),
  depthMm: z.number().int().positive().nullable().optional(),
  ambientTempC: z.number().default(30),
  thermalResistivityKmw: z.number().default(1.0),
})

const MAX_PARALLEL_N = 16

export async function previewParallelCableSet(
  input: z.infer<typeof previewParallelSchema>,
): Promise<{
  count?: number
  perCableRatingA?: number
  combinedRatingA?: number
  insufficient?: boolean
  mode?: 'create-set' | 'add-single'
  error?: string
}> {
  const parsed = previewParallelSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()

  const guard = await assertDraft(supabase, parsed.data.revisionId)
  if ('error' in guard) return { error: guard.error }

  // Per-cable base rating: same SANS lookup the cable insert uses, by install method.
  const props = await lookupCableProperties(supabase as any, {
    conductor: parsed.data.conductor,
    insulation: parsed.data.insulation,
    cores: parsed.data.cores,
    size_mm2: parsed.data.sizeMm2,
    projectId: guard.projectId,
  })
  const baseRating =
    parsed.data.installationMethod === 'DIRECT_IN_GROUND' ? props?.rating_direct_buried
    : parsed.data.installationMethod === 'DUCT'           ? props?.rating_in_duct
    : props?.rating_in_air

  // Grouping-aware: fetch the derate factors for every group size 1..MAX_PARALLEL_N
  // concurrently, build a per-N derated-rating lookup, then run the pure calc.
  const factorSets = await Promise.all(
    Array.from({ length: MAX_PARALLEL_N }, (_, i) =>
      lookupDeratingFactors(supabase as any, {
        depth_mm: parsed.data.depthMm ?? 500,
        thermal_resistivity_kmw: parsed.data.thermalResistivityKmw,
        grouped_with: i + 1,
        ambient_c: parsed.data.ambientTempC,
        insulation: parsed.data.insulation,
      }),
    ),
  )
  const ratingForN = (n: number): number | null => {
    if (n < 1 || n > MAX_PARALLEL_N) return null
    const f = factorSets[n - 1]!
    return deratedRating(baseRating ?? null, {
      depth: f.depth, thermal: f.thermal, grouping: f.grouping, temperature: f.temperature,
    })
  }

  const result = requiredParallelSet(parsed.data.designLoadA, ratingForN, MAX_PARALLEL_N)
  if (!result) {
    // No base rating resolved for this spec — the form falls back to a plain single add.
    return { error: 'No SANS rating found for this cable spec' }
  }

  // mode: does a supply already exist for this (from, to) pair, and does it have cables?
  let q = (supabase as any).schema('cable_schedule').from('supplies')
    .select('id').eq('revision_id', parsed.data.revisionId)
    .eq('to_board_id', parsed.data.toBoardId)
  q = parsed.data.fromSourceId
    ? q.eq('from_source_id', parsed.data.fromSourceId)
    : q.eq('from_board_id', parsed.data.fromBoardId)
  const { data: existingSupply } = await q.maybeSingle()
  let mode: 'create-set' | 'add-single' = 'create-set'
  if (existingSupply) {
    const { data: existingCables } = await (supabase as any)
      .schema('cable_schedule').from('cables')
      .select('id').eq('supply_id', (existingSupply as { id: string }).id).limit(1)
    if (existingCables && existingCables.length > 0) mode = 'add-single'
  }

  return {
    count: result.count,
    perCableRatingA: result.perCableRatingA,
    combinedRatingA: result.combinedRatingA,
    insufficient: result.insufficient,
    mode,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing errors, zero errors in `cable-entities.actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/actions/cable-entities.actions.ts"
git commit -m "feat(cable-schedule): previewParallelCableSet read-only server action"
```

---

## Task 4: `addParallelCableSetAction` server action (batch create)

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts`

- [ ] **Step 1: Add the batch-create schema + action**

In `apps/web/src/actions/cable-entities.actions.ts`, add this after `findOrCreateSupplyAction` (it calls `findOrCreateSupplyAction`, `resolveCableElectricals`, `assertDraft`, `revalidatePath` — all already in the module):

```ts
const addParallelCableSetSchema = z.object({
  revisionId: uuid,
  fromSourceId: uuid.nullable().optional(),
  fromBoardId: uuid.nullable().optional(),
  toBoardId: uuid,
  voltageV: z.number().positive(),
  designLoadA: z.number().positive(),
  section: z.enum(['NORMAL', 'EMERGENCY']).nullable().optional(),
  count: z.number().int().min(1).max(64),
  sizeMm2: z.number().positive(),
  cores: z.enum(['3', '3+E', '4']),
  conductor: z.enum(['CU', 'AL']),
  insulation: z.enum(['PVC', 'XLPE', 'PILC']),
  armour: z.enum(['SWA', 'UNARMOURED']).nullable().optional(),
  measuredLengthM: z.number().nonnegative().nullable().optional(),
  installationMethod: z.enum(['DIRECT_IN_GROUND', 'DUCT', 'LADDER', 'TRAY', 'CLIPPED']),
  depthMm: z.number().int().positive().nullable().optional(),
  ambientTempC: z.number().default(30),
  thermalResistivityKmw: z.number().default(1.0),
  ohmPerKmOverride: z.number().positive().nullable().optional(),
})

export async function addParallelCableSetAction(
  input: z.infer<typeof addParallelCableSetSchema>,
): Promise<{ supplyId?: string; createdCount?: number; error?: string }> {
  const parsed = addParallelCableSetSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()

  const guard = await assertDraft(supabase, parsed.data.revisionId)
  if ('error' in guard) return { error: guard.error }
  const { data: { user } } = await supabase.auth.getUser()

  // Resolve (or create) the supply for this (from, to) pair.
  const supplyResult = await findOrCreateSupplyAction({
    revisionId: parsed.data.revisionId,
    fromSourceId: parsed.data.fromSourceId ?? null,
    fromBoardId: parsed.data.fromBoardId ?? null,
    toBoardId: parsed.data.toBoardId,
    voltageV: parsed.data.voltageV,
    designLoadA: parsed.data.designLoadA,
    section: parsed.data.section ?? null,
  })
  if (supplyResult.error || !supplyResult.supplyId) {
    return { error: supplyResult.error ?? 'Could not resolve supply' }
  }
  const supplyId = supplyResult.supplyId

  // Empty-supply guard: only bulk-create when the supply has no cables yet.
  // Otherwise fall back to adding a single cable (clamp the count to 1).
  const { data: existingCables } = await (supabase as any)
    .schema('cable_schedule').from('cables')
    .select('cable_no').eq('supply_id', supplyId)
    .order('cable_no', { ascending: false })
  const existing = (existingCables ?? []) as Array<{ cable_no: number }>
  const startNo = (existing[0]?.cable_no ?? 0) + 1
  const effectiveCount = existing.length > 0 ? 1 : parsed.data.count

  // All cables in the set share spec + group size, so resolve electricals once.
  const elec = await resolveCableElectricals(supabase as any, {
    conductor: parsed.data.conductor,
    insulation: parsed.data.insulation,
    cores: parsed.data.cores,
    sizeMm2: parsed.data.sizeMm2,
    installationMethod: parsed.data.installationMethod,
    depthMm: parsed.data.depthMm ?? null,
    thermalResistivityKmw: parsed.data.thermalResistivityKmw,
    ambientTempC: parsed.data.ambientTempC,
    groupedWith: effectiveCount,
    ohmPerKmOverride: parsed.data.ohmPerKmOverride ?? null,
    projectId: guard.projectId,
  })

  const rows = Array.from({ length: effectiveCount }, (_, i) => ({
    supply_id: supplyId,
    revision_id: parsed.data.revisionId,
    organisation_id: guard.orgId,
    cable_no: startNo + i,
    size_mm2: parsed.data.sizeMm2,
    cores: parsed.data.cores,
    conductor: parsed.data.conductor,
    insulation: parsed.data.insulation,
    armour: parsed.data.armour ?? 'SWA',
    standard: elec.standard,
    measured_length_m: parsed.data.measuredLengthM ?? null,
    length_status: parsed.data.measuredLengthM != null ? 'MEASURED' : 'UNMEASURED',
    installation_method: parsed.data.installationMethod,
    depth_mm: parsed.data.depthMm ?? null,
    grouped_with: effectiveCount,
    ambient_temp_c: parsed.data.ambientTempC,
    thermal_resistivity_kmw: parsed.data.thermalResistivityKmw,
    ohm_per_km: elec.ohm_per_km,
    derate_depth: elec.derate_depth,
    derate_thermal: elec.derate_thermal,
    derate_grouping: elec.derate_grouping,
    derate_temp: elec.derate_temp,
    derated_current_rating_a: elec.derated_current_rating_a,
    manual_override: elec.manual_override,
  }))

  // One array insert — atomic at the statement level (no partial parallel sets).
  const { error } = await (supabase as any)
    .schema('cable_schedule').from('cables').insert(rows)
  if (error) return { error: error.message }

  // Best-effort audit entry.
  try {
    await (supabase as any).schema('cable_schedule').from('change_log').insert({
      revision_id: parsed.data.revisionId,
      organisation_id: guard.orgId,
      entity_type: 'supply',
      entity_id: supplyId,
      field_name: 'cables',
      old_value: null,
      new_value: `auto-parallel: ${effectiveCount} cable(s)`,
      changed_by: user?.id ?? null,
    })
  } catch {
    // a logging failure must never surface to the caller
  }

  revalidatePath(`/projects/${guard.projectId}/cables/${parsed.data.revisionId}`)
  return { supplyId, createdCount: effectiveCount }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing errors, zero errors in `cable-entities.actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/actions/cable-entities.actions.ts"
git commit -m "feat(cable-schedule): addParallelCableSetAction batch-create server action"
```

---

## Task 5: Add-cable form — live readout, count field, mode-aware Add

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx`

- [ ] **Step 1: Import the new actions + React hooks**

At the top of `AddEntityPanel.tsx`, the import of the actions currently reads `import { findOrCreateSupplyAction, addCableAction } from '@/actions/cable-entities.actions'`. Extend it to also import the two new actions:

```tsx
import {
  findOrCreateSupplyAction,
  addCableAction,
  previewParallelCableSet,
  addParallelCableSetAction,
} from '@/actions/cable-entities.actions'
```

Confirm `useState` and `useEffect` are imported from `'react'` at the top of the file (the file already imports `useState` and `useTransition`; add `useEffect` and `useRef` to that import if not present).

- [ ] **Step 2: Add preview state + a debounced effect inside `CableForm`**

Inside `CableForm`, alongside the existing `useState` hooks (after `const [ohmOverride, setOhmOverride] = useState('')`), add:

```tsx
  const [preview, setPreview] = useState<{
    count: number
    perCableRatingA: number
    combinedRatingA: number
    insufficient: boolean
    mode: 'create-set' | 'add-single'
  } | null>(null)
  const [count, setCount] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

Then add this effect (place it after the state hooks, before `go()`). It debounce-calls `previewParallelCableSet` whenever the design load or any rating-affecting field changes. It is best-effort — any failure just clears the readout:

```tsx
  useEffect(() => {
    const [kind, id] = fromKey.split(':')
    const loadNum = Number(load)
    if (!kind || !id || !toBoardId || !loadNum || loadNum <= 0) {
      setPreview(null)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await previewParallelCableSet({
        revisionId,
        fromSourceId: kind === 'source' ? id! : null,
        fromBoardId: kind === 'board' ? id! : null,
        toBoardId,
        designLoadA: loadNum,
        sizeMm2: Number(sizeMm2),
        cores,
        conductor,
        insulation,
        installationMethod: installMethod,
        depthMm: depthMm ? Number(depthMm) : null,
        ambientTempC: 30,
        thermalResistivityKmw: 1.0,
      })
      if (res.error || res.count == null) {
        setPreview(null)
        return
      }
      const next = {
        count: res.count,
        perCableRatingA: res.perCableRatingA!,
        combinedRatingA: res.combinedRatingA!,
        insufficient: res.insufficient!,
        mode: res.mode!,
      }
      setPreview(next)
      // Pre-fill the count field only in create-set mode and only when the
      // user has not started editing it (empty string == untouched).
      setCount((prev) => (prev === '' && next.mode === 'create-set' && !next.insufficient
        ? String(next.count) : prev))
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [revisionId, fromKey, toBoardId, load, sizeMm2, cores, conductor, insulation, installMethod, depthMm])
```

- [ ] **Step 3: Rewrite `go()` to branch on mode**

Replace the existing `go()` function in `CableForm` with this version. The `create-set` branch (supply empty, a valid non-insufficient count) calls `addParallelCableSetAction`; everything else is the existing single-cable path, unchanged:

```tsx
  function go() {
    const [kind, id] = fromKey.split(':')
    const setCountNum = Number(count)
    const useSet =
      preview != null &&
      preview.mode === 'create-set' &&
      !preview.insufficient &&
      Number.isFinite(setCountNum) &&
      setCountNum >= 1

    if (useSet) {
      onSubmit(
        async () => {
          if (!kind || !id) return { error: 'Please select a valid From node' }
          return addParallelCableSetAction({
            revisionId,
            fromSourceId: kind === 'source' ? id! : null,
            fromBoardId: kind === 'board' ? id! : null,
            toBoardId,
            voltageV: Number(voltage),
            designLoadA: Number(load),
            section: (section || null) as 'NORMAL' | 'EMERGENCY' | null | undefined,
            count: setCountNum,
            sizeMm2: Number(sizeMm2),
            cores,
            conductor,
            insulation,
            measuredLengthM: measuredLengthM ? Number(measuredLengthM) : null,
            installationMethod: installMethod,
            depthMm: depthMm ? Number(depthMm) : null,
            ambientTempC: 30,
            thermalResistivityKmw: 1.0,
            ohmPerKmOverride: ohmOverride ? Number(ohmOverride) : null,
          })
        },
        `${setCountNum} cable${setCountNum === 1 ? '' : 's'}`,
      )
    } else {
      onSubmit(
        async () => {
          if (!kind || !id) return { error: 'Please select a valid From node' }
          const supplyResult = await findOrCreateSupplyAction({
            revisionId,
            fromSourceId: kind === 'source' ? id! : null,
            fromBoardId: kind === 'board' ? id! : null,
            toBoardId,
            voltageV: Number(voltage),
            designLoadA: Number(load),
            section: (section || null) as 'NORMAL' | 'EMERGENCY' | null | undefined,
          })
          if (supplyResult.error) return { error: supplyResult.error }
          return addCableAction({
            supplyId: supplyResult.supplyId!,
            sizeMm2: Number(sizeMm2),
            cores,
            conductor,
            insulation,
            measuredLengthM: measuredLengthM ? Number(measuredLengthM) : null,
            installationMethod: installMethod,
            depthMm: depthMm ? Number(depthMm) : null,
            groupedWith: Number(groupedWith),
            ambientTempC: 30,
            thermalResistivityKmw: 1.0,
            ohmPerKmOverride: ohmOverride ? Number(ohmOverride) : null,
          })
        },
        'Cable',
      )
    }
    setMeasuredLengthM(''); setOhmOverride('')
  }
```

- [ ] **Step 4: Render the readout + count field**

In `CableForm`'s returned JSX, insert a readout block + count field as full-width grid items immediately **before** the `<SubmitButton ... />`. Use a `<Field>` (it already supports `wide`) for the count input:

```tsx
      {preview && (
        <div style={{ gridColumn: '1 / -1', fontSize: 12, fontFamily: 'var(--font-mono)',
          padding: '8px 10px', borderRadius: 4, border: '1px solid var(--c-border)',
          background: 'var(--c-base)',
          color: preview.insufficient ? 'var(--c-red)' : 'var(--c-text-mid)' }}>
          {preview.insufficient
            ? `⚠ Even 16 in parallel won't carry ${Number(load)} A at this size — pick a larger cable.`
            : preview.mode === 'add-single'
              ? `This supply already has cables — Add will add 1 more. (≈${preview.count} recommended for ${Number(load)} A.)`
              : `${preview.count} × ${sizeMm2}mm² ${conductor === 'CU' ? 'Cu' : 'Al'} → combined ${Math.round(preview.combinedRatingA)} A (≥ ${Number(load)} A design load)`}
        </div>
      )}
      {preview && preview.mode === 'create-set' && !preview.insufficient && (
        <Field label="Cables in parallel" wide>
          <input className="ob-input" type="number" min="1" step="1" value={count}
            onChange={(e) => setCount(e.target.value)} />
          {Number(count) > 0 && Number(count) < preview.count && (
            <span style={{ fontSize: 11, color: 'var(--c-warning)', display: 'block', marginTop: 4 }}>
              Below recommended ({preview.count}).
            </span>
          )}
        </Field>
      )}
```

- [ ] **Step 5: Make the Add button label mode-aware**

The `<SubmitButton>` currently has `label="Add cable"`. Make it reflect the mode — replace that prop with:

```tsx
        label={
          preview && preview.mode === 'create-set' && !preview.insufficient && Number(count) >= 1
            ? `Add ${Number(count)} cable${Number(count) === 1 ? '' : 's'}`
            : 'Add cable'
        }
```

The `disabled` prop on `<SubmitButton>` stays as-is (`pending || !fromKey || !toBoardId || !load || !sizeMm2`).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing errors, zero errors in `AddEntityPanel.tsx`.

- [ ] **Step 7: Preview-verify (best-effort)**

Per the Conventions preview note, the dev server may not reach Supabase. If it does: open a DRAFT revision with at least one source + board, open `+ Add cable`, set design load to 1600 and size to 240 — confirm the readout shows a parallel count and an editable "Cables in parallel" field, and the Add button reads "Add N cables". If the dev server can't authenticate, report DONE_WITH_CONCERNS noting preview was skipped.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx"
git commit -m "feat(cable-schedule): Add-cable form — live parallel readout + auto-create"
```

---

## Task 6: Grid under-rating flag + supply-level utilisation

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`

- [ ] **Step 1: Extend `ScheduleRow` with two fields**

In `CableScheduleGrid.tsx`, add two fields to the `ScheduleRow` interface (place them after `derated_rating_a`):

```tsx
  /** Sum of the supply's cables' derated ratings (grouping-aware combined capacity), in A. */
  combined_capacity_a: number
  /** True when the supply's combined capacity is below its design load. */
  supply_under_rated: boolean
```

- [ ] **Step 2: Make `utilisationPct` supply-level**

In `CableScheduleGrid.tsx`, replace the `utilisationPct` function:

```tsx
function utilisationPct(r: ScheduleRow): number | null {
  if (r.combined_capacity_a <= 0 || r.load_a == null) return null
  return (r.load_a / r.combined_capacity_a) * 100
}
```

(It now divides the supply's design load by the *combined* parallel capacity, so a healthy 5-parallel set reads ~94% instead of ~600%.)

- [ ] **Step 3: Render the under-rating flag**

In `CableScheduleGrid.tsx`, in the table-row JSX, find the `<Td>` that renders `r.derated_rating_a` (`{fmt(r.derated_rating_a, 0)}` — around line 572-573). Immediately after that derated-rating value, render a flag when the supply is under-rated. Change that `<Td>` body to:

```tsx
        <Td align="right" style={{ color: utilTooHot ? '#dc2626' : 'var(--c-text)' }}>
          {fmt(r.derated_rating_a, 0)}
          {r.supply_under_rated && (
            <span
              title={`Supply under-rated: ${Math.round(r.combined_capacity_a)} A combined capacity < ${r.load_a ?? '?'} A design load`}
              style={{ marginLeft: 6, color: 'var(--c-red)', fontWeight: 700, cursor: 'help' }}
            >
              ⚠
            </span>
          )}
        </Td>
```

(`utilTooHot` is an existing local in that row's scope — leave it as-is. If the exact `<Td>` markup differs slightly from the quote, preserve whatever attributes it already has and only add the `{r.supply_under_rated && (...)}` block after the `{fmt(r.derated_rating_a, 0)}` expression.)

- [ ] **Step 4: Compute the two fields in `page.tsx`**

In `page.tsx`, add `supplyParallelCapacity` to the existing `@esite/shared` import (the file already imports `computeCumulativeVdMap`, `voltDropPctForSupply`, etc. from `@esite/shared` — add `supplyParallelCapacity` to that import list).

After the `cables` array is built (`const cables = (cablesRes?.data ?? []) as unknown as CableRow[]`) and before the `rows` `.map()`, add a per-supply capacity map:

```tsx
  // Per-supply combined parallel capacity (sum of cables' derated ratings) +
  // an under-rated flag (combined capacity below the supply's design load).
  const capacityBySupply = new Map<string, number>()
  for (const sup of supplies) {
    const supCables = cables.filter((c) => c.supply_id === sup.id)
    capacityBySupply.set(sup.id, supplyParallelCapacity(supCables))
  }
```

Then, in **both** return branches of the `rows = cables.map((c) => { ... })` block, add the two new fields to the returned `ScheduleRow` object. In the **no-supply branch** (where `supply` is undefined) add:

```tsx
      combined_capacity_a: 0,
      supply_under_rated: false,
```

In the **with-supply branch** add:

```tsx
    combined_capacity_a: capacityBySupply.get(c.supply_id) ?? 0,
    supply_under_rated: supply.design_load_a != null
      && (capacityBySupply.get(c.supply_id) ?? 0) < supply.design_load_a,
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no NEW errors — only the 5 known pre-existing errors, zero errors in `page.tsx` or `CableScheduleGrid.tsx`.

- [ ] **Step 6: Preview-verify (best-effort)**

Per the Conventions preview note — if the dev server can authenticate: open a revision with a cable whose supply's design load exceeds the cables' combined capacity, confirm the ⚠ flag shows on those rows and the utilisation column reads a sane supply-level percentage. If the dev server can't reach Supabase, report DONE_WITH_CONCERNS noting preview was skipped.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"
git commit -m "feat(cable-schedule): grid supply under-rating flag + supply-level utilisation"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typechecks**

Run: `pnpm --filter web exec tsc --noEmit` — expect only the 5 known pre-existing errors, none in any file this plan touched.
Run: `pnpm --filter @esite/shared exec tsc --noEmit` — expect exit 0, no output.

- [ ] **Step 2: Run the shared unit tests**

Run: `pnpm --filter @esite/shared exec vitest run src/services/cable-calc.service.test.ts`
Expected: PASS — 11 tests (4 existing `activeLengthM` + 5 `requiredParallelSet` + 2 `supplyParallelCapacity`).

- [ ] **Step 3: Consistency scan**

Run `grep -n "requiredParallelSet\|supplyParallelCapacity\|resolveCableElectricals\|previewParallelCableSet\|addParallelCableSetAction" packages/shared/src/services/cable-calc.service.ts apps/web/src/actions/cable-entities.actions.ts apps/web/src/app/\(admin\)/projects/\[id\]/cables/\[revisionId\]/AddEntityPanel.tsx apps/web/src/app/\(admin\)/projects/\[id\]/cables/\[revisionId\]/page.tsx` — confirm each symbol is defined once and referenced where expected; no typos / name drift.

- [ ] **Step 4: Preview walkthrough (best-effort)**

If the dev server can authenticate against Supabase: add a 1600 A supply, pick 4-core 240mm² Cu — confirm the readout shows a grouping-aware count and Add creates that many cables; switch the conductor to Al and confirm the count rises; confirm the grid ⚠ flag and the supply-level utilisation behave. If the dev env can't reach Supabase, note that the walkthrough is deferred and the verification rests on Steps 1-3.

---

## Self-review notes

**Spec coverage:** Spec §3 Section 1 (the calc) → Task 1. Section 2 (server actions) → Task 2 (the extracted `resolveCableElectricals` helper the spec calls for) + Task 3 (`previewParallelCableSet`) + Task 4 (`addParallelCableSetAction`). Section 3 (form UX) → Task 5. Section 4 (grid flag + supply-level utilisation) → Task 6. Spec §6 (testing) → Task 1's TDD + Task 7. All four design sections covered.

**Type consistency:** `requiredParallelSet(designLoadA, ratingForN, maxN?)` returns `ParallelSetResult | null` — consumed in Task 3 exactly that way. `supplyParallelCapacity(cables)` takes `Array<{ derated_current_rating_a: number | null }>` — `CableRow extends CableForCalc` and carries `derated_current_rating_a`, so `cables.filter(...)` in Task 6 satisfies it. `previewParallelCableSet` returns `{ count?, perCableRatingA?, combinedRatingA?, insufficient?, mode?, error? }` — Task 5's effect reads exactly those. `addParallelCableSetAction` input schema matches the object Task 5's `go()` builds field-for-field. `ScheduleRow`'s two new fields (`combined_capacity_a`, `supply_under_rated`) are added in Task 6 Step 1 and populated in Task 6 Step 4's two branches.

**No placeholders:** every code step shows complete code; commands have exact expected output; the 5-error typecheck baseline is defined in Conventions and referenced consistently.

**Deferred (out of scope):** Topic A (structure hierarchy) is a separate spec; no recompute migration for historical `derated_current_rating_a`; auto-sizing the cable is intentionally not done.
