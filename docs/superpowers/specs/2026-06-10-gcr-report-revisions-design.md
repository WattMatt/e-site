# Generator Cost-Recovery — Saved Report Revisions (design)

**Date:** 2026-06-10
**Status:** Approved (user confirmed: immutable revisions, generation lives on a Reports tab, viewer is a centered modal)

## Goal

Generating a generator cost-recovery report must produce a **saved, numbered revision** (Rev 1, 2, 3…) persisted in the database and storage, viewable **in-app in a contained viewer window**, and **downloadable** — with all existing branding (org logo, client logo, project mark, accents) intact.

## What already exists (reused, not rebuilt)

- **Rendering + branding:** `gatherGeneratorReportData` → `resolveBranding` → `renderGeneratorReport` (the `report-preview` route). Branding is fully resolved there today.
- **Storage:** private `reports` bucket (00117) — PDF-only, 50 MiB, path convention `{org_id}/{project_id}/…`, org-scoped object RLS. Service-role writes; "role-level write authorization lives at the action layer" (00117 comment).
- **Revisions pattern:** `structure.tenant_document_revisions` (00118) — table shape, RLS shape, and signed-URL download via server action.

## Data model — migration 00127

`gcr.report_revisions`:

| column | type | notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| project_id | uuid NOT NULL → projects.projects ON DELETE CASCADE | |
| organisation_id | uuid NOT NULL → public.organisations | |
| revision_number | integer NOT NULL | `UNIQUE (project_id, revision_number)`; monotonically assigned 1,2,3… |
| storage_path | text NOT NULL | `{org_id}/{project_id}/generator-cost-recovery/rev-{N}-{ts}.pdf` in the `reports` bucket |
| file_name | text NOT NULL | download filename, e.g. `{project-slug}-generator-cost-recovery-rev{N}.pdf` |
| note | text NULL | optional user note (future) |
| summary | jsonb NULL | headline numbers for the list: `{ monthlyCapitalRepayment, finalTariff, totalCapitalCost, tenantCount }` |
| created_by | uuid NULL → auth.users | |
| created_at | timestamptz NOT NULL default now() | |

RLS (hardened after adversarial review): SELECT via `user_has_project_access(project_id) AND NOT user_is_client_viewer(organisation_id)` — the summary jsonb holds cost figures that must never reach the client portal (00118 pattern). Writes are project- and role-scoped via `user_can_manage_project(project_id)`, with `organisation_id` pinned to the project's actual org (blocks cross-org row injection). **No UPDATE policy and UPDATE revoked** — revisions are immutable at the DB layer: generate appends, delete removes, nothing edits. Explicit grants to authenticated/service_role (00118 convention).

## Generation — POST `/api/projects/[id]/generator-cost-recovery/reports`

Node runtime, mirrors the proven `report-preview` gate order:

1. Auth (401) → project row (404) → seat gate `has_feature_seat` (402 with unlockPath).
2. `gatherGeneratorReportData` (RBAC inside; now also returns `readinessGaps: string[]` computed via `checkReadiness` from the rows it already fetches). Gaps present → **422 + gaps** (a saved revision is a deliverable; the permissive no-save preview route is unchanged).
3. Branding built by a **shared helper** (`buildGcrBrandingInput`) extracted from the preview route and used by both.
4. Render → upload PDF to `reports` bucket (service client) → insert revision row with `max(revision_number)+1` (retry once on unique-violation race) → return the row. Insert failure ⇒ best-effort storage cleanup.

## Access — server actions (`gcr-reports.actions.ts`)

- `listGcrReportRevisionsAction(projectId)` — COST_VIEW role gate; newest-first.
- `getGcrReportUrlAction(projectId, revisionId, { download? })` — role + seat gate; verifies the revision belongs to the project; returns a 10-min signed URL (`download: file_name` for attachment disposition, omitted for inline view).
- `deleteGcrReportRevisionAction(projectId, revisionId)` — ORG_WRITE_ROLES, project-scoped; deletes row then best-effort storage object.

## UI — new **Reports** tab in `GcrTabs`

- **ReportsPanel:** revision list (Rev N in mono/amber, date, creator-less for now, summary numbers, file name) with per-row **View**, **Download**, **Delete** (confirm). Header: **Generate report** (primary; disabled with gap list when `checkReadiness` fails — computed from the data GcrTabs already holds) and a secondary **Preview draft** link to the existing preview route.
- **ReportViewerModal:** centered overlay (≈ min(90vw, 880px) × 90vh), header = title + rev label + Download + Close, body = `<iframe>` of the inline signed URL. This is the "containerized in-app view window".
- `page.tsx` loads revisions server-side and passes them down; mutations call `router.refresh()`.
- **TenantsPanel:** the readiness card keeps its gap list, but its old "Generate report" anchor becomes a "Go to Reports" button (tab switch via callback from GcrTabs). One home for report generation.

## Testing

- `gcr-reports.actions.test.ts` — list/url/delete: gates enforced, cross-project revision id rejected, signed-URL params (mock supabase per `gcr.actions.test.ts` conventions).
- `ReportsPanel.test.tsx` — renders revisions; Generate disabled when not ready (gaps shown); View opens modal with iframe; Download invokes URL action with download flag (mock actions per `SettingsForm.test.tsx` conventions).
- `render-generator.test.ts` fixture gains `readinessGaps: []`.
- Migration validated by CI (`Validate DB Migrations`) and the deploy pipeline.

## Out of scope

Editable narrative (#5), figure upload (#6), client-portal visibility of saved reports, retention limits.
