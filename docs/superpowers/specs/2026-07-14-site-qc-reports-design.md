# Site Quality Control Reports — design spec

**Date:** 2026-07-14
**Status:** approved for build
**Feature:** per-project Quality Control (QC) reports — a "Quality Control" tab that sits in the
project sidebar below Snags and above Site Diary. Works in principle like an RFI: users mark up
drawings and add photos; marked-up drawings and photos can be commented on per photo or per group
of photos; the QC report can be exported to PDF, saved (versioned), and is emailed to users
assigned to the project when issued.

## 1. Domain model

A **QC report** is a container (like a snag visit) holding ordered **entries**. An entry is a
group of photos and/or drawing markups with a title/description. **Comments** attach to an entry
(group-level) or to one specific photo within it. Issuing a report renders a branded PDF, saves it
as a version, and emails the project roster.

```
projects.qc_reports          1 ──< projects.qc_entries 1 ──< projects.qc_entry_photos
        │                                   │
        └───────────< projects.qc_comments >┘   (comment.photo_id nullable → group comment)
```

Report status: `draft → issued → closed`. Re-issuing after edits bumps the saved-PDF version
(supersede pattern from `projects.reports`).

## 2. DB — migration `00172_qc_reports.sql`

Follow the 00169 header convention; end with `NOTIFY pgrst, 'reload schema';`. New tables in the
existing exposed `projects` schema → NOTIFY only, no PostgREST db_schema PATCH. Grants: mirror
what sibling `projects.*` tables need (check 00117/00120 — `projects` schema tables rely on the
schema-level default privileges; verify and mirror).

### Tables

- `projects.qc_reports` — `id uuid PK default gen_random_uuid()`, `project_id` FK
  `projects.projects` ON DELETE CASCADE NOT NULL, `organisation_id` FK `public.organisations` NOT
  NULL, `report_no INTEGER NOT NULL` (BEFORE INSERT trigger `qc_reports_ensure_no` — per-project
  MAX+1, mirror `field.snag_visits_ensure_no` from 00120), `title TEXT NOT NULL`, `description
  TEXT`, `location TEXT`, `inspection_date DATE`, `status TEXT NOT NULL DEFAULT 'draft' CHECK
  (status IN ('draft','issued','closed'))`, `raised_by` FK `public.profiles` NOT NULL, `issued_at
  timestamptz`, `issued_by` FK profiles, timestamps + `set_updated_at` trigger. `UNIQUE
  (project_id, report_no)`. Indexes: project, org, (project_id, status).
- `projects.qc_entries` — `id`, `report_id` FK qc_reports ON DELETE CASCADE NOT NULL,
  `organisation_id` NOT NULL, `project_id` NOT NULL (denormalised for RLS/storage symmetry),
  `title TEXT NOT NULL`, `description TEXT`, `sort_order INTEGER NOT NULL DEFAULT 0`, `created_by`
  FK profiles NOT NULL, timestamps + trigger. Index `(report_id, sort_order)`.
- `projects.qc_entry_photos` — `id`, `entry_id` FK qc_entries ON DELETE CASCADE NOT NULL,
  `organisation_id`, `project_id`, `file_path TEXT NOT NULL`, `file_name TEXT`, `mime_type TEXT`,
  `file_size_bytes BIGINT`, `caption TEXT`, `sort_order INTEGER NOT NULL DEFAULT 0`, `kind TEXT
  NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','markup'))`, `source_floor_plan_id` FK
  `tenants.floor_plans` ON DELETE SET NULL, `annotation_data JSONB` (vector scene for markup
  re-edit lineage; NULL for plain photos), `uploaded_by` FK profiles NOT NULL, `created_at`.
  Index `(entry_id, sort_order)`.
- `projects.qc_comments` — `id`, `report_id` FK qc_reports ON DELETE CASCADE NOT NULL, `entry_id`
  FK qc_entries ON DELETE CASCADE NOT NULL, `photo_id` FK qc_entry_photos ON DELETE CASCADE
  (nullable — NULL = comment on the whole entry/group), `body TEXT NOT NULL`, `created_by` FK
  profiles NOT NULL, `created_at`, `updated_at` + trigger. Index `(entry_id, created_at)`.
- `projects.project_settings` — add `notify_qc_email BOOLEAN NOT NULL DEFAULT true` (mirror 00147).

### RLS (modern per-verb pattern, 00169 style)

Write roles = `('owner','admin','project_manager','contractor')` — matches `MARKUP_WRITE_ROLES`;
inspector/supplier/client_viewer cannot write. Enforce with an inline join to
`public.user_organisations` (active row, role in list) — this makes RESTRICTIVE client_viewer
overlays unnecessary on these new tables (no other permissive write policy exists).

- `qc_reports` SELECT: `public.user_has_project_access(project_id) AND (NOT
  public.user_is_client_viewer(organisation_id) OR status = 'issued')` — **client viewers never
  see drafts, enforced at the DB.**
- `qc_reports` INSERT/UPDATE: org write-role join. DELETE: role IN ('owner','admin',
  'project_manager') only.
- `qc_entries`, `qc_entry_photos`, `qc_comments`: SELECT via EXISTS parent qc_reports (which
  re-applies the parent visibility incl. the client_viewer issued-only rule); INSERT/UPDATE/DELETE
  via EXISTS parent + write-role join.

### Storage buckets (dedicated, per feature requirement)

- **`qc-report-entries`** — private, 20 MiB (20971520), MIME `image/jpeg, image/png, image/webp,
  image/heic`. Holds entry photos and flattened markup PNGs. Path convention:
  `{org_id}/{project_id}/{report_id}/{entry_id}/{ts}-{i}.{ext}`.
- **`qc-reports`** — private, 50 MiB (52428800), MIME `application/pdf`. Holds generated report
  PDFs. Path: `{org_id}/{project_id}/qc-report-{report_id}-v{n}.pdf`.

Storage RLS: Pattern A (org-path — `(storage.foldername(name))[1] = ANY
(public.get_user_org_ids()::TEXT[])`) for SELECT/INSERT/UPDATE/DELETE `TO authenticated`, both
buckets, **plus** a RESTRICTIVE client_viewer write-block mirroring 00162 covering both buckets.

## 3. Shared package (`packages/shared`)

- `src/types/index.ts`: `export const QC_WRITE_ROLES: readonly OrgRole[] = ['owner','admin',
  'project_manager','contractor']`; `export type QcReportStatus = 'draft' | 'issued' | 'closed'`.
- `src/schemas/qc.schema.ts` (+ test): `createQcReportSchema` `{ projectId uuid, title 2..300,
  description ≤10000 opt, location ≤500 opt, inspectionDate /^\d{4}-\d{2}-\d{2}$/ opt }`;
  `updateQcReportSchema` (partial + reportId); `addQcEntrySchema` `{ reportId uuid, title 1..300,
  description ≤5000 opt }`; `addQcCommentSchema` `{ entryId uuid, photoId uuid opt, body 1..5000 }`.
  Export input types.
- `src/services/qc.service.ts` (+ test): `qcService.{ listByProject, getById, create, update,
  remove, addEntry, listEntriesWithPhotos, addComment }` — `.schema('projects')`, profile-name
  joins via the `_utils.ts` `fetchProfileMap` pattern (mirror diary/snag services; `as any` casts
  where generated types lack the new tables — do NOT regenerate types.ts).
- `src/email/qc-email.ts` (+ test): `renderQcIssuedEmail({ projectName, reportTitle, reportNo,
  issuerName, entryCount, photoCount, deepLink, pdfUrl })` returning `{ subject, html }` using the
  same `baseEmailTemplate`/escapeHtml conventions as `rfi-email.ts`; subject
  `QC Report issued: {reportTitle}`. Reuse `buildRfiEmailRecipients`. Export from `src/index.ts`.

## 4. Web app

### Server actions — `apps/web/src/actions/qc.actions.ts` (+ gate tests)

All lifecycle actions gate app-side with `requireEffectiveRole(supabase, projectId, ROLES)`
**before any write** (import role constants from `@esite/shared`, never hardcode) and write via
the **cookie/RLS client** except where noted:

- `createQcReportAction(input)` — QC_WRITE_ROLES; qcService.create; bell to roster
  (`resolveProjectRecipients` minus actor, type `qc_created`, route
  `/projects/{id}/quality-control/{reportId}`); revalidatePath.
- `updateQcReportAction(input)` — QC_WRITE_ROLES; blocked when status='closed'.
- `deleteQcReportAction(reportId)` — ORG_WRITE_ROLES; service client delete + best-effort storage
  cleanup (entry folder prefix in `qc-report-entries`, saved PDFs in `qc-reports`, and
  `projects.reports` kind='qc' rows).
- `addQcEntryAction({reportId, title, description})` — QC_WRITE_ROLES; returns `{entryId}`.
- `registerQcPhotoAction` is NOT needed — photo rows are inserted client-side under RLS (diary
  pattern) via the upload helper.
- `deleteQcEntryAction(entryId)` / `deleteQcPhotoAction(photoId)` / `deleteQcCommentAction(id)` —
  author OR ORG_WRITE_ROLES (diary delete pattern: RLS read for the gate, service client for the
  delete + storage cleanup).
- `addQcCommentAction({entryId, photoId?, body})` — QC_WRITE_ROLES; insert via RLS client.
- `closeQcReportAction(reportId)` — ORG_WRITE_ROLES; status='closed'.
- `issueQcReportAction(reportId)` — ORG_WRITE_ROLES. Renders the PDF (gather → react-pdf), uploads
  to `qc-reports` bucket `{org}/{project}/qc-report-{reportId}-v{n}.pdf` (`upsert:false`), inserts
  `projects.reports` row (kind='qc', source_table='qc_reports', source_id=reportId, versioned,
  status='issued'), supersedes prior issued rows, storage rollback on row-insert failure (exact
  snag-visit `exportSnagVisitReportAction` shape), then sets qc_reports.status='issued'
  (+issued_at/by), then fires `notifyQcIssued` (bell + roster email). Returns `{version}`.

### Photo/markup upload — `apps/web/src/lib/qc-photos.ts`

Client-direct (diary `uploadDiaryAttachments` pattern): compress images (copy the canonical
`compressImage` shape from `useFieldPhotos.ts` — 2048px, JPEG q0.85, EXIF baked, passthrough on
failure), upload to `qc-report-entries`, insert `projects.qc_entry_photos` row, orphan-blob
cleanup on row failure, `sort_order` continues from max+1. Also `uploadQcMarkup({blob,
annotationData, sourceFloorPlanId, ...})` → same but `kind:'markup'`, `annotation_data` stored.

### Drawing markup

Reuse the **attachments annotator**: `FloorPlanAttachDialog` + `FloorPlanAnnotator`
(`apps/web/src/components/attachments/`) — the dialog takes `projectId`, lists active floor plans
from the `drawings` bucket, and `onStage` yields `{blob, annotationData, sourceFloorPlanId,
previewUrl}`. QC wraps it: on stage → `uploadQcMarkup`. Do NOT touch MarkupCanvas or the RFI
annotation actions. Re-edit of a QC markup (v1): reopen `FloorPlanAttachDialog` with `initial`
built from the stored `annotation_data` (re-sign the source plan URL; fall back to frozen
`baseImage.signedUrl`), then replace blob + annotation_data on the same photo row (client-side
under RLS, mirroring `replaceAnnotation`).

### Pages (all under `apps/web/src/app/(admin)/projects/[id]/quality-control/`)

- `page.tsx` (server) — list of QC reports (status badge, report no, title, entry/photo counts,
  inspection date, raised-by name); role via `requireEffectiveRole(..., QC_WRITE_ROLES).ok` →
  `canWrite`; "New report" button when canWrite. Wrap the table query so a missing-table error
  (pre-migration deploy window) renders an empty state, not a crash.
- `new/page.tsx` (client) — react-hook-form + zodResolver(createQcReportSchema) → create action →
  push to detail.
- `[reportId]/page.tsx` (server) — header (title/status/meta/description), entries with photo
  grids (1h signed URLs from `qc-report-entries`), comment threads per entry (group comments +
  per-photo comments labelled with the photo thumbnail/name), `SavedReportsPanel kind="qc"
  source={{table:'qc_reports', id}}`, and client components:
  - `AddQcEntryForm` — title/description + `PhotoPicker` (multi-photo) + "Add drawing markup"
    (FloorPlanAttachDialog) → addQcEntryAction → uploads.
  - `QcCommentForm` — per entry, optional photo target selector.
  - `IssueReportButton` — calls issueQcReportAction, then opens the preview route; re-issue
    allowed (bumps version). Two-step armed confirm (house Safari pattern).
  - Delete affordances (two-step armed) for entry/photo/comment per gate rules.
- Sidebar: insert between Snags and Site Diary in `projectNav()`
  (`apps/web/src/components/layout/Sidebar.tsx`): `{ href: `/projects/${id}/quality-control`,
  label: 'Quality Control', Icon: ShieldCheck, exact: false }` + lucide import.

### PDF (clone the snag-visit stack)

- `apps/web/src/lib/reports/qc-report-data.ts` — `gatherQcReportData(supabase, projectId,
  reportId)`: cookie-client read of the report row **is the visibility gate** (RLS hides drafts
  from client viewers) + `requireEffectiveRole(supabase, projectId, ALL_PROJECT_ROLES)`; then
  service client for photos → data URIs (`MAX_PHOTOS_PER_ENTRY = 24` + omittedCount, copy the
  inspection cap), branding via `resolveBranding`.
- `apps/web/src/lib/reports/qc-report.tsx` — `QcReportDocument` + `renderQcReport`: Cover page
  (kicker "QUALITY CONTROL REPORT", title, projectLine) then per-entry cards `wrap={false}`:
  entry no/title, description, labelled photo grid (markups labelled "Drawing markup — {plan}"),
  comments block (author, date, body; per-photo comments reference the photo index), fixed
  RunningFooter with page X/Y.
- Preview route `apps/web/src/app/api/projects/[id]/quality-control/[reportId]/report/route.ts` —
  GET, `runtime='nodejs'`, `dynamic='force-dynamic'`; auth 401 → gather (gate inside) → `inline;
  filename="qc-report-{no}.pdf"`, `Cache-Control: no-store`. Gate-test the route (tenant-schedule
  parse route.test.ts pattern: 401 / 403 no-role / 200 PM, plus draft-invisible-to-client_viewer
  404).
- Patch `apps/web/src/actions/project-reports.actions.ts`: `bucketForKind(kind)` → `'qc'` ⇒
  `'qc-reports'`, else `'reports'`; use in download + delete actions.

### Email

- `apps/web/src/lib/qc-email.ts` — `notifyQcIssued({reportId, projectId, actorId})`: service
  client loads report + project + counts; gate `projectSettingsService.getNotificationConfig(svc,
  projectId).qcEmail`; 7-day signed URL for the just-saved PDF from `qc-reports`;
  `renderQcIssuedEmail`; fan out via `notifyEntityEvent` (bell type `qc_issued`, route
  `/projects/{id}/quality-control/{reportId}`; email to full roster). Never throws.
- Settings plumbing: `notify_qc_email` through `_project-settings-mappers.ts`,
  `project-settings.schema.ts` (`notifyQcEmail`, default true), `getNotificationConfig` →
  `qcEmail`, IntegrationsPanel toggle + page wiring (exact `notifySnagEmail` pattern).

### Portal (client_viewer read surface)

- `PortalProjectNav.tsx` TABS: `{ slug: 'quality-control', label: 'Quality Control' }` after
  'snags'.
- `(portal)/portal/[projectId]/quality-control/page.tsx` — read-only list of **issued** reports
  (RLS already enforces issued-only for client viewers; the page just renders what the user
  client returns) with report meta + a "Download PDF" per report via a portal-safe server action
  that RLS-reads the `projects.reports` kind='qc' row and signs from `qc-reports` (300s TTL,
  `download:` filename).

### docs/rbac-matrix.md (same PR, mandatory)

- Page rows: `/projects/[id]/quality-control` (+ `/new`, `/[reportId]`): W W W W | inspector R |
  supplier — | client_viewer R¹ (¹ portal only, issued reports only — DB-enforced).
- API row: `GET /api/projects/[id]/quality-control/[reportId]/report` — R for all project roles;
  client_viewer sees issued only (RLS).
- Server-actions subsection `### Quality control (qc.actions.ts)` documenting each action's gate.
- Portal row for `/portal/[projectId]/quality-control`.

## 5. Known-gap closures bundled in this PR

1. **Web unit tests absent from CI** — add `"test:ci": "vitest run --passWithNoTests"` to
   `apps/web/package.json` (turbo already defines the task). Separate commit.
2. **Deploy-window resilience** — QC pages degrade to an empty state pre-migration (code deploys
   via Vercel at merge; migration applies via deploy-migrations.yml in parallel).
3. Matrix "Known gaps" additions: storage Pattern-A allows non-write-role org members to PUT
   unreferenced blobs in qc buckets (platform-wide posture, documented not fixed here).

## 6. Explicit non-goals (v1)

- No mobile surface (mobile has no project tab bar; parity with other modules).
- No PDF email attachments (send-email edge fn has no attachment support; email carries a 7-day
  signed link — avoids an out-of-band edge-function deploy).
- No MarkupCanvas (full drawing-viewer) integration; the attachments annotator is the v1 markup
  surface.
- No org-level cross-project QC register.

## 7. Verification plan

1. Local: `pnpm --filter @esite/shared test`, `pnpm --filter web test`, `pnpm type-check`,
   `pnpm lint`, `pnpm build`.
2. PR → CI green → merge → Vercel deploy + deploy-migrations.yml auto-applies 00172 (never
   hand-apply — memory rule).
3. Prod verification with throwaway fixtures (probe org + project + probe admin whose email is
   `delivered@resend.dev` — Resend's accept-sink, so roster email is provable without emailing a
   real person): headless Playwright against www.e-site.live — sidebar position, create → entry →
   photo upload → group comment + photo comment → PDF preview geometry → issue (DB row, qc-reports
   object, version, status) → email dispatch confirmed via Resend API (key from Supabase edge
   secrets) → client_viewer probe sees issued-only + cannot write (REST probes) → full cleanup
   (org cascade + auth users + auth_events + storage).

## 8. Post-review amendments (2026-07-14, adversarial review round)

A 6-dimension multi-agent review confirmed 19 findings; all fixed on this branch. Semantics that
changed from the sections above:

- **Write RLS is effective-role based** (`user_effective_project_role`, 00171 idiom), not an org
  role join — per-project promotions work and writes are bound to project access.
- **Status transitions are DB-guarded**: a BEFORE UPDATE trigger restricts `status` changes to
  ORG_WRITE_ROLES effective role (service-role bypasses); child tables carry a closed-report
  freeze trigger (cable-schedule 00168 precedent).
- **Client viewers are storage-blocked from BOTH qc buckets for SELECT too** (drafts were
  otherwise listable/downloadable directly) — RESTRICTIVE policies; portal PDF delivery is
  service-signed after RLS row reads, so nothing user-facing changed.
- **`createQcReportAction` fires no notification** — drafts are private; issue is the notify
  moment (the spec'd create-time bell leaked draft titles to client viewers with a dead link).
- **Close requires `issued`** (a closed draft could otherwise reopen to `issued` with no PDF);
  **`reopenQcReportAction`** (ORG_WRITE_ROLES, closed→issued) added so closed isn't a dead end.
  Close/reopen flips are service-client + row-verified.
- **PDF entry cards paginate** (header-only `wrap={false}` + `minPresenceAhead`); the review
  reproduced silent clipping of photos ≥13 and the comments block under the old whole-card
  `wrap={false}` at high photo counts. Render test pins `Photo 24` + trailing comment presence.
- **Markup re-edit, report-metadata edit, close/reopen/delete UI** shipped (were gaps).
- **Photo ordering is one shared comparator** (`compareQcPhotos`: sort_order, created_at, id) so
  UI and PDF "Photo N" can never disagree.
- Issue button opens the preview tab in-gesture (`previewViaSignedUrl` pattern) to survive
  popup blockers.
