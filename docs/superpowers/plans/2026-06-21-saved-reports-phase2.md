# Saved Reports — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Reuse `SavedReportsPanel` for the per-entity sections (inspection · snag visit · valuation): managed saved-report history with in-app Preview, Download, Delete.

**Architecture:** Extend the Phase-1 spine with optional `source` (source_table/source_id) scoping and an optional self-loading mode (the panel fetches its own rows when not server-fed, needed for client-component hosts like `CertifyBar`/`VisitDetail`). Then wire the panel into each section. Report *generation* is untouched.

**Tech Stack:** Next.js App Router, Supabase, React 19, Vitest + Testing Library.

**Refinement vs spec:** drop `showLatestInline`; inspection keeps its existing inline iframe and gains the panel below (no regression, simpler panel).

**Run tests:** `pnpm --filter web exec vitest run <path>`

---

### Task 1: `listProjectReportsAction` optional `source` scoping

**Files:** Modify `apps/web/src/actions/project-reports.actions.ts`; Test `…/project-reports.actions.test.ts`

- [ ] Step 1 — failing test: append a describe that, with `source = { table:'inspections', id:'i1' }`, the list query also filters `source_table`/`source_id`; without `source`, behaviour is unchanged.
- [ ] Step 2 — run red.
- [ ] Step 3 — implement: add 3rd param `source?: { table: string; id: string }`; when present, chain `.eq('source_table', source.table).eq('source_id', source.id)` before `.order(...)`. Signature: `listProjectReportsAction(projectId, kind, source?)`.
- [ ] Step 4 — run green.
- [ ] Step 5 — commit `feat(reports): optional source scoping on listProjectReportsAction`.

Mock note: the test's `eq2` (kind) currently returns `{ in, maybeSingle }`; for source, `in(status)` must chain to two more `.eq` then `.order`. Update the mock so `inFn` returns `{ order, eq: srcEq1 }`, `srcEq1` returns `{ eq: srcEq2 }`, `srcEq2` returns `{ order }`.

---

### Task 2: `SavedReportsPanel` — `source`, optional `reports` (self-load), `canManage` default

**Files:** Modify `apps/web/src/components/reports/SavedReportsPanel.tsx`; Test `…/SavedReportsPanel.test.tsx`

New props:
```ts
interface Props {
  projectId: string
  kind: string
  source?: { table: string; id: string }
  reports?: ProjectReportRow[]   // omitted ⇒ self-load on mount/source change
  canManage?: boolean            // default true; deleteProjectReportAction is the real gate
  title?: string
}
```
Behaviour:
- `rows` state initialised to `reports ?? null` (null ⇒ loading).
- `useEffect([projectId, kind, source?.table, source?.id])`: if `reports` is undefined, call `listProjectReportsAction(projectId, kind, source)` and set `rows` (`[]` on error/`{error}`).
- After delete: if self-loading, re-fetch the list; else `router.refresh()` (server-fed).
- `canManage` defaults to `true`.

- [ ] Step 1 — failing tests: (a) with `reports` omitted, the panel calls `listProjectReportsAction(projectId, kind, source)` and renders returned rows; (b) `canManage` defaults to showing Delete; (c) existing server-fed tests still pass.
- [ ] Step 2 — run red.
- [ ] Step 3 — implement the prop/self-load changes (mock `listProjectReportsAction` in the test alongside getUrl/delete).
- [ ] Step 4 — run green.
- [ ] Step 5 — commit `feat(reports): SavedReportsPanel source scoping + self-load`.

---

### Task 3: Inspection — add entity-scoped panel below the cert viewer

**Files:** Modify `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx`

Keep the existing inline iframe of the latest report and the `RegenerateButton`. Below the iframe block, add:
```tsx
const reportsRes = await listProjectReportsAction(projectId, 'inspection', { table: 'inspections', id: inspectionId })
const savedReports = Array.isArray(reportsRes) ? reportsRes : []
const canManage = (await requireRole(supabase, /* orgId */, ORG_WRITE_ROLES)).ok
// …render below the iframe/empty-state block:
<div style={{ marginTop: 16 }}>
  <SavedReportsPanel projectId={projectId} kind="inspection"
    source={{ table: 'inspections', id: inspectionId }}
    reports={savedReports} canManage={canManage} title="Report history" />
</div>
```
orgId: read from the inspection's project (the page already has `supabase`; resolve org via `projectService.getById` or the existing project query). Remove the now-duplicate bespoke Download anchor (the panel provides Download) — keep Regenerate.

- [ ] Step 1 — make edits.
- [ ] Step 2 — `pnpm --filter web exec tsc --noEmit` filtered to the file → no new errors.
- [ ] Step 3 — commit `feat(inspections): report history panel`.

---

### Task 4: Snag visit — replace the lastExported banner with the panel

**Files:** Read then modify `apps/web/src/app/(admin)/projects/[id]/snags/visits/[visitId]/page.tsx` and `_components/VisitDetail.tsx`

Approach: the visit page (server) already computes `lastExported`. Replace that with a server-loaded `savedReports` (via `listProjectReportsAction(projectId, 'snag', { table:'snag_visits', id: visitId })`) + `canManage`, pass both to `VisitDetail`, and in `VisitDetail` swap the "Last exported · re-download" banner JSX for:
```tsx
<SavedReportsPanel projectId={projectId} kind="snag" source={{ table:'snag_visits', id: visitId }} reports={savedReports} canManage={canManage} title="Saved reports" />
```
Keep the existing Export/Generate control that creates the report. Drop the now-unused `lastExported` plumbing.

- [ ] Step 1 — read both files; make edits.
- [ ] Step 2 — tsc filtered to the two files → no new errors; run any existing VisitDetail test.
- [ ] Step 3 — commit `feat(snags): visit report panel replaces export banner`.

---

### Task 5: Valuation — replace CertifyBar report download with the panel

**Files:** Read then modify `apps/web/src/app/(admin)/projects/[id]/settings/valuations/_components/CertifyBar.tsx`

`CertifyBar` is a client component with `getValuationReportUrlAction`. Replace its report-download UI with the **self-loading** panel (client context):
```tsx
<SavedReportsPanel projectId={projectId} kind="valuation" source={{ table:'valuations', id: valuation.id }} title="Saved reports" />
```
(no `reports` prop ⇒ self-loads; `canManage` defaults true, server action gates delete). Keep the certify action. Remove the now-unused `getValuationReportUrlAction` import/handler if nothing else uses it.

- [ ] Step 1 — read CertifyBar; make edits.
- [ ] Step 2 — tsc filtered to the file → no new errors; run ValuationsList/CertifyBar tests if present.
- [ ] Step 3 — commit `feat(valuations): report panel replaces CertifyBar download`.

---

### Task 6: Full verification

- [ ] `pnpm --filter web test` → all pass.
- [ ] `pnpm --filter web exec tsc --noEmit` → no new errors in touched files.
- [ ] Commit any test updates; then finishing-a-development-branch → PR.

## Out of scope
Phase 3 (project-level Reports hub + GCR adapter); report generation changes.
