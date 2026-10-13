# Tenant Plans — Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move status plans out of the shared Drawings register and the "Status plans" sidebar entry into the Tenant Schedule as two dedicated tools, **Floor plan** (`tenant_layout`) and **Line diagram** (`distribution_schematic`), each with its own uploaded files (a private `tenant-plan-files` bucket), any number of sheets, and the existing masking / hatching / detection / PDF engine re-pointed from "a page of a drawing" to "a sheet of this plan".

**Architecture:** One migration (`00249_tenant_plans.sql`, number re-checked at apply time) changes `tenants.status_plans` in place (production holds 0 rows; the migration refuses to run over data): it drops `floor_plan_id` / `page_index` / `source_file_path`, binds `organisation_id` from the project, and adds `UNIQUE (project_id, purpose)`. A new `tenants.status_plan_sheets` table holds one row per sheet (file path in the new bucket, page within that file, revision, replaced flag, per-sheet scale). `status_plan_shapes` gains `sheet_id NOT NULL` with a trigger that keeps the sheet inside the shape's plan, so "a board appears once per plan" still spans every sheet. Row security repeats the 00245 per-verb pattern, the new table joins the site-scope manifest, and the bucket gets read/insert/delete policies keyed on the path's project segment plus the generated `site_scope_objects` treatment. The browser uploads straight to storage through server-issued signed upload URLs; server actions register sheets (counting PDF pages with pdf-lib) and replace / re-anchor / rename / delete / calibrate them, every one returning `{ ok, error }`. The canvas workspace moves under `tenant-schedule/_plans/` and is served by two routes, `/projects/[id]/tenant-schedule/floor-plan` and `/line-diagram`, with a sheet strip (`?sheet=`). Report appendix, Export sheet and the portal iterate sheets. **`cloud-sync-project` must drop its `status_plans` lookup and be deployed before the migration is applied** (Task A1 and the runbook).

**Tech Stack:** Postgres 17 (Supabase), PL/pgSQL triggers, PostgREST RLS, Supabase Storage (signed upload URLs); Next.js 15 App Router (server components, server actions), React 19, Konva; pdf-lib; pdfjs-dist; TypeScript; vitest (`web`, `@esite/shared`, `@esite/db`); Deno edge function (`cloud-sync-project`); pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-10-12-tenant-plans-relocation-design.md` (the change). It supersedes §2, §4 (`floor_plan_id` / `page_index` / `source_file_path`), §7 and §8 naming of `docs/superpowers/specs/2026-10-09-status-plans-design.md`; the engine described there (shapes, live colours, measured area, detection, vector PDF) is unchanged.

**Out of scope for implementers:** applying the migration, deploying the edge function, merging. Phase F ends with the branch green locally and the migration dry-run against production (red first, mutations, coverage, sweep). The **Deploy runbook** section at the end is for the owner / release session and is NOT executed by implementers.

---

## Rules this plan follows (read once before Task A1)

These come from `CLAUDE.md`; each was paid for by a real incident.

1. **Every migration ≥ `00185` carries a `-- @verify:begin … -- @verify:end` block** naming every table and function it creates (`apps/web/src/lib/migration-verify-block.contract.test.ts`). The block holds directives only; a stray `--` line is folded into the previous directive. No em dash inside a `sql:` payload (#194).
2. **When a migration drops an object an earlier `@verify` block names, edit that earlier block in the same PR** and prove the edit by evaluating the old directives under the new state (the `00204` / `00206` failure). Here: 00245 names `page_index`, `source_file_path`, `status_plans_page_positive` and `status_plans_drawing_page_purpose_key` (Task B2, Task F7 Step 6).
3. **Never a RESTRICTIVE `FOR ALL` role gate.** Write gates are per verb (INSERT / UPDATE / DELETE). The only `FOR ALL` policies are the generated `site_scope` and `site_scope_objects`, whose expression is the read predicate.
4. **`REVOKE ALL ON FUNCTION … FROM PUBLIC, anon`** for every new or replaced function.
5. **New site tables go in `packages/db/src/site-scope/manifest.ts`**, the migration carries the generator's text byte for byte, and a contract test holds the two together. The bucket goes in `SITE_BUCKETS` and the migration re-creates `site_scope_objects` with the generator's text.
6. **Impersonation assertions run red first**, and every arm is mutated to prove it can fail (Task F7).
7. **`'use server'` files export async functions only** (types live in `lib/status-plans/types.ts`). **Server actions return `{ ok, error }`**; production redacts thrown messages.
8. **Page → client component props are JSON only** (no functions, Maps, Dates). Pinned by `page-props.contract.test.ts`.
9. **`requireEffectiveRole` returns an object: read `.ok`.** A truthiness check gates nothing.
10. **Run all three suites** (`web`, `@esite/shared`, `@esite/db`) before calling anything green.
11. **Migration number is claimed at apply time.** `origin/main` already holds `00246_tender_cidb_not_applicable.sql` and `00247_tender_cidb_certificate_waiver.sql`, so this plan writes `00249_tenant_plans.sql`. Tests find it by the pattern `^\d{5}_tenant_plans\.sql$`, never by number. Task F7 Step 1 and the runbook re-check.
12. **Worktree hygiene:** `pnpm install` in this worktree; never symlink another worktree's `node_modules`. Tests and builds run with `TMPDIR` on the SSD.

Shell setup used by every command below:

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans"
export TMPDIR="/Volumes/Extreme SSD/tmp"
mkdir -p "$TMPDIR"
```

Commit messages end with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## File structure

**Create**

| Path | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00249_tenant_plans.sql` | Plan columns dropped, `status_plan_sheets`, `sheet_id` on shapes, bucket + storage RLS, site scope, `@verify` |
| `packages/db/src/__tests__/security/tenant-plans-site-scope.contract.test.ts` | Migration carries the generator's `site_scope` (sheets) and `site_scope_objects` text byte for byte |
| `apps/web/src/lib/status-plans/sheet-files.ts` (+ `.test.ts`) | Pure + pdf-lib helpers: storage paths, mime, default labels, PDF page count, size limits |
| `apps/web/src/lib/status-plans/sheet-row.ts` (+ `.test.ts`) | `SHEET_COLUMNS`, `toSheetSummary`, `summaryOf` |
| `apps/web/src/lib/status-plans/navigate.ts` | `navigateTo(href)` — one mockable full navigation |
| `apps/web/src/lib/status-plans/plan-cards.ts` (+ `.test.ts`) | `loadTenantPlanCards` for the tenant schedule's two cards |
| `apps/web/src/actions/tenant-plan-sheets.actions.ts` (+ `.test.ts`) | prepare upload, register, prepare replace, replace, re-anchor, rename, delete, calibrate |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/floor-plan/page.tsx` | Floor plan route |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/line-diagram/page.tsx` | Line diagram route |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/SheetStrip.tsx` (+ `.test.tsx`) | Sheet navigation + "Add sheets" |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/SheetControls.tsx` (+ `.test.tsx`) | Rename / Replace / Delete the current sheet |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/TenantPlanUploader.tsx` (+ `.test.tsx`) | Multi-file direct-to-storage upload |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/TenantPlanEmpty.tsx` | Empty state (Upload for writers) |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantPlansSection.tsx` (+ `.test.tsx`) | The two cards |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/redirect.test.ts` | Old routes redirect to the tenant schedule |
| `apps/web/src/app/(portal)/portal/[projectId]/tenant-plans/page.tsx` (+ `.test.tsx`) | Portal "Tenant plans" |

**Move** (`git mv`, then edit)

| From | To |
|---|---|
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/{StatusPlanWorkspace,StatusPlanCanvas,ShapePanel,PlanLegend,DetectBlocksPanel}.tsx` (+ tests) | `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/` |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/_components/ExportSheetButton.tsx` (+ test) | `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.tsx` |

**Modify**

| Path | Change |
|---|---|
| `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` | `isAnnotated()` drops the `status_plans` lookup |
| `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts` | `tenants.status_plans` exempted with a reason; proof the exemption is true |
| `apps/edge-functions/supabase/migrations/00245_status_plans.sql` | `@verify` block loses the four directives naming dropped objects (block only) |
| `packages/db/src/site-scope/manifest.ts`, `fixed.sql.ts` | Gate `status_plan_sheets`; add `tenant-plan-files` to `SITE_BUCKETS` |
| `scripts/db/site-scope/site_scoped_access.sql` | Regenerated |
| `scripts/db/assert-status-plans-roles.sql` | Rewritten for the post-00249 state (91 assertions) |
| `packages/db/src/types.ts` | `status_plans` columns, `status_plan_sheets`, `status_plan_shapes.sheet_id` |
| `packages/shared/src/status-plans/types.ts` (+ test) | Labels, default names, bucket constants, row types |
| `apps/web/src/lib/status-plans/{types,canvas-shape,write-errors,plan-urls,load-plan-page,on-plan-links,plan-render-data,render-plan-page,appendix,report-appendix}.ts` (+ tests) | Sheets |
| `apps/web/src/lib/status-plans/__fixtures__/fake-client.ts` | Storage: signed upload URLs, download, remove |
| `apps/web/src/actions/status-plan.actions.ts`, `status-plan-detection.actions.ts` (+ tests) | Shapes carry `sheet_id`; plan-level actions removed |
| `apps/web/src/lib/status-plans/page-props.contract.test.ts` | Points at the two new pages |
| `apps/web/src/app/(admin)/projects/[id]/status-plans/page.tsx`, `[planId]/page.tsx` | Become 307 redirects |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx` | Tenant plans section |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/{ScheduleTable,TenantScheduleReportButton}.tsx` (+ tests) | Links and labels |
| `apps/web/src/components/layout/Sidebar.tsx` (+ test) | "Status plans" entry removed |
| `apps/web/src/components/portal/PortalProjectNav.tsx` (+ test), `apps/web/src/lib/portal/data.ts` | "Tenant plans" |
| `apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.tsx` | Redirects to `tenant-plans` |
| `apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts` (+ test) | `?sheet=` required |
| `apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.ts` (+ test) | Every sheet of the plan |
| `apps/web/src/lib/reports/{pdf-handoff,render-tenant-schedule}.ts`, `components/reports/SavedReportsPanel.tsx` (+ tests) | Sheet paths and naming |
| `docs/rbac-matrix.md` | Routes, actions, tables, bucket |

**Delete:** `status-plans/NewStatusPlanForm.tsx` (+ test), `lib/status-plans/plan-list.ts` (+ test), `app/(portal)/portal/[projectId]/status-plans/page.test.tsx`.

**Internal API paths stay** (`/api/projects/[id]/status-plans/[planId]/sheet`, `/api/portal/[projectId]/status-plans/[planId]/pdf`): they are keyed by plan id, never shown to people, and renaming them buys nothing but churn.

---

## Phase A — Cloud sync stops looking at status plans

### Task A1: `isAnnotated()` drops the `status_plans` lookup

**Why first:** the current lookup filters `tenants.status_plans` on `floor_plan_id`. The migration drops that column. If the migration lands while the old function is live, the query errors, `isAnnotated()` treats an error as "annotated", and auto-adopt stops for **every drawing in production**. So the function must be deployed without the lookup BEFORE the migration is applied (runbook step R2). Deploying it early is safe: production holds 0 status plans, so the lookup protects nothing today.

**Files:**
- Modify: `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts`
- Modify: `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`

- [ ] **Step 1: Write the failing expectation**

In `floor-plan-annotated-predicate.contract.test.ts`, inside `describe('analyser can actually fail')` → `it('would report a table the predicate does not query', …)`, add one line after the `floor_plan_versions` expectation:

```ts
      expect(predicateQueries(body, 'tenants.status_plans')).toBe(false)
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
```

Expected: FAIL, `would report a table the predicate does not query` — `expected true to be false` (the lookup is still there).

- [ ] **Step 3: Remove the lookup**

In `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts`, delete exactly this block (it sits just before the final `return false` of `isAnnotated()`):

```ts
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

```

and put this comment in its place (directly above `return false`):

```ts
  // Status plans no longer anchor to drawings (tenant plans, 00249): their
  // sheets live in their own bucket, tenant-plan-files, which cloud sync never
  // touches. There is deliberately no lookup for them here.
```

- [ ] **Step 4: Exempt the table, with a reason**

Discovery reads `CREATE TABLE` bodies, and 00245's body still names `floor_plan_id`, so `tenants.status_plans` is still discovered. In `DECLARED_EXEMPT`, add after the `floor_plan_versions` entry:

```ts
  'tenants.status_plans':
    'No longer anchored to a drawing. The tenant plans migration (00249) drops floor_plan_id, ' +
    'page_index and source_file_path; a plan\'s sheets are files in the tenant-plan-files bucket, ' +
    'which cloud sync never reads or swaps. 00245\'s CREATE TABLE still names floor_plan_id, which ' +
    'is the only reason discovery finds it.',
```

- [ ] **Step 5: Run the contract test**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
```

Expected: PASS (all cases). `fails closed on a query error` still holds: one lookup and its `return true` went together, and there is still exactly one `return false`.

- [ ] **Step 6: Type-check the function the way CI does**

```bash
cd apps/edge-functions && deno check supabase/functions/cloud-sync-project/index.ts; cd -
```

Expected: no errors. If `deno` is not installed locally, skip; CI's edge-function job runs it.

- [ ] **Step 7: Commit**

```bash
git add apps/edge-functions/supabase/functions/cloud-sync-project/index.ts packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
git commit -m "fix(cloud-sync): isAnnotated() stops reading status_plans before tenant plans drop floor_plan_id

Must be deployed before 00249 is applied: the old lookup filters on a
column the migration drops, and isAnnotated() fails closed, which would
stop auto-adopt for every drawing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase B — Database

### Task B1: Site-scope manifest and bucket list

**Files:**
- Modify: `packages/db/src/site-scope/manifest.ts`
- Modify: `packages/db/src/site-scope/fixed.sql.ts`
- Modify (regenerated): `scripts/db/site-scope/site_scoped_access.sql`

- [ ] **Step 1: Gate the new table**

In `manifest.ts`, in `GATED`, after `child('tenants.status_plan_shapes', 'status_plan', 'status_plan_id'),` add:

```ts
  child('tenants.status_plan_sheets', 'status_plan', 'status_plan_id'),
```

and replace the trailing comment block's last three lines

```ts
  // Status plans (00245) are in this manifest like any generated table, and
  // their migration carries the generator's text byte for byte; a contract
  // test (status-plans-site-scope.contract.test.ts) holds the two together.
```

with

```ts
  // Status plans (00245) are in this manifest like any generated table, and
  // their migration carries the generator's text byte for byte; a contract
  // test (status-plans-site-scope.contract.test.ts) holds the two together.
  // status_plan_sheets (00249, tenant plans) likewise, held by
  // tenant-plans-site-scope.contract.test.ts, which also pins the
  // site_scope_objects text that adds the tenant-plan-files bucket.
```

- [ ] **Step 2: Add the bucket**

In `fixed.sql.ts`, replace

```ts
const SITE_BUCKETS = ['drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos',
  'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence']
```

with

```ts
const SITE_BUCKETS = ['drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos',
  'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence', 'tenant-plan-files']
```

`tenant-plan-files` paths are `{org}/{project}/…`, so `storage_site_access` reads the project from segment 2 like every other bucket except `jbcc-letters`; no change to the function.

- [ ] **Step 3: Regenerate the reviewed artefact**

```bash
npx tsx scripts/db/site-scope/emit.ts
git diff --stat scripts/db/site-scope/site_scoped_access.sql
```

Expected: `wrote scripts/db/site-scope/site_scoped_access.sql`; the diff touches the `site_scope_objects` USING / WITH CHECK lines (now ending `'cable-schedule-evidence', 'tenant-plan-files')`), adds the 4-line `site_scope ON tenants.status_plan_sheets` policy and its `-- policy:` verify line.

- [ ] **Step 4: Generator tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/site-scope
```

Expected: PASS (every gated table has exactly one policy; no table gated twice).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/site-scope/manifest.ts packages/db/src/site-scope/fixed.sql.ts scripts/db/site-scope/site_scoped_access.sql
git commit -m "feat(site-scope): gate status_plan_sheets and the tenant-plan-files bucket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2: Migration `00249_tenant_plans.sql`

**Files:**
- Create: `packages/db/src/__tests__/security/tenant-plans-site-scope.contract.test.ts`
- Modify: `packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts`
- Create: `apps/edge-functions/supabase/migrations/00249_tenant_plans.sql`
- Modify: `apps/edge-functions/supabase/migrations/00245_status_plans.sql` (`@verify` block only)

- [ ] **Step 1: Write the site-scope contract test (red)**

Create `packages/db/src/__tests__/security/tenant-plans-site-scope.contract.test.ts`:

```ts
/**
 * CONTRACT — the tenant plans migration carries the site-scope text the
 * generator would emit: the site_scope policy on tenants.status_plan_sheets and
 * the re-created storage site_scope_objects policy (now naming the
 * tenant-plan-files bucket). The manifest is the source, the migration is the
 * artefact; neither is a mirror of the other.
 *
 * Found by name pattern, not number, so a renumber at apply time does not
 * break this test.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateMigration } from '../../site-scope/generate'
import { GATED } from '../../site-scope/manifest'

const MIGRATIONS_DIR = join(__dirname, '../../../../../apps/edge-functions/supabase/migrations')

function tenantPlansMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_tenant_plans\.sql$/.test(f))
  expect(files, 'exactly one <number>_tenant_plans.sql migration').toHaveLength(1)
  return readFileSync(join(MIGRATIONS_DIR, files[0]!), 'utf8')
}

/** From `start` through the semicolon that ends the WITH CHECK clause after it. */
function statementFrom(sql: string, start: string): string {
  const at = sql.indexOf(start)
  expect(at, `generator emits no "${start}"`).toBeGreaterThan(-1)
  const withCheck = sql.indexOf('WITH CHECK (', at)
  const end = sql.indexOf(';', withCheck)
  return sql.slice(at, end + 1)
}

describe('tenant plans site scope matches the generator', () => {
  const generated = generateMigration()
  const migration = tenantPlansMigration()

  it('the manifest gates status_plan_sheets through the status_plan resolver', () => {
    const g = GATED.find((x) => x.table === 'tenants.status_plan_sheets')
    expect(g?.project).toEqual({ resolver: 'status_plan', column: 'status_plan_id' })
  })

  it('the migration carries the sheets site_scope policy byte for byte', () => {
    expect(migration).toContain(statementFrom(generated, 'DROP POLICY IF EXISTS site_scope ON tenants.status_plan_sheets;'))
  })

  it('the migration re-creates site_scope_objects byte for byte, with the new bucket', () => {
    const objects = statementFrom(generated, 'DROP POLICY IF EXISTS site_scope_objects ON storage.objects;')
    expect(objects).toContain("'tenant-plan-files'")
    expect(migration).toContain(objects)
  })

  it('can fail: a policy the migration does not create is not found in it', () => {
    expect(migration).not.toContain(statementFrom(generated, 'DROP POLICY IF EXISTS site_scope ON tenants.floor_plan_markups;'))
  })
})
```

- [ ] **Step 2: Write the "really drawing-free" proof (red)**

In `floor-plan-annotated-predicate.contract.test.ts`, inside `describe('cloud-sync isAnnotated() covers every drawing-anchored table')`, after `it('still reads the drawing-level calibration', …)`, add:

```ts
  it('the status_plans exemption is true: a later migration drops its drawing column', () => {
    // The exemption above is a claim about the schema. This reads the corpus and
    // fails if no migration actually removes floor_plan_id from status_plans.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    const drops = files.filter((f) => {
      const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
      return /ALTER\s+TABLE\s+tenants\.status_plans\b[\s\S]*?DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?floor_plan_id\b/i.test(sql)
    })
    expect(drops, 'no migration drops tenants.status_plans.floor_plan_id, so the exemption is false').toHaveLength(1)
  })
```

- [ ] **Step 3: Run both and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security/tenant-plans-site-scope.contract.test.ts src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
```

Expected: FAIL — `exactly one <number>_tenant_plans.sql migration: expected [] to have a length of 1`, and `no migration drops tenants.status_plans.floor_plan_id`.

- [ ] **Step 4: Write the migration**

Create `apps/edge-functions/supabase/migrations/00249_tenant_plans.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Migration 00249: tenant plans (status plans move under Tenants, own files)
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-10-12-tenant-plans-relocation-design.md (§3, §4)
--
-- WHAT CHANGES. A status plan was one page of a drawing in the shared register
-- (00245). It is now one tool per project per purpose: the tenant FLOOR PLAN
-- (purpose tenant_layout) and the LINE DIAGRAM (distribution_schematic), each
-- with its own uploaded files. So:
--   * status_plans loses floor_plan_id, page_index and source_file_path, binds
--     organisation_id from the PROJECT, and is unique per (project, purpose).
--   * status_plan_sheets is new: one row per sheet. A sheet is one page of one
--     file in the private tenant-plan-files bucket, at
--     {org}/{project}/{plan}/{folder}/{revision}.{pdf|png|jpg}. A PDF of N pages
--     is N sheets that share one file. The scale is per sheet.
--   * status_plan_shapes gains sheet_id NOT NULL. status_plan_id stays, so the
--     unique (status_plan_id, node_id) key still spans every sheet: a shop is
--     masked once across all floors.
-- Production holds 0 rows in both tables (checked 2026-10-12); the first
-- statement refuses to run if that is no longer true, because columns change in
-- place and there is no data step.
--
-- REPLACE AND RE-ANCHOR (owner decision A). Replacing a sheet's file is an
-- UPDATE of file_path. The trigger, not the client, then sets revision + 1,
-- replaced_at = now() and replaced_from_path = the old path. The masks and the
-- scale are kept; the page shows a banner until someone re-anchors, which is
-- an UPDATE setting replaced_at to NULL. replaced_at can be cleared, never
-- forged; page_index, mime and file_name change only together with the file.
--
-- PARENTS ARE DERIVED OR CHECKED, NEVER TRUSTED. organisation_id comes from the
-- project (plans) or the plan (sheets). A sheet's file must live under its own
-- plan's folder (org/project/plan prefix), so a sheet can never point the
-- service-side renderers at another project's object. A shape's sheet must
-- belong to the shape's plan and is fixed after creation. created_by is
-- auth.uid() on insert and may only become NULL afterwards (the FK SET NULL).
--
-- ROW SECURITY. Same shape as 00245: read for every project member (client
-- viewers included), write for owner / admin / project_manager through a
-- PERMISSIVE membership policy plus a RESTRICTIVE per-verb role gate. Never
-- FOR ALL for a role gate (00205 -> 00206). site_scope is the generator's text
-- byte for byte (tenant-plans-site-scope.contract.test.ts).
--
-- STORAGE. tenant-plan-files is private, 50 MB per file, PDF / PNG / JPEG.
-- tenants.tenant_plan_file_project(name) returns the project only when the
-- path's org / project / plan segments name a real plan of that project and
-- org, so a forged prefix reads as no project at all. Read: any member who can
-- read the plan. Insert and delete: owner / admin / PM of that project. No
-- UPDATE policy: a replacement is a new object at revision + 1. Plus the
-- generated site_scope_objects policy, re-created with the bucket added.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: tenants.status_plan_sheets
-- column: tenants.status_plan_sheets.status_plan_id
-- column: tenants.status_plan_sheets.organisation_id
-- column: tenants.status_plan_sheets.sort_order
-- column: tenants.status_plan_sheets.label
-- column: tenants.status_plan_sheets.file_path
-- column: tenants.status_plan_sheets.page_index
-- column: tenants.status_plan_sheets.file_name
-- column: tenants.status_plan_sheets.mime
-- column: tenants.status_plan_sheets.revision
-- column: tenants.status_plan_sheets.replaced_at
-- column: tenants.status_plan_sheets.replaced_from_path
-- column: tenants.status_plan_sheets.pixels_per_meter
-- column: tenants.status_plan_sheets.calibration_points
-- column: tenants.status_plan_sheets.calibration_metres
-- column: tenants.status_plan_shapes.sheet_id
-- constraint: status_plans_project_purpose_key ON tenants.status_plans
-- constraint: status_plan_sheets_plan_order_key ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_sort_order_check ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_page_positive ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_revision_positive ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_mime_check ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_label_not_blank ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_file_name_not_blank ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_scale_positive ON tenants.status_plan_sheets
-- constraint: status_plan_sheets_calibration_shape ON tenants.status_plan_sheets
-- index: status_plan_shapes_sheet_idx ON tenants.status_plan_shapes
-- function: tenants.status_plans_bind_parents()
-- function: tenants.status_plan_sheets_bind_parents()
-- function: tenants.status_plan_shapes_check_link()
-- function: tenants.tenant_plan_file_project(text)
-- trigger: status_plans_bind_parents ON tenants.status_plans
-- trigger: status_plan_sheets_bind_parents ON tenants.status_plan_sheets
-- trigger: status_plan_sheets_updated_at ON tenants.status_plan_sheets
-- trigger: status_plan_shapes_check_link ON tenants.status_plan_shapes
-- policy: status_plan_sheets_select ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_insert ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_update ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_delete ON tenants.status_plan_sheets PERMISSIVE
-- policy: status_plan_sheets_insert_authz ON tenants.status_plan_sheets RESTRICTIVE
-- policy: status_plan_sheets_update_authz ON tenants.status_plan_sheets RESTRICTIVE
-- policy: status_plan_sheets_delete_authz ON tenants.status_plan_sheets RESTRICTIVE
-- policy: site_scope ON tenants.status_plan_sheets RESTRICTIVE
-- policy: tenant_plan_files_read ON storage.objects PERMISSIVE
-- policy: tenant_plan_files_insert ON storage.objects PERMISSIVE
-- policy: tenant_plan_files_delete ON storage.objects PERMISSIVE
-- policy: site_scope_objects ON storage.objects RESTRICTIVE
-- grant_present: authenticated SELECT ON tenants.status_plan_sheets
-- grant_present: authenticated INSERT ON tenants.status_plan_sheets
-- grant_present: authenticated DELETE ON tenants.status_plan_sheets
-- grant_absent: anon SELECT ON tenants.status_plan_sheets
-- grant_absent: anon EXECUTE ON tenants.status_plan_sheets_bind_parents()
-- grant_absent: anon EXECUTE ON tenants.tenant_plan_file_project(text)
-- grant_absent: anon EXECUTE ON tenants.status_plans_bind_parents()
-- grant_absent: anon EXECUTE ON tenants.status_plan_shapes_check_link()
-- sql: (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name = 'status_plans' AND column_name IN ('floor_plan_id', 'page_index', 'source_file_path'))
-- sql: (SELECT is_nullable = 'NO' FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name = 'status_plan_shapes' AND column_name = 'sheet_id')
-- sql: (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'tenants.status_plan_sheets'::regclass)
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'tenants.status_plan_sheets'::regclass AND polcmd IN ('r', '*') AND polname <> 'site_scope')
-- sql: (SELECT count(*) = 3 FROM pg_policy WHERE polrelid = 'tenants.status_plan_sheets'::regclass AND polpermissive = false AND polcmd IN ('a', 'w', 'd') AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) LIKE '%project_manager%' AND pg_get_expr(coalesce(polqual, polwithcheck), polrelid) NOT LIKE '%contractor%')
-- sql: (SELECT count(*) = 1 FROM storage.buckets WHERE id = 'tenant-plan-files' AND public = false AND file_size_limit = 52428800)
-- sql: (SELECT count(*) = 3 AND bool_and(cmd IN ('SELECT', 'INSERT', 'DELETE')) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'tenant\_plan\_files\_%')
-- sql: (SELECT strpos(coalesce(qual, ''), 'tenant-plan-files') > 0 AND strpos(coalesce(with_check, ''), 'tenant-plan-files') > 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'site_scope_objects')
-- sql: (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'tenants' AND table_name = 'status_plan_sheets' AND column_name IN ('colour', 'color', 'fill', 'status', 'area_m2', 'area_sqm'))
-- @verify:end

-- 0. Refuse to run over data ---------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants.status_plans) OR EXISTS (SELECT 1 FROM tenants.status_plan_shapes) THEN
    RAISE EXCEPTION 'tenant plans: tenants.status_plans already holds rows; this migration changes columns in place and has no data step'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- 1. Status plans: one per project per purpose, no drawing ----------------------

ALTER TABLE tenants.status_plans DROP CONSTRAINT IF EXISTS status_plans_drawing_page_purpose_key;
ALTER TABLE tenants.status_plans DROP CONSTRAINT IF EXISTS status_plans_page_positive;
ALTER TABLE tenants.status_plans DROP COLUMN IF EXISTS floor_plan_id;
ALTER TABLE tenants.status_plans DROP COLUMN IF EXISTS page_index;
ALTER TABLE tenants.status_plans DROP COLUMN IF EXISTS source_file_path;
ALTER TABLE tenants.status_plans ADD CONSTRAINT status_plans_project_purpose_key UNIQUE (project_id, purpose);

COMMENT ON TABLE tenants.status_plans IS
'A tenant plan: the tenant floor plan (purpose tenant_layout) or the line diagram (distribution_schematic) of a project, at most one of each. Its files are its sheets (tenants.status_plan_sheets). Holds no colour, status or area: those are computed at draw and render time from live tenant-schedule and order data. organisation_id is bound from the project by trigger; project and purpose are fixed.';

CREATE OR REPLACE FUNCTION tenants.status_plans_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'status_plans: the project and purpose of a plan are fixed' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'status_plans: project % not found', NEW.project_id USING ERRCODE = '23503';
  END IF;
  NEW.organisation_id := v_org;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := CASE WHEN NEW.created_by IS NULL THEN NULL ELSE OLD.created_by END;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plans_bind_parents() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plans_bind_parents ON tenants.status_plans;
CREATE TRIGGER status_plans_bind_parents
    BEFORE INSERT OR UPDATE ON tenants.status_plans
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plans_bind_parents();

-- 2. Sheets ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants.status_plan_sheets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_plan_id      UUID NOT NULL REFERENCES tenants.status_plans(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    sort_order          INTEGER NOT NULL,
    label               TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    page_index          INTEGER NOT NULL DEFAULT 1,
    file_name           TEXT NOT NULL,
    mime                TEXT NOT NULL,
    revision            INTEGER NOT NULL DEFAULT 1,
    replaced_at         TIMESTAMPTZ,
    replaced_from_path  TEXT,
    pixels_per_meter    NUMERIC,
    calibration_points  JSONB,
    calibration_metres  NUMERIC,
    created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT status_plan_sheets_plan_order_key UNIQUE (status_plan_id, sort_order),
    CONSTRAINT status_plan_sheets_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT status_plan_sheets_page_positive CHECK (page_index >= 1),
    CONSTRAINT status_plan_sheets_revision_positive CHECK (revision >= 1),
    CONSTRAINT status_plan_sheets_mime_check CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg')),
    CONSTRAINT status_plan_sheets_label_not_blank CHECK (length(btrim(label)) BETWEEN 1 AND 120),
    CONSTRAINT status_plan_sheets_file_name_not_blank CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
    CONSTRAINT status_plan_sheets_scale_positive CHECK (pixels_per_meter IS NULL OR pixels_per_meter > 0),
    CONSTRAINT status_plan_sheets_calibration_shape CHECK (CASE
      WHEN pixels_per_meter IS NULL THEN calibration_points IS NULL AND calibration_metres IS NULL
      WHEN calibration_metres IS NULL OR calibration_metres <= 0 THEN false
      WHEN calibration_points IS NULL OR jsonb_typeof(calibration_points) <> 'array' THEN false
      ELSE jsonb_array_length(calibration_points) = 4 AND NOT jsonb_path_exists(calibration_points, '$[*] ? (@.type() != "number")')
    END)
);

COMMENT ON TABLE tenants.status_plan_sheets IS
'One sheet of a tenant plan: one page (page_index) of one file in the tenant-plan-files bucket. A PDF of N pages is N sheets sharing a file. Replacing the file is an UPDATE of file_path; the trigger then sets revision + 1, replaced_at and replaced_from_path, and the shapes and scale are kept until someone re-anchors (replaced_at back to NULL). The scale (pixels_per_meter, from two calibration points and a distance) is per sheet.';

CREATE OR REPLACE FUNCTION tenants.status_plan_sheets_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project UUID;
  v_org     UUID;
  v_prefix  TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_plan_id IS DISTINCT FROM OLD.status_plan_id THEN
    RAISE EXCEPTION 'status_plan_sheets: a sheet cannot move to another plan' USING ERRCODE = '23514';
  END IF;

  SELECT sp.project_id, sp.organisation_id INTO v_project, v_org
    FROM tenants.status_plans sp
   WHERE sp.id = NEW.status_plan_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'status_plan_sheets: status plan % not found', NEW.status_plan_id USING ERRCODE = '23503';
  END IF;
  NEW.organisation_id := v_org;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.revision := 1;
    NEW.replaced_at := NULL;
    NEW.replaced_from_path := NULL;
  ELSE
    NEW.created_by := CASE WHEN NEW.created_by IS NULL THEN NULL ELSE OLD.created_by END;
    NEW.created_at := OLD.created_at;
    IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
      NEW.revision := OLD.revision + 1;
      NEW.replaced_at := now();
      NEW.replaced_from_path := OLD.file_path;
    ELSE
      NEW.revision := OLD.revision;
      NEW.replaced_from_path := OLD.replaced_from_path;
      NEW.page_index := OLD.page_index;
      NEW.mime := OLD.mime;
      NEW.file_name := OLD.file_name;
      NEW.replaced_at := CASE WHEN NEW.replaced_at IS NULL THEN NULL ELSE OLD.replaced_at END;
    END IF;
  END IF;

  v_prefix := v_org::text || '/' || v_project::text || '/' || NEW.status_plan_id::text || '/';
  IF NEW.file_path !~ ('^' || v_prefix || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,5}\.(pdf|png|jpg)$') THEN
    RAISE EXCEPTION 'status_plan_sheets: the file must be stored under this plan' USING ERRCODE = '23514';
  END IF;
  IF NOT ((NEW.mime = 'application/pdf' AND NEW.file_path ~ '\.pdf$')
       OR (NEW.mime = 'image/png' AND NEW.file_path ~ '\.png$')
       OR (NEW.mime = 'image/jpeg' AND NEW.file_path ~ '\.jpg$')) THEN
    RAISE EXCEPTION 'status_plan_sheets: the file type does not match its name' USING ERRCODE = '23514';
  END IF;
  IF NEW.mime <> 'application/pdf' AND NEW.page_index <> 1 THEN
    RAISE EXCEPTION 'status_plan_sheets: an image has one page' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.status_plan_sheets_bind_parents() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS status_plan_sheets_bind_parents ON tenants.status_plan_sheets;
CREATE TRIGGER status_plan_sheets_bind_parents
    BEFORE INSERT OR UPDATE ON tenants.status_plan_sheets
    FOR EACH ROW EXECUTE FUNCTION tenants.status_plan_sheets_bind_parents();

DROP TRIGGER IF EXISTS status_plan_sheets_updated_at ON tenants.status_plan_sheets;
CREATE TRIGGER status_plan_sheets_updated_at
    BEFORE UPDATE ON tenants.status_plan_sheets
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Shapes live on a sheet -------------------------------------------------------

ALTER TABLE tenants.status_plan_shapes
    ADD COLUMN IF NOT EXISTS sheet_id UUID NOT NULL REFERENCES tenants.status_plan_sheets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS status_plan_shapes_sheet_idx ON tenants.status_plan_shapes (sheet_id);

COMMENT ON COLUMN tenants.status_plan_shapes.sheet_id IS
'The sheet the shape is drawn on (image space of that sheet). Must belong to the shape''s plan and is fixed after creation. status_plan_id stays so a board appears at most once per plan across every sheet.';

CREATE OR REPLACE FUNCTION tenants.status_plan_shapes_check_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_project      UUID;
  v_purpose      TEXT;
  v_sheet_plan   UUID;
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
    SELECT s.status_plan_id INTO v_sheet_plan FROM tenants.status_plan_sheets s WHERE s.id = NEW.sheet_id;
    IF v_sheet_plan IS NULL THEN
      RAISE EXCEPTION 'status_plan_shapes: sheet % not found', NEW.sheet_id USING ERRCODE = '23503';
    END IF;
    IF v_sheet_plan IS DISTINCT FROM NEW.status_plan_id THEN
      RAISE EXCEPTION 'status_plan_shapes: that sheet belongs to another plan' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.status_plan_id IS DISTINCT FROM OLD.status_plan_id THEN
      RAISE EXCEPTION 'status_plan_shapes: a shape cannot move to another plan' USING ERRCODE = '23514';
    END IF;
    IF NEW.sheet_id IS DISTINCT FROM OLD.sheet_id THEN
      RAISE EXCEPTION 'status_plan_shapes: a shape cannot move to another sheet' USING ERRCODE = '23514';
    END IF;
    NEW.created_by := CASE WHEN NEW.created_by IS NULL THEN NULL ELSE OLD.created_by END;
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

-- 4. Row security: status_plan_sheets ----------------------------------------------

ALTER TABLE tenants.status_plan_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.status_plan_sheets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS status_plan_sheets_select ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_select ON tenants.status_plan_sheets FOR SELECT
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_insert ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_insert ON tenants.status_plan_sheets FOR INSERT
    TO authenticated
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_update ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_update ON tenants.status_plan_sheets FOR UPDATE
    TO authenticated
    USING      (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
    WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_delete ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_delete ON tenants.status_plan_sheets FOR DELETE
    TO authenticated
    USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

DROP POLICY IF EXISTS status_plan_sheets_insert_authz ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_insert_authz ON tenants.status_plan_sheets
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_sheets_update_authz ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_update_authz ON tenants.status_plan_sheets
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING      (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'))
    WITH CHECK (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS status_plan_sheets_delete_authz ON tenants.status_plan_sheets;
CREATE POLICY status_plan_sheets_delete_authz ON tenants.status_plan_sheets
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (COALESCE(public.user_effective_project_role(public.site_project_of_status_plan(status_plan_id)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS site_scope ON tenants.status_plan_sheets;
CREATE POLICY site_scope ON tenants.status_plan_sheets AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_status_plan(status_plan_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants.status_plan_sheets TO authenticated;
GRANT ALL ON tenants.status_plan_sheets TO service_role;
REVOKE ALL ON tenants.status_plan_sheets FROM anon;

-- 5. Files: the tenant-plan-files bucket ---------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-plan-files', 'tenant-plan-files', false, 52428800, ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION tenants.tenant_plan_file_project(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off' AS $$
DECLARE
  v_project UUID;
BEGIN
  IF p_name IS NULL OR p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,5}\.(pdf|png|jpg)$' THEN
    RETURN NULL;
  END IF;
  SELECT sp.project_id INTO v_project
    FROM tenants.status_plans sp
   WHERE sp.id = split_part(p_name, '/', 3)::uuid
     AND sp.project_id = split_part(p_name, '/', 2)::uuid
     AND sp.organisation_id = split_part(p_name, '/', 1)::uuid;
  RETURN v_project;
END $$;

REVOKE ALL ON FUNCTION tenants.tenant_plan_file_project(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION tenants.tenant_plan_file_project(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS tenant_plan_files_read ON storage.objects;
CREATE POLICY tenant_plan_files_read ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'tenant-plan-files'
           AND COALESCE(public.user_has_project_access(tenants.tenant_plan_file_project(name)), false));

DROP POLICY IF EXISTS tenant_plan_files_insert ON storage.objects;
CREATE POLICY tenant_plan_files_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'tenant-plan-files'
           AND COALESCE(public.user_effective_project_role(tenants.tenant_plan_file_project(name)), '') IN ('owner', 'admin', 'project_manager'));

DROP POLICY IF EXISTS tenant_plan_files_delete ON storage.objects;
CREATE POLICY tenant_plan_files_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'tenant-plan-files'
           AND COALESCE(public.user_effective_project_role(tenants.tenant_plan_file_project(name)), '') IN ('owner', 'admin', 'project_manager'));

-- 6. Storage site scope (generator text, byte for byte; adds tenant-plan-files) --------

DROP POLICY IF EXISTS site_scope_objects ON storage.objects;
CREATE POLICY site_scope_objects ON storage.objects AS RESTRICTIVE FOR ALL
  USING (CASE WHEN bucket_id IN ('drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos', 'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence', 'tenant-plan-files') THEN public.storage_site_access(bucket_id, name) ELSE true END)
  WITH CHECK (CASE WHEN bucket_id IN ('drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos', 'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence', 'tenant-plan-files') THEN public.storage_site_access(bucket_id, name) ELSE true END);

NOTIFY pgrst, 'reload schema';
```

Notes for the implementer:
- `ADD COLUMN … NOT NULL` with no default is legal only because the table is empty; section 0 guarantees that.
- Do not write `CREATE TABLE` text mentioning `floor_plan` anywhere in this file: the annotated-predicate contract test discovers drawing-anchored tables by that substring.
- The two `site_scope` statements must be copied from `scripts/db/site-scope/site_scoped_access.sql` (regenerated in B1), not re-typed. Diff them if Step 6 fails.

- [ ] **Step 5: Edit 00245's `@verify` block (rule 2)**

In `apps/edge-functions/supabase/migrations/00245_status_plans.sql`, delete exactly these four lines from the `@verify` block (nothing else in the file changes):

```sql
-- column: tenants.status_plans.page_index
-- column: tenants.status_plans.source_file_path
-- constraint: status_plans_page_positive ON tenants.status_plans
-- constraint: status_plans_drawing_page_purpose_key ON tenants.status_plans
```

Why: the post-push verifier re-checks every migration ≥ `00185` on every deploy. After 00249 those four objects no longer exist, so 00245's block would turn the deploy red even though everything applied. Task F7 Step 6 proves both directions (original block red under the new state, edited block green).

- [ ] **Step 6: Run the db contract tests**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db exec vitest run src/__tests__/security
```

Expected: PASS, including `tenant-plans-site-scope.contract.test.ts` (4) and the new `status_plans exemption is true` case.

- [ ] **Step 7: Run the web migration-hygiene contract**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
```

Expected: PASS, including `00249_tenant_plans.sql declares every table, view and function it creates` (one table, four functions).

- [ ] **Step 8: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00249_tenant_plans.sql apps/edge-functions/supabase/migrations/00245_status_plans.sql packages/db/src/__tests__/security/tenant-plans-site-scope.contract.test.ts packages/db/src/__tests__/security/floor-plan-annotated-predicate.contract.test.ts
git commit -m "feat(db): 00249 tenant plans: own sheets and bucket, plans no longer anchor to drawings

status_plans drops floor_plan_id/page_index/source_file_path and becomes one
per (project, purpose); status_plan_sheets holds each sheet's file, page,
revision, replaced flag and scale; shapes gain sheet_id with a sheet-in-plan
trigger. tenant-plan-files bucket with path-keyed RLS and site_scope_objects.
00245's @verify block loses the four directives naming dropped objects.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B3: Behavioural assertions for the new state

**Files:**
- Modify (rewrite): `scripts/db/assert-status-plans-roles.sql`

The old file seeds `floor_plan_id`, so it cannot run once 00249 is applied. It is rewritten to describe the state 00249 leaves (on top of 00245, which production already has). It is run in Task F7, not here: the dry-run harness needs network access and the Management API token.

- [ ] **Step 1: Replace the file**

Overwrite `scripts/db/assert-status-plans-roles.sql` with:

```sql
-- BEHAVIOURAL assertions for status plans after 00249 (tenant plans), run as real roles.
--
--   red:   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-status-plans-roles.sql
--   green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00249_tenant_plans.sql scripts/db/assert-status-plans-roles.sql
--
-- 00245 is already applied on production; this file describes the state that
-- 00249 leaves on top of it: plans per (project, purpose), sheets with their
-- own files in tenant-plan-files, shapes on sheets.
--
-- Mechanics this project has paid for:
--   * set_config('request.jwt.claims', ..., true) is transaction-local and
--     outlives RESET ROLE, so the claim is cleared before later postgres-path
--     writes that must not be stamped with a person.
--   * UPDATE needs SELECT visibility: refused UPDATEs are probed on rows the
--     caller CAN read, so a zero is the write gate, not the read policy.
--   * Every refused-write probe that could wrongly SUCCEED runs in a sub-block
--     ending in SQLSTATE ZZ001, so a broken gate cannot delete a fixture and
--     abort the rest of the file.
--   * The site-scope probe is an active project PM whose organisation
--     membership LAPSED: the role helper still admits them, project access
--     does not (fixture row proves both).
--   * storage.allow_delete_query lifts the storage API's delete guard so the
--     DELETE policies decide (as in assert-load-profile-rls.sql).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_project        UUID;
  v_org            UUID;
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
  v_sheet1         UUID := gen_random_uuid();
  v_sheet2         UUID := gen_random_uuid();
  v_ssheet         UUID := gen_random_uuid();
  v_lprefix        TEXT;
  v_sprefix        TEXT;
  v_path1          TEXT;
  v_path1b         TEXT;
  v_shape          UUID;
  v_shape2         UUID;
  v_n              INT;
  v_int            INT;
  v_txt            TEXT;
  v_uuid           UUID;
  v_uuid2          UUID;
  v_ts             TIMESTAMPTZ;
  v_num            NUMERIC;
BEGIN
  -- ── Fixtures (postgres path, no claims) ─────────────────────────────────
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm
   WHERE pm.role = 'contractor' AND pm.is_active
     AND EXISTS (SELECT 1 FROM public.user_organisations uo
                  WHERE uo.user_id = pm.user_id AND uo.role = 'contractor' AND uo.is_active)
     AND NOT EXISTS (SELECT 1 FROM tenants.status_plans sp WHERE sp.project_id = pm.project_id)
   LIMIT 1;
  IF v_contractor IS NULL THEN RAISE EXCEPTION 'fixture: no contractor on a project without status plans'; END IF;

  SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = v_project;
  SELECT p.id, p.organisation_id INTO v_other_project, v_other_proj_org
    FROM projects.projects p WHERE p.id <> v_project LIMIT 1;
  SELECT o.id INTO v_other_org FROM public.organisations o WHERE o.id <> v_org LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-tp-pm@example.invalid',     '', now(), now(), now(), '{}', '{}'),
         (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-tp-client@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_lapsed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-tp-lapsed@example.invalid', '', now(), now(), now(), '{}', '{}');
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
  VALUES (v_pm, v_org, 'project_manager', TRUE),
         (v_client, v_org, 'client_viewer', TRUE),
         (v_lapsed, v_org, 'project_manager', FALSE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_project, v_pm, v_org, 'project_manager', TRUE),
         (v_project, v_client, v_org, 'client_viewer', TRUE),
         (v_project, v_lapsed, v_org, 'project_manager', TRUE);

  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZTP-T1', 'ZZTP-1', 'Probe Lantern') RETURNING id INTO v_t1;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZTP-T2', 'ZZTP-2', 'Probe Kettle') RETURNING id INTO v_t2;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name, deleted_at)
  VALUES (v_project, v_org, 'tenant_db', 'ZZTP-T3', 'ZZTP-3', 'Probe Gone', now()) RETURNING id INTO v_t3_deleted;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  VALUES (v_project, v_org, 'main_board', 'ZZTP-MB', 'Probe Main Board') RETURNING id INTO v_mb;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_other_project, v_other_proj_org, 'tenant_db', 'ZZTP-FX', 'ZZTP-9', 'Probe Elsewhere') RETURNING id INTO v_foreign;

  -- The line diagram and its sheet are seeded on the postgres path; the PM
  -- creates the floor plan below, so its bindings are tested as a person.
  INSERT INTO tenants.status_plans (project_id, organisation_id, purpose, name)
  VALUES (v_project, v_org, 'distribution_schematic', 'ZZ probe line diagram') RETURNING id INTO v_schematic;
  v_sprefix := v_org::text || '/' || v_project::text || '/' || v_schematic::text || '/';
  INSERT INTO tenants.status_plan_sheets (id, status_plan_id, organisation_id, sort_order, label, file_path, page_index, file_name, mime)
  VALUES (v_ssheet, v_schematic, v_org, 0, 'Sheet 1 of 1', v_sprefix || v_ssheet::text || '/1.pdf', 1, 'zz-300.pdf', 'application/pdf');

  -- ═══ 1. PROJECT MANAGER (ORG_WRITE_ROLES) ═══════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_pm_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND public.user_has_project_access(v_project));

  -- Plans
  BEGIN
    INSERT INTO tenants.status_plans (project_id, organisation_id, purpose, name, created_by)
    VALUES (v_project, v_other_org, 'tenant_layout', 'ZZ probe floor plan', v_contractor)
    RETURNING id INTO v_layout;
    INSERT INTO _r VALUES ('pm_plan_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_plan_insert_ok', false);
  END;
  SELECT organisation_id, created_by INTO v_uuid, v_uuid2 FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('pm_plan_org_bound_from_project', v_uuid = v_org);
  INSERT INTO _r VALUES ('pm_plan_created_by_is_caller', v_uuid2 = v_pm);

  BEGIN
    INSERT INTO tenants.status_plans (project_id, purpose, name) VALUES (v_project, 'tenant_layout', 'Second floor plan');
    INSERT INTO _r VALUES ('pm_plan_one_per_purpose', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_plan_one_per_purpose', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_one_per_purpose', false);
  END;

  BEGIN
    UPDATE tenants.status_plans SET purpose = 'distribution_schematic' WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_purpose_fixed', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_purpose_fixed', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_purpose_fixed', false);
  END;

  BEGIN
    UPDATE tenants.status_plans SET project_id = v_other_project WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_project_fixed', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_project_fixed', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_project_fixed', false);
  END;

  UPDATE tenants.status_plans SET name = 'ZZ probe floor plan renamed' WHERE id = v_layout;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_plan_rename_ok', v_n = 1);

  v_lprefix := v_org::text || '/' || v_project::text || '/' || v_layout::text || '/';
  v_path1 := v_lprefix || v_sheet1::text || '/1.pdf';

  -- Files
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_path1, v_pm);
    INSERT INTO _r VALUES ('pm_file_upload_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_file_upload_ok', false);
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('tenant-plan-files', v_org::text || '/' || v_project::text || '/' || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '/1.pdf', v_pm);
    INSERT INTO _r VALUES ('pm_file_upload_unknown_plan_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_upload_unknown_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_upload_unknown_plan_refused', false);
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/1.exe', v_pm);
    INSERT INTO _r VALUES ('pm_file_upload_bad_name_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_upload_bad_name_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_upload_bad_name_refused', false);
  END;

  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('pm_file_read_ok', v_n = 1);

  -- Sheets
  BEGIN
    INSERT INTO tenants.status_plan_sheets (id, status_plan_id, organisation_id, sort_order, label, file_path, page_index, file_name, mime,
                                            revision, replaced_at, replaced_from_path, created_by)
    VALUES (v_sheet1, v_layout, v_other_org, 0, 'Sheet 1 of 2', v_path1, 1, 'zz-100.pdf', 'application/pdf',
            7, now(), 'forged.pdf', v_contractor);
    INSERT INTO _r VALUES ('pm_sheet_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_sheet_insert_ok', false);
  END;
  SELECT organisation_id, revision, replaced_at, replaced_from_path, created_by
    INTO v_uuid, v_int, v_ts, v_txt, v_uuid2
    FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  INSERT INTO _r VALUES ('pm_sheet_org_bound_from_plan', v_uuid = v_org);
  INSERT INTO _r VALUES ('pm_sheet_starts_at_revision_1_unreplaced', v_int = 1 AND v_ts IS NULL AND v_txt IS NULL);
  INSERT INTO _r VALUES ('pm_sheet_created_by_is_caller', v_uuid2 = v_pm);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (id, status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_sheet2, v_layout, 1, 'Sheet 2 of 2', v_path1, 2, 'zz-100.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_second_sheet_same_file_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_second_sheet_same_file_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 1, 'Clash', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'clash.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_duplicate_position_refused', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_sheet_duplicate_position_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_duplicate_position_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 2, 'Borrowed', v_sprefix || gen_random_uuid()::text || '/1.pdf', 1, 'b.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_path_of_another_plan_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_plan_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 3, 'Elsewhere', v_org::text || '/' || v_other_project::text || '/' || v_layout::text || '/' || gen_random_uuid()::text || '/1.pdf', 1, 'e.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_path_of_another_project_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_project_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_project_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 4, 'Mislabelled', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'm.png', 'image/png');
    INSERT INTO _r VALUES ('pm_sheet_mime_must_match_file', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_mime_must_match_file', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_mime_must_match_file', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 5, 'Image page 2', v_lprefix || gen_random_uuid()::text || '/1.png', 2, 'i.png', 'image/png');
    INSERT INTO _r VALUES ('pm_sheet_image_has_one_page', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_image_has_one_page', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_image_has_one_page', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 6, '   ', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'blank.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_blank_label_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_blank_label_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_blank_label_refused', false);
  END;

  BEGIN
    UPDATE tenants.status_plan_sheets SET pixels_per_meter = 10 WHERE id = v_sheet2;
    INSERT INTO _r VALUES ('pm_sheet_half_scale_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_half_scale_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_half_scale_refused', false);
  END;

  UPDATE tenants.status_plan_sheets
     SET pixels_per_meter = 20, calibration_points = '[0,0,100,0]'::jsonb, calibration_metres = 5
   WHERE id = v_sheet1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_sheet_calibrate_ok', v_n = 1);

  -- Replace: the trigger, not the client, decides revision, flag and old path.
  v_path1b := v_lprefix || v_sheet1::text || '/2.pdf';
  UPDATE tenants.status_plan_sheets
     SET file_path = v_path1b, revision = 99, replaced_from_path = 'forged.pdf', replaced_at = NULL
   WHERE id = v_sheet1;
  SELECT revision, replaced_at, replaced_from_path, pixels_per_meter INTO v_int, v_ts, v_txt, v_num
    FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  INSERT INTO _r VALUES ('pm_sheet_replace_bumps_revision', v_int = 2);
  INSERT INTO _r VALUES ('pm_sheet_replace_flags_and_remembers_old_file', v_ts IS NOT NULL AND v_txt = v_path1);
  INSERT INTO _r VALUES ('pm_sheet_replace_keeps_scale', v_num = 20);

  UPDATE tenants.status_plan_sheets SET page_index = 5 WHERE id = v_sheet2;
  SELECT page_index INTO v_int FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('pm_sheet_page_needs_a_new_file', v_int = 2);

  UPDATE tenants.status_plan_sheets SET replaced_at = now() WHERE id = v_sheet2;
  SELECT replaced_at INTO v_ts FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('pm_sheet_replaced_flag_cannot_be_forged', v_ts IS NULL);

  UPDATE tenants.status_plan_sheets SET replaced_at = NULL WHERE id = v_sheet1;
  SELECT replaced_at, revision INTO v_ts, v_int FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  INSERT INTO _r VALUES ('pm_sheet_reanchor_clears_flag', v_ts IS NULL AND v_int = 2);

  BEGIN
    UPDATE tenants.status_plan_sheets SET status_plan_id = v_schematic WHERE id = v_sheet2;
    INSERT INTO _r VALUES ('pm_sheet_cannot_move_plan', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_cannot_move_plan', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_cannot_move_plan', false);
  END;

  -- Shapes
  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[10,10,200,10,200,120,10,120]'::jsonb, v_t1)
    RETURNING id INTO v_shape;
    INSERT INTO _r VALUES ('pm_shape_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_insert_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet2, 'polygon', '[0,0,50,0,50,50]'::jsonb, v_t1);
    INSERT INTO _r VALUES ('pm_node_once_across_sheets', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_node_once_across_sheets', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_node_once_across_sheets', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points)
    VALUES (v_layout, v_ssheet, 'polygon', '[0,0,50,0,50,50]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_sheet_of_another_plan_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_sheet_of_another_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_sheet_of_another_plan_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet2, 'polygon', '[300,10,420,10,420,90,300,90]'::jsonb, v_t2)
    RETURNING id INTO v_shape2;
    INSERT INTO _r VALUES ('pm_shape_on_second_sheet_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_on_second_sheet_ok', false);
  END;

  BEGIN
    UPDATE tenants.status_plan_shapes SET sheet_id = v_sheet2 WHERE id = v_shape;
    INSERT INTO _r VALUES ('pm_shape_cannot_move_sheet', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_cannot_move_sheet', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_cannot_move_sheet', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_foreign);
    INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t3_deleted);
    INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_mb);
    INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id, source, detected_tag)
    VALUES (v_schematic, v_ssheet, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, v_mb, 'detected', 'MB-9.9');
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, area_type)
    VALUES (v_schematic, v_ssheet, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, 'common');
    INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  END;

  RESET ROLE;

  -- ═══ 2. CONTRACTOR (reads, never writes) ════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_contractor_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'contractor'
    AND public.user_has_project_access(v_project));

  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('contractor_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id = v_layout;
  INSERT INTO _r VALUES ('contractor_reads_sheets', v_n = 2);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('contractor_reads_shape', v_n = 1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('contractor_reads_file', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 9, 'Contractor sheet', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'c.pdf', 'application/pdf');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_sheet_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_sheet_insert_refused', false);
  END;

  v_n := NULL;
  BEGIN
    UPDATE tenants.status_plan_sheets SET label = 'x' WHERE id = v_sheet2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('contractor_sheet_update_affects_nothing', v_n = 0);

  v_n := NULL;
  BEGIN
    DELETE FROM tenants.status_plan_sheets WHERE id = v_sheet2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('contractor_sheet_delete_affects_nothing', v_n = 0);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, area_type)
    VALUES (v_layout, v_sheet2, 'polygon', '[0,0,5,0,5,5]'::jsonb, 'vacant');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', false);
  END;

  v_n := NULL;
  BEGIN
    UPDATE tenants.status_plans SET name = 'x' WHERE id = v_layout;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('contractor_plan_update_affects_nothing', v_n = 0);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/1.pdf', v_contractor);
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_file_upload_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_file_upload_refused', false);
  END;

  RESET ROLE;

  -- ═══ 3. CLIENT VIEWER (reads, never writes) ═════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_client_role', COALESCE(public.user_effective_project_role(v_project), '') = 'client_viewer');
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('client_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id = v_layout;
  INSERT INTO _r VALUES ('client_reads_sheets', v_n = 2);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('client_reads_shape', v_n = 1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('client_reads_file', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 10, 'Client sheet', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'c.pdf', 'application/pdf');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_sheet_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_sheet_insert_refused', false);
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/1.pdf', v_client);
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_file_upload_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_file_upload_refused', false);
  END;

  RESET ROLE;

  -- ═══ 4. LAPSED PM (only site scope / project access stops them) ═════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lapsed::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_lapsed_probe_is_the_right_person',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND NOT public.user_has_project_access(v_project));
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_sees_no_plan', v_n = 0);
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('lapsed_sees_no_sheet', v_n = 0);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('lapsed_sees_no_shape', v_n = 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('lapsed_sees_no_file', v_n = 0);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 11, 'Lapsed sheet', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'l.pdf', 'application/pdf');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_sheet_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_sheet_insert_refused', false);
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ 5. SERVICE ROLE (report, Export sheet and portal read through it) ═══
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('service_role_sees_sheets', v_n = 3);
  RESET ROLE;

  -- ═══ 6. ANON (refused at the grant) ═════════════════════════════════════
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM tenants.status_plan_sheets LIMIT 1;
    INSERT INTO _r VALUES ('anon_sheets_table_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_sheets_table_refused', true);
  END;
  BEGIN
    PERFORM tenants.tenant_plan_file_project(v_path1);
    INSERT INTO _r VALUES ('anon_file_project_fn_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_file_project_fn_refused', true);
  END;
  RESET ROLE;

  -- ═══ 7. STORAGE DELETE (the policies decide) ════════════════════════════
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_file_delete_affects_nothing', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_file_delete_ok', v_n = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ 8. Cascades and unlinking (postgres path) ══════════════════════════
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE sheet_id = v_sheet1;
  INSERT INTO _r VALUES ('fx_sheet1_has_a_shape', v_n = 1);
  DELETE FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('sheet_delete_cascades_its_shapes', v_n = 0);

  DELETE FROM structure.nodes WHERE id = v_t2;
  SELECT node_id INTO v_uuid FROM tenants.status_plan_shapes WHERE id = v_shape2;
  INSERT INTO _r VALUES ('node_hard_delete_unlinks_shape',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plan_shapes WHERE id = v_shape2));

  -- ═══ 9. Deleting the author clears created_by (FK SET NULL survives the triggers)
  SELECT created_by INTO v_uuid FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('fx_sheet2_stamped', v_uuid = v_pm);
  DELETE FROM auth.users WHERE id = v_pm;
  SELECT created_by INTO v_uuid FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('author_delete_clears_plan_created_by',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plans WHERE id = v_layout));
  SELECT created_by INTO v_uuid FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('author_delete_clears_sheet_created_by',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plan_sheets WHERE id = v_sheet2));
END $$;

SELECT * FROM (VALUES
  ('FIXTURE: PM resolves to project_manager with project access',      (SELECT v FROM _r WHERE k='fx_pm_role')),
  ('FIXTURE: contractor resolves to contractor with project access',   (SELECT v FROM _r WHERE k='fx_contractor_role')),
  ('FIXTURE: client viewer resolves to client_viewer',                 (SELECT v FROM _r WHERE k='fx_client_role')),
  ('FIXTURE: lapsed PM passes the role helper, fails project access',  (SELECT v FROM _r WHERE k='fx_lapsed_probe_is_the_right_person')),
  ('FIXTURE: sheet 1 carries a shape before it is deleted',            (SELECT v FROM _r WHERE k='fx_sheet1_has_a_shape')),
  ('FIXTURE: sheet 2 is stamped with its author before the delete',    (SELECT v FROM _r WHERE k='fx_sheet2_stamped')),
  ('PM creates the floor plan',                                        (SELECT v FROM _r WHERE k='pm_plan_insert_ok')),
  ('plan organisation is bound from the project (wrong value discarded)', (SELECT v FROM _r WHERE k='pm_plan_org_bound_from_project')),
  ('plan created_by is the caller, not the supplied id',               (SELECT v FROM _r WHERE k='pm_plan_created_by_is_caller')),
  ('one plan per project per purpose',                                 (SELECT v FROM _r WHERE k='pm_plan_one_per_purpose')),
  ('a plan''s purpose is fixed',                                       (SELECT v FROM _r WHERE k='pm_plan_purpose_fixed')),
  ('a plan''s project is fixed',                                       (SELECT v FROM _r WHERE k='pm_plan_project_fixed')),
  ('PM renames a plan',                                                (SELECT v FROM _r WHERE k='pm_plan_rename_ok')),
  ('PM uploads a file under the plan''s folder',                       (SELECT v FROM _r WHERE k='pm_file_upload_ok')),
  ('a file under a plan that does not exist is refused',               (SELECT v FROM _r WHERE k='pm_file_upload_unknown_plan_refused')),
  ('a file with a name outside the pattern is refused',                (SELECT v FROM _r WHERE k='pm_file_upload_bad_name_refused')),
  ('PM reads the file',                                                (SELECT v FROM _r WHERE k='pm_file_read_ok')),
  ('PM adds a sheet',                                                  (SELECT v FROM _r WHERE k='pm_sheet_insert_ok')),
  ('sheet organisation is bound from the plan',                        (SELECT v FROM _r WHERE k='pm_sheet_org_bound_from_plan')),
  ('a new sheet starts at revision 1, not replaced (client values discarded)', (SELECT v FROM _r WHERE k='pm_sheet_starts_at_revision_1_unreplaced')),
  ('sheet created_by is the caller',                                   (SELECT v FROM _r WHERE k='pm_sheet_created_by_is_caller')),
  ('a second sheet may be page 2 of the same file',                    (SELECT v FROM _r WHERE k='pm_second_sheet_same_file_ok')),
  ('two sheets cannot share a position',                               (SELECT v FROM _r WHERE k='pm_sheet_duplicate_position_refused')),
  ('a sheet cannot point at another plan''s folder',                   (SELECT v FROM _r WHERE k='pm_sheet_path_of_another_plan_refused')),
  ('a sheet cannot point at another project''s folder',                (SELECT v FROM _r WHERE k='pm_sheet_path_of_another_project_refused')),
  ('a sheet''s type must match its file',                              (SELECT v FROM _r WHERE k='pm_sheet_mime_must_match_file')),
  ('an image sheet is page 1',                                         (SELECT v FROM _r WHERE k='pm_sheet_image_has_one_page')),
  ('a blank sheet label is refused',                                   (SELECT v FROM _r WHERE k='pm_sheet_blank_label_refused')),
  ('a scale without its points and distance is refused',               (SELECT v FROM _r WHERE k='pm_sheet_half_scale_refused')),
  ('PM sets a sheet''s scale',                                         (SELECT v FROM _r WHERE k='pm_sheet_calibrate_ok')),
  ('replacing the file bumps the revision by exactly one',             (SELECT v FROM _r WHERE k='pm_sheet_replace_bumps_revision')),
  ('replacing flags the sheet and remembers the old file',             (SELECT v FROM _r WHERE k='pm_sheet_replace_flags_and_remembers_old_file')),
  ('replacing keeps the scale',                                        (SELECT v FROM _r WHERE k='pm_sheet_replace_keeps_scale')),
  ('the page changes only together with the file',                     (SELECT v FROM _r WHERE k='pm_sheet_page_needs_a_new_file')),
  ('the replaced flag cannot be set by hand',                          (SELECT v FROM _r WHERE k='pm_sheet_replaced_flag_cannot_be_forged')),
  ('re-anchoring clears the flag and keeps the revision',              (SELECT v FROM _r WHERE k='pm_sheet_reanchor_clears_flag')),
  ('a sheet cannot move to another plan',                              (SELECT v FROM _r WHERE k='pm_sheet_cannot_move_plan')),
  ('PM masks a shop on a sheet',                                       (SELECT v FROM _r WHERE k='pm_shape_insert_ok')),
  ('a board appears once per plan, across sheets',                     (SELECT v FROM _r WHERE k='pm_node_once_across_sheets')),
  ('a shape''s sheet must belong to its plan',                         (SELECT v FROM _r WHERE k='pm_shape_sheet_of_another_plan_refused')),
  ('PM masks another shop on the second sheet',                        (SELECT v FROM _r WHERE k='pm_shape_on_second_sheet_ok')),
  ('a shape cannot move to another sheet',                             (SELECT v FROM _r WHERE k='pm_shape_cannot_move_sheet')),
  ('a board from another project is refused',                          (SELECT v FROM _r WHERE k='pm_shape_foreign_node_refused')),
  ('a soft-deleted board is refused',                                  (SELECT v FROM _r WHERE k='pm_shape_soft_deleted_node_refused')),
  ('a floor plan refuses a main board',                                (SELECT v FROM _r WHERE k='pm_shape_main_board_on_layout_refused')),
  ('a line diagram accepts a main board (detected)',                   (SELECT v FROM _r WHERE k='pm_shape_main_board_on_schematic_ok')),
  ('a line diagram refuses an area type',                              (SELECT v FROM _r WHERE k='pm_shape_area_on_schematic_refused')),
  ('contractor reads the plan',                                        (SELECT v FROM _r WHERE k='contractor_reads_plan')),
  ('contractor reads the sheets',                                      (SELECT v FROM _r WHERE k='contractor_reads_sheets')),
  ('contractor reads the shape',                                       (SELECT v FROM _r WHERE k='contractor_reads_shape')),
  ('contractor reads the file',                                        (SELECT v FROM _r WHERE k='contractor_reads_file')),
  ('RESTRICTIVE gate bites: contractor sheet insert refused 42501',    (SELECT v FROM _r WHERE k='contractor_sheet_insert_refused')),
  ('contractor update of a readable sheet affects nothing',            (SELECT v FROM _r WHERE k='contractor_sheet_update_affects_nothing')),
  ('contractor delete of a readable sheet affects nothing',            (SELECT v FROM _r WHERE k='contractor_sheet_delete_affects_nothing')),
  ('contractor shape insert refused 42501',                            (SELECT v FROM _r WHERE k='contractor_shape_insert_refused')),
  ('contractor update of a readable plan affects nothing',             (SELECT v FROM _r WHERE k='contractor_plan_update_affects_nothing')),
  ('contractor file upload refused',                                   (SELECT v FROM _r WHERE k='contractor_file_upload_refused')),
  ('client viewer reads the plan',                                     (SELECT v FROM _r WHERE k='client_reads_plan')),
  ('client viewer reads the sheets',                                   (SELECT v FROM _r WHERE k='client_reads_sheets')),
  ('client viewer reads the shape',                                    (SELECT v FROM _r WHERE k='client_reads_shape')),
  ('client viewer reads the file',                                     (SELECT v FROM _r WHERE k='client_reads_file')),
  ('client viewer sheet insert refused',                               (SELECT v FROM _r WHERE k='client_sheet_insert_refused')),
  ('client viewer file upload refused',                                (SELECT v FROM _r WHERE k='client_file_upload_refused')),
  ('site scope: lapsed PM sees no plan',                               (SELECT v FROM _r WHERE k='lapsed_sees_no_plan')),
  ('site scope: lapsed PM sees no sheet',                              (SELECT v FROM _r WHERE k='lapsed_sees_no_sheet')),
  ('site scope: lapsed PM sees no shape',                              (SELECT v FROM _r WHERE k='lapsed_sees_no_shape')),
  ('site scope: lapsed PM sees no file',                               (SELECT v FROM _r WHERE k='lapsed_sees_no_file')),
  ('site scope: lapsed PM sheet insert refused',                       (SELECT v FROM _r WHERE k='lapsed_sheet_insert_refused')),
  ('service role sees every sheet (renderers are not blind)',          (SELECT v FROM _r WHERE k='service_role_sees_sheets')),
  ('anon refused on the sheets table',                                 (SELECT v FROM _r WHERE k='anon_sheets_table_refused')),
  ('anon refused on the file-path function',                           (SELECT v FROM _r WHERE k='anon_file_project_fn_refused')),
  ('contractor file delete affects nothing',                           (SELECT v FROM _r WHERE k='contractor_file_delete_affects_nothing')),
  ('PM deletes a file',                                                (SELECT v FROM _r WHERE k='pm_file_delete_ok')),
  ('deleting a sheet deletes its shapes',                              (SELECT v FROM _r WHERE k='sheet_delete_cascades_its_shapes')),
  ('hard-deleting a board unlinks its shape and keeps the shape',      (SELECT v FROM _r WHERE k='node_hard_delete_unlinks_shape')),
  ('deleting the author clears the plan''s created_by, keeps the plan',  (SELECT v FROM _r WHERE k='author_delete_clears_plan_created_by')),
  ('deleting the author clears the sheet''s created_by, keeps the sheet', (SELECT v FROM _r WHERE k='author_delete_clears_sheet_created_by'))
) AS t("check", ok);
```

That is **77** rows. Check before committing:

```bash
grep -c "(SELECT v FROM _r WHERE k='" scripts/db/assert-status-plans-roles.sql
grep -o "INSERT INTO _r VALUES ('[a-z0-9_]*'" scripts/db/assert-status-plans-roles.sql | sort -u | wc -l
```

Expected: `77` and `77` (every key written is reported, every key reported is written).

- [ ] **Step 2: Commit**

```bash
git add scripts/db/assert-status-plans-roles.sql
git commit -m "test(db): status plan assertions for the tenant plans state (sheets, files, storage RLS)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B4: Hand-edit the DB types

**Files:**
- Modify: `packages/db/src/types.ts` (the `tenants` schema)

- [ ] **Step 1: `status_plan_shapes` gains `sheet_id`**

In the `status_plan_shapes` block: add `sheet_id: string` to `Row` (between `shape` and `source`), `sheet_id: string` to `Insert` (same place), `sheet_id?: string` to `Update`, and add this relationship after the existing one:

```ts
          {
            foreignKeyName: "status_plan_shapes_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "status_plan_sheets"
            referencedColumns: ["id"]
          },
```

- [ ] **Step 2: Insert the `status_plan_sheets` block**

Directly after the closing `}` of `status_plan_shapes` (alphabetical: `status_plan_shapes` < `status_plan_sheets` < `status_plans`), insert:

```ts
      status_plan_sheets: {
        Row: {
          calibration_metres: number | null
          calibration_points: Json | null
          created_at: string
          created_by: string | null
          file_name: string
          file_path: string
          id: string
          label: string
          mime: string
          organisation_id: string
          page_index: number
          pixels_per_meter: number | null
          replaced_at: string | null
          replaced_from_path: string | null
          revision: number
          sort_order: number
          status_plan_id: string
          updated_at: string
        }
        Insert: {
          calibration_metres?: number | null
          calibration_points?: Json | null
          created_at?: string
          /** Hand-patched optional: bound to auth.uid() by trigger (00249). */
          created_by?: string | null
          file_name: string
          file_path: string
          id?: string
          label: string
          mime: string
          /** Hand-patched optional: bound from the plan by trigger (00249). */
          organisation_id?: string
          page_index?: number
          pixels_per_meter?: number | null
          replaced_at?: string | null
          replaced_from_path?: string | null
          revision?: number
          sort_order: number
          status_plan_id: string
          updated_at?: string
        }
        Update: {
          calibration_metres?: number | null
          calibration_points?: Json | null
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_path?: string
          id?: string
          label?: string
          mime?: string
          organisation_id?: string
          page_index?: number
          pixels_per_meter?: number | null
          replaced_at?: string | null
          replaced_from_path?: string | null
          revision?: number
          sort_order?: number
          status_plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_plan_sheets_status_plan_id_fkey"
            columns: ["status_plan_id"]
            isOneToOne: false
            referencedRelation: "status_plans"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 3: Replace the `status_plans` block**

Replace the whole `status_plans: { … }` block (Row / Insert / Update / Relationships) with:

```ts
      status_plans: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organisation_id: string
          project_id: string
          purpose: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          /** Hand-patched optional: bound to auth.uid() by trigger (00245/00249). */
          created_by?: string | null
          id?: string
          name: string
          /** Hand-patched optional: bound from the project by trigger (00249). */
          organisation_id?: string
          project_id: string
          purpose: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organisation_id?: string
          project_id?: string
          purpose?: string
          updated_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 4: Type-check**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db type-check
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): hand-edit types for tenant plans (00249)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B5: Shared types — labels, sheet constants, row shapes

**Files:**
- Modify: `packages/shared/src/status-plans/types.ts`
- Modify: `packages/shared/src/status-plans/types.test.ts`

- [ ] **Step 1: Write the failing tests**

In `types.test.ts`:

1. Extend the import list with `PURPOSE_LABEL, DEFAULT_PLAN_NAME, TENANT_PLAN_BUCKET, TENANT_PLAN_MAX_BYTES, TENANT_PLAN_MIMES, SHEET_LABEL_MAX, type StatusPlanSheetRow`.
2. Replace the `it('maps a plan row', …)` case with:

```ts
  it('maps a plan row', () => {
    const row: StatusPlanRow = {
      id: 'sp-1', project_id: 'p-1', organisation_id: 'o-1', purpose: 'tenant_layout', name: 'Floor plan',
      created_by: 'u-1', created_at: '2026-10-12T08:00:00Z', updated_at: '2026-10-12T09:00:00Z',
    }
    expect(statusPlanFromRow(row)).toEqual({
      id: 'sp-1', projectId: 'p-1', organisationId: 'o-1', purpose: 'tenant_layout', name: 'Floor plan',
      createdBy: 'u-1', createdAt: '2026-10-12T08:00:00Z', updatedAt: '2026-10-12T09:00:00Z',
    })
  })
```

3. In `it('maps a shape row and coerces points to numbers', …)` add `sheet_id: 'sh-1',` to the row and `sheetId: 'sh-1',` to the expectation (after `statusPlanId`). Add `sheet_id: 'sh-1',` to the row in `refuses a shape row whose points…`.
4. Append at the end of the file:

```ts
describe('tenant plan constants', () => {
  function tenantPlansSql(): string {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_tenant_plans\.sql$/.test(f))
    expect(files).toHaveLength(1)
    return readFileSync(new URL(files[0]!, MIGRATIONS_DIR), 'utf8')
  }

  it('the two tools are named as the owner names them', () => {
    expect(PURPOSE_LABEL).toEqual({ tenant_layout: 'Tenant floor plan', distribution_schematic: 'Line diagram' })
    expect(DEFAULT_PLAN_NAME).toEqual({ tenant_layout: 'Floor plan', distribution_schematic: 'Line diagram' })
  })

  it('bucket, size limit and file types mirror the migration', () => {
    const sql = tenantPlansSql()
    expect(TENANT_PLAN_BUCKET).toBe('tenant-plan-files')
    expect(sql).toContain(`VALUES ('${TENANT_PLAN_BUCKET}', '${TENANT_PLAN_BUCKET}', false, ${TENANT_PLAN_MAX_BYTES}, ARRAY[${TENANT_PLAN_MIMES.map((m) => `'${m}'`).join(', ')}])`)
    const mimeLine = sql.split('\n').find((l) => l.includes('CONSTRAINT status_plan_sheets_mime_check CHECK'))!
    expect([...TENANT_PLAN_MIMES].sort()).toEqual([...mimeLine.matchAll(/'([a-z]+\/[a-z]+)'/g)].map((m) => m[1]!).sort())
    expect(TENANT_PLAN_MAX_BYTES).toBe(50 * 1024 * 1024)
  })

  it('the label cap mirrors the CHECK', () => {
    const line = tenantPlansSql().split('\n').find((l) => l.includes('CONSTRAINT status_plan_sheets_label_not_blank CHECK'))!
    expect(Number(line.match(/BETWEEN 1 AND (\d+)/)![1])).toBe(SHEET_LABEL_MAX)
  })

  it('a sheet row type carries every column the migration creates', () => {
    const row: StatusPlanSheetRow = {
      id: 'sh', status_plan_id: 'sp', organisation_id: 'o', sort_order: 0, label: 'Sheet 1 of 1',
      file_path: 'o/p/sp/sh/1.pdf', page_index: 1, file_name: 'a.pdf', mime: 'application/pdf', revision: 1,
      replaced_at: null, replaced_from_path: null, pixels_per_meter: null, calibration_points: null,
      calibration_metres: null, created_by: null, created_at: 't', updated_at: 't',
    }
    const created = tenantPlansSql().split('CREATE TABLE IF NOT EXISTS tenants.status_plan_sheets (')[1]!.split(');')[0]!
    const columns = [...created.matchAll(/^\s{4}([a-z_]+)\s+[A-Z]/gm)].map((m) => m[1]!)
    expect(Object.keys(row).sort()).toEqual(columns.sort())
  })
})
```

The mime list is read with its own regex: the existing `checkList` helper only matches `[a-z_]+` literals, and a mime type contains `/`.

- [ ] **Step 2: Run them and watch them fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans/types.test.ts
```

Expected: FAIL — missing exports (`PURPOSE_LABEL` values differ, `DEFAULT_PLAN_NAME` undefined), and the plan-row mapper still returns `floorPlanId`.

- [ ] **Step 3: Edit `types.ts`**

Replace the `PURPOSE_LABEL` constant with:

```ts
/** What the two tools are called on screen and in PDFs (spec 2026-10-12 §2). */
export const PURPOSE_LABEL: Record<StatusPlanPurpose, string> = {
  tenant_layout: 'Tenant floor plan',
  distribution_schematic: 'Line diagram',
}

/** The name a plan is created with, the first time a file is uploaded to it. */
export const DEFAULT_PLAN_NAME: Record<StatusPlanPurpose, string> = {
  tenant_layout: 'Floor plan',
  distribution_schematic: 'Line diagram',
}

/** The private bucket that holds every sheet's file (00249). */
export const TENANT_PLAN_BUCKET = 'tenant-plan-files'
/** Mirrors the bucket's file_size_limit (50 MB). */
export const TENANT_PLAN_MAX_BYTES = 50 * 1024 * 1024
/** Mirrors status_plan_sheets_mime_check and the bucket's allowed_mime_types. */
export const TENANT_PLAN_MIMES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export type TenantPlanMime = (typeof TENANT_PLAN_MIMES)[number]
/** Mirrors status_plan_sheets_label_not_blank. */
export const SHEET_LABEL_MAX = 120
```

Replace the `StatusPlanRow`, `StatusPlanShapeRow`, `StatusPlan`, `StatusPlanShape` interfaces and the two mappers with:

```ts
/** tenants.status_plans as PostgREST returns it (after 00249). */
export interface StatusPlanRow {
  id: string
  project_id: string
  organisation_id: string
  purpose: StatusPlanPurpose
  name: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/** tenants.status_plan_sheets as PostgREST returns it. Numerics may arrive as strings. */
export interface StatusPlanSheetRow {
  id: string
  status_plan_id: string
  organisation_id: string
  sort_order: number
  label: string
  file_path: string
  page_index: number
  file_name: string
  mime: TenantPlanMime
  revision: number
  replaced_at: string | null
  replaced_from_path: string | null
  pixels_per_meter: number | string | null
  calibration_points: unknown
  calibration_metres: number | string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** tenants.status_plan_shapes as PostgREST returns it. */
export interface StatusPlanShapeRow {
  id: string
  status_plan_id: string
  sheet_id: string
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
  purpose: StatusPlanPurpose
  name: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface StatusPlanShape {
  id: string
  statusPlanId: string
  sheetId: string
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
    purpose: r.purpose,
    name: r.name,
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
    sheetId: r.sheet_id,
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

Update the file's header comment line "A status plan is one page of a drawing marked with a purpose." to "A status plan is a project's tenant floor plan or line diagram; its sheets are uploaded files (00249)."

- [ ] **Step 4: Run the shared suite**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared exec vitest run src/status-plans
```

Expected: PASS (the `index.test.ts` public-surface test may list exports; if it pins an explicit list, add `DEFAULT_PLAN_NAME`, `TENANT_PLAN_BUCKET`, `TENANT_PLAN_MAX_BYTES`, `TENANT_PLAN_MIMES`, `SHEET_LABEL_MAX` to it and re-run).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/status-plans
git commit -m "feat(shared): tenant plan names, sheet constants and row types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase C — Files in, sheets registered

### Task C1: Web types for sheets

**Files:**
- Modify (rewrite): `apps/web/src/lib/status-plans/types.ts`

Phase D rewires every consumer; this task only changes the contract, so `tsc` will be red between C1 and D7. That is expected; the vitest files touched in C run in isolation.

- [ ] **Step 1: Replace the file**

```ts
/**
 * The shapes the tenant plan pages hand their client components, and the
 * result type every tenant plan action returns.
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
  TenantPlanMime,
} from '@esite/shared/status-plans'

/** Never thrown: production redacts thrown server-action messages. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; conflict?: boolean }

/** A signed upload slot handed to the browser (tenant-plan-sheets.actions.ts). */
export interface PreparedUpload {
  path: string
  token: string
  mime: TenantPlanMime
}

/** One sheet of a plan, as the strip, the legend and the actions return it. */
export interface SheetSummary {
  id: string
  label: string
  sortOrder: number
  fileName: string
  mime: TenantPlanMime
  /** 1-based page within the sheet's file. */
  pageIndex: number
  revision: number
  /** Set when the file was replaced and the shapes have not been re-anchored. */
  replacedAt: string | null
  /** The sheet's own scale; null = unscaled (areas show "—"). */
  pixelsPerMeter: number | null
  /** The concurrency token every sheet write must present. */
  updatedAt: string
}

/** The sheet on the canvas: a summary plus what the browser needs to draw it. */
export interface PlanSheet extends SheetSummary {
  signedUrl: string | null
  isPdf: boolean
}

export interface PlanHeader {
  id: string
  name: string
  purpose: StatusPlanPurpose
  updatedAt: string
}

export interface CanvasShape {
  id: string
  /** The sheet the shape is drawn on (its image space). */
  sheetId: string
  shape: ShapeKind
  /** Image space, flat [x0, y0, x1, y1, …]. */
  points: number[]
  nodeId: string | null
  areaType: AreaType | null
  detectedTag: string | null
  source: ShapeSource
  /** The concurrency token every write must present. */
  updatedAt: string
  /** Set (omitted otherwise) when the stored outline fails today's checks; points may then be []. */
  invalidReason?: string
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
  /** Every sheet of the plan, in strip order. */
  sheets: SheetSummary[]
  /** The sheet being drawn on (?sheet=, else the sheet of ?shape=, else the first). */
  sheet: PlanSheet
  /** Every shape of the plan, on every sheet: plan totals and "a board once per plan" need them all. */
  shapes: CanvasShape[]
  /** tenant_db nodes on a floor plan; every live node on a line diagram. */
  nodes: PlanNode[]
  /** nodeId → link, floor plan only ({} on a line diagram). */
  shopLinks: Record<string, ShopLink>
  /** nodeId → DB order status, line diagram only ({} on a floor plan). */
  dbOrders: Record<string, NodeOrderStatus>
  /** yyyy-mm-dd, the server's date: overdue is decided against it. */
  today: string
  canEdit: boolean
  /** From ?shape=, only when that shape is on the current sheet. */
  initialShapeId: string | null
}

/** A plan route with nothing uploaded yet. */
export interface TenantPlanEmptyProps {
  projectId: string
  purpose: StatusPlanPurpose
  canEdit: boolean
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/status-plans/types.ts
git commit -m "refactor(status-plans): page props describe sheets, not a drawing page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C2: `sheet-files.ts` — paths, file types, labels, page count

**Files:**
- Create: `apps/web/src/lib/status-plans/sheet-files.ts`
- Create: `apps/web/src/lib/status-plans/sheet-files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  MAX_FILES_PER_UPLOAD, MAX_SHEETS_PER_PLAN, countPdfPages, defaultSheetLabels, extFor, fileProblem,
  mimeForFile, parseSheetPath, sheetFilePath,
} from './sheet-files'

const O = '66666666-6666-4666-8666-666666666666'
const P = '11111111-1111-4111-8111-111111111111'
const PL = '33333333-3333-4333-8333-333333333333'
const F = '77777777-7777-4777-8777-777777777777'

describe('storage paths', () => {
  it('builds {org}/{project}/{plan}/{folder}/{revision}.{ext} and reads it back', () => {
    const path = sheetFilePath({ orgId: O, projectId: P, planId: PL, folderId: F, revision: 3, mime: 'image/jpeg' })
    expect(path).toBe(`${O}/${P}/${PL}/${F}/3.jpg`)
    expect(parseSheetPath(path)).toEqual({ orgId: O, projectId: P, planId: PL, folderId: F, revision: 3, ext: 'jpg' })
  })
  it('refuses anything the bucket policy would refuse', () => {
    for (const bad of [
      `${O}/${P}/${PL}/${F}/0.pdf`,
      `${O}/${P}/${PL}/${F}/1.jpeg`,
      `${O}/${P}/${PL}/${F}/1.PDF`,
      `${O}/${P}/${PL}/../1.pdf`,
      `${O}/${P}/${PL}/1.pdf`,
      `x/${P}/${PL}/${F}/1.pdf`,
    ]) expect(parseSheetPath(bad), bad).toBeNull()
  })
  it('one extension per type', () => {
    expect([extFor('application/pdf'), extFor('image/png'), extFor('image/jpeg')]).toEqual(['pdf', 'png', 'jpg'])
  })
})

describe('file types and sizes', () => {
  it('trusts a known browser type, else the extension', () => {
    expect(mimeForFile('x.bin', 'application/pdf')).toBe('application/pdf')
    expect(mimeForFile('E-100.PDF', '')).toBe('application/pdf')
    expect(mimeForFile('photo.JPEG', 'application/octet-stream')).toBe('image/jpeg')
    expect(mimeForFile('layout.png', '')).toBe('image/png')
    expect(mimeForFile('layout.dwg', '')).toBeNull()
    expect(mimeForFile('layout.webp', 'image/webp')).toBeNull()
  })
  it('says what is wrong with a file, by name', () => {
    expect(fileProblem({ name: 'a.dwg', size: 10, type: '' })).toBe('a.dwg is not a PDF, PNG or JPEG.')
    expect(fileProblem({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toBe('a.pdf is empty.')
    expect(fileProblem({ name: 'a.pdf', size: 50 * 1024 * 1024 + 1, type: 'application/pdf' })).toBe('a.pdf is larger than 50 MB.')
    expect(fileProblem({ name: 'a.pdf', size: 50 * 1024 * 1024, type: 'application/pdf' })).toBeNull()
  })
  it('limits per upload and per plan', () => {
    expect(MAX_FILES_PER_UPLOAD).toBe(20)
    expect(MAX_SHEETS_PER_PLAN).toBe(200)
  })
})

describe('default labels', () => {
  it('a one-page file is called by its name', () => {
    expect(defaultSheetLabels('Mall GF tenant layout.pdf', 1)).toEqual(['Mall GF tenant layout'])
  })
  it('each page of a multi-page PDF is "Sheet n of N (name)", so two files never collide', () => {
    expect(defaultSheetLabels('E-300.pdf', 3)).toEqual(['Sheet 1 of 3 (E-300)', 'Sheet 2 of 3 (E-300)', 'Sheet 3 of 3 (E-300)'])
  })
  it('never exceeds the 120-character label limit', () => {
    const [label] = defaultSheetLabels(`${'x'.repeat(300)}.pdf`, 2)
    expect(label!.length).toBeLessThanOrEqual(120)
  })
})

describe('countPdfPages', () => {
  it('counts the pages of a real PDF', async () => {
    const d = await PDFDocument.create()
    d.addPage([300, 200]); d.addPage([300, 200]); d.addPage([300, 200])
    expect(await countPdfPages(await d.save())).toBe(3)
  })
  it('null for bytes that are not a PDF', async () => {
    expect(await countPdfPages(new TextEncoder().encode('not a pdf'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/sheet-files.test.ts
```

Expected: FAIL — `Failed to resolve import "./sheet-files"`.

- [ ] **Step 3: Write the module**

Create `apps/web/src/lib/status-plans/sheet-files.ts`:

```ts
/**
 * Tenant plan files: where they live, what they may be, what they are called
 * (spec 2026-10-12 §3). Server-side: the sheet actions import it; pdf-lib is
 * loaded only to count pages.
 *
 * The path pattern is the one the 00249 trigger and bucket policy enforce:
 *   {org}/{project}/{plan}/{folder}/{revision}.{pdf|png|jpg}
 * where folder is the id of the first sheet the file was uploaded for. A PDF
 * of N pages is N sheets sharing one path.
 */
import { PDFDocument } from 'pdf-lib'
import { SHEET_LABEL_MAX, TENANT_PLAN_MAX_BYTES, TENANT_PLAN_MIMES, type TenantPlanMime } from '@esite/shared/status-plans'

export const MAX_FILES_PER_UPLOAD = 20
export const MAX_SHEETS_PER_PLAN = 200

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})/(${UUID})/([1-9][0-9]{0,5})\\.(pdf|png|jpg)$`)

export type SheetExt = 'pdf' | 'png' | 'jpg'

export function extFor(mime: TenantPlanMime): SheetExt {
  if (mime === 'application/pdf') return 'pdf'
  return mime === 'image/png' ? 'png' : 'jpg'
}

/** The browser's type when it is one we take, else the extension; null = not a PDF, PNG or JPEG. */
export function mimeForFile(name: string, type: string): TenantPlanMime | null {
  if ((TENANT_PLAN_MIMES as readonly string[]).includes(type)) return type as TenantPlanMime
  if (/\.pdf$/i.test(name)) return 'application/pdf'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  return null
}

/** A sentence naming what is wrong with a chosen file, or null when it can be uploaded. */
export function fileProblem(f: { name: string; size: number; type: string }): string | null {
  if (!mimeForFile(f.name, f.type)) return `${f.name} is not a PDF, PNG or JPEG.`
  if (!(f.size > 0)) return `${f.name} is empty.`
  if (f.size > TENANT_PLAN_MAX_BYTES) return `${f.name} is larger than 50 MB.`
  return null
}

export interface SheetPathParts {
  orgId: string
  projectId: string
  planId: string
  folderId: string
  revision: number
  ext: SheetExt
}

export function sheetFilePath(p: Omit<SheetPathParts, 'ext'> & { mime: TenantPlanMime }): string {
  return `${p.orgId}/${p.projectId}/${p.planId}/${p.folderId}/${p.revision}.${extFor(p.mime)}`
}

export function parseSheetPath(path: string): SheetPathParts | null {
  const m = PATH_RE.exec(path)
  if (!m) return null
  return { orgId: m[1]!, projectId: m[2]!, planId: m[3]!, folderId: m[4]!, revision: Number(m[5]), ext: m[6] as SheetExt }
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'Sheet'
}

function clip(label: string): string {
  return label.length <= SHEET_LABEL_MAX ? label : `${label.slice(0, SHEET_LABEL_MAX - 1)}…`
}

/**
 * Default labels for one uploaded file: its name for a one-page file, and
 * "Sheet n of N (name)" for each page of a multi-page PDF, so two multi-page
 * files uploaded together never produce the same label. Renamable afterwards.
 */
export function defaultSheetLabels(fileName: string, pageCount: number): string[] {
  const base = baseName(fileName)
  if (pageCount <= 1) return [clip(base)]
  return Array.from({ length: pageCount }, (_, i) => clip(`Sheet ${i + 1} of ${pageCount} (${base})`))
}

/**
 * Page count of a PDF, or null when pdf-lib cannot read it. Encrypted files
 * are counted (ignoreEncryption), not opened: the canvas and the renderer say
 * so themselves if they cannot draw one.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
    const n = doc.getPageCount()
    return n > 0 ? n : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run it**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/sheet-files.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/sheet-files.ts apps/web/src/lib/status-plans/sheet-files.test.ts
git commit -m "feat(status-plans): sheet file paths, types, default labels and PDF page count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C3: `sheet-row.ts` — rows to summaries

**Files:**
- Create: `apps/web/src/lib/status-plans/sheet-row.ts`
- Create: `apps/web/src/lib/status-plans/sheet-row.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { StatusPlanSheetRow } from '@esite/shared/status-plans'
import { SHEET_COLUMNS, summaryOf, toSheetSummary } from './sheet-row'
import { jsonUnsafePath } from './json-safe'

const ROW: StatusPlanSheetRow = {
  id: 'sh1', status_plan_id: 'pl1', organisation_id: 'o', sort_order: 2, label: 'Level 1', file_path: 'o/p/pl1/sh1/2.pdf',
  page_index: 3, file_name: 'E-101 rev C.pdf', mime: 'application/pdf', revision: 2, replaced_at: '2026-10-12T10:00:00Z',
  replaced_from_path: 'o/p/pl1/sh1/1.pdf', pixels_per_meter: '31.25', calibration_points: [0, 0, 125, 0], calibration_metres: '4',
  created_by: 'u', created_at: 't0', updated_at: 't1',
}

describe('toSheetSummary', () => {
  it('keeps what the page needs, coerces numerics, and is JSON', () => {
    const s = toSheetSummary(ROW)
    expect(s).toEqual({
      id: 'sh1', label: 'Level 1', sortOrder: 2, fileName: 'E-101 rev C.pdf', mime: 'application/pdf', pageIndex: 3,
      revision: 2, replacedAt: '2026-10-12T10:00:00Z', pixelsPerMeter: 31.25, updatedAt: 't1',
    })
    expect(jsonUnsafePath(s)).toBeNull()
  })
  it('an unscaled sheet has a null scale', () => {
    expect(toSheetSummary({ ...ROW, pixels_per_meter: null }).pixelsPerMeter).toBeNull()
  })
  it('selects every column the summary reads', () => {
    for (const c of ['id', 'sort_order', 'label', 'file_path', 'page_index', 'file_name', 'mime', 'revision', 'replaced_at', 'pixels_per_meter', 'updated_at']) {
      expect(SHEET_COLUMNS.split(', ')).toContain(c)
    }
  })
})

describe('summaryOf', () => {
  it('drops the canvas-only fields', () => {
    const sheet = { ...toSheetSummary(ROW), signedUrl: 'https://x', isPdf: true }
    expect(summaryOf(sheet)).toEqual(toSheetSummary(ROW))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/sheet-row.test.ts
```

Expected: FAIL — cannot resolve `./sheet-row`.

- [ ] **Step 3: Write the module**

```ts
/** tenants.status_plan_sheets rows ↔ what the page and the actions hand around. Client-safe (types only). */
import type { StatusPlanSheetRow } from '@esite/shared/status-plans'
import type { PlanSheet, SheetSummary } from './types'

export const SHEET_COLUMNS =
  'id, status_plan_id, organisation_id, sort_order, label, file_path, page_index, file_name, mime, revision, replaced_at, replaced_from_path, pixels_per_meter, calibration_points, calibration_metres, created_by, created_at, updated_at'

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function toSheetSummary(r: StatusPlanSheetRow): SheetSummary {
  return {
    id: r.id,
    label: r.label,
    sortOrder: Number(r.sort_order),
    fileName: r.file_name,
    mime: r.mime,
    pageIndex: Number(r.page_index),
    revision: Number(r.revision),
    replacedAt: r.replaced_at ?? null,
    pixelsPerMeter: num(r.pixels_per_meter),
    updatedAt: r.updated_at,
  }
}

/** The canvas sheet without its canvas-only fields, for the strip's list. */
export function summaryOf(s: PlanSheet): SheetSummary {
  return {
    id: s.id,
    label: s.label,
    sortOrder: s.sortOrder,
    fileName: s.fileName,
    mime: s.mime,
    pageIndex: s.pageIndex,
    revision: s.revision,
    replacedAt: s.replacedAt,
    pixelsPerMeter: s.pixelsPerMeter,
    updatedAt: s.updatedAt,
  }
}
```

- [ ] **Step 4: Run it**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/sheet-row.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/sheet-row.ts apps/web/src/lib/status-plans/sheet-row.test.ts
git commit -m "feat(status-plans): sheet rows to summaries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C4: The fake client learns storage, and write errors learn sheets

**Files:**
- Modify: `apps/web/src/lib/status-plans/__fixtures__/fake-client.ts`
- Modify (rewrite): `apps/web/src/lib/status-plans/write-errors.ts`
- Modify (rewrite): `apps/web/src/lib/status-plans/write-errors.test.ts`

- [ ] **Step 1: Extend the fake's storage**

In `fake-client.ts`, add after the `FakeResponse` interface:

```ts
export interface FakeStorageCall {
  bucket: string
  op: 'createSignedUrl' | 'createSignedUploadUrl' | 'download' | 'remove'
  args: unknown[]
}

export interface FakeClientOptions {
  userId?: string | null
  /** Objects `download` can return, by path. */
  files?: Record<string, Uint8Array>
  /** Make one storage operation answer with this error message. */
  storageErrors?: Partial<Record<FakeStorageCall['op'], string>>
}
```

Change the signature `export function fakeClient(respond: Responder, opts: { userId?: string | null } = {})` to `export function fakeClient(respond: Responder, opts: FakeClientOptions = {})`, add `const storageCalls: FakeStorageCall[] = []` next to `const calls`, replace the `storage:` property with:

```ts
    storage: {
      from: (bucket: string) => {
        const err = (op: FakeStorageCall['op']) => (opts.storageErrors?.[op] ? { message: opts.storageErrors[op]! } : null)
        return {
          createSignedUrl: async (path: string, ...rest: unknown[]) => {
            storageCalls.push({ bucket, op: 'createSignedUrl', args: [path, ...rest] })
            const e = err('createSignedUrl')
            return e ? { data: null, error: e } : { data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null }
          },
          createSignedUploadUrl: async (path: string, ...rest: unknown[]) => {
            storageCalls.push({ bucket, op: 'createSignedUploadUrl', args: [path, ...rest] })
            const e = err('createSignedUploadUrl')
            return e ? { data: null, error: e } : { data: { path, token: `tok:${path}`, signedUrl: `https://signed.test/upload/${bucket}/${path}` }, error: null }
          },
          download: async (path: string) => {
            storageCalls.push({ bucket, op: 'download', args: [path] })
            const f = opts.files?.[path]
            return f && !err('download') ? { data: new Blob([new Uint8Array(f)]), error: null } : { data: null, error: { message: 'Object not found' } }
          },
          remove: async (paths: string[]) => {
            storageCalls.push({ bucket, op: 'remove', args: [paths] })
            const e = err('remove')
            return e ? { data: null, error: e } : { data: paths.map((name) => ({ name })), error: null }
          },
        }
      },
    },
```

and `return { client, calls, storageCalls }`. Also add `'gte', 'lte'` to the chain-method list only if a later task needs them (none does).

- [ ] **Step 2: Rewrite the write-error test (red)**

Replace `write-errors.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { statusPlanWriteError, type WriteTarget } from './write-errors'

const cases: Array<[string, string, WriteTarget, RegExp]> = [
  ['23505', 'duplicate key value violates unique constraint "status_plans_project_purpose_key"', 'plan', /already has that plan/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"', 'shape', /already on this plan/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_sheets_plan_order_key"', 'sheet', /share a position/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_sheets_pkey"', 'sheet', /already registered/],
  ['23514', 'status_plans: the project and purpose of a plan are fixed', 'plan', /cannot change/],
  ['23514', 'status_plan_sheets: a sheet cannot move to another plan', 'sheet', /sheet cannot move/],
  ['23514', 'status_plan_sheets: the file must be stored under this plan', 'sheet', /does not belong to this plan/],
  ['23514', 'status_plan_sheets: the file type does not match its name', 'sheet', /file type does not match/],
  ['23514', 'status_plan_sheets: an image has one page', 'sheet', /image has one page/],
  ['23514', 'new row for relation "status_plan_sheets" violates check constraint "status_plan_sheets_label_not_blank"', 'sheet', /Give the sheet a name/],
  ['23514', 'new row for relation "status_plan_sheets" violates check constraint "status_plan_sheets_calibration_shape"', 'sheet', /two points and a distance/],
  ['23514', 'status_plan_shapes: a shape cannot move to another plan', 'shape', /shape cannot move to another plan/],
  ['23514', 'status_plan_shapes: a shape cannot move to another sheet', 'shape', /another sheet/],
  ['23514', 'status_plan_shapes: that sheet belongs to another plan', 'shape', /sheet belongs to another plan/],
  ['23514', 'status_plan_shapes: area types belong on tenant layout plans only', 'shape', /floor plan only/],
  ['23514', 'status_plan_shapes: that board is not on this project', 'shape', /not on this project/],
  ['23514', 'status_plan_shapes: that board has been deleted', 'shape', /has been deleted/],
  ['23514', 'status_plan_shapes: a tenant layout links tenant boards only', 'shape', /tenant boards only/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_points_shape"', 'shape', /outline is not valid/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_link_or_area"', 'shape', /either a shop or an area/],
  ['23503', 'status_plans: project 6c1b… not found', 'plan', /project no longer exists/],
  ['23503', 'status_plan_sheets: status plan 6c1b… not found', 'sheet', /plan no longer exists/],
  ['23503', 'status_plan_shapes: sheet 6c1b… not found', 'shape', /sheet no longer exists/],
  ['23503', 'insert or update on table "status_plan_shapes" violates foreign key constraint "status_plan_shapes_node_id_fkey"', 'shape', /board no longer exists/],
  ['42501', 'new row violates row-level security policy for table "status_plan_sheets"', 'sheet', /owner, admin or project manager/],
]

describe('statusPlanWriteError', () => {
  it.each(cases)('%s %s → a sentence', (code, message, target, sentence) => {
    expect(statusPlanWriteError({ code, message }, target)).toMatch(sentence)
  })

  it('never returns the raw message', () => {
    for (const [code, message, target] of cases) expect(statusPlanWriteError({ code, message }, target)).not.toContain(message)
  })

  it('falls back by code, then by target', () => {
    expect(statusPlanWriteError({ code: '23514', message: 'something new' }, 'sheet')).toBe('The database refused that change. Reload and check the plan.')
    expect(statusPlanWriteError({ code: 'XX000', message: 'boom' }, 'sheet')).toBe('The sheet could not be saved. Reload and try again.')
    expect(statusPlanWriteError({ code: 'XX000', message: 'boom' }, 'plan')).toBe('The plan could not be saved. Reload and try again.')
    expect(statusPlanWriteError({ code: 'XX000', message: 'boom' }, 'shape')).toBe('The shape could not be saved. Reload and try again.')
  })
})
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/write-errors.test.ts
```

Expected: FAIL (new codes and the `'sheet'` target are unknown).

- [ ] **Step 3: Rewrite `write-errors.ts`**

```ts
/**
 * A Postgres / PostgREST refusal on a tenant plan write, as a sentence.
 *
 * Codes come from 00245 and 00249: 23514 for trigger and CHECK refusals, 23505
 * for the unique keys, 23503 for a missing project / plan / sheet / board, and
 * 42501 from RLS. Each rule needs the code AND a distinctive substring, so two
 * different refusals with one code never share a sentence. The raw message is
 * never returned: it names constraints and tables, which mean nothing to the
 * person drawing and leak schema to anyone else.
 */
export type WriteTarget = 'plan' | 'sheet' | 'shape'

export interface PgErrorLike {
  code?: string | null
  message?: string | null
}

const RULES: ReadonlyArray<{ code: string; match?: RegExp; sentence: string }> = [
  { code: '23505', match: /status_plans_project_purpose_key/, sentence: 'This project already has that plan. Reload the page.' },
  { code: '23505', match: /status_plan_shapes_plan_node_key/, sentence: 'That board is already on this plan. Select its shape instead of linking it twice.' },
  { code: '23505', match: /status_plan_sheets_plan_order_key/, sentence: 'Two sheets cannot share a position. Reload and try again.' },
  { code: '23505', match: /status_plan_sheets_pkey/, sentence: 'That upload was already registered. Reload the page.' },
  { code: '23514', match: /project and purpose of a plan are fixed/, sentence: "A plan's project and purpose cannot change." },
  { code: '23514', match: /a sheet cannot move to another plan/, sentence: 'A sheet cannot move to another plan.' },
  { code: '23514', match: /must be stored under this plan/, sentence: 'That file does not belong to this plan. Upload it again.' },
  { code: '23514', match: /file type does not match/, sentence: 'The file type does not match the file. Upload it again.' },
  { code: '23514', match: /an image has one page/, sentence: 'An image has one page.' },
  { code: '23514', match: /status_plan_sheets_label_not_blank/, sentence: 'Give the sheet a name (up to 120 characters).' },
  { code: '23514', match: /status_plan_sheets_calibration_shape/, sentence: 'The scale needs two points and a distance. Set it again.' },
  { code: '23514', match: /a shape cannot move to another plan/, sentence: 'A shape cannot move to another plan.' },
  { code: '23514', match: /a shape cannot move to another sheet/, sentence: 'A shape cannot move to another sheet.' },
  { code: '23514', match: /that sheet belongs to another plan/, sentence: 'That sheet belongs to another plan. Reload the page.' },
  { code: '23514', match: /area types belong on tenant layout/, sentence: 'Area types are for the floor plan only.' },
  { code: '23514', match: /not on this project/, sentence: 'That board is not on this project.' },
  { code: '23514', match: /has been deleted/, sentence: 'That board has been deleted. Pick another, or leave the shape unassigned.' },
  { code: '23514', match: /tenant boards only/, sentence: 'The floor plan links tenant boards only.' },
  { code: '23514', match: /status_plan_shapes_points_shape/, sentence: "That shape's outline is not valid: it needs at least 3 corners, and a rectangle exactly 4." },
  { code: '23514', match: /status_plans_name_not_blank/, sentence: 'Give the plan a name.' },
  { code: '23514', match: /status_plan_shapes_link_or_area/, sentence: 'A shape is either a shop or an area, not both.' },
  { code: '23503', match: /project .* not found/, sentence: 'That project no longer exists, or you cannot see it.' },
  { code: '23503', match: /status plan .* not found|status_plan_id_fkey/, sentence: 'That plan no longer exists. Reload the page.' },
  { code: '23503', match: /sheet .* not found|sheet_id_fkey/, sentence: 'That sheet no longer exists. Reload the page.' },
  { code: '23503', match: /node_id_fkey/, sentence: 'That board no longer exists. Pick another.' },
  { code: '42501', sentence: 'Only an owner, admin or project manager can change tenant plans on this project.' },
]

const BY_CODE: Record<string, string> = {
  '23514': 'The database refused that change. Reload and check the plan.',
  '23505': 'That would duplicate something already on this plan.',
  '23503': 'Something this refers to no longer exists. Reload and try again.',
}

const FALLBACK: Record<WriteTarget, string> = {
  plan: 'The plan could not be saved. Reload and try again.',
  sheet: 'The sheet could not be saved. Reload and try again.',
  shape: 'The shape could not be saved. Reload and try again.',
}

export function statusPlanWriteError(err: PgErrorLike, target: WriteTarget): string {
  const code = err.code ?? ''
  const message = err.message ?? ''
  for (const r of RULES) {
    if (r.code === code && (!r.match || r.match.test(message))) return r.sentence
  }
  return BY_CODE[code] ?? FALLBACK[target]
}
```

Note the order: `/status plan .* not found/` is checked before `/sheet .* not found/`, and the sheet trigger's message is "status plan % not found" (plan) while the shape trigger's is "sheet % not found" (sheet). `/project .* not found/` comes first because the plan trigger's message "project % not found" contains neither.

- [ ] **Step 4: Run them**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/write-errors.test.ts src/lib/status-plans/detection-errors.test.ts
```

Expected: PASS. If `detection-errors.test.ts` asserts the old sentence `'Area types are for tenant layout plans only.'` or `'A tenant layout links tenant boards only.'`, update that expectation to the new sentence (`Area types are for the floor plan only.` / `The floor plan links tenant boards only.`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/__fixtures__/fake-client.ts apps/web/src/lib/status-plans/write-errors.ts apps/web/src/lib/status-plans/write-errors.test.ts apps/web/src/lib/status-plans/detection-errors.test.ts
git commit -m "feat(status-plans): sentences for sheet refusals; fake client storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C5: `plan-urls.ts` — the tenant plan routes

**Files:**
- Modify (rewrite): `apps/web/src/lib/status-plans/plan-urls.ts`
- Modify (rewrite): `apps/web/src/lib/status-plans/plan-urls.test.ts`

- [ ] **Step 1: Rewrite the test (red)**

```ts
import { describe, it, expect } from 'vitest'
import { TENANT_PLAN_SEGMENT, fileLabel, isPdfPath, tenantPlanHref, tenantScheduleHref } from './plan-urls'

describe('tenant plan routes', () => {
  it('two routes under the tenant schedule', () => {
    expect(TENANT_PLAN_SEGMENT).toEqual({ tenant_layout: 'floor-plan', distribution_schematic: 'line-diagram' })
    expect(tenantScheduleHref('p1')).toBe('/projects/p1/tenant-schedule')
    expect(tenantPlanHref('p1', 'tenant_layout')).toBe('/projects/p1/tenant-schedule/floor-plan')
    expect(tenantPlanHref('p1', 'distribution_schematic', { sheet: 's 1' })).toBe('/projects/p1/tenant-schedule/line-diagram?sheet=s%201')
  })
  it('sheet first, then shape, both optional', () => {
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: 'sh1', shape: 'sp1' })).toBe('/projects/p1/tenant-schedule/floor-plan?sheet=sh1&shape=sp1')
    expect(tenantPlanHref('p1', 'tenant_layout', { shape: 'sp1' })).toBe('/projects/p1/tenant-schedule/floor-plan?shape=sp1')
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: null, shape: null })).toBe('/projects/p1/tenant-schedule/floor-plan')
  })
  it('file helpers', () => {
    expect(isPdfPath('a/b.PDF')).toBe(true)
    expect(fileLabel('o/p/pl/sh/2.pdf')).toBe('2.pdf')
  })
})
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-urls.test.ts` → FAIL (exports missing).

- [ ] **Step 2: Rewrite `plan-urls.ts`**

```ts
/** Routes and file helpers for tenant plans. Pure; safe on client and server. */
import type { StatusPlanPurpose } from '@esite/shared/status-plans'

export const isPdfPath = (p: string): boolean => /\.pdf$/i.test(p)

/** The route segment of each tool under /projects/[id]/tenant-schedule. */
export const TENANT_PLAN_SEGMENT: Record<StatusPlanPurpose, 'floor-plan' | 'line-diagram'> = {
  tenant_layout: 'floor-plan',
  distribution_schematic: 'line-diagram',
}

export function tenantScheduleHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tenant-schedule`
}

/** A tenant plan, optionally on one sheet and with one shape selected (?sheet= &shape=). */
export function tenantPlanHref(
  projectId: string,
  purpose: StatusPlanPurpose,
  opts: { sheet?: string | null; shape?: string | null } = {},
): string {
  const base = `${tenantScheduleHref(projectId)}/${TENANT_PLAN_SEGMENT[purpose]}`
  const q = new URLSearchParams()
  if (opts.sheet) q.set('sheet', opts.sheet)
  if (opts.shape) q.set('shape', opts.shape)
  const s = q.toString().replace(/\+/g, '%20')
  return s ? `${base}?${s}` : base
}

/** "2.pdf" from a storage path. */
export function fileLabel(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
```

- [ ] **Step 3: Run it**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-urls.test.ts
```

Expected: PASS (3 tests). The old exports (`statusPlansHref`, `statusPlanHref`, `isImagePath`, `isRenderableDrawing`) are gone on purpose: every caller is rewritten in Phases D–F, and `tsc` lists any that remain.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/status-plans/plan-urls.ts apps/web/src/lib/status-plans/plan-urls.test.ts
git commit -m "feat(status-plans): tenant plan routes under the tenant schedule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task C6: The sheet actions

**Files:**
- Create: `apps/web/src/actions/tenant-plan-sheets.actions.ts`
- Create: `apps/web/src/actions/tenant-plan-sheets.actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { fakeClient, queued, type FakeCall, type FakeResponse, type FakeStorageCall } from '@/lib/status-plans/__fixtures__/fake-client'

/**
 * What a mocked test CAN see and must pin:
 *  - the gate is consulted with ORG_WRITE_ROLES on the plan's own project, and
 *    a refusal signs nothing and writes nothing;
 *  - paths are built by the server, under the plan's folder, and registration
 *    refuses any other path;
 *  - page counts come from the uploaded bytes, never from the client;
 *  - edits to an existing sheet are conditional on updated_at in the same
 *    statement, and zero rows back is a conflict;
 *  - organisation_id, created_by, revision and replaced_* are never sent.
 * The role helper is mocked with the OBJECT it really returns.
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
  prepareTenantPlanUploadAction,
  registerTenantPlanSheetsAction,
  prepareTenantPlanSheetReplaceAction,
  replaceTenantPlanSheetAction,
  reanchorTenantPlanSheetAction,
  renameTenantPlanSheetAction,
  deleteTenantPlanSheetAction,
  calibrateTenantPlanSheetAction,
} from './tenant-plan-sheets.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const PL = '33333333-3333-4333-8333-333333333333'
const SH = '44444444-4444-4444-8444-444444444444'
const O = '66666666-6666-4666-8666-666666666666'
const F1 = '77777777-7777-4777-8777-777777777777'
const F2 = '88888888-8888-4888-8888-888888888888'
const OTHER = '99999999-9999-4999-8999-999999999999'
const TS = '2026-10-12T09:00:00.000001+00:00'
const TS2 = '2026-10-12T09:05:00.000001+00:00'
const PLAN = { id: PL, project_id: P, organisation_id: O, purpose: 'tenant_layout' }
const path = (folder: string, rev = 1, ext = 'pdf') => `${O}/${P}/${PL}/${folder}/${rev}.${ext}`

async function pdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([200, 100])
  return d.save()
}

function sheetRow(over: Record<string, unknown> = {}) {
  return {
    id: SH, status_plan_id: PL, organisation_id: O, sort_order: 0, label: 'E-100', file_path: path(SH), page_index: 1,
    file_name: 'E-100.pdf', mime: 'application/pdf', revision: 1, replaced_at: null, replaced_from_path: null,
    pixels_per_meter: null, calibration_points: null, calibration_metres: null, created_by: 'u', created_at: TS, updated_at: TS,
    ...over,
  }
}

/** Inserts into status_plan_sheets answer with the rows they were given, as the database would. */
const echoSheetInsert = (c: FakeCall): FakeResponse => ({
  data: (c.payload as Array<Record<string, unknown>>).map((r) => sheetRow({ ...r, created_at: TS, updated_at: TS })),
})

let calls: FakeCall[]
let storageCalls: FakeStorageCall[]
function setup(
  map: Record<string, FakeResponse[]>,
  opts: { files?: Record<string, Uint8Array>; userId?: string | null; echoInsert?: boolean } = {},
) {
  const q = queued(map)
  const respond = (c: FakeCall) => (opts.echoInsert && c.table === 'tenants.status_plan_sheets' && c.op === 'insert' ? echoSheetInsert(c) : q(c))
  const f = fakeClient(respond, { files: opts.files, userId: opts.userId })
  calls = f.calls
  storageCalls = f.storageCalls
  createClientMock.mockResolvedValue(f.client)
}
const writes = () => calls.filter((c) => c.op !== 'select')
const ops = (op: FakeStorageCall['op']) => storageCalls.filter((c) => c.op === op)

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
})

describe('prepareTenantPlanUploadAction', () => {
  const files = [
    { name: 'E-100.pdf', size: 1000, type: 'application/pdf' },
    { name: 'E-101.PNG', size: 10, type: '' },
  ]

  it('creates the plan on first upload and signs one path per file under its folder', async () => {
    setup({ 'tenants.status_plans:select': [{ data: null }], 'tenants.status_plans:insert': [{ data: PLAN }] })
    const res = await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(writes()[0]!.payload).toEqual({ project_id: P, purpose: 'tenant_layout', name: 'Floor plan' })
    expect(res.data.planId).toBe(PL)
    expect(res.data.uploads.map((u) => u.mime)).toEqual(['application/pdf', 'image/png'])
    res.data.uploads.forEach((u, i) => {
      expect(u.path).toMatch(new RegExp(`^${O}/${P}/${PL}/[0-9a-f-]{36}/1\\.${i === 0 ? 'pdf' : 'png'}$`))
      expect(u.token).toBe(`tok:${u.path}`)
    })
    expect(ops('createSignedUploadUrl').map((c) => [c.bucket, c.args[1]])).toEqual([
      ['tenant-plan-files', { upsert: false }],
      ['tenant-plan-files', { upsert: false }],
    ])
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
  })

  it('reuses the plan that already exists', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }] })
    expect((await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files })).ok).toBe(true)
    expect(writes()).toEqual([])
  })

  it('a plan created by someone else a moment ago is picked up, not reported', async () => {
    setup({
      'tenants.status_plans:select': [{ data: null }, { data: PLAN }],
      'tenants.status_plans:insert': [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "status_plans_project_purpose_key"' } }],
    })
    expect((await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files })).ok).toBe(true)
  })

  it('refuses a non-writer before anything is created or signed', async () => {
    setup({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files }))
      .toEqual({ ok: false, error: expect.stringMatching(/owner, admin or project manager/) })
    expect(writes()).toEqual([])
    expect(storageCalls).toEqual([])
  })

  it('names a file it cannot take, before any database call', async () => {
    setup({})
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files: [{ name: 'E-100.dwg', size: 10, type: '' }] }))
      .toEqual({ ok: false, error: 'E-100.dwg is not a PDF, PNG or JPEG.' })
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files: [{ name: 'big.pdf', size: 61 * 1024 * 1024, type: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'big.pdf is larger than 50 MB.' })
    expect(calls).toEqual([])
  })

  it('a storage refusal is a sentence, not a stack', async () => {
    const f = fakeClient(queued({ 'tenants.status_plans:select': [{ data: PLAN }] }), { storageErrors: { createSignedUploadUrl: 'new row violates row-level security policy' } })
    createClientMock.mockResolvedValue(f.client)
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files }))
      .toEqual({ ok: false, error: 'Could not prepare the upload. Try again.' })
  })
})

describe('registerTenantPlanSheetsAction', () => {
  it('a 3-page PDF becomes three sheets and an image one more, appended after the existing sheets', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:select': [{ data: [{ id: 'old', sort_order: 4 }] }],
    }, { files: { [path(F1)]: await pdf(3), [path(F2, 1, 'png')]: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, echoInsert: true })

    const res = await registerTenantPlanSheetsAction({
      planId: PL,
      files: [
        { path: path(F1), fileName: 'E-300.pdf', mime: 'application/pdf' },
        { path: path(F2, 1, 'png'), fileName: 'Mall GF.png', mime: 'image/png' },
      ],
    })
    expect(res.ok).toBe(true)
    const rows = writes()[0]!.payload as Array<Record<string, unknown>>
    expect(rows.map((r) => [r.sort_order, r.label, r.page_index, r.file_path, r.mime])).toEqual([
      [5, 'Sheet 1 of 3 (E-300)', 1, path(F1), 'application/pdf'],
      [6, 'Sheet 2 of 3 (E-300)', 2, path(F1), 'application/pdf'],
      [7, 'Sheet 3 of 3 (E-300)', 3, path(F1), 'application/pdf'],
      [8, 'Mall GF', 1, path(F2, 1, 'png'), 'image/png'],
    ])
    expect(rows[0]!.id).toBe(F1) // the first sheet of a file is the file's folder
    expect(rows[3]!.id).toBe(F2)
    for (const r of rows) {
      expect(r.status_plan_id).toBe(PL)
      for (const k of ['organisation_id', 'created_by', 'revision', 'replaced_at', 'replaced_from_path']) expect(r).not.toHaveProperty(k)
    }
    if (res.ok) expect(res.data.sheets.map((s) => s.sortOrder)).toEqual([5, 6, 7, 8])
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${P}/tenant-schedule`)
  })

  it('refuses a path outside this plan\'s folder, or not a first revision', async () => {
    for (const bad of [
      `${O}/${P}/${OTHER}/${F1}/1.pdf`,
      `${O}/${OTHER}/${PL}/${F1}/1.pdf`,
      `${OTHER}/${P}/${PL}/${F1}/1.pdf`,
      path(F1, 2),
      path(F1, 1, 'png'),
    ]) {
      setup({ 'tenants.status_plans:select': [{ data: PLAN }] })
      expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: bad, fileName: 'x.pdf', mime: 'application/pdf' }] }), bad)
        .toEqual({ ok: false, error: 'That upload does not belong to this plan. Upload the file again.' })
      expect(writes()).toEqual([])
    }
  })

  it('an object that never arrived, and a PDF that cannot be read, are named', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plan_sheets:select': [{ data: [] }] })
    expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'E-100.pdf', mime: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'E-100.pdf did not finish uploading. Try again.' })
    setup({ 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plan_sheets:select': [{ data: [] }] },
      { files: { [path(F1)]: new TextEncoder().encode('not a pdf') } })
    expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'E-100.pdf', mime: 'application/pdf' }] }))
      .toEqual({ ok: false, error: expect.stringMatching(/^E-100\.pdf could not be read as a PDF/) })
    expect(writes()).toEqual([])
  })

  it('refuses a non-writer', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }] })
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'no' })
    expect((await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'a.pdf', mime: 'application/pdf' }] })).ok).toBe(false)
    expect(writes()).toEqual([])
  })

  it('maps a database refusal to a sentence', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:select': [{ data: [] }],
      'tenants.status_plan_sheets:insert': [{ error: { code: '23514', message: 'status_plan_sheets: the file must be stored under this plan' } }],
    }, { files: { [path(F1)]: await pdf(1) } })
    expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'a.pdf', mime: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'That file does not belong to this plan. Upload it again.' })
  })
})

describe('replace', () => {
  const ctx = { 'tenants.status_plan_sheets:select': [{ data: sheetRow() }], 'tenants.status_plans:select': [{ data: PLAN }] }

  it('prepare clears an abandoned object at the next revision and signs that path', async () => {
    setup(ctx)
    const res = await prepareTenantPlanSheetReplaceAction({ sheetId: SH, file: { name: 'E-100 rev C.jpg', size: 10, type: 'image/jpeg' } })
    expect(res).toEqual({ ok: true, data: { path: path(SH, 2, 'jpg'), token: `tok:${path(SH, 2, 'jpg')}`, mime: 'image/jpeg' } })
    expect(ops('remove')[0]!.args[0]).toEqual([path(SH, 2, 'jpg')])
  })

  it('swaps the file conditionally on updated_at and returns the bumped sheet', async () => {
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ file_path: path(SH, 2), page_index: 2, revision: 2, replaced_at: TS2, updated_at: TS2 }) }] },
      { files: { [path(SH, 2)]: await pdf(2) } })
    const res = await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 2), fileName: 'E-100 rev C.pdf', mime: 'application/pdf', pageIndex: 2 })
    expect(res).toMatchObject({ ok: true, data: { revision: 2, pageIndex: 2, replacedAt: TS2, updatedAt: TS2 } })
    const upd = calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ file_path: path(SH, 2), page_index: 2, file_name: 'E-100 rev C.pdf', mime: 'application/pdf' })
    expect(upd.ops).toContainEqual(['eq', ['id', SH]])
    expect(upd.ops).toContainEqual(['eq', ['updated_at', TS]])
  })

  it('a path for another revision means someone replaced it first', async () => {
    setup(ctx)
    expect(await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 3), fileName: 'a.pdf', mime: 'application/pdf', pageIndex: 1 }))
      .toEqual({ ok: false, error: 'This sheet was changed by someone else — reload to see it.', conflict: true })
  })

  it('a page the new file does not have is refused by name', async () => {
    setup(ctx, { files: { [path(SH, 2)]: await pdf(2) } })
    expect(await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 2), fileName: 'E-100 rev C.pdf', mime: 'application/pdf', pageIndex: 3 }))
      .toEqual({ ok: false, error: 'E-100 rev C.pdf has 2 pages; pick a page from 1 to 2.' })
    expect(writes()).toEqual([])
  })

  it('zero rows with the sheet still there is a conflict', async () => {
    setup({ 'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: { id: SH } }], 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plan_sheets:update': [{ data: null }] },
      { files: { [path(SH, 2)]: await pdf(1) } })
    expect(await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 2), fileName: 'a.pdf', mime: 'application/pdf', pageIndex: 1 }))
      .toEqual({ ok: false, error: 'This sheet was changed by someone else — reload to see it.', conflict: true })
  })
})

describe('re-anchor, rename, scale', () => {
  const ctx = { 'tenants.status_plan_sheets:select': [{ data: sheetRow({ replaced_at: TS2, revision: 2 }) }], 'tenants.status_plans:select': [{ data: PLAN }] }

  it('re-anchor clears the replaced flag, conditionally', async () => {
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ revision: 2, updated_at: TS2 }) }] })
    expect(await reanchorTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })).toMatchObject({ ok: true, data: { replacedAt: null, revision: 2 } })
    const upd = calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ replaced_at: null })
    expect(upd.ops).toContainEqual(['eq', ['updated_at', TS]])
  })

  it('rename trims, refuses blank before any call', async () => {
    setup({})
    expect(await renameTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, label: '   ' })).toEqual({ ok: false, error: 'Give the sheet a name.' })
    expect(calls).toEqual([])
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ label: 'Level 1', updated_at: TS2 }) }] })
    expect(await renameTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, label: '  Level 1 ' })).toMatchObject({ ok: true, data: { label: 'Level 1' } })
    expect(writes()[0]!.payload).toEqual({ label: 'Level 1' })
  })

  it('scale writes the three columns together and returns the sheet', async () => {
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ pixels_per_meter: 20, calibration_points: [0, 0, 100, 0], calibration_metres: 5, updated_at: TS2 }) }] })
    expect(await calibrateTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, points: [0, 0, 100, 0], realMetres: 5 }))
      .toMatchObject({ ok: true, data: { pixelsPerMeter: 20, updatedAt: TS2 } })
    expect(writes()[0]!.payload).toEqual({ pixels_per_meter: 20, calibration_points: [0, 0, 100, 0], calibration_metres: 5 })
  })

  it('a bad distance is refused before any call', async () => {
    setup({})
    expect((await calibrateTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, points: [0, 0, 100, 0], realMetres: 0 })).ok).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('deleteTenantPlanSheetAction', () => {
  it('deletes conditionally and removes a file no other sheet uses', async () => {
    setup({
      'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: [] }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:delete': [{ data: { id: SH, file_path: path(SH), replaced_from_path: null } }],
    })
    expect(await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })).toEqual({ ok: true, data: { id: SH } })
    expect(calls.find((c) => c.op === 'delete')!.ops).toContainEqual(['eq', ['updated_at', TS]])
    expect(ops('remove').map((c) => c.args[0])).toEqual([[path(SH)]])
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${P}/tenant-schedule`)
  })

  it('keeps a file another sheet still shows (page 2 of the same PDF)', async () => {
    setup({
      'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: [{ id: 'sheet-2' }] }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:delete': [{ data: { id: SH, file_path: path(SH), replaced_from_path: null } }],
    })
    expect((await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })).ok).toBe(true)
    expect(ops('remove')).toEqual([])
  })

  it('a sheet already gone says so', async () => {
    setup({ 'tenants.status_plan_sheets:select': [{ data: null }] })
    expect(await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS }))
      .toEqual({ ok: false, error: 'This sheet has been deleted by someone else — reload the page.', conflict: true })
  })
})

describe('signed out', () => {
  it('every action says so', async () => {
    setup({}, { userId: null })
    expect(await renameTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, label: 'x' })).toEqual({ ok: false, error: 'Your session has ended. Sign in again.' })
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files: [{ name: 'a.pdf', size: 1, type: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'Your session has ended. Sign in again.' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/actions/tenant-plan-sheets.actions.test.ts
```

Expected: FAIL — cannot resolve `./tenant-plan-sheets.actions`.

- [ ] **Step 3: Write the actions**

Create `apps/web/src/actions/tenant-plan-sheets.actions.ts`:

```ts
'use server'

/**
 * Tenant plan sheets — upload, replace, re-anchor, rename, delete, scale
 * (spec 2026-10-12 §3, §4).
 *
 * Files never pass through a Vercel function on the way in: the server hands
 * the browser a signed upload URL for a path it builds itself, the browser
 * uploads straight to the private tenant-plan-files bucket, and a second
 * action registers what arrived. Registration reads the object back through
 * the caller's session (the bucket's read policy is the gate) and counts PDF
 * pages itself: a page count the client claims is never trusted. Signed upload
 * URLs are minted with the caller's session, so the bucket's INSERT policy
 * (owner / admin / PM of that project) is checked as that person.
 *
 * Same rules as status-plan.actions.ts:
 *  - { ok, error }, never a thrown sentence (production redacts them);
 *  - requireEffectiveRole(…, ORG_WRITE_ROLES) on the plan's own project, `.ok`;
 *  - edits to an existing sheet are conditional on updated_at in the same
 *    statement; zero rows back is a conflict, never a silent success;
 *  - organisation_id, created_by, revision and replaced_* are never sent:
 *    the 00249 triggers derive them.
 *
 * Only async functions are exported ('use server'); types live in
 * lib/status-plans/types.ts.
 */
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, derivePixelsPerMeter } from '@esite/shared'
import {
  DEFAULT_PLAN_NAME,
  SHEET_LABEL_MAX,
  STATUS_PLAN_PURPOSES,
  TENANT_PLAN_BUCKET,
  TENANT_PLAN_MIMES,
  type StatusPlanPurpose,
  type StatusPlanSheetRow,
  type TenantPlanMime,
} from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHEET_COLUMNS, toSheetSummary } from '@/lib/status-plans/sheet-row'
import {
  MAX_FILES_PER_UPLOAD,
  MAX_SHEETS_PER_PLAN,
  countPdfPages,
  defaultSheetLabels,
  extFor,
  fileProblem,
  mimeForFile,
  parseSheetPath,
  sheetFilePath,
} from '@/lib/status-plans/sheet-files'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'
import type { ActionResult, PreparedUpload, SheetSummary } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const uuid = z.string().uuid()
const updatedAt = z.string().min(1)

const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change tenant plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Reload the page.'
const SHEET_GONE = 'This sheet has been deleted by someone else — reload the page.'
const SHEET_STALE = 'This sheet was changed by someone else — reload to see it.'
const NOT_THIS_PLAN = 'That upload does not belong to this plan. Upload the file again.'
const PREPARE_FAILED = 'Could not prepare the upload. Try again.'

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

const PLAN_CTX = 'id, project_id, organisation_id, purpose'
type PlanCtx = { id: string; project_id: string; organisation_id: string; purpose: StatusPlanPurpose }

async function planById(supabase: any, planId: string): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans').select(PLAN_CTX).eq('id', planId).maybeSingle()
  return (data as PlanCtx | null) ?? null
}

async function planFor(supabase: any, projectId: string, purpose: StatusPlanPurpose): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans').select(PLAN_CTX)
    .eq('project_id', projectId).eq('purpose', purpose).maybeSingle()
  return (data as PlanCtx | null) ?? null
}

/** The project's plan for this purpose, created on the first upload. */
async function ensurePlan(supabase: any, projectId: string, purpose: StatusPlanPurpose): Promise<PlanCtx | Fail> {
  const existing = await planFor(supabase, projectId, purpose)
  if (existing) return existing
  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .insert({ project_id: projectId, purpose, name: DEFAULT_PLAN_NAME[purpose] })
    .select(PLAN_CTX).maybeSingle()
  if (error?.code === '23505') {
    // Someone else created it a moment ago (unique project + purpose).
    const again = await planFor(supabase, projectId, purpose)
    if (again) return again
  }
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(NOT_ALLOWED)
  return data as PlanCtx
}

type SheetCtx = { sheet: StatusPlanSheetRow; plan: PlanCtx }

async function sheetContext(supabase: any, sheetId: string): Promise<SheetCtx | Fail> {
  const { data: sheet } = await supabase.schema('tenants').from('status_plan_sheets')
    .select(SHEET_COLUMNS).eq('id', sheetId).maybeSingle()
  if (!sheet) return fail(SHEET_GONE, true)
  const plan = await planById(supabase, (sheet as StatusPlanSheetRow).status_plan_id)
  if (!plan) return fail(PLAN_GONE)
  return { sheet: sheet as StatusPlanSheetRow, plan }
}

/** A conditional write answered zero rows: moved on, or deleted? */
async function staleOrGone(supabase: any, sheetId: string): Promise<Fail> {
  const { data } = await supabase.schema('tenants').from('status_plan_sheets').select('id').eq('id', sheetId).maybeSingle()
  return data ? fail(SHEET_STALE, true) : fail(SHEET_GONE, true)
}

/** Read an uploaded object back through the caller's session. */
async function readUpload(supabase: any, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(TENANT_PLAN_BUCKET).download(path)
  if (error || !data) return null
  return new Uint8Array(await (data as Blob).arrayBuffer())
}

async function pagesOf(bytes: Uint8Array, mime: TenantPlanMime): Promise<number | null> {
  return mime === 'application/pdf' ? countPdfPages(bytes) : 1
}

/** Delete a file only when no sheet of this plan still shows it or remembers it. */
async function removeUnreferencedFiles(supabase: any, planId: string, paths: Array<string | null>): Promise<void> {
  for (const path of new Set(paths.filter((p): p is string => !!p))) {
    const [a, b] = await Promise.all([
      supabase.schema('tenants').from('status_plan_sheets').select('id').eq('status_plan_id', planId).eq('file_path', path).limit(1),
      supabase.schema('tenants').from('status_plan_sheets').select('id').eq('status_plan_id', planId).eq('replaced_from_path', path).limit(1),
    ])
    if (a.error || b.error || (a.data ?? []).length > 0 || (b.data ?? []).length > 0) continue
    const { error } = await supabase.storage.from(TENANT_PLAN_BUCKET).remove([path])
    if (error) console.error('[tenant-plans] could not remove an unused sheet file', error.message)
  }
}

const fileSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  type: z.string().max(100),
})

// ── Upload ─────────────────────────────────────────────────────────────────

const prepareSchema = z.object({
  projectId: uuid,
  purpose: z.enum(STATUS_PLAN_PURPOSES),
  files: z.array(fileSchema)
    .min(1, 'Choose at least one file.')
    .max(MAX_FILES_PER_UPLOAD, `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`),
})

export async function prepareTenantPlanUploadAction(
  input: z.input<typeof prepareSchema>,
): Promise<ActionResult<{ planId: string; uploads: PreparedUpload[] }>> {
  const parsed = prepareSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  for (const f of parsed.data.files) {
    const problem = fileProblem(f)
    if (problem) return fail(problem)
  }
  const { projectId, purpose, files } = parsed.data
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  if (!(await mayWrite(supabase, projectId))) return fail(NOT_ALLOWED)

  const plan = await ensurePlan(supabase, projectId, purpose)
  if ('ok' in plan) return plan

  const uploads: PreparedUpload[] = []
  for (const f of files) {
    const mime = mimeForFile(f.name, f.type)!
    const path = sheetFilePath({ orgId: plan.organisation_id, projectId: plan.project_id, planId: plan.id, folderId: randomUUID(), revision: 1, mime })
    const { data, error } = await supabase.storage.from(TENANT_PLAN_BUCKET).createSignedUploadUrl(path, { upsert: false })
    if (error || !data?.token) return fail(PREPARE_FAILED)
    uploads.push({ path, token: data.token as string, mime })
  }
  return { ok: true, data: { planId: plan.id, uploads } }
}

const registerSchema = z.object({
  planId: uuid,
  files: z.array(z.object({
    path: z.string().min(1).max(400),
    fileName: z.string().trim().min(1).max(255),
    mime: z.enum(TENANT_PLAN_MIMES),
  })).min(1).max(MAX_FILES_PER_UPLOAD),
})

export async function registerTenantPlanSheetsAction(
  input: z.input<typeof registerSchema>,
): Promise<ActionResult<{ sheets: SheetSummary[] }>> {
  const parsed = registerSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planById(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  const files = parsed.data.files
  if (new Set(files.map((f) => f.path)).size !== files.length) return fail(NOT_THIS_PLAN)
  for (const f of files) {
    const parts = parseSheetPath(f.path)
    if (!parts || parts.orgId !== plan.organisation_id || parts.projectId !== plan.project_id || parts.planId !== plan.id
      || parts.revision !== 1 || parts.ext !== extFor(f.mime)) {
      return fail(NOT_THIS_PLAN)
    }
  }

  const { data: existing, error: exErr } = await supabase.schema('tenants').from('status_plan_sheets')
    .select('id, sort_order').eq('status_plan_id', plan.id)
  if (exErr) return fail('The plan could not be read. Reload and try again.')
  const current = (existing ?? []) as Array<{ sort_order: number }>
  let next = current.reduce((m, r) => Math.max(m, Number(r.sort_order) + 1), 0)

  const rows: Array<Record<string, unknown>> = []
  for (const f of files) {
    const bytes = await readUpload(supabase, f.path)
    if (!bytes) return fail(`${f.fileName} did not finish uploading. Try again.`)
    const pages = await pagesOf(bytes, f.mime)
    if (!pages) return fail(`${f.fileName} could not be read as a PDF. Save it again from the drawing program and upload it.`)
    const labels = defaultSheetLabels(f.fileName, pages)
    const folderId = parseSheetPath(f.path)!.folderId
    for (let page = 1; page <= pages; page++) {
      rows.push({
        id: page === 1 ? folderId : randomUUID(),
        status_plan_id: plan.id,
        sort_order: next++,
        label: labels[page - 1],
        file_path: f.path,
        page_index: page,
        file_name: f.fileName,
        mime: f.mime,
      })
    }
  }
  if (current.length + rows.length > MAX_SHEETS_PER_PLAN) {
    return fail(`A plan holds at most ${MAX_SHEETS_PER_PLAN} sheets; this upload would make ${current.length + rows.length}.`)
  }

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets').insert(rows).select(SHEET_COLUMNS)
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  const saved = ((data ?? []) as StatusPlanSheetRow[]).map(toSheetSummary).sort((a, b) => a.sortOrder - b.sortOrder)
  if (saved.length !== rows.length) return fail('The sheets may not all have been saved. Reload the page.')
  revalidatePath(tenantScheduleHref(plan.project_id))
  return { ok: true, data: { sheets: saved } }
}

// ── Replace and re-anchor ──────────────────────────────────────────────────

export async function prepareTenantPlanSheetReplaceAction(
  input: { sheetId: string; file: z.input<typeof fileSchema> },
): Promise<ActionResult<PreparedUpload>> {
  const parsed = z.object({ sheetId: uuid, file: fileSchema }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const problem = fileProblem(parsed.data.file)
  if (problem) return fail(problem)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, parsed.data.sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const mime = mimeForFile(parsed.data.file.name, parsed.data.file.type)!
  const path = sheetFilePath({
    orgId: ctx.plan.organisation_id, projectId: ctx.plan.project_id, planId: ctx.plan.id,
    folderId: ctx.sheet.id, revision: Number(ctx.sheet.revision) + 1, mime,
  })
  // A replacement abandoned half-way leaves its object here; no sheet can show
  // a revision it has not reached, so clearing it is safe.
  await supabase.storage.from(TENANT_PLAN_BUCKET).remove([path])
  const { data, error } = await supabase.storage.from(TENANT_PLAN_BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (error || !data?.token) return fail(PREPARE_FAILED)
  return { ok: true, data: { path, token: data.token as string, mime } }
}

const replaceSchema = z.object({
  sheetId: uuid,
  expectedUpdatedAt: updatedAt,
  path: z.string().min(1).max(400),
  fileName: z.string().trim().min(1).max(255),
  mime: z.enum(TENANT_PLAN_MIMES),
  pageIndex: z.number().int().min(1, 'Pages are numbered from 1.').max(100000),
})

export async function replaceTenantPlanSheetAction(input: z.input<typeof replaceSchema>): Promise<ActionResult<SheetSummary>> {
  const parsed = replaceSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { sheetId, expectedUpdatedAt, path, fileName, mime, pageIndex } = parsed.data
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const parts = parseSheetPath(path)
  const mine = parts && parts.orgId === ctx.plan.organisation_id && parts.projectId === ctx.plan.project_id
    && parts.planId === ctx.plan.id && parts.folderId === ctx.sheet.id && parts.ext === extFor(mime)
  if (!mine) return fail(NOT_THIS_PLAN)
  if (parts!.revision !== Number(ctx.sheet.revision) + 1) return fail(SHEET_STALE, true)

  if (mime !== 'application/pdf' && pageIndex !== 1) return fail('An image has one page.')
  const bytes = await readUpload(supabase, path)
  if (!bytes) return fail(`${fileName} did not finish uploading. Try again.`)
  const pages = await pagesOf(bytes, mime)
  if (!pages) return fail(`${fileName} could not be read as a PDF. Save it again from the drawing program and upload it.`)
  if (pageIndex > pages) return fail(`${fileName} has ${pages} page${pages === 1 ? '' : 's'}; pick a page from 1 to ${pages}.`)

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets')
    .update({ file_path: path, page_index: pageIndex, file_name: fileName, mime })
    .eq('id', sheetId)
    .eq('updated_at', expectedUpdatedAt)
    .select(SHEET_COLUMNS)
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  if (!data) return staleOrGone(supabase, sheetId)
  revalidatePath(tenantScheduleHref(ctx.plan.project_id))
  return { ok: true, data: toSheetSummary(data as StatusPlanSheetRow) }
}

/** "The file changed; I have checked the shapes": clear the replaced flag. Masks and scale stay. */
export async function reanchorTenantPlanSheetAction(input: { sheetId: string; expectedUpdatedAt: string }): Promise<ActionResult<SheetSummary>> {
  return patchSheet(input, { replaced_at: null })
}

export async function renameTenantPlanSheetAction(
  input: { sheetId: string; expectedUpdatedAt: string; label: string },
): Promise<ActionResult<SheetSummary>> {
  const parsed = z.object({
    label: z.string().trim().min(1, 'Give the sheet a name.').max(SHEET_LABEL_MAX, `Keep the sheet name under ${SHEET_LABEL_MAX} characters.`),
  }).safeParse({ label: input.label })
  if (!parsed.success) return invalid(parsed.error)
  return patchSheet(input, { label: parsed.data.label })
}

const calibrateSchema = z.object({
  sheetId: uuid,
  expectedUpdatedAt: updatedAt,
  points: z.array(z.number().finite()).length(4, 'Pick two points first.'),
  realMetres: z.number().positive('Enter a positive distance in metres.').max(10000, 'That distance is too large.'),
})

/** Set this sheet's scale from two points and the real distance between them. */
export async function calibrateTenantPlanSheetAction(input: z.input<typeof calibrateSchema>): Promise<ActionResult<SheetSummary>> {
  const parsed = calibrateSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  let ppm: number
  try {
    ppm = derivePixelsPerMeter(parsed.data.points, parsed.data.realMetres)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The scale could not be worked out. Pick the two points again.')
  }
  return patchSheet(parsed.data, {
    pixels_per_meter: ppm,
    calibration_points: parsed.data.points,
    calibration_metres: parsed.data.realMetres,
  })
}

/** One conditional UPDATE of an existing sheet, gated on the plan's project. */
async function patchSheet(
  input: { sheetId: string; expectedUpdatedAt: string },
  patch: Record<string, unknown>,
): Promise<ActionResult<SheetSummary>> {
  const parsed = z.object({ sheetId: uuid, expectedUpdatedAt: updatedAt }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, parsed.data.sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets')
    .update(patch)
    .eq('id', parsed.data.sheetId)
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select(SHEET_COLUMNS)
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  if (!data) return staleOrGone(supabase, parsed.data.sheetId)
  return { ok: true, data: toSheetSummary(data as StatusPlanSheetRow) }
}

// ── Delete ─────────────────────────────────────────────────────────────────

/** Delete a sheet and (ON DELETE CASCADE) every shape on it; remove its file once nothing uses it. */
export async function deleteTenantPlanSheetAction(input: { sheetId: string; expectedUpdatedAt: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ sheetId: uuid, expectedUpdatedAt: updatedAt }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, parsed.data.sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets')
    .delete()
    .eq('id', parsed.data.sheetId)
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select('id, file_path, replaced_from_path')
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  if (!data) return staleOrGone(supabase, parsed.data.sheetId)
  await removeUnreferencedFiles(supabase, ctx.plan.id, [data.file_path as string, (data.replaced_from_path as string | null) ?? null])
  revalidatePath(tenantScheduleHref(ctx.plan.project_id))
  return { ok: true, data: { id: parsed.data.sheetId } }
}
```

`patchSheet` is a non-exported async function, which a `'use server'` file may contain. It is declared after its first use; function declarations hoist.

- [ ] **Step 4: Run it**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/actions/tenant-plan-sheets.actions.test.ts
```

Expected: PASS (24 tests). If the delete test sees no `remove` call, check that the second queued `status_plan_sheets:select` entry (`{ data: [] }`) is what both reference reads return (the queue repeats its last entry).

- [ ] **Step 5: Role-gate and server-action contracts**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/auth/role-gate-call-sites.contract.test.ts src/lib/auth/service-client-gates.contract.test.ts
```

Expected: PASS. The role-gate call-site contract looks for `.ok` near each `requireEffectiveRole` call (`mayWrite` reads `gate.ok` on the next line). The file uses no service client, so the service-client gate contract does not list it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/actions/tenant-plan-sheets.actions.ts apps/web/src/actions/tenant-plan-sheets.actions.test.ts
git commit -m "feat(tenant-plans): direct-to-storage upload and sheet actions

prepare (signed upload URLs under the plan's folder, plan created on first
upload), register (pages counted server-side, N pages -> N sheets, files
appended in order), replace / re-anchor / rename / scale (conditional on
updated_at), delete (cascades shapes, removes the file once unused).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase D — The engine reads sheets

### Task D1: Shapes carry their sheet

**Files:**
- Modify: `apps/web/src/lib/status-plans/canvas-shape.ts` (+ `canvas-shape.test.ts`)
- Modify (test fixtures only): `lib/status-plans/node-options.test.ts`, `lib/status-plans/shape-view.test.ts`

- [ ] **Step 1: Update the test (red)**

In `canvas-shape.test.ts`, add `sheet_id: 'sh1',` to `ROW` (after `status_plan_id`), and `sheetId: 'sh1',` to the expected object in `keeps every coordinate exactly…` (after `id: 's1',`). Add one assertion at the end of that `it`:

```ts
    expect(SHAPE_COLUMNS.split(', ')).toContain('sheet_id')
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/canvas-shape.test.ts
```

Expected: FAIL (`sheetId` missing; `sheet_id` not selected).

- [ ] **Step 2: Edit `canvas-shape.ts`**

```ts
export const SHAPE_COLUMNS =
  'id, status_plan_id, sheet_id, shape, points, node_id, area_type, detected_tag, source, created_by, created_at, updated_at'
```

and in `toCanvasShape`, add `sheetId: row.sheet_id,` after `id: row.id,`.

- [ ] **Step 3: Give the other test factories a sheet**

`CanvasShape` now requires `sheetId`, and `apps/web/tsconfig.json` type-checks test files. Add `sheetId: 'sh1',` to the `CanvasShape` factory in `lib/status-plans/node-options.test.ts` (the `const s = (id, nodeId): CanvasShape => ({` literal) and in `lib/status-plans/shape-view.test.ts` (the `const shape = (o) => ({` literal, before `...o`).

- [ ] **Step 4: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/canvas-shape.test.ts src/lib/status-plans/node-options.test.ts src/lib/status-plans/shape-view.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/canvas-shape.ts apps/web/src/lib/status-plans/canvas-shape.test.ts apps/web/src/lib/status-plans/node-options.test.ts apps/web/src/lib/status-plans/shape-view.test.ts
git commit -m "refactor(status-plans): canvas shapes carry their sheet id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D2: Shape actions create on a sheet; plan-level actions go

**Files:**
- Modify (rewrite): `apps/web/src/actions/status-plan.actions.ts`
- Modify: `apps/web/src/actions/status-plan.actions.test.ts`

Plans are now created by the first upload (`prepareTenantPlanUploadAction`) and there is one per purpose, so `createStatusPlanAction`, `renameStatusPlanAction`, `deleteStatusPlanAction` and `reanchorStatusPlanAction` are removed (re-anchoring is per sheet now). No UI calls rename or delete of a whole plan any more.

- [ ] **Step 1: Update the test (red)**

In `status-plan.actions.test.ts`:

1. Replace the import of the actions with:

```ts
import {
  createStatusPlanShapeAction,
  updateStatusPlanShapeAction,
  deleteStatusPlanShapeAction,
} from './status-plan.actions'
```

2. Replace `const FP = …` with `const SH = '22222222-2222-4222-8222-222222222222'`, `const PLAN = …` with `const PLAN = { id: PL, project_id: P, purpose: 'tenant_layout' }`, and add `sheet_id: SH,` to `SHAPE_ROW` after `status_plan_id: PL,`.
3. Delete the whole `describe('createStatusPlanAction', …)` and `describe('plan rename / delete / re-anchor', …)` blocks.
4. Replace `describe('createStatusPlanShapeAction', …)` with:

```ts
describe('createStatusPlanShapeAction', () => {
  const ctx = {
    'tenants.status_plan_sheets:select': [{ data: { id: SH, status_plan_id: PL } }],
    'tenants.status_plans:select': [{ data: PLAN }],
  }

  it('creates on the sheet asked for: rounds points, validates them, returns the stored shape', async () => {
    setup({ ...ctx, 'tenants.status_plan_shapes:insert': [{ data: SHAPE_ROW }] })
    const res = await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI })
    expect(res).toMatchObject({ ok: true, data: { id: S, sheetId: SH, points: [10, 10, 200.12, 10, 200, 150], updatedAt: TS } })
    expect(writes()[0]!.payload).toEqual({
      status_plan_id: PL, sheet_id: SH, shape: 'polygon', points: [10, 10, 200.12, 10, 200, 150], node_id: null, area_type: null, source: 'manual',
    })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
  })

  it('refuses a rectangle that is not 4 corners without a round trip', async () => {
    setup({})
    const res = await createStatusPlanShapeAction({ sheetId: SH, shape: 'rect', points: TRI })
    expect(res.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses an area type on a line diagram', async () => {
    setup({ ...ctx, 'tenants.status_plans:select': [{ data: { ...PLAN, purpose: 'distribution_schematic' } }] })
    expect(await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI, areaType: 'common' }))
      .toMatchObject({ ok: false, error: 'Area types are for the floor plan only.' })
    expect(writes()).toEqual([])
  })

  it('a sheet that is gone says so', async () => {
    setup({ 'tenants.status_plan_sheets:select': [{ data: null }] })
    expect(await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/sheet no longer exists/) })
  })

  it('a non-writer writes nothing', async () => {
    setup(ctx)
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    expect(await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI }))
      .toEqual({ ok: false, error: expect.stringMatching(/owner, admin or project manager/) })
    expect(writes()).toEqual([])
  })
})
```

The `updateStatusPlanShapeAction` / `deleteStatusPlanShapeAction` blocks stay as they are (their `PLAN` no longer has `floor_plan_id`, which they never read).

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/actions/status-plan.actions.test.ts
```

Expected: FAIL (`createStatusPlanShapeAction` still takes `planId`).

- [ ] **Step 2: Rewrite `status-plan.actions.ts`**

```ts
'use server'

/**
 * Tenant plans — the shape write path (spec 2026-10-09 §7, §9; 2026-10-12 §5).
 *
 * Every action:
 *  - returns { ok, error } and never throws for an expected refusal. Next.js
 *    replaces a thrown message with a generic sentence in production (PR #266).
 *  - gates on requireEffectiveRole(…, ORG_WRITE_ROLES) and reads `.ok`: the
 *    helper returns an OBJECT, so a truthiness check would gate nothing.
 *    The RESTRICTIVE per-verb policies of 00245 are the database backstop.
 *  - never sends organisation_id or created_by: the triggers bind them.
 *  - turns a Postgres refusal into a sentence (lib/status-plans/write-errors).
 *
 * A shape is created on a SHEET; the plan is read from the sheet on the server,
 * and the 00249 trigger refuses a sheet of another plan. Shape writes carry the
 * row's updated_at and are CONDITIONAL on it (`.eq('updated_at', expected)`), so
 * the stale check and the write are one statement. Zero rows back means
 * someone else moved or deleted the shape.
 *
 * Shape actions do NOT call revalidatePath: the canvas page folds each result
 * into its own state, and a revalidation would re-render the page under the
 * canvas and re-mint the sheet's signed URL (the router.refresh() trap).
 *
 * Plans are created by the first upload (tenant-plan-sheets.actions.ts); sheet
 * edits live there too. This file exports async functions only.
 */
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { AREA_TYPES, SHAPE_KINDS, pointsError } from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHAPE_COLUMNS, roundPoints, shapePatchRow, toCanvasShape } from '@/lib/status-plans/canvas-shape'
import type { ActionResult, CanvasShape } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const uuid = z.string().uuid()

const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change tenant plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Reload the page.'
const SHEET_GONE = 'That sheet no longer exists. Reload the page.'
const SHAPE_GONE = 'This shape has been deleted by someone else — reload to see the plan.'
const SHAPE_STALE = 'This shape was changed by someone else — reload to see it.'
const AREA_FLOOR_ONLY = 'Area types are for the floor plan only.'

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

type PlanCtx = { id: string; project_id: string; purpose: string }

async function planContext(supabase: any, planId: string): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans')
    .select('id, project_id, purpose').eq('id', planId).maybeSingle()
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

const createShapeSchema = z
  .object({
    sheetId: uuid,
    shape: z.enum(SHAPE_KINDS),
    points: z.array(z.number()),
    nodeId: uuid.nullable().optional(),
    areaType: z.enum(AREA_TYPES).nullable().optional(),
  })
  .refine((v) => !(v.nodeId && v.areaType), { message: 'A shape is either a shop or an area, not both.' })

export async function createStatusPlanShapeAction(input: z.input<typeof createShapeSchema>): Promise<ActionResult<CanvasShape>> {
  const parsed = createShapeSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { sheetId, shape, nodeId, areaType } = parsed.data
  const points = roundPoints(parsed.data.points)
  const bad = pointsError(shape, points)
  if (bad) return fail(bad)

  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const { data: sheet } = await supabase.schema('tenants').from('status_plan_sheets')
    .select('id, status_plan_id').eq('id', sheetId).maybeSingle()
  if (!sheet) return fail(SHEET_GONE)
  const plan = await planContext(supabase, sheet.status_plan_id)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)
  if (areaType && plan.purpose !== 'tenant_layout') return fail(AREA_FLOOR_ONLY)

  const { data, error } = await supabase.schema('tenants').from('status_plan_shapes')
    .insert({ status_plan_id: plan.id, sheet_id: sheetId, shape, points, node_id: nodeId ?? null, area_type: areaType ?? null, source: 'manual' })
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
  if (areaType && ctx.plan.purpose !== 'tenant_layout') return fail(AREA_FLOOR_ONLY)

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

- [ ] **Step 3: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/actions/status-plan.actions.test.ts
```

Expected: PASS. If an update test's "maps board already on this plan" or similar asserts an old sentence, the sentence for `status_plan_shapes_plan_node_key` is unchanged; only the area-type and tenant-board sentences changed (Task C4).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/actions/status-plan.actions.ts apps/web/src/actions/status-plan.actions.test.ts
git commit -m "refactor(tenant-plans): shapes are created on a sheet; plan-level actions removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D3: Detected blocks are accepted onto a sheet

**Files:**
- Modify: `apps/web/src/actions/status-plan-detection.actions.ts`
- Modify: `apps/web/src/actions/status-plan-detection.actions.test.ts`

- [ ] **Step 1: Update the test (red)**

In `status-plan-detection.actions.test.ts`:

1. Add `const SHEET_ID = '66666666-6666-4666-8666-666666666666'` under `PLAN_ID`.
2. `const SCHEMATIC = { id: PLAN_ID, project_id: PROJECT_ID, purpose: 'distribution_schematic' }` (drop `floor_plan_id`).
3. In `shapeRow`, add `sheet_id: SHEET_ID,` after `status_plan_id: PLAN_ID,`.
4. Every action call: `planId: PLAN_ID` → `sheetId: SHEET_ID`.

```bash
perl -0pi -e "s/planId: PLAN_ID/sheetId: SHEET_ID/g" apps/web/src/actions/status-plan-detection.actions.test.ts
```

5. Every `setup({...})` map that contains `'tenants.status_plans:select'` gains, as its first key:

```ts
      'tenants.status_plan_sheets:select': [{ data: { id: SHEET_ID, status_plan_id: PLAN_ID } }],
```

6. Every expected insert row gains `sheet_id: SHEET_ID,` after `status_plan_id: PLAN_ID,`.
7. Any test asserting a plan that is gone (`PLAN_GONE` sentence) now queues `'tenants.status_plan_sheets:select': [{ data: null }]` and expects `'That sheet no longer exists. Reload the page.'`.

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/actions/status-plan-detection.actions.test.ts
```

Expected: FAIL (the action still reads `planId`).

- [ ] **Step 2: Edit the action**

In `status-plan-detection.actions.ts`:

Replace

```ts
const inputSchema = z.object({
  planId: z.string().uuid(),
  blocks: z.array(blockSchema).min(1).max(MAX_BATCH),
})
```

with

```ts
const inputSchema = z.object({
  sheetId: z.string().uuid(),
  blocks: z.array(blockSchema).min(1).max(MAX_BATCH),
})
```

add `const SHEET_GONE = 'That sheet no longer exists. Reload the page.'` next to `PLAN_GONE`, and replace the block from `const { data: plan } = await supabase.schema('tenants').from('status_plans')` through the `rows` construction with:

```ts
  const { data: sheet } = await supabase.schema('tenants').from('status_plan_sheets')
    .select('id, status_plan_id').eq('id', parsed.data.sheetId).maybeSingle()
  if (!sheet) return { ok: false, error: SHEET_GONE }
  const { data: plan } = await supabase.schema('tenants').from('status_plans')
    .select('id, project_id, purpose').eq('id', sheet.status_plan_id).maybeSingle()
  if (!plan) return { ok: false, error: PLAN_GONE }
  if (plan.purpose !== 'distribution_schematic') {
    return { ok: false, error: 'Block detection is only for the line diagram.' }
  }

  const gate = await requireEffectiveRole(supabase, plan.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { ok: false, error: NOT_ALLOWED }

  const rows = blocks.map((b) => ({
    status_plan_id: plan.id as string,
    sheet_id: parsed.data.sheetId,
    shape: 'rect' as const,
    points: b.points,
    node_id: b.nodeId,
    area_type: null,
    detected_tag: b.detectedTag,
    source: 'detected' as const,
  }))
```

Update `NOT_ALLOWED` to `'Only an owner, admin or project manager can change tenant plans on this project.'` and the header comment's "onto a distribution-schematic status plan" to "onto a line-diagram sheet". If a test asserts the old purpose sentence `Block detection is only for distribution schematic plans.`, update it to the new one.

- [ ] **Step 3: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/actions/status-plan-detection.actions.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/actions/status-plan-detection.actions.ts apps/web/src/actions/status-plan-detection.actions.test.ts
git commit -m "refactor(tenant-plans): detected blocks are accepted onto a line-diagram sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D4: The page loader reads the plan by purpose, then its sheets

**Files:**
- Modify (rewrite): `apps/web/src/lib/status-plans/load-plan-page.ts`
- Modify (rewrite): `apps/web/src/lib/status-plans/load-plan-page.test.ts`

- [ ] **Step 1: Rewrite the test (red)**

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

import { loadTenantPlanPage, pickSheet } from './load-plan-page'

const PLAN_ROW = {
  id: 'pl1', project_id: 'p1', organisation_id: 'org-1', purpose: 'tenant_layout', name: 'Floor plan',
  created_by: 'u', created_at: 't0', updated_at: 't1',
}
const sheetRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, status_plan_id: 'pl1', organisation_id: 'org-1', sort_order: 0, label: `Sheet ${id}`, file_path: `org-1/p1/pl1/${id}/1.pdf`,
  page_index: 1, file_name: 'E-100.pdf', mime: 'application/pdf', revision: 1, replaced_at: null, replaced_from_path: null,
  pixels_per_meter: '20', calibration_points: [0, 0, 100, 0], calibration_metres: '5', created_by: 'u', created_at: 't0', updated_at: 'u0',
  ...over,
})
const SHAPE_ROW = {
  id: 's1', status_plan_id: 'pl1', sheet_id: 'sh1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260],
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
    'projects.projects:select': [{ data: { id: 'p1', organisation_id: 'org-1', opening_date: '2026-09-01' } }],
    'tenants.status_plans:select': [{ data: PLAN_ROW }],
    'tenants.status_plan_sheets:select': [{ data: [sheetRow('sh1'), sheetRow('sh2', { sort_order: 1, page_index: 2, pixels_per_meter: null, calibration_points: null, calibration_metres: null })] }],
    'tenants.status_plan_shapes:select': [{ data: [SHAPE_ROW, { ...SHAPE_ROW, id: 's2', sheet_id: 'sh2', node_id: null }] }],
    'structure.nodes:select': [{ data: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shop_number: 'ZZ01', shop_name: 'Lantern Books', name: null, shop_area_m2: '80.00', status: 'active' }] }],
    ...o,
  }
}
const args = (o: Partial<Parameters<typeof loadTenantPlanPage>[1]> = {}) =>
  ({ projectId: 'p1', purpose: 'tenant_layout' as const, requestedSheetId: null, requestedShapeId: null, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
  loadTenantShopFactsMock.mockResolvedValue(FACTS)
  loadProjectDbOrderStatusMock.mockResolvedValue({ m1: 'ordered' })
})

describe('loadTenantPlanPage', () => {
  it('assembles JSON-only props: every sheet, the first sheet open, every shape', async () => {
    const { client, calls } = fakeClient(queued(tables()))
    const data = await loadTenantPlanPage(client, args())
    expect(data?.kind).toBe('plan')
    if (data?.kind !== 'plan') return
    const props = data.props
    expect(jsonUnsafePath(props)).toBeNull()
    expect(JSON.parse(JSON.stringify(props))).toEqual(props)
    expect(props.plan).toEqual({ id: 'pl1', name: 'Floor plan', purpose: 'tenant_layout', updatedAt: 't1' })
    expect(props.sheets.map((s) => [s.id, s.pixelsPerMeter])).toEqual([['sh1', 20], ['sh2', null]])
    expect(props.sheet).toMatchObject({ id: 'sh1', pageIndex: 1, isPdf: true, signedUrl: 'https://signed.test/tenant-plan-files/org-1/p1/pl1/sh1/1.pdf' })
    expect(props.shapes.map((s) => [s.id, s.sheetId])).toEqual([['s1', 'sh1'], ['s2', 'sh2']])
    expect(props.shopLinks.n1).toEqual({ state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } })
    expect(props.canEdit).toBe(true)
    expect(opsOf(calls, 'tenants.status_plans')).toEqual(expect.arrayContaining([['eq', ['project_id', 'p1']], ['eq', ['purpose', 'tenant_layout']]]))
    expect(opsOf(calls, 'tenants.status_plan_sheets')).toContainEqual(['order', ['sort_order']])
    expect(opsOf(calls, 'structure.nodes')).toContainEqual(['eq', ['kind', 'tenant_db']])
  })

  it('?sheet= opens that sheet; ?shape= alone opens the shape\'s sheet and selects it', async () => {
    const a = fakeClient(queued(tables()))
    const onSecond = await loadTenantPlanPage(a.client, args({ requestedSheetId: 'sh2' }))
    expect(onSecond?.kind === 'plan' && onSecond.props.sheet.id).toBe('sh2')
    const b = fakeClient(queued(tables()))
    const viaShape = await loadTenantPlanPage(b.client, args({ requestedShapeId: 's2' }))
    expect(viaShape?.kind === 'plan' && [viaShape.props.sheet.id, viaShape.props.initialShapeId]).toEqual(['sh2', 's2'])
  })

  it('a ?shape= on another sheet than ?sheet= selects nothing', async () => {
    const { client } = fakeClient(queued(tables()))
    const data = await loadTenantPlanPage(client, args({ requestedSheetId: 'sh1', requestedShapeId: 's2' }))
    expect(data?.kind === 'plan' && data.props.initialShapeId).toBeNull()
  })

  it('no plan yet, or a plan with no sheets, is the empty state with the caller\'s edit right', async () => {
    const a = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: null }] })))
    expect(await loadTenantPlanPage(a.client, args())).toEqual({ kind: 'empty', empty: { projectId: 'p1', purpose: 'tenant_layout', canEdit: true } })
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'no' })
    const b = fakeClient(queued(tables({ 'tenants.status_plan_sheets:select': [{ data: [] }] })))
    expect(await loadTenantPlanPage(b.client, args())).toEqual({ kind: 'empty', empty: { projectId: 'p1', purpose: 'tenant_layout', canEdit: false } })
  })

  it('a line diagram reads every live node and DB orders, not tenant facts', async () => {
    const { client, calls } = fakeClient(queued(tables({ 'tenants.status_plans:select': [{ data: { ...PLAN_ROW, purpose: 'distribution_schematic' } }] })))
    const data = await loadTenantPlanPage(client, args({ purpose: 'distribution_schematic' }))
    expect(data?.kind === 'plan' && data.props.dbOrders).toEqual({ m1: 'ordered' })
    expect(opsOf(calls, 'structure.nodes')).not.toContainEqual(['eq', ['kind', 'tenant_db']])
    expect(loadTenantShopFactsMock).not.toHaveBeenCalled()
  })

  it('null (→ 404) when the project is invisible', async () => {
    const { client } = fakeClient(queued(tables({ 'projects.projects:select': [{ data: null }] })))
    expect(await loadTenantPlanPage(client, args())).toBeNull()
  })

  it('today is the Johannesburg date, not the UTC one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T23:30:00Z'))
    try {
      const { client } = fakeClient(queued(tables()))
      const data = await loadTenantPlanPage(client, args())
      expect(data?.kind === 'plan' && data.props.today).toBe('2026-10-10')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('pickSheet', () => {
  const sheets = [{ id: 'a' }, { id: 'b' }] as never[]
  it('asked-for sheet, else the shape\'s sheet, else the first', () => {
    expect((pickSheet(sheets, [], 'b', null) as { id: string }).id).toBe('b')
    expect((pickSheet(sheets, [{ id: 's', sheetId: 'b' }] as never[], 'zz', 's') as { id: string }).id).toBe('b')
    expect((pickSheet(sheets, [], null, null) as { id: string }).id).toBe('a')
  })
})
```

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/load-plan-page.test.ts
```

Expected: FAIL (`loadTenantPlanPage` / `pickSheet` not exported).

- [ ] **Step 2: Rewrite `load-plan-page.ts`**

```ts
/**
 * Everything a tenant plan route needs, read through the CALLER'S session:
 * RLS and site scope (00238, 00245, 00249) are the read gate, so a project the
 * caller may not see answers null and the page 404s. No service client; the
 * sheet's signed URL is minted through the session too (the bucket's read
 * policy admits every project member).
 *
 * buildStatusPlanPageProps is the only place the canvas props are assembled,
 * and it produces JSON only (checked in the test with jsonUnsafePath): the
 * route pages spread its result into one client component and add nothing.
 */
import { ORG_WRITE_ROLES } from '@esite/shared'
import {
  TENANT_PLAN_BUCKET,
  statusPlanFromRow,
  type NodeOrderStatus,
  type ShopLink,
  type StatusPlan,
  type StatusPlanPurpose,
  type StatusPlanRow,
  type StatusPlanShapeRow,
  type StatusPlanSheetRow,
} from '@esite/shared/status-plans'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { readAll } from '@/lib/tender/read-all'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { shopLinkFor } from './shop-link'
import { loadProjectDbOrderStatus } from './project-db-orders'
import { SHAPE_COLUMNS, toCanvasShape } from './canvas-shape'
import { SHEET_COLUMNS, toSheetSummary } from './sheet-row'
import type { CanvasShape, PlanNode, SheetSummary, StatusPlanPageProps, TenantPlanEmptyProps } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SIGNED_URL_SECONDS = 3600
export const PLAN_COLUMNS = 'id, project_id, organisation_id, purpose, name, created_by, created_at, updated_at'

export interface PlanPageRaw {
  projectId: string
  plan: StatusPlan
  sheets: SheetSummary[]
  current: SheetSummary
  signedUrl: string | null
  shapes: CanvasShape[]
  nodes: PlanNode[]
  shopLinks: Record<string, ShopLink>
  dbOrders: Record<string, NodeOrderStatus>
  today: string
  canEdit: boolean
  requestedShapeId: string | null
}

export function buildStatusPlanPageProps(raw: PlanPageRaw): StatusPlanPageProps {
  const selectable = raw.requestedShapeId
    && raw.shapes.some((s) => s.id === raw.requestedShapeId && s.sheetId === raw.current.id)
  return {
    projectId: raw.projectId,
    plan: { id: raw.plan.id, name: raw.plan.name, purpose: raw.plan.purpose, updatedAt: raw.plan.updatedAt },
    sheets: raw.sheets,
    sheet: { ...raw.current, signedUrl: raw.signedUrl, isPdf: raw.current.mime === 'application/pdf' },
    shapes: raw.shapes,
    nodes: raw.nodes,
    shopLinks: raw.shopLinks,
    dbOrders: raw.dbOrders,
    today: raw.today,
    canEdit: raw.canEdit,
    initialShapeId: selectable ? raw.requestedShapeId : null,
  }
}

/** The sheet to open: the one asked for, else the sheet of the shape asked for, else the first. */
export function pickSheet(
  sheets: readonly SheetSummary[],
  shapes: readonly Pick<CanvasShape, 'id' | 'sheetId'>[],
  requestedSheetId: string | null,
  requestedShapeId: string | null,
): SheetSummary {
  const byShape = requestedShapeId ? shapes.find((s) => s.id === requestedShapeId)?.sheetId : undefined
  return sheets.find((s) => s.id === requestedSheetId)
    ?? sheets.find((s) => s.id === byShape)
    ?? sheets[0]!
}

/** yyyy-mm-dd on the South African calendar: overdue is a local-date question. */
export function johannesburgDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now)
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export type TenantPlanPageData =
  | { kind: 'empty'; empty: TenantPlanEmptyProps }
  | { kind: 'plan'; props: StatusPlanPageProps }

export async function loadTenantPlanPage(
  client: unknown,
  args: { projectId: string; purpose: StatusPlanPurpose; requestedSheetId: string | null; requestedShapeId: string | null },
): Promise<TenantPlanPageData | null> {
  const db = client as any

  const { data: project } = await db.schema('projects').from('projects')
    .select('id, organisation_id, opening_date').eq('id', args.projectId).maybeSingle()
  if (!project) return null
  const orgId = project.organisation_id as string
  const openingDate = (project.opening_date as string | null) ?? null

  // `.ok` is read right here: the role-gate contract looks for it within a few lines.
  const gate = await requireEffectiveRole(db, args.projectId, ORG_WRITE_ROLES)
  const canEdit = gate.ok
  const empty: TenantPlanPageData = { kind: 'empty', empty: { projectId: args.projectId, purpose: args.purpose, canEdit } }

  const { data: planRow } = await db.schema('tenants').from('status_plans').select(PLAN_COLUMNS)
    .eq('project_id', args.projectId).eq('purpose', args.purpose).maybeSingle()
  if (!planRow) return empty
  const plan = statusPlanFromRow(planRow as StatusPlanRow)

  const { data: sheetRows, error: sheetErr } = await db.schema('tenants').from('status_plan_sheets')
    .select(SHEET_COLUMNS).eq('status_plan_id', plan.id).order('sort_order')
  if (sheetErr) throw new Error(`tenant plan sheets: ${sheetErr.message}`)
  const rows = (sheetRows ?? []) as StatusPlanSheetRow[]
  if (rows.length === 0) return empty
  const sheets = rows.map(toSheetSummary)

  const shapesRes = await readAll<StatusPlanShapeRow>((from, to) =>
    db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS)
      .eq('status_plan_id', plan.id).order('created_at').order('id').range(from, to))
  if ('error' in shapesRes) throw new Error(`tenant plan shapes: ${shapesRes.error}`)
  const shapes = shapesRes.data.map(toCanvasShape)

  const current = pickSheet(sheets, shapes, args.requestedSheetId, args.requestedShapeId)
  const filePath = rows.find((r) => r.id === current.id)!.file_path
  const { data: signed } = await db.storage.from(TENANT_PLAN_BUCKET).createSignedUrl(filePath, SIGNED_URL_SECONDS)

  const nodesRes = await readAll<any>((from, to) => {
    let q = db.schema('structure').from('nodes')
      .select('id, code, kind, shop_number, shop_name, name, shop_area_m2, status')
      .eq('project_id', args.projectId).is('deleted_at', null)
    if (plan.purpose === 'tenant_layout') q = q.eq('kind', 'tenant_db')
    return q.order('id').range(from, to)
  })
  if ('error' in nodesRes) throw new Error(`tenant plan nodes: ${nodesRes.error}`)
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

  return {
    kind: 'plan',
    props: buildStatusPlanPageProps({
      projectId: args.projectId,
      plan,
      sheets,
      current,
      signedUrl: signed?.signedUrl ?? null,
      shapes,
      nodes,
      shopLinks,
      dbOrders,
      today: johannesburgDate(new Date()),
      canEdit,
      requestedShapeId: args.requestedShapeId,
    }),
  }
}
```

- [ ] **Step 3: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/load-plan-page.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/status-plans/load-plan-page.ts apps/web/src/lib/status-plans/load-plan-page.test.ts
git commit -m "feat(tenant-plans): load a plan by purpose with its sheets; ?sheet= and ?shape= pick the sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D5: Move the canvas components under the tenant schedule and point them at sheets

**Files:**
- Move: the five components (+ four tests) and `ExportSheetButton` (+ test) into `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/`
- Modify: `_plans/StatusPlanCanvas.tsx`, `_plans/DetectBlocksPanel.tsx` (+ test), `_plans/PlanLegend.tsx` (+ test), `_plans/ShapePanel.test.tsx`

`_plans` is a private folder (leading underscore): Next.js never routes it.

- [ ] **Step 1: Move**

```bash
S="apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]"
T="apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans"
mkdir -p "$T"
for f in StatusPlanWorkspace StatusPlanCanvas ShapePanel PlanLegend DetectBlocksPanel; do git mv "$S/$f.tsx" "$T/$f.tsx"; done
for f in StatusPlanWorkspace ShapePanel PlanLegend DetectBlocksPanel; do git mv "$S/$f.test.tsx" "$T/$f.test.tsx"; done
git mv "$S/_components/ExportSheetButton.tsx" "$T/ExportSheetButton.tsx"
git mv "$S/_components/ExportSheetButton.test.tsx" "$T/ExportSheetButton.test.tsx"
ls "$T"
```

Expected: 11 files listed. Relative imports between them (`./ShapePanel`, …) keep working; absolute imports (`@/…`) are unchanged. The old `status-plans/[planId]/page.tsx` now imports components that are gone; it is replaced by a redirect in Task E4, and `tsc` / `next build` are only expected green from Task F7 on.

- [ ] **Step 2: Point the canvas at the sheet**

In `_plans/StatusPlanCanvas.tsx`:

1. Replace `import { calibrateFloorPlanAction } from '@/actions/cable-route.actions'` with `import { calibrateTenantPlanSheetAction } from '@/actions/tenant-plan-sheets.actions'`.
2. Replace `import type { CanvasShape, PlanSheet } from '@/lib/status-plans/types'` with `import type { CanvasShape, PlanSheet, SheetSummary } from '@/lib/status-plans/types'`.
3. In `StatusPlanCanvasProps`, replace `onCalibrated: (c: { pageIndex: number; pixelsPerMeter: number }) => void` with:

```ts
  /** The sheet as stored after its scale was saved (new scale and updated_at). */
  onCalibrated: (sheet: SheetSummary) => void
```

4. Replace the sheet-loading block:

```ts
  // ── The sheet (fixed page: a plan is one page of one drawing) ──────────────
  const { img, loadError, pageCount } = useSheetImage({
    planId: sheet.floorPlanId,
```

with

```ts
  // ── The sheet: one page of one uploaded file. A replaced file is a new key. ──
  const { img, loadError, pageCount } = useSheetImage({
    planId: `${sheet.id}:${sheet.revision}`,
```

5. Replace

```ts
  const naturalW = sheet.widthPx || imgW || 800
  const naturalH = sheet.heightPx || imgH || 600
```

with

```ts
  const naturalW = imgW || 800
  const naturalH = imgH || 600
```

6. Replace ``resetKey: `${sheet.floorPlanId}:${pageIndex}` `` with ``resetKey: `${sheet.id}:${sheet.revision}:${pageIndex}` ``.
7. In `saveCalibration`, replace

```ts
      const res = await calibrateFloorPlanAction({ floorPlanId: sheet.floorPlanId, points: c, realMetres: metres, pageIndex })
      if (res.error) { setLocalError(res.error); return }
      p.onCalibrated({ pageIndex, pixelsPerMeter: res.pixelsPerMeter ?? px / metres })
```

with

```ts
      const res = await calibrateTenantPlanSheetAction({ sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt, points: c, realMetres: metres })
      if (!res.ok) { setLocalError(res.error); return }
      p.onCalibrated(res.data)
```

and replace the comment line `// ── Calibration (through the role-gated action, this page only) ────────────` with `// ── Calibration: the sheet's own scale (role-gated, conditional on updated_at) ──`.
8. Replace the short-file warning text

```tsx
          This drawing has {pageCount} page{pageCount === 1 ? '' : 's'}; the plan is on page {pageIndex}. The drawing may have been replaced with a shorter file.
```

with

```tsx
          This file has {pageCount} page{pageCount === 1 ? '' : 's'}; this sheet is page {pageIndex}. Replace the sheet&apos;s file or upload the right one.
```

Then confirm nothing drawing-shaped is left:

```bash
grep -n "floorPlanId\|widthPx\|heightPx\|calibrateFloorPlanAction\|page_scales" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanCanvas.tsx"
```

Expected: no output.

- [ ] **Step 3: Detection is per sheet**

In `_plans/DetectBlocksPanel.tsx`: in `DetectBlocksPanelProps` replace `planId: string` with `sheetId: string` and the comment `/** 1-based, the plan's page. */` with `/** 1-based page of the sheet's file. */`; in the component's destructuring replace `planId,` with `sheetId,`; in `accept()` replace `planId,` (the first property of the `acceptDetectedBlocksAction({` call) with `sheetId,`.

In `_plans/DetectBlocksPanel.test.tsx`: in `props()` replace `planId: 'plan-1'` with `sheetId: 'sheet-1'`; replace

```ts
    const [{ planId, blocks }] = acceptMock.mock.calls[0]
    expect(planId).toBe('plan-1')
```

with

```ts
    const [{ sheetId, blocks }] = acceptMock.mock.calls[0]
    expect(sheetId).toBe('sheet-1')
```

and add `sheetId: 'sheet-1',` to the `shape()` factory's object (after `id,`).

In `_plans/ShapePanel.test.tsx`, add `sheetId: 'sh1',` to the `SHAPE` literal.

- [ ] **Step 4: The legend shows this sheet and the whole plan**

Replace `_plans/PlanLegend.tsx` with:

```tsx
'use client'

/**
 * The plan's live legend: every entry with its count on THIS sheet and, when
 * the plan has more than one sheet, across ALL sheets; measured area; and what
 * needs attention on this sheet.
 */
import { SCHEMATIC_LEGEND, TENANT_LEGEND, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { measuredGlaText, swatchCss, type AttentionItem, type LegendSummary } from '@/lib/status-plans/shape-view'

export interface PlanLegendProps {
  purpose: StatusPlanPurpose
  /** This sheet. */
  summary: LegendSummary
  /** Every sheet of the plan; shown as a second column when sheetCount > 1. */
  planSummary?: LegendSummary | null
  sheetCount?: number
  hasScale: boolean
  attention: AttentionItem[]
  onSelectShape: (shapeId: string) => void
}

const mono = { fontFamily: 'var(--font-mono)', minWidth: 28, textAlign: 'right' } as const

export function PlanLegend({ purpose, summary, planSummary = null, sheetCount = 1, hasScale, attention, onSelectShape }: PlanLegendProps) {
  const legend = purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND
  const showPlan = planSummary !== null && sheetCount > 1
  return (
    <div className="data-panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 13, flex: 1 }}>Legend</h2>
        {showPlan && (
          <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>this sheet · all {sheetCount}</span>
        )}
      </div>
      <ul aria-label="Legend entries" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {legend.map((e) => (
          <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span aria-hidden style={{ width: 16, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(e.style) }} />
            <span style={{ flex: 1 }}>{e.label}</span>
            <span style={mono}>{summary.counts[e.key] ?? 0}</span>
            {showPlan && <span style={{ ...mono, color: 'var(--c-text-dim)' }} title="All sheets">{planSummary!.counts[e.key] ?? 0}</span>}
          </li>
        ))}
      </ul>
      {purpose === 'tenant_layout' && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-mid)' }}>
          {hasScale
            ? measuredGlaText(summary.totalM2, summary.unmeasured)
            : 'Set this sheet’s scale to measure areas.'}
        </p>
      )}
      {purpose === 'tenant_layout' && showPlan && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-mid)' }}>
          All sheets: {measuredGlaText(planSummary!.totalM2, planSummary!.unmeasured)}
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

In `_plans/PlanLegend.test.tsx`, change the regex `/Set the page scale to measure areas/` to `/Set this sheet.s scale to measure areas/`, and append:

```tsx
  it('with several sheets, each row shows this sheet then all sheets, and the plan total area', () => {
    const plan = { ...summary, counts: { ...summary.counts, complete: 5 }, totalM2: 4000, unmeasured: 1 }
    render(<PlanLegend purpose="tenant_layout" summary={summary} planSummary={plan} sheetCount={3} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Complete')).toBe('Complete25')
    expect(screen.getByText('this sheet · all 3')).toBeTruthy()
    expect(screen.getByText(/All sheets: Measured GLA: 4000\.0 m²/)).toBeTruthy()
  })

  it('one sheet: no second column', () => {
    render(<PlanLegend purpose="tenant_layout" summary={summary} planSummary={summary} sheetCount={1} hasScale attention={[]} onSelectShape={vi.fn()} />)
    expect(legendRow('Complete')).toBe('Complete2')
  })
```

(`measuredGlaText` prints `Measured GLA: 1234.6 m²` per the existing test; if it appends an "unmeasured" clause for `unmeasured: 1`, the regex above still matches its start.)

- [ ] **Step 5: Run the moved component tests (Workspace excluded until D6)**

```bash
T="src/app/(admin)/projects/[id]/tenant-schedule/_plans"
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "$T/PlanLegend.test.tsx" "$T/ShapePanel.test.tsx" "$T/DetectBlocksPanel.test.tsx" "$T/ExportSheetButton.test.tsx"
```

Expected: PASS for PlanLegend, ShapePanel and DetectBlocksPanel. `ExportSheetButton.test.tsx` is updated in Task F4; if it fails here only on the URL it expects, leave it for F4.

- [ ] **Step 6: Commit**

```bash
git add -A "apps/web/src/app/(admin)/projects/[id]/status-plans" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans"
git commit -m "refactor(tenant-plans): canvas components move under the tenant schedule and read sheets

Calibration writes the sheet's own scale; detection accepts onto a sheet;
the legend shows this sheet and the whole plan.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D6: Uploader, sheet strip, sheet controls, empty state

**Files:**
- Create: `apps/web/src/lib/status-plans/navigate.ts`
- Create: `_plans/TenantPlanUploader.tsx` (+ `.test.tsx`)
- Create: `_plans/SheetStrip.tsx` (+ `.test.tsx`)
- Create: `_plans/SheetControls.tsx` (+ `.test.tsx`)
- Create: `_plans/TenantPlanEmpty.tsx`

(`_plans/` = `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/`.)

**Why a full navigation after an upload, replace or delete:** the page must re-mint the new sheet's signed URL, and `router.refresh()` has been seen never to commit on pages in this app (CLAUDE.md, 2026-10-09, the tender detail page). `window.location.assign` always does. Shape edits, renames, re-anchors and scales never navigate: they fold into state.

- [ ] **Step 1: `navigate.ts`**

```ts
/**
 * One full navigation, for the moments a tenant plan page needs a fresh server
 * render (a new sheet, a replaced file, a deleted sheet): the new signed URL is
 * minted by the server. A module of its own so tests can mock it.
 */
export function navigateTo(href: string): void {
  window.location.assign(href)
}
```

- [ ] **Step 2: Uploader test (red)**

`_plans/TenantPlanUploader.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({ prepare: vi.fn(), register: vi.fn(), upload: vi.fn(), navigate: vi.fn(), bucket: vi.fn() }))
vi.mock('@/actions/tenant-plan-sheets.actions', () => ({
  prepareTenantPlanUploadAction: (...a: unknown[]) => m.prepare(...a),
  registerTenantPlanSheetsAction: (...a: unknown[]) => m.register(...a),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: (b: string) => { m.bucket(b); return { uploadToSignedUrl: (...a: unknown[]) => m.upload(...a) } } } }),
}))
vi.mock('@/lib/status-plans/navigate', () => ({ navigateTo: (...a: unknown[]) => m.navigate(...a) }))

import { TenantPlanUploader } from './TenantPlanUploader'

const f1 = new File(['%PDF'], 'E-300.pdf', { type: 'application/pdf' })
const f2 = new File(['png'], 'Mall GF.png', { type: 'image/png' })
const choose = (files: File[]) => fireEvent.change(screen.getByLabelText(/choose files/i), { target: { files } })

beforeEach(() => {
  vi.clearAllMocks()
  m.prepare.mockResolvedValue({ ok: true, data: { planId: 'pl1', uploads: [
    { path: 'o/p/pl1/a/1.pdf', token: 't1', mime: 'application/pdf' },
    { path: 'o/p/pl1/b/1.png', token: 't2', mime: 'image/png' },
  ] } })
  m.upload.mockResolvedValue({ error: null })
  m.register.mockResolvedValue({ ok: true, data: { sheets: [{ id: 'a' }, { id: 'a2' }, { id: 'b' }] } })
})

describe('TenantPlanUploader', () => {
  it('prepares, uploads each file straight to storage, registers, then opens the first new sheet', async () => {
    render(<TenantPlanUploader projectId="p1" purpose="tenant_layout" />)
    choose([f1, f2])
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/projects/p1/tenant-schedule/floor-plan?sheet=a'))
    expect(m.prepare).toHaveBeenCalledWith({ projectId: 'p1', purpose: 'tenant_layout', files: [
      { name: 'E-300.pdf', size: 4, type: 'application/pdf' },
      { name: 'Mall GF.png', size: 3, type: 'image/png' },
    ] })
    expect(m.bucket).toHaveBeenCalledWith('tenant-plan-files')
    expect(m.upload.mock.calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      ['o/p/pl1/a/1.pdf', 't1', f1, { contentType: 'application/pdf' }],
      ['o/p/pl1/b/1.png', 't2', f2, { contentType: 'image/png' }],
    ])
    expect(m.register).toHaveBeenCalledWith({ planId: 'pl1', files: [
      { path: 'o/p/pl1/a/1.pdf', fileName: 'E-300.pdf', mime: 'application/pdf' },
      { path: 'o/p/pl1/b/1.png', fileName: 'Mall GF.png', mime: 'image/png' },
    ] })
  })

  it('a refusal from the server is shown and nothing is uploaded', async () => {
    m.prepare.mockResolvedValue({ ok: false, error: 'E-100.dwg is not a PDF, PNG or JPEG.' })
    render(<TenantPlanUploader projectId="p1" purpose="tenant_layout" />)
    choose([f1])
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('E-100.dwg is not a PDF, PNG or JPEG.')).toBeTruthy()
    expect(m.upload).not.toHaveBeenCalled()
    expect(m.navigate).not.toHaveBeenCalled()
  })

  it('a failed upload names the file and registers nothing', async () => {
    m.upload.mockResolvedValueOnce({ error: { message: 'Payload too large' } })
    render(<TenantPlanUploader projectId="p1" purpose="distribution_schematic" label="Add sheets" />)
    expect(screen.getByRole('button', { name: 'Add sheets' })).toBeTruthy()
    choose([f1, f2])
    expect(await screen.findByText('Uploading E-300.pdf failed. Try again.')).toBeTruthy()
    expect(m.register).not.toHaveBeenCalled()
  })
})
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans/TenantPlanUploader.test.tsx"` → FAIL (no module).

- [ ] **Step 3: `_plans/TenantPlanUploader.tsx`**

```tsx
'use client'

/**
 * Upload one or more files to a tenant plan (spec 2026-10-12 §3). The browser
 * uploads straight to the private bucket with server-issued signed URLs, so a
 * 50 MB A0 never passes through a Vercel function; the server then registers
 * the sheets (a PDF of N pages becomes N sheets, files appended in order).
 * Props are strings only.
 */
import { useRef, useState } from 'react'
import { TENANT_PLAN_BUCKET, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { prepareTenantPlanUploadAction, registerTenantPlanSheetsAction } from '@/actions/tenant-plan-sheets.actions'
import { createClient } from '@/lib/supabase/client'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import { navigateTo } from '@/lib/status-plans/navigate'

export interface TenantPlanUploaderProps {
  projectId: string
  purpose: StatusPlanPurpose
  label?: string
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function TenantPlanUploader({ projectId, purpose, label = 'Upload' }: TenantPlanUploaderProps) {
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      setStatus(`Preparing ${files.length} file${files.length === 1 ? '' : 's'}…`)
      const prep = await prepareTenantPlanUploadAction({
        projectId, purpose, files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      })
      if (!prep.ok) { setError(prep.error); return }

      const storage = createClient().storage.from(TENANT_PLAN_BUCKET)
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!
        const u = prep.data.uploads[i]!
        setStatus(`Uploading ${f.name} (${i + 1} of ${files.length})…`)
        const { error: upErr } = await storage.uploadToSignedUrl(u.path, u.token, f, { contentType: u.mime })
        if (upErr) { setError(`Uploading ${f.name} failed. Try again.`); return }
      }

      setStatus('Reading the sheets…')
      const reg = await registerTenantPlanSheetsAction({
        planId: prep.data.planId,
        files: files.map((f, i) => ({ path: prep.data.uploads[i]!.path, fileName: f.name, mime: prep.data.uploads[i]!.mime })),
      })
      if (!reg.ok) { setError(reg.error); return }
      navigateTo(tenantPlanHref(projectId, purpose, { sheet: reg.data.sheets[0]?.id ?? null }))
    } catch {
      setError(NO_ANSWER)
    } finally {
      setBusy(false)
      setStatus(null)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        aria-label="Choose files to upload"
        hidden
        onChange={(e) => void upload(Array.from(e.target.files ?? []))}
      />
      <button type="button" className="btn-primary-amber" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : label}
      </button>
      {status && <span role="status" style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{status}</span>}
      {error && <span role="alert" style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
    </span>
  )
}
```

Run the uploader test again → PASS (3).

- [ ] **Step 4: Sheet strip test (red) and component**

`_plans/SheetStrip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { SheetSummary } from '@/lib/status-plans/types'

vi.mock('./TenantPlanUploader', () => ({ TenantPlanUploader: ({ label }: { label?: string }) => <button type="button">{label}</button> }))

import { SheetStrip } from './SheetStrip'

const s = (id: string, i: number, over: Partial<SheetSummary> = {}): SheetSummary => ({
  id, label: `Level ${i}`, sortOrder: i, fileName: `E-10${i}.pdf`, mime: 'application/pdf', pageIndex: 1, revision: 1,
  replacedAt: null, pixelsPerMeter: null, updatedAt: 't', ...over,
})
const SHEETS = [s('a', 0), s('b', 1, { replacedAt: 't9' }), s('c', 2)]

describe('SheetStrip', () => {
  it('links every sheet by ?sheet= and marks the current one', () => {
    render(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="b" canEdit={false} />)
    const nav = screen.getByRole('navigation', { name: 'Sheets' })
    const links = within(nav).getAllByRole('link').filter((a) => !a.getAttribute('aria-label'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/projects/p1/tenant-schedule/floor-plan?sheet=a',
      '/projects/p1/tenant-schedule/floor-plan?sheet=b',
      '/projects/p1/tenant-schedule/floor-plan?sheet=c',
    ])
    expect(links[1]!.getAttribute('aria-current')).toBe('page')
    expect(links[0]!.getAttribute('aria-current')).toBeNull()
  })

  it('previous and next step to the neighbours', () => {
    render(<SheetStrip projectId="p1" purpose="distribution_schematic" sheets={SHEETS} currentId="b" canEdit={false} />)
    expect(screen.getByRole('link', { name: 'Previous sheet' }).getAttribute('href')).toBe('/projects/p1/tenant-schedule/line-diagram?sheet=a')
    expect(screen.getByRole('link', { name: 'Next sheet' }).getAttribute('href')).toBe('/projects/p1/tenant-schedule/line-diagram?sheet=c')
  })

  it('no previous on the first sheet, no next on the last', () => {
    const { rerender } = render(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="a" canEdit={false} />)
    expect(screen.queryByRole('link', { name: 'Previous sheet' })).toBeNull()
    rerender(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="c" canEdit={false} />)
    expect(screen.queryByRole('link', { name: 'Next sheet' })).toBeNull()
  })

  it('a replaced sheet says so; writers get "Add sheets", readers do not', () => {
    const { rerender } = render(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="a" canEdit />)
    expect(screen.getByRole('link', { name: /Level 1/ }).getAttribute('title')).toBe('File replaced — check the shapes')
    expect(screen.getByRole('button', { name: 'Add sheets' })).toBeTruthy()
    rerender(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="a" canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Add sheets' })).toBeNull()
  })
})
```

`_plans/SheetStrip.tsx`:

```tsx
'use client'

/** Step between a plan's sheets (?sheet=). Writers also get "Add sheets". Props are JSON only. */
import Link from 'next/link'
import type { StatusPlanPurpose } from '@esite/shared/status-plans'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import type { SheetSummary } from '@/lib/status-plans/types'
import { TenantPlanUploader } from './TenantPlanUploader'

export interface SheetStripProps {
  projectId: string
  purpose: StatusPlanPurpose
  sheets: SheetSummary[]
  currentId: string
  canEdit: boolean
}

const chip = { border: '1px solid var(--c-border)', borderRadius: 5, padding: '3px 8px', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' } as const

export function SheetStrip({ projectId, purpose, sheets, currentId, canEdit }: SheetStripProps) {
  const at = sheets.findIndex((s) => s.id === currentId)
  const prev = at > 0 ? sheets[at - 1]! : null
  const next = at >= 0 && at < sheets.length - 1 ? sheets[at + 1]! : null
  const href = (id: string) => tenantPlanHref(projectId, purpose, { sheet: id })

  return (
    <nav aria-label="Sheets" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {prev && <Link href={href(prev.id)} aria-label="Previous sheet" style={chip}>‹</Link>}
      <ol style={{ display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }}>
        {sheets.map((s, i) => {
          const current = s.id === currentId
          return (
            <li key={s.id}>
              <Link
                href={href(s.id)}
                aria-current={current ? 'page' : undefined}
                title={s.replacedAt ? 'File replaced — check the shapes' : s.fileName}
                style={{
                  ...chip,
                  fontWeight: current ? 700 : 400,
                  borderColor: s.replacedAt ? 'var(--c-amber)' : current ? 'var(--c-blue)' : 'var(--c-border)',
                  color: current ? 'var(--c-text)' : 'var(--c-text-mid)',
                }}
              >
                {i + 1}. {s.label}{s.replacedAt ? ' •' : ''}
              </Link>
            </li>
          )
        })}
      </ol>
      {next && <Link href={href(next.id)} aria-label="Next sheet" style={chip}>›</Link>}
      {canEdit && (
        <span style={{ marginLeft: 'auto' }}>
          <TenantPlanUploader projectId={projectId} purpose={purpose} label="Add sheets" />
        </span>
      )}
    </nav>
  )
}
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans/SheetStrip.test.tsx"` → PASS (4).

- [ ] **Step 5: Sheet controls test (red) and component**

`_plans/SheetControls.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PlanSheet } from '@/lib/status-plans/types'

const m = vi.hoisted(() => ({ rename: vi.fn(), del: vi.fn(), prep: vi.fn(), replace: vi.fn(), upload: vi.fn(), navigate: vi.fn() }))
vi.mock('@/actions/tenant-plan-sheets.actions', () => ({
  renameTenantPlanSheetAction: (...a: unknown[]) => m.rename(...a),
  deleteTenantPlanSheetAction: (...a: unknown[]) => m.del(...a),
  prepareTenantPlanSheetReplaceAction: (...a: unknown[]) => m.prep(...a),
  replaceTenantPlanSheetAction: (...a: unknown[]) => m.replace(...a),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => m.upload(...a) }) } }) }))
vi.mock('@/lib/status-plans/navigate', () => ({ navigateTo: (...a: unknown[]) => m.navigate(...a) }))

import { SheetControls } from './SheetControls'

const SHEET: PlanSheet = {
  id: 'sh1', label: 'Ground floor', sortOrder: 0, fileName: 'E-100.pdf', mime: 'application/pdf', pageIndex: 2, revision: 1,
  replacedAt: null, pixelsPerMeter: 20, updatedAt: 'u0', signedUrl: 'https://s/x', isPdf: true,
}
const base = { projectId: 'p1', purpose: 'tenant_layout' as const, sheet: SHEET, shapeCount: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  m.upload.mockResolvedValue({ error: null })
})

describe('SheetControls', () => {
  it('rename saves the trimmed label conditionally and hands the stored sheet back', async () => {
    const onChanged = vi.fn()
    m.rename.mockResolvedValue({ ok: true, data: { ...SHEET, label: 'Level 1', updatedAt: 'u1' } })
    render(<SheetControls {...base} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Sheet name'), { target: { value: ' Level 1 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ label: 'Level 1' })))
    expect(m.rename).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0', label: ' Level 1 ' })
  })

  it('delete takes two presses, names the shapes it takes with it, then leaves the sheet', async () => {
    m.del.mockResolvedValue({ ok: true, data: { id: 'sh1' } })
    render(<SheetControls {...base} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete sheet' }))
    expect(m.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Press again to delete this sheet and its 3 shapes' }))
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/projects/p1/tenant-schedule/floor-plan'))
    expect(m.del).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0' })
  })

  it('replace: prepare, upload to the signed path, swap with the chosen page, reopen the sheet', async () => {
    m.prep.mockResolvedValue({ ok: true, data: { path: 'o/p/pl/sh1/2.pdf', token: 'tk', mime: 'application/pdf' } })
    m.replace.mockResolvedValue({ ok: true, data: { ...SHEET, revision: 2 } })
    render(<SheetControls {...base} onChanged={vi.fn()} />)
    expect((screen.getByLabelText('Page in the new file') as HTMLInputElement).value).toBe('2')
    fireEvent.change(screen.getByLabelText('Page in the new file'), { target: { value: '3' } })
    const file = new File(['%PDF'], 'E-100 rev C.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Choose the replacement file'), { target: { files: [file] } })
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/projects/p1/tenant-schedule/floor-plan?sheet=sh1'))
    expect(m.prep).toHaveBeenCalledWith({ sheetId: 'sh1', file: { name: 'E-100 rev C.pdf', size: 4, type: 'application/pdf' } })
    expect(m.upload).toHaveBeenCalledWith('o/p/pl/sh1/2.pdf', 'tk', file, { contentType: 'application/pdf' })
    expect(m.replace).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0', path: 'o/p/pl/sh1/2.pdf', fileName: 'E-100 rev C.pdf', mime: 'application/pdf', pageIndex: 3 })
  })

  it('a refused replace shows the sentence and stays on the page', async () => {
    m.prep.mockResolvedValue({ ok: true, data: { path: 'o/p/pl/sh1/2.pdf', token: 'tk', mime: 'application/pdf' } })
    m.replace.mockResolvedValue({ ok: false, error: 'E-100 rev C.pdf has 2 pages; pick a page from 1 to 2.' })
    render(<SheetControls {...base} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Choose the replacement file'), { target: { files: [new File(['%PDF'], 'E-100 rev C.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText('E-100 rev C.pdf has 2 pages; pick a page from 1 to 2.')).toBeTruthy()
    expect(m.navigate).not.toHaveBeenCalled()
  })
})
```

`_plans/SheetControls.tsx`:

```tsx
'use client'

/**
 * Rename, replace or delete the sheet on screen (owner / admin / PM only; the
 * page renders this only when canEdit). Replace keeps the shapes and the
 * scale; the page then shows the "file replaced" banner until someone
 * re-anchors (decision A, spec 2026-10-12). Delete is a two-step confirm
 * (never window.confirm, which Safari suppresses). Props are JSON only.
 */
import { useEffect, useRef, useState } from 'react'
import { TENANT_PLAN_BUCKET, type StatusPlanPurpose } from '@esite/shared/status-plans'
import {
  deleteTenantPlanSheetAction,
  prepareTenantPlanSheetReplaceAction,
  renameTenantPlanSheetAction,
  replaceTenantPlanSheetAction,
} from '@/actions/tenant-plan-sheets.actions'
import { createClient } from '@/lib/supabase/client'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import { navigateTo } from '@/lib/status-plans/navigate'
import type { PlanSheet, SheetSummary } from '@/lib/status-plans/types'

export interface SheetControlsProps {
  projectId: string
  purpose: StatusPlanPurpose
  sheet: PlanSheet
  /** Shapes on this sheet: deleting the sheet deletes them. */
  shapeCount: number
  onChanged: (sheet: SheetSummary) => void
}

const ARM_MS = 4000
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function SheetControls({ projectId, purpose, sheet, shapeCount, onChanged }: SheetControlsProps) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(sheet.label)
  const [page, setPage] = useState(String(sheet.pageIndex))
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), ARM_MS)
    return () => clearTimeout(t)
  }, [armed])

  async function guarded(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try { await fn() } catch { setError(NO_ANSWER) } finally { setBusy(false) }
  }

  const rename = () => guarded(async () => {
    const res = await renameTenantPlanSheetAction({ sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt, label: draft })
    if (!res.ok) { setError(res.error); return }
    onChanged(res.data)
    setRenaming(false)
  })

  const replace = (file: File) => guarded(async () => {
    const prep = await prepareTenantPlanSheetReplaceAction({ sheetId: sheet.id, file: { name: file.name, size: file.size, type: file.type } })
    if (!prep.ok) { setError(prep.error); return }
    const { error: upErr } = await createClient().storage.from(TENANT_PLAN_BUCKET)
      .uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: prep.data.mime })
    if (upErr) { setError(`Uploading ${file.name} failed. Try again.`); return }
    const res = await replaceTenantPlanSheetAction({
      sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt, path: prep.data.path, fileName: file.name,
      mime: prep.data.mime, pageIndex: Math.max(1, Number.parseInt(page, 10) || 1),
    })
    if (!res.ok) { setError(res.error); return }
    navigateTo(tenantPlanHref(projectId, purpose, { sheet: sheet.id }))
  })

  function remove() {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    void guarded(async () => {
      const res = await deleteTenantPlanSheetAction({ sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt })
      if (!res.ok) { setError(res.error); return }
      navigateTo(tenantPlanHref(projectId, purpose))
    })
  }

  const armedLabel = `Press again to delete this sheet${shapeCount > 0 ? ` and its ${shapeCount} shape${shapeCount === 1 ? '' : 's'}` : ''}`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
      {renaming ? (
        <>
          <input className="ob-input" aria-label="Sheet name" value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="btn-primary-amber" disabled={busy} onClick={() => void rename()}>Save</button>
          <button type="button" onClick={() => { setRenaming(false); setDraft(sheet.label) }}>Cancel</button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => setRenaming(true)}>Rename</button>
      )}

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Page in the new file
        <input
          type="number" min={1} step={1} className="ob-input compact-field" style={{ width: 64 }}
          aria-label="Page in the new file" value={page} onChange={(e) => setPage(e.target.value)}
        />
      </label>
      <input
        ref={fileInput} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        aria-label="Choose the replacement file"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void replace(f) }}
      />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Replace file</button>

      <button type="button" disabled={busy} onClick={remove} style={{ color: '#dc2626', fontWeight: armed ? 700 : 400 }}>
        {armed ? armedLabel : 'Delete sheet'}
      </button>

      {error && <span role="alert" style={{ color: '#dc2626' }}>{error}</span>}
    </div>
  )
}
```

The "Page in the new file" input sits inside a `<label>` and also carries `aria-label`; `getByLabelText` resolves either. Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans/SheetControls.test.tsx"` → PASS (4). If `getByLabelText('Page in the new file')` reports two matches, remove the `aria-label` attribute and keep the wrapping `<label>`.

- [ ] **Step 6: Empty state**

`_plans/TenantPlanEmpty.tsx`:

```tsx
'use client'

/** A tenant plan with nothing uploaded yet: Upload for owner / admin / PM, a sentence for everyone else. */
import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import type { TenantPlanEmptyProps } from '@/lib/status-plans/types'
import { TenantPlanUploader } from './TenantPlanUploader'

const HINT: Record<TenantPlanEmptyProps['purpose'], string> = {
  tenant_layout: 'Upload the tenant floor plan, then mask each shop and link it to the tenant schedule.',
  distribution_schematic: 'Upload the 300 line diagram, then detect the DB blocks and hatch them by order status.',
}

export function TenantPlanEmpty({ projectId, purpose, canEdit }: TenantPlanEmptyProps) {
  return (
    <div className="data-panel" style={{ padding: 24, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{PURPOSE_LABEL[purpose]}</h1>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-mid)' }}>
        Nothing uploaded yet.{' '}
        {canEdit
          ? `${HINT[purpose]} PDF, PNG or JPEG, up to 50 MB each; every page of a PDF becomes a sheet.`
          : 'An owner, admin or project manager can upload it.'}
      </p>
      {canEdit && <div><TenantPlanUploader projectId={projectId} purpose={purpose} label="Upload" /></div>}
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
T="apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans"
git add apps/web/src/lib/status-plans/navigate.ts "$T/TenantPlanUploader.tsx" "$T/TenantPlanUploader.test.tsx" "$T/SheetStrip.tsx" "$T/SheetStrip.test.tsx" "$T/SheetControls.tsx" "$T/SheetControls.test.tsx" "$T/TenantPlanEmpty.tsx"
git commit -m "feat(tenant-plans): uploader, sheet strip, sheet controls and empty state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D7: The workspace drives sheets

**Files:**
- Modify (rewrite): `_plans/StatusPlanWorkspace.tsx`
- Modify (rewrite): `_plans/StatusPlanWorkspace.test.tsx`

- [ ] **Step 1: Rewrite the test (red)**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { StatusPlanPageProps, CanvasShape, SheetSummary } from '@/lib/status-plans/types'

// No jest-dom in this repo (vitest.config.ts has no setupFiles): assert on textContent.
const legendRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Legend entries' })).getByText(label).closest('li')!.textContent
const canvasText = () => screen.getByTestId('canvas').textContent ?? ''

const SHEET: SheetSummary = {
  id: 'sh1', label: 'Ground floor', sortOrder: 0, fileName: 'E-100.pdf', mime: 'application/pdf', pageIndex: 1, revision: 1,
  replacedAt: null, pixelsPerMeter: 20, updatedAt: 'u0',
}
const SHEET2: SheetSummary = { ...SHEET, id: 'sh2', label: 'Level 1', sortOrder: 1, pageIndex: 2 }

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }))
vi.mock('next/dynamic', () => ({
  default: () => (props: { shapes: CanvasShape[]; selectedId: string | null; pageIndex: number; onSelect: (id: string | null) => void; onCreate: (c: unknown) => void; onDeleteRequest: () => void; onCalibrated: (s: SheetSummary) => void; requestedTool: { tool: string } | null }) => (
    <div data-testid="canvas">
      shapes:{props.shapes.length} selected:{props.selectedId ?? 'none'} tool:{props.requestedTool?.tool ?? 'none'} page:{props.pageIndex}
      <button onClick={() => props.onSelect('s1')}>stub-select-s1</button>
      <button onClick={() => props.onCreate({ shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10] })}>stub-create</button>
      <button onClick={() => props.onDeleteRequest()}>stub-delete-key</button>
      <button onClick={() => props.onCalibrated({ ...SHEET, pixelsPerMeter: 25, updatedAt: 'u2' })}>stub-calibrated</button>
    </div>
  ),
}))
const actions = vi.hoisted(() => ({
  createStatusPlanShapeAction: vi.fn(),
  updateStatusPlanShapeAction: vi.fn(),
  deleteStatusPlanShapeAction: vi.fn(),
}))
vi.mock('@/actions/status-plan.actions', () => actions)
const sheetActions = vi.hoisted(() => ({
  reanchorTenantPlanSheetAction: vi.fn(),
  renameTenantPlanSheetAction: vi.fn(),
  deleteTenantPlanSheetAction: vi.fn(),
  prepareTenantPlanSheetReplaceAction: vi.fn(),
  replaceTenantPlanSheetAction: vi.fn(),
  prepareTenantPlanUploadAction: vi.fn(),
  registerTenantPlanSheetsAction: vi.fn(),
}))
vi.mock('@/actions/tenant-plan-sheets.actions', () => sheetActions)
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } }) }))
vi.mock('@/lib/status-plans/navigate', () => ({ navigateTo: vi.fn() }))
const detection = vi.hoisted(() => ({ extractPageText: vi.fn(), acceptDetectedBlocksAction: vi.fn() }))
vi.mock('@/lib/status-plans/extract-page-text', () => ({ extractPageText: detection.extractPageText }))
vi.mock('@/actions/status-plan-detection.actions', () => ({ acceptDetectedBlocksAction: detection.acceptDetectedBlocksAction }))

import { StatusPlanWorkspace } from './StatusPlanWorkspace'

const SHAPE: CanvasShape = { id: 's1', sheetId: 'sh1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], nodeId: null, areaType: null, detectedTag: null, source: 'manual', updatedAt: 't1' }

function props(o: Partial<StatusPlanPageProps> = {}): StatusPlanPageProps {
  return {
    projectId: 'p1',
    plan: { id: 'pl1', name: 'Floor plan', purpose: 'tenant_layout', updatedAt: 't0' },
    sheets: [SHEET],
    sheet: { ...SHEET, signedUrl: 'https://s/x', isPdf: true },
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
const schematic = (o: Partial<StatusPlanPageProps> = {}) =>
  props({ plan: { ...props().plan, purpose: 'distribution_schematic', name: 'Line diagram' }, shopLinks: {}, ...o })

beforeEach(() => vi.clearAllMocks())

describe('StatusPlanWorkspace', () => {
  it('shows the legend counts from live facts', () => {
    render(<StatusPlanWorkspace {...props()} />)
    expect(legendRow('Unassigned')).toBe('Unassigned1')
    expect(legendRow('Complete')).toBe('Complete0')
  })

  it('assigning a shop folds the stored shape into state', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, nodeId: 'n1', updatedAt: 't2' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    await waitFor(() => expect(legendRow('Complete')).toBe('Complete1'))
    expect(actions.updateStatusPlanShapeAction).toHaveBeenCalledWith({ shapeId: 's1', expectedUpdatedAt: 't1', nodeId: 'n1' })
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
  })

  it('a new shape is created on the current sheet, added and selected', async () => {
    actions.createStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, id: 's2' } })
    render(<StatusPlanWorkspace {...props()} />)
    await act(async () => { fireEvent.click(screen.getByText('stub-create')) })
    expect(actions.createStatusPlanShapeAction).toHaveBeenCalledWith({ sheetId: 'sh1', shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10] })
    expect(canvasText()).toMatch(/shapes:2\s+selected:s2/)
  })

  it('the canvas shows this sheet only; the legend shows this sheet and all sheets', () => {
    render(<StatusPlanWorkspace {...props({
      sheets: [SHEET, SHEET2],
      shapes: [SHAPE, { ...SHAPE, id: 's2', sheetId: 'sh2', nodeId: 'n1' }],
    })} />)
    expect(canvasText()).toContain('shapes:1')
    expect(legendRow('Complete')).toBe('Complete01')
    expect(legendRow('Unassigned')).toBe('Unassigned11')
    expect(screen.getByRole('navigation', { name: 'Sheets' })).toBeTruthy()
  })

  it('a replaced sheet warns, and "Shapes checked" re-anchors it in place', async () => {
    sheetActions.reanchorTenantPlanSheetAction.mockResolvedValue({ ok: true, data: { ...SHEET, revision: 2, replacedAt: null, updatedAt: 'u1' } })
    render(<StatusPlanWorkspace {...props({ sheet: { ...SHEET, revision: 2, replacedAt: 't9', signedUrl: 'https://s/x', isPdf: true } })} />)
    expect(screen.getByText(/file was replaced/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Shapes checked/ }))
    await waitFor(() => expect(screen.queryByText(/file was replaced/)).toBeNull())
    expect(sheetActions.reanchorTenantPlanSheetAction).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0' })
  })

  it('no scale: banner, "Set scale" asks the canvas for the calibrate tool, and a saved scale clears it', () => {
    render(<StatusPlanWorkspace {...props({ sheet: { ...SHEET, pixelsPerMeter: null, signedUrl: 'https://s/x', isPdf: true }, sheets: [{ ...SHEET, pixelsPerMeter: null }] })} />)
    expect(screen.getByText(/Set this sheet.s scale to measure areas/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set scale' }))
    expect(canvasText()).toContain('tool:calibrate')
    fireEvent.click(screen.getByText('stub-calibrated'))
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
  })

  it('a line diagram offers Detect blocks and no scale banner; a floor plan does not', () => {
    const { unmount } = render(<StatusPlanWorkspace {...schematic({ sheet: { ...SHEET, pixelsPerMeter: null, signedUrl: 'https://s/x', isPdf: true } })} />)
    expect(screen.getByRole('button', { name: 'Detect blocks' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
    unmount()
    render(<StatusPlanWorkspace {...props()} />)
    expect(screen.queryByRole('button', { name: 'Detect blocks' })).toBeNull()
  })

  it('detection reads the sheet\'s own page and accepted blocks fold into the canvas', async () => {
    const ITEMS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'].flatMap((l, row) => [
      { str: l, x: 500, baseline: 500 + row * 16, top: 490 + row * 16, width: l.length * 6, height: 10 },
      { str: ['DB-ZZ01', 'LANTERN', '1', '2', '3', '4', '5'][row]!, x: 550, baseline: 500 + row * 16, top: 490 + row * 16, width: 30, height: 10 },
    ])
    detection.extractPageText.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 2000, height: 2000 })
    detection.acceptDetectedBlocksAction.mockResolvedValue({
      ok: true,
      data: [{ id: 's9', sheetId: 'sh1', shape: 'rect', points: [495, 485, 585, 485, 585, 601, 495, 601], nodeId: 'n1', areaType: null, detectedTag: 'DB-ZZ01', source: 'detected', updatedAt: 't9' }],
    })
    render(<StatusPlanWorkspace {...schematic({ sheet: { ...SHEET, pageIndex: 2, signedUrl: 'https://s/x', isPdf: true } })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept 1 matched' }))
    await waitFor(() => expect(canvasText()).toContain('shapes:2'))
    expect(detection.extractPageText).toHaveBeenCalledWith({ url: 'https://s/x' }, 2)
    expect(detection.acceptDetectedBlocksAction.mock.calls[0][0].sheetId).toBe('sh1')
  })

  it('read-only: no sheet controls, no Add sheets, no Set scale, no re-anchor', () => {
    render(<StatusPlanWorkspace {...props({ canEdit: false, sheet: { ...SHEET, pixelsPerMeter: null, replacedAt: 't9', signedUrl: 'https://s/x', isPdf: true } })} />)
    for (const name of ['Rename', 'Replace file', 'Delete sheet', 'Add sheets', 'Set scale']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /Shapes checked/ })).toBeNull()
    expect(screen.getByText(/file was replaced/)).toBeTruthy()
  })

  it('selection is mirrored to ?sheet=&shape= without a navigation', () => {
    const spy = vi.spyOn(window.history, 'replaceState')
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    expect(spy.mock.calls.at(-1)?.[2]).toBe('/projects/p1/tenant-schedule/floor-plan?sheet=sh1&shape=s1')
  })
})
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans/StatusPlanWorkspace.test.tsx"` → FAIL.

- [ ] **Step 2: Rewrite `_plans/StatusPlanWorkspace.tsx`**

```tsx
'use client'

/**
 * A tenant plan's client side: the sheet strip, the current sheet's canvas,
 * writes, banners and the legend (spec 2026-10-12 §2, §5).
 *
 * Every shape write is a per-shape server action whose result is FOLDED INTO
 * LOCAL STATE. There is no router.refresh(): it would re-render the server page
 * under the canvas and re-mint the sheet's signed URL. Moving to another sheet
 * is a navigation (?sheet=), the one time a new URL is wanted. Selection is
 * mirrored to ?sheet=&shape= with history.replaceState (no server round trip),
 * so the tenant schedule's "On plan" link and a reload land on the same shape.
 *
 * `shapes` holds every sheet's shapes: the canvas gets the current sheet's, the
 * legend shows this sheet and the whole plan, and the node picker sees them all
 * (a board appears once per plan, across sheets).
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PURPOSE_LABEL, type AreaType } from '@esite/shared/status-plans'
import {
  createStatusPlanShapeAction,
  deleteStatusPlanShapeAction,
  updateStatusPlanShapeAction,
} from '@/actions/status-plan.actions'
import { reanchorTenantPlanSheetAction } from '@/actions/tenant-plan-sheets.actions'
import { legendSummary, needsAttention, resolveShapeView, type ShapeView } from '@/lib/status-plans/shape-view'
import { buildNodeOptions } from '@/lib/status-plans/node-options'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import type { CanvasTool, ShapeCommit } from '@/lib/status-plans/canvas-reducer'
import type { ActionResult, CanvasShape, PlanNode, PlanSheet, SheetSummary, StatusPlanPageProps } from '@/lib/status-plans/types'
import { ShapePanel } from './ShapePanel'
import { PlanLegend } from './PlanLegend'
import { DetectBlocksPanel, type DetectNode } from './DetectBlocksPanel'
import { SheetStrip } from './SheetStrip'
import { SheetControls } from './SheetControls'

/**
 * A plan node as the block matcher reads it. The loader shows a missing code
 * as '—' and folds a board's name into shopName (shop_name ?? name), which is
 * the name the main-board alias needs.
 */
function toDetectNode(n: PlanNode): DetectNode {
  return { id: n.id, kind: n.kind, code: n.code && n.code !== '—' ? n.code : null, shop_number: n.shopNumber, name: n.shopName }
}

const StatusPlanCanvas = dynamic(() => import('./StatusPlanCanvas').then((m) => m.StatusPlanCanvas), {
  ssr: false,
  loading: () => <div className="data-panel" style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>Loading the sheet…</div>,
})

const ARM_MS = 4000
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function StatusPlanWorkspace(props: StatusPlanPageProps) {
  const { projectId, plan, canEdit, today } = props
  const purpose = plan.purpose

  const [shapes, setShapes] = useState<CanvasShape[]>(props.shapes)
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const [sheet, setSheet] = useState<PlanSheet>(props.sheet)
  const [sheets, setSheets] = useState<SheetSummary[]>(props.sheets)
  const [selectedId, setSelectedId] = useState<string | null>(props.initialShapeId)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; conflict: boolean } | null>(null)
  const [armedShape, setArmedShape] = useState<string | null>(null)
  const [requestedTool, setRequestedTool] = useState<{ tool: CanvasTool; nonce: number } | null>(null)

  useEffect(() => {
    if (!armedShape) return
    const t = setTimeout(() => setArmedShape(null), ARM_MS)
    return () => clearTimeout(t)
  }, [armedShape])

  // ?sheet=&shape= mirror the view without a navigation.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', tenantPlanHref(projectId, purpose, { sheet: sheet.id, shape: selectedId }))
    } catch {
      /* a sandboxed frame may refuse; the selection still works */
    }
  }, [projectId, purpose, sheet.id, selectedId])

  /** A sheet row changed on the server (rename, re-anchor, scale): keep the strip and the canvas in step. */
  const applySheet = useCallback((s: SheetSummary) => {
    setSheets((prev) => prev.map((x) => (x.id === s.id ? s : x)))
    setSheet((prev) => (prev.id === s.id ? { ...prev, ...s } : prev))
  }, [])

  // ── Derived ──────────────────────────────────────────────────────────────
  const nodesById = useMemo(() => new Map(props.nodes.map((n) => [n.id, n])), [props.nodes])
  const scaleBySheet = useMemo(() => new Map(sheets.map((s) => [s.id, s.pixelsPerMeter])), [sheets])
  const pixelsPerMeter = sheet.pixelsPerMeter
  const views = useMemo(() => {
    const out: Record<string, ShapeView> = {}
    for (const s of shapes) {
      out[s.id] = resolveShapeView(s, {
        purpose, nodesById, shopLinks: props.shopLinks, dbOrders: props.dbOrders, today,
        pixelsPerMeter: scaleBySheet.get(s.sheetId) ?? null,
      })
    }
    return out
  }, [shapes, purpose, nodesById, props.shopLinks, props.dbOrders, today, scaleBySheet])
  const sheetShapes = useMemo(() => shapes.filter((s) => s.sheetId === sheet.id), [shapes, sheet.id])
  const sheetSummary = useMemo(() => legendSummary(sheetShapes.map((s) => views[s.id]!), purpose), [sheetShapes, views, purpose])
  const planSummary = useMemo(() => legendSummary(shapes.map((s) => views[s.id]!), purpose), [shapes, views, purpose])
  const attention = useMemo(() => needsAttention(sheetShapes, views), [sheetShapes, views])
  const selected = sheetShapes.find((s) => s.id === selectedId) ?? null
  const detectNodes = useMemo(() => props.nodes.map(toDetectNode), [props.nodes])
  const options = useMemo(() => buildNodeOptions(props.nodes, shapes, selectedId, purpose), [props.nodes, shapes, selectedId, purpose])

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
    run(() => createStatusPlanShapeAction({ sheetId: sheet.id, shape: c.shape, points: c.points }), (s) => {
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
  }, [selectedId, armedShape])

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    setArmedShape(null)
  }, [])

  function reanchor() {
    void run(() => reanchorTenantPlanSheetAction({ sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt }), applySheet)
  }

  // Line diagrams: read the sheet's text and propose one rectangle per DB block.
  // existingShapes is the LIVE state of this sheet, so a re-run leaves accepted blocks out.
  const schematicSlot = purpose === 'distribution_schematic' ? (
    <div data-slot="schematic-detection">
      <DetectBlocksPanel
        sheetId={sheet.id}
        pageIndex={sheet.pageIndex}
        pdfUrl={sheet.signedUrl}
        isPdf={sheet.isPdf}
        nodes={detectNodes}
        existingShapes={sheetShapes.map((s) => ({ id: s.id, points: s.points, nodeId: s.nodeId }))}
        canEdit={canEdit}
        onAccepted={(added) => setShapes((prev) => [...prev, ...added])}
      />
    </div>
  ) : null

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{PURPOSE_LABEL[purpose]}</h1>
        <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>
          {sheet.label} · {sheet.fileName}{sheet.isPdf ? ` · page ${sheet.pageIndex}` : ''}
        </span>
      </div>

      <SheetStrip projectId={projectId} purpose={purpose} sheets={sheets} currentId={sheet.id} canEdit={canEdit} />
      {canEdit && (
        <SheetControls projectId={projectId} purpose={purpose} sheet={sheet} shapeCount={sheetShapes.length} onChanged={applySheet} />
      )}

      {sheet.replacedAt && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, borderColor: 'var(--c-amber)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            This sheet&apos;s file was replaced (<strong>{sheet.fileName}</strong>, revision {sheet.revision}). Shapes and the scale
            were kept where they were — check them against the new file.
          </span>
          {canEdit && <button type="button" disabled={busy} onClick={reanchor}>Shapes checked — keep them</button>}
        </div>
      )}

      {purpose === 'tenant_layout' && pixelsPerMeter === null && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Set this sheet&apos;s scale to measure areas. Until then areas show “—”.</span>
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
          pageIndex={sheet.pageIndex}
          purpose={purpose}
          shapes={sheetShapes}
          views={views}
          selectedId={selectedId}
          canEdit={canEdit}
          busy={busy}
          requestedTool={requestedTool}
          onSelect={onSelect}
          onCreate={onCreate}
          onReshape={onReshape}
          onDeleteRequest={requestDelete}
          onCalibrated={applySheet}
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
          <PlanLegend
            purpose={purpose}
            summary={sheetSummary}
            planSummary={planSummary}
            sheetCount={sheets.length}
            hasScale={pixelsPerMeter !== null}
            attention={attention}
            onSelectShape={onSelect}
          />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run the whole `_plans` folder**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_plans"
```

Expected: PASS for every file except possibly `ExportSheetButton.test.tsx` (Task F4).

- [ ] **Step 4: Commit**

```bash
T="apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans"
git add "$T/StatusPlanWorkspace.tsx" "$T/StatusPlanWorkspace.test.tsx"
git commit -m "feat(tenant-plans): workspace steps between sheets, re-anchors replaced files, totals across sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase E — The flow starts at Tenants

### Task E1: The two routes

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/floor-plan/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/line-diagram/page.tsx`
- Modify (rewrite): `apps/web/src/lib/status-plans/page-props.contract.test.ts`

- [ ] **Step 1: Point the JSON-props contract at the new pages (red)**

Replace `page-props.contract.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/**
 * PAGE → CLIENT PROPS MUST BE JSON. A function passed from a page.tsx to a
 * 'use client' component passes tsc AND next build and fails only at render
 * (PR #201). The runtime half of this guard is load-plan-page.test.ts
 * (jsonUnsafePath on the assembled props); this half reads the two tenant plan
 * routes and fails if any client component they render is handed an arrow
 * function, a function expression or a server action by name.
 */
const BASE = resolve(__dirname, '../../app/(admin)/projects/[id]/tenant-schedule')
const PAGES = [resolve(BASE, 'floor-plan/page.tsx'), resolve(BASE, 'line-diagram/page.tsx')]

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

describe('tenant plan routes hand their client components JSON only', () => {
  for (const page of PAGES) {
    it(page.slice(BASE.length), () => {
      const src = readFileSync(page, 'utf8')
      const names = clientComponents(src, dirname(page))
      expect(names.length, 'expected the page to render a client component').toBeGreaterThan(0)
      for (const n of names) {
        const tags = openingTags(src, n)
        expect(tags.length, `${n} is imported but never rendered`).toBeGreaterThan(0)
        for (const tag of tags) expect(tag, `${n} receives a function`).not.toMatch(/=>|\bfunction\b|Action\b/)
      }
    })

    it(`${page.slice(BASE.length)} spreads the assembled props and adds nothing`, () => {
      const src = readFileSync(page, 'utf8')
      expect(openingTags(src, 'StatusPlanWorkspace')).toEqual(['<StatusPlanWorkspace {...data.props} />'])
      expect(openingTags(src, 'TenantPlanEmpty')).toEqual(['<TenantPlanEmpty {...data.empty} />'])
    })
  }
})
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/page-props.contract.test.ts` → FAIL (pages missing).

- [ ] **Step 2: The floor plan route**

`apps/web/src/app/(admin)/projects/[id]/tenant-schedule/floor-plan/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadTenantPlanPage } from '@/lib/status-plans/load-plan-page'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'
import { StatusPlanWorkspace } from '../_plans/StatusPlanWorkspace'
import { TenantPlanEmpty } from '../_plans/TenantPlanEmpty'

export const dynamic = 'force-dynamic'
/** Registering a large PDF (download + page count) runs as a server action from this page. */
export const maxDuration = 60
export const metadata: Metadata = { title: 'Tenant floor plan' }

interface Props {
  params: Promise<{ id: string }>
  /** ?sheet= picks the sheet; ?shape= selects a shape (the tenant schedule's "On plan" link). */
  searchParams: Promise<{ sheet?: string; shape?: string }>
}

/**
 * The tenant floor plan: upload it, mask the shops, link them (spec 2026-10-12 §2).
 * Every project role reads (RLS + site scope through the caller's session);
 * owner / admin / PM upload and edit. The props come from loadTenantPlanPage and
 * are JSON only — this page adds nothing to them (page-props.contract.test.ts).
 */
export default async function TenantFloorPlanPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { sheet, shape } = await searchParams
  const supabase = await createClient()
  const data = await loadTenantPlanPage(supabase, {
    projectId, purpose: 'tenant_layout', requestedSheetId: sheet ?? null, requestedShapeId: shape ?? null,
  })
  if (!data) notFound()

  return (
    <div style={{ padding: '16px 20px' }}>
      <Link href={tenantScheduleHref(projectId)} style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
        ← Tenant schedule
      </Link>
      <div style={{ marginTop: 8 }}>
        {data.kind === 'empty' ? <TenantPlanEmpty {...data.empty} /> : <StatusPlanWorkspace {...data.props} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: The line diagram route**

`apps/web/src/app/(admin)/projects/[id]/tenant-schedule/line-diagram/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadTenantPlanPage } from '@/lib/status-plans/load-plan-page'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'
import { StatusPlanWorkspace } from '../_plans/StatusPlanWorkspace'
import { TenantPlanEmpty } from '../_plans/TenantPlanEmpty'
import { ExportSheetButton } from '../_plans/ExportSheetButton'

export const dynamic = 'force-dynamic'
/** Registering a large PDF (download + page count) runs as a server action from this page. */
export const maxDuration = 60
export const metadata: Metadata = { title: 'Line diagram' }

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sheet?: string; shape?: string }>
}

/**
 * The line diagram (300 schematic): upload it, detect and hatch the DB blocks
 * (spec 2026-10-12 §2). Same reads and gates as the floor plan. "Export sheet"
 * downloads the sheet on screen at its own size.
 */
export default async function LineDiagramPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { sheet, shape } = await searchParams
  const supabase = await createClient()
  const data = await loadTenantPlanPage(supabase, {
    projectId, purpose: 'distribution_schematic', requestedSheetId: sheet ?? null, requestedShapeId: shape ?? null,
  })
  if (!data) notFound()

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link href={tenantScheduleHref(projectId)} style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          ← Tenant schedule
        </Link>
        {data.kind === 'plan' && (
          <span style={{ marginLeft: 'auto' }}>
            <ExportSheetButton projectId={projectId} planId={data.props.plan.id} sheetId={data.props.sheet.id} />
          </span>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        {data.kind === 'empty' ? <TenantPlanEmpty {...data.empty} /> : <StatusPlanWorkspace {...data.props} />}
      </div>
    </div>
  )
}
```

(`ExportSheetButton` gains `sheetId` in Task F4; until then `tsc` reports the extra prop. That is the expected red between E1 and F4 if tasks are run strictly in order; run F4 next if you want `tsc` green sooner.)

- [ ] **Step 4: Run the contract**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/page-props.contract.test.ts
```

Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/floor-plan" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/line-diagram" apps/web/src/lib/status-plans/page-props.contract.test.ts
git commit -m "feat(tenant-plans): floor plan and line diagram routes under the tenant schedule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task E2: "Tenant plans" on the tenant schedule

**Files:**
- Create: `apps/web/src/lib/status-plans/plan-cards.ts` (+ `.test.ts`)
- Create: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantPlansSection.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx`

- [ ] **Step 1: Card loader test (red)**

`apps/web/src/lib/status-plans/plan-cards.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued } from './__fixtures__/fake-client'
import { emptyCards, loadTenantPlanCards } from './plan-cards'

describe('loadTenantPlanCards', () => {
  it('one card per tool, floor plan first, with sheet / shape / linked counts', async () => {
    const { client } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: [{ id: 'ld', purpose: 'distribution_schematic' }, { id: 'fp', purpose: 'tenant_layout' }] }],
      'tenants.status_plan_sheets:select': [{ data: [{ id: 'a', status_plan_id: 'fp' }, { id: 'b', status_plan_id: 'fp' }, { id: 'c', status_plan_id: 'ld' }] }],
      'tenants.status_plan_shapes:select': [{ data: [
        { id: 's1', status_plan_id: 'fp', node_id: 'n1' },
        { id: 's2', status_plan_id: 'fp', node_id: null },
        { id: 's3', status_plan_id: 'ld', node_id: 'm1' },
      ] }],
    }))
    expect(await loadTenantPlanCards(client, 'p1')).toEqual([
      { purpose: 'tenant_layout', planId: 'fp', sheets: 2, shapes: 2, linked: 1 },
      { purpose: 'distribution_schematic', planId: 'ld', sheets: 1, shapes: 1, linked: 1 },
    ])
  })

  it('no plans yet: two empty cards', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ data: [] }] }))
    expect(await loadTenantPlanCards(client, 'p1')).toEqual(emptyCards())
    expect(emptyCards().map((c) => c.purpose)).toEqual(['tenant_layout', 'distribution_schematic'])
  })

  it('never breaks the schedule: a read error is two empty cards', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ error: { message: 'relation does not exist' } }] }))
    expect(await loadTenantPlanCards(client, 'p1')).toEqual(emptyCards())
  })
})
```

- [ ] **Step 2: `plan-cards.ts`**

```ts
/**
 * The tenant schedule's "Tenant plans" cards (spec 2026-10-12 §2): per tool,
 * whether a plan exists and how many sheets, shapes and linked shapes it has.
 * Read through the caller's session. Best-effort by design: any read error
 * answers the two empty cards, so the schedule never fails because of a plan.
 */
import { STATUS_PLAN_PURPOSES, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TenantPlanCard {
  purpose: StatusPlanPurpose
  planId: string | null
  sheets: number
  shapes: number
  linked: number
}

/** Floor plan first, then line diagram (STATUS_PLAN_PURPOSES order). */
export function emptyCards(): TenantPlanCard[] {
  return STATUS_PLAN_PURPOSES.map((purpose) => ({ purpose, planId: null, sheets: 0, shapes: 0, linked: 0 }))
}

export async function loadTenantPlanCards(client: unknown, projectId: string): Promise<TenantPlanCard[]> {
  const cards = emptyCards()
  try {
    const db = client as any
    const plans = await db.schema('tenants').from('status_plans').select('id, purpose').eq('project_id', projectId)
    if (plans.error || !plans.data?.length) return cards
    const ids = (plans.data as Array<{ id: string }>).map((p) => p.id)
    const [sheets, shapes] = await Promise.all([
      db.schema('tenants').from('status_plan_sheets').select('id, status_plan_id').in('status_plan_id', ids),
      readAll<{ id: string; status_plan_id: string; node_id: string | null }>((from, to) =>
        db.schema('tenants').from('status_plan_shapes').select('id, status_plan_id, node_id')
          .in('status_plan_id', ids).order('id').range(from, to)),
    ])
    if (sheets.error || 'error' in shapes) return emptyCards()
    for (const p of plans.data as Array<{ id: string; purpose: StatusPlanPurpose }>) {
      const card = cards.find((c) => c.purpose === p.purpose)
      if (!card) continue
      const mine = shapes.data.filter((s) => s.status_plan_id === p.id)
      card.planId = p.id
      card.sheets = (sheets.data as Array<{ status_plan_id: string }>).filter((s) => s.status_plan_id === p.id).length
      card.shapes = mine.length
      card.linked = mine.filter((s) => s.node_id).length
    }
    return cards
  } catch {
    return emptyCards()
  }
}
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-cards.test.ts` → PASS (3).

- [ ] **Step 3: Section test (red)**

`apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantPlansSection.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TenantPlansSection } from './TenantPlansSection'
import type { TenantPlanCard } from '@/lib/status-plans/plan-cards'

const cards = (fp: Partial<TenantPlanCard> = {}, ld: Partial<TenantPlanCard> = {}): TenantPlanCard[] => [
  { purpose: 'tenant_layout', planId: null, sheets: 0, shapes: 0, linked: 0, ...fp },
  { purpose: 'distribution_schematic', planId: null, sheets: 0, shapes: 0, linked: 0, ...ld },
]
const card = (name: string) => screen.getByRole('article', { name })
const links = (name: string) => within(card(name)).queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])

describe('TenantPlansSection', () => {
  it('exactly two cards: Floor plan and Line diagram', () => {
    render(<TenantPlansSection projectId="p1" cards={cards()} canWrite />)
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Floor plan', 'Line diagram'])
  })

  it('a writer with nothing loaded gets Upload', () => {
    render(<TenantPlansSection projectId="p1" cards={cards()} canWrite />)
    expect(links('Floor plan')).toEqual([['Upload', '/projects/p1/tenant-schedule/floor-plan']])
    expect(links('Line diagram')).toEqual([['Upload', '/projects/p1/tenant-schedule/line-diagram']])
  })

  it('a writer with a plan loaded gets the counts, Open and Upload / Replace', () => {
    render(<TenantPlansSection projectId="p1" cards={cards({ planId: 'fp', sheets: 3, shapes: 41, linked: 38 })} canWrite />)
    expect(within(card('Floor plan')).getByText('3 sheets · 41 shapes · 38 shops linked')).toBeTruthy()
    expect(links('Floor plan')).toEqual([
      ['Open', '/projects/p1/tenant-schedule/floor-plan'],
      ['Upload / Replace', '/projects/p1/tenant-schedule/floor-plan'],
    ])
  })

  it('a read-only role sees Open only, and nothing to click when nothing is loaded', () => {
    render(<TenantPlansSection projectId="p1" cards={cards({}, { planId: 'ld', sheets: 1, shapes: 9, linked: 7 })} canWrite={false} />)
    expect(links('Floor plan')).toEqual([])
    expect(within(card('Floor plan')).getByText('Nothing uploaded yet.')).toBeTruthy()
    expect(links('Line diagram')).toEqual([['Open', '/projects/p1/tenant-schedule/line-diagram']])
    expect(within(card('Line diagram')).getByText('1 sheet · 9 shapes · 7 boards linked')).toBeTruthy()
  })
})
```

- [ ] **Step 4: `TenantPlansSection.tsx`**

```tsx
/**
 * "Tenant plans" on the tenant schedule (spec 2026-10-12 §2): exactly two cards,
 * Floor plan and Line diagram. Server-renderable (links only, no state).
 * Writers get Upload (nothing loaded) or Open + Upload / Replace; every other
 * role gets Open when something is loaded.
 */
import Link from 'next/link'
import type { StatusPlanPurpose } from '@esite/shared/status-plans'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import type { TenantPlanCard } from '@/lib/status-plans/plan-cards'

const COPY: Record<StatusPlanPurpose, { title: string; blurb: string; linked: string }> = {
  tenant_layout: { title: 'Floor plan', blurb: 'Upload the floor plan, then mask and link shops.', linked: 'shops linked' },
  distribution_schematic: { title: 'Line diagram', blurb: 'Upload the 300 schematic, then detect and hatch DB blocks.', linked: 'boards linked' },
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const button = {
  border: '1px solid var(--c-border)', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600,
  textDecoration: 'none', color: 'var(--c-text)', whiteSpace: 'nowrap',
} as const

export function TenantPlansSection({ projectId, cards, canWrite }: { projectId: string; cards: TenantPlanCard[]; canWrite: boolean }) {
  return (
    <section aria-labelledby="tenant-plans-heading" style={{ marginBottom: 16 }}>
      <h2 id="tenant-plans-heading" style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Tenant plans</h2>
      <div className="stack-on-phone" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {cards.map((c) => {
          const copy = COPY[c.purpose]
          const href = tenantPlanHref(projectId, c.purpose)
          const loaded = c.sheets > 0
          return (
            <article key={c.purpose} aria-label={copy.title} className="data-panel" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{copy.title}</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>{copy.blurb}</p>
              <p style={{ margin: 0, fontSize: 13, fontFamily: loaded ? 'var(--font-mono)' : undefined, color: 'var(--c-text-mid)' }}>
                {loaded ? `${plural(c.sheets, 'sheet')} · ${plural(c.shapes, 'shape')} · ${c.linked} ${copy.linked}` : 'Nothing uploaded yet.'}
              </p>
              {(loaded || canWrite) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {loaded && <Link href={href} style={button}>Open</Link>}
                  {canWrite && <Link href={href} style={button}>{loaded ? 'Upload / Replace' : 'Upload'}</Link>}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantPlansSection.test.tsx"` → PASS (4).

- [ ] **Step 5: Wire it into the tenant schedule page**

In `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx`:

1. Add imports after `import { loadOnPlanLinks } from '@/lib/status-plans/on-plan-links'`:

```ts
import { loadTenantPlanCards } from '@/lib/status-plans/plan-cards'
import { TenantPlansSection } from './_components/TenantPlansSection'
```

2. Directly after `const onPlanPromise = loadOnPlanLinks(supabase, projectId)` add:

```ts
  // Started now as well; loadTenantPlanCards never rejects.
  const planCardsPromise = loadTenantPlanCards(supabase, projectId)
```

3. Directly after `const onPlanByNode = await onPlanPromise` add:

```ts
  const planCards = await planCardsPromise
```

4. Between the opening-date `</div>` and the `{/* Fetch error */}` comment, add:

```tsx
      {/* Tenant plans: the floor plan and the line diagram (spec 2026-10-12) */}
      <TenantPlansSection projectId={projectId} cards={planCards} canWrite={canWrite} />
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/status-plans/plan-cards.ts apps/web/src/lib/status-plans/plan-cards.test.ts "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantPlansSection.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantPlansSection.test.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx"
git commit -m "feat(tenant-plans): Tenant plans section with Floor plan and Line diagram cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task E3: "On plan ↗" links to the floor plan sheet

**Files:**
- Modify (rewrite): `apps/web/src/lib/status-plans/on-plan-links.ts` (+ `.test.ts`)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Rewrite the test (red)**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { pickOnPlanLinks, loadOnPlanLinks } from './on-plan-links'

const SHEETS = [
  { id: 'sh2', label: 'Level 1', sort_order: 1 },
  { id: 'sh1', label: 'Ground floor', sort_order: 0 },
]
const SHAPES = [
  { id: 's-1', sheet_id: 'sh1', node_id: 'n1' },
  { id: 's-2', sheet_id: 'sh2', node_id: 'n2' },
]

describe('pickOnPlanLinks', () => {
  it('each linked shop points at its sheet and shape', () => {
    expect(pickOnPlanLinks(SHEETS, SHAPES)).toEqual({
      n1: { sheetId: 'sh1', sheetLabel: 'Ground floor', shapeId: 's-1' },
      n2: { sheetId: 'sh2', sheetLabel: 'Level 1', shapeId: 's-2' },
    })
  })
})

describe('loadOnPlanLinks', () => {
  it('reads the project\'s floor plan, its sheets and its linked shapes', async () => {
    const { client, calls } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: { id: 'fp' } }],
      'tenants.status_plan_sheets:select': [{ data: SHEETS }],
      'tenants.status_plan_shapes:select': [{ data: SHAPES }],
    }))
    expect(Object.keys(await loadOnPlanLinks(client, 'p1')).sort()).toEqual(['n1', 'n2'])
    expect(opsOf(calls, 'tenants.status_plans')).toEqual(expect.arrayContaining([
      ['eq', ['project_id', 'p1']], ['eq', ['purpose', 'tenant_layout']],
    ]))
    expect(opsOf(calls, 'tenants.status_plan_shapes')).toContainEqual(['not', ['node_id', 'is', null]])
  })

  it('no floor plan: no links', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ data: null }] }))
    expect(await loadOnPlanLinks(client, 'p1')).toEqual({})
  })

  it('never breaks the schedule: a read error is an empty map', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ error: { message: 'relation does not exist' } }] }))
    expect(await loadOnPlanLinks(client, 'p1')).toEqual({})
  })
})
```

- [ ] **Step 2: Rewrite `on-plan-links.ts`**

```ts
/**
 * For the tenant schedule: where each shop sits on the project's tenant floor
 * plan, so a row can link straight to its shape (?sheet=&shape=). A board
 * appears at most once per plan (00245 unique key), so each shop has at most one.
 *
 * Best-effort by design: any read error answers {} and the schedule renders
 * without links. The schedule must never fail because of a plan.
 */
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OnPlanLink {
  sheetId: string
  sheetLabel: string
  shapeId: string
}

export function pickOnPlanLinks(
  sheets: ReadonlyArray<{ id: string; label: string; sort_order: number }>,
  shapes: ReadonlyArray<{ id: string; sheet_id: string; node_id: string | null }>,
): Record<string, OnPlanLink> {
  const ordered = [...sheets].sort((a, b) => a.sort_order - b.sort_order)
  const out: Record<string, OnPlanLink> = {}
  for (const sheet of ordered) {
    for (const s of shapes) {
      if (s.sheet_id !== sheet.id || !s.node_id || out[s.node_id]) continue
      out[s.node_id] = { sheetId: sheet.id, sheetLabel: sheet.label, shapeId: s.id }
    }
  }
  return out
}

export async function loadOnPlanLinks(client: unknown, projectId: string): Promise<Record<string, OnPlanLink>> {
  try {
    const db = client as any
    const planRes = await db.schema('tenants').from('status_plans')
      .select('id').eq('project_id', projectId).eq('purpose', 'tenant_layout').maybeSingle()
    if (planRes.error || !planRes.data) return {}
    const planId = planRes.data.id as string
    const sheetsRes = await db.schema('tenants').from('status_plan_sheets')
      .select('id, label, sort_order').eq('status_plan_id', planId)
    if (sheetsRes.error) return {}
    const shapes = await readAll<{ id: string; sheet_id: string; node_id: string | null }>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select('id, sheet_id, node_id')
        .eq('status_plan_id', planId).not('node_id', 'is', null).order('id').range(from, to))
    if ('error' in shapes) return {}
    return pickOnPlanLinks(sheetsRes.data ?? [], shapes.data)
  } catch {
    return {}
  }
}
```

- [ ] **Step 3: ScheduleTable**

In `ScheduleTable.tsx`: replace `import { statusPlanHref } from '@/lib/status-plans/plan-urls'` with `import { tenantPlanHref } from '@/lib/status-plans/plan-urls'`; change the prop comment to `/** node_id → where this shop sits on the tenant floor plan (tenant plans). */`; replace the two link attributes

```tsx
                              href={statusPlanHref(projectId, onPlanByNode[node.id]!.planId, onPlanByNode[node.id]!.shapeId)}
                              title={`Shown on ${onPlanByNode[node.id]!.planName}`}
```

with

```tsx
                              href={tenantPlanHref(projectId, 'tenant_layout', { sheet: onPlanByNode[node.id]!.sheetId, shape: onPlanByNode[node.id]!.shapeId })}
                              title={`Shown on the floor plan, ${onPlanByNode[node.id]!.sheetLabel}`}
```

In `ScheduleTable.test.tsx`, in `describe('ScheduleTable status plan link')`: replace the prop value with `onPlanByNode={{ n1: { sheetId: 'sh1', sheetLabel: 'Ground floor', shapeId: 's1' } }}`, the href expectation with `'/projects/p1/tenant-schedule/floor-plan?sheet=sh1&shape=s1'`, and the title expectation with `'Shown on the floor plan, Ground floor'`.

- [ ] **Step 4: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/on-plan-links.test.ts "src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/on-plan-links.ts apps/web/src/lib/status-plans/on-plan-links.test.ts "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.test.tsx"
git commit -m "feat(tenant-plans): On plan links open the floor plan sheet with the shop selected

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task E4: The old routes redirect; the list, form and sidebar entry go

**Files:**
- Modify (rewrite): `apps/web/src/app/(admin)/projects/[id]/status-plans/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/page.tsx` (rewrite of the moved-out page)
- Create: `apps/web/src/app/(admin)/projects/[id]/status-plans/redirect.test.ts`
- Delete: `status-plans/NewStatusPlanForm.tsx`, `status-plans/NewStatusPlanForm.test.tsx`, `lib/status-plans/plan-list.ts`, `lib/status-plans/plan-list.test.ts`
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Redirect test (red)**

`apps/web/src/app/(admin)/projects/[id]/status-plans/redirect.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))

import StatusPlansMoved from './page'
import StatusPlanMoved from './[planId]/page'

describe('old status plan routes', () => {
  it('the list redirects to the tenant schedule', async () => {
    await expect(StatusPlansMoved({ params: Promise.resolve({ id: 'p1' }) })).rejects.toThrow('NEXT_REDIRECT /projects/p1/tenant-schedule')
  })
  it('a plan redirects to the tenant schedule', async () => {
    await expect(StatusPlanMoved({ params: Promise.resolve({ id: 'p1', planId: 'pl1' }) })).rejects.toThrow('NEXT_REDIRECT /projects/p1/tenant-schedule')
  })
})
```

- [ ] **Step 2: The two redirect pages**

Replace `status-plans/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'

export const dynamic = 'force-dynamic'

/**
 * Status plans moved under the tenant schedule (spec 2026-10-12 §2): the floor
 * plan and the line diagram are its two "Tenant plans" cards. redirect() in a
 * server component answers 307, so old bookmarks keep working.
 */
export default async function StatusPlansMoved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(tenantScheduleHref(id))
}
```

Write `status-plans/[planId]/page.tsx` (the folder still exists; its old page was not moved, only its components):

```tsx
import { redirect } from 'next/navigation'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'

export const dynamic = 'force-dynamic'

/** A status plan link from before tenant plans: go to the tenant schedule (307). */
export default async function StatusPlanMoved({ params }: { params: Promise<{ id: string; planId: string }> }) {
  const { id } = await params
  redirect(tenantScheduleHref(id))
}
```

- [ ] **Step 3: Delete what no longer has a place**

```bash
git rm "apps/web/src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.tsx" "apps/web/src/app/(admin)/projects/[id]/status-plans/NewStatusPlanForm.test.tsx" apps/web/src/lib/status-plans/plan-list.ts apps/web/src/lib/status-plans/plan-list.test.ts
rmdir "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]/_components" 2>/dev/null || true
ls "apps/web/src/app/(admin)/projects/[id]/status-plans" "apps/web/src/app/(admin)/projects/[id]/status-plans/[planId]"
```

Expected: `page.tsx  redirect.test.ts  [planId]` and `page.tsx`.

- [ ] **Step 4: Sidebar**

In `apps/web/src/components/layout/Sidebar.tsx`, delete the line

```ts
    { href: `/projects/${id}/status-plans`,       label: 'Status plans',       Icon: Layers,        exact: false },
```

and remove `Layers` from the `lucide-react` import on line 13 (`Receipt, Activity, Layers,` → `Receipt, Activity,`) after confirming it has no other use:

```bash
grep -n "Layers" apps/web/src/components/layout/Sidebar.tsx
```

Expected after the edit: no output.

In `Sidebar.test.tsx`, replace the whole `describe('Sidebar — Status plans', …)` block with:

```tsx
describe('Sidebar — tenant plans live under the tenant schedule', () => {
  it('has no Status plans entry; Tenant Schedule is still there', () => {
    pathname = '/projects/p1/tenant-schedule'
    render(<Sidebar role="owner" />)
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).not.toContain('/projects/p1/status-plans')
    expect(hrefs).toContain('/projects/p1/tenant-schedule')
  })

  it('marks Tenant Schedule active on the floor plan route', () => {
    pathname = '/projects/p1/tenant-schedule/floor-plan'
    render(<Sidebar role="owner" />)
    expect(screen.getByRole('link', { name: 'Tenant Schedule' }).getAttribute('aria-current')).toBe('page')
  })
})
```

- [ ] **Step 5: Nothing still points at the old routes or the removed exports**

```bash
git grep -n "statusPlansHref\|statusPlanHref\|NewStatusPlanForm\|plan-list\|createStatusPlanAction\|renameStatusPlanAction\|deleteStatusPlanAction\|reanchorStatusPlanAction\|listPortalStatusPlans" -- apps/web/src
git grep -n "'/projects/.*status-plans\|/status-plans\`" -- apps/web/src ':!apps/web/src/app/api'
```

Expected: the first command lists only `lib/portal/data.ts` and the portal status-plans page (fixed in Task F5); the second prints nothing outside the two redirect pages and their test.

- [ ] **Step 6: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/status-plans" src/components/layout/Sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A "apps/web/src/app/(admin)/projects/[id]/status-plans" apps/web/src/lib/status-plans apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.test.tsx
git commit -m "feat(tenant-plans): old status plan routes redirect to the tenant schedule; list, form and sidebar entry removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase F — Reports, export, portal, docs, verification

### Task F1: The renderer names sheets and draws a whole plan

**Files:**
- Modify: `apps/web/src/lib/status-plans/render-plan-page.ts` (+ `render-plan-page.test.ts`)
- Modify (fixtures): `apps/web/src/lib/status-plans/appendix.test.ts`, `apps/web/src/lib/reports/render-tenant-schedule.render.test.ts`

- [ ] **Step 1: Fixtures carry a sheet**

```bash
perl -pi -e "s/drawingName: 'Tenant layout',/drawingName: 'Tenant layout', sheetId: 'sh1', sheetLabel: 'Sheet 1 of 1',/" apps/web/src/lib/status-plans/render-plan-page.test.ts apps/web/src/lib/reports/render-tenant-schedule.render.test.ts
perl -pi -e "s/drawingName: 'Drawing',/drawingName: 'Drawing', sheetId: \`sh-\\\$\{id\}\`, sheetLabel: 'Sheet 1 of 1',/" apps/web/src/lib/status-plans/appendix.test.ts
grep -n "sheetLabel" apps/web/src/lib/status-plans/render-plan-page.test.ts apps/web/src/lib/reports/render-tenant-schedule.render.test.ts apps/web/src/lib/status-plans/appendix.test.ts
```

Expected: one hit per file; the `appendix.test.ts` line reads `` sheetId: `sh-${id}`, sheetLabel: 'Sheet 1 of 1', ``. If the perl escaping printed something else, edit that one line by hand.

- [ ] **Step 2: Add the whole-plan test (red)**

Append to `render-plan-page.test.ts` (and add `renderStatusPlanSheetsPdf, planTitle` to its import from `./render-plan-page`):

```ts
describe('renderStatusPlanSheetsPdf — every sheet of a plan (portal)', () => {
  it('one page per sheet, in order', async () => {
    const src = await sourcePdf({ pages: 2 })
    const out = await renderStatusPlanSheetsPdf([
      input(src, { sheetId: 'a', sheetLabel: 'Ground floor', source: { kind: 'pdf', bytes: src, pageIndex: 1 } }),
      input(src, { sheetId: 'b', sheetLabel: 'Level 1', source: { kind: 'pdf', bytes: src, pageIndex: 2 } }),
    ], 'a3')
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    expect(squash(drawnText(out))).toContain('Groundfloor')
    expect(squash(drawnText(out))).toContain('Level1')
  })

  it('a sheet that cannot be drawn is skipped; none drawable throws the reason', async () => {
    const good = await sourcePdf()
    const bad = new TextEncoder().encode('not a pdf')
    const out = await renderStatusPlanSheetsPdf([input(bad), input(good)], 'a3')
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
    await expect(renderStatusPlanSheetsPdf([input(bad)], 'a3')).rejects.toBeInstanceOf(StatusPlanSourceError)
    await expect(renderStatusPlanSheetsPdf([], 'a3')).rejects.toBeInstanceOf(StatusPlanSourceError)
  })

  it('names a sheet by plan, tool and sheet label', () => {
    expect(planTitle('Floor plan', 'tenant_layout', 'Level 1')).toBe('Floor plan (Tenant floor plan, Level 1)')
  })
})
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/render-plan-page.test.ts` → FAIL (no export).

- [ ] **Step 3: Edit `render-plan-page.ts`**

1. In `StatusPlanRenderInput`, after `planId: string` add:

```ts
  /** The sheet this page draws (one input per sheet). */
  sheetId: string
  /** The sheet's label, e.g. "Sheet 2 of 3 (E-300)" or "Level 1". */
  sheetLabel: string
```

and change the `drawingName` comment to `/** The sheet's file name. */`, `pageIndex` to `/** 1-based page within that file. */`.

2. Replace `planTitle`:

```ts
/** "Floor plan (Tenant floor plan, Level 1)" — how a sheet is named in not-included lines and dividers. */
export function planTitle(name: string, purpose: StatusPlanPurpose, sheetLabel: string): string {
  return `${name} (${PURPOSE_LABEL[purpose]}, ${sheetLabel})`
}
```

3. In `drawTitleStrip`, replace

```ts
    T(`${PURPOSE_LABEL[input.purpose]} · ${input.drawingName} · page ${input.pageIndex} · generated ${input.generatedOn}`),
```

with

```ts
    T(`${PURPOSE_LABEL[input.purpose]} · ${input.sheetLabel} · ${input.drawingName}${input.source.kind === 'pdf' ? ` p${input.pageIndex}` : ''} · generated ${input.generatedOn}`),
```

4. After `renderStatusPlanPdf`, add:

```ts
/**
 * Every sheet of a plan as one PDF, one page per sheet (the portal). A sheet
 * that cannot be drawn is skipped; when none can, the first reason is thrown
 * as a StatusPlanSourceError.
 */
export async function renderStatusPlanSheetsPdf(inputs: readonly StatusPlanRenderInput[], layout: PlanLayout): Promise<Uint8Array> {
  if (inputs.length === 0) throw new StatusPlanSourceError('there is no sheet to draw')
  const doc = await PDFDocument.create()
  doc.setTitle(T(inputs[0]!.planName))
  doc.setProducer('E-Site')
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  let first: StatusPlanSourceError | null = null
  let drawn = 0
  for (const input of inputs) {
    const before = doc.getPageCount()
    try {
      await drawStatusPlanPage(doc, input, layout, fonts)
      drawn++
    } catch (e) {
      while (doc.getPageCount() > before) doc.removePage(doc.getPageCount() - 1)
      first ??= e instanceof StatusPlanSourceError ? e : new StatusPlanSourceError('a sheet could not be drawn')
    }
  }
  if (drawn === 0) throw first ?? new StatusPlanSourceError('no sheet could be drawn')
  await pruneUnreachableObjects(doc)
  return doc.save()
}
```

- [ ] **Step 4: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/render-plan-page.test.ts
```

Expected: PASS (existing cases unchanged; 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/render-plan-page.ts apps/web/src/lib/status-plans/render-plan-page.test.ts apps/web/src/lib/status-plans/appendix.test.ts apps/web/src/lib/reports/render-tenant-schedule.render.test.ts
git commit -m "feat(tenant-plans): render inputs name their sheet; a whole plan renders as one PDF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F2: Render data, one input per sheet

**Files:**
- Modify (rewrite): `apps/web/src/lib/status-plans/plan-render-data.ts`
- Modify (rewrite): `apps/web/src/lib/status-plans/plan-render-data.test.ts`

- [ ] **Step 1: Rewrite the test (red)**

```ts
// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COLOURS, areaShapeStyle, dbBlockStyle, tenantShapeStyle } from '@esite/shared/status-plans'
import { fakeSupabase } from '@/test/fake-supabase'

const factsMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-schedule/shop-facts', () => ({ loadTenantShopFacts: factsMock }))

import {
  loadStatusPlanRenderInputs, orderSheets, sourceKindFor, MAX_PLAN_SHEETS_PER_REPORT,
  MAX_STATUS_PLAN_SOURCE_BYTES, MAX_STATUS_PLAN_TOTAL_BYTES, TENANT_PLAN_FILES,
} from './plan-render-data'

const PROJ = 'proj-1'
const ORG = 'org-1'
const TODAY = '2026-10-09'

function planRow(id: string, over: Record<string, unknown> = {}) {
  return { id, project_id: PROJ, organisation_id: ORG, purpose: 'tenant_layout', name: `Plan ${id}`, created_by: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over }
}
const filePath = (plan: string, folder: string, ext = 'pdf') => `${ORG}/${PROJ}/${plan}/${folder}/1.${ext}`
function sheetRow(id: string, plan: string, over: Record<string, unknown> = {}) {
  return { id, status_plan_id: plan, organisation_id: ORG, sort_order: 0, label: `Sheet ${id}`, file_path: filePath(plan, id),
    page_index: 1, file_name: `${id}.pdf`, mime: 'application/pdf', revision: 1, replaced_at: null, replaced_from_path: null,
    pixels_per_meter: 20, calibration_points: [0, 0, 20, 0], calibration_metres: 1, created_by: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over }
}
function shapeRow(id: string, plan: string, sheet: string, over: Record<string, unknown> = {}) {
  return { id, status_plan_id: plan, sheet_id: sheet, shape: 'polygon', points: [0, 0, 200, 0, 200, 100, 0, 100], node_id: null,
    area_type: null, detected_tag: null, source: 'manual', created_by: null, created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z', ...over }
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

function storageFake(files: Record<string, Uint8Array>) {
  const downloads: Array<[string, string]> = []
  return {
    downloads,
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push([bucket, path])
          const f = files[path]
          return f ? { data: new Blob([new Uint8Array(f)]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }),
    },
  }
}

function world(over: { plans?: any[]; sheets?: any[]; shapes?: any[]; files?: Record<string, Uint8Array>; maxRows?: number } = {}) {
  const sheets = over.sheets ?? [sheetRow('a1', 'a')]
  const pg = fakeSupabase({
    maxRows: over.maxRows,
    tables: {
      'projects.projects': [{ id: PROJ, organisation_id: ORG, opening_date: '2026-03-01' }],
      'tenants.status_plans': over.plans ?? [planRow('a')],
      'tenants.status_plan_sheets': sheets,
      'tenants.status_plan_shapes': over.shapes ?? [],
      'structure.nodes': [
        { id: 'n-done', project_id: PROJ, kind: 'tenant_db', code: 'TDB-01', shop_number: 'L01', shop_name: 'Done Ltd', name: null, status: 'active' },
        { id: 'n-late', project_id: PROJ, kind: 'tenant_db', code: 'TDB-02', shop_number: 'L02', shop_name: 'Late Ltd', name: null, status: 'active' },
        { id: 'mb', project_id: PROJ, kind: 'main_board', code: 'MB-3.1', shop_number: null, shop_name: null, name: 'MAIN BOARD 3.1', status: 'active' },
      ],
      'structure.scope_item_types': [{ id: 't-db', key: 'db', organisation_id: ORG }],
      'structure.node_orders': [{ id: 'o1', project_id: PROJ, node_id: 'mb', scope_item_type_id: 't-db', status: 'ordered' }],
    },
  })
  const st = storageFake(over.files ?? Object.fromEntries(sheets.map((s: any) => [s.file_path, PDF])))
  return { pg, st, clients: { db: pg.client, facts: pg.client, storage: st.storage } }
}

const load = (clients: any, o: Record<string, unknown> = {}) =>
  loadStatusPlanRenderInputs(clients, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'], ...o })

beforeEach(() => { factsMock.mockReset(); factsMock.mockResolvedValue(facts()) })

describe('pure helpers', () => {
  it('orders floor plan sheets before line diagram sheets, then by sheet position', () => {
    const ref = (purpose: string, plan: string, sort: number) => ({ plan: { id: plan, purpose } as any, row: { id: `${plan}${sort}`, sort_order: sort } as any })
    expect(orderSheets([ref('distribution_schematic', 'z', 0), ref('tenant_layout', 'y', 1), ref('tenant_layout', 'y', 0)]).map((r) => r.row.id))
      .toEqual(['y0', 'y1', 'z0'])
  })
  it('knows which files it can embed', () => {
    expect(sourceKindFor('a/b.pdf')).toBe('pdf')
    expect(sourceKindFor('a/b.png')).toBe('png')
    expect(sourceKindFor('a/b.jpg')).toBe('jpg')
    expect(sourceKindFor('a/b.webp')).toBeNull()
  })
})

describe('loadStatusPlanRenderInputs', () => {
  it('styles floor plan shapes from live facts; reads the sheet from tenant-plan-files', async () => {
    const { clients, st } = world({ shapes: [
      shapeRow('s1', 'a', 'a1', { node_id: 'n-done' }),
      shapeRow('s2', 'a', 'a1', { node_id: 'n-late' }),
      shapeRow('s3', 'a', 'a1', { area_type: 'common' }),
      shapeRow('s4', 'a', 'a1'),
    ] })
    const { inputs, omitted, organisationId } = await load(clients)
    expect(omitted).toEqual([])
    expect(organisationId).toBe(ORG)
    const [s] = inputs
    expect(s).toMatchObject({ planId: 'a', sheetId: 'a1', planName: 'Plan a', sheetLabel: 'Sheet a1', drawingName: 'a1.pdf', pageIndex: 1 })
    expect(s!.shapes[0]!.style.fill).toBe(COLOURS.complete)
    expect(s!.shapes[1]!.style).toEqual(tenantShapeStyle({ status: 'in_progress', overdue: true }))
    expect(s!.shapes[2]!.style).toEqual(areaShapeStyle('common'))
    // 200 × 100 px at 20 px/m = 10 m × 5 m = 50 m²
    expect(s!.shapes[0]!.labelLines).toEqual(['L01', 'Done Ltd', '50.0 m²'])
    expect(s!.counts).toMatchObject({ complete: 1, in_progress: 1, overdue: 1, common: 1, unlinked: 1 })
    expect(s!.measured).toEqual({ totalM2: 100, unmeasured: 0 })
    expect(s!.source).toEqual({ kind: 'pdf', bytes: PDF, pageIndex: 1, key: filePath('a', 'a1') })
    expect(s!.warnings).toEqual([])
    expect(st.downloads).toEqual([[TENANT_PLAN_FILES, filePath('a', 'a1')]])
    expect(TENANT_PLAN_FILES).toBe('tenant-plan-files')
  })

  it('hatches line diagram blocks from the DB order of any node, without tenant facts', async () => {
    const { clients } = world({
      plans: [planRow('s', { purpose: 'distribution_schematic' })],
      sheets: [sheetRow('s1', 's')],
      shapes: [
        shapeRow('b1', 's', 's1', { shape: 'rect', node_id: 'mb' }),
        shapeRow('b2', 's', 's1', { shape: 'rect', node_id: 'n-done' }),
        shapeRow('b3', 's', 's1', { shape: 'rect', detected_tag: 'DB-77' }),
      ],
    })
    const { inputs } = await load(clients, { purposes: ['distribution_schematic'] })
    expect(inputs[0]!.shapes.map((x) => x.style)).toEqual([dbBlockStyle('ordered'), dbBlockStyle('no_order'), dbBlockStyle('unlinked')])
    expect(inputs[0]!.measured).toBeNull()
    expect(factsMock).not.toHaveBeenCalled()
  })

  it('one input per sheet, floor plan first, each sheet with only its own shapes', async () => {
    const { clients } = world({
      plans: [planRow('z', { purpose: 'distribution_schematic' }), planRow('y')],
      sheets: [sheetRow('y1', 'y', { sort_order: 1, page_index: 2, file_path: filePath('y', 'y0') }), sheetRow('y0', 'y'), sheetRow('z0', 'z')],
      shapes: [shapeRow('a', 'y', 'y0'), shapeRow('b', 'y', 'y1'), shapeRow('c', 'y', 'y1')],
    })
    const both = await load(clients, { purposes: ['tenant_layout', 'distribution_schematic'] })
    expect(both.inputs.map((i) => [i.sheetId, i.shapes.length, i.pageIndex])).toEqual([['y0', 1, 1], ['y1', 2, 2], ['z0', 0, 1]])
    const one = await load(clients)
    expect(one.inputs.map((i) => i.sheetId)).toEqual(['y0', 'y1'])
    expect(await load(clients, { purposes: [] })).toEqual({ inputs: [], omitted: [] })
  })

  it('planIds and sheetIds narrow (Export sheet, portal)', async () => {
    const { clients } = world({ plans: [planRow('a'), planRow('b')], sheets: [sheetRow('a1', 'a'), sheetRow('a2', 'a', { sort_order: 1 }), sheetRow('b1', 'b')] })
    expect((await load(clients, { planIds: ['a'] })).inputs.map((i) => i.sheetId)).toEqual(['a1', 'a2'])
    expect((await load(clients, { planIds: ['a'], sheetIds: ['a2'] })).inputs.map((i) => i.sheetId)).toEqual(['a2'])
  })

  it('a file shared by several sheets downloads once', async () => {
    const { clients, st } = world({ sheets: [sheetRow('a1', 'a'), sheetRow('a2', 'a', { sort_order: 1, page_index: 2, file_path: filePath('a', 'a1') })] })
    await load(clients)
    expect(st.downloads).toHaveLength(1)
  })

  it('a missing file is "not included" with a sentence, never storage text; the rest render', async () => {
    const { clients } = world({
      sheets: [sheetRow('a1', 'a'), sheetRow('a2', 'a', { sort_order: 1 })],
      files: { [filePath('a', 'a1')]: PDF },
    })
    const r = await load(clients)
    expect(r.inputs.map((i) => i.sheetId)).toEqual(['a1'])
    expect(r.omitted).toEqual([{ title: 'Plan a (Tenant floor plan, Sheet a2)', reason: 'the sheet file could not be read' }])
    expect(JSON.stringify(r.omitted)).not.toContain('Object not found')
  })

  it(`caps at ${MAX_PLAN_SHEETS_PER_REPORT} sheets and at the byte budget`, async () => {
    const sheets = Array.from({ length: MAX_PLAN_SHEETS_PER_REPORT + 2 }, (_, i) => sheetRow(`s${String(i).padStart(2, '0')}`, 'a', { sort_order: i }))
    const { clients } = world({ sheets })
    const r = await load(clients)
    expect(r.inputs).toHaveLength(MAX_PLAN_SHEETS_PER_REPORT)
    expect(r.omitted).toHaveLength(2)
    expect(r.omitted[0]!.reason).toMatch(/more than 20 sheets/)
    const small = await load(clients, { maxSourceBytes: 2 })
    expect(small.inputs).toHaveLength(0)
    expect(small.omitted.filter((o) => /size cap/.test(o.reason))).toHaveLength(MAX_PLAN_SHEETS_PER_REPORT)
  })

  it('per-file cap is 40 MiB and the total across the appendix is 40 MiB', () => {
    expect(MAX_STATUS_PLAN_SOURCE_BYTES).toBe(40 * 1024 * 1024)
    expect(MAX_STATUS_PLAN_TOTAL_BYTES).toBe(40 * 1024 * 1024)
  })

  it('sheets beyond the total budget become "size cap" lines', async () => {
    const four = new Uint8Array(4)
    const sheets = ['1', '2', '3'].map((n, i) => sheetRow(`s${n}`, 'a', { sort_order: i }))
    const { clients } = world({ sheets, files: Object.fromEntries(sheets.map((s) => [s.file_path, four])) })
    const r = await load(clients, { maxTotalBytes: 9 })
    expect(r.inputs.map((i) => i.sheetId)).toEqual(['s1', 's2'])
    expect(r.omitted).toEqual([{ title: 'Plan a (Tenant floor plan, Sheet s3)', reason: expect.stringMatching(/size cap/) }])
  })

  it('pages shapes past PostgREST max_rows', async () => {
    const shapes = Array.from({ length: 1500 }, (_, i) => shapeRow(`s${String(i).padStart(4, '0')}`, 'a', 'a1'))
    const { clients } = world({ shapes, maxRows: 1000 })
    expect((await load(clients)).inputs[0]!.shapes).toHaveLength(1500)
  })

  it('warns about an unscaled sheet and a replaced file', async () => {
    const { clients } = world({ sheets: [sheetRow('a1', 'a', { pixels_per_meter: null, calibration_points: null, calibration_metres: null, replaced_at: '2026-10-05T00:00:00Z', revision: 3 })] })
    expect((await load(clients)).inputs[0]!.warnings).toEqual([
      'This sheet\'s file was replaced (revision 3) since its shapes were checked; they may not line up.',
      'This sheet has no scale, so areas are not measured.',
    ])
  })

  it('a plan list read error throws (the caller turns it into one "not included" line)', async () => {
    const pg = fakeSupabase({
      tables: { 'projects.projects': [{ id: PROJ, organisation_id: ORG, opening_date: null }] },
      selectErrors: { 'tenants.status_plans': { message: 'boom' } },
    })
    await expect(loadStatusPlanRenderInputs({ db: pg.client, facts: pg.client, storage: storageFake({}).storage }, { projectId: PROJ, today: TODAY, purposes: ['tenant_layout'] }))
      .rejects.toThrow(/boom/)
  })

  it('an invisible project, or a plan with no sheets, yields nothing', async () => {
    const { clients } = world()
    expect(await load(clients, { projectId: 'other' })).toEqual({ inputs: [], omitted: [] })
    const empty = world({ sheets: [] })
    expect(await load(empty.clients)).toEqual({ inputs: [], omitted: [] })
  })
})
```

Run: `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-render-data.test.ts` → FAIL.

- [ ] **Step 2: Rewrite `plan-render-data.ts`**

```ts
/**
 * Tenant plans → render inputs for the PDF renderer (report appendix, Export sheet, portal).
 * ONE INPUT PER SHEET (spec 2026-10-12 §5).
 *
 * Reads:
 *   clients.db      — the CALLER's session client: project, plans, sheets, shapes and nodes under
 *                     RLS + site_scope (00245/00249 open SELECT to every project role).
 *   clients.facts   — order / scope facts (loadTenantShopFacts, loadProjectDbOrderStatus); the service
 *                     client, passed ONLY after the route's project gate, as the tenant report does.
 *   clients.storage — sheet bytes from the tenant-plan-files bucket (service client).
 *
 * What a shape looks like is decided by shape-view.ts, fed exactly the inputs load-plan-page.ts gives
 * the canvas (floor plans see tenant_db nodes only, line diagrams every live node; each sheet its own
 * scale), so the PDF and the screen cannot disagree. Rows go through toCanvasShape, which keeps an
 * outline that fails today's checks (invalidReason) instead of throwing.
 *
 * Never throws for one sheet: a missing, unreadable or over-budget file becomes a "not included" line
 * with a sentence. It throws only when the plan or sheet list (or the facts it needs) cannot be read;
 * the callers turn that into a single "not included" line too, never a 500.
 *
 * Colours are computed for `today` at render time: a saved report is a snapshot.
 */
import {
  SCHEMATIC_LEGEND, TENANT_LEGEND, TENANT_PLAN_BUCKET, statusPlanFromRow,
  type NodeOrderStatus, type ShopLink, type StatusPlan, type StatusPlanPurpose, type StatusPlanRow,
  type StatusPlanShapeRow, type StatusPlanSheetRow,
} from '@esite/shared/status-plans'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { readAll } from '@/lib/tender/read-all'
import { shopLinkFor } from './shop-link'
import { loadProjectDbOrderStatus } from './project-db-orders'
import { SHAPE_COLUMNS, toCanvasShape } from './canvas-shape'
import { SHEET_COLUMNS } from './sheet-row'
import { legendSummary, resolveShapeView, type ShapeViewContext } from './shape-view'
import { planTitle, type PlanSource, type RenderShape, type StatusPlanRenderInput } from './render-plan-page'
import type { CanvasShape, PlanNode } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export const TENANT_PLAN_FILES = TENANT_PLAN_BUCKET
export const MAX_PLAN_SHEETS_PER_REPORT = 20
/**
 * One sheet file, and Σ unique files for one appendix. Both sit under the `reports` bucket's 50 MiB
 * file_size_limit (00117): the finished PDF carries the sources (vector pages are copied, not
 * rasterised), so the handoff also re-checks the final bytes (pdf-handoff.ts). A sheet file may be up
 * to 50 MB in its own bucket; one over this cap is listed as "not included" with the reason.
 */
export const MAX_STATUS_PLAN_SOURCE_BYTES = 40 * 1024 * 1024
export const MAX_STATUS_PLAN_TOTAL_BYTES = 40 * 1024 * 1024

export interface StorageLike {
  from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }> }
}
export interface PlanRenderClients { db: unknown; facts: unknown; storage: StorageLike }
export interface LoadPlanRenderArgs {
  projectId: string
  /** yyyy-mm-dd (johannesburgDate): overdue is decided against it. */
  today: string
  purposes: readonly StatusPlanPurpose[]
  planIds?: readonly string[]
  sheetIds?: readonly string[]
  maxSheets?: number
  /** Per sheet file. */
  maxSourceBytes?: number
  /** Σ unique sheet files in this output. */
  maxTotalBytes?: number
}
export interface PlanOmission { title: string; reason: string }
export interface PlanRenderLoadResult {
  inputs: StatusPlanRenderInput[]
  omitted: PlanOmission[]
  /** The project's organisation, read as the caller — set whenever there was something to render. */
  organisationId?: string
}

const PLAN_COLUMNS = 'id, project_id, organisation_id, purpose, name, created_by, created_at, updated_at'
const PURPOSE_ORDER: Record<StatusPlanPurpose, number> = { tenant_layout: 0, distribution_schematic: 1 }

export interface SheetRef { plan: StatusPlan; row: StatusPlanSheetRow }

/** Floor plan sheets, then line diagram sheets; within a plan, strip order. */
export function orderSheets(refs: readonly SheetRef[]): SheetRef[] {
  return [...refs].sort((a, b) =>
    PURPOSE_ORDER[a.plan.purpose] - PURPOSE_ORDER[b.plan.purpose]
    || Number(a.row.sort_order) - Number(b.row.sort_order))
}

/** What pdf-lib can embed. The 00249 trigger only admits these three. */
export function sourceKindFor(path: string): 'pdf' | 'png' | 'jpg' | null {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.png$/i.test(path)) return 'png'
  if (/\.jpe?g$/i.test(path)) return 'jpg'
  return null
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export async function loadStatusPlanRenderInputs(clients: PlanRenderClients, args: LoadPlanRenderArgs): Promise<PlanRenderLoadResult> {
  const db = clients.db as any
  const maxSheets = args.maxSheets ?? MAX_PLAN_SHEETS_PER_REPORT
  const maxSingle = args.maxSourceBytes ?? MAX_STATUS_PLAN_SOURCE_BYTES
  const maxTotal = args.maxTotalBytes ?? MAX_STATUS_PLAN_TOTAL_BYTES
  const empty: PlanRenderLoadResult = { inputs: [], omitted: [] }
  if (args.purposes.length === 0) return empty

  const { data: project } = await db.schema('projects').from('projects')
    .select('id, organisation_id, opening_date').eq('id', args.projectId).maybeSingle()
  if (!project) return empty
  const orgId = project.organisation_id as string
  const openingDate = (project.opening_date as string | null | undefined) ?? null

  let planQ = db.schema('tenants').from('status_plans').select(PLAN_COLUMNS)
    .eq('project_id', args.projectId).in('purpose', [...args.purposes])
  if (args.planIds) planQ = planQ.in('id', [...args.planIds])
  const { data: planRows, error: planErr } = await planQ
  if (planErr) throw new Error(`tenant plans could not be read: ${planErr.message}`)
  const plans = ((planRows ?? []) as StatusPlanRow[]).map(statusPlanFromRow)
  if (plans.length === 0) return empty
  const planById = new Map(plans.map((p) => [p.id, p]))

  let sheetQ = db.schema('tenants').from('status_plan_sheets').select(SHEET_COLUMNS).in('status_plan_id', plans.map((p) => p.id))
  if (args.sheetIds) sheetQ = sheetQ.in('id', [...args.sheetIds])
  const { data: sheetRows, error: sheetErr } = await sheetQ
  if (sheetErr) throw new Error(`tenant plan sheets could not be read: ${sheetErr.message}`)
  const refs = orderSheets(((sheetRows ?? []) as StatusPlanSheetRow[])
    .filter((row) => planById.has(row.status_plan_id))
    .map((row) => ({ plan: planById.get(row.status_plan_id)!, row })))
  if (refs.length === 0) return empty

  const omitted: PlanOmission[] = []
  const kept = refs.slice(0, maxSheets)
  for (const r of refs.slice(maxSheets)) {
    omitted.push({ title: planTitle(r.plan.name, r.plan.purpose, r.row.label), reason: `more than ${maxSheets} sheets — export the rest from the plan page` })
  }

  const [shapesRes, nodesRes] = await Promise.all([
    readAll<StatusPlanShapeRow>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select(SHAPE_COLUMNS)
        .in('sheet_id', kept.map((r) => r.row.id)).order('created_at').order('id').range(from, to)),
    readAll<any>((from, to) =>
      db.schema('structure').from('nodes')
        .select('id, code, kind, shop_number, shop_name, name, shop_area_m2, status')
        .eq('project_id', args.projectId).is('deleted_at', null).order('id').range(from, to)),
  ])
  if ('error' in shapesRes) throw new Error(`tenant plan shapes could not be read: ${shapesRes.error}`)
  if ('error' in nodesRes) throw new Error(`project boards could not be read: ${nodesRes.error}`)

  const shapesBySheet = new Map<string, CanvasShape[]>()
  for (const r of shapesRes.data) {
    const list = shapesBySheet.get(r.sheet_id) ?? []
    list.push(toCanvasShape(r))
    shapesBySheet.set(r.sheet_id, list)
  }

  // The same node sets load-plan-page.ts hands the canvas.
  const allNodes: PlanNode[] = nodesRes.data.map((n) => ({
    id: n.id,
    code: n.code ?? '—',
    kind: n.kind,
    shopNumber: n.shop_number ?? null,
    shopName: n.shop_name ?? n.name ?? null,
    scheduledM2: num(n.shop_area_m2),
    decommissioned: n.status === 'decommissioned',
  }))
  const nodesFor: Record<StatusPlanPurpose, Map<string, PlanNode>> = {
    tenant_layout: new Map(allNodes.filter((n) => n.kind === 'tenant_db').map((n) => [n.id, n])),
    distribution_schematic: new Map(allNodes.map((n) => [n.id, n])),
  }

  let shopLinks: Record<string, ShopLink> = {}
  if (kept.some((r) => r.plan.purpose === 'tenant_layout')) {
    const facts = await loadTenantShopFacts(clients.facts, { projectId: args.projectId, orgId, openingDate })
    shopLinks = Object.fromEntries([...nodesFor.tenant_layout.keys()].map((id) => [id, shopLinkFor(facts, id)]))
  }
  let dbOrders: Record<string, NodeOrderStatus> = {}
  if (kept.some((r) => r.plan.purpose === 'distribution_schematic')) {
    dbOrders = await loadProjectDbOrderStatus(clients.facts, { projectId: args.projectId, orgId })
  }

  const files = new Map<string, { bytes: Uint8Array } | { error: string }>()
  let totalBytes = 0
  const inputs: StatusPlanRenderInput[] = []

  for (const { plan, row } of kept) {
    const title = planTitle(plan.name, plan.purpose, row.label)
    const kind = sourceKindFor(row.file_path)
    if (!kind) { omitted.push({ title, reason: 'the sheet is not a PDF, PNG or JPEG file' }); continue }

    let file = files.get(row.file_path)
    if (!file) {
      const { data, error } = await clients.storage.from(TENANT_PLAN_FILES).download(row.file_path)
      if (error || !data) {
        file = { error: 'the sheet file could not be read' }
      } else {
        const bytes = new Uint8Array(await data.arrayBuffer())
        if (bytes.byteLength > maxSingle) {
          const reason = 'the sheet file is over the size cap for a report — export this sheet from its page'
          omitted.push({ title, reason })
          files.set(row.file_path, { error: reason })
          continue
        }
        if (totalBytes + bytes.byteLength > maxTotal) {
          omitted.push({ title, reason: 'the size cap for one PDF was reached — export this sheet from its page' })
          continue // not cached: a smaller later file may still fit
        }
        totalBytes += bytes.byteLength
        file = { bytes }
      }
      files.set(row.file_path, file)
    }
    if ('error' in file) { omitted.push({ title, reason: file.error }); continue }

    // `key` = the storage path: sheets sharing a file embed it once per output PDF.
    const source: PlanSource = kind === 'pdf'
      ? { kind, bytes: file.bytes, pageIndex: Number(row.page_index), key: row.file_path }
      : { kind, bytes: file.bytes, key: row.file_path }
    const ppm = num(row.pixels_per_meter)
    const ctx: ShapeViewContext = {
      purpose: plan.purpose,
      nodesById: nodesFor[plan.purpose],
      shopLinks: plan.purpose === 'tenant_layout' ? shopLinks : {},
      dbOrders: plan.purpose === 'distribution_schematic' ? dbOrders : {},
      today: args.today,
      pixelsPerMeter: ppm,
    }
    const shapes = shapesBySheet.get(row.id) ?? []
    const views = shapes.map((s) => resolveShapeView(s, ctx))
    const summary = legendSummary(views, plan.purpose)
    const rendered: RenderShape[] = shapes.map((s, i) => ({
      points: s.points, style: views[i]!.style, labelLines: views[i]!.labelLines, invalid: views[i]!.invalid,
    }))

    const warnings: string[] = []
    if (row.replaced_at) {
      warnings.push(`This sheet's file was replaced (revision ${row.revision}) since its shapes were checked; they may not line up.`)
    }
    const invalid = views.filter((v) => v.invalid).length
    if (invalid) {
      warnings.push(`${invalid} shape${invalid === 1 ? ' needs' : 's need'} redrawing: outlined in red where readable, not coloured or counted.`)
    }
    if (plan.purpose === 'tenant_layout' && ppm == null) warnings.push('This sheet has no scale, so areas are not measured.')

    inputs.push({
      planId: plan.id, sheetId: row.id, planName: plan.name, sheetLabel: row.label, purpose: plan.purpose,
      drawingName: row.file_name, pageIndex: Number(row.page_index), generatedOn: args.today, source, shapes: rendered,
      legend: plan.purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND,
      counts: summary.counts,
      measured: plan.purpose === 'tenant_layout' && ppm != null ? { totalM2: summary.totalM2, unmeasured: summary.unmeasured } : null,
      warnings,
    })
  }
  return { inputs, omitted, organisationId: orgId }
}
```

- [ ] **Step 3: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/plan-render-data.test.ts
```

Expected: PASS (14). If `fakeSupabase` does not apply `.in('id', …)` together with `.in('status_plan_id', …)` on one query, check its filter loop handles two `in` filters (it stores a list of filters; it does).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/status-plans/plan-render-data.ts apps/web/src/lib/status-plans/plan-render-data.test.ts
git commit -m "feat(tenant-plans): render data is one input per sheet, read from tenant-plan-files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F3: Report appendix and dialog naming

**Files:**
- Modify: `apps/web/src/lib/status-plans/appendix.ts` (+ `appendix.test.ts`)
- Modify: `apps/web/src/lib/status-plans/report-appendix.ts` (+ `report-appendix.test.ts`)
- Modify: `apps/web/src/lib/reports/render-tenant-schedule.ts` (+ `render-tenant-schedule.render.test.ts`)
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx` (+ test)
- Modify: `apps/web/src/components/reports/SavedReportsPanel.tsx` (+ test, if it asserts the labels)

- [ ] **Step 1: Tests first (red)**

```bash
perl -pi -e "s/Appendix—Tenantstatusplans/Appendix—Tenantplans/g" apps/web/src/lib/status-plans/appendix.test.ts apps/web/src/lib/reports/render-tenant-schedule.render.test.ts
perl -pi -e "s/title: 'Tenant status plans', reason: 'the plans could not be loaded/title: 'Tenant plans', reason: 'the plans could not be loaded/" apps/web/src/lib/status-plans/report-appendix.test.ts
perl -pi -e "s#/tenant status plans/i#/tenant floor plan/i#" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"
git grep -n "status plans'\|plans not included'" -- apps/web/src/components/reports/SavedReportsPanel.test.tsx
```

For any hit of the last command, change `'status plans'` to `'plan sheets'` and `'plans not included'` to `'sheets not included'` in that test. Then:

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans/appendix.test.ts src/lib/status-plans/report-appendix.test.ts src/lib/reports/render-tenant-schedule.render.test.ts "src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"
```

Expected: FAIL on the renamed strings.

- [ ] **Step 2: `appendix.ts`**

1. Header comment: `"Appendix — Tenant status plans"` → `"Appendix — Tenant plans"`.
2. In `drawDivider`, replace the title text `'Appendix — Tenant status plans'` with `'Appendix — Tenant plans'`.
3. Replace the blurb with:

```ts
    T(`Each page is one sheet of the tenant floor plan or the line diagram, with its shops and boards coloured from the tenant schedule as it stood on ${generatedOn}. Colours are computed when the report is generated, so this report is a snapshot of that day.`),
```

4. Replace the `cols` array and the row cells with:

```ts
  const cols = [
    { title: '#', x: margin, w: 18 },
    { title: 'Plan', x: margin + 22, w: 140 },
    { title: 'Sheet', x: margin + 166, w: 170 },
    { title: 'File', x: margin + 340, w: 150 },
    { title: 'Page', x: margin + 494, w: 30 },
  ]
```

```ts
    const cells = [String(i + 1), p.planName, p.sheetLabel, p.drawingName, String(p.pageIndex)]
```

5. `…and ${layout.includedMore} more plans, on the pages that follow.` → `…and ${layout.includedMore} more sheets, on the pages that follow.`; `'No plan could be included.'` → `'No sheet could be included.'`.
6. In `appendStatusPlansToPdf`'s `catch`, replace `planTitle(input.planName, input.purpose, input.pageIndex)` with `planTitle(input.planName, input.purpose, input.sheetLabel)`.
7. Remove the now-unused `PURPOSE_LABEL` import if nothing else in the file uses it (`grep -n PURPOSE_LABEL apps/web/src/lib/status-plans/appendix.ts`).

- [ ] **Step 3: The other three files**

- `report-appendix.ts`: `{ title: 'Tenant status plans', reason: … }` → `{ title: 'Tenant plans', reason: … }`.
- `render-tenant-schedule.ts`: `planTitle(i.planName, i.purpose, i.pageIndex)` → `planTitle(i.planName, i.purpose, i.sheetLabel)`.
- `TenantScheduleReportButton.tsx`: the checkbox labels `Tenant status plans` → `Tenant floor plan` and `Distribution schematics` → `Line diagram`. The query parameters (`tenantPlans`, `schematicPlans`) and `appendix-options.ts` stay as they are, so saved links and both routes are unchanged.
- `SavedReportsPanel.tsx`: `statusPlans: 'status plans'` → `statusPlans: 'plan sheets'`, `statusPlansNotIncluded: 'plans not included'` → `statusPlansNotIncluded: 'sheets not included'` (the summary keys stay: saved report rows already carry them).

- [ ] **Step 4: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/status-plans src/lib/reports "src/app/(admin)/projects/[id]/tenant-schedule/_components" src/components/reports
```

Expected: PASS. An `appendix.test.ts` case that matched the old column header `Drawing` or `Kind` in the decoded divider text gets the new header (`Sheet` / `File`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/status-plans/appendix.ts apps/web/src/lib/status-plans/appendix.test.ts apps/web/src/lib/status-plans/report-appendix.ts apps/web/src/lib/status-plans/report-appendix.test.ts apps/web/src/lib/reports/render-tenant-schedule.ts apps/web/src/lib/reports/render-tenant-schedule.render.test.ts "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx" apps/web/src/components/reports
git commit -m "feat(tenant-plans): report appendix and dialog say Tenant floor plan / Line diagram, sheet by sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F4: Export sheet is per sheet

**Files:**
- Modify: `apps/web/src/lib/reports/pdf-handoff.ts` (+ test)
- Modify: `apps/web/src/app/api/projects/[id]/status-plans/[planId]/sheet/route.ts` (+ test)
- Modify: `_plans/ExportSheetButton.tsx` (+ test)

- [ ] **Step 1: Tests first (red)**

`pdf-handoff.test.ts`: replace

```ts
    expect(statusPlanSheetPath('o', 'p', 'pl')).toBe('o/p/status-plans/pl/sheet.pdf')
```

with

```ts
    expect(statusPlanSheetPath('o', 'p', 'pl', 'sh')).toBe('o/p/status-plans/pl/sh/sheet.pdf')
```

Route test (`sheet/route.test.ts`):

1. Add `const SHEET = '0b6f8a2e-3c1d-4e5f-9a7b-1c2d3e4f5a6b'` under `PLAN`.
2. `call` and `callWith` URLs gain `?sheet=${SHEET}`.
3. `const input = { planId: PLAN, sheetId: SHEET, planName: 'Main board 3.1 / Level 2', sheetLabel: 'Sheet 1 of 3', pageIndex: 1, generatedOn: '2026-10-09' }`.
4. In `renders this plan only…`: the `args` expectation becomes `toMatchObject({ projectId: PID, planIds: [PLAN], sheetIds: [SHEET], purposes: ['tenant_layout', 'distribution_schematic'], maxSheets: 1 })`; both path expectations become `` `org-1/${PID}/status-plans/${PLAN}/${SHEET}/sheet.pdf` ``; the download regex becomes `/^main-board-3-1-level-2-sheet-1-of-3-\d{4}-\d{2}-\d{2}\.pdf$/`.
5. Add:

```ts
  it('a missing or malformed ?sheet= → 404, nothing is read', async () => {
    for (const q of ['', '?sheet=nope']) {
      const res = await GET(new NextRequest(`http://localhost/api/projects/${PID}/status-plans/${PLAN}/sheet${q}`), { params: Promise.resolve({ id: PID, planId: PLAN }) })
      expect(res.status).toBe(404)
    }
    expect(m.load).not.toHaveBeenCalled()
  })
```

`ExportSheetButton.test.tsx`: render with `sheetId="sh1"` and expect the fetched URL to be `/api/projects/p1/status-plans/pl1/sheet?sheet=sh1` (adapt the existing `fetch` mock assertion; keep its project / plan ids).

Run the three test files → FAIL.

- [ ] **Step 2: `pdf-handoff.ts`**

```ts
export const statusPlanSheetPath = (orgId: string, projectId: string, planId: string, sheetId: string) => `${orgId}/${projectId}/status-plans/${planId}/${sheetId}/sheet.pdf`
```

- [ ] **Step 3: The route**

In `sheet/route.ts`:

1. Header comment: "one status plan as a PDF at the drawing's own size" → "one sheet of a tenant plan (?sheet=) as a PDF at its own size"; "at a per-plan path" → "at a per-sheet path".
2. Change the handler signature to read the request: `export async function GET(req: NextRequest, { params }: …)`.
3. After the `isPlanId(planId)` check add:

```ts
  const sheetId = req.nextUrl.searchParams.get('sheet') ?? ''
  if (!isPlanId(sheetId)) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
```

4. The load call becomes:

```ts
    load = await loadStatusPlanRenderInputs(
      { db: supabase, facts: service, storage: service.storage as unknown as StorageLike },
      { projectId: id, today, purposes: STATUS_PLAN_PURPOSES, planIds: [planId], sheetIds: [sheetId], maxSheets: 1, maxSourceBytes: MAX_STATUS_PLAN_SOURCE_BYTES },
    )
```

5. The not-found message `'Status plan not found'` (second occurrence, after load) → `'Sheet not found'`.
6. The handoff call:

```ts
  return pdfHandoffResponse(service.storage as unknown as HandoffStorage, statusPlanSheetPath(load.organisationId, id, input.planId, input.sheetId), bytes, {
    download: `${slug(input.planName)}-${slug(input.sheetLabel)}-${today}.pdf`,
    logTag: 'status-plans/sheet',
  })
```

and `slug`'s fallback `'status-plan'` → `'sheet'`.

- [ ] **Step 4: The button**

In `_plans/ExportSheetButton.tsx`: props become `{ projectId, planId, sheetId }: { projectId: string; planId: string; sheetId: string }`; the fetch becomes

```ts
      const res = await fetch(`/api/projects/${projectId}/status-plans/${planId}/sheet?sheet=${encodeURIComponent(sheetId)}`)
```

and the fallback file name `'status-plan.pdf'` → `'line-diagram-sheet.pdf'`. Update its header comment: "the plan as a PDF at the drawing's own size" → "the sheet on screen as a PDF at its own size".

- [ ] **Step 5: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run src/lib/reports/pdf-handoff.test.ts "src/app/api/projects/[id]/status-plans" "src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.test.tsx"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/reports/pdf-handoff.ts apps/web/src/lib/reports/pdf-handoff.test.ts "apps/web/src/app/api/projects/[id]/status-plans" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.tsx" "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_plans/ExportSheetButton.test.tsx"
git commit -m "feat(tenant-plans): Export sheet exports the line-diagram sheet on screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F5: Portal "Tenant plans"

**Files:**
- Modify: `apps/web/src/lib/portal/data.ts`
- Create: `apps/web/src/app/(portal)/portal/[projectId]/tenant-plans/page.tsx` (+ `page.test.tsx`)
- Modify (rewrite): `apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.tsx` (redirect); delete its `page.test.tsx`
- Modify: `apps/web/src/components/portal/PortalProjectNav.tsx` (+ test)
- Modify: `apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.ts` (+ test)

- [ ] **Step 1: Tests first (red)**

Delete the old page test and write the new one:

```bash
git rm "apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.test.tsx"
mkdir -p "apps/web/src/app/(portal)/portal/[projectId]/tenant-plans"
```

`apps/web/src/app/(portal)/portal/[projectId]/tenant-plans/page.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const list = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }))
vi.mock('@/lib/portal/data', () => ({ listPortalTenantPlans: list }))
vi.mock('next/navigation', () => ({ redirect }))

import PortalTenantPlansPage from './page'
import OldPortalStatusPlans from '../status-plans/page'

describe('portal tenant plans', () => {
  it('lists the floor plan and the line diagram, each opening as one PDF', async () => {
    list.mockResolvedValue([
      { id: 'fp', name: 'Floor plan', purpose: 'tenant_layout', updated_at: '2026-10-12T00:00:00Z', sheets: 3 },
      { id: 'ld', name: 'Line diagram', purpose: 'distribution_schematic', updated_at: '2026-10-12T00:00:00Z', sheets: 1 },
    ])
    render(await PortalTenantPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(list).toHaveBeenCalledWith('p1')
    expect(screen.getByText('Tenant floor plan')).toBeTruthy()
    expect(screen.getByText('Line diagram')).toBeTruthy()
    expect(screen.getByText('3 sheets')).toBeTruthy()
    const link = screen.getByRole('link', { name: /open tenant floor plan/i })
    expect(link.getAttribute('href')).toBe('/api/portal/p1/status-plans/fp/pdf')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('empty state', async () => {
    list.mockResolvedValue([])
    render(await PortalTenantPlansPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(screen.getByText(/no tenant plans on this site yet/i)).toBeTruthy()
  })

  it('the old portal address redirects here', async () => {
    await expect(OldPortalStatusPlans({ params: Promise.resolve({ projectId: 'p1' }) })).rejects.toThrow('NEXT_REDIRECT /portal/p1/tenant-plans')
  })
})
```

In `PortalProjectNav.test.tsx` change `'Status Plans',` to `'Tenant plans',`.

Portal PDF route test (`pdf/route.test.ts`): replace the `render-plan-page` mock's `renderStatusPlanPdf: m.render` with `renderStatusPlanSheetsPdf: m.render`; make `input` `{ planName: 'Floor plan', sheetLabel: 'Sheet 1', pageIndex: 1 }`; expect `m.load` to be called with args matching `{ planIds: [PLAN], maxSheets: 20 }` and `m.render` with `([input], 'a3')`. Keep the handoff-path assertions (`org-1/p1/status-plans/${PLAN}/portal.pdf`).

Run them → FAIL.

- [ ] **Step 2: `data.ts`**

Replace `listPortalStatusPlans` with:

```ts
/**
 * Tenant plans (spec 2026-10-12 §2) — read via the USER client: 00245/00249 SELECT admits
 * client_viewer. A plan with no sheet yet is left out ("where they exist").
 */
export async function listPortalTenantPlans(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('tenants')
    .from('status_plans')
    .select('id, name, purpose, updated_at, status_plan_sheets(id)')
    .eq('project_id', projectId)
  const rows = (data ?? []) as Array<{
    id: string; name: string; purpose: 'tenant_layout' | 'distribution_schematic'; updated_at: string
    status_plan_sheets: Array<{ id: string }> | null
  }>
  return rows
    .map((r) => ({ id: r.id, name: r.name, purpose: r.purpose, updated_at: r.updated_at, sheets: (r.status_plan_sheets ?? []).length }))
    .filter((r) => r.sheets > 0)
    .sort((a, b) => (a.purpose === b.purpose ? 0 : a.purpose === 'tenant_layout' ? -1 : 1))
}
```

- [ ] **Step 3: The portal pages**

`apps/web/src/app/(portal)/portal/[projectId]/tenant-plans/page.tsx`:

```tsx
import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import { listPortalTenantPlans } from '@/lib/portal/data'
import { PortalCard, EmptyState, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/**
 * Tenant plans — the tenant floor plan and the line diagram, read-only; each opens as one PDF with
 * every sheet, coloured for today. The (portal) layout's requirePortalAccess gate runs before this
 * page. The PDF opens in a new tab, not an <iframe>: every same-origin response carries
 * X-Frame-Options: DENY.
 */
export default async function PortalTenantPlansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const plans = await listPortalTenantPlans(projectId)

  return (
    <PortalCard>
      {plans.length === 0 ? (
        <EmptyState label="No tenant plans on this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Sheets</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>{PURPOSE_LABEL[p.purpose]}</td>
                  <td style={tdStyle}>{p.sheets} sheet{p.sheets === 1 ? '' : 's'}</td>
                  <td style={tdStyle}>{fmtDate(p.updated_at)}</td>
                  <td style={tdStyle}>
                    <a href={`/api/portal/${projectId}/status-plans/${p.id}/pdf`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${PURPOSE_LABEL[p.purpose]}`}>
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

Replace `apps/web/src/app/(portal)/portal/[projectId]/status-plans/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** The portal tab is "Tenant plans" now (spec 2026-10-12 §2). 307 for old links. */
export default async function OldPortalStatusPlans({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/portal/${encodeURIComponent(projectId)}/tenant-plans`)
}
```

In `PortalProjectNav.tsx`: `{ slug: 'status-plans',      label: 'Status Plans' },` → `{ slug: 'tenant-plans',      label: 'Tenant plans' },`.

- [ ] **Step 4: The portal PDF has every sheet**

In `apps/web/src/app/api/portal/[projectId]/status-plans/[planId]/pdf/route.ts`:

1. Header: "one status plan as an A3 PDF" → "one tenant plan as an A3 PDF, one page per sheet".
2. Imports: `loadStatusPlanRenderInputs, MAX_PLAN_SHEETS_PER_REPORT, type PlanRenderLoadResult, type StorageLike` from `plan-render-data`; `renderStatusPlanSheetsPdf, StatusPlanSourceError` from `render-plan-page`.
3. The load args: `{ projectId, today: johannesburgDate(new Date()), purposes: STATUS_PLAN_PURPOSES, planIds: [planId], maxSheets: MAX_PLAN_SHEETS_PER_REPORT }`.
4. Replace `const input = load.inputs[0]` / `if (!input || !load.organisationId)` with:

```ts
  if (load.inputs.length === 0 || !load.organisationId) {
    const reason = load.omitted[0]?.reason
    return reason
      ? NextResponse.json({ error: `This plan cannot be shown: ${reason}.` }, { status: 422 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (load.omitted.length > 0) console.warn('[portal/status-plans] sheets left out', load.omitted.length)
```

5. Render: `bytes = await renderStatusPlanSheetsPdf(load.inputs, 'a3')`.

The `MAX_PLAN_SHEETS_PER_REPORT` import also requires exporting it from the mocked module in the route test: the test mocks `plan-render-data` wholesale (`vi.mock('@/lib/status-plans/plan-render-data', () => ({ loadStatusPlanRenderInputs: m.load }))`), so add `MAX_PLAN_SHEETS_PER_REPORT: 20` to that mock object.

- [ ] **Step 5: Run**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web exec vitest run "src/app/(portal)" src/components/portal "src/app/api/portal"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A "apps/web/src/app/(portal)/portal/[projectId]/status-plans" "apps/web/src/app/(portal)/portal/[projectId]/tenant-plans" apps/web/src/lib/portal/data.ts apps/web/src/components/portal "apps/web/src/app/api/portal/[projectId]/status-plans"
git commit -m "feat(tenant-plans): portal Tenant plans tab; each plan opens as one PDF of every sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F6: RBAC matrix

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Page routes** — replace the two `status-plans` rows (lines ~74–75) with:

```markdown
| `/projects/[id]/tenant-schedule/floor-plan` · `/projects/[id]/tenant-schedule/line-diagram` (tenant plans: sheet strip `?sheet=`, canvas, side panel, legend; `?shape=` selects a shape — the tenant schedule's "On plan ↗" link. Added 2026-10-12, migration `00249`). Read through the caller's session (RLS + `site_scope`). Upload, Add sheets, Replace file, Rename, Delete sheet, Shapes checked (re-anchor), Set scale, draw / link / delete shapes need `ORG_WRITE_ROLES` (`requireEffectiveRole(…).ok`); every other project role gets the same page read-only. The tenant schedule's "Tenant plans" cards show Upload / Upload / Replace to writers and Open to everyone once something is loaded | W | W | W | R | R | R | → `/portal` |
| `/projects/[id]/status-plans` · `/projects/[id]/status-plans/[planId]` (retired 2026-10-12: 307 to `/projects/[id]/tenant-schedule`) | → | → | → | → | → | → | → `/portal` |
```

- [ ] **Step 2: Client portal** — replace the two portal rows (lines ~343–344) with:

```markdown
| `/portal/[projectId]/tenant-plans` (the floor plan and the line diagram, where they have sheets; each opens as one A3 PDF of every sheet in a new tab) | R²¹ | → `/dashboard` |
| `/portal/[projectId]/status-plans` (retired 2026-10-12: 307 to `tenant-plans`) | → | → `/dashboard` |
| `GET /api/portal/[projectId]/status-plans/[planId]/pdf` (every sheet of the plan) | R²¹ | 404 (`requirePortalAccess`) |
```

- [ ] **Step 3: API routes** — replace the Export sheet row (line ~420) with:

```markdown
| `GET /api/projects/[id]/status-plans/[planId]/sheet?sheet=` (Export sheet — one sheet at its own size; `?sheet=` required, uuid, else 404) | R²¹ | R²¹ | R²¹ | R²¹ | R²¹ | R²¹ | R²¹ |
```

In footnote ²¹: replace "**Status plans in PDF (slice 4, 2026-10-09).**" with "**Tenant plans in PDF (slice 4, 2026-10-09; per sheet since 2026-10-12).**"; in the **Export sheet** bullet replace "The button renders on distribution schematics only (spec §8); the route serves tenant layouts too." with "The button renders on the line diagram only; the route serves floor plan sheets too."; in the **Reads** bullet replace "Plan, shape, drawing, page-scale and node rows go through the caller's session (`00245` SELECT…). Order and scope facts and the drawing bytes in the `drawings` bucket use the service client, only after the gate." with "Plan, sheet, shape and node rows go through the caller's session (`00245`/`00249` SELECT, which admits every project role including client_viewer). Order and scope facts and the sheet bytes in the `tenant-plan-files` bucket use the service client, only after the gate."; in the **Delivery** bullet replace `{org}/{project}/status-plans/{plan}/sheet.pdf` with `{org}/{project}/status-plans/{plan}/{sheet}/sheet.pdf`.

- [ ] **Step 4: Server actions** — replace the `### Status plans (status-plan.actions.ts, …)` section's heading, table and note with:

```markdown
### Tenant plans (`status-plan.actions.ts`, `status-plan-detection.actions.ts`, `tenant-plan-sheets.actions.ts`; migrations `00245`, `00249`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `prepareTenantPlanUploadAction` (creates the plan on first upload; signed upload URLs under the plan's folder) | W | W | W | — | — | — | — |
| `registerTenantPlanSheetsAction` (reads the uploaded objects back, counts PDF pages, inserts N sheets) | W | W | W | — | — | — | — |
| `prepareTenantPlanSheetReplaceAction` · `replaceTenantPlanSheetAction` | W | W | W | — | — | — | — |
| `reanchorTenantPlanSheetAction` · `renameTenantPlanSheetAction` · `calibrateTenantPlanSheetAction` | W | W | W | — | — | — | — |
| `deleteTenantPlanSheetAction` (cascades the sheet's shapes; removes its file once no sheet uses it) | W | W | W | — | — | — | — |
| `createStatusPlanShapeAction` (on a sheet) · `updateStatusPlanShapeAction` · `deleteStatusPlanShapeAction` | W | W | W | — | — | — | — |
| `acceptDetectedBlocksAction` (line diagram sheets only; one all-or-nothing insert) | W | W | W | — | — | — | — |

> **Changed 2026-10-12 (tenant plans, `00249`).** Plans are one per project per purpose and are created by the first upload; the plan-level create / rename / delete / re-anchor actions were removed. Every action gates on `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` and reads `.ok`, resolving the project from the plan, sheet or shape on the server; the RESTRICTIVE per-verb policies of `00245`/`00249` and the bucket's INSERT / DELETE policies are the database backstop. Actions return `{ ok, error }` and never throw for a refusal; Postgres codes become sentences (`lib/status-plans/write-errors.ts`). Sheet and shape edits are **conditional on the row's `updated_at`** in the same statement; zero rows back is reported as "changed by someone else" (or deleted) with a Reload control. Upload paths are built by the server (`{org}/{project}/{plan}/{folder}/{revision}.{ext}`) and registration refuses any other path; page counts come from the uploaded bytes (pdf-lib), never from the client. Signed upload URLs are minted with the caller's session, so the bucket's INSERT policy is checked as that person. `organisation_id`, `created_by`, `revision`, `replaced_at` and `replaced_from_path` are never sent: the triggers derive them. Shape actions do not revalidate the canvas page; upload, replace and delete navigate to the sheet (a fresh signed URL is wanted then).
```

- [ ] **Step 5: Database section** — replace the `### Status plans (tenants.status_plans, tenants.status_plan_shapes, migration 00245)` section with:

```markdown
### Tenant plans (`tenants.status_plans`, `tenants.status_plan_sheets`, `tenants.status_plan_shapes`, bucket `tenant-plan-files`; migrations `00245`, `00249`)

| Surface | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| Read a plan, its sheets and its shapes (RLS `status_plans_select` / `status_plan_sheets_select` / `status_plan_shapes_select`) | R | R | R | R | R | R | R |
| Read a sheet file (`tenant_plan_files_read`: project access on the path's project) | R | R | R | R | R | R | R |
| Create a plan (one per purpose), add / replace / re-anchor / rename / scale / delete a sheet (RLS) | W | W | W | — | — | — | — |
| Upload or delete a sheet file (`tenant_plan_files_insert` / `_delete`: write role on the path's project; no UPDATE policy) | W | W | W | — | — | — | — |
| Draw, move, link, unlink or delete a shape (RLS) | W | W | W | — | — | — | — |

> **Changed 2026-10-12 (`00249`).** A plan no longer anchors to a drawing: `floor_plan_id`, `page_index` and `source_file_path` are dropped, `organisation_id` is bound from the project, and `(project_id, purpose)` is unique. A sheet is one page of one file in the private `tenant-plan-files` bucket (50 MB, PDF / PNG / JPEG); its file must live under its own plan's folder (`{org}/{project}/{plan}/…`, enforced by trigger, so the service-side renderers can never be pointed at another project's object). Replacing the file is an UPDATE of `file_path`; the trigger sets `revision + 1`, `replaced_at` and `replaced_from_path` (client values discarded) and keeps the masks and the scale; re-anchoring clears `replaced_at` only. A shape's sheet must belong to its plan and is fixed; `(status_plan_id, node_id)` stays unique, so a board appears once per plan across sheets. `tenants.tenant_plan_file_project(name)` (definer, `anon` revoked) returns the project only when the path's org / project / plan segments name a real plan. Read = every project member, **client_viewer included**; write = `ORG_WRITE_ROLES` through PERMISSIVE membership + **RESTRICTIVE per-verb** gates; the generated `site_scope` policy on all three tables and `site_scope_objects` now covering `tenant-plan-files`. Proven by `scripts/db/assert-status-plans-roles.sql` (77 impersonation assertions, red first, seven mutations). Cloud sync's `isAnnotated()` no longer reads status plans (nothing there references a drawing).
```

- [ ] **Step 6: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): tenant plans routes, actions, tables and bucket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task F7: Verification

**Files:** none committed (mutations live in `$TMPDIR` only).

- [ ] **Step 1: Re-check the migration number (the claim is made now)**

Run each as its own command, never in the same command as a merge:

```bash
git fetch origin main
ls apps/edge-functions/supabase/migrations | tail -4
git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -4
gh pr list --state open --json number,files --jq '.[] | {n: .number, m: [.files[].path | select(test("supabase/migrations/"))]} | select(.m | length > 0)'
source scripts/db/mgmt-api.sh && mgmt_query "SELECT max(version) AS head FROM supabase_migrations.schema_migrations"
```

Expected: highest on `origin/main` is `00247_…`, ledger head ≤ `00247`, no open PR claims `00249`. If `00249` (or higher) is taken anywhere: `git mv` the file to the next free number, change its header line `-- Migration 00249:` and the two `00249` mentions in `docs/rbac-matrix.md`, re-run Step 2 for the db and web suites (tests find the file by pattern), commit, and use the new path below. If the ledger head is BELOW `00247` (00246/00247 not applied yet), that is fine: they apply first on merge, in number order.

- [ ] **Step 2: Three suites**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db test
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web test
```

Expected: all PASS (db's live-database suites skip without credentials). Any FAIL stops here.

- [ ] **Step 3: Types, lint, build**

```bash
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/db type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web type-check
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared lint
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web lint
TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web build
```

Expected: all exit 0. `next build` is the only check that catches a non-async export from a `'use server'` file (`tenant-plan-sheets.actions.ts` exports only async functions; `patchSheet` and the helpers are not exported). The build output lists `/projects/[id]/tenant-schedule/floor-plan` and `/line-diagram` as dynamic routes.

- [ ] **Step 4: RED, then GREEN — the assertions against production (rolled back)**

```bash
M=apps/edge-functions/supabase/migrations/00249_tenant_plans.sql
A=scripts/db/assert-status-plans-roles.sql
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql "$A"
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh "$M" "$A"
```

Expected: the first run is `✗ assert-status-plans-roles.sql aborted` (the seed names `status_plan_sheets` / a plan without `floor_plan_id`), exit 1. The second prints 91 `✓` lines and `✓ 91 assertion(s) green across 1 file(s) — transactions rolled back, nothing persisted`. A red `FIXTURE:` row means the fixture is wrong (e.g. no contractor on a project without status plans), not the migration.

- [ ] **Step 5: Mutations — every arm must be able to fail**

Before each run, `diff "$M" "$D/mutN.sql"` must show the intended change (a sed that matched nothing makes the mutation vacuous):

```bash
D="/Volumes/Extreme SSD/tmp"

# M1: sheet + file write gates admit contractor → contractor_sheet_insert_refused, contractor_sheet_update/delete_affects_nothing,
#     contractor_file_upload_refused, contractor_file_delete_affects_nothing go red (shape/plan gates live in 00245, unaffected)
sed "s/'project_manager')/'project_manager', 'contractor')/g" "$M" > "$D/mut1.sql"; diff "$M" "$D/mut1.sql" | head; TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut1.sql" "$A"

# M2: organisation no longer bound (plan and sheet) → pm_plan_org_bound_from_project, pm_sheet_org_bound_from_plan go red
sed "s/NEW.organisation_id := v_org;/NULL;/" "$M" > "$D/mut2.sql"; diff "$M" "$D/mut2.sql" | head; TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut2.sql" "$A"

# M3: the sheet's folder check removed → pm_sheet_path_of_another_plan_refused, pm_sheet_path_of_another_project_refused go red
sed "s/IF NEW.file_path !~ ('^' || v_prefix/IF false AND NEW.file_path !~ ('^' || v_prefix/" "$M" > "$D/mut3.sql"; diff "$M" "$D/mut3.sql" | head; TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut3.sql" "$A"

# M4: sheet-in-plan check removed → pm_shape_sheet_of_another_plan_refused goes red
sed "s/IF v_sheet_plan IS DISTINCT FROM NEW.status_plan_id THEN/IF false THEN/" "$M" > "$D/mut4.sql"; diff "$M" "$D/mut4.sql" | head; TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut4.sql" "$A"

# M5: revision taken from the client → pm_sheet_replace_bumps_revision goes red
sed "s/NEW.revision := OLD.revision + 1;/NULL;/" "$M" > "$D/mut5.sql"; diff "$M" "$D/mut5.sql" | head; TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut5.sql" "$A"

# M6: one plan per purpose removed → pm_plan_one_per_purpose goes red
sed "/ADD CONSTRAINT status_plans_project_purpose_key UNIQUE (project_id, purpose);/d" "$M" > "$D/mut6.sql"; diff "$M" "$D/mut6.sql" | head; TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut6.sql" "$A"

# M7: file reads opened AND the bucket dropped from site_scope_objects (each layer alone stops the lapsed PM,
#     so both are removed together) → lapsed_sees_no_file goes red
sed -e "s/AND COALESCE(public.user_has_project_access(tenants.tenant_plan_file_project(name)), false));/);/" \
    -e "s/, 'tenant-plan-files') THEN public.storage_site_access/) THEN public.storage_site_access/g" "$M" > "$D/mut7.sql"
diff "$M" "$D/mut7.sql" | head; TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut7.sql" "$A"
```

Expected per run: exit 1, and only the named assertions (plus any that logically depend on them) are `✗`. Record the seven red sets in the PR body. M7's `@verify` directive about `site_scope_objects` would also be red; the assertions file is what this step reads.

- [ ] **Step 6: Site-scope coverage (red, then green)**

```bash
awk '/^DROP POLICY IF EXISTS site_scope ON tenants.status_plan_sheets;/{skip=4} skip>0{skip--; next} {print}' "$M" > "$D/mut-noscope.sql"
grep -c 'site_scope ON tenants.status_plan_sheets' "$D/mut-noscope.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$D/mut-noscope.sql" scripts/db/assert-site-scope-coverage.sql
TMPDIR="$D" scripts/db/dry-run-migration.sh "$M" scripts/db/assert-site-scope-coverage.sql
```

Expected: `grep -c` prints `0`; the red run shows `✗ site_scope present: tenants.status_plan_sheets` and nothing else red; the green run is all `✓` (including `storage site_scope_objects present`).

- [ ] **Step 7: Sweep every earlier `@verify` directive under the new state — and prove the 00245 edit**

```bash
node --experimental-strip-types scripts/db/emit-verify-sweep.ts "$D/verify-sweep.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$M" "$D/verify-sweep.sql"
```

Expected: every line `✓`, including all of `00245_status_plans.sql #…` (the edited block) and `00249_tenant_plans.sql #…` (proof that 00249's own block parses and holds before it is ever applied).

Now prove the edit was needed (rule 2): sweep 00245's ORIGINAL block under the new state.

```bash
git show origin/main:apps/edge-functions/supabase/migrations/00245_status_plans.sql > "$D/00245-original.sql"
cat > "$D/sweep-one.mts" <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildVerifySweepSql } from '/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans/packages/shared/src/lib/migrations/verify-header.ts'
const [out, file] = process.argv.slice(2)
writeFileSync(out!, buildVerifySweepSql([{ file: '00245_status_plans.sql', sql: readFileSync(file!, 'utf8') }]))
EOF
node --experimental-strip-types "$D/sweep-one.mts" "$D/sweep-00245-original.sql" "$D/00245-original.sql"
TMPDIR="$D" scripts/db/dry-run-migration.sh "$M" "$D/sweep-00245-original.sql"
```

Expected: exit 1 with exactly four `✗` — the two `column:` directives (`page_index`, `source_file_path`) and the two `constraint:` directives (`status_plans_page_positive`, `status_plans_drawing_page_purpose_key`). That is the deploy that would have gone red without Task B2 Step 5. (The helper lives in `$TMPDIR`, never in the repo; it imports `verify-header.ts` by absolute path, exactly as `scripts/db/emit-verify-sweep.ts` does by relative path.)

If the full sweep aborts instead of reporting, regenerate it with a later `since` (`00230`, then `00238`) to find the migration whose directive raised; a `✗` in an earlier block means it counts something 00249 changed — fix it forward in this branch by editing that block, and re-run this step.

- [ ] **Step 8: Contract checks that need nothing but the repo**

```bash
TMPDIR="$D" pnpm --filter @esite/db exec vitest run src/__tests__/security
TMPDIR="$D" pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts src/lib/auth src/lib/status-plans/page-props.contract.test.ts
```

Expected: PASS (annotated predicate without `status_plans`, the exemption proven true, site-scope text byte for byte, every function in `00249` declared, role gates read `.ok`, page props JSON only).

- [ ] **Step 9: Stop here**

The branch is green on the three suites, types, lint and `next build`; the migration has been dry-run against production red first and green after, with seven mutations and the coverage check each going red as designed, and the full `@verify` sweep green (plus proof that 00245's original block would have turned the deploy red). Do not deploy, apply or merge as part of this plan. Push the branch and open the PR (ready, not draft); the PR body carries the mutation red sets and links the runbook below.

---

## Deploy runbook (owner / release session only — NOT executed by implementers)

Order matters: **function first, migration second.** The live `cloud-sync-project` filters `tenants.status_plans` by `floor_plan_id`; once 00249 drops that column the query errors, `isAnnotated()` treats the error as "annotated", and auto-adopt silently stops for every drawing in production.

**R1. Round-trip and what it buys.** One edge-function deploy (≈1 min) and one merge that runs `Deploy DB Migrations` (≈3–5 min). Together they make the tenant plan routes usable; verification below takes ≈10 min more. Production holds 0 status plans, so no one loses work between R2 and R4.

**R2. Deploy `cloud-sync-project` from the branch, before merging.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/worktrees/status-plans"
git checkout feat/tenant-plans && git pull --ff-only
export SUPABASE_ACCESS_TOKEN="$(security find-generic-password -s 'Supabase CLI' -w | sed 's/^go-keyring-base64://' | base64 -d)"
apps/edge-functions/deploy.sh cloud-sync-project
```

Then read the deployed artefact back, not the repo:

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/functions/cloud-sync-project | jq '{version, verify_jwt, updated_at}'
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/functions/cloud-sync-project/body -o /tmp/csp.eszip
strings /tmp/csp.eszip | grep -c "from('status_plans')"
strings /tmp/csp.eszip | grep -c "floor_plan_page_scales"
```

Expected: `version` one higher than before, `verify_jwt: true`; the `status_plans` count is `0` and the `floor_plan_page_scales` count is ≥ 1 (the bundle is real and still holds the other lookups). If the ESZIP is compressed and `strings` finds neither, extract it as in the memory note "Reading deployed edge-function source" before concluding anything. Wait for the next `cloud-sync-poll` tick (every 15 min) and check it ran clean:

```bash
source scripts/db/mgmt-api.sh && mgmt_query "SELECT status, count(*) FROM tenants.cloud_sync_runs WHERE started_at > now() - interval '20 minutes' GROUP BY status"
```

Expected: only `done` rows.

**R3. Re-check the migration number** exactly as Task F7 Step 1 (four separate commands). Renumber if taken; never in the same command as the merge.

**R4. Merge** with a merge commit (not squash), after CI is green on the PR:

```bash
gh pr merge <PR> --merge
```

Watch `Deploy DB Migrations` on the merge commit to the end (`gh run watch`). It applies 00246/00247 first if they are not yet applied, then 00249, then the post-push verifier re-checks every migration ≥ 00185. **A green run is not evidence the migration ran** — R5 reads it back.

**R5. Verify on production.**

```bash
source scripts/db/mgmt-api.sh
mgmt_query "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3"
mgmt_query "SELECT count(*) AS dropped_cols_left FROM information_schema.columns WHERE table_schema='tenants' AND table_name='status_plans' AND column_name IN ('floor_plan_id','page_index','source_file_path')"
mgmt_query "SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='tenant-plan-files'"
mgmt_query "SELECT strpos(qual, 'tenant-plan-files') > 0 AS covered FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='site_scope_objects'"
TMPDIR="/Volumes/Extreme SSD/tmp" scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-status-plans-roles.sql scripts/db/assert-site-scope-coverage.sql
```

Expected: `00249` in the ledger; `dropped_cols_left = 0`; the bucket private, `52428800`, three types; `covered = true`; 77 + coverage all `✓` against the LIVE state (noop migration, rolled back).

Then the web:

```bash
for p in tenant-schedule/floor-plan tenant-schedule/line-diagram status-plans; do curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://www.e-site.live/projects/00000000-0000-4000-8000-000000000000/$p"; done
```

Expected: each a redirect to `/login?next=…` for a signed-out visitor (the gate), never a 500. Confirm the Vercel production deployment is the merge commit (GitHub deployments API), not inferred from a 200.

**R6. Cloud sync after the migration.** Wait for the next `cloud-sync-poll` tick and repeat the R2 run query. Expected: only `done` rows, and the adopted / flagged counts in line with the previous day (no sudden "every drawing annotated").

**R7. Not verifiable by the agent: the signed-in walk.** Owner, on a throwaway project, from the empty state: Tenant schedule → Tenant plans → Floor plan **Upload** a 3-page PDF → three sheets in the strip → mask a shop on sheet 2 → Set scale → area shows → the schedule row's **On plan ↗** opens sheet 2 with the shape selected → **Replace file** with a new revision → amber banner → **Shapes checked** → banner gone; Line diagram **Upload** the 300 sheet → **Detect blocks** → accept → **Export sheet**; generate the tenant report with both appendix boxes ticked; open the portal **Tenant plans** tab as a client viewer. Delete the throwaway project afterwards.

---

## Spec ambiguities resolved in this plan

1. **Migration number.** The brief said "head 00245 → write 00246". `origin/main` already holds `00246_tender_cidb_not_applicable.sql` and `00247_tender_cidb_certificate_waiver.sql`, so the file is `00249_tenant_plans.sql`, with the usual re-check at apply time. Tests find it by `^\d{5}_tenant_plans\.sql$`.
2. **Storage path for a multi-page PDF.** The spec's `{org}/{project}/{plan_id}/{sheet_id}/{revision}.{ext}` has one file serving N sheets. The folder segment is the id of the FIRST sheet registered for that file (the server pre-allocates it and the sheet row is inserted with that id); the other pages' sheets share the path. A replacement always goes to the replaced sheet's own folder at `revision + 1`.
3. **Page count is counted server-side** (pdf-lib on the uploaded object, read back through the caller's session), not trusted from the browser. The registering pages carry `maxDuration = 60`.
4. **Replace and page choice.** Replace takes an explicit "Page in the new file" (default: the sheet's current page) and refuses a page the file does not have. `page_index`, `mime` and `file_name` can only change together with the file (trigger).
5. **Plan-level actions removed.** One plan per purpose, created lazily on the first upload, so create / rename / delete / re-anchor of a whole plan are gone; re-anchor is per sheet. `name` stays (default "Floor plan" / "Line diagram") but has no rename control.
6. **Labels.** Single-page files default to the file name; each page of a multi-page PDF to "Sheet n of N (file name)", so two multi-page files never share labels. Renamable.
7. **Storage RLS keyed on the path.** `tenant_plan_file_project(name)` is a definer function that returns the project only when org / project / plan segments name a real plan of that project and org; read = project access, insert / delete = write role, no UPDATE policy (a replacement is a new object). `site_scope_objects` is re-created from the generator with the bucket added (`SITE_BUCKETS` changed), not a second storage policy.
8. **Signed upload URLs use the caller's session**, not the service client, so the bucket's INSERT policy is the gate (no new entry in the service-client gate contract).
9. **Old routes** redirect to the tenant schedule itself (307, `redirect()`), not to a specific tool; the old portal tab redirects to `/portal/[projectId]/tenant-plans`. Internal API paths (`/api/…/status-plans/[planId]/…`) are kept; Export sheet now requires `?sheet=`.
10. **Caps.** "Same caps": 20 sheets per report appendix (was 20 plans), 40 MiB per file and in total for a PDF, although a sheet file may be up to 50 MB in its bucket; a larger one is listed "not included" with the reason. The portal PDF draws up to 20 sheets of one plan and skips a sheet it cannot draw.
11. **Legend.** "Per sheet and plan totals" = a second column (all sheets) when the plan has more than one sheet, plus an "All sheets" measured-GLA line on the floor plan.
12. **Full navigation after upload / replace / delete** (`window.location.assign` behind `navigateTo`), because `router.refresh()` has been seen not to commit on pages in this app and a fresh signed URL is needed then; shape edits, rename, re-anchor and scale fold into state.
13. **`isAnnotated()` exemption.** `tenants.status_plans` is still discovered by the contract test (00245's CREATE TABLE names `floor_plan_id`), so it is exempted with a reason, and a new case proves the exemption by finding the `DROP COLUMN floor_plan_id` in the corpus. `status_plan_sheets` never mentions `floor_plan`, so it is not discovered.

