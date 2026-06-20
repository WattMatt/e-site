# Tenant Schedule Report

**Date:** 2026-06-20
**Status:** Approved (design) — pending implementation plan
**Area:** Tenant Schedule (`/projects/[id]/tenant-schedule`)

## Goal

Add a **"Generate report"** capability to the Tenant Schedule: a branded PDF with a
cover page, a KPI page, and a paginated shop-summary table. On generate, show an
**in-app preview** with **Save** (persist into the project) and **Download** (to the
user's machine).

This rides entirely on the existing report pipeline (`@react-pdf/renderer` +
`src/lib/reports/` shared scaffolding + the `projects.reports` table + the
`reports` storage bucket + `DocumentPreviewModal`). **No new migration.**

## Report structure (portrait, branded)

1. **Cover page** — existing `<Cover>` + `resolveBranding()`: org logo or wordmark,
   accent rule/colour, title "Tenant schedule report", project line, date stamp,
   party logos, page-numbered footer.
2. **KPI page** — four groups of stat cards (computed from real schedule data):
   - **Shops & GLA** — total shops, active, decommissioned, total GLA (m², sum of
     `shop_area_m2`).
   - **Scope & layout completion** — scope received vs awaited (%), layouts issued
     vs not (%).
   - **Landlord procurement — boards & lights** — Boards ordered `X / Y`, Lights
     ordered `X / Y`, and a "By tenant" count. See *Data mapping* below.
   - **BO readiness** — upcoming, overdue, no-date (against the project opening
     date).
3. **Shop summary table** (paginated, repeating header) — one row per **active**
   shop:
   `Shop · Tenant · GLA m² · DB · Lights · Layout · BO date`
   - **DB** / **Lights** cells = that shop's order state for the board / lighting
     scope item: `By tenant` / `Required` / `Ordered` / `Received`, or `—` if the
     shop has no such scope item.
   - **Layout** = `Issued` / `Not issued`.
   - **BO date** = effective BO date; overdue dates are visually flagged.

There is **no scope-item-breakdown table** (dropped in design review).

Decommissioned shops are counted in the KPIs (active vs decommissioned) but are
not listed in the shop table (matching the on-screen default).

## Data mapping (so numbers are real, not invented)

Per shop, per scope-item type there is a `tenant_scope_items.party`
(`landlord`/`tenant`) and a `node_orders.status`
(`required`/`by_tenant`/`ordered`/`received`). The cell/KPIs derive from
`node_orders.status` for that (shop, scope-item-type):

- **Cell label** ← status: `by_tenant`→"By tenant", `required`→"Required",
  `ordered`→"Ordered", `received`→"Received". No order row → `—`.
- **"Landlord identified to order"** = items whose status is *not* `by_tenant`
  (i.e. `required` + `ordered` + `received`).
- **"Ordered"** = `ordered` + `received`.
- So *Boards 22 / 30* = of 30 boards the landlord is to order, 22 are ordered or
  received.

**Identifying DB & Lights:** these are two specific `scope_item_types`. Match by
`key` — "DB" = the type whose key matches the board type (e.g. `db`), "Lights" =
the lighting type (e.g. `lighting`). The exact keys must be confirmed against the
seeded `scope_item_types` during implementation; if a project has neither, the
columns still render with `—` cells and the KPI shows `0 / 0`. (Implementation
note: centralise the key match in one constant so it is easy to adjust.)

**Scope & layout completion:** `tenant_details.scope_status`
(`awaited`/`received`) and `tenant_details.layout_status`
(`not_issued`/`issued`) — both DB-trigger-derived, so reliable.

**BO date:** effective = `bo_date_override ?? (opening_date − bo_period_days)`;
overdue = effective < today; "no date" = neither override nor period set.

## Architecture — mirrors the GCR / inspection report pattern

New files under `apps/web/src/lib/reports/`:

- `tenant-schedule-report-data.ts` — `gatherTenantScheduleReportData(projectId)`:
  runs the same queries the tenant-schedule page already runs (nodes /
  `tenant_details` / `scope_item_types` / `tenant_scope_items` / `node_orders` +
  project/org), then **purely** computes `TenantScheduleReportData` — the KPI
  numbers, the per-shop rows, and the branding input. All number-crunching lives
  in small pure helpers so it is unit-testable without a DB.
- `tenant-schedule-report.tsx` — `<TenantScheduleReportDocument data branding>`:
  composes `Cover` → KPI page (`KeyValue`/stat blocks) → `Section` + `Table`
  (`repeatHeader`, `unbreakableRows`) for the shop summary, with
  `RunningHeader`/`RunningFooter`.
- `render-tenant-schedule.ts` — `renderTenantScheduleReport(data, branding):
  Promise<Buffer>` via `renderToBuffer`.
- `tenant-schedule-report-branding.ts` — `buildTenantScheduleBrandingInput(data,
  today)`, mirroring `buildGcrBrandingInput`.

API routes (mirroring the GCR routes), `runtime = 'nodejs'`:

- `GET …/tenant-schedule/report-preview` — auth + project access → gather →
  resolve branding → render → stream inline PDF (`Content-Disposition: inline`).
- `POST …/tenant-schedule/reports` — auth + manage-project → gather → render →
  upload to the `reports` bucket
  (`{org}/{project}/tenant-schedule/{ts}-{uuid}.pdf`) → insert a
  **`projects.reports`** row (`kind='tenant_schedule'`, `title`, `storage_path`,
  `size_bytes`, `version` = previous max + 1 with the prior row's `superseded_by`
  set, `branding_snapshot`, `generated_by`). Clean up the orphaned object if the
  row insert fails.

## UI — generate → preview → save → download

A **"Generate report"** button in the tenant-schedule page header opens the
existing **`DocumentPreviewModal`** pointed at the `report-preview` stream (in-app
PDF preview in an iframe). The modal already provides **Download**; add a **Save**
action that POSTs to the reports route and confirms persistence. So *Save* = keep
it in the project (`projects.reports`), *Download* = to the user's machine.

A report-history list is **out of scope** (the row persists and is retrievable; a
list/handover surface can come later).

## Testing / verification

- `tenant-schedule-report.render.test.ts` (`@vitest-environment node`): asserts the
  rendered buffer starts with `%PDF-`, and renders without throwing for edge cases
  — no shops, shops with no DB/Lights scope item, missing GLA, no BO dates, no org
  logo.
- Pure unit tests for the computation helpers: status→cell mapping; landlord-to-
  order vs ordered counts for boards & lights; scope/layout completion %; BO
  overdue/upcoming/no-date bucketing; active-vs-decommissioned counts.
- Manual: generate on a real project → preview renders → Save creates a
  `projects.reports` row + storage object → Download returns the PDF.

## Out of scope

- Scope-item-breakdown table (dropped).
- Report-history/versions list UI and handover filing.
- Any change to the tenant-schedule editing flows or the report engine itself.
- Landscape orientation (start portrait; revisit only the shop table if real data
  proves too wide).
