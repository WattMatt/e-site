# Saved Reports — Phase 2: per-entity sections (inspection · snag visit · valuation)

**Date:** 2026-06-21
**Status:** Design — pending review
**Branch:** `feat/saved-reports-phase2` (off `main`, which has Phase 1)
**Builds on:** `2026-06-21-saved-reports-panel-design.md` (Phase 1)

## Goal

Replace each per-entity section's bespoke "latest report" UI with the unified
`SavedReportsPanel`, scoped to the entity, so every section shows the same
managed history: **versions · in-app Preview · Download · Delete**.

## Current state (what we're replacing)

All three are **per-entity** reports in `projects.reports`
(`source_table` + `source_id`), unlike tenant-schedule (project-level, `kind` only):

| Section | kind | source_table | Current UI being replaced |
|---|---|---|---|
| Inspection | `inspection` | `inspections` | `inspections/[inspectionId]/report/page.tsx` — **inline iframe of the latest issued report** + Download + Regenerate |
| Snag visit | `snag` | `snag_visits` | `snags/visits/[visitId]/page.tsx` — "Last exported · re-download" **banner** (signed download link), no in-app preview |
| Valuation | `valuation` | `valuations` | latest-report download (surface confirmed at implementation — `valuation.actions.ts` reads/writes `projects.reports`; the display lives on the valuation detail/settings surface) |

None offer version history, in-app Preview for non-inspection sections, or Delete.

## Design

### 1. Extend the Phase-1 spine (small, backward-compatible)

`listProjectReportsAction` and `SavedReportsPanel` gain **optional** entity scoping:

- `listProjectReportsAction(projectId, kind, source?: { table: string; id: string })`
  — when `source` is given, add `.eq('source_table', source.table).eq('source_id', source.id)`.
  Tenant-schedule (Phase 1) passes no `source` → unchanged project-level behaviour.
- `SavedReportsPanel` gains optional `source?: { table; id }` (forwarded to the
  action by callers that pre-load rows, and used for the post-delete refresh) and
  an optional **`showLatestInline?: boolean`**.

`getProjectReportUrlAction` / `deleteProjectReportAction` already key on `reportId`
and need **no change** (a reportId is globally unique; project-scoping stays).

### 2. Preserve immediate-view where it exists — `showLatestInline`

The inspection page's primary job is **seeing the certificate immediately**; a
list-only panel would regress that. So the panel gains `showLatestInline`: when
true and the newest report exists, it renders that report's signed URL in an
inline iframe **above** the version list. Sections without an inline viewer today
(snag visit, valuation) use the default (`false`) — list only.

This lets "replace" preserve the inspection viewer while still adding history +
Delete, and gives snag/valuation a strict upgrade (they gain in-app Preview +
Delete they never had).

### 3. Per-section replacement

For each section, swap the bespoke report block for:
```tsx
<SavedReportsPanel
  projectId={projectId}
  kind={'<kind>'}
  source={{ table: '<source_table>', id: '<entityId>' }}
  reports={savedReports}        // server-loaded via listProjectReportsAction(..., source)
  canManage={canManageReports}  // requireRole(ORG_WRITE_ROLES)
  showLatestInline={<true for inspection, false otherwise>}
/>
```
- **Inspection** (`inspections/[inspectionId]/report/page.tsx`): replace the
  inline-iframe + Download block with the panel (`showLatestInline`). **Keep** the
  `RegenerateButton` and the certified/not-certified empty-state messaging — report
  *creation* is unchanged.
- **Snag visit**: replace the "Last exported · re-download" banner with the panel
  (list mode). **Keep** the existing Export/Generate action that creates the report.
- **Valuation**: replace the latest-report download with the panel (list mode).
  Keep the report-generation action.

**Invariant:** Phase 2 only changes how saved reports are *displayed/managed*. The
Generate / Regenerate / Export flows that *create* reports are untouched.

### 4. Authz & preview

- Delete = `ORG_WRITE_ROLES` (already enforced in `deleteProjectReportAction`); the
  page computes `canManage` via `requireRole`.
- Preview/inline use cross-origin Supabase signed URLs → frame cleanly (no
  X-Frame-Options issue). Same TTL/flow as Phase 1.

## Testing (TDD)

- Extend `project-reports.actions.test.ts`: `listProjectReportsAction` with `source`
  adds `source_table`/`source_id` filters; without `source` is unchanged.
- Extend `SavedReportsPanel.test.tsx`: `showLatestInline` renders the newest
  report's iframe inline; default does not; source-scoped delete refreshes.
- Each section page edit verified by the full web suite + type-check; the
  report-creation flows keep their existing tests.

## Out of scope

- Phase 3 (project-level Reports hub aggregating all kinds + GCR adapter).
- GCR (separate table; joins via the hub adapter in Phase 3).
- Any change to report generation/branding.

## Open item to confirm at implementation

- Exact valuation report display surface and the entity id available there
  (`valuation.actions.ts` is the data seam; the display component will be read and
  replaced in its task).
