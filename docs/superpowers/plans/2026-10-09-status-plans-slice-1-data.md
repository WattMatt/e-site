# Status Plans — Slice 1 (data + shared logic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the database tables, row security, site scope, cloud-sync protection and pure shared logic for status plans, plus one tenant-facts loader that the tenant schedule report and status plans both read, with no UI and no change in how the report behaves.

**Architecture:** One migration adds `tenants.status_plans` (one page of a drawing, marked with a purpose) and `tenants.status_plan_shapes` (geometry + link + type only; nothing derived is stored). Row security follows the `00206` per-verb shape: a PERMISSIVE membership policy plus a RESTRICTIVE `ORG_WRITE_ROLES` gate for each write verb, one SELECT policy, and the generated `site_scope` policy. Status, colour, hatch and area are pure functions in `@esite/shared/status-plans`, computed from live facts at draw/render time. The tenant facts the report uses are moved into `loadTenantShopFacts` (web) plus `shopProgressFor` (pure), so the report, the screen and the plan read the same facts.

**Tech Stack:** Postgres 17 (Supabase), PL/pgSQL triggers, PostgREST RLS; TypeScript; vitest (shared, web, db); Deno edge function (`cloud-sync-project`); pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-10-09-status-plans-design.md` (§4 data model, §6 shared logic, §10 testing, §11 slice 1).

**Out of scope for this plan:** applying the migration to production, deploying `cloud-sync-project`, merging. The plan ends with the branch green locally on the web, shared and db suites, and the migration dry-run against production (red first, then green). See "Hand-off" at the end for the apply-time order.

---

## Rules this plan follows (read once before Task 1)

These come from `CLAUDE.md` and each was paid for by a real incident:

1. **Every migration ≥ `00185` carries a `-- @verify:begin … -- @verify:end` block.** Every table and function the migration creates must be named in it (`apps/web/src/lib/migration-verify-block.contract.test.ts`). The block holds directives ONLY: a non-directive `--` line inside it is folded into the previous directive, and for `sql:` that means into the SQL (the `00204` failure). No em dash inside a `sql:` payload.
2. **Never a RESTRICTIVE `FOR ALL` role gate.** `FOR ALL` includes SELECT, so the write set silently becomes the read set (`00205` → `00206`). The only `FOR ALL` policy here is the generated `site_scope`, whose expression is the read predicate itself.
3. **`REVOKE ALL ON FUNCTION … FROM PUBLIC, anon`** for every new function. `FROM PUBLIC` alone leaves Supabase's direct anon grant in `public`.
4. **New site tables go in `packages/db/src/site-scope/manifest.ts`.** The migration carries the generator's exact `site_scope` text (as `00243`/`00244` did); a new contract test proves the two agree byte for byte.
5. **`isAnnotated()` in `cloud-sync-project` must query every drawing-anchored table, fail-closed.** The contract test derives the list from the migrations.
6. **Impersonation assertions are run red first**, and every arm is mutated to prove it can fail.
7. **Run all three suites** (`web`, `@esite/shared`, `@esite/db`) before calling anything green. `packages/db` holds repo-wide migration guards the other two never touch.
8. **Sweep every earlier `@verify` directive (≥ `00185`) under the new migration's state** before apply (Task 18 builds the tool, Task 20 runs it).
9. **Migration number is claimed at apply time, not now.** The file is written as `00245_status_plans.sql`. Immediately before apply or merge, re-check the ledger `max(version)`, `origin/main` filenames and open-PR migration filenames, and renumber if `00245` is taken (Task 20, Step 1).
10. **Worktree hygiene:** run `pnpm install` in this worktree; never symlink another worktree's `node_modules`. Run tests and builds with `TMPDIR` on the SSD.

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
| `apps/edge-functions/supabase/migrations/00245_status_plans.sql` | Tables, triggers, RLS, site scope, grants, `@verify` block |
| `scripts/db/assert-status-plans-roles.sql` | Behavioural impersonation assertions (dry-run harness) |
| `packages/db/src/__tests__/security/status-plans-site-scope.contract.test.ts` | Migration's `site_scope` text equals the generator's |
| `packages/shared/src/status-plans/types.ts` | Purposes, area types, row types, `pointsError` |
| `packages/shared/src/status-plans/types.test.ts` | Mirror of the migration's CHECK lists + `pointsError` |
| `packages/shared/src/status-plans/shop-status.ts` (+ `.test.ts`) | `shopStatus()` — complete / in progress / overdue / decommissioned / unlinked |
| `packages/shared/src/status-plans/db-block-status.ts` (+ `.test.ts`) | `dbBlockStatus()` for schematic DB blocks |
| `packages/shared/src/status-plans/geometry.ts` (+ `.test.ts`) | Shoelace area, m², visual centre, point-in-shape, signed edge distance, hatch clipping |
| `packages/shared/src/status-plans/area-check.ts` (+ `.test.ts`) | Measured vs scheduled with the 2 % tolerance |
| `packages/shared/src/status-plans/palette.ts` (+ `.test.ts`) | The single colour / hatch table and legends |
| `packages/shared/src/status-plans/index.ts` (+ `index.test.ts`) | Public surface of `@esite/shared/status-plans` |
| `apps/web/src/lib/tenant-schedule/shop-facts.ts` (+ `.test.ts`) | `loadTenantShopFacts()` — the one per-shop facts read |
| `apps/web/src/lib/tenant-schedule/__fixtures__/fake-tables-client.ts` | Tiny PostgREST-shaped fake for loader tests |
| `apps/web/src/lib/tenant-schedule/__fixtures__/probe-mall.ts` | Invented fixture rows shared by two tests |
| `apps/web/src/lib/reports/tenant-schedule-report-data.test.ts` | Characterisation test of the report data (written BEFORE the extraction) |
| `apps/web/src/lib/status-plans/shop-link.ts` (+ `.test.ts`) | `shopLinkFor()` — facts + node id → `ShopLink` |
| `packages/shared/src/lib/migrations/verify-sweep.test.ts` | Tests for `buildVerifySweepSql` |
| `scripts/db/emit-verify-sweep.ts` | Writes the sweep assertions file for the dry-run harness |

**Modify**

| Path | Change |
|---|---|
| `packages/db/src/site-scope/manifest.ts` | Resolver `status_plan`; gate both tables |
| `scripts/db/site-scope/site_scoped_access.sql` | Regenerated by `emit.ts` |
| `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` | `isAnnotated()` gains the `status_plans` lookup |
| `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts` | Known-table list gains `tenants.status_plans` |
| `packages/shared/package.json` | Export `./status-plans` |
| `apps/web/src/lib/reports/tenant-schedule-report-compute.ts` (+ test) | Add `shopProgressFor`; `computeReportModel` uses it |
| `apps/web/src/lib/reports/tenant-schedule-report-data.ts` | Uses `loadTenantShopFacts` |
| `packages/db/src/types.ts` | Hand-add the two tables under `tenants` |
| `packages/shared/src/lib/migrations/verify-header.ts` | Add `buildVerifySweepSql` |
| `docs/rbac-matrix.md` | Status plans section |

`@esite/shared/status-plans` is a **subpath export only**, not re-exported from the root barrel: the barrel already exports Solar's `polygonArea` / `pointInPolygon` / `Pt`, and a second set of geometry names there would collide.

---

### Task 0: Worktree setup and baseline

**Files:** none

- [ ] **Step 1: Install dependencies in this worktree**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans"
mkdir -p "/Volumes/Extreme SSD/tmp"
export TMPDIR="/Volumes/Extreme SSD/tmp"
pnpm install
```

Expected: completes without errors. `ls node_modules/.pnpm | head -1` prints a directory (a real install, not a symlink). Never `ln -s` another worktree's `node_modules`: `@esite/shared` would resolve to the other tree's source.

- [ ] **Step 2: Baseline the three suites**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web test
```

Expected: all three PASS (the db suite's `rls-policy` / `rls-benchmark` files skip without credentials). Write the three pass counts into your notes; Task 19 compares against them. If any suite is red on a clean `origin/main`, stop and report it; do not build on a red baseline.

- [ ] **Step 3: Confirm `00245` is free right now (it is re-checked at apply time in Task 20)**

```bash
ls apps/edge-functions/supabase/migrations | tail -3
git fetch origin main && git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3
gh pr list --state open --json number,files --jq '.[] | {n: .number, m: [.files[].path | select(test("supabase/migrations/"))]} | select(.m | length > 0)'
source scripts/db/mgmt-api.sh && mgmt_query "SELECT max(version) AS head FROM supabase_migrations.schema_migrations"
```

Expected: highest local/main file is `00244_tender_submissions.sql`; no open PR lists `00245_*`; ledger head is `00244`. If any of them shows `00245` or higher, use the next free number everywhere this plan says `00245` (the file name only; the contract tests find the file by `*_status_plans.sql`).

---

### Task 1: The migration

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00245_status_plans.sql`

There is no unit test that can execute this SQL locally; it is proven by three things: the two parser/contract suites below (Step 2), the behavioural assertions dry-run against production (Task 20), and the `@verify` sweep (Task 20). The literal strings `IF v_node_project IS DISTINCT FROM v_project THEN`, `IF v_purpose = 'tenant_layout' AND v_node_kind <> 'tenant_db' THEN`, `NEW.organisation_id := v_org;` and `'project_manager')` are mutation targets in Task 20; keep them exactly as written.

- [ ] **Step 1: Write the migration**

```sql
-- ---------------------------------------------------------------------------
-- Migration 00245: status plans (tenant layout masking + schematic DB hatching)
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-10-09-status-plans-design.md (section 4)
--
-- WHAT A STATUS PLAN IS. One page of a drawing in the register, marked with a
-- purpose: 'tenant_layout' (shop masks coloured by tenant progress) or
-- 'distribution_schematic' (DB blocks on a 300 drawing hatched by DB order
-- status). Its shapes store GEOMETRY + LINK + TYPE ONLY. Every colour, hatch
-- and area is derived at draw/render time from live data, so there is
-- deliberately no colour, status or area column anywhere in this file. A
-- stored colour is what made WM Office Web's masking plan go stale.
--
-- GEOMETRY. points are image-space pixels of the page rasterised at the fixed
-- getViewport({ scale: 2 }) used by apps/web/src/lib/sheet, flat
-- [x0, y0, x1, y1, ...]. They replay exactly on any device. What can change is
-- the FILE: cloud-sync adopts a newer revision by swapping file_path on the
-- same drawing row. So source_file_path is stamped from the drawing at
-- creation (the client's value is discarded) for the plan page to warn on,
-- and cloud-sync's isAnnotated() treats a drawing with a status plan as
-- annotated, so it is never silently swapped (the 00205 reasoning).
--
-- PARENTS ARE DERIVED OR CHECKED, NEVER TRUSTED. organisation_id and
-- source_file_path come from the drawing. project_id must equal the drawing's
-- and is refused rather than corrected, so a client bug surfaces. A plan's
-- drawing, page, purpose and project are fixed after creation. A shape's node
-- must be on the plan's project and not soft-deleted, and a tenant layout links
-- tenant_db nodes only. created_by is auth.uid(), never the client's value.
--
-- ROW SECURITY. Read: every project member, client_viewer included (a status
-- plan is a progress picture made to be shown). Write: ORG_WRITE_ROLES
-- (owner, admin, project_manager). Each write verb has a PERMISSIVE membership
-- policy and a RESTRICTIVE role gate. Never FOR ALL for the role gate: FOR ALL
-- includes SELECT, and 00205 shipped exactly that and narrowed reads to the
-- write set (00206). The only FOR ALL policy here is site_scope, whose
-- expression is the read predicate itself. site_scope and its resolver are
-- the generator's text byte for byte (packages/db/src/site-scope/generate.ts,
-- pinned by status-plans-site-scope.contract.test.ts).
--
-- Schema only. No backfill: nothing exists to backfill.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: tenants.status_plans
-- table: tenants.status_plan_shapes
-- column: tenants.status_plans.purpose
-- column: tenants.status_plans.page_index
-- column: tenants.status_plans.source_file_path
-- column: tenants.status_plans.organisation_id
-- column: tenants.status_plan_shapes.points
-- column: tenants.status_plan_shapes.node_id
-- column: tenants.status_plan_shapes.area_type
-- column: tenants.status_plan_shapes.detected_tag
-- column: tenants.status_plan_shapes.source
-- constraint: status_plans_page_positive ON tenants.status_plans
-- constraint: status_plans_purpose_check ON tenants.status_plans
-- constraint: status_plans_name_not_blank ON tenants.status_plans
-- constraint: status_plans_drawing_page_purpose_key ON tenants.status_plans
-- constraint: status_plan_shapes_shape_check ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_area_type_check ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_source_check ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_link_or_area ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_points_shape ON tenants.status_plan_shapes
-- constraint: status_plan_shapes_tag_length ON tenants.status_plan_shapes
-- index: status_plans_project_idx ON tenants.status_plans
-- index: status_plan_shapes_plan_idx ON tenants.status_plan_shapes
-- index: status_plan_shapes_plan_node_key ON tenants.status_plan_shapes
-- index: status_plan_shapes_node_idx ON tenants.status_plan_shapes
-- function: tenants.status_plans_bind_parents()
-- function: tenants.status_plan_shapes_check_link()
-- function: public.site_project_of_status_plan(uuid)
-- trigger: status_plans_bind_parents ON tenants.status_plans
-- trigger: status_plans_updated_at ON tenants.status_plans
-- trigger: status_plan_shapes_check_link ON tenants.status_plan_shapes
-- trigger: status_plan_shapes_updated_at ON tenants.status_plan_shapes
-- policy: status_plans_select ON tenants.status_plans PERMISSIVE
-- policy: status_plans_insert ON tenants.status_plans PERMISSIVE
-- policy: status_plans_update ON tenants.status_plans PERMISSIVE
-- policy: status_plans_delete ON tenants.status_plans PERMISSIVE
-- policy: status_plans_insert_authz ON tenants.status_plans RESTRICTIVE
-- policy: status_plans_update_authz ON tenants.status_plans RESTRICTIVE
-- policy: status_plans_delete_authz ON tenants.status_plans RESTRICTIVE
-- policy: site_scope ON tenants.status_plans RESTRICTIVE
-- policy: status_plan_shapes_select ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_insert ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_update ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_delete ON tenants.status_plan_shapes PERMISSIVE
-- policy: status_plan_shapes_insert_authz ON tenants.status_plan_shapes RESTRICTIVE
-- policy: status_plan_shapes_update_authz ON tenants.status_plan_shapes RESTRICTIVE
-- policy: status_plan_shapes_delete_authz ON tenants.status_plan_shapes RESTRICTIVE
-- policy: site_scope ON tenants.status_plan_shapes RESTRICTIVE
-- grant_present: authenticated SELECT ON tenants.status_plans
-- grant_present: authenticated INSERT ON tenants.status_plans
-- grant_present: authenticated SELECT ON tenants.status_plan_shapes
-- grant_present: authenticated DELETE ON tenants.status_plan_shapes
-- grant_absent: anon SELECT ON tenants.status_plans
-- grant_absent: anon SELECT ON tenants.status_plan_shapes
-- grant_absent: anon EXECUTE ON public.site_project_of_status_plan(uuid)
-- grant_absent: anon EXECUTE ON tenants.status_plans_bind_parents()
-- grant_absent: anon EXECUTE ON tenants.status_plan_shapes_check_link()
-- sql: (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('tenants.status_plans'::regclass, 'tenants.status_plan_shapes'::regclass))
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'tenants.status_plans'::regclass AND polcmd IN ('r', '*') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'tenants.status_plan_shapes'::regclass AND polcmd IN ('r', '*') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polrelid IN ('tenants.status_plans'::regclass, 'tenants.status_plan_shapes'::regclass) AND polpermissive = false AND polcmd NOT IN ('a', 'w', 'd') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 6 FROM pg_policy WHERE polrelid IN ('tenants.status_plans'::regclass, 'tenants.status_plan_shapes'::regclass) AND polpermissive = false AND polcmd IN ('a', 'w', 'd') AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) LIKE '%project_manager%' AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) NOT LIKE '%contractor%')
-- sql: (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name IN ('status_plans', 'status_plan_shapes') AND column_name IN ('colour', 'color', 'fill', 'status', 'area_m2', 'area_sqm'))
-- @verify:end

-- 1. Status plans ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants.status_plans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id   UUID NOT NULL REFERENCES public.organisations(id),
    floor_plan_id     UUID NOT NULL REFERENCES tenants.floor_plans(id) ON DELETE CASCADE,
    page_index        INTEGER NOT NULL,
    purpose           TEXT NOT NULL,
    name              TEXT NOT NULL,
    source_file_path  TEXT NOT NULL,
    created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT status_plans_page_positive CHECK (page_index >= 1),
    CONSTRAINT status_plans_purpose_check CHECK (purpose IN ('tenant_layout', 'distribution_schematic')),
    CONSTRAINT status_plans_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT status_plans_drawing_page_purpose_key UNIQUE (floor_plan_id, page_index, purpose)
);

CREATE INDEX IF NOT EXISTS status_plans_project_idx ON tenants.status_plans (project_id);

COMMENT ON TABLE tenants.status_plans IS
'One page of a drawing marked with a purpose (tenant_layout or distribution_schematic). Holds no colour, status or area: those are computed at draw and render time from live tenant-schedule and order data, so a plan cannot lag the schedule. organisation_id and source_file_path are bound from the drawing by trigger; drawing, page, purpose and project are fixed after creation.';

COMMENT ON COLUMN tenants.status_plans.source_file_path IS
'The drawing file the shapes were drawn against, stamped from tenants.floor_plans.file_path at creation. The plan page warns when the drawing''s current file differs. It may only be updated to the drawing''s current file (re-anchoring after a deliberate adopt).';

-- 2. Shapes -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants.status_plan_shapes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_plan_id  UUID NOT NULL REFERENCES tenants.status_plans(id) ON DELETE CASCADE,
    shape           TEXT NOT NULL,
    points          JSONB NOT NULL,
    node_id         UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
    area_type       TEXT,
    detected_tag    TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',
    created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT status_plan_shapes_shape_check CHECK (shape IN ('polygon', 'rect')),
    CONSTRAINT status_plan_shapes_area_type_check CHECK (area_type IS NULL OR area_type IN ('common', 'plant_room', 'services', 'vacant')),
    CONSTRAINT status_plan_shapes_source_check CHECK (source IN ('manual', 'detected')),
    CONSTRAINT status_plan_shapes_link_or_area CHECK (node_id IS NULL OR area_type IS NULL),
    CONSTRAINT status_plan_shapes_points_shape CHECK (CASE WHEN jsonb_typeof(points) = 'array' THEN (jsonb_array_length(points) BETWEEN 6 AND 4000 AND jsonb_array_length(points) % 2 = 0 AND (shape <> 'rect' OR jsonb_array_length(points) = 8) AND NOT jsonb_path_exists(points, '$[*] ? (@.type() != "number")')) ELSE false END),
    CONSTRAINT status_plan_shapes_tag_length CHECK (detected_tag IS NULL OR length(detected_tag) <= 64)
);

CREATE INDEX IF NOT EXISTS status_plan_shapes_plan_idx ON tenants.status_plan_shapes (status_plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS status_plan_shapes_plan_node_key ON tenants.status_plan_shapes (status_plan_id, node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS status_plan_shapes_node_idx ON tenants.status_plan_shapes (node_id) WHERE node_id IS NOT NULL;

COMMENT ON TABLE tenants.status_plan_shapes IS
'A polygon or rectangle on a status plan: geometry (image-space pixels at scale 2), an optional link to a structure.nodes row OR an area type, and nothing derived. A node appears at most once per plan. A hard-deleted node sets node_id NULL and the shape falls back to unlinked.';

-- 3. Parents are derived or checked, never trusted -----------------------------

CREATE OR REPLACE FUNCTION tenants.status_plans_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project UUID;
  v_org     UUID;
  v_file    TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.floor_plan_id IS DISTINCT FROM OLD.floor_plan_id
       OR NEW.page_index IS DISTINCT FROM OLD.page_index
       OR NEW.purpose    IS DISTINCT FROM OLD.purpose
       OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'status_plans: the drawing, page and purpose of a plan are fixed; create a new plan instead'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT fp.project_id, fp.organisation_id, fp.file_path
    INTO v_project, v_org, v_file
    FROM tenants.floor_plans fp
   WHERE fp.id = NEW.floor_plan_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'status_plans: drawing % not found', NEW.floor_plan_id USING ERRCODE = '23503';
  END IF;
  IF NEW.project_id IS DISTINCT FROM v_project THEN
    RAISE EXCEPTION 'status_plans: that drawing belongs to another project' USING ERRCODE = '23514';
  END IF;

  NEW.organisation_id := v_org;

  IF TG_OP = 'INSERT' THEN
    NEW.source_file_path := v_file;
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.source_file_path IS DISTINCT FROM OLD.source_file_path
       AND NEW.source_file_path IS DISTINCT FROM v_file THEN
      RAISE EXCEPTION 'status_plans: a plan can only be re-anchored to its drawing''s current file'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plans_bind_parents() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plans_bind_parents ON tenants.status_plans;
CREATE TRIGGER status_plans_bind_parents
    BEFORE INSERT OR UPDATE ON tenants.status_plans
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plans_bind_parents();

DROP TRIGGER IF EXISTS status_plans_updated_at ON tenants.status_plans;
CREATE TRIGGER status_plans_updated_at
    BEFORE UPDATE ON tenants.status_plans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION tenants.status_plan_shapes_check_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project      UUID;
  v_purpose      TEXT;
  v_node_project UUID;
  v_node_kind    TEXT;
  v_node_deleted TIMESTAMPTZ;
  v_node_changed BOOLEAN;
  v_area_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    v_node_changed := NEW.node_id IS NOT NULL;
    v_area_changed := NEW.area_type IS NOT NULL;
  ELSE
    IF NEW.status_plan_id IS DISTINCT FROM OLD.status_plan_id THEN
      RAISE EXCEPTION 'status_plan_shapes: a shape cannot move to another plan' USING ERRCODE = '23514';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    v_node_changed := NEW.node_id IS NOT NULL AND NEW.node_id IS DISTINCT FROM OLD.node_id;
    v_area_changed := NEW.area_type IS NOT NULL AND NEW.area_type IS DISTINCT FROM OLD.area_type;
  END IF;

  -- Geometry-only edits, unlinking, and the ON DELETE SET NULL fired by a
  -- hard-deleted node all leave here, so a plan can never block deleting a board.
  IF NOT v_node_changed AND NOT v_area_changed THEN
    RETURN NEW;
  END IF;

  SELECT sp.project_id, sp.purpose INTO v_project, v_purpose
    FROM tenants.status_plans sp
   WHERE sp.id = NEW.status_plan_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'status_plan_shapes: status plan % not found', NEW.status_plan_id USING ERRCODE = '23503';
  END IF;

  IF v_area_changed AND v_purpose <> 'tenant_layout' THEN
    RAISE EXCEPTION 'status_plan_shapes: area types belong on tenant layout plans only' USING ERRCODE = '23514';
  END IF;

  IF v_node_changed THEN
    SELECT n.project_id, n.kind, n.deleted_at
      INTO v_node_project, v_node_kind, v_node_deleted
      FROM structure.nodes n
     WHERE n.id = NEW.node_id;
    IF v_node_project IS DISTINCT FROM v_project THEN
      RAISE EXCEPTION 'status_plan_shapes: that board is not on this project' USING ERRCODE = '23514';
    END IF;
    IF v_node_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'status_plan_shapes: that board has been deleted' USING ERRCODE = '23514';
    END IF;
    IF v_purpose = 'tenant_layout' AND v_node_kind <> 'tenant_db' THEN
      RAISE EXCEPTION 'status_plan_shapes: a tenant layout links tenant boards only' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plan_shapes_check_link() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plan_shapes_check_link ON tenants.status_plan_shapes;
CREATE TRIGGER status_plan_shapes_check_link
    BEFORE INSERT OR UPDATE ON tenants.status_plan_shapes
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plan_shapes_check_link();

DROP TRIGGER IF EXISTS status_plan_shapes_updated_at ON tenants.status_plan_shapes;
CREATE TRIGGER status_plan_shapes_updated_at
    BEFORE UPDATE ON tenants.status_plan_shapes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Site-scope resolver (generator text, byte for byte) -----------------------

CREATE OR REPLACE FUNCTION public.site_project_of_status_plan(p_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$ SELECT project_id FROM tenants.status_plans WHERE id = p_id $f$;
REVOKE ALL ON FUNCTION public.site_project_of_status_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_project_of_status_plan(uuid) TO authenticated, service_role;

-- 5. Row security: status_plans ------------------------------------------------

ALTER TABLE tenants.status_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.status_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_plans_select ON tenants.status_plans;
CREATE POLICY status_plans_select ON tenants.status_plans FOR SELECT
    TO authenticated
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_insert ON tenants.status_plans;
CREATE POLICY status_plans_insert ON tenants.status_plans FOR INSERT
    TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_update ON tenants.status_plans;
CREATE POLICY status_plans_update ON tenants.status_plans FOR UPDATE
    TO authenticated
    USING      (public.user_has_project_access(project_id))
    WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_delete ON tenants.status_plans;
CREATE POLICY status_plans_delete ON tenants.status_plans FOR DELETE
    TO authenticated
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS status_plans_insert_authz ON tenants.status_plans;
CREATE POLICY status_plans_insert_authz ON tenants.status_plans
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plans_update_authz ON tenants.status_plans;
CREATE POLICY status_plans_update_authz ON tenants.status_plans
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plans_delete_authz ON tenants.status_plans;
CREATE POLICY status_plans_delete_authz ON tenants.status_plans
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(project_id), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS site_scope ON tenants.status_plans;
CREATE POLICY site_scope ON tenants.status_plans AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(project_id))
  WITH CHECK (public.user_has_project_access(project_id));

-- 6. Row security: status_plan_shapes ------------------------------------------

ALTER TABLE tenants.status_plan_shapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.status_plan_shapes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_plan_shapes_select ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_select ON tenants.status_plan_shapes FOR SELECT
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_insert ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_insert ON tenants.status_plan_shapes FOR INSERT
    TO authenticated
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_update ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_update ON tenants.status_plan_shapes FOR UPDATE
    TO authenticated
    USING      (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_delete ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_delete ON tenants.status_plan_shapes FOR DELETE
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_shapes_insert_authz ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_insert_authz ON tenants.status_plan_shapes
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_shapes_update_authz ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_update_authz ON tenants.status_plan_shapes
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_shapes_delete_authz ON tenants.status_plan_shapes;
CREATE POLICY status_plan_shapes_delete_authz ON tenants.status_plan_shapes
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS site_scope ON tenants.status_plan_shapes;
CREATE POLICY site_scope ON tenants.status_plan_shapes AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

-- 7. Grants ---------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants.status_plans, tenants.status_plan_shapes TO authenticated;
GRANT ALL ON tenants.status_plans, tenants.status_plan_shapes TO service_role;
REVOKE ALL ON tenants.status_plans, tenants.status_plan_shapes FROM anon;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Run the two suites that parse every migration**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/lib/migrations/verify-header.test.ts
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
```

Expected: both PASS, including a new case named `00245_status_plans.sql declares every table, view and function it creates`. If the parser throws `not a directive`, a prose line slipped into the block; move it above `-- @verify:begin`.

- [ ] **Step 3: Run the db suite (anon EXECUTE model, annotated predicate)**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db test
```

Expected: `anon-execute-secdef.test.ts` PASSES (the resolver is revoked from `PUBLIC, anon`). `floor-plan-annotated-predicate.contract.test.ts` FAILS with `tenants.status_plans (defined in 00245_status_plans.sql)` in the blind list. That failure is correct and is fixed in Task 3. Do not commit around it differently; commit the migration now and let Task 3 make the suite green.

- [ ] **Step 4: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00245_status_plans.sql
git commit -m "feat(status-plans): migration for status plans and shapes

Tables, binding triggers, per-verb RLS (no FOR ALL role gate), generated
site_scope, grants and the @verify block. Not applied.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Site-scope manifest and the byte-for-byte contract

**Files:**
- Create: `packages/db/src/__tests__/security/status-plans-site-scope.contract.test.ts`
- Modify: `packages/db/src/site-scope/manifest.ts`
- Modify (regenerated): `scripts/db/site-scope/site_scoped_access.sql`

- [ ] **Step 1: Write the failing contract test**

```ts
/**
 * CONTRACT — status plans carry the site_scope text the generator would emit.
 *
 * Since 00238 every site table has a RESTRICTIVE site_scope policy generated
 * from packages/db/src/site-scope/manifest.ts. Tables created after 00238 carry
 * that policy in their own migration (00243, 00244, 00245). Hand-copying it is
 * how the two drift, so this test regenerates the text from the manifest and
 * demands the migration contain it byte for byte: the manifest is the source,
 * the migration is the artefact, and neither is a mirror of the other.
 *
 * The migration is found by name pattern, not number, so a renumber at apply
 * time does not break this test.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMigration } from '../../site-scope/generate'
import { GATED, RESOLVERS } from '../../site-scope/manifest'

const MIGRATIONS_DIR = join(__dirname, '../../../../../apps/edge-functions/supabase/migrations')
const TABLES = ['tenants.status_plans', 'tenants.status_plan_shapes'] as const

function statusPlansMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_status_plans\.sql$/.test(f))
  expect(files, 'exactly one <number>_status_plans.sql migration').toHaveLength(1)
  return readFileSync(join(MIGRATIONS_DIR, files[0]!), 'utf8')
}

/** The generator's DROP + CREATE POLICY text for one table, through the WITH CHECK semicolon. */
function generatedPolicy(sql: string, table: string): string {
  const start = sql.indexOf(`DROP POLICY IF EXISTS site_scope ON ${table};`)
  expect(start, `generator emits no site_scope for ${table}: add it to the manifest`).toBeGreaterThan(-1)
  const withCheck = sql.indexOf('WITH CHECK (', start)
  const end = sql.indexOf(';', withCheck)
  return sql.slice(start, end + 1)
}

function generatedResolver(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.site_project_of_${name}(p_id uuid)`)
  expect(start, `generator emits no resolver ${name}: add it to the manifest`).toBeGreaterThan(-1)
  const grant = `GRANT EXECUTE ON FUNCTION public.site_project_of_${name}(uuid) TO authenticated, service_role;`
  const end = sql.indexOf(grant, start)
  return sql.slice(start, end + grant.length)
}

describe('status plans site_scope matches the generator', () => {
  const generated = generateMigration()
  const migration = statusPlansMigration()

  it('the manifest gates both tables and declares the status_plan resolver', () => {
    const gated = GATED.map((g) => g.table)
    for (const t of TABLES) expect(gated, t).toContain(t)
    expect(RESOLVERS.find((r) => r.name === 'status_plan')?.table).toBe('tenants.status_plans')
  })

  it('the migration carries the resolver text byte for byte', () => {
    expect(migration).toContain(generatedResolver(generated, 'status_plan'))
  })

  for (const t of TABLES) {
    it(`${t}: the migration carries the site_scope policy text byte for byte`, () => {
      expect(migration).toContain(generatedPolicy(generated, t))
    })
  }

  it('can fail: a table the migration does not create is not found in it', () => {
    expect(migration).not.toContain(generatedPolicy(generated, 'tenants.floor_plan_markups'))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/status-plans-site-scope.contract.test.ts
```

Expected: FAIL on `the manifest gates both tables…` and on the resolver/policy cases with `generator emits no site_scope for tenants.status_plans: add it to the manifest`.

- [ ] **Step 3: Register the tables in the manifest**

In `packages/db/src/site-scope/manifest.ts`, add the resolver after the `floor_plan` resolver line:

```ts
  { name: 'floor_plan',       table: 'tenants.floor_plans',         via: { column: 'project_id' } },
  { name: 'status_plan',      table: 'tenants.status_plans',        via: { column: 'project_id' } },
```

Add `'tenants.status_plans'` as the last entry of the direct list:

```ts
    'projects.load_profile_sources', 'projects.work_items', 'projects.tenders', 'projects.project_settings',
    'tenants.status_plans',
  ].map(direct),
```

Add the child after the `floor_plan_page_scales` child:

```ts
  child('tenants.floor_plan_page_scales', 'floor_plan', 'floor_plan_id'),
  child('tenants.status_plan_shapes', 'status_plan', 'status_plan_id'),
```

Append this sentence to the closing comment block of `GATED` (after the existing E5 paragraph, before `]`):

```ts
  // Status plans (00245) are in this manifest like any generated table, and
  // their migration carries the generator's text byte for byte; a contract
  // test (status-plans-site-scope.contract.test.ts) holds the two together.
```

- [ ] **Step 4: Run the contract and the generator tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/status-plans-site-scope.contract.test.ts src/site-scope/generate.test.ts
```

Expected: PASS (5 + 6 tests). If a policy case still fails, diff the migration's site_scope block against `generateMigration()` output: whitespace (two-space indent on `USING`/`WITH CHECK`, one leading space on ` RETURNS`) must match exactly.

- [ ] **Step 5: Regenerate the reference file**

```bash
pnpm exec tsx scripts/db/site-scope/emit.ts
git diff --stat scripts/db/site-scope/site_scoped_access.sql
```

Expected: `wrote scripts/db/site-scope/site_scoped_access.sql`; the diff adds the resolver, two policies and three `@verify` lines, and nothing else. Do NOT copy this file over `00238`: `00238` is applied and immutable.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/site-scope/manifest.ts scripts/db/site-scope/site_scoped_access.sql packages/db/src/__tests__/security/status-plans-site-scope.contract.test.ts
git commit -m "feat(status-plans): register status plans in the site-scope manifest

Contract test pins the migration's site_scope text to the generator.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `isAnnotated()` sees status plans

**Files:**
- Modify: `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`
- Modify: `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts`

- [ ] **Step 1: Make discovery assert the new table**

In `floor-plan-annotated-predicate.contract.test.ts`, inside `it('discovers the tables we know are there', …)`, add `'tenants.status_plans',` after `'solar.layout_objects',`:

```ts
        'solar.roof_sources',
        'solar.layout_objects',
        'tenants.status_plans',
      ]) {
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
```

Expected: `discovers the tables we know are there` PASSES (the migration exists) and `queries, or explicitly exempts, every table…` FAILS listing `tenants.status_plans (defined in 00245_status_plans.sql)`.

- [ ] **Step 3: Add the fail-closed lookup**

In `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts`, replace:

```ts
  if (loe || layoutObject) return true

  return false
}
```

with:

```ts
  if (loe || layoutObject) return true

  // A status plan (00245): shop masks and DB-block rectangles in raw image
  // pixels of THIS file's page. The plan's source_file_path records the file
  // it was drawn on and the plan page warns when they diverge, but, as for
  // markup layers, not adopting silently is the actual protection.
  const { data: statusPlan, error: spe } = await supabase
    .schema('tenants')
    .from('status_plans')
    .select('id')
    .eq('floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (spe || statusPlan) return true

  return false
}
```

In the doc comment above `isAnnotated`, replace `or a Solar roof source or layout object.` with `a Solar roof source or layout object, or a status plan.`

- [ ] **Step 4: Run the db suite**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db test
```

Expected: PASS, including `fails closed on a query error` (one more `.from(` and one more `return true`, still exactly one `return false`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts apps/edge-functions/supabase/functions/cloud-sync-project/index.ts
git commit -m "feat(status-plans): cloud-sync treats a drawing with a status plan as annotated

Fail-closed lookup; not deployed (deploy only after 00245 is applied).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Behavioural assertions (impersonation)

**Files:**
- Create: `scripts/db/assert-status-plans-roles.sql`

This file is executed in Task 20 against production inside rolled-back transactions. It must end in one `(check, ok)` statement. Every identity it needs except the contractor is minted inside the transaction and rolled back. All fixture names are invented (`ZZSP-*`, `probe-*@example.invalid`).

- [ ] **Step 1: Write the assertions file**

```sql
-- BEHAVIOURAL assertions for 00245 (status plans), run as real roles.
--
--   red:   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-status-plans-roles.sql
--   green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00245_status_plans.sql scripts/db/assert-status-plans-roles.sql
--
-- Mechanics this project has paid for:
--   * set_config('request.jwt.claims', ..., true) is transaction-local and
--     outlives RESET ROLE, so all fixtures are seeded first and the claim is
--     cleared before any later postgres-path write.
--   * UPDATE needs SELECT visibility: the contractor's refused UPDATE is probed
--     on a row the contractor CAN read, so a zero is the write gate, not the
--     read policy.
--   * The site_scope probe is the one person only site scope stops: an active
--     project PM whose organisation membership LAPSED. A control row proves the
--     role helper still admits them and user_has_project_access does not.
--     Because every permissive policy here also uses user_has_project_access,
--     site_scope is belt and braces on these tables; the lapsed-PM rows prove
--     the end state, not site_scope alone.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_project        UUID;
  v_org            UUID;
  v_drawing        UUID;
  v_drawing_file   TEXT;
  v_other_project  UUID;
  v_other_proj_org UUID;
  v_other_org      UUID;
  v_contractor     UUID;
  v_pm             UUID := gen_random_uuid();
  v_client         UUID := gen_random_uuid();
  v_lapsed         UUID := gen_random_uuid();
  v_t1             UUID;
  v_t2             UUID;
  v_t3_deleted     UUID;
  v_mb             UUID;
  v_foreign        UUID;
  v_layout         UUID;
  v_schematic      UUID;
  v_shape          UUID;
  v_pm_plan        UUID;
  v_pm_shape       UUID;
  v_n              INT;
  v_txt            TEXT;
  v_uuid           UUID;
BEGIN
  -- ── Fixtures (postgres path, no claims) ─────────────────────────────────
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm
   WHERE pm.role = 'contractor' AND pm.is_active
     AND EXISTS (SELECT 1 FROM tenants.floor_plans fp WHERE fp.project_id = pm.project_id)
     AND EXISTS (SELECT 1 FROM public.user_organisations uo
                  WHERE uo.user_id = pm.user_id AND uo.role = 'contractor' AND uo.is_active)
   LIMIT 1;
  IF v_contractor IS NULL THEN RAISE EXCEPTION 'fixture: no contractor on a project with drawings'; END IF;

  SELECT fp.id, fp.organisation_id, fp.file_path INTO v_drawing, v_org, v_drawing_file
    FROM tenants.floor_plans fp WHERE fp.project_id = v_project LIMIT 1;
  SELECT p.id, p.organisation_id INTO v_other_project, v_other_proj_org
    FROM projects.projects p WHERE p.id <> v_project LIMIT 1;
  SELECT o.id INTO v_other_org FROM public.organisations o WHERE o.id <> v_org LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sp-pm@example.invalid',     '', now(), now(), now(), '{}', '{}'),
         (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sp-client@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_lapsed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sp-lapsed@example.invalid', '', now(), now(), now(), '{}', '{}');
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
  VALUES (v_pm, v_org, 'project_manager', TRUE),
         (v_client, v_org, 'client_viewer', TRUE),
         (v_lapsed, v_org, 'project_manager', FALSE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_project, v_pm, v_org, 'project_manager', TRUE),
         (v_project, v_client, v_org, 'client_viewer', TRUE),
         (v_project, v_lapsed, v_org, 'project_manager', TRUE);

  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZSP-T1', 'ZZSP-1', 'Probe Lantern') RETURNING id INTO v_t1;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZSP-T2', 'ZZSP-2', 'Probe Kettle') RETURNING id INTO v_t2;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name, deleted_at)
  VALUES (v_project, v_org, 'tenant_db', 'ZZSP-T3', 'ZZSP-3', 'Probe Gone', now()) RETURNING id INTO v_t3_deleted;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  VALUES (v_project, v_org, 'main_board', 'ZZSP-MB', 'Probe Main Board') RETURNING id INTO v_mb;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_other_project, v_other_proj_org, 'tenant_db', 'ZZSP-FX', 'ZZSP-9', 'Probe Elsewhere') RETURNING id INTO v_foreign;

  -- organisation_id and source_file_path are supplied here so this seed
  -- survives the "binding removed" mutation in Task 20.
  INSERT INTO tenants.status_plans (project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path)
  VALUES (v_project, v_org, v_drawing, 1, 'tenant_layout', 'ZZ probe layout', v_drawing_file) RETURNING id INTO v_layout;
  INSERT INTO tenants.status_plans (project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path)
  VALUES (v_project, v_org, v_drawing, 1, 'distribution_schematic', 'ZZ probe schematic', v_drawing_file) RETURNING id INTO v_schematic;
  INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
  VALUES (v_layout, 'polygon', '[10,10,200,10,200,120,10,120]'::jsonb, v_t1) RETURNING id INTO v_shape;

  -- ═══ 1. PROJECT MANAGER (ORG_WRITE_ROLES) ═══════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_pm_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND public.user_has_project_access(v_project));

  BEGIN
    INSERT INTO tenants.status_plans (project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path, created_by)
    VALUES (v_project, v_other_org, v_drawing, 2, 'tenant_layout', 'PM plan', 'forged.pdf', v_contractor)
    RETURNING id INTO v_pm_plan;
    INSERT INTO _r VALUES ('pm_plan_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_plan_insert_ok', false);
  END;
  SELECT organisation_id::text INTO v_txt FROM tenants.status_plans WHERE id = v_pm_plan;
  INSERT INTO _r VALUES ('pm_plan_org_bound_from_drawing', v_txt = v_org::text);
  SELECT source_file_path INTO v_txt FROM tenants.status_plans WHERE id = v_pm_plan;
  INSERT INTO _r VALUES ('pm_plan_source_file_bound_from_drawing', v_txt = v_drawing_file);
  SELECT created_by INTO v_uuid FROM tenants.status_plans WHERE id = v_pm_plan;
  INSERT INTO _r VALUES ('pm_plan_created_by_is_caller', v_uuid = v_pm);

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_project, v_drawing, 1, 'tenant_layout', 'Duplicate');
    INSERT INTO _r VALUES ('pm_plan_duplicate_refused', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_plan_duplicate_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_duplicate_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_other_project, v_drawing, 3, 'tenant_layout', 'Wrong project');
    INSERT INTO _r VALUES ('pm_plan_wrong_project_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_wrong_project_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_wrong_project_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_project, v_drawing, 4, 'tenant_layout', '   ');
    INSERT INTO _r VALUES ('pm_plan_blank_name_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_blank_name_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_blank_name_refused', false);
  END;

  UPDATE tenants.status_plans SET name = 'ZZ probe layout renamed' WHERE id = v_layout;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_plan_rename_ok', v_n = 1);

  BEGIN
    UPDATE tenants.status_plans SET source_file_path = 'elsewhere.pdf' WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_forged_anchor_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_forged_anchor_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_forged_anchor_refused', false);
  END;

  BEGIN
    UPDATE tenants.status_plans SET purpose = 'distribution_schematic', page_index = 9 WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_purpose_change_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_purpose_change_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_purpose_change_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[300,10,420,10,420,90,300,90]'::jsonb, v_t2)
    RETURNING id INTO v_pm_shape;
    INSERT INTO _r VALUES ('pm_shape_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_insert_ok', false);
  END;
  SELECT created_by INTO v_uuid FROM tenants.status_plan_shapes WHERE id = v_pm_shape;
  INSERT INTO _r VALUES ('pm_shape_created_by_is_caller', v_uuid = v_pm);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t1);
    INSERT INTO _r VALUES ('pm_shape_duplicate_node_refused', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_shape_duplicate_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_duplicate_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_foreign);
    INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t3_deleted);
    INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_mb);
    INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id, source, detected_tag)
    VALUES (v_schematic, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, v_mb, 'detected', 'MB-9.9');
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, area_type)
    VALUES (v_schematic, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, 'common');
    INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id, area_type)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t1, 'common');
    INSERT INTO _r VALUES ('pm_shape_node_and_area_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_node_and_area_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_node_and_area_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'rect', '[0,0,10,0,10,10]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_rect_three_corners_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_rect_three_corners_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_rect_three_corners_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,10,"x",10,10]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_non_number_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_non_number_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_non_number_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,10,0,10,10,5]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_odd_count_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_odd_count_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_odd_count_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, area_type)
    VALUES (v_layout, 'polygon', '[500,10,600,10,600,80,500,80]'::jsonb, 'plant_room');
    INSERT INTO _r VALUES ('pm_shape_area_only_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_area_only_ok', false);
  END;

  UPDATE tenants.status_plan_shapes SET points = '[12,12,205,12,205,125,12,125]'::jsonb WHERE id = v_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_shape_update_ok', v_n = 1);

  BEGIN
    UPDATE tenants.status_plan_shapes SET status_plan_id = v_schematic WHERE id = v_shape;
    INSERT INTO _r VALUES ('pm_shape_move_plan_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_move_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_move_plan_refused', false);
  END;

  DELETE FROM tenants.status_plan_shapes WHERE id = v_pm_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_shape_delete_ok', v_n = 1);

  RESET ROLE;

  -- ═══ 2. CONTRACTOR (not in ORG_WRITE_ROLES) ════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_contractor_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'contractor'
    AND public.user_has_project_access(v_project));

  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('contractor_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('contractor_reads_shape', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_project, v_drawing, 5, 'tenant_layout', 'Contractor plan');
    INSERT INTO _r VALUES ('contractor_plan_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_plan_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_plan_insert_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, area_type)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, 'vacant');
    INSERT INTO _r VALUES ('contractor_shape_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', false);
  END;

  UPDATE tenants.status_plan_shapes SET points = '[1,1,2,1,2,2]'::jsonb WHERE id = v_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_shape_update_affects_nothing', v_n = 0);

  DELETE FROM tenants.status_plan_shapes WHERE id = v_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_shape_delete_affects_nothing', v_n = 0);

  DELETE FROM tenants.status_plans WHERE id = v_layout;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_plan_delete_affects_nothing', v_n = 0);

  RESET ROLE;

  -- ═══ 3. CLIENT VIEWER (reads, never writes) ════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_client_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'client_viewer');
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('client_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('client_reads_shape', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb);
    INSERT INTO _r VALUES ('client_shape_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_shape_insert_refused', false);
  END;

  RESET ROLE;

  -- ═══ 4. LAPSED PM (only site scope / project access stops them) ════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lapsed::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_lapsed_probe_is_the_right_person',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND NOT public.user_has_project_access(v_project));
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_sees_no_plan', v_n = 0);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('lapsed_sees_no_shape', v_n = 0);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb);
    INSERT INTO _r VALUES ('lapsed_shape_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege OR foreign_key_violation THEN INSERT INTO _r VALUES ('lapsed_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_shape_insert_refused', false);
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ 5. SERVICE ROLE (cloud-sync isAnnotated runs as this) ═════════════
  -- A service role subject to RLS would read ZERO and every drawing with a
  -- status plan would read as unannotated. There is a row by now.
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE floor_plan_id = v_drawing;
  INSERT INTO _r VALUES ('service_role_sees_plans', v_n >= 2);
  RESET ROLE;

  -- ═══ 6. ANON (refused at the grant) ════════════════════════════════════
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM tenants.status_plans LIMIT 1;
    INSERT INTO _r VALUES ('anon_table_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_table_refused', true);
  END;
  BEGIN
    PERFORM public.site_project_of_status_plan(v_layout);
    INSERT INTO _r VALUES ('anon_resolver_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_resolver_refused', true);
  END;
  RESET ROLE;

  -- ═══ 7. A hard-deleted node unlinks its shape, never blocks the delete ═
  DELETE FROM structure.nodes WHERE id = v_t1;
  SELECT node_id INTO v_uuid FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('node_hard_delete_unlinks_shape',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plan_shapes WHERE id = v_shape));
END $$;

SELECT * FROM (VALUES
  ('FIXTURE: PM resolves to project_manager with project access',      (SELECT v FROM _r WHERE k='fx_pm_role')),
  ('FIXTURE: contractor resolves to contractor with project access',   (SELECT v FROM _r WHERE k='fx_contractor_role')),
  ('FIXTURE: client viewer resolves to client_viewer',                 (SELECT v FROM _r WHERE k='fx_client_role')),
  ('FIXTURE: lapsed PM passes the role helper, fails project access',  (SELECT v FROM _r WHERE k='fx_lapsed_probe_is_the_right_person')),
  ('PM creates a plan',                                                (SELECT v FROM _r WHERE k='pm_plan_insert_ok')),
  ('plan organisation is bound from the drawing (wrong value discarded)', (SELECT v FROM _r WHERE k='pm_plan_org_bound_from_drawing')),
  ('plan source_file_path is bound from the drawing',                  (SELECT v FROM _r WHERE k='pm_plan_source_file_bound_from_drawing')),
  ('plan created_by is the caller, not the supplied id',               (SELECT v FROM _r WHERE k='pm_plan_created_by_is_caller')),
  ('a second plan for the same drawing, page and purpose is refused',  (SELECT v FROM _r WHERE k='pm_plan_duplicate_refused')),
  ('a plan naming another project than its drawing is refused',        (SELECT v FROM _r WHERE k='pm_plan_wrong_project_refused')),
  ('a blank plan name is refused',                                     (SELECT v FROM _r WHERE k='pm_plan_blank_name_refused')),
  ('PM renames a plan',                                                (SELECT v FROM _r WHERE k='pm_plan_rename_ok')),
  ('re-anchoring to a file that is not the drawing''s is refused',     (SELECT v FROM _r WHERE k='pm_plan_forged_anchor_refused')),
  ('a plan''s purpose and page are fixed',                             (SELECT v FROM _r WHERE k='pm_plan_purpose_change_refused')),
  ('PM links a shape to a tenant board',                               (SELECT v FROM _r WHERE k='pm_shape_insert_ok')),
  ('shape created_by is the caller',                                   (SELECT v FROM _r WHERE k='pm_shape_created_by_is_caller')),
  ('a board appears at most once per plan',                            (SELECT v FROM _r WHERE k='pm_shape_duplicate_node_refused')),
  ('a board from another project is refused',                          (SELECT v FROM _r WHERE k='pm_shape_foreign_node_refused')),
  ('a soft-deleted board is refused',                                  (SELECT v FROM _r WHERE k='pm_shape_soft_deleted_node_refused')),
  ('a tenant layout refuses a main board',                             (SELECT v FROM _r WHERE k='pm_shape_main_board_on_layout_refused')),
  ('a schematic accepts a main board (detected)',                      (SELECT v FROM _r WHERE k='pm_shape_main_board_on_schematic_ok')),
  ('a schematic refuses an area type',                                 (SELECT v FROM _r WHERE k='pm_shape_area_on_schematic_refused')),
  ('a shape cannot carry both a board and an area type',               (SELECT v FROM _r WHERE k='pm_shape_node_and_area_refused')),
  ('a rectangle needs exactly four corners',                           (SELECT v FROM _r WHERE k='pm_shape_rect_three_corners_refused')),
  ('points must all be numbers',                                       (SELECT v FROM _r WHERE k='pm_shape_non_number_refused')),
  ('points come in x, y pairs',                                        (SELECT v FROM _r WHERE k='pm_shape_odd_count_refused')),
  ('an unlinked area shape is accepted on a layout',                   (SELECT v FROM _r WHERE k='pm_shape_area_only_ok')),
  ('PM moves a shape''s vertices',                                     (SELECT v FROM _r WHERE k='pm_shape_update_ok')),
  ('a shape cannot move to another plan',                              (SELECT v FROM _r WHERE k='pm_shape_move_plan_refused')),
  ('PM deletes a shape',                                               (SELECT v FROM _r WHERE k='pm_shape_delete_ok')),
  ('contractor reads the plan',                                        (SELECT v FROM _r WHERE k='contractor_reads_plan')),
  ('contractor reads the shape',                                       (SELECT v FROM _r WHERE k='contractor_reads_shape')),
  ('RESTRICTIVE gate bites: contractor plan insert refused 42501',     (SELECT v FROM _r WHERE k='contractor_plan_insert_refused')),
  ('RESTRICTIVE gate bites: contractor shape insert refused 42501',    (SELECT v FROM _r WHERE k='contractor_shape_insert_refused')),
  ('contractor update of a readable shape affects nothing',            (SELECT v FROM _r WHERE k='contractor_shape_update_affects_nothing')),
  ('contractor delete of a readable shape affects nothing',            (SELECT v FROM _r WHERE k='contractor_shape_delete_affects_nothing')),
  ('contractor delete of a readable plan affects nothing',             (SELECT v FROM _r WHERE k='contractor_plan_delete_affects_nothing')),
  ('client viewer reads the plan',                                     (SELECT v FROM _r WHERE k='client_reads_plan')),
  ('client viewer reads the shape',                                    (SELECT v FROM _r WHERE k='client_reads_shape')),
  ('client viewer shape insert refused',                               (SELECT v FROM _r WHERE k='client_shape_insert_refused')),
  ('site scope: lapsed PM sees no plan',                               (SELECT v FROM _r WHERE k='lapsed_sees_no_plan')),
  ('site scope: lapsed PM sees no shape',                              (SELECT v FROM _r WHERE k='lapsed_sees_no_shape')),
  ('site scope: lapsed PM shape insert refused',                       (SELECT v FROM _r WHERE k='lapsed_shape_insert_refused')),
  ('service role still sees plans, so isAnnotated() is not blind',     (SELECT v FROM _r WHERE k='service_role_sees_plans')),
  ('anon refused on the table',                                        (SELECT v FROM _r WHERE k='anon_table_refused')),
  ('anon refused on the resolver',                                     (SELECT v FROM _r WHERE k='anon_resolver_refused')),
  ('hard-deleting a board unlinks its shape and keeps the shape',      (SELECT v FROM _r WHERE k='node_hard_delete_unlinks_shape'))
) AS t("check", ok);
```

- [ ] **Step 2: Check the file cannot commit a dry run**

```bash
grep -nEi '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION)[[:space:]]*(WORK|TRANSACTION)?[[:space:]]*;' scripts/db/assert-status-plans-roles.sql || echo "no top-level transaction control"
```

Expected: `no top-level transaction control` (PL/pgSQL `BEGIN` without a semicolon is fine).

- [ ] **Step 3: Commit**

```bash
git add scripts/db/assert-status-plans-roles.sql
git commit -m "test(status-plans): impersonation assertions for 00245

54 rows; run in Task 20 against production in rolled-back transactions.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Shared types and the schema mirror

**Files:**
- Create: `packages/shared/src/status-plans/types.ts`
- Test: `packages/shared/src/status-plans/types.test.ts`

The test reads the CHECK lists out of the migration file, so the TypeScript constants are checked against the artefact, not re-typed from the same intent.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  STATUS_PLAN_PURPOSES,
  AREA_TYPES,
  SHAPE_KINDS,
  SHAPE_SOURCES,
  MAX_POINT_VALUES,
  pointsError,
  statusPlanFromRow,
  statusPlanShapeFromRow,
  type StatusPlanRow,
  type StatusPlanShapeRow,
} from './types'

const MIGRATIONS_DIR = new URL('../../../../apps/edge-functions/supabase/migrations/', import.meta.url)

function migrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_status_plans\.sql$/.test(f))
  expect(files).toHaveLength(1)
  return readFileSync(new URL(files[0]!, MIGRATIONS_DIR), 'utf8')
}

/** Every quoted literal on the line that declares the named constraint. */
function checkList(sql: string, constraint: string): string[] {
  const line = sql.split('\n').find((l) => l.includes(`CONSTRAINT ${constraint} CHECK`))
  expect(line, `constraint ${constraint} not found`).toBeDefined()
  return [...line!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
}

describe('constants mirror the migration CHECKs', () => {
  const sql = migrationSql()

  it('purposes', () => {
    expect([...STATUS_PLAN_PURPOSES].sort()).toEqual(checkList(sql, 'status_plans_purpose_check').sort())
  })
  it('area types', () => {
    expect([...AREA_TYPES].sort()).toEqual(checkList(sql, 'status_plan_shapes_area_type_check').sort())
  })
  it('shape kinds', () => {
    expect([...SHAPE_KINDS].sort()).toEqual(checkList(sql, 'status_plan_shapes_shape_check').sort())
  })
  it('sources', () => {
    expect([...SHAPE_SOURCES].sort()).toEqual(checkList(sql, 'status_plan_shapes_source_check').sort())
  })
  it('the point cap', () => {
    const line = sql.split('\n').find((l) => l.includes('CONSTRAINT status_plan_shapes_points_shape CHECK'))!
    expect(Number(line.match(/BETWEEN 6 AND (\d+)/)![1])).toBe(MAX_POINT_VALUES)
  })
})

describe('pointsError mirrors status_plan_shapes_points_shape', () => {
  it('accepts a triangle polygon and a four-corner rectangle', () => {
    expect(pointsError('polygon', [0, 0, 10, 0, 10, 10])).toBeNull()
    expect(pointsError('rect', [0, 0, 10, 0, 10, 10, 0, 10])).toBeNull()
  })
  it('refuses a non-array, non-numbers, odd counts and too few corners', () => {
    expect(pointsError('polygon', 'nope')).toBe('A shape needs a list of points.')
    expect(pointsError('polygon', [0, 0, 10, 'x', 10, 10])).toBe('Every point must be a number.')
    expect(pointsError('polygon', [0, 0, 10, Number.NaN, 10, 10])).toBe('Every point must be a number.')
    expect(pointsError('polygon', [0, 0, 10, 0, 10, 10, 5])).toBe('Points come in x, y pairs.')
    expect(pointsError('polygon', [0, 0, 10, 0])).toBe('A shape needs at least three corners.')
  })
  it('refuses a rectangle without exactly four corners', () => {
    expect(pointsError('rect', [0, 0, 10, 0, 10, 10])).toBe('A rectangle has exactly four corners.')
  })
  it('refuses more than the cap and accepts exactly the cap', () => {
    const at = Array.from({ length: MAX_POINT_VALUES }, (_, i) => i)
    expect(pointsError('polygon', at)).toBeNull()
    expect(pointsError('polygon', [...at, 1, 2])).toBe('This shape has too many corners (2,000 at most).')
  })
})

describe('row mappers', () => {
  it('maps a plan row', () => {
    const row: StatusPlanRow = {
      id: 'sp-1', project_id: 'p-1', organisation_id: 'o-1', floor_plan_id: 'fp-1', page_index: 2,
      purpose: 'tenant_layout', name: 'Ground floor', source_file_path: 'drawings/zz-100.pdf',
      created_by: 'u-1', created_at: '2026-10-09T08:00:00Z', updated_at: '2026-10-09T09:00:00Z',
    }
    expect(statusPlanFromRow(row)).toEqual({
      id: 'sp-1', projectId: 'p-1', organisationId: 'o-1', floorPlanId: 'fp-1', pageIndex: 2,
      purpose: 'tenant_layout', name: 'Ground floor', sourceFilePath: 'drawings/zz-100.pdf',
      createdBy: 'u-1', createdAt: '2026-10-09T08:00:00Z', updatedAt: '2026-10-09T09:00:00Z',
    })
  })
  it('maps a shape row and coerces points to numbers', () => {
    const row: StatusPlanShapeRow = {
      id: 'sh-1', status_plan_id: 'sp-1', shape: 'rect', points: [0, 0, 10, 0, 10, 5, 0, 5],
      node_id: null, area_type: 'vacant', detected_tag: null, source: 'manual',
      created_by: null, created_at: '2026-10-09T08:00:00Z', updated_at: '2026-10-09T08:00:00Z',
    }
    expect(statusPlanShapeFromRow(row)).toEqual({
      id: 'sh-1', statusPlanId: 'sp-1', shape: 'rect', points: [0, 0, 10, 0, 10, 5, 0, 5],
      nodeId: null, areaType: 'vacant', detectedTag: null, source: 'manual',
      createdBy: null, createdAt: '2026-10-09T08:00:00Z', updatedAt: '2026-10-09T08:00:00Z',
    })
  })
  it('refuses a shape row whose points the database would never have stored', () => {
    const row = { id: 'sh-2', status_plan_id: 'sp-1', shape: 'polygon', points: { not: 'an array' },
      node_id: null, area_type: null, detected_tag: null, source: 'manual',
      created_by: null, created_at: 'x', updated_at: 'x' } as unknown as StatusPlanShapeRow
    expect(() => statusPlanShapeFromRow(row)).toThrow('status_plan_shapes sh-2: A shape needs a list of points.')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/types.test.ts
```

Expected: FAIL with `Failed to resolve import "./types"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Status plans — shared shapes (spec 2026-10-09 §4).
 *
 * A status plan is one page of a drawing marked with a purpose. Its shapes
 * store geometry + link + type ONLY: image-space pixels of the page at the
 * fixed scale-2 raster (apps/web/src/lib/sheet), flat [x0, y0, x1, y1, …].
 * Status, colour, hatch and area are derived, never stored.
 *
 * The constants below mirror the CHECKs in the status-plans migration;
 * types.test.ts reads the migration and fails if they drift.
 */

export const STATUS_PLAN_PURPOSES = ['tenant_layout', 'distribution_schematic'] as const
export type StatusPlanPurpose = (typeof STATUS_PLAN_PURPOSES)[number]

export const AREA_TYPES = ['common', 'plant_room', 'services', 'vacant'] as const
export type AreaType = (typeof AREA_TYPES)[number]

export const AREA_TYPE_LABEL: Record<AreaType, string> = {
  common: 'Mall / common area',
  plant_room: 'Plant / electrical room',
  services: 'Services / back-of-house',
  vacant: 'Vacant / future',
}

export const PURPOSE_LABEL: Record<StatusPlanPurpose, string> = {
  tenant_layout: 'Tenant layout',
  distribution_schematic: 'Distribution schematic',
}

export const SHAPE_KINDS = ['polygon', 'rect'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

export const SHAPE_SOURCES = ['manual', 'detected'] as const
export type ShapeSource = (typeof SHAPE_SOURCES)[number]

/** structure.node_orders.status. Same union as the tenant schedule report's OrderStatus. */
export type NodeOrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

/** A tenant's scope-of-work state, as the tenant schedule report computes it. */
export type ScopeState = 'awaited' | 'received' | 'not_required'

/** The database's cap on numbers in `points` (2,000 corners). */
export const MAX_POINT_VALUES = 4000

/**
 * The status_plan_shapes_points_shape CHECK as a sentence, or null when the
 * points would be accepted. Server actions return this instead of letting the
 * database refuse with a constraint name.
 */
export function pointsError(shape: ShapeKind, points: unknown): string | null {
  if (!Array.isArray(points)) return 'A shape needs a list of points.'
  if (points.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'Every point must be a number.'
  if (points.length % 2 !== 0) return 'Points come in x, y pairs.'
  if (points.length < 6) return 'A shape needs at least three corners.'
  if (points.length > MAX_POINT_VALUES) return 'This shape has too many corners (2,000 at most).'
  if (shape === 'rect' && points.length !== 8) return 'A rectangle has exactly four corners.'
  return null
}

/** tenants.status_plans as PostgREST returns it. */
export interface StatusPlanRow {
  id: string
  project_id: string
  organisation_id: string
  floor_plan_id: string
  page_index: number
  purpose: StatusPlanPurpose
  name: string
  source_file_path: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/** tenants.status_plan_shapes as PostgREST returns it. */
export interface StatusPlanShapeRow {
  id: string
  status_plan_id: string
  shape: ShapeKind
  points: unknown
  node_id: string | null
  area_type: AreaType | null
  detected_tag: string | null
  source: ShapeSource
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface StatusPlan {
  id: string
  projectId: string
  organisationId: string
  floorPlanId: string
  pageIndex: number
  purpose: StatusPlanPurpose
  name: string
  sourceFilePath: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface StatusPlanShape {
  id: string
  statusPlanId: string
  shape: ShapeKind
  points: number[]
  nodeId: string | null
  areaType: AreaType | null
  detectedTag: string | null
  source: ShapeSource
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export function statusPlanFromRow(r: StatusPlanRow): StatusPlan {
  return {
    id: r.id,
    projectId: r.project_id,
    organisationId: r.organisation_id,
    floorPlanId: r.floor_plan_id,
    pageIndex: r.page_index,
    purpose: r.purpose,
    name: r.name,
    sourceFilePath: r.source_file_path,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function statusPlanShapeFromRow(r: StatusPlanShapeRow): StatusPlanShape {
  const err = pointsError(r.shape, r.points)
  if (err) throw new Error(`status_plan_shapes ${r.id}: ${err}`)
  return {
    id: r.id,
    statusPlanId: r.status_plan_id,
    shape: r.shape,
    points: (r.points as number[]).map(Number),
    nodeId: r.node_id,
    areaType: r.area_type,
    detectedTag: r.detected_tag,
    source: r.source,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/types.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/types.ts packages/shared/src/status-plans/types.test.ts
git commit -m "feat(status-plans): shared types, row mappers and points check

Constants are tested against the migration's CHECK lists.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Shop status

**Files:**
- Create: `packages/shared/src/status-plans/shop-status.ts`
- Test: `packages/shared/src/status-plans/shop-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { shopStatus, isShopComplete, SHOP_STATUS_LABEL, type ShopProgressFacts } from './shop-status'

const TODAY = '2026-06-20'
const COMPLETE: ShopProgressFacts = {
  scope: 'received',
  layoutIssued: true,
  db: 'received',
  lights: 'received',
  boDate: '2026-05-01',
}
const active = (over: Partial<ShopProgressFacts> = {}) =>
  ({ state: 'active', facts: { ...COMPLETE, ...over } }) as const

describe('isShopComplete', () => {
  it('needs scope, layout, DB and lights all done', () => {
    expect(isShopComplete(COMPLETE)).toBe(true)
  })
  it('accepts not-required scope and by-tenant orders as done', () => {
    expect(isShopComplete({ ...COMPLETE, scope: 'not_required', db: 'by_tenant', lights: 'by_tenant' })).toBe(true)
  })
  it.each([
    ['scope awaited', { scope: 'awaited' as const }],
    ['layout not issued', { layoutIssued: false }],
    ['DB required', { db: 'required' as const }],
    ['DB ordered', { db: 'ordered' as const }],
    ['lights required', { lights: 'required' as const }],
    ['lights ordered', { lights: 'ordered' as const }],
    ['no DB order row', { db: null }],
    ['no lights order row', { lights: null }],
  ])('is not complete when %s', (_label, over) => {
    expect(isShopComplete({ ...COMPLETE, ...over })).toBe(false)
  })
})

describe('shopStatus', () => {
  it('complete is never overdue, even with a past BO date', () => {
    expect(shopStatus(active(), TODAY)).toEqual({ status: 'complete', overdue: false })
  })
  it('incomplete with a past BO date is in progress and overdue', () => {
    expect(shopStatus(active({ db: 'ordered' }), TODAY)).toEqual({ status: 'in_progress', overdue: true })
  })
  it('a BO date of today is not overdue', () => {
    expect(shopStatus(active({ db: 'ordered', boDate: TODAY }), TODAY)).toEqual({ status: 'in_progress', overdue: false })
  })
  it('a future BO date is not overdue', () => {
    expect(shopStatus(active({ db: 'ordered', boDate: '2026-07-01' }), TODAY)).toEqual({ status: 'in_progress', overdue: false })
  })
  it('no BO date is not overdue', () => {
    expect(shopStatus(active({ db: null, boDate: null }), TODAY)).toEqual({ status: 'in_progress', overdue: false })
  })
  it('decommissioned and unlinked are never overdue', () => {
    expect(shopStatus({ state: 'decommissioned' }, TODAY)).toEqual({ status: 'decommissioned', overdue: false })
    expect(shopStatus({ state: 'unlinked' }, TODAY)).toEqual({ status: 'unlinked', overdue: false })
  })
  it('has a label for every status', () => {
    expect(SHOP_STATUS_LABEL).toEqual({
      complete: 'Complete',
      in_progress: 'In progress',
      decommissioned: 'Decommissioned',
      unlinked: 'Unassigned',
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/shop-status.test.ts
```

Expected: FAIL with `Failed to resolve import "./shop-status"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Shop status for tenant layout plans (spec 2026-10-09 §3.1). Pure.
 *
 * A missing order row is NOT evidence of done: a shop with no DB (or no
 * lights) order counts that item as not yet complete.
 */
import type { NodeOrderStatus, ScopeState } from './types'

export type ShopStatus = 'complete' | 'in_progress' | 'decommissioned' | 'unlinked'

/** The per-shop facts the tenant schedule report already computes (its ShopRow is assignable to this). */
export interface ShopProgressFacts {
  scope: ScopeState
  layoutIssued: boolean
  db: NodeOrderStatus | null
  lights: NodeOrderStatus | null
  /** Effective beneficial-occupation date, ISO yyyy-mm-dd, or null. */
  boDate: string | null
}

/** What a shape's link resolves to, before status is computed. */
export type ShopLink =
  | { state: 'unlinked' }
  | { state: 'decommissioned' }
  | { state: 'active'; facts: ShopProgressFacts }

export interface ShopStatusResult {
  status: ShopStatus
  /** Not complete and the BO date has passed. Drawn as an overlay over the base fill. */
  overdue: boolean
}

export const SHOP_STATUS_LABEL: Record<ShopStatus, string> = {
  complete: 'Complete',
  in_progress: 'In progress',
  decommissioned: 'Decommissioned',
  unlinked: 'Unassigned',
}

const ORDER_DONE: ReadonlySet<NodeOrderStatus> = new Set<NodeOrderStatus>(['received', 'by_tenant'])

export function isShopComplete(f: ShopProgressFacts): boolean {
  const scopeDone = f.scope === 'received' || f.scope === 'not_required'
  const dbDone = f.db !== null && ORDER_DONE.has(f.db)
  const lightsDone = f.lights !== null && ORDER_DONE.has(f.lights)
  return scopeDone && f.layoutIssued && dbDone && lightsDone
}

/** `today` is ISO yyyy-mm-dd; compared as a string, exactly as the report does. */
export function shopStatus(link: ShopLink, today: string): ShopStatusResult {
  if (link.state === 'unlinked') return { status: 'unlinked', overdue: false }
  if (link.state === 'decommissioned') return { status: 'decommissioned', overdue: false }
  if (isShopComplete(link.facts)) return { status: 'complete', overdue: false }
  const bo = link.facts.boDate
  return { status: 'in_progress', overdue: bo !== null && bo < today }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/shop-status.test.ts
```

Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/shop-status.ts packages/shared/src/status-plans/shop-status.test.ts
git commit -m "feat(status-plans): shop status from tenant progress facts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: DB block status

**Files:**
- Create: `packages/shared/src/status-plans/db-block-status.ts`
- Test: `packages/shared/src/status-plans/db-block-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { dbBlockStatus, DB_BLOCK_STATUS_LABEL } from './db-block-status'

describe('dbBlockStatus', () => {
  it('an unlinked block is unlinked whatever order is passed', () => {
    expect(dbBlockStatus(false, null)).toBe('unlinked')
    expect(dbBlockStatus(false, 'received')).toBe('unlinked')
  })
  it('a linked block with no DB order row (e.g. a main board) is no_order', () => {
    expect(dbBlockStatus(true, null)).toBe('no_order')
  })
  it.each(['required', 'ordered', 'received', 'by_tenant'] as const)('a linked block shows its DB order: %s', (s) => {
    expect(dbBlockStatus(true, s)).toBe(s)
  })
  it('has a label for every status', () => {
    expect(DB_BLOCK_STATUS_LABEL).toEqual({
      required: 'Required',
      ordered: 'Ordered',
      received: 'Received',
      by_tenant: 'By tenant',
      no_order: 'No DB order',
      unlinked: 'Unlinked',
    })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/db-block-status.test.ts
```

Expected: FAIL with `Failed to resolve import "./db-block-status"`.

- [ ] **Step 3: Implement**

```ts
/**
 * DB block status for distribution schematic plans (spec 2026-10-09 §3.2).
 * Driven by the linked node's DB order (scope_item_types.key = 'db'). Pure.
 */
import type { NodeOrderStatus } from './types'

export type DbBlockStatus = NodeOrderStatus | 'no_order' | 'unlinked'

export const DB_BLOCK_STATUS_LABEL: Record<DbBlockStatus, string> = {
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
  by_tenant: 'By tenant',
  no_order: 'No DB order',
  unlinked: 'Unlinked',
}

export function dbBlockStatus(linked: boolean, dbOrder: NodeOrderStatus | null): DbBlockStatus {
  if (!linked) return 'unlinked'
  return dbOrder ?? 'no_order'
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/db-block-status.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/db-block-status.ts packages/shared/src/status-plans/db-block-status.test.ts
git commit -m "feat(status-plans): DB block status for schematic plans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Geometry

**Files:**
- Create: `packages/shared/src/status-plans/geometry.ts`
- Test: `packages/shared/src/status-plans/geometry.test.ts`

Reuses Solar's `flatToPts`, `polygonArea` and `pointInPolygon` (`packages/shared/src/solar/layout/geometry.ts`) rather than writing a second shoelace. Hatch lines use a global phase (`v = (k + 0.5) × spacing` in rotated space), so adjacent shapes' hatches line up and Konva and pdf-lib draw identical lines from the same call.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  rectToPoints,
  boundingBox,
  shapeAreaPx,
  shapeAreaM2,
  pointInShape,
  distanceToEdge,
  visualCentre,
  hatchSegments,
} from './geometry'

/** A 12.5 m x 8 m L-shape with a 4.5 m x 3 m notch: 100 - 13.5 = 86.5 m². Invented. */
const L_METRES: Array<[number, number]> = [[0, 0], [12.5, 0], [12.5, 5], [8, 5], [8, 8], [0, 8]]
const PPM = 37.8
const L_PX = L_METRES.flatMap(([x, y]) => [x * PPM - 100.25, y * PPM - 40.5])

/** A "C": the vertex mean (55, 50) lies in the gap, outside the shape. */
const C_SHAPE = [0, 0, 100, 0, 100, 20, 20, 20, 20, 80, 100, 80, 100, 100, 0, 100]

/** A "U" opening downwards (y grows down the sheet): top bar 0..10, arms to 30. */
const U_SHAPE = [0, 0, 30, 0, 30, 30, 20, 30, 20, 10, 10, 10, 10, 30, 0, 30]

const PENTAGON = [0, 0, 100, 0, 130, 60, 50, 110, -20, 60]

describe('rectToPoints / boundingBox', () => {
  it('normalises any drag direction to TL, TR, BR, BL', () => {
    expect(rectToPoints(50, 40, 10, 5)).toEqual([10, 5, 50, 5, 50, 40, 10, 40])
  })
  it('boundingBox spans every vertex', () => {
    expect(boundingBox(PENTAGON)).toEqual({ minX: -20, minY: 0, maxX: 130, maxY: 110 })
  })
})

describe('area', () => {
  it('shoelace in pixels is orientation-independent', () => {
    const rect = rectToPoints(0, 0, 20, 12)
    const reversed = [0, 12, 20, 12, 20, 0, 0, 0] // the same rectangle, listed the other way round
    expect(shapeAreaPx(rect)).toBe(240)
    expect(shapeAreaPx(reversed)).toBe(240)
  })
  it('measures a fractional, negative-coordinate L-shape in m²', () => {
    expect(shapeAreaM2(L_PX, PPM)).toBeCloseTo(86.5, 9)
  })
  it('has no area without a usable scale', () => {
    expect(shapeAreaM2(L_PX, null)).toBeNull()
    expect(shapeAreaM2(L_PX, undefined)).toBeNull()
    expect(shapeAreaM2(L_PX, 0)).toBeNull()
    expect(shapeAreaM2(L_PX, -5)).toBeNull()
  })
})

describe('pointInShape / distanceToEdge', () => {
  it('knows inside from outside on a concave shape', () => {
    expect(pointInShape(10, 50, C_SHAPE)).toBe(true)
    expect(pointInShape(55, 50, C_SHAPE)).toBe(false)
  })
  it('distance is positive inside, negative outside, zero on an edge', () => {
    expect(distanceToEdge(10, 50, C_SHAPE)).toBeCloseTo(10, 9)
    expect(distanceToEdge(55, 50, C_SHAPE)).toBeCloseTo(-30, 9)
    expect(distanceToEdge(50, 0, C_SHAPE)).toBe(0)
  })
})

describe('visualCentre', () => {
  it('finds the widest point of a rectangle within the precision', () => {
    const rect = rectToPoints(0, 0, 100, 40)
    const c = visualCentre(rect, 1)
    expect(pointInShape(c.x, c.y, rect)).toBe(true)
    expect(distanceToEdge(c.x, c.y, rect)).toBeGreaterThanOrEqual(19)
  })
  it('lands inside a C-shape whose vertex mean is outside it', () => {
    const c = visualCentre(C_SHAPE, 1)
    expect(pointInShape(c.x, c.y, C_SHAPE)).toBe(true)
    expect(distanceToEdge(c.x, c.y, C_SHAPE)).toBeGreaterThanOrEqual(9)
  })
  it('lands inside the L-shape', () => {
    const c = visualCentre(L_PX, 1)
    expect(pointInShape(c.x, c.y, L_PX)).toBe(true)
  })
  it('returns the corner of a degenerate (zero-width) shape instead of looping', () => {
    expect(visualCentre([5, 5, 5, 10, 5, 20], 1)).toEqual({ x: 5, y: 5 })
  })
  it('refuses a non-positive precision', () => {
    expect(() => visualCentre(C_SHAPE, 0)).toThrow('precision must be positive')
  })
})

describe('hatchSegments', () => {
  it('fills a square with horizontal lines at half-spacing phase', () => {
    expect(hatchSegments(rectToPoints(0, 0, 10, 10), { angleDeg: 0, spacing: 2 })).toEqual([
      [0, 1, 10, 1], [0, 3, 10, 3], [0, 5, 10, 5], [0, 7, 10, 7], [0, 9, 10, 9],
    ])
  })
  it('clips to a concave U: one segment across the bar, two across the arms', () => {
    expect(hatchSegments(U_SHAPE, { angleDeg: 0, spacing: 10 })).toEqual([
      [0, 5, 30, 5],
      [0, 15, 10, 15], [20, 15, 30, 15],
      [0, 25, 10, 25], [20, 25, 30, 25],
    ])
  })
  it.each([
    ['pentagon at 45°', PENTAGON, 45, 9],
    ['U at 30°', U_SHAPE, 30, 3],
    ['C at 135°', C_SHAPE, 135, 7],
  ])('%s: every segment starts and ends on the outline and runs inside it', (_l, pts, angleDeg, spacing) => {
    const segs = hatchSegments(pts, { angleDeg, spacing })
    expect(segs.length).toBeGreaterThan(3)
    for (const [x0, y0, x1, y1] of segs) {
      expect(Math.abs(distanceToEdge(x0, y0, pts))).toBeLessThan(1e-6)
      expect(Math.abs(distanceToEdge(x1, y1, pts))).toBeLessThan(1e-6)
      expect(pointInShape((x0 + x1) / 2, (y0 + y1) / 2, pts)).toBe(true)
    }
  })
  it('lines of two touching shapes share a phase (they continue across the seam)', () => {
    const left = hatchSegments(rectToPoints(0, 0, 10, 10), { angleDeg: 0, spacing: 4 })
    const right = hatchSegments(rectToPoints(10, 0, 20, 10), { angleDeg: 0, spacing: 4 })
    expect(left.map((s) => s[1])).toEqual(right.map((s) => s[1]))
  })
  it('returns nothing for fewer than three corners and refuses a bad spacing', () => {
    expect(hatchSegments([0, 0, 10, 10], { angleDeg: 0, spacing: 2 })).toEqual([])
    expect(() => hatchSegments(rectToPoints(0, 0, 10, 10), { angleDeg: 0, spacing: 0 })).toThrow('spacing must be positive')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/geometry.test.ts
```

Expected: FAIL with `Failed to resolve import "./geometry"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Plane geometry for status plans (spec 2026-10-09 §6). Pure; no I/O.
 *
 * Coordinates are IMAGE PIXELS of the page at the fixed scale-2 raster, flat
 * [x0, y0, x1, y1, …], x right and y DOWN the sheet. Metres only appear in
 * shapeAreaM2, through the page's pixels-per-metre.
 *
 * hatchSegments is the one hatch generator: the Konva canvas and the pdf-lib
 * renderer both draw its output, so screen and PDF show the same lines.
 */
import { flatToPts, polygonArea, pointInPolygon } from '../solar/layout/geometry'
import type { Pt } from '../solar/layout/types'

export type { Pt }

/** One hatch line, [x0, y0, x1, y1] in image pixels. */
export type Segment = [number, number, number, number]

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface HatchOptions {
  /** Line direction in degrees, measured in image space (y down). */
  angleDeg: number
  /** Perpendicular distance between lines, image pixels. */
  spacing: number
}

/** Normalise a dragged rectangle to four corners: TL, TR, BR, BL. */
export function rectToPoints(x0: number, y0: number, x1: number, y1: number): number[] {
  const l = Math.min(x0, x1)
  const r = Math.max(x0, x1)
  const t = Math.min(y0, y1)
  const b = Math.max(y0, y1)
  return [l, t, r, t, r, b, l, b]
}

export function boundingBox(points: readonly number[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!
    const y = points[i + 1]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Absolute shoelace area in square image pixels. */
export function shapeAreaPx(points: readonly number[]): number {
  return polygonArea(flatToPts(points))
}

/** Area in m², or null when the page has no usable scale. Never stored: a scale can be recalibrated. */
export function shapeAreaM2(points: readonly number[], pixelsPerMeter: number | null | undefined): number | null {
  if (pixelsPerMeter == null || !(pixelsPerMeter > 0)) return null
  return shapeAreaPx(points) / (pixelsPerMeter * pixelsPerMeter)
}

export function pointInShape(x: number, y: number, points: readonly number[]): boolean {
  return pointInPolygon({ x, y }, flatToPts(points))
}

function segmentDistanceSq(px: number, py: number, a: Pt, b: Pt): number {
  let x = a.x
  let y = a.y
  let dx = b.x - x
  let dy = b.y - y
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x = b.x
      y = b.y
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }
  dx = px - x
  dy = py - y
  return dx * dx + dy * dy
}

function signedDistance(x: number, y: number, pts: readonly Pt[]): number {
  let inside = false
  let minSq = Infinity
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    minSq = Math.min(minSq, segmentDistanceSq(x, y, a, b))
  }
  if (minSq === 0) return 0
  return (inside ? 1 : -1) * Math.sqrt(minSq)
}

/** Distance from a point to the shape's outline: positive inside, negative outside, 0 on it. */
export function distanceToEdge(x: number, y: number, points: readonly number[]): number {
  return signedDistance(x, y, flatToPts(points))
}

// ── Visual centre: pole of inaccessibility (the polylabel method) ─────────

interface Cell {
  x: number
  y: number
  h: number
  d: number
  max: number
}

function makeCell(x: number, y: number, h: number, pts: readonly Pt[]): Cell {
  const d = signedDistance(x, y, pts)
  return { x, y, h, d, max: d + h * Math.SQRT2 }
}

function heapPush(heap: Cell[], c: Cell): void {
  heap.push(c)
  let i = heap.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (heap[p]!.max >= heap[i]!.max) break
    const tmp = heap[p]!
    heap[p] = heap[i]!
    heap[i] = tmp
    i = p
  }
}

function heapPop(heap: Cell[]): Cell {
  const top = heap[0]!
  const last = heap.pop()!
  if (heap.length > 0) {
    heap[0] = last
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < heap.length && heap[l]!.max > heap[m]!.max) m = l
      if (r < heap.length && heap[r]!.max > heap[m]!.max) m = r
      if (m === i) break
      const tmp = heap[m]!
      heap[m] = heap[i]!
      heap[i] = tmp
      i = m
    }
  }
  return top
}

function areaCentroid(pts: readonly Pt[]): Pt {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    const f = a.x * b.y - b.x * a.y
    cx += (a.x + b.x) * f
    cy += (a.y + b.y) * f
    area += f * 3
  }
  if (area === 0) return pts[0]!
  return { x: cx / area, y: cy / area }
}

/**
 * The point inside the shape farthest from its outline, within `precision`
 * image pixels: where a label fits best. Unlike the vertex mean it is inside
 * concave shapes (a C, an L, a mall unit wrapped round a service core).
 */
export function visualCentre(points: readonly number[], precision = 1): Pt {
  if (!(precision > 0)) throw new Error('precision must be positive')
  const pts = flatToPts(points)
  const { minX, minY, maxX, maxY } = boundingBox(points)
  const width = maxX - minX
  const height = maxY - minY
  const cellSize = Math.min(width, height)
  if (!(cellSize > 0)) return { x: minX, y: minY }

  const heap: Cell[] = []
  let h = cellSize / 2
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) heapPush(heap, makeCell(x + h, y + h, h, pts))
  }

  const centroid = areaCentroid(pts)
  let best = makeCell(centroid.x, centroid.y, 0, pts)
  const boxCell = makeCell(minX + width / 2, minY + height / 2, 0, pts)
  if (boxCell.d > best.d) best = boxCell

  while (heap.length > 0) {
    const cell = heapPop(heap)
    if (cell.d > best.d) best = cell
    if (cell.max - best.d <= precision) continue
    h = cell.h / 2
    heapPush(heap, makeCell(cell.x - h, cell.y - h, h, pts))
    heapPush(heap, makeCell(cell.x + h, cell.y - h, h, pts))
    heapPush(heap, makeCell(cell.x - h, cell.y + h, h, pts))
    heapPush(heap, makeCell(cell.x + h, cell.y + h, h, pts))
  }
  return { x: best.x, y: best.y }
}

// ── Hatch clipping ─────────────────────────────────────────────────────────

const noNegZero = (n: number) => (n === 0 ? 0 : n)

/**
 * Parallel hatch lines clipped to the shape (concave shapes included, by
 * even-odd pairing). Lines sit at v = (k + 0.5) × spacing in the rotated frame,
 * a GLOBAL phase, so two touching shapes' hatches continue across the seam.
 */
export function hatchSegments(points: readonly number[], opts: HatchOptions): Segment[] {
  if (!(opts.spacing > 0)) throw new Error('spacing must be positive')
  const pts = flatToPts(points)
  if (pts.length < 3) return []

  const t = (opts.angleDeg * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  // Rotate by -t: lines of direction t become lines of constant v.
  const rot = pts.map((p) => ({ u: p.x * cos + p.y * sin, v: -p.x * sin + p.y * cos }))
  let minV = Infinity
  let maxV = -Infinity
  for (const p of rot) {
    if (p.v < minV) minV = p.v
    if (p.v > maxV) maxV = p.v
  }

  const out: Segment[] = []
  for (let k = Math.floor(minV / opts.spacing - 0.5); (k + 0.5) * opts.spacing < maxV; k++) {
    const v = (k + 0.5) * opts.spacing
    if (v <= minV) continue
    const us: number[] = []
    for (let i = 0, j = rot.length - 1; i < rot.length; j = i++) {
      const a = rot[i]!
      const b = rot[j]!
      if ((a.v > v) !== (b.v > v)) us.push(a.u + ((v - a.v) * (b.u - a.u)) / (b.v - a.v))
    }
    us.sort((a, b) => a - b)
    for (let m = 0; m + 1 < us.length; m += 2) {
      const u0 = us[m]!
      const u1 = us[m + 1]!
      if (u1 - u0 < 1e-9) continue
      out.push([
        noNegZero(u0 * cos - v * sin),
        noNegZero(u0 * sin + v * cos),
        noNegZero(u1 * cos - v * sin),
        noNegZero(u1 * sin + v * cos),
      ])
    }
  }
  return out
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/geometry.test.ts
```

Expected: PASS (19 tests). If the axis-aligned hatch cases fail on tiny floating noise (e.g. `9.999999999999998`), the rotation at `angleDeg: 0` is not exact: check `Math.cos(0) === 1` and `Math.sin(0) === 0` are used directly (they are) and that no extra normalisation was introduced.

- [ ] **Step 5: Mutation check (do not commit the mutation)**

Temporarily change `const v = (k + 0.5) * opts.spacing` to `const v = k * opts.spacing` in `geometry.ts` and re-run the file.
Expected: `fills a square…` and `clips to a concave U…` FAIL. Revert the change and re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/status-plans/geometry.ts packages/shared/src/status-plans/geometry.test.ts
git commit -m "feat(status-plans): area, visual centre and hatch clipping

Reuses Solar's shoelace and point-in-polygon; hatch lines share a global phase.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Area check

**Files:**
- Create: `packages/shared/src/status-plans/area-check.ts`
- Test: `packages/shared/src/status-plans/area-check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { areaCheck, totalMeasuredM2, AREA_TOLERANCE } from './area-check'

describe('areaCheck', () => {
  it('uses a 2 % tolerance', () => {
    expect(AREA_TOLERANCE).toBe(0.02)
  })
  it('exactly 2 % either way still matches', () => {
    expect(areaCheck(255, 250).state).toBe('matches')
    expect(areaCheck(245, 250).state).toBe('matches')
  })
  it('just over 2 % either way differs', () => {
    expect(areaCheck(255.1, 250).state).toBe('differs')
    expect(areaCheck(244.9, 250).state).toBe('differs')
  })
  it('reports the signed difference in m² and percent', () => {
    expect(areaCheck(260, 250)).toEqual({ state: 'differs', measuredM2: 260, scheduledM2: 250, deltaM2: 10, deltaPct: 4 })
  })
  it('no scale: no measured area, nothing to compare', () => {
    expect(areaCheck(null, 250)).toEqual({ state: 'no_scale', measuredM2: null, scheduledM2: 250, deltaM2: null, deltaPct: null })
  })
  it('no scheduled area (null or zero): measured is shown, not compared', () => {
    expect(areaCheck(120, null)).toEqual({ state: 'no_schedule', measuredM2: 120, scheduledM2: null, deltaM2: null, deltaPct: null })
    expect(areaCheck(120, 0).state).toBe('no_schedule')
  })
})

describe('totalMeasuredM2', () => {
  it('sums measured areas and counts the unmeasured ones', () => {
    expect(totalMeasuredM2([10.5, null, 20.25, null])).toEqual({ totalM2: 30.75, unmeasured: 2 })
  })
  it('an empty plan totals zero', () => {
    expect(totalMeasuredM2([])).toEqual({ totalM2: 0, unmeasured: 0 })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/area-check.test.ts
```

Expected: FAIL with `Failed to resolve import "./area-check"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Measured vs scheduled shop area (spec 2026-10-09 §3.1). Pure.
 * |measured − scheduled| / scheduled > 2 % raises the amber "area differs"
 * flag in the side panel and legend table, never on the drawing.
 */

export const AREA_TOLERANCE = 0.02

export type AreaCheckState = 'no_scale' | 'no_schedule' | 'matches' | 'differs'

export interface AreaCheck {
  state: AreaCheckState
  measuredM2: number | null
  scheduledM2: number | null
  /** measured − scheduled, m². */
  deltaM2: number | null
  /** (measured − scheduled) / scheduled × 100. */
  deltaPct: number | null
}

/** Absorbs binary noise at the exact 2 % boundary (e.g. 1809.27 × 1.02). */
const EPS = 1e-9

export function areaCheck(
  measuredM2: number | null,
  scheduledM2: number | null,
  tolerance: number = AREA_TOLERANCE,
): AreaCheck {
  if (measuredM2 === null) {
    return { state: 'no_scale', measuredM2: null, scheduledM2, deltaM2: null, deltaPct: null }
  }
  if (scheduledM2 === null || !(scheduledM2 > 0)) {
    return { state: 'no_schedule', measuredM2, scheduledM2, deltaM2: null, deltaPct: null }
  }
  const deltaM2 = measuredM2 - scheduledM2
  const ratio = deltaM2 / scheduledM2
  return {
    state: Math.abs(ratio) > tolerance + EPS ? 'differs' : 'matches',
    measuredM2,
    scheduledM2,
    deltaM2,
    deltaPct: ratio * 100,
  }
}

export function totalMeasuredM2(values: ReadonlyArray<number | null>): { totalM2: number; unmeasured: number } {
  let totalM2 = 0
  let unmeasured = 0
  for (const v of values) {
    if (v === null) unmeasured += 1
    else totalM2 += v
  }
  return { totalM2, unmeasured }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/area-check.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/area-check.ts packages/shared/src/status-plans/area-check.test.ts
git commit -m "feat(status-plans): measured vs scheduled area check (2 %)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Palette

**Files:**
- Create: `packages/shared/src/status-plans/palette.ts`
- Test: `packages/shared/src/status-plans/palette.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  COLOURS,
  HATCH_SPACING_PX,
  tenantShapeStyle,
  areaShapeStyle,
  dbBlockStyle,
  TENANT_LEGEND,
  SCHEMATIC_LEGEND,
  hexToRgb01,
  type ShapeStyle,
} from './palette'
import { AREA_TYPES } from './types'
import type { ShopStatus } from './shop-status'
import type { DbBlockStatus } from './db-block-status'

const SHOP_STATUSES: ShopStatus[] = ['complete', 'in_progress', 'decommissioned', 'unlinked']
const DB_STATUSES: DbBlockStatus[] = ['required', 'ordered', 'received', 'by_tenant', 'no_order', 'unlinked']

function allColours(s: ShapeStyle): string[] {
  return [s.fill, s.stroke, ...s.hatches.map((h) => h.color)].filter((c): c is string => c !== null)
}

describe('tenant shapes', () => {
  it('complete is green, in progress orange, both filled', () => {
    expect(tenantShapeStyle({ status: 'complete', overdue: false }).fill).toBe(COLOURS.complete)
    expect(tenantShapeStyle({ status: 'in_progress', overdue: false }).fill).toBe(COLOURS.inProgress)
    expect(tenantShapeStyle({ status: 'in_progress', overdue: false }).hatches).toEqual([])
  })
  it('overdue keeps the base fill and adds a red outline and red diagonal hatch', () => {
    const s = tenantShapeStyle({ status: 'in_progress', overdue: true })
    expect(s.fill).toBe(COLOURS.inProgress)
    expect(s.stroke).toBe(COLOURS.overdue)
    expect(s.hatches).toEqual([{ angleDeg: 45, spacing: HATCH_SPACING_PX, color: COLOURS.overdue, width: 2 }])
  })
  it('decommissioned strikes its label; unlinked does not', () => {
    expect(tenantShapeStyle({ status: 'decommissioned', overdue: false }).strikeLabel).toBe(true)
    expect(tenantShapeStyle({ status: 'unlinked', overdue: false }).strikeLabel).toBe(false)
  })
  it('area-type fills never collide with a status fill', () => {
    const statusFills = new Set(SHOP_STATUSES.map((s) => tenantShapeStyle({ status: s, overdue: false }).fill))
    for (const t of AREA_TYPES) expect(statusFills.has(areaShapeStyle(t).fill), t).toBe(false)
    expect(new Set(AREA_TYPES.map((t) => areaShapeStyle(t).fill)).size).toBe(AREA_TYPES.length)
  })
})

describe('schematic DB blocks', () => {
  it('required: red outline, no fill', () => {
    const s = dbBlockStyle('required')
    expect(s.fill).toBeNull()
    expect(s.stroke).toBe(COLOURS.overdue)
  })
  it('ordered: amber diagonal hatch', () => {
    expect(dbBlockStyle('ordered').hatches).toEqual([{ angleDeg: 45, spacing: HATCH_SPACING_PX, color: COLOURS.ordered, width: 2 }])
  })
  it('received: translucent green fill', () => {
    const s = dbBlockStyle('received')
    expect(s.fill).toBe(COLOURS.complete)
    expect(s.fillOpacity).toBeGreaterThan(0)
    expect(s.fillOpacity).toBeLessThan(1)
  })
  it('by tenant: grey cross-hatch (two directions)', () => {
    expect(dbBlockStyle('by_tenant').hatches.map((h) => h.angleDeg)).toEqual([45, 135])
  })
  it('no order: thin neutral outline only; unlinked: dashed grey outline', () => {
    expect(dbBlockStyle('no_order')).toMatchObject({ fill: null, hatches: [], dash: null, stroke: COLOURS.neutral })
    expect(dbBlockStyle('no_order').strokeWidth).toBeLessThan(dbBlockStyle('required').strokeWidth)
    expect(dbBlockStyle('unlinked').dash).toEqual([10, 6])
  })
})

describe('legends and colours', () => {
  it('the tenant legend lists every shop status, overdue and every area type once', () => {
    expect(TENANT_LEGEND.map((e) => e.key)).toEqual([
      'complete', 'in_progress', 'overdue', 'decommissioned', 'unlinked', ...AREA_TYPES,
    ])
  })
  it('the schematic legend lists every block status once', () => {
    expect(SCHEMATIC_LEGEND.map((e) => e.key)).toEqual(DB_STATUSES)
  })
  it('every colour used anywhere is a #RRGGBB hex', () => {
    const styles = [...TENANT_LEGEND, ...SCHEMATIC_LEGEND].map((e) => e.style)
    for (const s of styles) for (const c of allColours(s)) expect(c).toMatch(/^#[0-9A-F]{6}$/)
  })
  it('hexToRgb01 converts for pdf-lib', () => {
    expect(hexToRgb01('#2E9E4F')).toEqual({ r: 46 / 255, g: 158 / 255, b: 79 / 255 })
    expect(() => hexToRgb01('green')).toThrow('not a #RRGGBB colour: green')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/palette.test.ts
```

Expected: FAIL with `Failed to resolve import "./palette"`.

- [ ] **Step 3: Implement**

```ts
/**
 * The ONE colour and hatch table for status plans (spec 2026-10-09 §6). The
 * Konva canvas, the legend and the pdf-lib renderer all read it, so screen and
 * PDF cannot disagree. Widths and spacings are image pixels at the scale-2
 * raster. Colours are #RRGGBB; hexToRgb01 converts them for pdf-lib.
 */
import { AREA_TYPE_LABEL, AREA_TYPES, type AreaType } from './types'
import { SHOP_STATUS_LABEL, type ShopStatus, type ShopStatusResult } from './shop-status'
import { DB_BLOCK_STATUS_LABEL, type DbBlockStatus } from './db-block-status'

export const COLOURS = {
  complete: '#2E9E4F',
  inProgress: '#F08A24',
  overdue: '#D64545',
  ordered: '#E0A100',
  byTenant: '#7D8590',
  neutral: '#6B7280',
  unlinked: '#9AA0A6',
  decommissioned: '#B8BCC2',
  common: '#8FA9C7',
  plantRoom: '#5F7A99',
  services: '#A9B8C9',
  vacant: '#D9DEE4',
} as const

export const HATCH_SPACING_PX = 14
export const STROKE_PX = 3

export interface HatchSpec {
  angleDeg: number
  spacing: number
  color: string
  width: number
}

export interface ShapeStyle {
  fill: string | null
  fillOpacity: number
  stroke: string
  strokeWidth: number
  dash: readonly number[] | null
  hatches: readonly HatchSpec[]
  strikeLabel: boolean
}

export interface LegendEntry {
  key: string
  label: string
  style: ShapeStyle
}

function style(over: Partial<ShapeStyle>): ShapeStyle {
  return {
    fill: null,
    fillOpacity: 0,
    stroke: COLOURS.neutral,
    strokeWidth: STROKE_PX,
    dash: null,
    hatches: [],
    strikeLabel: false,
    ...over,
  }
}

const hatch = (angleDeg: number, color: string): HatchSpec => ({ angleDeg, spacing: HATCH_SPACING_PX, color, width: 2 })

const TENANT_BASE: Record<ShopStatus, ShapeStyle> = {
  complete: style({ fill: COLOURS.complete, fillOpacity: 0.45, stroke: COLOURS.complete }),
  in_progress: style({ fill: COLOURS.inProgress, fillOpacity: 0.45, stroke: COLOURS.inProgress }),
  decommissioned: style({ fill: COLOURS.decommissioned, fillOpacity: 0.45, stroke: COLOURS.decommissioned, strikeLabel: true }),
  unlinked: style({ fill: COLOURS.unlinked, fillOpacity: 0.35, stroke: COLOURS.unlinked }),
}

export function tenantShapeStyle(r: ShopStatusResult): ShapeStyle {
  const base = TENANT_BASE[r.status]
  if (!r.overdue) return base
  return { ...base, stroke: COLOURS.overdue, hatches: [hatch(45, COLOURS.overdue)] }
}

const AREA_FILL: Record<AreaType, string> = {
  common: COLOURS.common,
  plant_room: COLOURS.plantRoom,
  services: COLOURS.services,
  vacant: COLOURS.vacant,
}

export function areaShapeStyle(t: AreaType): ShapeStyle {
  return style({ fill: AREA_FILL[t], fillOpacity: 0.4, stroke: AREA_FILL[t] })
}

const DB_BLOCK: Record<DbBlockStatus, ShapeStyle> = {
  required: style({ stroke: COLOURS.overdue, strokeWidth: 4 }),
  ordered: style({ stroke: COLOURS.ordered, hatches: [hatch(45, COLOURS.ordered)] }),
  received: style({ fill: COLOURS.complete, fillOpacity: 0.35, stroke: COLOURS.complete }),
  by_tenant: style({ stroke: COLOURS.byTenant, hatches: [hatch(45, COLOURS.byTenant), hatch(135, COLOURS.byTenant)] }),
  no_order: style({ stroke: COLOURS.neutral, strokeWidth: 1.5 }),
  unlinked: style({ stroke: COLOURS.unlinked, strokeWidth: 2, dash: [10, 6] }),
}

export function dbBlockStyle(s: DbBlockStatus): ShapeStyle {
  return DB_BLOCK[s]
}

export const TENANT_LEGEND: readonly LegendEntry[] = [
  { key: 'complete', label: SHOP_STATUS_LABEL.complete, style: tenantShapeStyle({ status: 'complete', overdue: false }) },
  { key: 'in_progress', label: SHOP_STATUS_LABEL.in_progress, style: tenantShapeStyle({ status: 'in_progress', overdue: false }) },
  { key: 'overdue', label: 'Overdue (past BO date)', style: tenantShapeStyle({ status: 'in_progress', overdue: true }) },
  { key: 'decommissioned', label: SHOP_STATUS_LABEL.decommissioned, style: tenantShapeStyle({ status: 'decommissioned', overdue: false }) },
  { key: 'unlinked', label: SHOP_STATUS_LABEL.unlinked, style: tenantShapeStyle({ status: 'unlinked', overdue: false }) },
  ...AREA_TYPES.map((t) => ({ key: t, label: AREA_TYPE_LABEL[t], style: areaShapeStyle(t) })),
]

const DB_ORDER: DbBlockStatus[] = ['required', 'ordered', 'received', 'by_tenant', 'no_order', 'unlinked']

export const SCHEMATIC_LEGEND: readonly LegendEntry[] = DB_ORDER.map((s) => ({
  key: s,
  label: DB_BLOCK_STATUS_LABEL[s],
  style: dbBlockStyle(s),
}))

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(hex)
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`)
  return { r: parseInt(m[1]!, 16) / 255, g: parseInt(m[2]!, 16) / 255, b: parseInt(m[3]!, 16) / 255 }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/palette.test.ts
```

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans/palette.ts packages/shared/src/status-plans/palette.test.ts
git commit -m "feat(status-plans): single palette and legends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Public surface and the package export

**Files:**
- Create: `packages/shared/src/status-plans/index.ts`
- Test: `packages/shared/src/status-plans/index.test.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import * as sp from './index'

describe('@esite/shared/status-plans public surface', () => {
  it('exports the functions later slices are planned against', () => {
    for (const name of [
      'pointsError', 'statusPlanFromRow', 'statusPlanShapeFromRow',
      'shopStatus', 'isShopComplete',
      'dbBlockStatus',
      'rectToPoints', 'boundingBox', 'shapeAreaPx', 'shapeAreaM2', 'pointInShape', 'distanceToEdge', 'visualCentre', 'hatchSegments',
      'areaCheck', 'totalMeasuredM2',
      'tenantShapeStyle', 'areaShapeStyle', 'dbBlockStyle', 'hexToRgb01',
    ]) {
      expect(typeof (sp as Record<string, unknown>)[name], name).toBe('function')
    }
  })
  it('exports the constants', () => {
    expect(sp.STATUS_PLAN_PURPOSES).toEqual(['tenant_layout', 'distribution_schematic'])
    expect(sp.AREA_TYPES).toEqual(['common', 'plant_room', 'services', 'vacant'])
    expect(sp.AREA_TOLERANCE).toBe(0.02)
    expect(sp.TENANT_LEGEND.length).toBe(9)
    expect(sp.SCHEMATIC_LEGEND.length).toBe(6)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/index.test.ts
```

Expected: FAIL with `Failed to resolve import "./index"`.

- [ ] **Step 3: Implement the barrel**

```ts
/**
 * @esite/shared/status-plans — pure logic for status plans (spec 2026-10-09).
 * A subpath export only: the root barrel already exports Solar's geometry
 * names, and this module must not collide with them.
 */
export * from './types'
export * from './shop-status'
export * from './db-block-status'
export * from './geometry'
export * from './area-check'
export * from './palette'
```

- [ ] **Step 4: Add the package export**

In `packages/shared/package.json`, add the entry after `"./whatsapp-forms"`:

```json
    "./whatsapp-forms": "./src/whatsapp-forms/index.ts",
    "./status-plans": "./src/status-plans/index.ts"
```

- [ ] **Step 5: Run the module's tests and the type-check**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared type-check
```

Expected: all `src/status-plans` files PASS (≈ 78 tests); `tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/status-plans/index.ts packages/shared/src/status-plans/index.test.ts packages/shared/package.json
git commit -m "feat(status-plans): export @esite/shared/status-plans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Characterise the tenant schedule report data (before touching it)

**Files:**
- Create: `apps/web/src/lib/tenant-schedule/__fixtures__/fake-tables-client.ts`
- Create: `apps/web/src/lib/tenant-schedule/__fixtures__/probe-mall.ts`
- Test: `apps/web/src/lib/reports/tenant-schedule-report-data.test.ts`

This test pins what `gatherTenantScheduleReportData` returns TODAY. It must pass on the unmodified code; it is the guard that the extraction in Task 14 changes nothing.

- [ ] **Step 1: Write the fake client**

```ts
/**
 * A tiny PostgREST-shaped fake for loader tests. Every builder method records
 * its call and returns the builder; awaiting it resolves to the rows given for
 * `<schema>.<table>`. It does NOT filter: give it only the rows the query
 * should see, and assert the recorded filters separately.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type FakeTables = Record<string, Array<Record<string, unknown>>>

export interface FakeCall {
  table: string
  ops: Array<[string, unknown[]]>
}

export function fakeTablesClient(tables: FakeTables): { client: any; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const from = (schema: string) => (table: string) => {
    const key = `${schema}.${table}`
    const call: FakeCall = { table: key, ops: [] }
    calls.push(call)
    const rows = () => tables[key] ?? []
    const builder: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return () => Promise.resolve({ data: rows()[0] ?? null, error: null })
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, args])
            return builder
          }
        },
      },
    )
    return builder
  }
  const client = { schema: (s: string) => ({ from: from(s) }), from: from('public') }
  return { client, calls }
}
```

- [ ] **Step 2: Write the invented fixture**

```ts
/** "Probe Mall": invented rows for the tenant facts tests. No client data. */
import type { FakeTables } from './fake-tables-client'

export const PROBE_PROJECT = {
  id: 'p-1',
  name: 'Probe Mall',
  organisation_id: 'org-1',
  opening_date: '2026-09-01',
}

export const PROBE_TABLES: FakeTables = {
  'structure.nodes': [
    {
      id: 'n-1', project_id: 'p-1', kind: 'tenant_db', code: 'ZZ01', shop_number: 'ZZ01', shop_name: 'Lantern Books',
      name: null, shop_area_m2: 120, status: 'active', breaker_rating_a: null, pole_config: null,
      incomer_breaker_a: 63, incomer_pole_config: 'TP', incomer_load_a: 48,
    },
    {
      id: 'n-2', project_id: 'p-1', kind: 'tenant_db', code: 'ZZ02', shop_number: 'ZZ02', shop_name: 'Copper Kettle',
      name: null, shop_area_m2: 80, status: 'active', breaker_rating_a: 40, pole_config: 'SP',
      incomer_breaker_a: null, incomer_pole_config: null, incomer_load_a: null,
    },
    {
      id: 'n-3', project_id: 'p-1', kind: 'tenant_db', code: 'ZZ03', shop_number: 'ZZ03', shop_name: 'Old Lamp Co',
      name: null, shop_area_m2: 55, status: 'decommissioned', breaker_rating_a: null, pole_config: null,
      incomer_breaker_a: null, incomer_pole_config: null, incomer_load_a: null,
    },
  ],
  'structure.scope_item_types': [
    { id: 'tdb', key: 'db' },
    { id: 'tlt', key: 'lighting' },
    { id: 'tx', key: 'signage' },
  ],
  'structure.tenant_details': [
    { node_id: 'n-1', scope_status: 'received', scope_not_required: false, layout_status: 'issued', bo_period_days: 30, bo_date_override: null },
    { node_id: 'n-2', scope_status: null, scope_not_required: true, layout_status: 'pending', bo_period_days: null, bo_date_override: '2026-06-01' },
  ],
  'structure.node_orders': [
    { node_id: 'n-1', scope_item_type_id: 'tdb', status: 'received' },
    { node_id: 'n-1', scope_item_type_id: 'tlt', status: 'by_tenant' },
    { node_id: 'n-2', scope_item_type_id: 'tdb', status: 'ordered' },
  ],
  'projects.projects': [
    { name: 'Probe Mall', client_logo_url: null, project_logo_url: null, report_accent_color: '#123456' },
  ],
  'public.organisations': [
    { name: 'Probe Org', logo_url: null, report_accent_color: null },
  ],
}
```

- [ ] **Step 3: Write the characterisation test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeTablesClient } from '@/lib/tenant-schedule/__fixtures__/fake-tables-client'
import { PROBE_TABLES } from '@/lib/tenant-schedule/__fixtures__/probe-mall'

const h = vi.hoisted(() => ({
  client: null as unknown,
  project: { id: 'p-1', name: 'Probe Mall', organisation_id: 'org-1', opening_date: '2026-09-01' },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({})),
  createServiceClient: vi.fn(() => h.client),
}))

vi.mock('@esite/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@esite/shared')>()
  return { ...actual, projectService: { ...actual.projectService, getById: vi.fn(async () => h.project) } }
})

import { gatherTenantScheduleReportData } from './tenant-schedule-report-data'

describe('gatherTenantScheduleReportData (characterisation)', () => {
  beforeEach(() => {
    h.client = fakeTablesClient(PROBE_TABLES).client
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-20T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the same report data the PDF renders', async () => {
    const data = await gatherTenantScheduleReportData('p-1')
    expect(data).toEqual({
      projectName: 'Probe Mall',
      kpis: {
        totalShops: 3,
        activeShops: 2,
        decommissionedShops: 1,
        totalGlaM2: 200,
        scopeComplete: 2,
        scopeCompletePct: 100,
        layoutsIssued: 1,
        layoutsIssuedPct: 50,
        boards: { landlord: 2, ordered: 2 },
        lights: { landlord: 0, ordered: 0 },
        byTenantCount: 1,
        bo: { upcoming: 1, overdue: 1, noDate: 0 },
      },
      shopRows: [
        {
          shopNumber: 'ZZ01', tenantName: 'Lantern Books', glaM2: 120, breakerA: 63, poleConfig: 'TP', loadA: 48,
          db: 'received', lights: 'by_tenant', scope: 'received', layoutIssued: true, boDate: '2026-08-02', boOverdue: false,
        },
        {
          shopNumber: 'ZZ02', tenantName: 'Copper Kettle', glaM2: 80, breakerA: 40, poleConfig: 'SP', loadA: null,
          db: 'ordered', lights: null, scope: 'not_required', layoutIssued: false, boDate: '2026-06-01', boOverdue: true,
        },
      ],
      brandingInput: {
        orgName: 'Probe Org',
        orgLogoDataUri: null,
        orgAccent: null,
        projectAccent: '#123456',
        clientLogoDataUri: null,
        projectMarkDataUri: null,
        projectSubtitle: 'Tenant coordination',
      },
    })
  })

  it('refuses a project the caller cannot see', async () => {
    const shared = await import('@esite/shared')
    vi.mocked(shared.projectService.getById).mockResolvedValueOnce(null as never)
    await expect(gatherTenantScheduleReportData('p-1')).rejects.toThrow('Project not found')
  })
})
```

- [ ] **Step 4: Run it against the UNMODIFIED code**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/reports/tenant-schedule-report-data.test.ts
```

Expected: PASS (2 tests). If it fails, the fixture or the fake is wrong, not the report: fix the test until it passes on the untouched code. Only then is it a characterisation.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tenant-schedule/__fixtures__ apps/web/src/lib/reports/tenant-schedule-report-data.test.ts
git commit -m "test(tenant-schedule): characterise report data before extracting the loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `shopProgressFor` — one pure per-shop read

**Files:**
- Modify: `apps/web/src/lib/reports/tenant-schedule-report-compute.ts`
- Test: `apps/web/src/lib/reports/tenant-schedule-report-compute.test.ts`

- [ ] **Step 1: Write the failing tests**

Change the first import line of `tenant-schedule-report-compute.test.ts` to:

```ts
import { computeReportModel, orderStateLabel, scopeStateLabel, shopProgressFor, type ComputeInput } from './tenant-schedule-report-compute'
```

Append at the end of the file:

```ts
describe('shopProgressFor', () => {
  it('reads one node exactly as the report row shows it', () => {
    expect(shopProgressFor(base, 'n1')).toEqual({
      db: 'ordered', lights: 'received', scope: 'received', layoutIssued: true, boDate: '2026-08-15',
    })
    expect(shopProgressFor(base, 'n3')).toEqual({
      db: 'required', lights: null, scope: 'received', layoutIssued: false, boDate: null,
    })
  })

  it('a node with no details and no orders is awaited, not issued, without orders', () => {
    expect(shopProgressFor(base, 'n-unknown')).toEqual({
      db: null, lights: null, scope: 'awaited', layoutIssued: false, boDate: null,
    })
  })

  it('agrees with every row computeReportModel produces', () => {
    const { shopRows } = computeReportModel(base)
    for (const n of base.activeNodes) {
      const row = shopRows.find((r) => r.shopNumber === n.shopNumber)!
      expect({ db: row.db, lights: row.lights, scope: row.scope, layoutIssued: row.layoutIssued, boDate: row.boDate })
        .toEqual(shopProgressFor(base, n.id))
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/reports/tenant-schedule-report-compute.test.ts
```

Expected: FAIL with `shopProgressFor is not a function` (the existing tests still pass).

- [ ] **Step 3: Implement and route `computeReportModel` through it**

In `tenant-schedule-report-compute.ts`, insert after the `ReportKpis` interface (before `const LANDLORD`):

```ts
/** One shop's progress facts. `ShopRow` carries the same five fields. */
export interface ShopProgress {
  db: OrderStatus | null
  lights: OrderStatus | null
  scope: ScopeState
  layoutIssued: boolean
  boDate: string | null
}

export type ShopFactsInput = Pick<ComputeInput, 'scopeTypeIdByKey' | 'detailsByNode' | 'orderStatusByNodeScope' | 'boByNode'>

/**
 * The single per-shop read. The report rows, status plans and any screen use
 * this, so they cannot disagree about a shop.
 */
export function shopProgressFor(input: ShopFactsInput, nodeId: string): ShopProgress {
  const det = input.detailsByNode.get(nodeId)
  const stateFor = (scopeTypeId: string | null): OrderStatus | null =>
    scopeTypeId ? input.orderStatusByNodeScope.get(`${nodeId}:${scopeTypeId}`) ?? null : null
  // not_required (explicit landlord-covered override) wins over the
  // document-derived received/awaited state.
  const scope: ScopeState = det?.scopeNotRequired ? 'not_required' : det?.scopeReceived ? 'received' : 'awaited'
  return {
    db: stateFor(input.scopeTypeIdByKey.db),
    lights: stateFor(input.scopeTypeIdByKey.lighting),
    scope,
    layoutIssued: det?.layoutIssued ?? false,
    boDate: input.boByNode.get(nodeId)?.effectiveDate ?? null,
  }
}
```

Then, in `computeReportModel`, replace the destructuring line and the `stateFor` helper and the row mapping:

```ts
  const { activeNodes, decommissionedCount, scopeTypeIdByKey, detailsByNode, orderStatusByNodeScope, boByNode, today } = input

  const stateFor = (nodeId: string, scopeTypeId: string | null): OrderStatus | null =>
    scopeTypeId ? orderStatusByNodeScope.get(`${nodeId}:${scopeTypeId}`) ?? null : null

  const shopRows: ShopRow[] = activeNodes
    .map((n) => {
      const det = detailsByNode.get(n.id)
      const boDate = boByNode.get(n.id)?.effectiveDate ?? null
      // not_required (explicit landlord-covered override) wins over the
      // document-derived received/awaited state.
      const scope: ScopeState = det?.scopeNotRequired ? 'not_required' : det?.scopeReceived ? 'received' : 'awaited'
      return {
        shopNumber: n.shopNumber,
        tenantName: n.shopName,
        glaM2: n.glaM2,
        breakerA: n.breakerA,
        poleConfig: n.poleConfig,
        loadA: n.loadA,
        db: stateFor(n.id, scopeTypeIdByKey.db),
        lights: stateFor(n.id, scopeTypeIdByKey.lighting),
        scope,
        layoutIssued: det?.layoutIssued ?? false,
        boDate,
        boOverdue: boDate ? boDate < today : false,
      }
    })
```

with:

```ts
  const { activeNodes, decommissionedCount, detailsByNode, today } = input

  const shopRows: ShopRow[] = activeNodes
    .map((n) => {
      const p = shopProgressFor(input, n.id)
      return {
        shopNumber: n.shopNumber,
        tenantName: n.shopName,
        glaM2: n.glaM2,
        breakerA: n.breakerA,
        poleConfig: n.poleConfig,
        loadA: n.loadA,
        db: p.db,
        lights: p.lights,
        scope: p.scope,
        layoutIssued: p.layoutIssued,
        boDate: p.boDate,
        boOverdue: p.boDate ? p.boDate < today : false,
      }
    })
```

(`detailsByNode` is still used below for `scopeComplete` and `layoutsIssued`; leave those lines unchanged.)

- [ ] **Step 4: Run compute + characterisation**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/reports/tenant-schedule-report-compute.test.ts src/lib/reports/tenant-schedule-report-data.test.ts src/lib/reports/render-tenant-schedule.render.test.ts
```

Expected: PASS, all existing compute tests plus 3 new, the characterisation (2) and the render test unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/reports/tenant-schedule-report-compute.ts apps/web/src/lib/reports/tenant-schedule-report-compute.test.ts
git commit -m "refactor(tenant-schedule): one pure per-shop read (shopProgressFor)

computeReportModel builds its rows through it; behaviour unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Extract `loadTenantShopFacts`

**Files:**
- Create: `apps/web/src/lib/tenant-schedule/shop-facts.ts`
- Test: `apps/web/src/lib/tenant-schedule/shop-facts.test.ts`
- Modify: `apps/web/src/lib/reports/tenant-schedule-report-data.ts`

- [ ] **Step 1: Write the failing loader test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { loadTenantShopFacts } from './shop-facts'
import { fakeTablesClient } from './__fixtures__/fake-tables-client'
import { PROBE_TABLES } from './__fixtures__/probe-mall'

const ARGS = { projectId: 'p-1', orgId: 'org-1', openingDate: '2026-09-01' }

describe('loadTenantShopFacts', () => {
  it('returns the facts the report computes from', async () => {
    const { client } = fakeTablesClient(PROBE_TABLES)
    const facts = await loadTenantShopFacts(client, ARGS)
    expect(facts.activeNodes).toEqual([
      { id: 'n-1', shopNumber: 'ZZ01', shopName: 'Lantern Books', glaM2: 120, breakerA: 63, poleConfig: 'TP', loadA: 48 },
      { id: 'n-2', shopNumber: 'ZZ02', shopName: 'Copper Kettle', glaM2: 80, breakerA: 40, poleConfig: 'SP', loadA: null },
    ])
    expect(facts.decommissionedNodeIds).toEqual(['n-3'])
    expect(facts.decommissionedCount).toBe(1)
    expect(facts.scopeTypeIdByKey).toEqual({ db: 'tdb', lighting: 'tlt' })
    expect(facts.detailsByNode).toEqual(new Map([
      ['n-1', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }],
      ['n-2', { scopeReceived: false, scopeNotRequired: true, layoutIssued: false }],
    ]))
    expect(facts.orderStatusByNodeScope).toEqual(new Map([
      ['n-1:tdb', 'received'], ['n-1:tlt', 'by_tenant'], ['n-2:tdb', 'ordered'],
    ]))
    expect(facts.boByNode).toEqual(new Map([
      ['n-1', { effectiveDate: '2026-08-02' }],
      ['n-2', { effectiveDate: '2026-06-01' }],
    ]))
  })

  it('queries orders for active tenant nodes only, scoped orders only, and scope types for the org', async () => {
    const { client, calls } = fakeTablesClient(PROBE_TABLES)
    await loadTenantShopFacts(client, ARGS)
    const orders = calls.find((c) => c.table === 'structure.node_orders')!
    expect(orders.ops).toContainEqual(['in', ['node_id', ['n-1', 'n-2']]])
    expect(orders.ops).toContainEqual(['not', ['scope_item_type_id', 'is', null]])
    const types = calls.find((c) => c.table === 'structure.scope_item_types')!
    expect(types.ops).toContainEqual(['eq', ['organisation_id', 'org-1']])
    const nodes = calls.find((c) => c.table === 'structure.nodes')!
    expect(nodes.ops).toContainEqual(['eq', ['kind', 'tenant_db']])
  })

  it('skips the detail and order reads when the project has no active tenants', async () => {
    const { client, calls } = fakeTablesClient({ ...PROBE_TABLES, 'structure.nodes': [] })
    const facts = await loadTenantShopFacts(client, ARGS)
    expect(facts.activeNodes).toEqual([])
    expect(calls.map((c) => c.table)).not.toContain('structure.tenant_details')
    expect(calls.map((c) => c.table)).not.toContain('structure.node_orders')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/tenant-schedule/shop-facts.test.ts
```

Expected: FAIL with `Failed to resolve import "./shop-facts"`.

- [ ] **Step 3: Implement the loader (moved verbatim from the report data file)**

```ts
/**
 * loadTenantShopFacts — the ONE read of per-shop progress facts.
 *
 * The tenant schedule report and status plans both call it, so the report, the
 * plan and any screen built on it cannot drift (spec 2026-10-09 §6).
 *
 * The CALLER must already have gated project access: the client passed in may
 * be the service client, which bypasses RLS and site scope.
 */
import { listNodes, computeBoDate } from '@esite/shared'
import type { ComputeInput, OrderStatus } from '@/lib/reports/tenant-schedule-report-compute'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TenantShopFacts extends Omit<ComputeInput, 'today'> {
  /** Tenant nodes whose status is decommissioned (soft-deleted nodes are excluded entirely). */
  decommissionedNodeIds: string[]
}

export interface LoadTenantShopFactsArgs {
  projectId: string
  orgId: string
  /** projects.opening_date, used to derive BO dates from bo_period_days. */
  openingDate: string | null
}

export async function loadTenantShopFacts(client: unknown, args: LoadTenantShopFactsArgs): Promise<TenantShopFacts> {
  const db = client as any
  const { projectId, orgId, openingDate } = args

  // Tenant nodes (active + decommissioned carry a `status`; soft-deleted are excluded by listNodes).
  const allNodes = await listNodes(db as never, projectId, { kind: 'tenant_db' })
  const isDecommissioned = (n: unknown) => (n as { status?: string }).status === 'decommissioned'
  const activeNodesRaw = allNodes.filter((n) => !isDecommissioned(n))
  const decommissionedNodeIds = allNodes.filter(isDecommissioned).map((n) => n.id)
  const nodeIds = activeNodesRaw.map((n) => n.id)

  const [typesRes, detailsRes, ordersRes] = await Promise.all([
    db.schema('structure').from('scope_item_types')
      .select('id, key').eq('organisation_id', orgId),
    nodeIds.length
      ? db.schema('structure').from('tenant_details')
          .select('node_id, scope_status, scope_not_required, layout_status, bo_period_days, bo_date_override').in('node_id', nodeIds)
      : Promise.resolve({ data: [] }),
    nodeIds.length
      ? db.schema('structure').from('node_orders')
          .select('node_id, scope_item_type_id, status').in('node_id', nodeIds).not('scope_item_type_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  const types = (typesRes.data ?? []) as Array<{ id: string; key: string }>
  const scopeTypeIdByKey = {
    db: types.find((t) => t.key === 'db')?.id ?? null,
    lighting: types.find((t) => t.key === 'lighting')?.id ?? null,
  }

  const detailsByNode: ComputeInput['detailsByNode'] = new Map()
  const boByNode: ComputeInput['boByNode'] = new Map()
  for (const d of (detailsRes.data ?? []) as Array<{
    node_id: string; scope_status: string | null; scope_not_required: boolean | null; layout_status: string | null
    bo_period_days: number | null; bo_date_override: string | null
  }>) {
    detailsByNode.set(d.node_id, {
      scopeReceived: d.scope_status === 'received',
      scopeNotRequired: d.scope_not_required === true,
      layoutIssued: d.layout_status === 'issued',
    })
    boByNode.set(d.node_id, {
      effectiveDate: computeBoDate(openingDate, d.bo_period_days ?? null, d.bo_date_override ?? null),
    })
  }

  const orderStatusByNodeScope: ComputeInput['orderStatusByNodeScope'] = new Map()
  for (const o of (ordersRes.data ?? []) as Array<{ node_id: string; scope_item_type_id: string; status: OrderStatus }>) {
    orderStatusByNodeScope.set(`${o.node_id}:${o.scope_item_type_id}`, o.status)
  }

  return {
    activeNodes: activeNodesRaw.map((n) => ({
      id: n.id,
      shopNumber: (n as { shop_number?: string | null }).shop_number ?? (n as { code?: string }).code ?? '—',
      shopName: (n as { shop_name?: string | null }).shop_name ?? (n as { name?: string | null }).name ?? '—',
      glaM2: (n as { shop_area_m2?: number | null }).shop_area_m2 ?? null,
      // Incoming-supply electrical: a manual node breaker wins; otherwise the
      // value derived from the cable schedule (persisted incomer_* columns).
      breakerA:
        (n as { breaker_rating_a?: number | null }).breaker_rating_a ??
        (n as { incomer_breaker_a?: number | null }).incomer_breaker_a ?? null,
      poleConfig:
        (n as { pole_config?: string | null }).pole_config ??
        (n as { incomer_pole_config?: string | null }).incomer_pole_config ?? null,
      loadA: (n as { incomer_load_a?: number | null }).incomer_load_a ?? null,
    })),
    decommissionedCount: decommissionedNodeIds.length,
    decommissionedNodeIds,
    scopeTypeIdByKey,
    detailsByNode,
    orderStatusByNodeScope,
    boByNode,
  }
}
```

- [ ] **Step 4: Run the loader test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/tenant-schedule/shop-facts.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Make the report use the loader**

Replace the whole of `apps/web/src/lib/reports/tenant-schedule-report-data.ts` with:

```ts
/**
 * gatherTenantScheduleReportData — I/O seam for the tenant schedule report.
 * Cookie client gates project access; service client does the privileged reads
 * and logo downloads. Per-shop facts come from loadTenantShopFacts, the same
 * loader status plans use, so the report and the plans cannot drift.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { computeReportModel, type ReportKpis, type ShopRow } from './tenant-schedule-report-compute'

const LOGO_BUCKET = 'report-logos'
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyService = ReturnType<typeof createServiceClient>

export interface TenantScheduleReportData {
  projectName: string
  kpis: ReportKpis
  shopRows: ShopRow[]
  brandingInput: {
    orgName: string
    orgLogoDataUri: string | null
    orgAccent: string | null
    projectAccent: string | null
    clientLogoDataUri: string | null
    projectMarkDataUri: string | null
    projectSubtitle: string
  }
}

/** Download from a bucket → `data:<mime>;base64,…` URI, or null. */
async function downloadToDataUri(service: AnyService, bucket: string, storagePath: string): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(storagePath)
    if (error || !data) return null
    const bytes = Buffer.from(await data.arrayBuffer())
    return `data:${data.type || 'image/png'};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export async function gatherTenantScheduleReportData(projectId: string): Promise<TenantScheduleReportData> {
  // 1. Gate via the RLS-aware cookie client (throws if no access / not found).
  const supabase = await createClient()
  const project = await projectService.getById(supabase as never, projectId).catch(() => null)
  if (!project) throw new Error('Project not found')
  const orgId = project.organisation_id as string
  const openingDate: string | null = (project as { opening_date?: string | null }).opening_date ?? null

  // 2. Service client for privileged reads (RLS bypassed — caller is gated above).
  const service = createServiceClient()

  // 3. Per-shop facts (the shared loader) + the project row for branding, in parallel.
  const [facts, projRes] = await Promise.all([
    loadTenantShopFacts(service, { projectId, orgId, openingDate }),
    (service as any).schema('projects').from('projects')
      .select('name, client_logo_url, project_logo_url, report_accent_color').eq('id', projectId).maybeSingle(),
  ])

  const proj = projRes.data as {
    name: string | null; client_logo_url: string | null; project_logo_url: string | null; report_accent_color: string | null
  } | null

  // 4. Org row + logos.
  const { data: orgData } = await (service as any).from('organisations')
    .select('name, logo_url, report_accent_color').eq('id', orgId).maybeSingle()
  const org = orgData as { name: string | null; logo_url: string | null; report_accent_color: string | null } | null

  const [orgLogoDataUri, clientLogoDataUri, projectMarkDataUri] = await Promise.all([
    org?.logo_url ? downloadToDataUri(service, LOGO_BUCKET, org.logo_url) : Promise.resolve(null),
    proj?.client_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.client_logo_url) : Promise.resolve(null),
    proj?.project_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.project_logo_url) : Promise.resolve(null),
  ])

  // 5. Compute + assemble.
  const { kpis, shopRows } = computeReportModel({ ...facts, today: new Date().toISOString().slice(0, 10) })

  const projectName = (proj?.name as string | null) ?? (project.name as string) ?? '—'
  return {
    projectName,
    kpis,
    shopRows,
    brandingInput: {
      orgName: (org?.name as string | null) ?? 'Organisation',
      orgLogoDataUri,
      orgAccent: (org?.report_accent_color as string | null) ?? null,
      projectAccent: (proj?.report_accent_color as string | null) ?? null,
      clientLogoDataUri,
      projectMarkDataUri,
      projectSubtitle: 'Tenant coordination',
    },
  }
}
```

- [ ] **Step 6: Run the characterisation, the report tests and the service-key contract**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/reports src/lib/tenant-schedule src/lib/auth/service-client-gates.contract.test.ts
```

Expected: PASS. The characterisation test from Task 12 is unchanged and green, which is the proof the report's behaviour did not move. `service-client-gates` still passes: `shop-facts.ts` never names the service client (it receives a client), and the report data file still carries its `projectService.getById` gate.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/tenant-schedule/shop-facts.ts apps/web/src/lib/tenant-schedule/shop-facts.test.ts apps/web/src/lib/reports/tenant-schedule-report-data.ts
git commit -m "refactor(tenant-schedule): extract loadTenantShopFacts

The report and status plans read one loader; characterisation unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `shopLinkFor` — facts to a status-plan link

**Files:**
- Create: `apps/web/src/lib/status-plans/shop-link.ts`
- Test: `apps/web/src/lib/status-plans/shop-link.test.ts`

This also proves that web resolves the `@esite/shared/status-plans` subpath.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { shopStatus } from '@esite/shared/status-plans'
import { shopLinkFor } from './shop-link'
import type { TenantShopFacts } from '@/lib/tenant-schedule/shop-facts'

const FACTS: TenantShopFacts = {
  activeNodes: [
    { id: 'n-1', shopNumber: 'ZZ01', shopName: 'Lantern Books', glaM2: 120, breakerA: null, poleConfig: null, loadA: null },
    { id: 'n-2', shopNumber: 'ZZ02', shopName: 'Copper Kettle', glaM2: 80, breakerA: null, poleConfig: null, loadA: null },
  ],
  decommissionedCount: 1,
  decommissionedNodeIds: ['n-3'],
  scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
  detailsByNode: new Map([
    ['n-1', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }],
    ['n-2', { scopeReceived: false, scopeNotRequired: false, layoutIssued: false }],
  ]),
  orderStatusByNodeScope: new Map([
    ['n-1:tdb', 'received'], ['n-1:tlt', 'by_tenant'],
    ['n-2:tdb', 'ordered'],
  ]),
  boByNode: new Map([
    ['n-1', { effectiveDate: '2026-05-01' }],
    ['n-2', { effectiveDate: '2026-05-01' }],
  ]),
}

describe('shopLinkFor', () => {
  it('a shape with no node is unlinked', () => {
    expect(shopLinkFor(FACTS, null)).toEqual({ state: 'unlinked' })
  })
  it('a decommissioned tenant is decommissioned', () => {
    expect(shopLinkFor(FACTS, 'n-3')).toEqual({ state: 'decommissioned' })
  })
  it('a node the facts do not know (soft-deleted, or not a tenant) is unlinked', () => {
    expect(shopLinkFor(FACTS, 'n-gone')).toEqual({ state: 'unlinked' })
  })
  it('an active tenant carries its facts', () => {
    expect(shopLinkFor(FACTS, 'n-1')).toEqual({
      state: 'active',
      facts: { db: 'received', lights: 'by_tenant', scope: 'received', layoutIssued: true, boDate: '2026-05-01' },
    })
  })
  it('feeds shopStatus end to end', () => {
    expect(shopStatus(shopLinkFor(FACTS, 'n-1'), '2026-06-20')).toEqual({ status: 'complete', overdue: false })
    expect(shopStatus(shopLinkFor(FACTS, 'n-2'), '2026-06-20')).toEqual({ status: 'in_progress', overdue: true })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/shop-link.test.ts
```

Expected: FAIL with `Failed to resolve import "./shop-link"`. (If it instead fails resolving `@esite/shared/status-plans`, Task 11 Step 4 was skipped or `pnpm install` must be re-run to refresh the workspace link.)

- [ ] **Step 3: Implement**

```ts
/**
 * shopLinkFor — what a status-plan shape's node link resolves to, from the
 * same facts the tenant schedule report reads (loadTenantShopFacts). Pure.
 */
import type { ShopLink } from '@esite/shared/status-plans'
import { shopProgressFor } from '@/lib/reports/tenant-schedule-report-compute'
import type { TenantShopFacts } from '@/lib/tenant-schedule/shop-facts'

export function shopLinkFor(facts: TenantShopFacts, nodeId: string | null): ShopLink {
  if (!nodeId) return { state: 'unlinked' }
  if (facts.decommissionedNodeIds.includes(nodeId)) return { state: 'decommissioned' }
  if (!facts.activeNodes.some((n) => n.id === nodeId)) return { state: 'unlinked' }
  return { state: 'active', facts: shopProgressFor(facts, nodeId) }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/shop-link.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/shop-link.ts apps/web/src/lib/status-plans/shop-link.test.ts
git commit -m "feat(status-plans): resolve a shape's node to a shop link from report facts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Hand-add the DB types

**Files:**
- Modify: `packages/db/src/types.ts`

`supabase gen types` cannot see triggers, so `organisation_id`, `source_file_path` and `created_by` (all trigger-filled) are hand-marked optional in `Insert`, the same way `slug?`/`code?` are patched elsewhere in this file.

- [ ] **Step 1: Insert the two tables under `tenants.Tables`, after `handover_folders`**

Find this exact text (the end of `tenants.handover_folders`, immediately followed by the schema's `Views`):

```ts
            referencedRelation: "handover_folders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
```

Replace it with:

```ts
            referencedRelation: "handover_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      status_plan_shapes: {
        Row: {
          area_type: string | null
          created_at: string
          created_by: string | null
          detected_tag: string | null
          id: string
          node_id: string | null
          points: Json
          shape: string
          source: string
          status_plan_id: string
          updated_at: string
        }
        Insert: {
          area_type?: string | null
          created_at?: string
          /** Hand-patched optional: bound to auth.uid() by trigger (00245). */
          created_by?: string | null
          detected_tag?: string | null
          id?: string
          node_id?: string | null
          points: Json
          shape: string
          source?: string
          status_plan_id: string
          updated_at?: string
        }
        Update: {
          area_type?: string | null
          created_at?: string
          created_by?: string | null
          detected_tag?: string | null
          id?: string
          node_id?: string | null
          points?: Json
          shape?: string
          source?: string
          status_plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_plan_shapes_status_plan_id_fkey"
            columns: ["status_plan_id"]
            isOneToOne: false
            referencedRelation: "status_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      status_plans: {
        Row: {
          created_at: string
          created_by: string | null
          floor_plan_id: string
          id: string
          name: string
          organisation_id: string
          page_index: number
          project_id: string
          purpose: string
          source_file_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          /** Hand-patched optional: bound to auth.uid() by trigger (00245). */
          created_by?: string | null
          floor_plan_id: string
          id?: string
          name: string
          /** Hand-patched optional: bound from the drawing by trigger (00245). */
          organisation_id?: string
          page_index: number
          project_id: string
          purpose: string
          /** Hand-patched optional: stamped from the drawing by trigger (00245). */
          source_file_path?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          floor_plan_id?: string
          id?: string
          name?: string
          organisation_id?: string
          page_index?: number
          project_id?: string
          purpose?: string
          source_file_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_plans_floor_plan_id_fkey"
            columns: ["floor_plan_id"]
            isOneToOne: false
            referencedRelation: "floor_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
```

- [ ] **Step 2: Type-check db and web**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
```

Expected: both exit 0. If the Edit tool reports the old string is not unique, `handover_folders` gained a sibling since this plan was written; anchor on the `tenants:` schema block instead and insert the two tables as the last entries of its `Tables`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): hand-add status plan table types (trigger-bound columns optional)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: RBAC matrix

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Insert the section before `## Public / unauthenticated`**

Replace the line `## Public / unauthenticated` with:

```markdown
### Status plans (`tenants.status_plans`, `tenants.status_plan_shapes`, migration `00245`)

| Surface | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| Read a status plan and its shapes (RLS `status_plans_select` / `status_plan_shapes_select`) | R | R | R | R | R | R | R |
| Create, rename, re-anchor or delete a plan (RLS) | W | W | W | — | — | — | — |
| Draw, move, link, unlink or delete a shape (RLS) | W | W | W | — | — | — | — |

> **Added 2026-10-09 (status plans slice 1, data only).** No page, action or route exists yet; slice 2 adds `/projects/[id]/status-plans` and its server actions, which must gate writes on `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` (check `.ok`) and give every other role the same page read-only. The database already enforces this table: read = every project member (`user_has_project_access`), **client_viewer included** (a status plan is a progress picture made to be shown); write = `ORG_WRITE_ROLES` through a PERMISSIVE membership policy plus a **RESTRICTIVE per-verb** role gate (never `FOR ALL`, the `00205`/`00206` trap), and the generated `site_scope` policy on both tables. `organisation_id` and `source_file_path` are bound from the drawing by trigger; `project_id` must match the drawing's; a plan's drawing, page and purpose are fixed; a shape's node must be on the plan's project and not soft-deleted, and a tenant layout links `tenant_db` nodes only. Nothing derived (colour, status, area) is stored. Proven by `scripts/db/assert-status-plans-roles.sql` (impersonation, red first). Cloud-sync's `isAnnotated()` treats a drawing with a status plan as annotated, so it is never silently swapped for a newer Dropbox revision.

## Public / unauthenticated
```

- [ ] **Step 2: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): status plans read/write matrix (slice 1, data only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: The `@verify` sweep tool

**Files:**
- Modify: `packages/shared/src/lib/migrations/verify-header.ts`
- Test: `packages/shared/src/lib/migrations/verify-sweep.test.ts`
- Create: `scripts/db/emit-verify-sweep.ts`

A migration that adds policies can turn an EARLIER migration's `@verify` block red on the next deploy (it happened to `00206`, `00226` and `00230` under `00238`). The sweep evaluates every directive ≥ `00185` inside the dry-run transaction, after the new migration has run, through the existing harness.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildVerifySweepSql } from './verify-header'

const MIG_A = [
  '-- @verify:begin',
  '-- table: tenants.alpha',
  '-- behaviour: an owner can open the alpha page',
  '-- @verify:end',
  'CREATE TABLE tenants.alpha (id int);',
].join('\n')

const MIG_B = ['-- @verify:begin', '-- sql: (SELECT 1 = 1)', '-- @verify:end'].join('\n')

describe('buildVerifySweepSql', () => {
  it('emits one labelled (check, ok) branch per checkable directive', () => {
    const sql = buildVerifySweepSql([
      { file: '00300_a.sql', sql: MIG_A },
      { file: '00301_b.sql', sql: MIG_B },
      { file: '00302_none.sql', sql: 'SELECT 1;' },
    ])
    expect(sql.match(/UNION ALL/g)).toHaveLength(1)
    expect(sql).toContain(`'00300_a.sql #1 table'::text AS "check"`)
    expect(sql).toContain(`'00301_b.sql #1 sql'::text AS "check"`)
    expect(sql).toContain("to_regclass('tenants.alpha')")
    expect(sql).not.toContain('an owner can open the alpha page')
    expect(sql.trimEnd().endsWith(';')).toBe(true)
  })

  it('escapes quotes in labels', () => {
    const sql = buildVerifySweepSql([{ file: "00303_o'neil.sql", sql: MIG_B }])
    expect(sql).toContain(`'00303_o''neil.sql #1 sql'::text`)
  })

  it('refuses to sweep nothing, because a sweep over nothing passes vacuously', () => {
    expect(() => buildVerifySweepSql([{ file: '00302_none.sql', sql: 'SELECT 1;' }])).toThrow('nothing to sweep')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/lib/migrations/verify-sweep.test.ts
```

Expected: FAIL with `buildVerifySweepSql is not a function` (or "does not provide an export").

- [ ] **Step 3: Implement (append to the end of `verify-header.ts`)**

```ts
/**
 * One assertions file for scripts/db/dry-run-migration.sh that re-evaluates
 * every checkable @verify directive of the given migrations, as ONE statement
 * returning (check, ok) rows (the Management API returns only the last result
 * set). Run it with a NEW migration as the harness's migration argument to see
 * every earlier block under the state that migration leaves behind.
 *
 * A directive that raises aborts the whole statement; the harness then reports
 * the file as one failure with the error, and you bisect by passing a later
 * `since` to scripts/db/emit-verify-sweep.ts.
 */
export function buildVerifySweepSql(entries: ReadonlyArray<{ file: string; sql: string }>): string {
  const branches: string[] = []
  for (const e of entries) {
    const directives = parseVerifyBlock(e.sql)
    if (!directives) continue
    directives.forEach((d, i) => {
      const predicate = buildPredicate(d)
      if (!predicate) return
      const label = q(`${e.file} #${i + 1} ${d.kind}`)
      branches.push(`SELECT ${label}::text AS "check", s.ok FROM (\n${predicate}\n) AS s`)
    })
  }
  if (branches.length === 0) throw new Error('nothing to sweep')
  return `${branches.join('\nUNION ALL\n')};\n`
}
```

- [ ] **Step 4: Run it and the existing verify-header tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/lib/migrations
```

Expected: PASS (existing + 3 new).

- [ ] **Step 5: Write the emitter script**

```ts
#!/usr/bin/env node --experimental-strip-types
/**
 * Writes an assertions file that re-checks every @verify directive of every
 * migration >= <since> (default 00185), for the dry-run harness:
 *
 *   node --experimental-strip-types scripts/db/emit-verify-sweep.ts "$TMPDIR/verify-sweep.sql" [since]
 *   scripts/db/dry-run-migration.sh <new-migration.sql> "$TMPDIR/verify-sweep.sql"
 *
 * The harness applies the new migration and the sweep in one rolled-back
 * transaction, so each earlier block is judged against the state the new
 * migration leaves behind, which is exactly what the post-push verifier will
 * see on the next deploy. Write the output OUTSIDE the migrations folder.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildVerifySweepSql } from '../../packages/shared/src/lib/migrations/verify-header.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const DIR = join(ROOT, 'apps/edge-functions/supabase/migrations')
const out = process.argv[2]
const since = process.argv[3] ?? '00185'
if (!out) {
  console.error('usage: emit-verify-sweep.ts <out.sql> [since]')
  process.exit(1)
}
if (resolve(out).startsWith(DIR)) {
  console.error('refusing to write into the migrations folder: db push would read it')
  process.exit(1)
}
const entries = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') && f.slice(0, 5) >= since)
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(DIR, file), 'utf8') }))
writeFileSync(out, buildVerifySweepSql(entries))
console.log(`wrote ${out}: ${entries.length} migrations since ${since}`)
```

- [ ] **Step 6: Generate a sweep file locally (no database yet)**

```bash
node --experimental-strip-types scripts/db/emit-verify-sweep.ts "$TMPDIR/verify-sweep.sql"
grep -c 'UNION ALL' "$TMPDIR/verify-sweep.sql"
grep -c '00245_status_plans.sql' "$TMPDIR/verify-sweep.sql"
```

Expected: `wrote …: <N> migrations since 00185`; the UNION ALL count is in the thousands; the `00245_status_plans.sql` count is 63 (every directive in its block is checkable).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/lib/migrations/verify-header.ts packages/shared/src/lib/migrations/verify-sweep.test.ts scripts/db/emit-verify-sweep.ts
git commit -m "feat(migrations): sweep every earlier @verify directive under a new migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Everything green locally

**Files:** none

- [ ] **Step 1: Three test suites**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web test
```

Expected: all three PASS. Pass counts are the Task 0 baselines plus the new tests (shared ≈ +81, db ≈ +5, web ≈ +16 including one new `migration-verify-block` case). A FAIL anywhere stops here; do not move to the database steps with a red suite.

- [ ] **Step 2: Type-check and lint**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared lint
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web lint
```

Expected: all exit 0.

- [ ] **Step 3: Confirm the report did not move**

```bash
git diff origin/main -- apps/web/src/lib/reports/tenant-schedule-report.tsx apps/web/src/lib/reports/render-tenant-schedule.ts
```

Expected: empty (the PDF component and renderer are untouched; only the data seam changed, and the characterisation test pins its output).

---

### Task 20: Dry-run against production (red first, then green)

**Files:** none committed (mutations live in `$TMPDIR` only)

Every command here runs inside a rolled-back transaction on production (`scripts/db/dry-run-migration.sh`). Nothing persists. Never point these at a file containing top-level `BEGIN;`/`COMMIT;`; the harness refuses such files.

- [ ] **Step 1: Re-check the migration number (the claim is made now, not earlier)**

```bash
git fetch origin main
ls apps/edge-functions/supabase/migrations | tail -3
git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3
gh pr list --state open --json number,files --jq '.[] | {n: .number, m: [.files[].path | select(test("supabase/migrations/"))]} | select(.m | length > 0)'
source scripts/db/mgmt-api.sh && mgmt_query "SELECT max(version) AS head FROM supabase_migrations.schema_migrations"
```

Expected: head `00244`, no `00245_*` on main or in another open PR. If `00245` (or higher) is taken anywhere, `git mv` the file to the next free number, update the header comment line `-- Migration 00245:` and the rbac-matrix heading, re-run Task 19 Step 1 for the db and web suites (the contract tests find the file by pattern), commit, and use the new path below. Run these four checks as separate commands, never in the same command as a merge.

- [ ] **Step 2: RED — the assertions cannot pass without the migration**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-status-plans-roles.sql
```

Expected: `✗ assert-status-plans-roles.sql aborted (API error, transaction rolled back)` with `relation "tenants.status_plans" does not exist`, and exit 1.

- [ ] **Step 3: GREEN — every assertion holds with the migration**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00245_status_plans.sql scripts/db/assert-status-plans-roles.sql
```

Expected: 54 `✓` lines and `✓ 54 assertion(s) green across 1 file(s) — transactions rolled back, nothing persisted`. If a `FIXTURE:` row is red, the fixture is wrong (for example no contractor whose org role is also contractor on a project with drawings); fix the fixture query, not the migration.

- [ ] **Step 4: Mutations — each arm must be able to fail**

Run each, confirm the named assertions go red, then move on (the copies are in `$TMPDIR` and never committed):

```bash
M=apps/edge-functions/supabase/migrations/00245_status_plans.sql
A=scripts/db/assert-status-plans-roles.sql
D="/Volumes/Extreme SSD/tmp"

# M1: role gate admits contractor → contractor_plan_insert_refused / contractor_shape_insert_refused /
#     contractor_*_affects_nothing go red
sed "s/'project_manager')/'project_manager', 'contractor')/g" "$M" > "$D/mut1.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut1.sql" "$A"

# M2: SELECT excludes client_viewer → client_reads_plan goes red
sed "s/USING (public.user_has_project_access(project_id));/USING (public.user_has_project_access(project_id) AND COALESCE(public.user_effective_project_role(project_id), '') <> 'client_viewer');/" "$M" > "$D/mut2.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut2.sql" "$A"

# M3: organisation no longer bound from the drawing → pm_plan_org_bound_from_drawing goes red
sed "s/NEW.organisation_id := v_org;/NULL;/" "$M" > "$D/mut3.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut3.sql" "$A"

# M4: node-on-this-project check removed → pm_shape_foreign_node_refused goes red
sed "s/IF v_node_project IS DISTINCT FROM v_project THEN/IF false THEN/" "$M" > "$D/mut4.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut4.sql" "$A"

# M5: tenant-board-only check removed → pm_shape_main_board_on_layout_refused goes red
sed "s/IF v_purpose = 'tenant_layout' AND v_node_kind <> 'tenant_db' THEN/IF false THEN/" "$M" > "$D/mut5.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut5.sql" "$A"
```

Expected per run: exit 1 and only the assertions named in the comment (plus any that logically depend on them) are `✗`. Before each run, `diff "$M" "$D/mutN.sql"` must show the intended change; a sed that matched nothing makes the mutation vacuous. Record the five red sets in the PR body.

- [ ] **Step 5: Site-scope coverage (red, then green)**

```bash
# red: the migration without its two site_scope policies
awk '/^DROP POLICY IF EXISTS site_scope ON tenants.status_plan/{skip=4} skip>0{skip--; next} {print}' \
  apps/edge-functions/supabase/migrations/00245_status_plans.sql > "/Volumes/Extreme SSD/tmp/mut-noscope.sql"
grep -c 'site_scope ON tenants.status_plan' "/Volumes/Extreme SSD/tmp/mut-noscope.sql"
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh "/Volumes/Extreme SSD/tmp/mut-noscope.sql" scripts/db/assert-site-scope-coverage.sql

# green
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00245_status_plans.sql scripts/db/assert-site-scope-coverage.sql
```

Expected: the `grep -c` prints `0`; the red run shows `✗ site_scope present: tenants.status_plans` and `✗ site_scope present: tenants.status_plan_shapes` (and nothing else red); the green run is all `✓`.

- [ ] **Step 6: Sweep every earlier `@verify` directive under the new state**

```bash
node --experimental-strip-types scripts/db/emit-verify-sweep.ts "/Volumes/Extreme SSD/tmp/verify-sweep.sql"
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00245_status_plans.sql "/Volumes/Extreme SSD/tmp/verify-sweep.sql"
```

Expected: every line `✓`, including all of `00245_status_plans.sql #…` (this is also the proof that 00245's own block parses AND holds before it is ever applied). If the file aborts with an error, regenerate with a later `since` (e.g. `00230`, then `00238`) to find the migration whose directive raised; if a directive is `✗`, an earlier block counts policies in a way the new tables affect: fix it forward in THIS branch by editing that earlier block (exclude `polname <> 'site_scope'` or scope it to its own table) and prove the edit by re-running this step.

- [ ] **Step 7: Stop here**

The branch is green locally on the web, shared and db suites, and the migration has been dry-run against production red first and green after, with five mutations and the coverage check each going red as designed, and the full `@verify` sweep green. Do not apply, deploy or merge as part of this plan.

---

## Hand-off: what the apply step must do (not part of this plan)

1. Re-run Task 20 Step 1 immediately before applying. Claiming a number is not holding it.
2. Apply the migration (deploy workflow or `db push`), then read the tables back; a green workflow is not evidence the migration ran.
3. **Only after the migration is live**, deploy `cloud-sync-project` from `apps/edge-functions/deploy.sh` and read its version and `verify_jwt` back from the Management API. Deploying it first makes the new lookup fail, and because `isAnnotated()` fails closed, every drawing would read as annotated and auto-adopt would stop platform-wide until the migration lands.
4. `NOTIFY pgrst, 'reload schema'` is in the migration; no `db_schema` PATCH is needed (no new schema).

---

## Interfaces for later slices

Slices 2–4 are planned against these names. Changing any of them is a breaking change to those plans.

**`@esite/shared/status-plans`** (`packages/shared/src/status-plans/index.ts`)

```ts
// types.ts
export const STATUS_PLAN_PURPOSES: readonly ['tenant_layout', 'distribution_schematic']
export type StatusPlanPurpose = 'tenant_layout' | 'distribution_schematic'
export const AREA_TYPES: readonly ['common', 'plant_room', 'services', 'vacant']
export type AreaType = 'common' | 'plant_room' | 'services' | 'vacant'
export const AREA_TYPE_LABEL: Record<AreaType, string>
export const PURPOSE_LABEL: Record<StatusPlanPurpose, string>
export const SHAPE_KINDS: readonly ['polygon', 'rect']
export type ShapeKind = 'polygon' | 'rect'
export const SHAPE_SOURCES: readonly ['manual', 'detected']
export type ShapeSource = 'manual' | 'detected'
export type NodeOrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'
export type ScopeState = 'awaited' | 'received' | 'not_required'
export const MAX_POINT_VALUES: 4000
export function pointsError(shape: ShapeKind, points: unknown): string | null
export interface StatusPlanRow { id; project_id; organisation_id; floor_plan_id; page_index: number; purpose: StatusPlanPurpose; name; source_file_path; created_by: string | null; created_at; updated_at }
export interface StatusPlanShapeRow { id; status_plan_id; shape: ShapeKind; points: unknown; node_id: string | null; area_type: AreaType | null; detected_tag: string | null; source: ShapeSource; created_by: string | null; created_at; updated_at }
export interface StatusPlan { id; projectId; organisationId; floorPlanId; pageIndex: number; purpose: StatusPlanPurpose; name; sourceFilePath; createdBy: string | null; createdAt; updatedAt }
export interface StatusPlanShape { id; statusPlanId; shape: ShapeKind; points: number[]; nodeId: string | null; areaType: AreaType | null; detectedTag: string | null; source: ShapeSource; createdBy: string | null; createdAt; updatedAt }
export function statusPlanFromRow(r: StatusPlanRow): StatusPlan
export function statusPlanShapeFromRow(r: StatusPlanShapeRow): StatusPlanShape   // throws on points the DB would refuse

// shop-status.ts
export type ShopStatus = 'complete' | 'in_progress' | 'decommissioned' | 'unlinked'
export interface ShopProgressFacts { scope: ScopeState; layoutIssued: boolean; db: NodeOrderStatus | null; lights: NodeOrderStatus | null; boDate: string | null }
export type ShopLink = { state: 'unlinked' } | { state: 'decommissioned' } | { state: 'active'; facts: ShopProgressFacts }
export interface ShopStatusResult { status: ShopStatus; overdue: boolean }
export const SHOP_STATUS_LABEL: Record<ShopStatus, string>
export function isShopComplete(f: ShopProgressFacts): boolean
export function shopStatus(link: ShopLink, today: string /* yyyy-mm-dd */): ShopStatusResult

// db-block-status.ts
export type DbBlockStatus = NodeOrderStatus | 'no_order' | 'unlinked'
export const DB_BLOCK_STATUS_LABEL: Record<DbBlockStatus, string>
export function dbBlockStatus(linked: boolean, dbOrder: NodeOrderStatus | null): DbBlockStatus

// geometry.ts  (image pixels at the scale-2 raster, flat [x0, y0, …])
export type { Pt }                                   // { x: number; y: number } (Solar's)
export type Segment = [number, number, number, number]
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export interface HatchOptions { angleDeg: number; spacing: number }
export function rectToPoints(x0: number, y0: number, x1: number, y1: number): number[]   // TL, TR, BR, BL
export function boundingBox(points: readonly number[]): Box
export function shapeAreaPx(points: readonly number[]): number
export function shapeAreaM2(points: readonly number[], pixelsPerMeter: number | null | undefined): number | null
export function pointInShape(x: number, y: number, points: readonly number[]): boolean
export function distanceToEdge(x: number, y: number, points: readonly number[]): number  // + inside, − outside
export function visualCentre(points: readonly number[], precision?: number /* default 1 */): Pt
export function hatchSegments(points: readonly number[], opts: HatchOptions): Segment[]   // global phase

// area-check.ts
export const AREA_TOLERANCE: 0.02
export type AreaCheckState = 'no_scale' | 'no_schedule' | 'matches' | 'differs'
export interface AreaCheck { state: AreaCheckState; measuredM2: number | null; scheduledM2: number | null; deltaM2: number | null; deltaPct: number | null }
export function areaCheck(measuredM2: number | null, scheduledM2: number | null, tolerance?: number): AreaCheck
export function totalMeasuredM2(values: ReadonlyArray<number | null>): { totalM2: number; unmeasured: number }

// palette.ts
export const COLOURS: { complete; inProgress; overdue; ordered; byTenant; neutral; unlinked; decommissioned; common; plantRoom; services; vacant }  // '#RRGGBB'
export const HATCH_SPACING_PX: 14
export const STROKE_PX: 3
export interface HatchSpec { angleDeg: number; spacing: number; color: string; width: number }
export interface ShapeStyle { fill: string | null; fillOpacity: number; stroke: string; strokeWidth: number; dash: readonly number[] | null; hatches: readonly HatchSpec[]; strikeLabel: boolean }
export interface LegendEntry { key: string; label: string; style: ShapeStyle }
export function tenantShapeStyle(r: ShopStatusResult): ShapeStyle
export function areaShapeStyle(t: AreaType): ShapeStyle
export function dbBlockStyle(s: DbBlockStatus): ShapeStyle
export const TENANT_LEGEND: readonly LegendEntry[]     // keys: complete, in_progress, overdue, decommissioned, unlinked, common, plant_room, services, vacant
export const SCHEMATIC_LEGEND: readonly LegendEntry[]  // keys: required, ordered, received, by_tenant, no_order, unlinked
export function hexToRgb01(hex: string): { r: number; g: number; b: number }
```

**Web** (`apps/web/src/lib/…`)

```ts
// lib/tenant-schedule/shop-facts.ts  (caller must gate project access first)
export interface TenantShopFacts extends Omit<ComputeInput, 'today'> { decommissionedNodeIds: string[] }
export interface LoadTenantShopFactsArgs { projectId: string; orgId: string; openingDate: string | null }
export async function loadTenantShopFacts(client: unknown, args: LoadTenantShopFactsArgs): Promise<TenantShopFacts>

// lib/reports/tenant-schedule-report-compute.ts  (additions)
export interface ShopProgress { db: OrderStatus | null; lights: OrderStatus | null; scope: ScopeState; layoutIssued: boolean; boDate: string | null }
export type ShopFactsInput = Pick<ComputeInput, 'scopeTypeIdByKey' | 'detailsByNode' | 'orderStatusByNodeScope' | 'boByNode'>
export function shopProgressFor(input: ShopFactsInput, nodeId: string): ShopProgress

// lib/status-plans/shop-link.ts
export function shopLinkFor(facts: TenantShopFacts, nodeId: string | null): ShopLink
```

**Database** (`00245`, number confirmed at apply time)

- `tenants.status_plans (id, project_id, organisation_id [trigger], floor_plan_id, page_index ≥ 1, purpose, name, source_file_path [trigger], created_by [trigger], created_at, updated_at)`, unique `(floor_plan_id, page_index, purpose)`; drawing, page, purpose and project immutable; `source_file_path` updatable only to the drawing's current `file_path`.
- `tenants.status_plan_shapes (id, status_plan_id, shape, points jsonb, node_id → structure.nodes ON DELETE SET NULL, area_type, detected_tag ≤ 64 chars, source, created_by [trigger], created_at, updated_at)`; unique `(status_plan_id, node_id) WHERE node_id IS NOT NULL`; a shape cannot change plan.
- Error codes slices 2–3 should map to sentences: `23514` (trigger and CHECK refusals: wrong project, deleted board, tenant-only link, area on schematic, fixed fields, bad points), `23505` (duplicate plan or board already on this plan), `23503` (drawing / plan not found or not visible), `42501` (role gate).
- `public.site_project_of_status_plan(uuid) → uuid` (definer, authenticated + service_role only).
- Not yet built (slice 3 will add its own loader): DB order status for non-tenant nodes on schematic plans. `loadTenantShopFacts` reads tenant nodes only.
