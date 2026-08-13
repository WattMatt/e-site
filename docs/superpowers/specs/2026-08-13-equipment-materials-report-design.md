# Equipment & Materials report — design

**Date:** 2026-08-13
**Status:** approved, in implementation
**Branch:** `feat/equipment-materials-report`
**Migration:** `00183`

---

## 1. Why

Equipment & Materials is the last major project module with no report generation. Tenant
Schedule, Generator Cost-Recovery, inspections, snag visits, QC and site forms all produce a
saved, versioned PDF; this tab produces nothing. Users cannot hand a client a procurement
status snapshot, and there is no record of what was reported when.

## 2. What exists today

### 2.1 The shared report platform

`projects.reports` (migration `00117`) is the unified, versioned artifact table:
`kind`, `source_table`/`source_id`, `title`, `storage_path`, `version`, `status`
(`draft|issued|superseded|revoked`), `superseded_by`, `branding_snapshot`, `generated_by`,
`generated_at`. PDFs live in the private `reports` bucket under `{org_id}/{project_id}/…`.

Around it:

- `apps/web/src/actions/project-reports.actions.ts` — generic `list` / signed-`url` / `delete`.
- `apps/web/src/components/reports/SavedReportsPanel.tsx` + `ReportViewerModal.tsx` — the
  history UI, already reused by six surfaces (tenant schedule, valuations, site forms,
  inspections, snag visits, QC).
- `apps/web/src/lib/reports/branding.ts` — `resolveBranding`, per-kind branding input builders.

### 2.2 The two precedents

**Tenant Schedule** is the project-level model to copy: a `report-preview` route (render +
stream, no persistence) and a `reports` route (render + upload + insert + supersede prior),
a preview-modal button, and `SavedReportsPanel kind="tenant_schedule"` on the page.

**Generator Cost-Recovery is the outlier.** It built its own `gcr.report_revisions` table
(`00127`, *after* `00117` shipped) with its own panel and viewer. It forked because it needed
a revision `note`, a `summary` JSONB so the list never re-runs the engine, and feature-seat
gating. Two of those three needs are general; this design adds them to the shared table
rather than forking a second time.

### 2.3 The module

Live in the sidebar at `/projects/[id]/equipment-materials`, board-centric. Data:

- `structure.nodes` — the board register (existence-driven; a board appears because it exists).
- `structure.node_orders` — procurement lines: `label`, `scope_item_type_id`, `status`
  (`by_tenant|required|ordered|received`), `ordered_at`, `received_at`, `notes`.
- `structure.node_order_documents` — one `quote` and one `order_instruction` slot per order.
- `structure.node_order_shop_drawings`.

Derived on read: `computeOrderRequiredBy` (project `opening_date` + tenant BO period) and
`computeRagStatus` → `red|amber|green|neutral`. Shaping is `gatherUnifiedBoards` (pure).

**`node_orders` carries no cost, quantity or rate column.** This is a procurement *status*
report, not a value report. A value report would be a schema change, not a report change.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Full procurement status register — KPI page + full board register | A "where is everything" snapshot, mirroring the Tenant Schedule report's shape |
| 2 | Staff-only (`ORG_WRITE_ROLES`), full detail incl. notes + document presence | The client portal deliberately withholds these as commercial artefacts |
| 3 | Fix the role-blind read in the **shared** layer, sensitive-kind allowlist | A per-kind bolt-on would leave the same hole open for `valuation` |
| 4 | Always the full active register; on-screen filters have no effect | A saved deliverable must mean exactly one thing and stay comparable across versions |
| 5 | Enrich the shared history: author + `note` + `summary` figures | Closes the gap that made GCR fork; every existing kind benefits |

## 4. The security problem this design must solve

**Root cause.** The shared saved-report read path is role-blind. `reports_select` (`00117`)
gates only on `public.user_has_project_access(project_id)`, which returns true for **any**
`projects.project_members` row regardless of role (`00106` clause (a)). Neither
`listProjectReportsAction` nor `getProjectReportUrlAction` re-checks role before minting a
service-client signed URL — the only role gate in `project-reports.actions.ts` is on delete.

**Consequence.** Saving a staff-only PDF into `projects.reports` would let any project member
— including `client_viewer` — list and download it by invoking the server action directly.
Page-level gating is not a gate; this is the PR #135 lesson.

**Scope.** This is a platform gap, not a defect in the new feature. It applies today to
`valuation` (payment certificates), `qc`, `snag` and site-form reports. This design closes it
for the two kinds whose content is commercially sensitive — `equipment_materials` and
`valuation` — and leaves the remainder on today's behaviour, which is a deliberate,
recorded choice rather than an oversight.

## 5. Design

### 5.1 Shared-layer changes

**Migration `00183`** (additive, idempotent):

- `projects.reports.note TEXT` — optional revision note supplied at generate time.
- `projects.reports.summary JSONB` — headline figures for the history list, so listing never
  re-runs the gather or touches storage.
- `public.user_can_read_report_kind(_project_id uuid, _kind text) RETURNS boolean`,
  `STABLE SECURITY DEFINER`, `row_security = off` — true when the kind is not sensitive, or
  when the caller holds an org write role for the project's organisation.
- A **RESTRICTIVE** SELECT policy on `projects.reports` calling that helper, following the
  `00171`/`00177` pattern, so direct PostgREST is closed and not just the server actions.

`projects` is already PostgREST-exposed and this adds no schema, so a trailing
`NOTIFY pgrst, 'reload schema'` suffices — no config PATCH (`00117` precedent).

**`REPORT_KIND_READ_ROLES`** in the shared read path, consulted by both
`listProjectReportsAction` and `getProjectReportUrlAction`:

```ts
equipment_materials: ORG_WRITE_ROLES
valuation:           ORG_WRITE_ROLES
// every other kind: unchanged — project access only
```

A contract test scans the repo for `kind:` literals written into `projects.reports` and fails
if any is absent from the map, so a future kind cannot silently inherit open reads.

**`SavedReportsPanel`** gains author name, `note` and `summary` rendering. All existing call
sites keep working — the new fields are optional and absent rows render as they do today.

### 5.2 Module refactor (in scope, minimal)

`gather-unified-boards.ts` and `order-types.ts` currently live under the admin page's `_lib/`,
yet the portal page already imports their types from that path — they are cross-surface
modules living in a route folder. They move to `apps/web/src/lib/equipment-materials/`, and
the page's row-loading is extracted into one `loadEquipmentMaterialsData(supabase, projectId)`
consumed by both the page and the report.

This is not tidying. If the report re-derives the register independently it will drift from
the screen — the failure class that left the snag close-out path unreachable for months.

### 5.3 Report files

Mirroring the tenant-schedule set in `apps/web/src/lib/reports/`:

- `equipment-materials-report-data.ts` — gather (I/O + RBAC gate).
- `equipment-materials-report-compute.ts` — pure KPI derivation, unit-tested.
- `equipment-materials-report.tsx` — the react-pdf document.
- `equipment-materials-report-branding.ts` — branding input builder.
- `render-equipment-materials.ts` — document → `Buffer`.

Routes under `apps/web/src/app/api/projects/[id]/equipment-materials/`: `report-preview`
(render + stream) and `reports` (render + upload + insert + supersede).

UI: `EquipmentMaterialsReportButton` (preview modal → Save / Download, with an optional note
field) on the tab, plus `SavedReportsPanel kind="equipment_materials"`.

### 5.4 Report content

**Page 1 — cover + KPIs** (portrait). Scope line "All active boards" and a count of excluded
decommissioned boards; board and line totals; status mix with % received; schedule health
(overdue / due soon / on track / no date); documents on file (quote, order instruction, shop
drawing).

**Pages 2+ — register** (landscape; eleven columns will not fit portrait), grouped by board
kind reusing the screen's `GROUP_ORDER` / `GROUP_LABEL`:

`Board · Line · Status · Ordered · Received · Required by · RAG · Quote · Order instr. · Shop dwg`

with `notes` wrapped on a sub-line beneath the row when present.

### 5.5 Authorization

Both the preview and the save route gate on
`requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)`. Preview streams identical
content, so gating only the save would be theatre. This is deliberately stricter than the
tenant-schedule report, whose view-level gate is correct because that report exposes nothing
the viewer cannot already see.

`docs/rbac-matrix.md` is updated in the same PR, per the repo rule.

## 6. Testing

- Unit tests on the pure KPI compute: status mix, overdue counts, empty project, boards with
  no orders, `by_tenant` lines, decommissioned exclusion.
- Full render test: render a fixture and assert KPI figures and a known board row out of the
  PDF content streams, using the non-ASCII-safe extractor fixed in PR #161.
- Route-gate tests: `contractor` and `client_viewer` receive 403 from **both** routes; a
  project manager receives 200.
- Security regression: a `client_viewer` calling `listProjectReportsAction` and
  `getProjectReportUrlAction` for `equipment_materials` is denied — the proof that §4 is closed.
- Contract test: every `kind` literal written to `projects.reports` appears in
  `REPORT_KIND_READ_ROLES`.

## 7. Prod verification plan

Stated before deploy, per the investigation protocol.

1. Migration `00183` applied via the Management API and logged in `schema_migrations`.
2. `rbac-test` contractor fixture → 403 on both routes; cannot list or download the kind.
3. Throwaway probe-admin → generate v1, then v2; assert the supersede chain
   (`v1.status='superseded'`, `superseded_by=v2.id`) and that the panel renders author,
   summary and note.
4. **Walk from the empty state, not a deep link** (the PR #159 lesson): open the tab with no
   saved reports and confirm the Generate CTA is reachable.
5. Confirm the RESTRICTIVE policy has not broken a legitimate current viewer of the
   valuations panel.
6. Throwaway probe deleted — membership, `auth_events`, auth user — zero residue.

## 8. Risks

- **Glyph coverage.** The register uses `✓ ◐ ○ ·`. These must be verified against the font
  registered with react-pdf before the layout depends on them. (The `winAnsiSafe` sanitiser is
  a pdf-lib concern and does not apply to this renderer.)
- **The RESTRICTIVE policy touches `valuation` today.** It closes a real exposure, but no
  legitimate current viewer may lose access — verification item 5.
- **Legacy routes.** `/materials` and `/equipment-schedule` still exist alongside the unified
  tab. The report targets the unified tab only; retiring the other two is a follow-up.
- **No cost data.** Deliberate — see §2.3.
