# QC Reports — production hardening + world-class capabilities

**Date:** 2026-07-28
**Status:** approved (user-confirmed decisions below)
**Context:** A leave-nothing-assumed production-readiness review of the shipped QC feature returned
"ship-with-caveats — functional, not world-class": 5 confirmed defects + a set of capability gaps.
This spec fixes the defects and adds the confirmed world-class capabilities.

## Confirmed decisions
1. **Conformance model = Pass / Fail / N-A + severity.** Each QC entry carries a required
   `conformance` status (`pass` | `fail` | `na`); a `fail` also carries a `severity`
   (`minor` | `major` | `critical`). Report renders a conformance tally + a defect punch-list.
2. **Closed reports stay client-visible, read-only "Archived".** Client portal shows both `issued`
   and `closed` reports; closed ones get an "Archived" badge and the PDF stays downloadable.

## Migration `00176_qc_conformance_and_hardening.sql` (00169 header convention; NOTIFY pgrst at end)

1. **Conformance columns on `projects.qc_entries`:**
   - `conformance TEXT NOT NULL DEFAULT 'na' CHECK (conformance IN ('pass','fail','na'))`
     (default 'na' so existing rows are valid; new entries require an explicit choice at the app layer).
   - `severity TEXT NULL CHECK (severity IS NULL OR severity IN ('minor','major','critical'))`
     — named CHECK; app enforces "severity present iff conformance='fail'".
   - Index `(report_id, conformance)` for the report-level tally / filter.
2. **Defect S1 — bind org/project in RLS write policies.** Rewrite the INSERT/UPDATE `WITH CHECK`
   on `qc_reports` to add `AND organisation_id = (SELECT p.organisation_id FROM projects.projects p
   WHERE p.id = project_id)`. On `qc_entries`/`qc_entry_photos` INSERT/UPDATE, bind the denormalised
   `project_id` and `organisation_id` to the parent report's real values (subselect). Idempotent
   DROP POLICY IF EXISTS + CREATE; keep the effective-role role checks unchanged.
3. **Defect S2 — indexes.** `CREATE INDEX IF NOT EXISTS` on `qc_entries(project_id)` and
   `qc_entry_photos(project_id)`.
4. **Portal decision 2 — closed visibility.** Rewrite the `qc_reports` SELECT client_viewer clause
   to `status IN ('issued','closed')` (was `status='issued'`). Child SELECT policies inherit via the
   parent EXISTS — verify they re-derive the same rule. Drafts stay hidden.
5. **Comment notifications — new bell type.** Extend `notifications_type_check` (00173 pattern:
   DROP + re-ADD the full enum) to add `'qc_comment'`.

## Shared (`packages/shared`)
- `src/schemas/qc.schema.ts`: `addQcEntrySchema`/new `updateQcEntrySchema` gain
  `conformance: z.enum(['pass','fail','na'])` and `severity: z.enum(['minor','major','critical']).optional()`
  with a `.superRefine` enforcing severity present ⇔ conformance==='fail'. Export
  `QC_CONFORMANCE`, `QC_SEVERITY` const arrays + label maps. `updateQcEntrySchema { entryId, title,
  description, conformance, severity? }`.
- `src/services/qc.service.ts`: `addEntry` accepts conformance/severity; new
  `updateEntry(client, { entryId, title, description, conformance, severity })`;
  `listEntriesWithPhotos` selects conformance/severity. Keep the `(client as any).schema('projects')`
  cast idiom; do NOT regenerate types.ts.
- `src/types/index.ts`: `QcConformance`/`QcSeverity` types if useful.

## Actions (`apps/web/src/actions/qc.actions.ts`)
- **Defect B2** — `issueQcReportAction` final flip becomes atomic:
  `.update({status:'issued',...}).eq('id',reportId).neq('status','closed').select('id').maybeSingle()`
  → 0 rows ⇒ return error "Report was closed — reopen before issuing" and do NOT notify.
- **Empty-issue guard** — refuse issue when the report has 0 entries (checked before render).
- **B1 fix lives in qc-photos** (below); the action side: `updateQcReportAction`/entry/comment/delete
  already refuse closed reports — keep. Add `updateQcEntryAction({entryId,title,description,conformance,
  severity})` gated QC_WRITE_ROLES + closed-report freeze (loadQcReportForGate).
- **Comment notifications** — after `addQcCommentAction` insert succeeds, dispatch a `qc_comment`
  bell to the report roster minus the commenter (mirror rfi_response), route
  `/projects/{id}/quality-control/{reportId}`; best-effort/never-throw. (Email stays issue-only.)
- `addQcEntryAction` passes conformance/severity through.

## Markup persistence (`apps/web/src/lib/qc-photos.ts`)
- **Defect B1** — `replaceQcMarkup`: (a) gate on the parent report status server-side is not possible
  client-side, so instead make the write ORDER-SAFE: upload the new PNG to a **new** file_path
  (timestamped), update the row's `file_path` + `annotation_data` + `file_size_bytes`; only on
  successful row update remove the OLD object (best-effort). A failed row update leaves the original
  object + row intact (no destructive overwrite). If the row update is rejected (closed-report
  freeze), the new blob is cleaned up.
- **Downscale (S3)** — before the cap check in `uploadQcMarkup`/`replaceQcMarkup`, if the flattened
  PNG exceeds a threshold (~3 MB) downscale via a canvas to ≤ 3000px longest edge + re-encode PNG/JPEG
  (the editable SceneGraph is stored separately, so the raster is display-only/lossy-safe). Keep the
  20 MB hard cap as a final backstop with a clear error.

## PDF (`apps/web/src/lib/reports/qc-report-data.ts` + `qc-report.tsx`)
- Gatherer: select `conformance`/`severity`; compute a report-level tally (pass/fail/na counts +
  fail-by-severity). **Defect S4** — track within-cap photo download failures separately; render an
  "image unavailable" placeholder cell that PRESERVES the "Photo N" numbering (so per-photo comment
  references stay valid), and fold the count into the omitted note.
- Document: per-entry conformance badge (Pass green / Fail red / N-A grey) + severity chip on fails;
  a **conformance summary block** on/after the cover (tally) and a **defect punch-list** section
  (all fail entries with severity, location, title). **Draft watermark** — apply the existing
  `Watermark("DRAFT")` component when the report status !== 'issued' (preview route renders drafts).
- Report route: unchanged gating; ensure the tally/punch-list don't crash on 0 fails.

## Admin UI (`.../quality-control/`)
- `AddQcEntryForm.tsx`: add a conformance selector (Pass/Fail/N-A segmented control) + a severity
  select that appears only when Fail. Required. Thread into `addQcEntryAction`.
- New `EditQcEntryForm.tsx` (inline, mirrors EditQcReportForm): edit title/description/conformance/
  severity via `updateQcEntryAction`. Wire an edit toggle into `QcEntryCard` (canWrite && !closed).
- `QcEntryCard.tsx`: (a) render the conformance badge + severity chip; (b) **add "+ Add photos /
  markup" affordance** (canWrite && !closed) reusing PhotoPicker + QcMarkupDialog +
  uploadQcEntryPhotos/uploadQcMarkup against the existing entryId → router.refresh(); (c) accessible
  name on the photo-delete "✕" (`aria-label="Delete photo N"`) and the edit "✎".
- List `page.tsx`: add status filter (draft/issued/closed) + a text search (title/location) + keep
  report_no desc default; server-side via query params (mirror snags `?status=`/RFI `?filter=`).
  Broken signed-URL <img> → placeholder.
- `IssueReportButton` / `QcReportsSection`: disable Issue when entries.length === 0 (tooltip
  "Add at least one entry").
- Accessibility: `QcMarkupDialog` — Escape closes + focus trap + return focus; associate form
  labels with inputs (`htmlFor`/`id`) on new/edit forms; announce armed-delete state.

## Portal (`.../portal/[projectId]/quality-control/*`, `portal/data.ts`)
- `listPortalQcReports`: RLS now returns issued+closed; render a **status badge**
  (Issued = success, Archived = neutral) — the "Status" column becomes meaningful.
- `getPortalQcReportPdfUrlAction`: allow signing for issued OR closed (RLS already permits after the
  migration); keep the draft block.
- `DownloadPdfButton`: unchanged.

## Notifications deep-link fix (low)
- The `qc_issued` bell route for a client_viewer currently deep-links to an `(admin)` route that
  bounces to /portal. For `qc_comment` and `qc_issued`, when the recipient is a client_viewer the
  in-app bell should route to the portal path. (If per-recipient routing isn't supported by the bell
  dispatch, document it and at least ensure the admin route redirects cleanly — do not regress.)

## Tests (must fail on regression)
- `qc.actions.test.ts`: issue-empty refused; issue atomic-guard (closed-during-issue → error, no
  notify); updateQcEntryAction gate + closed-freeze; comment dispatches qc_comment bell.
- New `qc-report-data.test.ts`: gatherer photo/comment/cap logic + conformance tally + within-cap
  download-failure placeholder + Photo-N numbering stability.
- New `portal-qc.actions.test.ts`: signer allows issued+closed, blocks draft, blocks cross-project.
- `qc-photos.test.ts`: replaceQcMarkup safe-swap (row-fail leaves original intact) + downscale path;
  toSceneGraph already covered.
- `qc.schema.test.ts`: conformance/severity superRefine (severity iff fail).
- `qc-report.render.test.ts`: assert conformance badge, defect punch-list, draft watermark present;
  omitted/unavailable note.
- `qc-email` unchanged.

## Non-goals (v1)
- No entry/photo drag-reorder (low value; deferred).
- No per-recipient email digest.
- No mobile.
- Keep client-side markup persistence (no server action); no bodySizeLimit exposure.

## Verification
- Local: shared + web tests, type-check, lint, build all green.
- Adversarial review (RFI-path unchanged; new migration idempotent + policy-name-unique; conformance
  CHECK + defaults; org-binding subselects correct; portal closed-visibility no draft leak).
- Prod: seed project w/ PDF drawing; create report → entries with pass/fail+severity → conformance
  tally + punch-list in PDF → add-photo-to-existing-entry → edit-entry → comment fires bell →
  close → client portal shows Archived + downloadable PDF → issue-empty blocked. Zero-residue teardown.
