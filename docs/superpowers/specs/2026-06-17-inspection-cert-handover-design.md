# Inspection Certify → projects.reports + Handover Auto-File — Design

**Date:** 2026-06-17
**Status:** Approved design, pending spec review → implementation plan
**Origin:** Fresh re-implementation of the abandoned `feat/inspection-cert` branch (PR #52), which was too divergent from current main to rebase (no common merge base, colliding migration). The old branch is the reference blueprint; this re-applies its design onto today's code.

## Problem

Certifying an inspection is supposed to produce a saved, branded PDF and file it into the project handover pack. Today that path is **unreliable**: `certifyInspectionAction` best-effort-invokes the `render-inspection-pdf` **edge function** (errors swallowed), which uses the legacy renderer that 500s on the ✓/✗/Ω glyphs inspection reports use; the report page reads `inspections.certificates`, which is empty when the render failed. So certification often yields no saved report and no handover filing, with no signal.

## Goal & decisions

Make certification reliably: render the branded PDF via the **Node** renderer (no glyph bug), save it **versioned to the unified `projects.reports`** table (matching valuation/snag), **auto-file** the cert and its own file-uploads into handover with **origin provenance**, add a **Regenerate** action, and **retire the flaky edge invoke** from the certify path.

- **Approach:** full re-apply (user-approved).
- **Share-link / Revoke:** dropped for v1 (user-approved) — they're tied to the legacy `inspections.certificates` cert system; can be re-added on `projects.reports` later.
- **Validation/render reliability:** the Node renderer + Node `gatherInspectionReportData` are the source of truth (they already consume field-keyed signatures `section_id/field_id` and `pass_state='na'` from migrations 00136–00139).

## Current-state facts (today's main)

- `projects.reports` (migration 00117) exists with every needed column (`kind, source_table, source_id, title, storage_path, mime_type, size_bytes, status[issued|draft|superseded|revoked], version, superseded_by, branding_snapshot, generated_by`). PDFs live in the `reports` bucket (org-scoped paths). Valuation (`valuation.actions.ts:certifyValuationAction`) and snag-visit are the canonical save-to-`projects.reports` examples to mirror.
- Handover model: `tenants.handover_folders` (category roots: `(project_id, category, parent_folder_id IS NULL)`) + `tenants.documents` (handover columns present: `handover_folder_id`, `handover_category`, `category`). Filing = ensure category root → upload to `project-documents` bucket → insert `tenants.documents`. `HandoverCategory`/`CATEGORY_LABELS` exported from `@esite/shared`; targets `compliance_certs` + `test_certificates` exist. `tenants.documents` has **no** `origin_kind/origin_id` yet (net-new). The only working filing example is the local block in `node-order-shop-drawing.actions.ts`.
- `inspection-report-data.ts` (Node gatherer) + `render-inspection.ts` (react-pdf) render the report and correctly consume signatures (rows from `inspections.signatures` + images from `inspection-signatures` bucket) and pass_fail N/A. It still has a project-wide "8b handover annexures" pull to remove.
- `report/page.tsx` currently reads `inspections.certificates` + signs from `inspection-certificates` bucket, with ShareLink/Revoke and no Regenerate.

## Components (all net-new unless noted)

### 1. Migration `00140_documents_origin_provenance.sql`
```sql
ALTER TABLE tenants.documents
    ADD COLUMN origin_kind TEXT,   -- e.g. 'inspection'
    ADD COLUMN origin_id   UUID;   -- the inspections.inspections id
CREATE INDEX idx_documents_origin
    ON tenants.documents(origin_kind, origin_id)
    WHERE origin_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';
```
Records which E-Site entity caused a handover row (distinct from the existing `source_*` cloud-sync family). The partial index supports re-issue dedup. Renumbered from the old branch's `00124` (collides with GCR). `tenants` isn't in generated TS types — writes use `(client as any).schema('tenants')`, so no type regen.

### 2. `apps/web/src/lib/handover/handover-filing.ts` (new module, not `'use server'`)
- `ensureHandoverCategoryRoot(client, orgId, projectId, category, userId)` — moved **verbatim** out of `node-order-shop-drawing.actions.ts` (a `'use server'` file can't export it). Find-or-create on `tenants.handover_folders` keyed `(project_id, category, parent_folder_id IS NULL)`.
- `fileIntoHandover(client, opts)` where `opts = { orgId, projectId, category, name, bytes, mimeType, originKind, originId, userId }` → ensure root → upload bytes to `project-documents` at `${org}/${projectId}/handover/${cleanFolderPath}/${Date.now()}-${safeName}` (`upsert:false`) → insert `tenants.documents` row (`category:'handover'`, `handover_folder_id`, `handover_category`, `origin_kind`, `origin_id`, `uploaded_by`); rollback the storage object if the row insert fails.
- Swap `node-order-shop-drawing.actions.ts` to import `ensureHandoverCategoryRoot` from this module (remove the local copy).

### 3. `apps/web/src/lib/reports/file-inspection-report.ts` (new worker, not `'use server'`, no auth gate — callers authorize)
`generateAndFileInspectionReport({ inspectionId, projectId, orgId, userId }) → { reportId, storagePath } | { error }`:
1. `gatherInspectionReportData(inspectionId)` → `resolveBranding` → `renderInspectionReport` → Buffer; build `branding_snapshot`.
2. Version: latest `projects.reports` where `source_table='inspections' AND source_id=inspectionId AND status='issued'` → `version = prior+1` else 1.
3. Upload to `reports` bucket `${orgId}/${projectId}/inspection-${inspectionId}-v${version}.pdf`.
4. Insert `projects.reports` (`kind:'inspection'`, `source_table:'inspections'`, `source_id`, `title`, `storage_path`, `mime_type`, `size_bytes`, `status:'issued'`, `version`, `branding_snapshot`, `generated_by`); rollback storage on failure.
5. Supersede prior issued rows for the same source (`status:'superseded', superseded_by:reportId`).
6. Dedup prior auto-filed handover docs: select `tenants.documents` where `origin_kind='inspection' AND origin_id=inspectionId`, remove their storage blobs, delete the rows.
7. `fileIntoHandover` the report PDF → `compliance_certs` (best-effort).
8. List the inspection's own file-uploads (top-level + subsection `file`-type template fields → `inspections.photos` rows by `field_id`), download each from `inspection-attachments`, `fileIntoHandover` → `test_certificates` (name via `buildHandoverDrawingName(label, filename)`). Group-nested file fields are **not** filed in v1.

All writes via `createServiceClient` (RLS-bypassing); strictly scoped by project/org/source.

### 4. `inspections-certify.actions.ts` — wire the worker
Replace the `supabase.functions.invoke('render-inspection-pdf', …)` block with a **best-effort** `generateAndFileInspectionReport({ inspectionId, projectId, orgId: insp.organisation_id, userId: user.id })`. Certification is a committed DB fact — log on `'error' in result` but still return the COC number; a render/file failure never blocks certification. Leave the downstream `validate-inspection` invoke (it reads `inspections.certificates`, no longer written) to no-op gracefully.

### 5. `apps/web/src/actions/inspection-report.actions.ts` (new `'use server'`)
`regenerateInspectionReportAction(inspectionId, projectId) → { error?, reportId? }`: Zod `tuple([uuid, uuid])` → `auth.getUser` → `projectService.getById` → `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` → **cross-project guard** (inspection's `project_id` must equal `projectId`) → worker → `revalidatePath` on the report page + `/handover/documents`. Manual fallback / re-issue (certify does it automatically).

### 6. `report/page.tsx` rewrite + `RegenerateButton.tsx` (new client)
Inspection row stays source of truth for COC/status; the PDF artifact becomes the latest issued `projects.reports` row (`source_table='inspections'`, highest version) signed from the `reports` bucket and shown in the existing `<iframe>` (the CSP fix in #83 already permits `https://*.supabase.co` in `frame-src`, so it renders). Add `RegenerateButton` (shown when certified; "Generate certificate" if no report yet, "↻ Regenerate" otherwise). **Remove** `ShareLinkButton`/`RevokeButton` for v1.

### 7. `inspection-report-data.ts` — annex only own uploads
Remove the "8b. Handover annexures" project-wide pull; delete the `HANDOVER_BUCKET`/`HANDOVER_CATEGORIES` constants; narrow `ReportAnnexure.source` to `'attachment'`; `annexures = attachmentAnnexures`. The report now annexes only its own uploads and is *pushed into* handover, instead of pulling handover into the report.

### 8. `docs/rbac-matrix.md`
Add `regenerateInspectionReportAction` → **W** for owner/admin/project_manager (`ORG_WRITE_ROLES`), requires `has_feature('inspections')`. Add the report-page read row (project roles, via `reports_select` RLS) with a note that the artifact source moved from `inspections.certificates` to `projects.reports` and that share/revoke are deferred.

## Verification

- Unit: `regenerateInspectionReportAction` cross-project guard (rejects mismatched project). Where feasible, a worker test stubbing the service client (version increment, supersede, dedup).
- Live (local stack + smoke inspection): certify → a `projects.reports` row `issued` + the PDF in the `reports` bucket + handover docs filed (cert → `compliance_certs`, file-uploads → `test_certificates`) each carrying `origin_kind='inspection'`/`origin_id`; the report page shows the PDF in the iframe (renders thanks to the #83 CSP fix); **Regenerate** bumps the version, supersedes the prior row, and re-files handover (dedup removes the prior origin-matched docs — verify no duplicates and no unrelated docs deleted).
- Confirm `allocate_coc_number` + certify status flow are unchanged; the retired edge function isn't invoked from certify.

## Adjustments vs the old branch
- Migration `00124` → **`00140`**.
- Re-verify the worker against inspections schema from 00136–00139 (field-keyed signatures, pass_fail N/A, `inspections.photos.field_id`, `templates.schema_json` shape) — the Node gatherer already handles these.

## Out of scope (v1)
- Share-link + Revoke (dropped; re-add on `projects.reports` later).
- Group-nested `file` fields auto-filing (top-level + subsection only).
- Deleting the `render-inspection-pdf` edge function (just retire it from the certify path; unused code can stay).

## Risks
- Touches the live certify flow — the cert DB commit stays independent of render/file (best-effort), so a render failure never blocks certification.
- Service-client writes bypass RLS — scope strictly by project/org/source.
- Handover dedup deletes prior origin-matched docs — the `origin_kind='inspection' AND origin_id=<id>` filter must be exact so unrelated handover docs are never touched.

## Delivery
Single feature PR. Migration 00140 auto-deploys via the deploy-migrations workflow; the rest is app code. Verify locally → PR → CI → merge → confirm migration + Vercel deploy.
