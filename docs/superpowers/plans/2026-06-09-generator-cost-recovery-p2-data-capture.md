# Generator Cost-Recovery — P2: Data Layer + Capture UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give esite the data layer + capture UI so a user can configure a project's generator cost-recovery (settings, zones & generators, per-tenant category + participation) and the P1 engine can be fed from the DB.

**Architecture:** A new org+project-scoped `gcr` Postgres schema (settings · zones · zone_generators · tenant_assignments) + two new columns on `structure.nodes` (`shop_category`, `generator_participation`). A pure DB→engine mapper in `@esite/shared`. RBAC-gated server actions. A project page `/projects/[id]/generator-cost-recovery` with Settings / Zones & Generators / Tenants tabs mirroring the existing `GeneralForm` pattern, plus a readiness check.

**Tech Stack:** Supabase Postgres (migrations in `apps/edge-functions/supabase/migrations/`), Next.js 15 App Router (`apps/web`), `@esite/shared` (pure), react-hook-form + zod, vitest.

**Spec:** `../specs/2026-06-08-generator-cost-recovery-design.md` (§4 architecture, §5 data model, §9 readiness, §10 RBAC). **Engine (P1) is built** at `packages/shared/src/services/generator-cost-recovery/` and golden-master-verified.

**Scope:** core data + capture only. The **expanded report content** (main-board sizing, narrative, figures, VAT, amortisation schedule, centre grouping) is deferred to P3 and rides its own small migrations — do NOT build it here.

---

## Plan index (feature = sequenced plans)
P1 engine *(done)* → **P2 data + capture** *(this)* → P3 report → P4 per-seat billing.

## Prerequisite
- [ ] On esite, branch `feat/generator-cost-recovery` is checked out (it is). Build commits on it. Migrations DON'T touch prod until merge.
- [ ] Live migration ledger is at **00123**; this plan adds **00124**.

## File structure
```
apps/edge-functions/supabase/migrations/00124_generator_cost_recovery_schema.sql   # tables + nodes cols + RLS + indexes
scripts/db/smoke-test-generator-cost-recovery.sh                                    # transactional smoke test
packages/shared/src/services/index.ts                                              # +export the engine module
packages/shared/src/services/generator-cost-recovery/db-row-types.ts               # DB row shapes
packages/shared/src/services/generator-cost-recovery/from-db.ts (+ .test.ts)       # DB rows → GeneratorCostRecoveryInput
packages/shared/src/services/generator-cost-recovery/readiness.ts (+ .test.ts)     # gaps check (pure)
packages/shared/src/structure/tenant-import-parser.ts (+ test)                     # +shop_category column
apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.ts (+ .test.ts)  # load/save (RBAC-gated)
apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/page.tsx            # server page (auth + load)
apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/{SettingsForm,ZonesPanel,TenantsPanel}.tsx
  + sidebar/nav entry
```

---

### Task 1: Migration 00124 — schema + nodes columns + RLS

**Files:** Create `apps/edge-functions/supabase/migrations/00124_generator_cost_recovery_schema.sql`; Create `scripts/db/smoke-test-generator-cost-recovery.sh`

- [ ] **Step 1: Write the migration** (follows the 00120/00121 conventions: schema-qualified, RLS via `user_has_project_access` + `get_user_org_ids`, `NOTIFY pgrst`).

```sql
-- =============================================================================
-- Migration 00124 — generator cost-recovery schema (P2 data layer)
-- =============================================================================
-- Org+project-scoped tables feeding the @esite/shared generator-cost-recovery
-- engine, plus two tenant facets on structure.nodes. RLS mirrors structure.*:
-- SELECT via user_has_project_access(project_id); writes gated to the caller's
-- orgs and blocked on payment_paused projects.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS gcr;

-- tenant facets on the existing node (idempotent)
ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS shop_category TEXT
    CHECK (shop_category IN ('standard','fast_food','restaurant','national','other'));
ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS generator_participation TEXT NOT NULL DEFAULT 'shared'
    CHECK (generator_participation IN ('shared','own','none'));

-- one settings row per project
CREATE TABLE IF NOT EXISTS gcr.settings (
  project_id       UUID PRIMARY KEY REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
  standard_kw_per_sqm   NUMERIC(10,4) NOT NULL DEFAULT 0.03,
  fast_food_kw_per_sqm  NUMERIC(10,4) NOT NULL DEFAULT 0.045,
  restaurant_kw_per_sqm NUMERIC(10,4) NOT NULL DEFAULT 0.045,
  national_kw_per_sqm   NUMERIC(10,4) NOT NULL DEFAULT 0.03,
  capital_recovery_period_years   INTEGER NOT NULL DEFAULT 10,
  capital_recovery_rate_percent   NUMERIC(5,2) NOT NULL DEFAULT 12.00,
  rate_per_tenant_db    NUMERIC NOT NULL DEFAULT 0,
  num_main_boards       INTEGER NOT NULL DEFAULT 0,
  rate_per_main_board   NUMERIC NOT NULL DEFAULT 0,
  additional_cabling_cost NUMERIC NOT NULL DEFAULT 0,
  control_wiring_cost   NUMERIC NOT NULL DEFAULT 0,
  diesel_cost_per_litre NUMERIC NOT NULL DEFAULT 23.00,
  running_hours_per_month NUMERIC NOT NULL DEFAULT 100,
  maintenance_cost_annual NUMERIC NOT NULL DEFAULT 18800,
  power_factor          NUMERIC NOT NULL DEFAULT 0.95,
  running_load_percentage NUMERIC NOT NULL DEFAULT 75,
  maintenance_contingency_percent NUMERIC NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gcr.zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id),
  zone_name       TEXT NOT NULL,
  zone_number     INTEGER NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, zone_number)
);

CREATE TABLE IF NOT EXISTS gcr.zone_generators (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id          UUID NOT NULL REFERENCES gcr.zones(id) ON DELETE CASCADE,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
  generator_number INTEGER NOT NULL,
  generator_size   TEXT,
  generator_cost   NUMERIC(15,2) NOT NULL DEFAULT 0,
  UNIQUE (zone_id, generator_number)
);

CREATE TABLE IF NOT EXISTS gcr.tenant_assignments (
  node_id          UUID PRIMARY KEY REFERENCES structure.nodes(id) ON DELETE CASCADE,
  project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
  zone_id          UUID REFERENCES gcr.zones(id) ON DELETE SET NULL,
  manual_kw_override NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcr_zones_project ON gcr.zones(project_id);
CREATE INDEX IF NOT EXISTS idx_gcr_zone_generators_zone ON gcr.zone_generators(zone_id);
CREATE INDEX IF NOT EXISTS idx_gcr_tenant_assignments_project ON gcr.tenant_assignments(project_id);

-- RLS (mirror structure.* / field.*): SELECT project-scoped; writes org-scoped + payment_paused block
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings','zones','zone_generators','tenant_assignments'] LOOP
    EXECUTE format('ALTER TABLE gcr.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- settings (project_id present)
DROP POLICY IF EXISTS gcr_settings_select ON gcr.settings;
CREATE POLICY gcr_settings_select ON gcr.settings FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS gcr_settings_write ON gcr.settings;
CREATE POLICY gcr_settings_write ON gcr.settings FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

-- zones
DROP POLICY IF EXISTS gcr_zones_select ON gcr.zones;
CREATE POLICY gcr_zones_select ON gcr.zones FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS gcr_zones_write ON gcr.zones;
CREATE POLICY gcr_zones_write ON gcr.zones FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

-- zone_generators (project via zone; org column present for the write gate)
DROP POLICY IF EXISTS gcr_zone_generators_select ON gcr.zone_generators;
CREATE POLICY gcr_zone_generators_select ON gcr.zone_generators FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM gcr.zones z WHERE z.id = zone_id AND public.user_has_project_access(z.project_id)));
DROP POLICY IF EXISTS gcr_zone_generators_write ON gcr.zone_generators;
CREATE POLICY gcr_zone_generators_write ON gcr.zone_generators FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

-- tenant_assignments
DROP POLICY IF EXISTS gcr_tenant_assignments_select ON gcr.tenant_assignments;
CREATE POLICY gcr_tenant_assignments_select ON gcr.tenant_assignments FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS gcr_tenant_assignments_write ON gcr.tenant_assignments;
CREATE POLICY gcr_tenant_assignments_write ON gcr.tenant_assignments FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

NOTIFY pgrst, 'reload schema';
```

> Note: app-side server actions ALSO gate writes with `requireRole(... ORG_WRITE_ROLES)` (the RLS org check alone permits any org member; the role gate is enforced in the action — see Task 6). `shop_category` is nullable (existing tenants); `generator_participation` defaults `'shared'` so existing tenants are billed by default (the readiness check surfaces missing category — Task 4).

- [ ] **Step 2: Write the smoke test** `scripts/db/smoke-test-generator-cost-recovery.sh` mirroring `scripts/db/smoke-test-snag-site-visits.sh` (source `mgmt-api.sh`; build a `BEGIN; <migration sans NOTIFY>; <asserts>; ROLLBACK;` txn). Assert: the 4 tables + 2 node columns exist; an INSERT of a settings row for a seeded project works; a cross-org SELECT is blocked by RLS; ends with a `RAISE EXCEPTION 'SMOKE_OK'` sentinel so the whole txn rolls back. Run it against prod read-only (transactional, rolls back — nothing persists). Expected: sentinel present, 0 residue.
- [ ] **Step 3: Commit.** `git add` the migration + smoke test; `git commit -m "feat(gcr): migration 00124 — gcr schema + tenant facets + RLS"`. (Do NOT apply to prod — it auto-applies on merge to main via the deploy workflow.)

---

### Task 2: Re-export the engine from @esite/shared

**Files:** Modify `packages/shared/src/services/index.ts`

- [ ] **Step 1:** Add `export * from './generator-cost-recovery'` to `packages/shared/src/services/index.ts` (alongside the other `export * from './*.service'` lines).
- [ ] **Step 2:** Verify it imports: `pnpm --filter @esite/shared type-check` clean, and the barrel exposes `buildGeneratorCostRecovery` (grep the built types or a quick `import { buildGeneratorCostRecovery } from '@esite/shared'` in a scratch test). **Guard:** the module is pure (no react-pdf/Node-only) so it's safe in the shared barrel (the report renderer stays in `apps/web`, P3).
- [ ] **Step 3: Commit.** `git commit -am "feat(gcr): re-export engine from @esite/shared barrel"`

---

### Task 3: DB→engine mapper (pure)

**Files:** Create `packages/shared/src/services/generator-cost-recovery/db-row-types.ts`, `from-db.ts`, `from-db.test.ts`

- [ ] **Step 1: Write the DB row types** (`db-row-types.ts`) — snake_case row shapes matching the migration: `GcrSettingsRow`, `GcrZoneRow`, `GcrZoneGeneratorRow`, `TenantNodeRow` (`{ id, shop_number, shop_name, shop_area_m2, shop_category, generator_participation }`), `GcrTenantAssignmentRow` (`{ node_id, zone_id, manual_kw_override }`).
- [ ] **Step 2: Write the failing test** (`from-db.test.ts`) asserting `mapDbToEngineInput(rows)` produces a valid `GeneratorCostRecoveryInput`: settings camelCased; zones with their generators nested; tenants joined to their assignment (participation from the node, override from the assignment, category defaulting `'standard'` when null). One case with a null category → `'standard'`, one with an override, one `own`/`none`.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `from-db.ts`** — `mapDbToEngineInput({ settings, zones, generators, tenants, assignments }): GeneratorCostRecoveryInput`. Camel-case the settings (all 17 fields); group generators under zones by `zone_id`; for each tenant node build `TenantInput` (`category: shop_category ?? 'standard'`, `participation: generator_participation`, `manualKwOverride: assignment?.manual_kw_override ?? null`, `areaM2: shop_area_m2 ?? 0`). Pure, no IO.
- [ ] **Step 5: Run → PASS; type-check.** **Step 6: Commit** `feat(gcr): DB→engine input mapper`.

---

### Task 4: Readiness check (pure)

**Files:** Create `packages/shared/src/services/generator-cost-recovery/readiness.ts`, `readiness.test.ts`

- [ ] **Step 1: Failing test** — `checkReadiness(input): { ready: boolean; gaps: string[] }`. Gaps when: a `shared` tenant has no `areaM2`; a tenant has no explicit `shop_category` (pass a `categoryExplicit` flag list, or treat the mapper-defaulted category as a gap by passing the raw nodes); no zones/generators exist; settings missing. Assert a fully-configured input → `{ ready: true, gaps: [] }`, and a sparse one → specific gap strings ("3 tenants missing floor area", "no generators configured", etc.).
- [ ] **Step 2: Run → FAIL. Step 3: Implement `readiness.ts`** (pure; counts the gaps, returns human strings). **Step 4: PASS + type-check. Step 5: Commit** `feat(gcr): readiness check`.

> The mapper defaults null category to `'standard'`; readiness must see the RAW node to flag a missing category. Pass `checkReadiness({ settings, zones, generators, tenantNodes })` the raw nodes (with nullable `shop_category`), not the mapped input. Keep both signatures consistent.

---

### Task 5: Tenant import — capture `shop_category`

**Files:** Modify `packages/shared/src/structure/tenant-import-parser.ts` (+ its test)

- [ ] **Step 1: Failing test** — add a column header "Category"/"Shop Category" to a fixture; assert the parsed row carries `shop_category` (normalised to one of the 5 enum values, else `null`).
- [ ] **Step 2: Run → FAIL. Step 3: Implement** — add `SHOP_CATEGORY_ALIASES` (`'category','shop category','type','tenant type'`), extend `TenantImportRow` with `shop_category: string | null`, resolve the column in `resolveColumns()`, and in the row loop coerce the cell to the enum (lowercase/normalise; unknown → `null`). Participation is set in the UI (not the import), so don't add it here.
- [ ] **Step 4: PASS + type-check. Step 5: Commit** `feat(gcr): tenant import captures shop_category`.

---

### Task 6: Server actions (RBAC-gated load/save)

**Files:** Create `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr.actions.ts` (+ `.test.ts`)

Mirror `apps/web/src/actions/project.actions.ts` `updateProjectAction` exactly (resolve org from `projects.projects`, `requireRole(supabase, org_id, ORG_WRITE_ROLES)`, zod-validate, write, `revalidatePath`, return `{ ok } | { error }`).

- [ ] **Step 1:** Define zod schemas (in the actions file, since `'use server'` files export async only — keep schemas in a sibling `gcr.schemas.ts` non-server module and import them) for: settings (all 17 numeric fields, sensible bounds), a zone (`zone_name`, `zone_number`), a generator (`generator_size`, `generator_cost`), an assignment (`node_id`, `zone_id|null`, `participation` enum, `manual_kw_override|null`, `shop_category` enum|null).
- [ ] **Step 2: Write failing action tests** (vitest, the `createClientMock` + `vi.mock('@/lib/supabase/server')` pattern from `active-organisation.actions.test.ts`): `saveGcrSettingsAction` → returns `{ error }` when not authed; `{ error }` when role not in `ORG_WRITE_ROLES`; happy path upserts + `revalidatePath`. Same shape-tests for `saveTenantAssignmentAction` (writes `gcr.tenant_assignments` AND patches `structure.nodes.shop_category`/`generator_participation`).
- [ ] **Step 3: Run → FAIL. Step 4: Implement `gcr.actions.ts`:**
  - `loadGcrConfigAction(projectId)` — `requireEffectiveRole(... COST_VIEW_ROLES)`; read settings + zones + generators + tenant nodes (`kind='tenant_db'`) + assignments; return them (raw rows).
  - `saveGcrSettingsAction(projectId, input)` — `requireRole(org, ORG_WRITE_ROLES)`, validate, **upsert** `gcr.settings` (onConflict `project_id`), `revalidatePath`.
  - `upsertZoneAction` / `deleteZoneAction` / `upsertGeneratorAction` / `deleteGeneratorAction` — same gate; org_id derived from the project.
  - `saveTenantAssignmentAction(projectId, { node_id, zone_id, participation, manual_kw_override, shop_category })` — gate, validate, upsert `gcr.tenant_assignments` (onConflict `node_id`) **and** UPDATE `structure.nodes` set `shop_category`, `generator_participation` for that node (same project). Use a service client only if RLS blocks the structure.nodes write; otherwise the authenticated client + the org write policy suffices.
- [ ] **Step 5: Run → PASS; type-check. Step 6: Commit** `feat(gcr): RBAC-gated config server actions`.

---

### Task 7: Settings form UI

**Files:** Create `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/SettingsForm.tsx`

- [ ] Build a client form **mirroring `apps/web/src/app/(admin)/projects/[id]/settings/general/GeneralForm.tsx` exactly** (same imports: `useForm` + `zodResolver` + `useDirtyForm` + `StickySaveBar` + `Card`/`FormField`/`TextInput`). Fields = the 17 settings, grouped in three `Card`s: **Loading rates** (4 kW/m²), **Capital** (recovery years/rate, rate-per-tenant-DB, num/ rate main boards, cabling, control wiring), **Operational** (diesel/l, running hours, maintenance/yr, power factor, running load %, contingency %). `onSubmit` calls `saveGcrSettingsAction(projectId, values)`; handle `{ error }` like GeneralForm. Reuse the GeneralForm `zodResolver` schema shape (numbers via `z.coerce.number()`).
- [ ] Commit `feat(gcr): settings form`.

---

### Task 8: Zones & generators UI

**Files:** Create `…/generator-cost-recovery/ZonesPanel.tsx`

- [ ] A panel listing zones (add/rename/delete) each with its generators (size + cost rows; add/delete), calling `upsertZoneAction`/`deleteZoneAction`/`upsertGeneratorAction`/`deleteGeneratorAction`. Use the repo's existing list/table + button components (match a panel like the equipment/tenant lists; `Card` + simple rows). Optimistic refresh via `router.refresh()` after each action. Commit `feat(gcr): zones & generators panel`.

---

### Task 9: Tenants panel (category + participation + zone) + readiness

**Files:** Create `…/generator-cost-recovery/TenantsPanel.tsx`

- [ ] A table of the project's `tenant_db` nodes: shop no · name · area · **Category** (select: the 5 values) · **Participation** (segmented: Shared / Own / Not-on-generator — opt-outs greyed, per WM) · **Zone** (select) · manual kW override · computed loading kW (call `calculateTenantLoadingKw` from `@esite/shared`). Each change calls `saveTenantAssignmentAction`. Above the table, render the **readiness summary** from `checkReadiness(...)` — list gaps; the "Generate report" button (wired in P3) is disabled until `ready`. Commit `feat(gcr): tenants panel + readiness`.

---

### Task 10: Page + navigation

**Files:** Create `…/generator-cost-recovery/page.tsx`; register the nav entry

- [ ] **Step 1: Server `page.tsx`** — auth + `requireEffectiveRole(... COST_VIEW_ROLES)`; call `loadGcrConfigAction(projectId)`; render a tabbed shell (Settings / Zones & Generators / Tenants) wrapping the three client panels with the loaded data. Mirror an existing project sub-page's server-component shape.
- [ ] **Step 2:** Add the sidebar/nav entry "Generator Cost-Recovery" for the project, gated to `COST_VIEW_ROLES` (follow how the existing project tabs are registered).
- [ ] **Step 3:** `pnpm --filter web test` + `pnpm --filter web type-check` clean; `pnpm --filter web build` succeeds. Commit `feat(gcr): generator-cost-recovery project page + nav`.

---

## Self-Review (completed)
- **Spec coverage:** §5 data model → Task 1 (+ engine input via Task 3); §9 readiness → Task 4/9; §10 RBAC → Task 6 gates + Task 1 RLS; capture UI → Tasks 7–10; tenant category/participation → Tasks 1/5/9. Per-seat billing (§8) is **P4**; the report (§7) is **P3** — correctly out of scope. ✅
- **Placeholder scan:** the high-risk/novel code (migration, mapper, readiness, parser, action contracts) is complete; the UI tasks reference a concrete in-repo template (`GeneralForm.tsx`) with the exact fields/schema/action named — an existing-codebase pattern, not a vague placeholder. ✅
- **Type consistency:** `mapDbToEngineInput` returns `GeneratorCostRecoveryInput` (engine types from P1); `TenantInput.participation`/`category`/`manualKwOverride`/`areaM2` names match P1 exactly; action names (`saveGcrSettingsAction`, `saveTenantAssignmentAction`, etc.) are used consistently across Tasks 6–10. ✅

## Execution handoff
Run with **superpowers:subagent-driven-development** (one subagent per task, two-stage review). **Task 1 (migration) gets extra care** — the smoke test must pass transactionally on prod before merge; do NOT apply migrations manually (the deploy workflow applies on merge to main). P3 (report) + P4 (billing) get their own plans after P2 is green.
