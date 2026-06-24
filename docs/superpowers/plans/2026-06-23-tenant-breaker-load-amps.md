# Tenant Breaker / Load / Amps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each tenant's incoming-supply Breaker (A + poles), Load (A), and cable Amps capacity on the on-screen tenant schedule, derived from the cable schedule and persisted on the tenant node.

**Architecture:** A pure derivation engine + pure per-project computation in `@esite/shared` (TDD, no I/O). A migration adds `incomer_*` columns to `structure.nodes`. A server-only recompute module reads cable data (service client) and writes the columns via raw PostgREST (`Content-Profile: structure`), wired into cable mutations + a backfill. The on-screen `ScheduleTable` renders the persisted columns.

**Tech Stack:** TypeScript, Next.js (App Router, server actions), Supabase/PostgREST, vitest, pnpm workspaces (`@esite/shared`, `web`).

**Spec:** `docs/superpowers/specs/2026-06-23-tenant-breaker-load-amps-design.md`

---

## File Structure

**New**
- `packages/shared/src/structure/breaker-sizing.ts` — pure: standard series, `nextStandardBreaker`, `poleConfigFromCores`, `deriveIncomerBreaker`.
- `packages/shared/src/structure/breaker-sizing.test.ts`
- `packages/shared/src/structure/tenant-electrical.ts` — pure: `computeTenantElectrical` (incomer resolution + derivation per node).
- `packages/shared/src/structure/tenant-electrical.test.ts`
- `apps/edge-functions/supabase/migrations/00144_tenant_incomer_electrical.sql`
- `apps/web/src/lib/tenant-electrical/recompute.ts` — server-only I/O: read cables, compute, write nodes.
- `scripts/db/backfill-tenant-electrical.ts`

**Modified**
- `packages/shared/src/structure/types.ts` — `Node` gains `incomer_*` fields.
- `packages/shared/src/structure/index.ts` — export new modules.
- `apps/web/src/actions/cable-entities.actions.ts`, `cable-length.actions.ts`, `cable-revision.actions.ts` — call recompute after mutations.
- `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx` (+ new `ScheduleTable.test.tsx`).

---

## Task 1: Breaker-sizing engine (pure)

**Files:**
- Create: `packages/shared/src/structure/breaker-sizing.ts`
- Test: `packages/shared/src/structure/breaker-sizing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/structure/breaker-sizing.test.ts
import { describe, it, expect } from 'vitest'
import {
  STANDARD_BREAKER_SERIES,
  nextStandardBreaker,
  poleConfigFromCores,
  deriveIncomerBreaker,
} from './breaker-sizing'

describe('nextStandardBreaker', () => {
  it('rounds up to the next standard size', () => {
    expect(nextStandardBreaker(60)).toBe(63)
    expect(nextStandardBreaker(64)).toBe(80)
    expect(nextStandardBreaker(5)).toBe(6)
  })
  it('returns the exact size when on a boundary', () => {
    expect(nextStandardBreaker(63)).toBe(63)
    expect(nextStandardBreaker(6)).toBe(6)
    expect(nextStandardBreaker(1600)).toBe(1600)
  })
  it('returns null for over-range, null, zero, or negative', () => {
    expect(nextStandardBreaker(1601)).toBeNull()
    expect(nextStandardBreaker(null)).toBeNull()
    expect(nextStandardBreaker(0)).toBeNull()
    expect(nextStandardBreaker(-5)).toBeNull()
  })
  it('exposes the full series', () => {
    expect(STANDARD_BREAKER_SERIES[0]).toBe(6)
    expect(STANDARD_BREAKER_SERIES[STANDARD_BREAKER_SERIES.length - 1]).toBe(1600)
  })
})

describe('poleConfigFromCores', () => {
  it('maps three-phase cores to TP', () => {
    expect(poleConfigFromCores('3')).toBe('TP')
    expect(poleConfigFromCores('3+E')).toBe('TP')
    expect(poleConfigFromCores('4')).toBe('TP')
  })
  it('maps other cores to SP and null to null', () => {
    expect(poleConfigFromCores('2')).toBe('SP')
    expect(poleConfigFromCores(null)).toBeNull()
  })
})

describe('deriveIncomerBreaker', () => {
  it('derives breaker + poles from load and cores', () => {
    expect(deriveIncomerBreaker({ designLoadA: 60, cores: '3', capacityA: 170 })).toEqual({
      breakerA: 63,
      poleConfig: 'TP',
      underProtected: false,
    })
  })
  it('flags under-protected when the breaker exceeds cable capacity', () => {
    expect(deriveIncomerBreaker({ designLoadA: 60, cores: '3', capacityA: 50 })).toEqual({
      breakerA: 63,
      poleConfig: 'TP',
      underProtected: true,
    })
  })
  it('cannot assess under-protection when capacity is unknown', () => {
    const r = deriveIncomerBreaker({ designLoadA: 60, cores: '3', capacityA: null })
    expect(r.breakerA).toBe(63)
    expect(r.underProtected).toBe(false)
  })
  it('returns null breaker when load is missing', () => {
    expect(deriveIncomerBreaker({ designLoadA: null, cores: '3', capacityA: 170 })).toEqual({
      breakerA: null,
      poleConfig: 'TP',
      underProtected: false,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/structure/breaker-sizing.test.ts`
Expected: FAIL — cannot find module `./breaker-sizing`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/structure/breaker-sizing.ts
/**
 * Standard SANS/IEC 60898 / 60947-2 preferred breaker current ratings (amps).
 */
export const STANDARD_BREAKER_SERIES = [
  6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 630,
  800, 1000, 1250, 1600,
] as const

export type PoleConfig = 'SP' | 'TP'

/** Smallest standard breaker >= amps, or null if amps is invalid or over-range. */
export function nextStandardBreaker(amps: number | null): number | null {
  if (amps == null || !Number.isFinite(amps) || amps <= 0) return null
  for (const size of STANDARD_BREAKER_SERIES) {
    if (size >= amps) return size
  }
  return null
}

/** TP for three-phase cores (3 / 3+E / 4); SP otherwise; null when cores unknown. */
export function poleConfigFromCores(cores: string | null): PoleConfig | null {
  if (cores == null) return null
  return cores === '3' || cores === '3+E' || cores === '4' ? 'TP' : 'SP'
}

export interface DeriveIncomerBreakerInput {
  designLoadA: number | null
  cores: string | null
  capacityA: number | null
}

export interface DerivedBreaker {
  breakerA: number | null
  poleConfig: PoleConfig | null
  underProtected: boolean
}

/** Load-based breaker sizing with SANS 10142-1 coordination flag. */
export function deriveIncomerBreaker(input: DeriveIncomerBreakerInput): DerivedBreaker {
  const breakerA = nextStandardBreaker(input.designLoadA)
  const poleConfig = poleConfigFromCores(input.cores)
  const underProtected =
    breakerA != null && input.capacityA != null && breakerA > input.capacityA
  return { breakerA, poleConfig, underProtected }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/structure/breaker-sizing.test.ts`
Expected: PASS (all 4 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/structure/breaker-sizing.ts packages/shared/src/structure/breaker-sizing.test.ts
git commit -m "feat(shared): breaker-sizing engine (load->next standard, poles from cores)"
```

---

## Task 2: Per-project tenant-electrical computation (pure)

**Files:**
- Create: `packages/shared/src/structure/tenant-electrical.ts`
- Test: `packages/shared/src/structure/tenant-electrical.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/structure/tenant-electrical.test.ts
import { describe, it, expect } from 'vitest'
import { computeTenantElectrical } from './tenant-electrical'

const REV = 'rev-1'

describe('computeTenantElectrical', () => {
  it('derives values for a single-incomer tenant', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [{ id: 's1', to_node_id: 'n1', design_load_a: 60 }],
      new Map([['s1', [{ derated_current_rating_a: 90, cores: '3' }]]]),
      REV,
    )
    expect(out.get('n1')).toEqual({
      breakerA: 63,
      poleConfig: 'TP',
      loadA: 60,
      capacityA: 90,
      underProtected: false,
      multipleFeeds: false,
      sourceRevisionId: REV,
    })
  })

  it('picks the highest-load feed and flags multiple feeds', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [
        { id: 's1', to_node_id: 'n1', design_load_a: 40 },
        { id: 's2', to_node_id: 'n1', design_load_a: 100 },
      ],
      new Map([
        ['s1', [{ derated_current_rating_a: 50, cores: '3' }]],
        ['s2', [{ derated_current_rating_a: 60, cores: '4' }]],
      ]),
      REV,
    )
    const r = out.get('n1')!
    expect(r.loadA).toBe(100)
    expect(r.breakerA).toBe(100)
    expect(r.poleConfig).toBe('TP')
    expect(r.multipleFeeds).toBe(true)
  })

  it('sums parallel cable capacity', () => {
    const out = computeTenantElectrical(
      ['n1'],
      [{ id: 's1', to_node_id: 'n1', design_load_a: 150 }],
      new Map([['s1', [
        { derated_current_rating_a: 95, cores: '4' },
        { derated_current_rating_a: 95, cores: '4' },
      ]]]),
      REV,
    )
    expect(out.get('n1')!.capacityA).toBe(190)
  })

  it('omits tenants with no incoming supply', () => {
    const out = computeTenantElectrical(['n1', 'n2'], [{ id: 's1', to_node_id: 'n1', design_load_a: 60 }], new Map([['s1', []]]), REV)
    expect(out.has('n2')).toBe(false)
  })

  it('reports null capacity when the incomer has no cables', () => {
    const out = computeTenantElectrical(['n1'], [{ id: 's1', to_node_id: 'n1', design_load_a: 60 }], new Map([['s1', []]]), REV)
    expect(out.get('n1')!.capacityA).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/structure/tenant-electrical.test.ts`
Expected: FAIL — cannot find module `./tenant-electrical`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/structure/tenant-electrical.ts
import { deriveIncomerBreaker, type PoleConfig } from './breaker-sizing'
import { supplyParallelCapacity } from '../services/cable-calc.service'

export interface SupplyRow {
  id: string
  to_node_id: string | null
  design_load_a: number | null
}

export interface CableRow {
  derated_current_rating_a: number | null
  cores: string | null
}

export interface TenantElectrical {
  breakerA: number | null
  poleConfig: PoleConfig | null
  loadA: number | null
  capacityA: number | null
  underProtected: boolean
  multipleFeeds: boolean
  sourceRevisionId: string | null
}

/**
 * Resolve each tenant node's incomer (max design_load_a if several feed it) and
 * derive its breaker/load/amps. Returns one entry per node that has ≥1 supply.
 */
export function computeTenantElectrical(
  tenantNodeIds: string[],
  supplies: SupplyRow[],
  cablesBySupply: Map<string, CableRow[]>,
  revisionId: string | null,
): Map<string, TenantElectrical> {
  const tenantSet = new Set(tenantNodeIds)
  const byNode = new Map<string, SupplyRow[]>()
  for (const s of supplies) {
    if (s.to_node_id == null || !tenantSet.has(s.to_node_id)) continue
    const list = byNode.get(s.to_node_id) ?? []
    list.push(s)
    byNode.set(s.to_node_id, list)
  }

  const result = new Map<string, TenantElectrical>()
  for (const [nodeId, feeds] of byNode) {
    const incomer = feeds.reduce((best, s) =>
      (s.design_load_a ?? -Infinity) > (best.design_load_a ?? -Infinity) ? s : best,
    )
    const cables = cablesBySupply.get(incomer.id) ?? []
    const capacityA = cables.length > 0 ? supplyParallelCapacity(cables) : null
    const cores = cables.find((c) => c.cores != null)?.cores ?? null
    const derived = deriveIncomerBreaker({ designLoadA: incomer.design_load_a, cores, capacityA })
    result.set(nodeId, {
      breakerA: derived.breakerA,
      poleConfig: derived.poleConfig,
      loadA: incomer.design_load_a,
      capacityA,
      underProtected: derived.underProtected,
      multipleFeeds: feeds.length > 1,
      sourceRevisionId: revisionId,
    })
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/structure/tenant-electrical.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the package index**

In `packages/shared/src/structure/index.ts`, append:

```ts
export {
  STANDARD_BREAKER_SERIES,
  nextStandardBreaker,
  poleConfigFromCores,
  deriveIncomerBreaker,
} from './breaker-sizing';
export type { PoleConfig, DerivedBreaker } from './breaker-sizing';
export { computeTenantElectrical } from './tenant-electrical';
export type { SupplyRow, CableRow, TenantElectrical } from './tenant-electrical';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/structure/tenant-electrical.ts packages/shared/src/structure/tenant-electrical.test.ts packages/shared/src/structure/index.ts
git commit -m "feat(shared): computeTenantElectrical (incomer resolution + derivation)"
```

---

## Task 3: Migration + Node type

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00144_tenant_incomer_electrical.sql`
- Modify: `packages/shared/src/structure/types.ts:39-44`

- [ ] **Step 1: Write the migration**

```sql
-- 00144_tenant_incomer_electrical.sql
-- Persisted, derived incoming-supply electrical sizing for tenant nodes.
--
-- Computed from the cable schedule (latest revision of any status):
--   incomer_load_a      = the incomer supply's design_load_a
--   incomer_capacity_a  = sum of the incomer cables' derated_current_rating_a
--   incomer_breaker_a   = design load rounded up to the next standard breaker
--   incomer_pole_config = TP/SP from the incomer cable cores
--   incomer_under_protected = breaker > capacity (SANS 10142-1 coordination)
--   incomer_multiple_feeds  = >1 supply feeds this node (max-load one chosen)
-- Manual breaker_rating_a / pole_config (boards) are kept separate and win on display.
--
-- Additive + nullable — safe to apply ahead of the consuming code.

ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS incomer_breaker_a        numeric,
  ADD COLUMN IF NOT EXISTS incomer_pole_config      text
    CHECK (incomer_pole_config IS NULL OR incomer_pole_config IN ('SP','TP')),
  ADD COLUMN IF NOT EXISTS incomer_load_a           numeric,
  ADD COLUMN IF NOT EXISTS incomer_capacity_a       numeric,
  ADD COLUMN IF NOT EXISTS incomer_under_protected  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incomer_multiple_feeds   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS incomer_source_revision_id uuid
    REFERENCES cable_schedule.revisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS incomer_computed_at      timestamptz;

-- Expose new columns to the PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Add the fields to the `Node` type**

In `packages/shared/src/structure/types.ts`, after the `// Electrical facet` block (line 44, after `voltage_v`), insert:

```ts
  // Derived incoming-supply electrical (migration 00144) — persisted by recompute
  incomer_breaker_a: number | null;
  incomer_pole_config: string | null;
  incomer_load_a: number | null;
  incomer_capacity_a: number | null;
  incomer_under_protected: boolean;
  incomer_multiple_feeds: boolean;
  incomer_source_revision_id: string | null;
  incomer_computed_at: string | null;
```

- [ ] **Step 3: Apply the migration locally**

Run: `cd apps/edge-functions && supabase db push` (or `pnpm db:migrate` from repo root).
Expected: migration `00144` applies; no errors.

- [ ] **Step 4: Type-check shared**

Run: `pnpm --filter @esite/shared exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00144_tenant_incomer_electrical.sql packages/shared/src/structure/types.ts
git commit -m "feat(db): persisted incomer_* electrical columns on structure.nodes"
```

---

## Task 4: Recompute module (read cables → compute → write nodes)

**Files:**
- Create: `apps/web/src/lib/tenant-electrical/recompute.ts`

- [ ] **Step 1: Write the recompute module**

```ts
// apps/web/src/lib/tenant-electrical/recompute.ts
//
// Server-only. Recomputes persisted incomer_* electrical fields on a project's
// tenant nodes from the latest cable revision (any status).
//
// Cross-schema WRITE gotcha (CLAUDE.md 2026-05-18): supabase-js .schema('structure')
// silently drops the service-role auth header on UPDATE → RLS denies. Writes here
// use raw PostgREST PATCH with Content-Profile: structure + the service-role key.
// Reads go through the service client (.schema('cable_schedule'/'structure')).

import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { computeTenantElectrical, type SupplyRow, type CableRow } from '@esite/shared'

function serverEnv(): { supabaseUrl: string; serviceKey: string } | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return null
  return { supabaseUrl, serviceKey }
}

export async function recomputeTenantElectrical(
  projectId: string,
): Promise<{ updated: number } | { error: string }> {
  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }
  const service = createServiceClient()

  // Tenant nodes (active + decommissioned; deleted excluded).
  const { data: nodeRows, error: nodeErr } = await service
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('project_id', projectId)
    .eq('kind', 'tenant_db')
    .is('deleted_at', null)
  if (nodeErr) return { error: nodeErr.message }
  const nodeIds = (nodeRows ?? []).map((n) => (n as { id: string }).id)
  if (nodeIds.length === 0) return { updated: 0 }

  // Latest revision of any status for this project.
  const { data: rev } = await service
    .schema('cable_schedule')
    .from('revisions')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const revisionId = (rev as { id: string } | null)?.id ?? null

  let supplies: SupplyRow[] = []
  const cablesBySupply = new Map<string, CableRow[]>()
  if (revisionId) {
    const { data: supplyRows } = await service
      .schema('cable_schedule')
      .from('supplies')
      .select('id, to_node_id, design_load_a')
      .eq('revision_id', revisionId)
      .in('to_node_id', nodeIds)
    supplies = (supplyRows ?? []) as SupplyRow[]

    const supplyIds = supplies.map((s) => s.id)
    if (supplyIds.length > 0) {
      const { data: cableRows } = await service
        .schema('cable_schedule')
        .from('cables')
        .select('supply_id, derated_current_rating_a, cores')
        .eq('revision_id', revisionId)
        .in('supply_id', supplyIds)
      for (const c of (cableRows ?? []) as Array<CableRow & { supply_id: string }>) {
        const list = cablesBySupply.get(c.supply_id) ?? []
        list.push({ derated_current_rating_a: c.derated_current_rating_a, cores: c.cores })
        cablesBySupply.set(c.supply_id, list)
      }
    }
  }

  const computed = computeTenantElectrical(nodeIds, supplies, cablesBySupply, revisionId)
  const now = new Date().toISOString()

  // PATCH each tenant node (raw PostgREST — Content-Profile: structure).
  const headers: HeadersInit = {
    apikey: env.serviceKey,
    Authorization: `Bearer ${env.serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=minimal',
  }

  let updated = 0
  for (const nodeId of nodeIds) {
    const e = computed.get(nodeId)
    const patch = e
      ? {
          incomer_breaker_a: e.breakerA,
          incomer_pole_config: e.poleConfig,
          incomer_load_a: e.loadA,
          incomer_capacity_a: e.capacityA,
          incomer_under_protected: e.underProtected,
          incomer_multiple_feeds: e.multipleFeeds,
          incomer_source_revision_id: e.sourceRevisionId,
          incomer_computed_at: now,
        }
      : {
          incomer_breaker_a: null,
          incomer_pole_config: null,
          incomer_load_a: null,
          incomer_capacity_a: null,
          incomer_under_protected: false,
          incomer_multiple_feeds: false,
          incomer_source_revision_id: revisionId,
          incomer_computed_at: now,
        }
    const res = await fetch(`${env.supabaseUrl}/rest/v1/nodes?id=eq.${nodeId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    })
    if (res.ok) updated += 1
  }
  return { updated }
}
```

- [ ] **Step 2: Type-check web**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS (no unresolved imports/types). If `cores` is not in the generated `cable_schedule.cables` types, cast the select result `as Array<...>` at the boundary (matching existing cast style); the code already shapes `CableRow` explicitly.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/tenant-electrical/recompute.ts
git commit -m "feat(web): recomputeTenantElectrical writes persisted incomer_* fields"
```

---

## Task 5: Wire recompute into cable mutations

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts`
- Modify: `apps/web/src/actions/cable-length.actions.ts`
- Modify: `apps/web/src/actions/cable-revision.actions.ts`

The same one-liner is added **immediately after the existing `revalidatePath(...)`** call (and before the `return`) in each mutating action. It is best-effort — it must never throw and never block the mutation:

```ts
await recomputeTenantElectrical(projectId).catch(() => {})
```

- [ ] **Step 1: Add the import to each of the three action files**

At the top of each file, with the other imports:

```ts
import { recomputeTenantElectrical } from '@/lib/tenant-electrical/recompute'
```

- [ ] **Step 2: `cable-entities.actions.ts` — insert the call after the `revalidatePath` in each of these functions, using the listed projectId expression**

| Function | projectId expression |
|---|---|
| `deleteSupplyAction` | `guard.projectId` |
| `updateSupplyAction` | `s.revision.project_id` |
| `findOrCreateSupplyAction` | the action's resolved project id (the same value used in its `revalidatePath`) |
| `addParallelCableSetAction` | `guard.projectId` |
| `addRunAction` | `guard.projectId` |
| `addCableAction` | `s.revision_id`-owning project → `s.revision.project_id` |
| `deleteCableAction` | `guard.projectId` |
| `updateCableAction` | `c.revision.project_id` (insert before its `return { ok: true, recomputed }`) |
| `repointSupplyAction` | `s.revision.project_id` |

For each: locate the `revalidatePath(...)` line in that function and add directly below it:

```ts
await recomputeTenantElectrical(<projectId expression>).catch(() => {})
```

(For `updateCableAction`, which returns a `recomputed` payload, place the line just before `return { ok: true, recomputed }`.)

- [ ] **Step 3: `cable-length.actions.ts` — add recompute after the length/derate write**

Add the import (Step 1). Find the exported action(s) that persist a confirmed/measured length or recompute derating, and after their `revalidatePath(...)` add:

```ts
await recomputeTenantElectrical(projectId).catch(() => {})
```

using whatever projectId the function already has in scope (mirror the value in its `revalidatePath`).

- [ ] **Step 4: `cable-revision.actions.ts` — recompute when the latest revision changes**

Add the import (Step 1). In `createRevisionAction`, `issueRevisionAction`, `deleteDraftRevisionAction`, and `reopenDraftAction`, after the existing success-path `revalidatePath(...)`/return, add:

```ts
await recomputeTenantElectrical(projectId).catch(() => {})
```

using each function's in-scope project id (the value already used for its `revalidatePath`).

- [ ] **Step 5: Type-check + run existing cable action tests**

Run: `pnpm --filter web exec tsc --noEmit`
Run: `pnpm --filter web exec vitest run src/actions/cable-`
Expected: PASS (no regressions; recompute is fire-and-forget).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/actions/cable-entities.actions.ts apps/web/src/actions/cable-length.actions.ts apps/web/src/actions/cable-revision.actions.ts
git commit -m "feat(web): recompute tenant electrical after cable + revision mutations"
```

---

## Task 6: Backfill script

**Files:**
- Create: `scripts/db/backfill-tenant-electrical.ts`

- [ ] **Step 1: Write the backfill script**

```ts
// scripts/db/backfill-tenant-electrical.ts
//
// One-off: recompute persisted incomer_* electrical fields for every project
// (or a single project via PROJECT_ID env). Run after migration 00144 deploys.
//   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
//   pnpm --filter web exec tsx ../../scripts/db/backfill-tenant-electrical.ts
import { recomputeTenantElectrical } from '../../apps/web/src/lib/tenant-electrical/recompute'
import { createServiceClient } from '../../apps/web/src/lib/supabase/server'

async function main() {
  const only = process.env.PROJECT_ID
  const service = createServiceClient()
  let projectIds: string[]
  if (only) {
    projectIds = [only]
  } else {
    const { data, error } = await service.schema('projects').from('projects').select('id')
    if (error) throw error
    projectIds = (data ?? []).map((p) => (p as { id: string }).id)
  }
  for (const id of projectIds) {
    const res = await recomputeTenantElectrical(id)
    console.log(id, res)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Dry-run against one project**

Run: `PROJECT_ID=<kingswalk-project-uuid> pnpm --filter web exec tsx ../../scripts/db/backfill-tenant-electrical.ts`
Expected: logs `<id> { updated: <n> }` with n = tenant count.

- [ ] **Step 3: Commit**

```bash
git add scripts/db/backfill-tenant-electrical.ts
git commit -m "chore(db): backfill script for tenant incomer_* electrical"
```

---

## Task 7: On-screen columns on ScheduleTable

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
// apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleTable } from './ScheduleTable'
import type { Node } from '@esite/shared'

function tenant(overrides: Partial<Node>): Node {
  return {
    id: 'n1', created_at: '', updated_at: '', project_id: 'p1', organisation_id: 'o1',
    kind: 'tenant_db', custom_kind_label: null, code: 'DB-67', name: null, coc_required: false,
    status: 'active', deleted_at: null, deleted_by: null, parent_node_id: null,
    shop_number: '67', shop_name: 'Shop 67', shop_area_m2: 100,
    breaker_rating_a: null, pole_config: null, section: null, rating_kva: null, voltage_v: null,
    incomer_breaker_a: 63, incomer_pole_config: 'TP', incomer_load_a: 60,
    incomer_capacity_a: 170, incomer_under_protected: false, incomer_multiple_feeds: false,
    incomer_source_revision_id: null, incomer_computed_at: null,
    notes: null, decommission_reason: null, created_by: null, ...overrides,
  }
}

const base = {
  deletedNodes: [], projectId: 'p1', orgId: 'o1', scopeItemTypes: [],
  scopeItemsByNode: {}, tenantDetailsByNode: {}, layoutDetailsByNode: {},
  ordersByNodeAndScope: {}, tenantBoByNode: {},
}

describe('ScheduleTable electrical columns', () => {
  it('renders Breaker, Load and Amps headers', () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)
    expect(screen.getByText('Breaker')).toBeInTheDocument()
    expect(screen.getByText('Load')).toBeInTheDocument()
    expect(screen.getByText('Amps')).toBeInTheDocument()
  })
  it('formats breaker with poles, load and amps', () => {
    render(<ScheduleTable nodes={[tenant({})]} {...base} />)
    expect(screen.getByText('63 A TP')).toBeInTheDocument()
    expect(screen.getByText('60 A')).toBeInTheDocument()
    expect(screen.getByText('170 A')).toBeInTheDocument()
  })
  it('shows an em-dash when electrical data is absent', () => {
    render(<ScheduleTable nodes={[tenant({ incomer_breaker_a: null, incomer_pole_config: null, incomer_load_a: null, incomer_capacity_a: null })]} {...base} />)
    // 3 electrical cells render '—'
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx"`
Expected: FAIL — `getByText('Breaker')` not found.

- [ ] **Step 3: Add a formatter helper near the bottom of `ScheduleTable.tsx` (next to `Td`)**

```tsx
function formatBreaker(node: Node): string {
  const a = node.breaker_rating_a ?? node.incomer_breaker_a
  if (a == null) return '—'
  const poles = node.pole_config ?? node.incomer_pole_config
  return poles ? `${a} A ${poles}` : `${a} A`
}
function formatAmps(value: number | null): string {
  return value != null ? `${value.toLocaleString()} A` : '—'
}
```

- [ ] **Step 4: Add the three headers after `<Th>DB Code</Th>` (line 169)**

```tsx
              <Th>DB Code</Th>
              <Th>Breaker</Th>
              <Th>Load</Th>
              <Th>Amps</Th>
```

- [ ] **Step 5: Add the three cells after the DB Code `<Td mono>{node.code}</Td>` (line 208)**

```tsx
                    <Td mono>{node.code}</Td>
                    <Td mono>
                      {formatBreaker(node)}
                      {node.incomer_under_protected && (
                        <Badge variant="warning" style={{ marginLeft: 6 }}>under-rated</Badge>
                      )}
                    </Td>
                    <Td mono title={node.incomer_multiple_feeds ? 'Multiple feeds — largest shown' : undefined}>
                      {formatAmps(node.incomer_load_a)}
                    </Td>
                    <Td mono>{formatAmps(node.incomer_capacity_a)}</Td>
```

(If `Badge` does not accept `style`, wrap it in a `<span style={{ marginLeft: 6 }}>`.)

- [ ] **Step 6: Bump both expanded-panel colSpans (lines 342 and 362)**

Change both occurrences:

```tsx
colSpan={10 + scopeItemTypes.length * 2}
```
to
```tsx
colSpan={13 + scopeItemTypes.length * 2}
```

- [ ] **Step 7: Run the render test + type-check**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx"`
Expected: PASS.
Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx"
git commit -m "feat(tenant-schedule): on-screen Breaker / Load / Amps columns"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the full shared + web test/type suites**

Run: `pnpm --filter @esite/shared test && pnpm --filter web exec tsc --noEmit`
Expected: all green.

- [ ] **Step 2: Manual check (preview server)**

Start the web dev server, open a project's Tenant Schedule (e.g. Kingswalk). Confirm a known shop (shop 67 / DB-67) shows `Load 60 A`, `Breaker 63 A TP`, and `Amps` = its cable capacity; nodes without an incomer show `—`. Edit a cable's design load in the cable schedule, return to the tenant schedule, and confirm the breaker updates.

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore(tenant-schedule): finalize breaker/load/amps wiring"
```

---

## Self-Review

- **Spec coverage:** §4 model → Task 1+2; §5 architecture → Tasks 1,2,4; §6 migration/type → Task 3; §7 recompute triggers → Task 5 + Task 6 backfill; §8 on-screen → Task 7; §10 tests → Tasks 1,2,7,8. All covered.
- **Type consistency:** `TenantElectrical` fields used identically in Task 2 (definition), Task 4 (consumption), Task 7 (`Node.incomer_*`). `nextStandardBreaker`/`poleConfigFromCores`/`deriveIncomerBreaker`/`computeTenantElectrical`/`supplyParallelCapacity` names match across tasks and the existing helper. `recomputeTenantElectrical(projectId)` signature consistent in Tasks 4, 5, 6.
- **Placeholders:** Task 5 uses an enumerated call-site table (identical one-liner, explicit projectId per site) rather than per-function code blocks — intentional, fully specified.
