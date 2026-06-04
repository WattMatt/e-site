# Snag Site Visits + PDF Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class dated **site visits** to the snag module — snags raised under a visit, carried forward across visits (new / still-open / closed-this-visit), and exportable as a branded PDF saved to `projects.reports`.

**Architecture:** New `field.snag_visits` table; `field.snags` gains `raised_on_visit_id` + `closed_on_visit_id` stamps; `field.snag_photos` gains `visit_id`. A pure `computeVisitBuckets` derives the three groups. Web UI is visits-primary. The report reuses the PR #38 react-pdf engine (`apps/web/src/lib/reports/`) and persists to `projects.reports` (`kind='snag'`). Web-first; mobile deferred.

**Tech Stack:** Postgres (Supabase, `field` schema), TypeScript, Zod, Next.js 15 App Router (React 19), `@react-pdf/renderer`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-snag-site-visits-export-design.md`

**Conventions:** `cd esite` already implied (repo root). Commands via `pnpm --filter <pkg>`. The `field` + `inspections` schemas aren't in generated types — cast `(supabase as any).schema('field')` / `as AnyClient`. Commit after each task. Migration is **00120** (00118/00119 are claimed by the open drawings PR #40).

---

## File structure

**DB**
- Create `apps/edge-functions/supabase/migrations/00120_snag_site_visits.sql`
- Create `scripts/db/smoke-test-snag-site-visits.sh`

**Shared (`packages/shared`)**
- Create `packages/shared/src/schemas/snag-visit.schema.ts` — Zod for visit + attendees.
- Create `packages/shared/src/services/snag-visit-buckets.ts` — pure `computeVisitBuckets` + types.
- Create `packages/shared/src/services/snag-visit-buckets.test.ts`
- Create `packages/shared/src/services/snag-visit.service.ts` — visit CRUD + queries.
- Modify the shared barrel (`packages/shared/src/index.ts`) to export the new schema/service/bucket helpers.

**Web actions**
- Create `apps/web/src/actions/snag-visit.actions.ts`
- Create `apps/web/src/actions/snag-visit.actions.test.ts`

**Web UI**
- Modify `apps/web/src/app/(admin)/projects/[id]/snags/page.tsx` — lens toggle + by-visit list.
- Create `apps/web/src/app/(admin)/projects/[id]/snags/_components/VisitList.tsx`
- Create `apps/web/src/app/(admin)/projects/[id]/snags/visits/[visitId]/page.tsx`
- Create `apps/web/src/app/(admin)/projects/[id]/snags/visits/[visitId]/VisitDetail.tsx` (+ small group/row components)
- Create `apps/web/src/app/(admin)/projects/[id]/snags/_components/VisitForm.tsx`
- Modify `apps/web/src/app/(admin)/snags/[id]/page.tsx` — show origin/closing visit.

**Report**
- Create `apps/web/src/lib/reports/snag-visit-report-data.ts` + `.test.ts`
- Create `apps/web/src/lib/reports/snag-visit-report.tsx`
- Create `apps/web/src/lib/reports/snag-visit-report.render.test.ts`
- Create `apps/web/src/app/api/projects/[id]/snags/visits/[visitId]/report/route.ts`

**Docs**
- Modify `docs/rbac-matrix.md`

---

## PHASE 1 — Database

### Task 1.1: Migration `00120_snag_site_visits.sql`

**Files:** Create `apps/edge-functions/supabase/migrations/00120_snag_site_visits.sql`

- [ ] **Step 1: Read the existing snag RLS to mirror it.** Open `apps/edge-functions/supabase/migrations/00012_invites_storage.sql` and `00032_payment_paused_write_block.sql`; find the `field.snags` SELECT/INSERT/UPDATE/DELETE policies. The new `snag_visits` policies must use the **same predicates** (org membership + contractor-and-above for writes; paused-payment block on writes), retargeted to `snag_visits`. Note the exact predicate functions used (e.g. `public.user_has_project_access(project_id)`, the role/membership check, the payment guard).

- [ ] **Step 2: Write the migration.** Create the file with this content (mirror the RLS write predicates you found in Step 1 where marked):

```sql
-- =============================================================================
-- Migration 00120 — snag site visits + carry-forward stamps (backlog #5)
-- =============================================================================
-- Additive, idempotent, paused-payment-aware. `field` is already PostgREST-
-- exposed (no schema create) → a trailing NOTIFY suffices, no config PATCH.
-- =============================================================================

-- 1. field.snag_visits ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS field.snag_visits (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id      UUID        NOT NULL REFERENCES projects.projects(id)    ON DELETE CASCADE,
    visit_no        INT         NOT NULL DEFAULT 0,
    is_backlog      BOOLEAN     NOT NULL DEFAULT false,
    visit_date      DATE        NOT NULL,
    conducted_by    UUID        NOT NULL REFERENCES public.profiles(id),
    attendees       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    title           TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_attendees_array;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_attendees_array CHECK (jsonb_typeof(attendees) = 'array');
ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_project_no_uniq;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_project_no_uniq UNIQUE (project_id, visit_no);
ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_project_id_uniq;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_project_id_uniq UNIQUE (project_id, id);

CREATE INDEX IF NOT EXISTS snag_visits_project_idx ON field.snag_visits (project_id, visit_no);

DROP TRIGGER IF EXISTS snag_visits_updated_at ON field.snag_visits;
CREATE TRIGGER snag_visits_updated_at BEFORE UPDATE ON field.snag_visits
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- per-project visit numbering (backlog stays 0; real visits 1,2,3…)
CREATE OR REPLACE FUNCTION field.snag_visits_ensure_no() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_backlog THEN
    NEW.visit_no := 0;
  ELSIF NEW.visit_no IS NULL OR NEW.visit_no = 0 THEN
    SELECT COALESCE(MAX(visit_no), 0) + 1 INTO NEW.visit_no
      FROM field.snag_visits WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS snag_visits_ensure_no_trg ON field.snag_visits;
CREATE TRIGGER snag_visits_ensure_no_trg BEFORE INSERT ON field.snag_visits
    FOR EACH ROW EXECUTE FUNCTION field.snag_visits_ensure_no();

-- 2. snag stamps ---------------------------------------------------------------
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS raised_on_visit_id UUID;
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS closed_on_visit_id UUID;

ALTER TABLE field.snags DROP CONSTRAINT IF EXISTS snags_raised_on_visit_fk;
ALTER TABLE field.snags ADD  CONSTRAINT snags_raised_on_visit_fk
    FOREIGN KEY (project_id, raised_on_visit_id)
    REFERENCES field.snag_visits(project_id, id) ON DELETE NO ACTION;
ALTER TABLE field.snags DROP CONSTRAINT IF EXISTS snags_closed_on_visit_fk;
ALTER TABLE field.snags ADD  CONSTRAINT snags_closed_on_visit_fk
    FOREIGN KEY (project_id, closed_on_visit_id)
    REFERENCES field.snag_visits(project_id, id) ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS snags_raised_on_visit_idx ON field.snags (raised_on_visit_id);
CREATE INDEX IF NOT EXISTS snags_closed_on_visit_idx ON field.snags (closed_on_visit_id);

-- 3. photo visit tag -----------------------------------------------------------
ALTER TABLE field.snag_photos ADD COLUMN IF NOT EXISTS visit_id UUID;
ALTER TABLE field.snag_photos DROP CONSTRAINT IF EXISTS snag_photos_visit_fk;
ALTER TABLE field.snag_photos ADD  CONSTRAINT snag_photos_visit_fk
    FOREIGN KEY (visit_id) REFERENCES field.snag_visits(id) ON DELETE SET NULL;

-- 4. backfill legacy snags into a per-project "Initial backlog" visit -----------
DO $$
DECLARE r RECORD; v_id UUID; v_raiser UUID;
BEGIN
  FOR r IN
    SELECT project_id, organisation_id, MIN(created_at)::date AS first_date
      FROM field.snags WHERE raised_on_visit_id IS NULL
      GROUP BY project_id, organisation_id
  LOOP
    SELECT raised_by INTO v_raiser FROM field.snags
      WHERE project_id = r.project_id AND raised_on_visit_id IS NULL
      ORDER BY created_at ASC LIMIT 1;
    INSERT INTO field.snag_visits (organisation_id, project_id, visit_no, is_backlog, visit_date, conducted_by, title)
      VALUES (r.organisation_id, r.project_id, 0, true, r.first_date, v_raiser, 'Initial backlog')
      RETURNING id INTO v_id;
    UPDATE field.snags SET raised_on_visit_id = v_id
      WHERE project_id = r.project_id AND raised_on_visit_id IS NULL;
  END LOOP;
END $$;

-- 5. RLS — mirror field.snags (retarget the predicates found in Step 1) --------
ALTER TABLE field.snag_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS snag_visits_select ON field.snag_visits;
CREATE POLICY snag_visits_select ON field.snag_visits
    FOR SELECT TO authenticated
    USING (public.user_has_project_access(project_id));

-- INSERT / UPDATE / DELETE: replicate the field.snags write predicates verbatim
-- (org membership + contractor-and-above + paused-payment block), retargeted.
-- <<< paste the mirrored policies here, named snag_visits_insert/update/delete >>>

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Apply to the live DB via the controller.** Run: `bash scripts/db/mgmt-api.sh` helpers — `mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00120_snag_site_visits.sql`. Expected: no `{"message": ...}` error. (Do NOT push to main yet — prod deploy is gated.)

- [ ] **Step 4: Record the ledger row** so `db push` / the deploy workflow no-ops: insert version `00120` into `supabase_migrations.schema_migrations` (via `mgmt_query`). Expected: 1 row.

- [ ] **Step 5: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00120_snag_site_visits.sql
git commit -m "feat(snags): #5 migration 00120 — snag_visits + carry-forward stamps + backfill"
```

### Task 1.2: Transactional smoke test

**Files:** Create `scripts/db/smoke-test-snag-site-visits.sh`

- [ ] **Step 1: Write the smoke test** (model on `scripts/db/smoke-test-anchor-sub-boards.sh` — same `mgmt_query` harness, one multi-statement transaction wrapped so trigger writes are visible to later statements, ROLLBACK at the end). Assert, inside a `BEGIN … ROLLBACK`:
  1. `field.snag_visits`, and the new columns on `snags`/`snag_photos`, exist.
  2. Insert a project + two `snag_visits` (non-backlog) → `visit_no` auto-sequences to 1 then 2.
  3. Insert a backlog visit → `visit_no = 0`; a second backlog on same project violates `snag_visits_project_no_uniq`.
  4. A snag with `raised_on_visit_id` pointing at **another project's** visit is rejected by `snags_raised_on_visit_fk` (composite same-project FK).
  5. Deleting a visit that has a snag raised on it is blocked (NO ACTION); deleting the **project** cascades both away.
  6. RLS is enabled on `snag_visits` and the three write policies + select policy exist.

- [ ] **Step 2: Run it.** Run: `bash scripts/db/smoke-test-snag-site-visits.sh`. Expected: all sections green, no residual rows (ROLLBACK).

- [ ] **Step 3: Commit.**

```bash
git add scripts/db/smoke-test-snag-site-visits.sh
git commit -m "test(snags): #5 transactional smoke test for 00120"
```

---

## PHASE 2 — Shared logic

### Task 2.1: Visit Zod schema

**Files:** Create `packages/shared/src/schemas/snag-visit.schema.ts`; modify the shared barrel.

- [ ] **Step 1: Write the schema.**

```ts
import { z } from 'zod'

export const visitAttendeeSchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional().default(''),
})

export const createSnagVisitSchema = z.object({
  projectId: z.string().uuid(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  conductedBy: z.string().uuid().optional(), // defaults to caller in the action
  attendees: z.array(visitAttendeeSchema).max(50).default([]),
  title: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
})

export const updateSnagVisitSchema = createSnagVisitSchema.partial().extend({
  visitId: z.string().uuid(),
})

export type VisitAttendee = z.infer<typeof visitAttendeeSchema>
export type CreateSnagVisitInput = z.infer<typeof createSnagVisitSchema>
export type UpdateSnagVisitInput = z.infer<typeof updateSnagVisitSchema>
```

- [ ] **Step 2: Export from the barrel.** Add `export * from './schemas/snag-visit.schema'` to `packages/shared/src/index.ts` (match how `snag.schema` is exported).

- [ ] **Step 3: Type-check.** Run: `pnpm --filter @esite/shared type-check`. Expected: clean.

- [ ] **Step 4: Commit.** `git commit -am "feat(snags): #5 snag-visit zod schema"`

### Task 2.2: `computeVisitBuckets` (pure, TDD)

**Files:** Create `packages/shared/src/services/snag-visit-buckets.ts` + `.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from 'vitest'
import { computeVisitBuckets, type BucketSnag, type BucketVisit } from './snag-visit-buckets'

const V = (id: string, visit_no: number): BucketVisit => ({ id, visit_no })
const S = (id: string, raised: string, closed: string | null, status: string): BucketSnag =>
  ({ id, raised_on_visit_id: raised, closed_on_visit_id: closed, status })

describe('computeVisitBuckets', () => {
  const visits = [V('v0', 0), V('v1', 1), V('v2', 2)]

  it('new = raised on this visit', () => {
    const snags = [S('a', 'v1', null, 'open'), S('b', 'v0', null, 'open')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.newSnags.map(s => s.id)).toEqual(['a'])
  })

  it('closed = closed on this visit', () => {
    const snags = [S('a', 'v0', 'v1', 'closed')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.closedThisVisit.map(s => s.id)).toEqual(['a'])
    expect(r.stillOpen).toHaveLength(0)
  })

  it('still-open = raised on-or-before, not closed as of this visit', () => {
    // raised v0, closed at v2 → at v1 it is still open
    const snags = [S('a', 'v0', 'v2', 'closed')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.stillOpen.map(s => s.id)).toEqual(['a'])
    expect(r.closedThisVisit).toHaveLength(0)
  })

  it('a snag raised on a later visit is invisible to an earlier visit', () => {
    const snags = [S('a', 'v2', null, 'open')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.newSnags).toHaveLength(0)
    expect(r.stillOpen).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it — verify it fails.** Run: `pnpm --filter @esite/shared test snag-visit-buckets`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
export interface BucketVisit { id: string; visit_no: number }
export interface BucketSnag {
  id: string
  raised_on_visit_id: string | null
  closed_on_visit_id: string | null
  status: string
}
export interface VisitBuckets<T> { newSnags: T[]; stillOpen: T[]; closedThisVisit: T[] }

export const CLOSED_STATUSES = ['signed_off', 'closed'] as const

export function computeVisitBuckets<T extends BucketSnag>(
  visit: BucketVisit,
  allVisits: BucketVisit[],
  snags: T[],
): VisitBuckets<T> {
  const noById = new Map(allVisits.map(v => [v.id, v.visit_no]))
  const raisedNo = (s: T) => (s.raised_on_visit_id != null ? noById.get(s.raised_on_visit_id) : undefined)
  const closedNo = (s: T) => (s.closed_on_visit_id != null ? noById.get(s.closed_on_visit_id) : undefined)

  const newSnags: T[] = []
  const stillOpen: T[] = []
  const closedThisVisit: T[] = []

  for (const s of snags) {
    const rn = raisedNo(s)
    if (rn === undefined || rn > visit.visit_no) continue // not yet visible at this visit
    const cn = closedNo(s)
    if (cn === visit.visit_no) { closedThisVisit.push(s); continue }
    if (s.raised_on_visit_id === visit.id) { newSnags.push(s); continue }
    const closedAsOfNow = cn !== undefined && cn <= visit.visit_no
    if (!closedAsOfNow) stillOpen.push(s)
  }
  return { newSnags, stillOpen, closedThisVisit }
}
```

- [ ] **Step 4: Run tests — verify pass.** Run: `pnpm --filter @esite/shared test snag-visit-buckets`. Expected: PASS (4 tests).

- [ ] **Step 5: Export from the barrel + commit.** Add `export * from './services/snag-visit-buckets'` to the barrel. `git commit -am "feat(snags): #5 computeVisitBuckets pure logic + tests"`

### Task 2.3: Visit service

**Files:** Create `packages/shared/src/services/snag-visit.service.ts`; export from barrel.

- [ ] **Step 1: Write the service** (model on `snag.service.ts` — same client typing, `.schema('field')` casts). Methods:

```ts
// listVisits(client, projectId) -> visits for project, ordered by visit_no DESC, each with
//   counts {newCount, openCount, closedCount} derived via computeVisitBuckets over the project's snags.
// getVisit(client, visitId) -> single visit + conducted_by profile.
// createVisit(client, input, orgId, conductedBy) -> insert (trigger assigns visit_no).
// updateVisit(client, visitId, patch) -> update editable fields.
// deleteVisit(client, visitId) -> delete (DB blocks if snags reference it).
// listVisitSnags(client, projectId) -> all snags for project with raised/closed visit ids + photos
//   (reuse snag.service shape; needed for bucketing on the visit page).
```

Provide concrete bodies following `snag.service.ts` patterns (nested photo select, profile resolution left to the action/service-client layer). Counts use `computeVisitBuckets` from Task 2.2.

- [ ] **Step 2: Type-check.** Run: `pnpm --filter @esite/shared type-check`. Expected: clean.

- [ ] **Step 3: Commit.** `git commit -am "feat(snags): #5 snag-visit service"`

---

## PHASE 3 — Server actions

### Task 3.1: Visit CRUD actions + RBAC tests

**Files:** Create `apps/web/src/actions/snag-visit.actions.ts` + `.test.ts`

- [ ] **Step 1: Write the actions** (model on `apps/web/src/actions/snag.actions.ts` for the auth/analytics/revalidate shape, and on `tenant-documents.actions.ts` / `tenant-board.actions.ts` for the role gate). Every write resolves project→org, gates with `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` **after** the access guard, then writes via the service on a `createServiceClient()`:
  - `createSnagVisitAction(input: CreateSnagVisitInput)` — `conductedBy` defaults to the caller; revalidates `/projects/[id]/snags`.
  - `updateSnagVisitAction(input: UpdateSnagVisitInput)`
  - `deleteSnagVisitAction(visitId, projectId)` — surfaces the DB block (snags reference it) as a friendly error.

- [ ] **Step 2: Write RBAC tests** (model on `tenant-documents.actions.test.ts`, `vi.hoisted` mock pattern — see the inspections/test-infra note in the repo). Assert: owner/admin/PM pass; a read-only role (`client_viewer`) is rejected before any write; cross-project guard holds (a visit's `projectId` must own it).

- [ ] **Step 3: Run tests.** Run: `pnpm --filter web test snag-visit.actions`. Expected: PASS.

- [ ] **Step 4: Commit.** `git commit -am "feat(snags): #5 visit CRUD actions (RBAC-gated) + tests"`

### Task 3.2: Add-snag-to-visit + close-on-visit actions

**Files:** Modify `apps/web/src/actions/snag-visit.actions.ts` (+ tests)

- [ ] **Step 1: Implement `addSnagToVisitAction(input)`** — wraps the existing snag create (reuse the create path used by `projects/[id]/snags/new`), forcing `raised_on_visit_id = input.visitId` and stamping any uploaded photos' `visit_id`. Same role gate.

- [ ] **Step 2: Implement `closeSnagOnVisitAction(snagId, visitId, projectId)`** — guard a closeout photo exists (reuse `signOffSnagAction`'s closeout-photo check), set `status` to `signed_off`, set `closed_on_visit_id = visitId`, stamp the closeout photo's `visit_id`. Notify raised_by/assigned_to (reuse the existing notification helper). Same role gate.

- [ ] **Step 3: Tests** — closeout-photo guard rejects when absent; on success `closed_on_visit_id` is set and status is closed; role gate enforced.

- [ ] **Step 4: Run + commit.** Run: `pnpm --filter web test snag-visit.actions`. Expected: PASS. `git commit -am "feat(snags): #5 add-snag-to-visit + close-on-visit actions"`

---

## PHASE 4 — Web UI

### Task 4.1: Landing — lens toggle + by-visit list

**Files:** Modify `apps/web/src/app/(admin)/projects/[id]/snags/page.tsx`; create `_components/VisitList.tsx`

- [ ] **Step 1:** Add a **By visit | All snags** lens (URL `?view=visits|all`, default `visits`). Keep the existing flat register as the `all` branch (add a "raised on visit" column to its rows). For `visits`, fetch `listVisits(service, projectId)` and render `VisitList`.

- [ ] **Step 2: `VisitList.tsx`** — "+ Start site visit" (opens `VisitForm`, Task 4.2) + visit cards (`Site Visit {visit_no}` or "Initial backlog" when `is_backlog`, date, conducted_by name, chips `{newCount} new / {openCount} open / {closedCount} closed`). Each card links to `/projects/[id]/snags/visits/[visitId]`. Use E-Site `Card`/badge variants + `var(--c-amber)` styling. Model the card visual on the mockup `snags-landing-layout.html` (Option A).

- [ ] **Step 3: Verify** via the preview workflow (dev server, navigate to a project's `/snags`, confirm both lenses render, no console errors).

- [ ] **Step 4: Commit.** `git commit -am "feat(snags): #5 snags landing — by-visit lens + visit list"`

### Task 4.2: Visit form (start / edit)

**Files:** Create `_components/VisitForm.tsx`

- [ ] **Step 1:** A form (react-hook-form + zodResolver on `createSnagVisitSchema`/`updateSnagVisitSchema`) with `visit_date` (defaults today), `conducted_by` (member picker, defaults caller), an attendees repeater (name + company rows, add/remove), `title`, `notes`. Submits via `createSnagVisitAction` / `updateSnagVisitAction`. Model on an existing settings form (e.g. the project-settings form pattern + `StickySaveBar` where appropriate, or a modal). 

- [ ] **Step 2: Verify** create + edit round-trip in the preview (new visit appears in the list with the next `visit_no`).

- [ ] **Step 3: Commit.** `git commit -am "feat(snags): #5 visit start/edit form"`

### Task 4.3: Visit detail page

**Files:** Create `visits/[visitId]/page.tsx` + `VisitDetail.tsx` (+ group/row sub-components)

- [ ] **Step 1: `page.tsx`** — server component: resolve project + visit (`requireRolePage`/view gate per the snags pages), fetch the project's snags via `listVisitSnags`, compute buckets with `computeVisitBuckets`, fetch signed photo URLs for thumbnails, pass to `VisitDetail`.

- [ ] **Step 2: `VisitDetail.tsx`** — header (visit no/date/conducted_by/attendees/notes) + actions (**+ Add snag**, **Edit visit**, **⬇ Export PDF** amber); stat strip; three stacked groups (New / Still-open collapsible / Closed) with snag rows. Inline **Close ✓** on still-open rows → `closeSnagOnVisitAction`; **+ Add a snag to this visit** → `addSnagToVisitAction` (reuse the snag create form pre-set to this visit). Rows link to `/snags/[id]`. Model the visual 1:1 on the mockup `visit-detail.html`.

- [ ] **Step 3: Verify** in preview: groups populate correctly from seeded data; inline close moves a snag from Still-open → Closed on reload; Add snag lands it under New.

- [ ] **Step 4: Commit.** `git commit -am "feat(snags): #5 visit detail page — three groups + inline close/add"`

### Task 4.4: Snag detail augmentation

**Files:** Modify `apps/web/src/app/(admin)/snags/[id]/page.tsx`

- [ ] **Step 1:** Show the origin visit ("raised on Site Visit N") and, if closed, the closing visit; group the photo grid by `visit_id` with a small caption per visit. Keep the change minimal/additive.

- [ ] **Step 2: Verify + commit.** `git commit -am "feat(snags): #5 snag detail shows origin/closing visit"`

---

## PHASE 5 — Report

### Task 5.1: Report data gatherer (TDD)

**Files:** Create `apps/web/src/lib/reports/snag-visit-report-data.ts` + `.test.ts`

- [ ] **Step 1:** Model on `inspection-report-data.ts` (`gatherInspectionReportData`). `gatherSnagVisitReportData(supabase, projectId, visitId)`:
  1. RBAC gate (project access).
  2. Service-client resolution of conductor/attendee/assignee names.
  3. `computeVisitBuckets` → the three groups.
  4. Fetch each snag's photos as **`data:` URIs** (the PR #38 lesson — never pass signed URLs to react-pdf), partitioned before/after for closed snags via `photo_type`.
  5. `resolveBranding` for the project/org/contractor logos + accent.
  Returns a plain serialisable `SnagVisitReportData` object.

- [ ] **Step 2: Test** the pure shaping (given mocked rows, buckets land in the right groups, photo `data:` URIs attach to the right snag, branding resolves). Run: `pnpm --filter web test snag-visit-report-data`. Expected: PASS.

- [ ] **Step 3: Commit.** `git commit -am "feat(snags): #5 snag-visit report data gatherer + tests"`

### Task 5.2: Report document + render

**Files:** Create `apps/web/src/lib/reports/snag-visit-report.tsx` + `.render.test.ts`

- [ ] **Step 1:** Build `SnagVisitReportDocument` reusing the engine's `Cover` + interior primitives. Cover title block = *Snag & Defect Report* · project · *Site Visit N* · date · counts. Body = three status groups, each snag a **card with inline photos** (before/after for closed). Export `renderSnagVisitReport(data): Promise<Buffer>`. Model 1:1 on `inspection-report.tsx` + the mockup `report-composition.html` (Option A).

- [ ] **Step 2: Render test** with `// @vitest-environment node` (renderToBuffer is Node-only): seeded data → non-empty Buffer. Run: `pnpm --filter web test snag-visit-report.render`. Expected: PASS.

- [ ] **Step 3: Commit.** `git commit -am "feat(snags): #5 SnagVisitReportDocument + render"`

### Task 5.3: Route + export action (persist to projects.reports)

**Files:** Create `app/api/projects/[id]/snags/visits/[visitId]/report/route.ts`; add `exportSnagVisitReportAction` to `snag-visit.actions.ts`

- [ ] **Step 1: Route** (`export const runtime = 'nodejs'`) — model on the inspection `report-preview` route: gate, gather, render, return the PDF inline (GET = preview).

- [ ] **Step 2: `exportSnagVisitReportAction(visitId, projectId)`** — role-gated (`ORG_WRITE_ROLES`); render to Buffer → upload to the `reports` bucket at `{org}/{project}/snag-visit-{visitId}-v{n}.pdf` → insert a `projects.reports` row (`kind='snag'`, `source_table='snag_visits'`, `source_id=visitId`, `title`, `branding_snapshot`, `generated_by`, `version=n`). If a prior issued report exists for this visit, set its `status='superseded'` + `superseded_by` = the new id. Return the saved report row.

- [ ] **Step 3: Tests** — export inserts a `reports` row with `kind='snag'` and supersedes the prior; role gate enforced. Run: `pnpm --filter web test snag-visit`. Expected: PASS.

- [ ] **Step 4: Commit.** `git commit -am "feat(snags): #5 report route + exportSnagVisitReportAction (persist + supersede)"`

### Task 5.4: Wire the Export button + last-exported

**Files:** Modify `VisitDetail.tsx`

- [ ] **Step 1:** Wire **⬇ Export PDF** to `exportSnagVisitReportAction`; on success open the saved PDF (signed URL) and show "Last exported {date} · re-download" (read the latest `projects.reports` row for this visit on the server side).

- [ ] **Step 2: Verify** end-to-end in preview: export produces a branded PDF with photos; a `projects.reports` row is written; re-export supersedes and the banner updates.

- [ ] **Step 3: Commit.** `git commit -am "feat(snags): #5 wire Export PDF + last-exported banner"`

---

## PHASE 6 — Docs & verification

### Task 6.1: RBAC matrix

**Files:** Modify `docs/rbac-matrix.md`

- [ ] **Step 1:** Add the new routes/endpoints (`/projects/[id]/snags` lens, `/projects/[id]/snags/visits/[visitId]`, the report route) and the snag-visit actions with their role rows (view = project access; write/export = ORG_WRITE_ROLES). Commit: `git commit -am "docs(snags): #5 rbac-matrix rows for snag visits"`

### Task 6.2: Full verification

- [ ] **Step 1: Type-check all workspaces.** Run: `pnpm -r type-check`. Expected: clean (web on React 19 paths).
- [ ] **Step 2: Full web + shared test suites.** Run: `pnpm --filter web test` and `pnpm --filter @esite/shared test`. Expected: all green (record the counts).
- [ ] **Step 3: Web build.** Run: `pnpm --filter web build`. Expected: success.
- [ ] **Step 4: Preview smoke** — exercise the full flow once in the browser preview (create visit → add snags → close one → export → re-download), capture a screenshot of the rendered PDF as proof.
- [ ] **Step 5: Final commit** of any fixups. Do **not** push to main / deploy the migration to prod — hand back for the gated merge.

---

## Self-review notes (coverage)

- Spec §5 (data model) → Task 1.1. §5.4 backfill → 1.1 step 4-block. §5.5 RLS → 1.1 step 1+5. Smoke → 1.2.
- §6 carry-forward → Task 2.2 (pure, fully tested incl. as-of-historical + later-visit invisibility + closed/open/new).
- §7 UI → Tasks 4.1–4.4. §8 actions/RBAC → 3.1–3.2 (+ matrix 6.1). §9 report+persistence → 5.1–5.4.
- §10 testing → tests in 1.2, 2.2, 3.1/3.2, 5.1/5.2/5.3 + 6.2. §11 deploy → 1.1 steps 3-4 + 6.2 step 5 (gated).
- Type names consistent: `computeVisitBuckets`/`VisitBuckets`/`BucketSnag`/`BucketVisit` (2.2) used by 2.3 + 5.1; `CreateSnagVisitInput`/`UpdateSnagVisitInput` (2.1) used by 3.1; `exportSnagVisitReportAction` (5.3) used by 5.4; `gatherSnagVisitReportData` (5.1) used by 5.2/5.3.
