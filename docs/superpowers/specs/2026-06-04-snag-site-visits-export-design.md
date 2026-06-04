# Snag site visits + PDF export — design spec

**Date:** 2026-06-04
**Backlog item:** #5 (snag tab — dated site visits + multiple snags per visit + branded PDF export with images)
**Branch:** `feat/snag-site-visits` (off `main` = `19a6209`)
**Status:** Approved design (brainstormed with HTML companion mockups). Ready for implementation plan.

Mockups (design-of-record, local — `.superpowers/` is gitignored):
`.superpowers/brainstorm/12897-1780547992/content/{snags-landing-layout,visit-detail,report-composition}.html`

---

## 1. Context & problem

The snag module already exists (web + mobile): `field.snags` + `field.snag_photos`, a 6-state status workflow (`open → in_progress → resolved → pending_sign_off → signed_off → closed`), priority, location, category, evidence/closeout/markup photos, org-wide (`/snags`) and per-project (`/projects/[id]/snags`) flat lists. See the existing service `packages/shared/src/services/snag.service.ts` and actions `apps/web/src/actions/snag.actions.ts`.

Two capabilities are missing, both requested in backlog #5:

1. **Dated site visits** — a snag today is a standalone record. There is no concept of a *site visit* that bundles the multiple snags raised during one dated walk, nor of tracking defects *across* visits (closed-since-last / still-open / new).
2. **PDF export with images** — there is no snag report. The branded report engine (PR #38, `apps/web/src/lib/reports/`) + the `projects.reports` saved-artifact table exist and explicitly reserve a `snag` kind, but nothing consumes them yet.

## 2. Goals

- A **site visit** is a first-class, dated event per project; snags are raised under it.
- Snags **carry forward**: a snag has an origin visit, stays open across visits, and is closed on a later visit. Each visit is a dated checkpoint.
- A visit page shows three groups: **new this visit**, **still open (carried forward)**, **closed this visit**.
- **Export** a visit as a branded PDF (reusing the PR #38 engine), with each snag's photos inline (before/after for closed ones), and **save** it as a `projects.reports` artifact (re-downloadable, versioned).
- Web-first; consistent with existing RBAC and the repo's service-role-write lesson.

## 3. Non-goals (explicitly out of v1)

- **Mobile** — mobile keeps its current flat snag capture; visit model comes in a later pass.
- **In-app emailing** of the report — "send" = download the saved PDF and send it yourself.
- **Per-visit observation log** (the heavier "Approach 2"), reopen-history, and **group-by-area** report layout — deferred.
- **Auto-filing** the snag report into Handover — deferred (possible fast-follow).
- A heavy **reports-management/versioning UI** — v1 ships save + a "last exported · re-download" affordance only.

## 4. Key decisions (from brainstorm)

| # | Decision |
|---|---|
| Q1 | A visit is a **first-class event** (not just a date filter). |
| Q2 | **Carry-forward** model: snags live on; visits are dated checkpoints; report shows closed/open/new. |
| Q3 | **Web-first**; mobile deferred. |
| Data model | **Approach 1 — visit stamps on the snag** (origin + closing visit pointers), not a per-visit observation table. |
| Landing | **Visits-primary** — land on the list of visits; flat register behind an "All snags" tab. |
| Visit page | Three stacked groups; inline **Close ✓** on carried-forward snags; **+ Add snag** raises under the visit. |
| Report body | **Snag cards with inline photos** (not a table + photo appendix). |
| Report grouping | **By status** (New / Still-open / Closed); location shown per row. |
| Persistence | **Save on export** to `projects.reports` (`kind='snag'`); re-export supersedes. Minimal "re-download" UI. |

## 5. Data model

New migration **`00120_snag_site_visits.sql`** (00118/00119 are claimed by the open drawings PR #40 — 00120 avoids a collision; the snag migration has no ordering dependency on those).

### 5.1 New table `field.snag_visits`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `organisation_id` | UUID NOT NULL | FK → `public.organisations(id)` ON DELETE CASCADE |
| `project_id` | UUID NOT NULL | FK → `projects.projects(id)` ON DELETE CASCADE |
| `visit_no` | INT NOT NULL | per-project sequence; real visits 1,2,3…; backlog = 0 |
| `is_backlog` | BOOLEAN NOT NULL DEFAULT false | the synthetic legacy-snag home |
| `visit_date` | DATE NOT NULL | day of the walk |
| `conducted_by` | UUID NOT NULL | FK → `public.profiles(id)` |
| `attendees` | JSONB NOT NULL DEFAULT `'[]'` | array of `{name, company}` |
| `title` | TEXT | optional label/reference |
| `notes` | TEXT | optional (weather, scope of the walk) |
| `created_at` / `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | `updated_at` via `set_updated_at` trigger |

Constraints / triggers:
- `UNIQUE (project_id, visit_no)`.
- `UNIQUE (project_id, id)` — target for the composite FKs from `snags` (same-project integrity, mirroring the anchor sub-boards pattern in 00116).
- `CHECK (jsonb_typeof(attendees) = 'array')`.
- **`visit_no` BEFORE INSERT trigger** `field.snag_visits_ensure_no()` — if `visit_no` is NULL/0 on a non-backlog insert, set it to `COALESCE(MAX(visit_no),0)+1` for that project. (First real visit after a backlog(0) → 1.) Mirrors `projects_ensure_code` style.

### 5.2 Alter `field.snags`

- `ADD raised_on_visit_id UUID` — origin visit. Nullable at column level (legacy), but the create action always sets it.
- `ADD closed_on_visit_id UUID` — the visit at which the snag was closed; nullable.
- Composite FKs (same-project enforcement, ON DELETE NO ACTION so a project cascade still tears down but a lone visit-with-snags can't be deleted):
  - `(project_id, raised_on_visit_id) → field.snag_visits(project_id, id) ON DELETE NO ACTION`
  - `(project_id, closed_on_visit_id) → field.snag_visits(project_id, id) ON DELETE NO ACTION`

### 5.3 Alter `field.snag_photos`

- `ADD visit_id UUID` — the visit the photo was taken on; plain FK → `field.snag_visits(id) ON DELETE SET NULL` (no `project_id` on this table for a composite FK; app sets it correctly from the snag's active visit).

### 5.4 Legacy backfill (in-migration)

For each project that has existing snags: insert one `snag_visits` row with `is_backlog = true`, `visit_no = 0`, `visit_date = MIN(snags.created_at)::date`, `conducted_by = ` the earliest snag's `raised_by` (always non-null), `title = 'Initial backlog'`. Set those snags' `raised_on_visit_id` to it. No snag is left without an origin.

### 5.5 RLS

Mirror `field.snags` (00012 / 00032): SELECT = `user_has_project_access(project_id)`; INSERT/UPDATE/DELETE = org member + contractor-and-above, with the paused-payment write block. Server actions additionally enforce role in-app (§8). `NOTIFY pgrst, 'reload schema'` at the end (no schema create → no PostgREST config PATCH needed; `field` is already exposed).

## 6. Carry-forward logic (pure, unit-tested)

`packages/shared/src/structure/snag-visits.ts` (or `packages/shared/src/services/_snag-visit-buckets.ts`):

```
computeVisitBuckets(visit, allVisitsForProject, snagsForProject) →
  { newSnags, stillOpen, closedThisVisit }
```

Visits are ordered by `visit_no` (backlog 0 first). For a target visit `V`:
- **newSnags** = snags with `raised_on_visit_id === V.id`.
- **closedThisVisit** = snags with `closed_on_visit_id === V.id`.
- **stillOpen** = snags raised on a visit with `visit_no ≤ V.visit_no`, **and** not closed as of `V` (i.e. `closed_on_visit_id` is null, or the closing visit's `visit_no > V.visit_no`).

"Closed" for report/bucket purposes = snag `status ∈ {signed_off, closed}`; the close action sets both `status` and `closed_on_visit_id` together.

**Caveat (accepted v1):** sub-status shown for a still-open snag ("in progress" / "awaiting sign-off") reflects the snag's *current* status. This is exact when exporting the latest (current) visit — which is the normal path, since older reports are re-downloaded as their frozen PDF artifact, not re-rendered. Documented, not fixed in v1.

## 7. UI (web)

Routes use `[id]` (project) per repo convention.

- **`/projects/[id]/snags`** (landing) — a lens toggle **By visit** (default) | **All snags**.
  - *By visit*: "+ Start site visit" + a list of visit cards (`Site Visit {visit_no}` · date · conducted_by · chips `{n} new / {n} open / {n} closed`). Backlog rendered as a muted card.
  - *All snags*: the existing flat register (status/priority/aging filters), with an added "raised on visit" column.
- **`/projects/[id]/snags/visits/[visitId]`** (visit detail) — header (visit no/date/conducted_by/attendees/notes) + actions (**+ Add snag**, **Edit visit**, **⬇ Export PDF** in brand amber) + stat strip + three stacked groups:
  - 🔵 *New this visit* — snags `raised_on_visit_id = visit`, plus inline "+ Add a snag to this visit".
  - 🟠 *Still open — carried forward* (collapsible) — each tagged `from Visit N`, with inline **Close ✓**.
  - 🟢 *Closed this visit* — struck-through, before+after photos, tagged where raised.
- **Snag detail** (existing `/snags/[id]`) — augment to show origin visit + closing visit; photos grouped by visit. (Light change.)
- **Visit form** (start/edit) — `visit_date`, `conducted_by` (default current user), `attendees` (name + company rows), `title`, `notes`.
- **Add snag under visit** — reuse the existing snag create form, pre-setting `raised_on_visit_id`.
- **Close ✓** — requires a closeout photo (existing rule); sets `status` (signed_off/closed) + `closed_on_visit_id = visit`, stamps the photo's `visit_id`.

## 8. Server actions & permissions

New file `apps/web/src/actions/snag-visit.actions.ts` (or extend `snag.actions.ts`). All service-role writes carry an in-app role gate **after** the access guard, per the repeated repo lesson (RLS alone is insufficient for service-client writes):

- `createSnagVisitAction`, `updateSnagVisitAction`, `deleteSnagVisitAction`
- `addSnagToVisitAction` (wraps snag create with `raised_on_visit_id`)
- `closeSnagOnVisitAction(snagId, visitId)` — closeout-photo guard + stamps `closed_on_visit_id`
- `exportSnagVisitReportAction(visitId)` — §9

Gating:
- **View** (visits, snags, report list/download) → project access (`user_has_project_access` / `guardProjectRead`).
- **Write** (create/edit/delete visit, raise/close snags, export) → `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` + existing RLS.

`docs/rbac-matrix.md` updated in the same PR (new routes/endpoints).

## 9. Report (branded PDF, saved)

Reuses the PR #38 engine verbatim (`apps/web/src/lib/reports/`): `Cover`, interior primitives, `resolveBranding`. Lives under `apps/web/src/lib/reports/` to keep `@react-pdf/renderer` out of the mobile bundle.

- **Data gatherer** `gatherSnagVisitReportData(visitId)` — mirrors `gatherInspectionReportData`: RBAC gate → service-client resolution of names → `computeVisitBuckets` → fetch snag photos as **`data:` URIs** (per the PR #38 lesson — never pass signed URLs to react-pdf) → `resolveBranding`. Pure/deterministic given its inputs.
- **Document** `SnagVisitReportDocument` — Cover (issuer wordmark + amber rule + "PREPARED WITH" parties strip + page-numbered footer; title block = *Snag & Defect Report* · project · Site Visit N · date · counts) then the three status groups, each snag a **card with inline photos** (before/after for closed).
- **Route** `apps/web/src/app/api/projects/[id]/snags/visits/[visitId]/report/route.ts` — **Node runtime** (`renderToBuffer` is Node-only); GET = inline preview.
- **Export action** `exportSnagVisitReportAction(visitId)` — renders to Buffer → uploads to the `reports` bucket (`{org}/{project}/snag-visit-{visitId}-v{n}.pdf`) → inserts a `projects.reports` row (`kind='snag'`, `source_table='snag_visits'`, `source_id=visitId`, `title`, `branding_snapshot`, `generated_by`, `version`). Re-export → new version, set the prior row's `status='superseded'` + `superseded_by`. Visit page shows "Last exported {date} · re-download".

## 10. Testing

- **Pure**: `computeVisitBuckets` (new/open/closed across multiple visits, incl. as-of-historical and backlog) + the gatherer's data shaping.
- **Actions**: RBAC gates (owner/admin/PM pass; contractor write per existing snag rule; read-only roles blocked), cross-project guards — `vi.hoisted` mock pattern.
- **Migration**: transactional, ROLLBACK-safe smoke test (`scripts/db/smoke-test-snag-site-visits.sh`) — tables/columns/constraints/trigger exist; visit_no sequencing; backfill assigns origins; composite-FK same-project enforcement; RLS enabled.
- **Render**: a `// @vitest-environment node` test that `SnagVisitReportDocument` renders to a non-empty Buffer with seeded data.

## 11. Deploy notes

- Single migration `00120_snag_site_visits.sql`; additive, idempotent, paused-payment-aware. Apply path: merge to `main` → `deploy-migrations.yml` auto-applies + records the ledger row. (Or controller-apply + record `00120` to avoid CLI ledger drift.)
- Post-merge: `pnpm db:gen-types` (new tables aren't in generated types; code casts via the `field`/`AnyClient` pattern meanwhile).
- No PostgREST config PATCH (no schema create).
- **Prod migration deploy is the gated step** — not done without explicit owner sign-off + a Vercel preview verify of the export render (the PR #38 "deploy-verify the render" lesson).

## 12. Future (post-v1)

Mobile parity · in-app email/share · group-by-area toggle · per-visit observation log + reopen history · handover auto-filing · reports-management UI.
