# Inspection Certificate — Export, Save & Handover Auto-File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make certifying an inspection render the branded report, save it versioned to `projects.reports`, and auto-file the certificate (→ `compliance_certs`) plus its in-inspection `file` uploads (→ `test_certificates`) into the handover pack — retiring the legacy `render-inspection-pdf` invoke.

**Architecture:** A gate-free worker `generateAndFileInspectionReport` (mirrors `exportSnagVisitReportAction`) is called directly by `certifyInspectionAction` (the verifier is already authorized) and by a thin role-gated `regenerateInspectionReportAction` fallback. A shared `fileIntoHandover` helper (extracting the existing `ensureHandoverCategoryRoot`) copies bytes into `project-documents` and writes a `tenants.documents` row tagged with new `origin_kind`/`origin_id` provenance columns for idempotent re-issue. The `/report` page reads `projects.reports` instead of the legacy `inspections.certificates`, and the gatherer stops pulling the project-wide handover pack into annexures.

**Tech Stack:** Next.js 15 (App Router, React 19), `@react-pdf/renderer` (Node runtime), Supabase (Postgres + Storage, service-role writes via `createServiceClient`), Zod, Vitest (jsdom + `vi.hoisted` mocks), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-06-08-inspection-certificate-handover-export-design.md`

---

## File Structure

**Create:**
- `apps/edge-functions/supabase/migrations/00122_documents_origin_provenance.sql` — adds `origin_kind` + `origin_id` to `tenants.documents` (auto-file provenance, distinct from the cloud-sync `source_*` family).
- `scripts/db/smoke-test-documents-origin.sh` — schema-presence smoke test (columns + index), ROLLBACK-safe / read-only.
- `apps/web/src/lib/handover/handover-filing.ts` — shared, non-`'use server'`: `ensureHandoverCategoryRoot` (moved verbatim) + new `fileIntoHandover`.
- `apps/web/src/lib/handover/handover-filing.test.ts`
- `apps/web/src/lib/reports/file-inspection-report.ts` — non-`'use server'` worker: `generateAndFileInspectionReport` + `listInspectionFileUploads`.
- `apps/web/src/lib/reports/file-inspection-report.test.ts`
- `apps/web/src/actions/inspection-report.actions.ts` — `'use server'`: `regenerateInspectionReportAction`.
- `apps/web/src/actions/inspection-report.actions.test.ts`
- `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RegenerateButton.tsx` — client component.

**Modify:**
- `apps/web/src/actions/node-order-shop-drawing.actions.ts` — import `ensureHandoverCategoryRoot` from the new module; delete the local copy.
- `apps/web/src/actions/inspections-certify.actions.ts` — replace the `render-inspection-pdf` invoke with a best-effort call to the worker.
- `apps/web/src/lib/reports/inspection-report-data.ts` — remove the handover-pull annexure block + its two constants (D5).
- `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx` — read `projects.reports`; add Regenerate fallback; drop Share/Revoke.
- `docs/rbac-matrix.md` — add the regenerate action row.

**Reference (read, do not change):**
- `apps/web/src/actions/snag-visit.actions.ts` (`exportSnagVisitReportAction`) — the save/version/supersede pattern.
- `apps/web/src/actions/node-order-shop-drawing.actions.ts` lines 400–436 — the copy-to-handover pattern.

---

## Task 1: Migration — `origin_kind` / `origin_id` provenance on `tenants.documents`

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00122_documents_origin_provenance.sql`
- Create: `scripts/db/smoke-test-documents-origin.sh`

Context: `tenants.documents` already has a `source_*` family (cloud-sync provenance, 00041). We add a **distinct** `origin_*` pair so auto-filed handover docs are traceable and idempotently replaceable on re-issue. The `tenants` schema is not in the generated TS types and all writes use `(client as any).schema('tenants')`, so **no `pnpm db:gen-types` is required**. This is a plain column add → only a `NOTIFY pgrst` is needed (no PostgREST `db_schema` PATCH).

- [ ] **Step 1: Write the migration file**

```sql
-- =============================================================================
-- Migration: 00122_documents_origin_provenance.sql
-- Description: Auto-file provenance for tenants.documents.
--
--   When a document is auto-filed into the handover pack by another subsystem
--   (e.g. an inspection certificate + its supporting uploads), we tag the row
--   with (origin_kind, origin_id) so the set can be found and replaced on
--   re-issue without creating duplicates.
--
--   DISTINCT from the existing source_* columns (00041), which record an
--   INBOUND cloud → E-Site sync. origin_* records WHICH E-Site entity caused
--   the row to exist.
--
--   Plain column add → no PostgREST db_schema PATCH; NOTIFY reload is enough.
-- =============================================================================

ALTER TABLE tenants.documents
    ADD COLUMN origin_kind TEXT,   -- e.g. 'inspection'
    ADD COLUMN origin_id   UUID;   -- e.g. the inspections.inspections id

-- Lookup for dedup-on-re-issue: "all docs auto-filed for inspection X".
CREATE INDEX idx_documents_origin
    ON tenants.documents(origin_kind, origin_id)
    WHERE origin_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the schema-presence smoke test**

```bash
#!/usr/bin/env bash
# Verifies migration 00122 applied: origin_kind/origin_id columns + index.
# Read-only (information_schema / pg_indexes) — no row writes, nothing to roll back.
set -euo pipefail
cd "$(dirname "$0")"
source ./mgmt-api.sh

echo "== columns =="
OUT="$(mgmt_query "
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='tenants' AND table_name='documents'
    AND column_name IN ('origin_kind','origin_id')
  ORDER BY column_name;" || true)"
echo "$OUT"
echo "$OUT" | grep -q "origin_id"   || { echo "FAIL: origin_id missing"; exit 1; }
echo "$OUT" | grep -q "origin_kind" || { echo "FAIL: origin_kind missing"; exit 1; }

echo "== index =="
OUT="$(mgmt_query "
  SELECT indexname FROM pg_indexes
  WHERE schemaname='tenants' AND tablename='documents'
    AND indexname='idx_documents_origin';" || true)"
echo "$OUT"
echo "$OUT" | grep -q "idx_documents_origin" || { echo "FAIL: idx_documents_origin missing"; exit 1; }

echo "PASS"
```

- [ ] **Step 3: Make the smoke test executable**

Run: `chmod +x scripts/db/smoke-test-documents-origin.sh`
Expected: no output, exit 0.

- [ ] **Step 4: Type-check (no DB apply yet)**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web type-check`
Expected: PASS (the migration is SQL; this just confirms nothing else broke). The migration applies on merge via `.github/workflows/deploy-migrations.yml`; the smoke test runs against prod in Task 8.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00122_documents_origin_provenance.sql scripts/db/smoke-test-documents-origin.sh
git commit -m "feat(db): origin provenance on tenants.documents for handover auto-file (00122)"
```

---

## Task 2: Shared handover-filing helper (`fileIntoHandover` + extract `ensureHandoverCategoryRoot`)

**Files:**
- Create: `apps/web/src/lib/handover/handover-filing.ts`
- Create: `apps/web/src/lib/handover/handover-filing.test.ts`
- Modify: `apps/web/src/actions/node-order-shop-drawing.actions.ts` (swap local fn for import)

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/handover/handover-filing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileIntoHandover } from './handover-filing'

// A minimal chainable Supabase-ish mock. Each .from() call returns an object
// whose terminal (.maybeSingle/.single) resolves a queued result.
function makeClient(opts: {
  existingRoot?: { id: string; folder_path: string; organisation_id: string } | null
  insertDoc?: { data: { id: string } | null; error: { message: string } | null }
  uploadError?: { message: string } | null
}) {
  const removed: string[][] = []
  const uploaded: Array<{ bucket: string; path: string }> = []
  const insertedRows: Record<string, unknown>[] = []

  const client = {
    schema: (_s: string) => ({
      from: (table: string) => ({
        // ensureHandoverCategoryRoot: select existing root
        select: () => ({
          eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: opts.existingRoot ?? null }) }) }) }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertedRows.push(row)
          return {
            select: () => ({
              single: async () =>
                table === 'handover_folders'
                  ? { data: { id: 'folder-1', folder_path: '/compliance_certs/Compliance Certificates', organisation_id: 'org-1' }, error: null }
                  : (opts.insertDoc ?? { data: { id: 'doc-1' }, error: null }),
            }),
          }
        },
        delete: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          if (opts.uploadError) return { error: opts.uploadError }
          uploaded.push({ bucket, path })
          return { error: null }
        },
        remove: async (paths: string[]) => { removed.push(paths); return { error: null } },
      }),
    },
  }
  return { client, removed, uploaded, insertedRows }
}

describe('fileIntoHandover', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('ensures the category root, uploads bytes, and inserts a documents row tagged with origin_*', async () => {
    const { client, uploaded, insertedRows } = makeClient({ existingRoot: null })
    const res = await fileIntoHandover(client as never, {
      orgId: 'org-1', projectId: 'proj-1', category: 'compliance_certs',
      name: 'Inspection Report COC-1.pdf', bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf', originKind: 'inspection', originId: 'insp-1', userId: 'user-1',
    })
    expect('documentId' in res && res.documentId).toBe('doc-1')
    expect(uploaded.some((u) => u.bucket === 'project-documents')).toBe(true)
    const docRow = insertedRows.find((r) => r.category === 'handover')!
    expect(docRow.origin_kind).toBe('inspection')
    expect(docRow.origin_id).toBe('insp-1')
    expect(docRow.handover_category).toBe('compliance_certs')
  })

  it('rolls back the uploaded blob when the documents insert fails', async () => {
    const { client, removed } = makeClient({
      existingRoot: { id: 'folder-1', folder_path: '/compliance_certs/x', organisation_id: 'org-1' },
      insertDoc: { data: null, error: { message: 'boom' } },
    })
    const res = await fileIntoHandover(client as never, {
      orgId: 'org-1', projectId: 'proj-1', category: 'compliance_certs',
      name: 'r.pdf', bytes: new Uint8Array([1]), mimeType: 'application/pdf',
      originKind: 'inspection', originId: 'insp-1', userId: 'user-1',
    })
    expect('error' in res).toBe(true)
    expect(removed.length).toBe(1) // blob removed
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/lib/handover/handover-filing.test.ts`
Expected: FAIL — `Cannot find module './handover-filing'`.

- [ ] **Step 3: Write the helper**

`apps/web/src/lib/handover/handover-filing.ts`:

```ts
/**
 * Shared handover-filing primitives.
 *
 * - ensureHandoverCategoryRoot: find-or-create a category's root folder.
 *   Moved verbatim from node-order-shop-drawing.actions.ts so it can be reused
 *   by the inspection report worker (a 'use server' file cannot export it).
 * - fileIntoHandover: copy bytes into project-documents at the handover path
 *   and insert a tenants.documents row, tagged with (origin_kind, origin_id).
 *
 * NOT a 'use server' module — callers pass an already-resolved client
 * (service-role for RLS-bypassing writes, or a cookie client where RLS allows).
 */
import { CATEGORY_LABELS, type HandoverCategory } from '@esite/shared'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = any

const HANDOVER_BUCKET = 'project-documents'

/** Find or create the category root handover folder; returns its id + path + org. */
export async function ensureHandoverCategoryRoot(
  client: AnyClient,
  orgId: string,
  projectId: string,
  category: HandoverCategory,
  userId: string,
): Promise<{ id: string; folder_path: string; organisation_id: string } | { error: string }> {
  const { data: existing } = await client
    .schema('tenants')
    .from('handover_folders')
    .select('id, folder_path, organisation_id')
    .eq('project_id', projectId)
    .eq('category', category)
    .is('parent_folder_id', null)
    .maybeSingle()
  if (existing) return existing as { id: string; folder_path: string; organisation_id: string }

  const { data: inserted, error } = await client
    .schema('tenants')
    .from('handover_folders')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      parent_folder_id: null,
      name: CATEGORY_LABELS[category],
      category,
      cloud_provider: null,
      cloud_folder_id: null,
      cloud_folder_path: null,
      cloud_synced_at: null,
      created_by: userId,
    })
    .select('id, folder_path, organisation_id')
    .single()
  if (error || !inserted) {
    return { error: `Failed to create handover folder: ${(error as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  return inserted as { id: string; folder_path: string; organisation_id: string }
}

export interface FileIntoHandoverOpts {
  orgId: string
  projectId: string
  category: HandoverCategory
  name: string
  bytes: Uint8Array
  mimeType: string | null
  originKind: string
  originId: string
  userId: string
}

/**
 * Copy bytes into the handover pack under `category` and record a
 * tenants.documents row. Best-effort rollback of the storage blob if the
 * row insert fails. Returns { documentId } or { error }.
 */
export async function fileIntoHandover(
  client: AnyClient,
  opts: FileIntoHandoverOpts,
): Promise<{ documentId: string } | { error: string }> {
  const folder = await ensureHandoverCategoryRoot(client, opts.orgId, opts.projectId, opts.category, opts.userId)
  if ('error' in folder) return folder

  const cleanFolderPath = (folder.folder_path || '').replace(/^\/+/, '').replace(/\/+/g, '/')
  const safeName = opts.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 200) || 'document'
  const handoverPath = `${folder.organisation_id}/${opts.projectId}/handover/${cleanFolderPath}/${Date.now()}-${safeName}`

  const { error: upErr } = await client.storage
    .from(HANDOVER_BUCKET)
    .upload(handoverPath, opts.bytes, { contentType: opts.mimeType || 'application/octet-stream', upsert: false })
  if (upErr) return { error: `Could not copy into handover: ${upErr.message}` }

  const { data: docRow, error: insErr } = await client
    .schema('tenants')
    .from('documents')
    .insert({
      organisation_id: folder.organisation_id,
      project_id: opts.projectId,
      name: safeName,
      category: 'handover',
      storage_path: handoverPath,
      mime_type: opts.mimeType,
      size_bytes: opts.bytes.byteLength,
      handover_folder_id: folder.id,
      handover_category: opts.category,
      origin_kind: opts.originKind,
      origin_id: opts.originId,
      uploaded_by: opts.userId,
    })
    .select('id')
    .single()
  if (insErr || !docRow) {
    await client.storage.from(HANDOVER_BUCKET).remove([handoverPath]).catch(() => undefined)
    return { error: `Handover document insert failed: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  return { documentId: (docRow as { id: string }).id }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/lib/handover/handover-filing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Swap the local `ensureHandoverCategoryRoot` for the import in the shop-drawing action**

In `apps/web/src/actions/node-order-shop-drawing.actions.ts`:

Add to the `@esite/shared` import (it already imports `CATEGORY_LABELS`) — add the new module import below the existing imports block (after line 30):

```ts
import { ensureHandoverCategoryRoot } from '@/lib/handover/handover-filing'
```

Then DELETE the entire local function definition (lines 222–259, the block starting with `/** Find or create the category root handover folder; ... */` and the `async function ensureHandoverCategoryRoot(...) { ... }` body). The call site at line 400 (`const folder = await ensureHandoverCategoryRoot(guard.supabase, guard.orgId, projectId, category, guard.user.id)`) is unchanged — it now resolves to the import.

Note: `CATEGORY_LABELS` may now be an unused import in this file (it was only used by the deleted function). If `pnpm --filter web type-check` / lint flags it, remove `CATEGORY_LABELS` from the `@esite/shared` import.

- [ ] **Step 6: Verify type-check + existing shop-drawing behavior unaffected**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web type-check`
Expected: PASS. (If `CATEGORY_LABELS` is now unused, remove it from the import per Step 5, then re-run.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/handover/handover-filing.ts apps/web/src/lib/handover/handover-filing.test.ts apps/web/src/actions/node-order-shop-drawing.actions.ts
git commit -m "feat(handover): extract ensureHandoverCategoryRoot + add fileIntoHandover helper"
```

---

## Task 3: The worker — `generateAndFileInspectionReport`

**Files:**
- Create: `apps/web/src/lib/reports/file-inspection-report.ts`
- Create: `apps/web/src/lib/reports/file-inspection-report.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/reports/file-inspection-report.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks (repo convention — see snag-visit.actions.test.ts) ──
const h = vi.hoisted(() => ({
  gather: vi.fn(),
  render: vi.fn(),
  resolveBranding: vi.fn(() => ({ accent: '#f5a623', issuer: { wordmark: 'WM' }, parties: [], title: 'Inspection & Test Report', kicker: 'ELECTRICAL INSPECTION', projectLine: 'Proj', footerStamp: 'x' })),
  fileIntoHandover: vi.fn(async () => ({ documentId: 'doc-x' })),
  serviceClient: null as any,
}))

vi.mock('./inspection-report-data', () => ({ gatherInspectionReportData: h.gather }))
vi.mock('./render-inspection', () => ({ renderInspectionReport: h.render }))
vi.mock('./branding', () => ({ resolveBranding: h.resolveBranding }))
vi.mock('@/lib/handover/handover-filing', () => ({ fileIntoHandover: h.fileIntoHandover }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => h.serviceClient }))
vi.mock('@esite/shared', () => ({ buildHandoverDrawingName: (l: string, f: string) => (l ? `${l} — ${f}` : f) }))

import { generateAndFileInspectionReport } from './file-inspection-report'

// Builds a service-client mock that records reports inserts/supersedes and
// returns a queued prior-version + the inspection's template + uploads.
function makeService(opts: { priorVersion?: number; priorHandoverDocs?: Array<{ id: string; storage_path: string }>; fileFields?: Array<{ field_id: string; label: string }>; photos?: Array<{ field_id: string; storage_path: string; caption: string }> }) {
  const calls = { insertReport: null as any, superseded: false, deletedOrigin: false }
  const tenants = {
    documents: {
      // dedup select prior + delete
      select: () => ({ eq: () => ({ eq: () => ({ data: opts.priorHandoverDocs ?? [] }) }) }),
      delete: () => ({ eq: () => ({ eq: () => { calls.deletedOrigin = true; return { data: null, error: null } } }) }),
    },
  }
  const projects = {
    reports: {
      selectPrior: { data: opts.priorVersion ? { id: 'r0', version: opts.priorVersion } : null },
    },
  }
  const inspections = {
    inspections: { data: { template_id: 'tmpl-1' } },
    templates: { data: { schema_json: { sections: [{ section_id: 's1', fields: (opts.fileFields ?? []).map((f) => ({ field_id: f.field_id, label: f.label, type: 'file' })) }] } } },
    photos: { data: opts.photos ?? [] },
  }
  const client: any = {
    schema: (s: string) => ({
      from: (t: string) => {
        if (s === 'projects' && t === 'reports') return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => projects.reports.selectPrior }) }) }) }) }) }),
          insert: (row: any) => { calls.insertReport = row; return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) } },
          update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ neq: async () => { calls.superseded = true; return { error: null } } }) }) }) }),
        }
        if (s === 'tenants' && t === 'documents') return tenants.documents
        if (s === 'inspections' && t === 'inspections') return { select: () => ({ eq: () => ({ maybeSingle: async () => inspections.inspections }) }) }
        if (s === 'inspections' && t === 'templates') return { select: () => ({ eq: () => ({ maybeSingle: async () => inspections.templates }) }) }
        if (s === 'inspections' && t === 'photos') return { select: () => ({ eq: () => ({ in: async () => inspections.photos }) }) }
        return {}
      },
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        download: async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(2), type: 'application/pdf' }, error: null }),
      }),
    },
  }
  return { client, calls }
}

const BASE_DATA = {
  inspectionId: 'insp-1',
  summary: { documentNumber: 'COC-1', templateName: 'Electrical CoC', projectName: 'KW' },
  brandingInput: { orgName: 'WM', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectMarkDataUri: null, projectSubtitle: '' },
}

describe('generateAndFileInspectionReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.gather.mockResolvedValue(BASE_DATA)
    h.render.mockResolvedValue(Buffer.from('PDFBYTES'))
  })

  it('renders, saves a versioned projects.reports row, supersedes priors, and files the report into compliance_certs', async () => {
    const { client, calls } = makeService({ priorVersion: 2 })
    h.serviceClient = client
    const res = await generateAndFileInspectionReport({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'user-1' })
    expect('reportId' in res && res.reportId).toBe('r1')
    expect(calls.insertReport.kind).toBe('inspection')
    expect(calls.insertReport.version).toBe(3) // prior 2 + 1
    expect(calls.superseded).toBe(true)
    expect(calls.deletedOrigin).toBe(true) // dedup ran
    // first fileIntoHandover call = the report → compliance_certs
    expect(h.fileIntoHandover.mock.calls[0][1].category).toBe('compliance_certs')
  })

  it('files each file-field upload into test_certificates', async () => {
    const { client } = makeService({
      fileFields: [{ field_id: 'datasheet', label: 'Data Sheet' }],
      photos: [{ field_id: 'datasheet', storage_path: 'p/x.pdf', caption: 'x.pdf' }],
    })
    h.serviceClient = client
    await generateAndFileInspectionReport({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'user-1' })
    const uploadCall = h.fileIntoHandover.mock.calls.find((c) => c[1].category === 'test_certificates')
    expect(uploadCall).toBeTruthy()
    expect(uploadCall![1].name).toContain('Data Sheet')
  })

  it('rolls back the reports storage object when the row insert fails', async () => {
    const { client } = makeService({})
    // Force the reports insert to error
    const origFrom = client.schema
    client.schema = (s: string) => {
      const api = origFrom(s)
      if (s === 'projects') return { from: () => ({ ...api.from('reports'), insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'dup' } }) }) }) }) }
      return api
    }
    const removed: string[][] = []
    client.storage.from = () => ({ upload: async () => ({ error: null }), remove: async (p: string[]) => { removed.push(p); return { error: null } }, download: async () => ({ data: null, error: { message: 'x' } }) })
    h.serviceClient = client
    const res = await generateAndFileInspectionReport({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'user-1' })
    expect('error' in res).toBe(true)
    expect(removed.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/lib/reports/file-inspection-report.test.ts`
Expected: FAIL — `Cannot find module './file-inspection-report'`.

- [ ] **Step 3: Write the worker**

`apps/web/src/lib/reports/file-inspection-report.ts`:

```ts
/**
 * generateAndFileInspectionReport — render the branded inspection certificate,
 * save it versioned to projects.reports, and auto-file it (+ the in-inspection
 * file uploads) into the handover pack.
 *
 * NOT a 'use server' module: it performs NO auth gate. Callers authorize first:
 *   - certifyInspectionAction (the assigned verifier is already authorized)
 *   - regenerateInspectionReportAction (gates to ORG_WRITE_ROLES)
 * gatherInspectionReportData still self-gates the READ over all project roles
 * using the caller's cookie session; the privileged WRITES use the service
 * client passed through createServiceClient (RLS-bypassing) — same pattern as
 * exportSnagVisitReportAction.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { gatherInspectionReportData } from './inspection-report-data'
import { renderInspectionReport } from './render-inspection'
import { resolveBranding, type BrandingInput } from './branding'
import { fileIntoHandover } from '@/lib/handover/handover-filing'
import { buildHandoverDrawingName } from '@esite/shared'

/* eslint-disable @typescript-eslint/no-explicit-any */
const REPORTS_BUCKET = 'reports'
const ATTACHMENTS_BUCKET = 'inspection-attachments'
const HANDOVER_BUCKET = 'project-documents'

export interface GenerateInspectionReportArgs {
  inspectionId: string
  projectId: string
  orgId: string
  userId: string
}
export type GenerateInspectionReportResult =
  | { error: string }
  | { reportId: string; storagePath: string }

/** Top-level `file`-type uploads (section + subsection fields). Group-nested
 *  file fields are NOT separately filed in v1 (they still render as report
 *  annexures); revisit if a template needs them. */
async function listInspectionFileUploads(
  service: any,
  inspectionId: string,
): Promise<Array<{ storagePath: string; filename: string; label: string }>> {
  const { data: insp } = await service.schema('inspections').from('inspections')
    .select('template_id').eq('id', inspectionId).maybeSingle()
  if (!insp) return []
  const { data: tmpl } = await service.schema('inspections').from('templates')
    .select('schema_json').eq('id', insp.template_id).maybeSingle()
  const schema = (tmpl?.schema_json ?? {}) as any
  const fileFields = new Map<string, string>() // field_id → label
  for (const section of (schema.sections ?? []) as any[]) {
    const fields = [
      ...((section.fields ?? []) as any[]),
      ...(((section.subsections ?? []) as any[]).flatMap((ss: any) => ss.fields ?? [])),
    ]
    for (const f of fields) {
      if (f.type === 'file') fileFields.set(String(f.field_id), String(f.label ?? f.field_id))
    }
  }
  if (fileFields.size === 0) return []
  const { data: photos } = await service.schema('inspections').from('photos')
    .select('field_id, storage_path, caption')
    .eq('inspection_id', inspectionId)
    .in('field_id', [...fileFields.keys()])
  return ((photos ?? []) as any[]).map((p) => ({
    storagePath: String(p.storage_path),
    filename: (p.caption as string | null) ?? 'attachment',
    label: fileFields.get(String(p.field_id)) ?? '',
  }))
}

/** Delete prior auto-filed handover docs for this inspection (storage + rows). */
async function deletePriorHandoverDocs(service: any, inspectionId: string): Promise<void> {
  const { data: priors } = await service.schema('tenants').from('documents')
    .select('id, storage_path').eq('origin_kind', 'inspection').eq('origin_id', inspectionId)
  const rows = (priors ?? []) as Array<{ id: string; storage_path: string }>
  if (rows.length === 0) return
  const paths = rows.map((r) => r.storage_path).filter(Boolean)
  if (paths.length) await service.storage.from(HANDOVER_BUCKET).remove(paths).catch(() => undefined)
  await service.schema('tenants').from('documents').delete()
    .eq('origin_kind', 'inspection').eq('origin_id', inspectionId)
}

export async function generateAndFileInspectionReport(
  args: GenerateInspectionReportArgs,
): Promise<GenerateInspectionReportResult> {
  const { inspectionId, projectId, orgId, userId } = args

  // 1. Gather + render (gather self-gates the READ via the caller's session).
  let pdfBuffer: Buffer
  let documentNumber: string
  let title: string
  let brandingSnapshot: unknown
  try {
    const data = await gatherInspectionReportData(inspectionId)
    const today = new Date().toISOString().slice(0, 10)
    const bi = data.brandingInput
    const input: BrandingInput = {
      org: { name: bi.orgName, logoSrc: bi.orgLogoDataUri ?? undefined, accent: bi.orgAccent },
      project: {
        name: data.summary.projectName,
        clientLogoSrc: bi.clientLogoDataUri ?? undefined,
        projectMarkSrc: bi.projectMarkDataUri ?? undefined,
        accent: bi.projectAccent,
        subtitle: bi.projectSubtitle || undefined,
      },
      contractor: null,
      title: 'Inspection & Test Report',
      kicker: 'ELECTRICAL INSPECTION',
      date: today,
    }
    const branding = resolveBranding(input)
    pdfBuffer = await renderInspectionReport(data, branding)
    documentNumber = data.summary.documentNumber
    title = `${data.summary.templateName} — ${documentNumber}`
    brandingSnapshot = {
      accent: branding.accent,
      issuer: branding.issuer.wordmark ? { wordmark: branding.issuer.wordmark } : { hasLogo: true },
      kicker: branding.kicker,
      projectLine: branding.projectLine,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generateAndFileInspectionReport] gather/render error', err)
    return { error: msg }
  }

  const service = createServiceClient() as any

  // 2. Version.
  const { data: priorRow } = await service.schema('projects').from('reports')
    .select('id, version')
    .eq('source_table', 'inspections').eq('source_id', inspectionId).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // 3. Upload to the reports bucket.
  const storagePath = `${orgId}/${projectId}/inspection-${inspectionId}-v${newVersion}.pdf`
  const { error: upErr } = await service.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, new Uint8Array(pdfBuffer), { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  // 4. Insert projects.reports.
  const { data: newReport, error: insErr } = await service.schema('projects').from('reports').insert({
    organisation_id: orgId,
    project_id: projectId,
    kind: 'inspection',
    source_table: 'inspections',
    source_id: inspectionId,
    title,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdfBuffer.length,
    status: 'issued',
    version: newVersion,
    branding_snapshot: brandingSnapshot,
    generated_by: userId,
  }).select('id').single()
  if (insErr || !newReport) {
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return { error: `Failed to save report record: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  const reportId = (newReport as { id: string }).id

  // 5. Supersede all prior issued rows.
  const { error: supErr } = await service.schema('projects').from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('source_table', 'inspections').eq('source_id', inspectionId).eq('status', 'issued').neq('id', reportId)
  if (supErr) console.error('[generateAndFileInspectionReport] supersede error', supErr)

  // 6. Dedup prior auto-filed handover docs for this inspection.
  try {
    await deletePriorHandoverDocs(service, inspectionId)
  } catch (e) {
    console.error('[generateAndFileInspectionReport] dedup error', e)
  }

  // 7. File the report PDF → compliance_certs (best-effort: cert row already saved).
  const reportFiled = await fileIntoHandover(service, {
    orgId, projectId, category: 'compliance_certs',
    name: `Inspection Report ${documentNumber}.pdf`,
    bytes: new Uint8Array(pdfBuffer), mimeType: 'application/pdf',
    originKind: 'inspection', originId: inspectionId, userId,
  })
  if ('error' in reportFiled) console.error('[generateAndFileInspectionReport] file report failed', reportFiled.error)

  // 8. File each file-field upload → test_certificates (best-effort).
  const uploads = await listInspectionFileUploads(service, inspectionId)
  for (const u of uploads) {
    const dl = await service.storage.from(ATTACHMENTS_BUCKET).download(u.storagePath)
    if (dl.error || !dl.data) {
      console.error('[generateAndFileInspectionReport] upload download failed', u.storagePath, dl.error)
      continue
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const filed = await fileIntoHandover(service, {
      orgId, projectId, category: 'test_certificates',
      name: buildHandoverDrawingName(u.label, u.filename),
      bytes, mimeType: (dl.data as Blob).type || null,
      originKind: 'inspection', originId: inspectionId, userId,
    })
    if ('error' in filed) console.error('[generateAndFileInspectionReport] file upload failed', u.filename, filed.error)
  }

  return { reportId, storagePath }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/lib/reports/file-inspection-report.test.ts`
Expected: PASS (3 tests). Adjust the chainable mock shapes if a call path differs — the worker's query chains are the contract.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/reports/file-inspection-report.ts apps/web/src/lib/reports/file-inspection-report.test.ts
git commit -m "feat(reports): generateAndFileInspectionReport worker (save + handover auto-file)"
```

---

## Task 4: Wire certify → worker; remove the legacy edge invoke

**Files:**
- Modify: `apps/web/src/actions/inspections-certify.actions.ts`
- Create: `apps/web/src/actions/inspections-certify.actions.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/actions/inspections-certify.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  worker: vi.fn(async () => ({ reportId: 'r1', storagePath: 'p' })),
  invoke: vi.fn(async () => ({ error: null })),
  dispatchNotification: vi.fn(async () => undefined),
  requireFeature: vi.fn(async () => undefined),
}))

vi.mock('@/lib/reports/file-inspection-report', () => ({ generateAndFileInspectionReport: h.worker }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: h.dispatchNotification }))
vi.mock('@/lib/features', () => ({ requireFeature: h.requireFeature }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Minimal supabase mock: verifier-owned inspection awaiting verification,
// inspection_only deliverable (no separate-verifier gate, no signature gate).
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'verifier-1' } } }) },
    functions: { invoke: h.invoke },
    rpc: async () => ({ data: 'INS-0001', error: null }),
    schema: () => ({
      from: (t: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => t === 'inspections'
              ? { data: { id: 'insp-1', status: 'awaiting_verification', verifier_id: 'verifier-1', organisation_id: 'org-1', template_id: 'tmpl-1' } }
              : { data: { deliverable_type: 'inspection_only', schema_json: { sections: [] } } },
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        }),
        update: () => ({ eq: () => ({ error: null }) }),
      }),
    }),
  }),
}))

import { certifyInspectionAction } from './inspections-certify.actions'

describe('certifyInspectionAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the report worker and does NOT invoke the legacy render-inspection-pdf', async () => {
    const coc = await certifyInspectionAction({ inspectionId: 'insp-1', projectId: 'proj-1' })
    expect(coc).toBe('INS-0001')
    expect(h.worker).toHaveBeenCalledWith(expect.objectContaining({ inspectionId: 'insp-1', projectId: 'proj-1', orgId: 'org-1', userId: 'verifier-1' }))
    const renderInvokes = h.invoke.mock.calls.filter((c) => c[0] === 'render-inspection-pdf')
    expect(renderInvokes.length).toBe(0)
  })

  it('still returns the COC number when report generation fails (best-effort)', async () => {
    h.worker.mockResolvedValueOnce({ error: 'render boom' })
    const coc = await certifyInspectionAction({ inspectionId: 'insp-1', projectId: 'proj-1' })
    expect(coc).toBe('INS-0001')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/actions/inspections-certify.actions.test.ts`
Expected: FAIL — `render-inspection-pdf` is still invoked / worker not called.

- [ ] **Step 3: Add the import**

In `apps/web/src/actions/inspections-certify.actions.ts`, after the existing imports (after line 20):

```ts
import { generateAndFileInspectionReport } from '@/lib/reports/file-inspection-report'
```

- [ ] **Step 4: Replace the legacy render block**

Replace lines 238–247 (the `// Best-effort PDF render — Phase 6 ships the edge function; ...` block ending at the closing brace of its `try/catch`) with:

```ts
  // Render + save the branded certificate to projects.reports and auto-file it
  // (plus the in-inspection file uploads) into the handover pack. Best-effort:
  // certification is a committed DB fact; a render/file failure leaves the cert
  // valid and the /report page exposes a Regenerate action. Replaces the
  // retired render-inspection-pdf edge function (it 500s on ✓/✗/Ω glyphs).
  try {
    const result = await generateAndFileInspectionReport({
      inspectionId: input.inspectionId,
      projectId: input.projectId,
      orgId: insp.organisation_id,
      userId: user.id,
    })
    if ('error' in result) {
      console.warn('inspection report generation failed (regenerate available):', result.error)
    }
  } catch (e) {
    console.warn('inspection report generation threw (regenerate available):', (e as Error).message)
  }
```

Leave the subsequent `validate-inspection` block (lines ~249–269) unchanged — it reads `inspections.certificates`, which is no longer written, so it now no-ops gracefully (the regulated validation/cutover is out of scope; see spec §9).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/actions/inspections-certify.actions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Type-check**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/actions/inspections-certify.actions.ts apps/web/src/actions/inspections-certify.actions.test.ts
git commit -m "feat(inspections): certify renders+saves report via worker; drop legacy render-inspection-pdf invoke"
```

---

## Task 5: Regenerate action + report page rewrite (read `projects.reports`)

**Files:**
- Create: `apps/web/src/actions/inspection-report.actions.ts`
- Create: `apps/web/src/actions/inspection-report.actions.test.ts`
- Create: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RegenerateButton.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx`

- [ ] **Step 1: Write the failing test for the regenerate action**

`apps/web/src/actions/inspection-report.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  worker: vi.fn(async () => ({ reportId: 'r1', storagePath: 'p' })),
  requireEffectiveRole: vi.fn(async () => ({ ok: true })),
  getById: vi.fn(async () => ({ organisation_id: 'org-1' })),
}))

vi.mock('@/lib/reports/file-inspection-report', () => ({ generateAndFileInspectionReport: h.worker }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: h.requireEffectiveRole }))
vi.mock('@esite/shared', () => ({ projectService: { getById: h.getById }, ORG_WRITE_ROLES: ['owner', 'admin', 'project_manager'] }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'pm-1' } } }) },
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'insp-1', project_id: 'proj-1' } }) }) }) }) }),
  }),
}))

import { regenerateInspectionReportAction } from './inspection-report.actions'

describe('regenerateInspectionReportAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gates, then calls the worker and returns the reportId', async () => {
    const res = await regenerateInspectionReportAction('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
    expect(h.requireEffectiveRole).toHaveBeenCalled()
    expect(res.reportId).toBe('r1')
  })

  it('blocks when the role gate fails', async () => {
    h.requireEffectiveRole.mockResolvedValueOnce({ ok: false, error: 'forbidden' })
    const res = await regenerateInspectionReportAction('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
    expect(res.error).toBe('forbidden')
    expect(h.worker).not.toHaveBeenCalled()
  })

  it('rejects an inspection that does not belong to the project', async () => {
    const res = await regenerateInspectionReportAction('not-a-uuid', '22222222-2222-2222-2222-222222222222')
    expect(res.error).toBe('Invalid parameters')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/actions/inspection-report.actions.test.ts`
Expected: FAIL — `Cannot find module './inspection-report.actions'`.

- [ ] **Step 3: Write the regenerate action**

`apps/web/src/actions/inspection-report.actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { generateAndFileInspectionReport } from '@/lib/reports/file-inspection-report'

const uuid = z.string().uuid()

/**
 * Manually (re)generate + save the inspection certificate and re-file it into
 * handover. The certify flow does this automatically; this is the fallback when
 * the certify-time render failed (best-effort) or a re-issue is wanted.
 *
 * Gated to ORG_WRITE_ROLES (owner / admin / project_manager). The worker uses
 * the service client for writes, so this in-app gate is mandatory.
 */
export async function regenerateInspectionReportAction(
  inspectionId: string,
  projectId: string,
): Promise<{ error?: string; reportId?: string }> {
  const parse = z.tuple([uuid, uuid]).safeParse([inspectionId, projectId])
  if (!parse.success) return { error: 'Invalid parameters' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  // Cross-project guard: the inspection must belong to this project.
  const { data: insp } = await (supabase as any)
    .schema('inspections').from('inspections')
    .select('id, project_id').eq('id', inspectionId).maybeSingle()
  if (!insp || insp.project_id !== projectId) {
    return { error: 'Inspection not found or does not belong to this project' }
  }

  const result = await generateAndFileInspectionReport({
    inspectionId,
    projectId,
    orgId: (project as { organisation_id: string }).organisation_id,
    userId: user.id,
  })
  if ('error' in result) return { error: result.error }

  revalidatePath(`/projects/${projectId}/inspections/${inspectionId}/report`)
  revalidatePath(`/projects/${projectId}/handover/documents`)
  return { reportId: result.reportId }
}
```

- [ ] **Step 4: Run the regenerate test to verify it passes**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/actions/inspection-report.actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the RegenerateButton client component**

`apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RegenerateButton.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { regenerateInspectionReportAction } from '@/actions/inspection-report.actions'

export default function RegenerateButton({
  inspectionId,
  projectId,
  hasReport,
}: {
  inspectionId: string
  projectId: string
  hasReport: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <Button
        variant={hasReport ? 'ghost' : 'primary'}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null)
            const res = await regenerateInspectionReportAction(inspectionId, projectId)
            if (res?.error) setErr(res.error)
            else router.refresh()
          })
        }
      >
        {pending ? 'Generating…' : hasReport ? '↻ Regenerate' : 'Generate certificate'}
      </Button>
      {err && <span style={{ color: 'var(--c-red)', fontSize: 11 }}>{err}</span>}
    </div>
  )
}
```

- [ ] **Step 6: Rewrite the report page to read `projects.reports`**

Replace the entire body of `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx` with:

```tsx
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import RegenerateButton from './RegenerateButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Certificate' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

interface Props {
  params: Promise<{ id: string; inspectionId: string }>
}

export default async function ReportPage({ params }: Props) {
  const { id: projectId, inspectionId } = await params
  const supabase = (await createClient()) as AnyClient

  // The inspection row is the source of truth for cert status + COC number.
  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('coc_number, status')
    .eq('id', inspectionId)
    .maybeSingle()
  if (!insp) notFound()

  // The PDF artifact is the latest issued projects.reports row (kind=inspection).
  const { data: report } = await supabase
    .schema('projects')
    .from('reports')
    .select('id, storage_path, version, generated_at')
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const isCertified = insp.status === 'certified'
  if (!report && !isCertified) notFound()

  let signedUrl: string | null = null
  if (report) {
    const { data: signed } = await supabase.storage.from('reports').createSignedUrl(report.storage_path, 3600)
    signedUrl = signed?.signedUrl ?? null
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/inspections/${inspectionId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Inspection
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Certificate {insp.coc_number ?? ''}</h1>
          <p className="page-subtitle">
            {report
              ? `Generated ${new Date(report.generated_at).toLocaleString('en-ZA')} · v${report.version}`
              : 'Certificate PDF not generated yet'}
          </p>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant={isCertified ? 'success' : 'warning'}>{isCertified ? 'certified' : insp.status}</Badge>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {signedUrl && (
            <a href={signedUrl} download={`${insp.coc_number ?? 'certificate'}.pdf`} style={{ textDecoration: 'none' }}>
              <Button variant="primary">↓ Download</Button>
            </a>
          )}
          {isCertified && (
            <RegenerateButton inspectionId={inspectionId} projectId={projectId} hasReport={!!report} />
          )}
        </div>
      </div>

      {signedUrl ? (
        <iframe
          src={signedUrl}
          title={`Certificate ${insp.coc_number ?? ''}`}
          style={{ width: '100%', height: '80vh', border: '1px solid var(--c-border)', borderRadius: 8, background: 'var(--c-panel)' }}
        />
      ) : (
        <div style={{ padding: 16, background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text-dim)', fontSize: 13 }}>
          {isCertified
            ? 'The certificate PDF has not been generated yet. Click “Generate certificate” to produce it.'
            : 'Could not load the certificate PDF.'}
        </div>
      )}
    </div>
  )
}
```

Note: this drops the `ShareLinkButton` / `RevokeButton` imports (share/revoke are out-of-scope regulated features bound to the legacy `inspections.certificates`, and non-functional for real certs). Those component files remain on disk, now unused — leave them (pre-existing; not this change's to delete).

- [ ] **Step 7: Type-check**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web type-check`
Expected: PASS. (If lint flags the now-unused `ShareLinkButton.tsx` / `RevokeButton.tsx` files, ignore — unused *files* are not errors; only unused *imports within a file* are, and those were removed.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/actions/inspection-report.actions.ts apps/web/src/actions/inspection-report.actions.test.ts "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RegenerateButton.tsx" "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx"
git commit -m "feat(inspections): report page reads projects.reports + Regenerate fallback"
```

---

## Task 6: Drop the project-wide handover pull from the gatherer (D5)

**Files:**
- Modify: `apps/web/src/lib/reports/inspection-report-data.ts`
- Modify: `apps/web/src/lib/reports/inspection-report-data.test.ts`

- [ ] **Step 1: Write/extend the failing test**

Add to `apps/web/src/lib/reports/inspection-report-data.test.ts` (adapt to the file's existing fixture/mock harness — it already exercises `gatherInspectionReportData`):

```ts
it('annexures contain only the inspection’s own file uploads (no project-wide handover pull)', async () => {
  // Arrange a fixture with: one file-field upload AND project handover docs in
  // compliance_certs/test_certificates. (Reuse this file’s existing harness.)
  const data = await gatherInspectionReportData('insp-with-file-upload')
  expect(data.annexures.every((a) => a.source === 'attachment')).toBe(true)
  expect(data.annexures.some((a) => (a as { source: string }).source === 'handover')).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/lib/reports/inspection-report-data.test.ts`
Expected: FAIL — a `source: 'handover'` annexure is still present.

- [ ] **Step 3: Remove the handover-pull block**

In `apps/web/src/lib/reports/inspection-report-data.ts`, delete lines 592–618 (the `// 8b. Handover annexures ...` block through its `catch`/closing brace), and change line 620:

Old:
```ts
  const annexures = [...attachmentAnnexures, ...handoverAnnexures]
```
New:
```ts
  const annexures = attachmentAnnexures
```

- [ ] **Step 4: Remove the now-unused constants**

Delete line 138 (`const HANDOVER_BUCKET = 'project-documents'`) and line 144 (`const HANDOVER_CATEGORIES = ['compliance_certs', 'test_certificates']`).

Also remove `'handover'` from the `ReportAnnexure.source` union (line 63) so the type reflects reality:

Old:
```ts
  source: 'attachment' | 'handover'
```
New:
```ts
  source: 'attachment'
```

Check `interior.tsx` (the consumer of `ReportAnnexure`) for any branch that reads `source === 'handover'`; if present, simplify it. Run type-check to surface it.

- [ ] **Step 5: Run the test + type-check to verify they pass**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run src/lib/reports/inspection-report-data.test.ts && pnpm --filter web type-check`
Expected: PASS. (Fix any `source === 'handover'` reference in `interior.tsx` that type-check flags.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/reports/inspection-report-data.ts apps/web/src/lib/reports/inspection-report-data.test.ts apps/web/src/lib/reports/interior.tsx
git commit -m "feat(reports): inspection report annexes only its own uploads (drop project-wide handover pull)"
```

---

## Task 7: Docs — RBAC matrix

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Add the regenerate action row**

In `docs/rbac-matrix.md`, under the Inspections section, add a row documenting:
- `regenerateInspectionReportAction` — **owner / admin / project_manager** (`ORG_WRITE_ROLES`). Renders + saves the inspection certificate to `projects.reports` and auto-files it into handover. The certify path (assigned verifier) generates it automatically; this is the manual fallback.
- Note: the `/projects/[id]/inspections/[id]/report` page now reads `projects.reports` (read = any project access via `reports_select` RLS). No new route. Share/revoke deferred (regulated cutover).

Match the table's existing column format (Route/Action · Allowed roles · Notes).

- [ ] **Step 2: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): regenerateInspectionReportAction gate + report page source change"
```

---

## Task 8: Full verification + deploy-verify

**Files:** none (verification only)

- [ ] **Step 1: Full web test suite**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web exec vitest run`
Expected: PASS (all prior tests + the new ones). Investigate any regression before proceeding.

- [ ] **Step 2: Type-check all workspaces**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm type-check`
Expected: web + shared clean. (Pre-existing `apps/mobile` TS2786 JSX errors are unrelated — do not chase; see CLAUDE.md.)

- [ ] **Step 3: Web build**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && pnpm --filter web build`
Expected: PASS (confirms the new server-only modules + Node-runtime worker compile under Next 15).

- [ ] **Step 4: Finish-the-branch → PR**

Use superpowers:finishing-a-development-branch. Open the PR; `00122` auto-applies on merge via `.github/workflows/deploy-migrations.yml` (path-filtered to `migrations/**`).

- [ ] **Step 5: Post-merge — verify the migration on prod**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && bash scripts/db/smoke-test-documents-origin.sh`
Expected: `PASS` (origin_kind/origin_id columns + idx_documents_origin present). Confirm the deploy-migrations workflow run succeeded + the ledger row for `00122` exists.

- [ ] **Step 6: Deploy-verify the render + auto-file on prod (MANDATORY)**

react-pdf needs `apps/web` on React 19 under Next 15; unit tests use clean React 18 and do NOT prove the real render (see CLAUDE.md `report-engine-react19` + `prod-authenticated-render-verify`). Using the isolated-fixture recipe:
1. Seed a throwaway org/project + a temp owner user; create an inspection with at least one `file`-field upload (a small PDF in `inspection-attachments`); take it to `awaiting_verification`; assign the temp user as verifier.
2. Sign in via the app's `@supabase/ssr` flow and certify (or call `regenerateInspectionReportAction`).
3. Assert on prod: a `projects.reports` row (`kind='inspection'`, `status='issued'`) exists; the PDF is in the `reports` bucket and renders (HTTP 200 `application/pdf`, page count > 0 via pdftoppm); a `tenants.documents` row exists under `compliance_certs` (the report) and one under `test_certificates` (the upload), both with `origin_kind='inspection'`; `/handover/documents` lists them.
4. Re-run certify/regenerate once → confirm NO duplicate handover docs (dedup replaced them) and `projects.reports` shows v2 issued + v1 superseded.
5. Tear down to baseline (delete the throwaway org/project/user + storage objects); confirm zero residue.

- [ ] **Step 7: Report the deploy**

Per the standing request (CLAUDE.md `deploy-confirmation-and-vercel-notifications`): confirm the Vercel deploy of the merge commit (`gh api repos/WattMatt/e-site/commits/<sha>/status` → Vercel `success`; `vercel inspect esite-lilac.vercel.app --scope arno-mattheus-projects` → `● Ready`) and report it back. A direct merge to `main` gets no Vercel PR comment.

---

## Self-Review

**Spec coverage:**
- D1 (certify = save, replace legacy) → Task 4. ✓
- D2 (uploads auto-file) → Task 3 (`listInspectionFileUploads` + filing to `test_certificates`). ✓ (v1 limitation: top-level/subsection `file` fields; group-nested noted.)
- D3 (report → single fixed category) + D4 (report→compliance_certs, uploads→test_certificates) → Task 3. ✓
- D5 (annex only own uploads) → Task 6. ✓
- D6 (resilient best-effort) → Task 4 best-effort + Task 5 Regenerate fallback. **Deviation from spec §4.1's literal "returns reportError":** the certify return type stays `Promise<string>` (no caller churn); resilience is delivered via best-effort + the Regenerate path instead. Same user outcome. ✓
- D7 (provenance/dedup) → Task 1 (`origin_kind`/`origin_id`) + Task 3 (`deletePriorHandoverDocs`). Named `origin_*` (not `source_*`) to avoid colliding with the existing cloud-sync columns. ✓
- Retire legacy from certify → Task 4. ✓ (Edge function code + `inspections.certificates` table left in place per spec §9.)
- `/report` reads `projects.reports` → Task 5. ✓
- Migration + smoke + deploy-verify → Tasks 1, 8. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has an expected result. The Task 6 test and the RBAC-matrix edit reference the file's existing harness/format rather than reproducing unknown content — acceptable (they adapt to in-repo conventions).

**Type consistency:** `fileIntoHandover(client, FileIntoHandoverOpts)` is defined in Task 2 and called identically in Task 3. `generateAndFileInspectionReport(GenerateInspectionReportArgs)` is defined in Task 3 and called identically in Tasks 4 & 5. `regenerateInspectionReportAction(inspectionId, projectId)` defined in Task 5, used by `RegenerateButton`. `origin_kind`/`origin_id` consistent across migration (Task 1), helper insert (Task 2), worker dedup (Task 3). Buckets: `reports` (artifact), `project-documents` (handover), `inspection-attachments` (uploads) used consistently.

**Decisions deferred to the executor (low-risk):** exact chainable-mock shapes (match the call chains in the worker); whether `CATEGORY_LABELS` becomes an unused import in the shop-drawing action (remove if flagged); any `source === 'handover'` branch in `interior.tsx` (simplify if type-check flags it).
