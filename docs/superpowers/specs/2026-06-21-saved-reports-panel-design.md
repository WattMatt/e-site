# Saved Reports — visible, previewable, manageable (Phase 1)

**Date:** 2026-06-21
**Status:** Design — pending implementation plan
**Branch:** `feat/saved-reports-panel` (off `main`)

## Problem

Sections that generate reports save them but, in most cases, never show them again.
Concretely today:

- **Tenant-schedule report** writes a versioned PDF to `projects.reports`
  (`POST /api/projects/[id]/tenant-schedule/reports`), then there is **no UI** to
  see, preview, download, or delete it. The page renders only the
  `TenantScheduleReportButton` (generate → preview → save/download).
- **GCR report** already has a full saved-reports panel
  (`ReportsPanel` + `gcr-reports.actions.ts`), but over a **separate** table
  (`gcr.report_revisions`), not `projects.reports`.
- Other kinds (inspection, valuation, snag_visit) write to `projects.reports`
  and surface their reports ad-hoc on their own pages.

## Vision & phased roadmap

The user goal: **every report-generating section shows its saved reports
(visible · preview · download · delete), and a project-level Reports hub
aggregates all of them.**

Decomposed into independently shippable phases (each its own spec → plan → ship):

- **Phase 1 (this spec)** — Build the reusable foundation (shared actions +
  `SavedReportsPanel`) over `projects.reports`, and wire it into the
  tenant-schedule page (the concrete gap).
- **Phase 2** — Roll the panel into the other `projects.reports` sections
  (inspection, valuation, snag_visit), auditing what each already shows. GCR
  keeps its own table + richer panel (decision below); it is brought into the
  hub via an adapter, not migrated.
- **Phase 3** — Project-level Reports hub (`/projects/[id]/reports`) aggregating
  every kind, reading `projects.reports` plus a GCR adapter, normalised to one
  display shape.

**Architectural decision (locked):** keep GCR on `gcr.report_revisions`; the hub
aggregates via an adapter. No data migration. Rationale: GCR has bespoke summary
fields and an already-working panel; unifying tables would risk regressions for
no Phase-1/2 benefit.

## Phase 1 scope

In scope: shared actions, reusable panel + viewer modal, tenant-schedule
"Saved reports" card, refresh-after-save. **No schema change.** **GCR untouched.**

Out of scope: Phases 2–3; any change to GCR; the project-level hub; new report
kinds; pagination (version counts per kind are small).

## Data foundation (existing, unchanged)

`projects.reports` (migration `00117`): `id, organisation_id, project_id, kind,
source_table, source_id, title, storage_path, mime_type, size_bytes,
status ∈ {draft,issued,superseded,revoked}, version, superseded_by,
branding_snapshot, generated_by, generated_at, created_at, updated_at`.
PDFs live in the private `reports` storage bucket.

RLS:
- `reports_select` — **read** for anyone with `user_has_project_access(project_id)`.
- `reports_write` (FOR ALL incl. DELETE) — `owner / admin / project_manager` only.

The phase relies on this exactly: list is read-gated by project access; delete is
owner/admin/PM only.

## Architecture — three units

### 1. Shared server actions — `apps/web/src/actions/project-reports.actions.ts`

Generic over `projects.reports`, parameterised by `kind`. Mirrors the proven
`gcr-reports.actions.ts` shape (no GCR seat gate, no GCR table).

- `listProjectReportsAction(projectId, kind)` → `ProjectReportRow[] | { error }`
  - cookie client; gated by project view access (RLS also enforces).
  - `SELECT * WHERE project_id = ? AND kind = ? AND status IN ('issued','superseded')
     ORDER BY version DESC`.
- `getProjectReportUrlAction(projectId, reportId, { download? })` → `{ url } | { error }`
  - project-scoped lookup (`id = ? AND project_id = ?`); 404 on miss.
  - service client `createSignedUrl(storage_path, 600, download ? { download: filename } : undefined)`.
  - `filename` derived from `title` + `version` (e.g. `tenant-schedule-report-v3.pdf`).
- `deleteProjectReportAction(projectId, reportId)` → `{ ok: true } | { error }`
  - gated by `ORG_WRITE_ROLES` via `requireRole` (matches `reports_write`).
  - delete row, then best-effort `storage.remove([storage_path])`.

A small `ProjectReportRow` type is added to `@esite/shared` (or co-located) for the
selected columns.

### 2. Reusable UI — `apps/web/src/components/reports/`

- `SavedReportsPanel.tsx` — props: `{ projectId, kind, reports, canManage }`.
  Renders a list (newest version first): **version + generated date + status
  badge** (`issued` vs `superseded`), with row actions **Preview / Download /
  Delete (confirm)**. Empty state: "No saved reports yet." Surfaces action errors
  inline (no silent failures). `canManage` hides Delete for non-writers.
- `ReportViewerModal.tsx` — shared in-app PDF viewer (generalised from GCR's
  module-local one): centered modal, `<iframe src={signedUrl}>`. Signed URLs are
  cross-origin Supabase (`frame-src https://*.supabase.co`), so X-Frame-Options
  does not apply — frames cleanly. (See `[[iframe-preview-xfo-constraint]]`.)

Preview = inline signed URL in the modal; Download = attachment-disposition
signed URL via an anchor click.

### 3. Tenant-schedule surface — `tenant-schedule/page.tsx`

Below the `ScheduleTable` card, add a **"Saved reports"** card that renders
`<SavedReportsPanel kind="tenant_schedule" reports={…} canManage={…} />`. The page
(server component) loads the rows by calling `listProjectReportsAction`
(single source of truth for the query) and passes them in; `canManage` is computed
from the caller's org role (`ORG_WRITE_ROLES`) in the page.

After **Save to project** in `TenantScheduleReportButton`, the new report must
appear: the button triggers `router.refresh()` on a successful save so the
server-rendered card re-loads.

## Data flow

```
Save:    TenantScheduleReportButton → POST …/reports (existing) → router.refresh()
List:    page (server) → listProjectReportsAction(projectId,'tenant_schedule') → card
Preview: row → getProjectReportUrlAction(inline) → ReportViewerModal iframe
Download:row → getProjectReportUrlAction({download}) → anchor click
Delete:  row → confirm → deleteProjectReportAction → router.refresh()
```

## Error handling

- Every action returns `{ error }` on failure; the panel renders it inline.
- Delete is confirm-gated; a non-writer never sees Delete (and the action
  re-checks the role server-side).
- Signed-URL failures show "Failed to create report link" rather than a dead link.
- Deleting a row whose storage object is already gone is non-fatal (best-effort).

## Testing (TDD)

- `project-reports.actions.test.ts` — list returns rows newest-first and filters
  by kind/status; getUrl returns inline vs `{download}`; delete enforces
  `ORG_WRITE_ROLES` and removes row + object; project-scoped lookups reject
  cross-project ids. (Mirror `gcr-reports.actions.test.ts`.)
- `SavedReportsPanel.test.tsx` — renders rows + status badges; empty state; Preview
  opens the viewer with the signed URL; Download requests the attachment
  disposition; Delete requires confirm then calls the action; `canManage=false`
  hides Delete. (Mirror `ReportsPanel.test.tsx`.)

## Reuse note

`SavedReportsPanel` + `ReportViewerModal` + `project-reports.actions.ts` are the
reusable spine for Phase 2 (other sections) and Phase 3 (the hub). GCR’s existing
`ReportsPanel`/`ReportViewerModal` stay as-is this phase; a later cleanup may fold
GCR onto the shared viewer once the shared one is proven.
