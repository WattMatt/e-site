# Inspection Certificate — Export, Save & Handover Auto-File

**Date:** 2026-06-08
**Status:** Approved (design) — ready for implementation plan
**Author:** Arno + Claude
**Related:** `2026-06-03-inspection-report-export-design.md` (this is Phase 2 + the handover slice of Phase 3), PR #38 (report engine), PR #39 (Phase 1 parity surface), PR #41 (`exportSnagVisitReportAction` reference pattern)

---

## 1. Problem

Three "documents" exist in the inspection domain and they are wired together poorly:

1. **In-inspection uploads** — `file`-type template fields ("attach the data sheet / sub-component cert"). Stored in the `inspection-attachments` bucket, row in `inspections.photos` (filename in `caption`). Rendered as report annexures (`source: 'attachment'`).
2. **The inspection report PDF** — Phase 1 (PR #39) built the new branded react-pdf engine + a preview route, but it **saves nothing**. There is no `exportInspectionReportAction`. Preview-only.
3. **The handover pack** — `tenants.handover_folders` (tree, 13 SANS categories) + `tenants.documents`, files in `project-documents`, browsable at `/projects/[id]/handover/documents`.

Current relationships are wrong or absent:

- **Inspection → handover** exists *only* through the **legacy** `render-inspection-pdf` edge function (invoked best-effort on certify), which writes `inspections.certificates` and auto-files into handover. **That engine 500s on real glyphs (✓/✗/Ω) and is slated for retirement** — so the only working link is on a doomed engine.
- **Report → handover** is currently *backwards*: the new gatherer **pulls** every project-wide `compliance_certs`/`test_certificates` doc and lists them as annexures in *every* report.
- **In-inspection uploads → handover**: no link at all.

## 2. Goal

Make **certify** the single moment that renders, saves, versions, and distributes the inspection certificate on the new engine, files the certificate and its supporting uploads into the handover pack, and retire the legacy edge function from the certify path.

## 3. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Save trigger & authority | **Certify = save.** Certifying renders + saves the new report to `projects.reports`; that PDF becomes THE certificate. The `render-inspection-pdf` invoke is removed from certify. |
| D2 | In-inspection uploads ↔ handover | **Auto-file.** Each `file`-type upload is copied into the handover pack and still referenced in the report. |
| D3 | Report ↔ handover | **Auto-file into a single fixed category** (not routed by deliverable type). |
| D4 | Handover categories | **Report → `compliance_certs`; uploads → `test_certificates`.** (Official certificate vs supporting evidence.) |
| D5 | Report annexures | **Only the inspection's own uploads.** Drop the project-wide handover pull — the push replaces the pull. |
| D6 | Failure handling | **Resilient, surfaced-best-effort** (see §5). Certification is a DB fact; the PDF is a regenerable artifact. |
| D7 | Provenance/dedup | Add `source_table` + `source_id` to `tenants.documents` so auto-filed docs are traceable and idempotently replaceable on re-issue. |

## 4. Architecture

### 4.1 New certify flow

`certifyInspectionAction` (`apps/web/src/actions/inspections-certify.actions.ts`):

1. *(unchanged)* validate → role gate → allocate `coc_number` → set `status='certified'`, `certified_at`
2. **(new)** call `exportInspectionReportAction(inspectionId, projectId)` internally
3. **(removed)** `supabase.functions.invoke('render-inspection-pdf', …)`

If step 2 fails, certification still succeeds; the action returns `{ certified: true, reportError }`. The report page exposes a **Regenerate certificate** action that re-runs the export.

### 4.2 `exportInspectionReportAction` (new)

New action mirroring `exportSnagVisitReportAction` (`apps/web/src/actions/snag-visit.actions.ts`, the reference flow):

1. Parse + validate ids; gate to the same role that may certify; cross-project guard (`inspection.project_id === projectId`).
2. `gatherInspectionReportData(inspectionId)` → `renderInspectionReport(data, branding)` → `Buffer` (Node runtime).
3. Find prior issued report for `(source_table='inspections', source_id=inspectionId, status='issued')`, highest version → `newVersion = prior ? prior.version + 1 : 1`.
4. Upload to `reports` bucket at `{orgId}/{projectId}/inspection-{inspectionId}-v{newVersion}.pdf` (`upsert: false`).
5. Insert `projects.reports` row:
   - `kind='inspection'`, `source_table='inspections'`, `source_id=inspectionId`
   - `title` = template name + CoC number (e.g. `"Electrical Certificate of Compliance — COC-0001"`)
   - `version`, `branding_snapshot` (text/accent only, no embedded image bytes — same as snags), `generated_by`, `status='issued'`
   - On insert failure: best-effort remove the uploaded storage object, return error.
6. Supersede prior issued rows (`status='superseded'`, `superseded_by=newId`), non-blocking.
7. **Auto-file into handover** (§4.3).
8. `revalidatePath` the inspection report + handover document routes; return `{ reportId, storagePath }`.

Result type: `{ error: string } | { reportId: string; storagePath: string }`.

### 4.3 Auto-file into handover

New shared helper (in `packages/shared/src/services/handover/` or an app-layer action helper — implementation plan decides), signature roughly:

```
fileIntoHandover({ projectId, orgId, category, sourceBucket, sourcePath, name, mimeType, sourceTable, sourceId })
```

Behavior:
1. **Get-or-create** the category's root folder in `tenants.handover_folders` (idempotent), reusing the existing folder-template logic (`packages/shared/src/services/handover/folder-templates.ts`) so it works even if handover was never explicitly initialized. Sets `handover_folder_id` so the doc is visible in the folder-tree UI.
2. Copy the file from `sourceBucket/sourcePath` → `project-documents` at the handover path (mirrors `approveShopDrawingAction`, `apps/web/src/actions/node-order-shop-drawing.actions.ts`).
3. Insert a `tenants.documents` row: `category='handover'`, `handover_folder_id`, `handover_category`, `source_table`, `source_id`, `name`, `mime_type`, `storage_path`.

Applied on every export, AFTER the `projects.reports` row exists:
- **Report PDF** → `compliance_certs`. `sourceBucket='reports'`, `sourcePath=` the report's storage path. `source_id` = inspection id.
- **Each `file`-type upload** → `test_certificates`. Enumerate `inspections.photos` rows whose template field type is `file` (use the same field-type index the gatherer builds), `sourceBucket='inspection-attachments'`. `name` derived from the field label + original filename (idempotent prefix, like `buildHandoverDrawingName`). `source_id` = inspection id.
- **Photos are NOT auto-filed** — they remain inline evidence inside the report PDF.

**Dedup on re-issue:** before filing, delete prior auto-filed docs for `(source_table='inspections', source_id=inspectionId)` — remove their `project-documents` storage objects best-effort, then delete the `tenants.documents` rows — then re-create the full set. So re-certifying never duplicates the pack. (Certified inspections are effectively immutable today, so this is primarily a safety net for retries and any future revoke/re-issue.)

### 4.4 Report content change

In `inspection-report-data.ts`:
- **Remove** the handover-pull block (current lines ~204–218 — the `tenants.documents … .in('handover_category', HANDOVER_CATEGORIES)` query and the `handoverAnnexures` it builds).
- Remove the now-dead `HANDOVER_CATEGORIES` / `HANDOVER_BUCKET` constants if unused.
- Annexures are now only the inspection's own `file`-field uploads (`source: 'attachment'`), which the existing photo-vs-file routing already produces. The `ReportAnnexure.source === 'handover'` path is removed.

### 4.5 Viewing the certificate

`/report` page (`apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx`):
- Read the latest `status='issued'` `projects.reports` row for `(source_table='inspections', source_id=inspectionId)` instead of `inspections.certificates`.
- Signed URL from the `reports` bucket → iframe + download (same UX).
- Pre-certify viewing keeps using the existing preview route (`/api/projects/[id]/inspections/[inspectionId]/report-preview`) with the DRAFT watermark.
- If a certified inspection has no issued report row → show **Regenerate certificate** (calls `exportInspectionReportAction`).

### 4.6 Retire legacy from certify

- Drop the `render-inspection-pdf` invoke from `certifyInspectionAction`.
- Leave `inspections.certificates` and the deployed edge function in place but unused (prod has no real certified inspections, so nothing is stranded). Deleting the function code + table is a later cleanup, out of scope here.

## 5. Data model change

One additive migration (next free number, e.g. `00122`):

- `ALTER TABLE tenants.documents ADD COLUMN source_table TEXT, ADD COLUMN source_id UUID;`
- Partial index on `(source_table, source_id)` where `source_id IS NOT NULL`.
- No backfill (existing handover docs simply have null provenance). No RLS change (inherits existing `tenants.documents` policies). PostgREST only needs a `NOTIFY pgrst, 'reload schema'` (plain column add, no schema create/drop).

## 6. Failure handling (D6)

| Failure | Behavior |
|---------|----------|
| Render/save fails during certify | Inspection stays `certified`; action returns `reportError`; report page offers **Regenerate**. |
| `projects.reports` insert fails after upload | Best-effort delete the orphaned storage object; return error. |
| Supersede prior reports fails | Non-blocking (UI reads latest version). |
| Handover folder get-or-create / copy / insert fails | Non-blocking for the *certificate* (the `projects.reports` row already exists); log + surface a soft warning. Report save is the hard guarantee; handover filing is best-effort but retried by Regenerate. |
| Re-issue dedup delete fails | Log; proceed (worst case a stale duplicate in handover, visible and manually removable). |

## 7. Components & files

**New:**
- `apps/web/src/actions/inspection-report.actions.ts` (or extend an existing inspections action file) — `exportInspectionReportAction`
- handover filing helper — `fileIntoHandover` (+ get-or-create category folder)
- migration `apps/edge-functions/supabase/migrations/00122_documents_source_provenance.sql`
- DB smoke test `scripts/db/smoke-test-documents-provenance.sh`

**Modified:**
- `apps/web/src/actions/inspections-certify.actions.ts` — call export, remove edge invoke, resilient result
- `apps/web/src/lib/reports/inspection-report-data.ts` — drop handover pull (D5)
- `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx` — read `projects.reports`, Regenerate fallback

**Reference (read, don't change):**
- `apps/web/src/actions/snag-visit.actions.ts` — `exportSnagVisitReportAction` save/version/supersede pattern
- `apps/web/src/actions/node-order-shop-drawing.actions.ts` — `approveShopDrawingAction` copy-to-handover pattern
- `apps/edge-functions/supabase/migrations/00117_report_export_branding.sql` — `projects.reports` + `reports` bucket
- `apps/edge-functions/supabase/migrations/00045_handover_documents.sql` — handover tables

## 8. Testing & verification

- **Unit:** `exportInspectionReportAction` (render → save → version → supersede → file; orphan cleanup on insert failure); `fileIntoHandover` (folder get-or-create idempotency, copy, provenance insert, re-issue dedup); gatherer change (annexures = own uploads only, no handover pull); certify change (calls export, no edge invoke, resilient `reportError`).
- **DB smoke:** the provenance migration (column + index present, transactional, ROLLBACK-safe).
- **Deploy-verify the render on prod** — mandatory (react-pdf needs `apps/web` on React 19 under Next 15; preview unit tests use clean React 18 and don't prove the real render). Reuse the isolated-fixture recipe from the snag report verification (throwaway org/project + temp user + seeded inspection with a `file` upload → certify → confirm: `projects.reports` row issued, PDF in `reports` bucket, report doc in `compliance_certs`, upload in `test_certificates`, provenance set → full teardown).

## 9. Out of scope

PR-Eng qualification gate, revoke/share workflow, cloud-mirror of auto-filed docs, photos → handover, deleting the legacy edge-function code + `inspections.certificates` table. These remain in the later regulated-cutover bucket.

## 10. Open questions

None — D1–D7 resolved.
