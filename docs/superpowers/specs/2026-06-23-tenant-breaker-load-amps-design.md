# Tenant Schedule — Breaker / Load / Amps (on-screen)

**Date:** 2026-06-23
**Branch / worktree:** `feat/settings-tabs-improvements` (`/Users/spud/dev/e-site-tsr`)
**Status:** Design — awaiting user review

## 1. Goal

Surface each tenant's incoming-supply electrical sizing on the **on-screen** tenant
schedule table: **Breaker (A + poles)**, **Load (A)**, and **Cable capacity (Amps)**.
These are derived from the cable schedule and **persisted** onto the tenant node so the
tenant-schedule page reads them as plain node columns (no cable join in the page).

## 2. Scope

**In scope (this round):**
- A pure derivation engine for breaker sizing + incomer resolution.
- A migration adding persisted `incomer_*` columns to `structure.nodes`.
- A recompute service that writes those columns, wired into cable mutations + a backfill.
- Three new columns on the on-screen `ScheduleTable`.

**Out of scope (separate follow-up specs):**
- Adding breaker/load/amps to the **PDF report** (`tenant-schedule-report-*`). Deferred by choice.
- The 12 cable-schedule export-review fixes (breaker/amps in cable exports, filter parity,
  empty-states, QR logging, dedup, validation, …). Deferred by choice.

## 3. Decisions (confirmed with user)

| Question | Decision |
|---|---|
| Breaker basis | **Load-based**: incomer `design_load_a` rounded **up** to the next standard size (e.g. 60 A → 63 A). |
| Poles | From incomer cable `cores`: `3` / `3+E` / `4` ⇒ **TP**; otherwise **SP** (cores enum is effectively three-phase only). |
| Manual override | If a node already has a manual `breaker_rating_a` / `pole_config`, it **wins** on display; otherwise show the derived value. |
| Revision source | **Latest revision of any status** (`MAX(created_at)` per project). *Note:* looser than the cable page's own "latest ISSUED / active DRAFT" rule — explicit user choice. |
| Persistence | **Persist + recompute**: store on `structure.nodes`, recompute when cables change. |
| Surfaces | **On-screen only** this round. |

## 4. The breaker model

For a tenant node `N` (`kind='tenant_db'`):

1. **Incomer** = the supply where `cable_schedule.supplies.to_node_id = N.id` in the
   source revision. If more than one, pick the highest `design_load_a` and set
   `incomer_multiple_feeds = true`.
2. **Load** = incomer `design_load_a`.
3. **Capacity (Amps)** = `supplyParallelCapacity(cablesForSupply)` — sum of
   `cables.derated_current_rating_a` across the incomer's parallel strands
   (`packages/shared/src/services/cable-calc.service.ts:317`).
4. **Breaker** = `nextStandardBreaker(loadA)` from the standard series.
5. **Poles** = `poleConfigFromCores(cores)` of the incomer's cables.
6. **Under-protected** = `breakerA != null && capacityA != null && breakerA > capacityA`
   (the chosen breaker would exceed what the conductor can carry — SANS 10142-1
   coordination `I_load ≤ I_breaker ≤ I_cable`).

**Standard breaker series** (SANS/IEC 60898 / 60947-2 preferred ratings):
`6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 630, 800, 1000, 1250, 1600`.
`nextStandardBreaker(amps)` returns the smallest series member `≥ amps`, or `null` if
`amps` exceeds the top of the series (over-range → surfaced, never silently clamped).

## 5. Architecture

Three layers, each independently testable.

### 5.1 Pure engine — `packages/shared/src/structure/breaker-sizing.ts` (NEW)
```
STANDARD_BREAKER_SERIES: readonly number[]
nextStandardBreaker(amps: number | null): number | null
poleConfigFromCores(cores: string | null): 'SP' | 'TP' | null
deriveIncomerBreaker(input: {
  designLoadA: number | null
  cores: string | null
  capacityA: number | null
}): { breakerA: number | null; poleConfig: 'SP'|'TP'|null; underProtected: boolean }
```
No I/O, no Supabase types. Fully unit-tested (TDD — tests written first).

### 5.2 Pure project computation — `packages/shared/src/structure/tenant-electrical.ts` (NEW)
```
computeTenantElectrical(
  tenantNodeIds: string[],
  supplies: SupplyRow[],     // {id, to_node_id, design_load_a}
  cablesBySupply: Map<string, CableRow[]>,  // {derated_current_rating_a, cores}
  revisionId: string | null,
): Map<string, TenantElectrical>
```
`TenantElectrical = { breakerA, poleConfig, loadA, capacityA, underProtected, multipleFeeds, sourceRevisionId }`.
Resolves the incomer (max-load tiebreak), calls `deriveIncomerBreaker`, returns one entry
per tenant node that has an incomer. Pure → unit-tested without a DB.

### 5.3 Recompute action — `apps/web/src/actions/tenant-electrical.actions.ts` (NEW)
`recomputeTenantElectrical(projectId, opts?)`:
1. Resolve source revision = latest by `created_at` for the project (any status).
2. Service-client reads: tenant node ids; `cable_schedule.supplies` (`id, to_node_id, design_load_a`)
   where `revision_id = rev` and `to_node_id in nodeIds`; `cable_schedule.cables`
   (`supply_id, derated_current_rating_a, cores`) where `revision_id = rev`.
3. `computeTenantElectrical(...)`.
4. **Write** `incomer_*` to `structure.nodes`. **MUST use raw PostgREST `fetch` with
   `Content-Profile: structure` + service-role key** — `supabase-js .schema('structure')`
   silently drops the service-role header on UPDATE (documented gotcha, `node.service.ts`
   header; CLAUDE.md 2026-05-18). Nodes with no incomer get `incomer_*` reset to null.

## 6. Data model — migration `00144_tenant_incomer_electrical.sql` (NEW)

`ALTER TABLE structure.nodes ADD COLUMN`:

| Column | Type | Notes |
|---|---|---|
| `incomer_breaker_a` | `NUMERIC` NULL | derived breaker (next standard ≥ load) |
| `incomer_pole_config` | `TEXT` NULL | `CHECK IN ('SP','TP')`; from cores |
| `incomer_load_a` | `NUMERIC` NULL | incomer `design_load_a` |
| `incomer_capacity_a` | `NUMERIC` NULL | Σ derated strand ratings |
| `incomer_under_protected` | `BOOLEAN` NOT NULL DEFAULT false | breaker > capacity |
| `incomer_multiple_feeds` | `BOOLEAN` NOT NULL DEFAULT false | >1 supply to this node |
| `incomer_source_revision_id` | `UUID` NULL | provenance (FK `cable_schedule.revisions`) |
| `incomer_computed_at` | `TIMESTAMPTZ` NULL | last recompute time |

`Node` type (`packages/shared/src/structure/types.ts`) gains the same fields. `listNodes`
already `select('*')`, so they flow to the page with no query change. Generated DB types lag
migrations here (established pattern) — cast at the query boundary where needed.

## 7. Recompute triggers (keeping persisted values fresh)

`recomputeTenantElectrical(projectId)` is called after any change that affects the result:
- `cable-entities.actions.ts` — supply/cable create, update (load, size, cores, repoint
  `to_node_id`), delete.
- `cable-length.actions.ts` — length/derate changes (alters `derated_current_rating_a`).
- `cable-revision.actions.ts` — `createRevisionAction`, `issueRevisionAction`,
  `deleteDraftRevisionAction`, `reopenDraftAction` (the "latest revision" changes).
- **Backfill** — one-off `scripts/db/backfill-tenant-electrical.ts` (or an admin action) to
  populate existing projects on deploy.

Recompute is best-effort and must never block the underlying cable mutation (wrap in
try/catch + log); the on-screen read tolerates stale/null and shows `—`.

## 8. On-screen rendering — `ScheduleTable.tsx`

- Insert three `<Th>` after **DB Code** (line 169): `Breaker`, `Load`, `Amps`.
- Insert three `<Td mono>` after the DB Code cell (line 208):
  - Breaker: `node.breaker_rating_a ?? node.incomer_breaker_a` + poles
    (`pole_config ?? incomer_pole_config`), formatted e.g. `63 A TP`; `—` if null.
  - Load: `incomer_load_a` → `60 A`; `—` if null.
  - Amps: `incomer_capacity_a` → `170 A` (`toLocaleString`); `—` if null.
  - If `incomer_under_protected`, render a small warning badge on the Breaker cell.
  - If `incomer_multiple_feeds`, a subtle marker (title tooltip) on the Load cell.
- Bump both expanded-panel `colSpan` (lines 342, 362) from `10 + scopeItemTypes.length * 2`
  to `13 + scopeItemTypes.length * 2`.

No change to `page.tsx` data loading (persisted columns arrive via `listNodes`).

## 9. Devil's-advocate review / edge cases

- **No incomer** → all `incomer_*` null; row shows `—`. Not an error.
- **`design_load_a` null/0** → breaker null.
- **`cores` null** → poles null; show breaker amps without poles.
- **Load > 1600 A** → `nextStandardBreaker` null (over-range); show `—` + (optional) flag, never clamp.
- **Capacity null** (derate not yet computed) → `under_protected` stays false (can't assess); Amps shows `—`.
- **Multiple feeds** → max-load incomer chosen, `multiple_feeds` flagged for transparency.
- **Latest-of-any-status** means a DRAFT revision drives the displayed breaker — explicit user
  choice; documented so it isn't mistaken for a bug.
- **Decommissioned tenants** → still recomputed (harmless); display unaffected by status.
- **Manual override** present → wins, so an engineer-set breaker is never overwritten on screen
  (the derived value still persists in `incomer_*` for reference).
- **Cross-schema write gotcha** → raw PostgREST write path is mandatory; a query-builder write
  would fail RLS silently. Covered in §5.3.

## 10. Verification / test plan (TDD)

1. `breaker-sizing.test.ts` (write first): series boundaries (5→6, 6→6, 60→63, 63→63, 64→80,
   1600→1600, 1601→null); poles (`3`/`3+E`/`4`→TP, `2`→SP, null→null); `deriveIncomerBreaker`
   under-protected true when breaker>capacity, false when capacity null.
2. `tenant-electrical.test.ts`: single incomer; multiple feeds → max-load + flag; no incomer → absent;
   parallel cables summed.
3. `ScheduleTable` render test: three new columns present + correctly formatted; `—` for nulls;
   under-protected badge renders; `colSpan` recount matches header count.
4. Recompute action: integration test with fixture supplies/cables → expected `incomer_*` writes
   (or pure-core test via `computeTenantElectrical`, thin DB writer verified separately).
5. `pnpm --filter web type-check` + `pnpm --filter @esite/shared test` + targeted `vitest` green.
6. Manual: open Kingswalk tenant schedule, confirm a known shop (e.g. shop 67 / DB-67) shows
   `Load 60 A`, `Breaker 63 A TP`, `Amps` = cable capacity.

## 11. File change list

**New**
- `packages/shared/src/structure/breaker-sizing.ts` (+ `.test.ts`)
- `packages/shared/src/structure/tenant-electrical.ts` (+ `.test.ts`)
- `apps/web/src/actions/tenant-electrical.actions.ts`
- `apps/edge-functions/supabase/migrations/00144_tenant_incomer_electrical.sql`
- `scripts/db/backfill-tenant-electrical.ts`

**Modified**
- `packages/shared/src/structure/types.ts` (Node += `incomer_*`)
- `packages/shared/src/structure/index.ts` (export new modules)
- `apps/web/src/actions/cable-entities.actions.ts`, `cable-length.actions.ts`,
  `cable-revision.actions.ts` (call recompute)
- `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx`
  (+ render test)

## 12. Open questions

1. Recompute granularity: per-project (simple) vs per-affected-tenant (less work). Default:
   per-project (small N), optimise later if needed.
2. Over-range load (>1600 A) display: `—`, or an explicit "over range" marker? Default `—`.
3. Backfill delivery: standalone script vs one-time admin action triggered post-deploy.
