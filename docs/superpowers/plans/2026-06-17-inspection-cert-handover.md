# Inspection Certify → projects.reports + Handover Auto-File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inspection certification reliably render a branded PDF via the Node renderer, save it versioned to `projects.reports`, auto-file the cert + its own uploads into handover with origin provenance, add a Regenerate action, and retire the flaky `render-inspection-pdf` edge invoke.

**Architecture:** A pure worker `generateAndFileInspectionReport()` (service-client, no auth gate) does render → save-to-`projects.reports` → supersede → dedup-by-origin → file-into-handover, mirroring the proven `certifyValuationAction` save pattern. `certifyInspectionAction` calls it best-effort (cert never blocked). A new `regenerateInspectionReportAction` exposes a gated manual re-issue. Handover filing is extracted into a reusable `handover-filing.ts` module. The report page reads the artifact from `projects.reports`; Share/Revoke are dropped for v1.

**Tech Stack:** Next.js App Router (apps/web), Supabase (Postgres migration + service-role client), react-pdf (existing Node renderer), Zod, Vitest.

**Worktree:** `~/dev/e-site-inspcert` on branch `feat/inspection-cert-handover`. Run web tests with `cd apps/web && npx vitest run <file>`. Spec: `docs/superpowers/specs/2026-06-17-inspection-cert-handover-design.md`.

---

## File Structure

- **Create** `apps/edge-functions/supabase/migrations/00140_documents_origin_provenance.sql` — `origin_kind`/`origin_id` on `tenants.documents` + partial index.
- **Create** `apps/web/src/lib/handover/handover-filing.ts` — `ensureHandoverCategoryRoot` (moved here) + `fileIntoHandover`.
- **Modify** `apps/web/src/actions/node-order-shop-drawing.actions.ts` — import `ensureHandoverCategoryRoot` from the new module; delete the local copy.
- **Create** `apps/web/src/lib/reports/file-inspection-report.ts` — `generateAndFileInspectionReport` worker.
- **Modify** `apps/web/src/actions/inspections-certify.actions.ts` — replace the edge invoke with the worker call.
- **Create** `apps/web/src/actions/inspection-report.actions.ts` — `regenerateInspectionReportAction`.
- **Create** `apps/web/src/actions/inspection-report.actions.test.ts` — cross-project guard test.
- **Modify** `apps/web/src/lib/reports/inspection-report-data.ts` — drop the project-wide handover annexure pull.
- **Rewrite** `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx` — read `projects.reports`; add Regenerate; drop Share/Revoke.
- **Create** `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RegenerateButton.tsx`.
- **Delete** `.../report/ShareLinkButton.tsx` and `.../report/RevokeButton.tsx`.
- **Modify** `docs/rbac-matrix.md` — add the regenerate action + report-read note.

---

## Task 1: Migration — origin provenance on tenants.documents

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00140_documents_origin_provenance.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 00140_documents_origin_provenance.sql
-- Records which E-Site entity (e.g. an inspection) auto-filed a handover
-- document, so a re-issue can dedup its own prior artefacts without touching
-- manually-uploaded docs. Distinct from the existing source_* cloud-sync family.

ALTER TABLE tenants.documents
    ADD COLUMN IF NOT EXISTS origin_kind TEXT,   -- e.g. 'inspection'
    ADD COLUMN IF NOT EXISTS origin_id   UUID;   -- the inspections.inspections id

CREATE INDEX IF NOT EXISTS idx_documents_origin
    ON tenants.documents (origin_kind, origin_id)
    WHERE origin_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply locally to verify it parses**

Run: `cd ~/dev/e-site-inspcert && supabase db reset` is too heavy — instead apply just this file:
`psql "$(grep -m1 DATABASE_URL apps/web/.env.local | cut -d= -f2-)" -f apps/edge-functions/supabase/migrations/00140_documents_origin_provenance.sql`
Expected: `ALTER TABLE`, `CREATE INDEX`, `NOTIFY` with no error. (If the local DB isn't running, start the stack per the e-site-local-dev notes first; if `psql` isn't wired, defer this to the live-verification task and just eyeball the SQL.)

- [ ] **Step 3: Commit**

```bash
cd ~/dev/e-site-inspcert
git add apps/edge-functions/supabase/migrations/00140_documents_origin_provenance.sql
git commit -m "feat(handover): add origin_kind/origin_id provenance to tenants.documents (00140)"
```

---

## Task 2: Handover-filing module — extract root helper + add fileIntoHandover

**Files:**
- Create: `apps/web/src/lib/handover/handover-filing.ts`
- Modify: `apps/web/src/actions/node-order-shop-drawing.actions.ts` (remove local `ensureHandoverCategoryRoot`, import from new module)

- [ ] **Step 1: Create the module**

Create `apps/web/src/lib/handover/handover-filing.ts` with the full contents below. `ensureHandoverCategoryRoot` is moved verbatim from `node-order-shop-drawing.actions.ts:223-259` (only the client param type is loosened to `AnyClient` so both the cookie client and the service client can call it). `fileIntoHandover` generalises the shop-drawing filing block (`node-order-shop-drawing.actions.ts:403-436`) and adds the origin columns.

```typescript
import { CATEGORY_LABELS, type HandoverCategory } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

// tenants.documents files live in the 'project-documents' bucket
// (migration 00041/00042). Same bucket the shop-drawing filing uses.
const HANDOVER_BUCKET = 'project-documents'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Find-or-create the top-level handover folder for a category on a project.
 * Moved verbatim from node-order-shop-drawing.actions.ts so non-action callers
 * (the inspection-report worker) can reuse it.
 */
export async function ensureHandoverCategoryRoot(
  supabase: AnyClient,
  orgId: string,
  projectId: string,
  category: HandoverCategory,
  userId: string,
): Promise<{ id: string; folder_path: string; organisation_id: string } | { error: string }> {
  const { data: existing } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .select('id, folder_path, organisation_id')
    .eq('project_id', projectId)
    .eq('category', category)
    .is('parent_folder_id', null)
    .maybeSingle()
  if (existing) return existing as { id: string; folder_path: string; organisation_id: string }

  const { data: inserted, error } = await (supabase as any)
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
  if (error || !inserted)
    return { error: `Failed to create handover folder: ${(error as { message?: string } | null)?.message ?? 'unknown'}` }
  return inserted as { id: string; folder_path: string; organisation_id: string }
}

/**
 * Upload bytes into the project handover pack under a category, recording the
 * E-Site origin so a re-issue can dedup its own prior artefacts. Best-effort
 * rollback of the storage object if the document row insert fails.
 */
export async function fileIntoHandover(
  client: AnyClient,
  opts: {
    orgId: string
    projectId: string
    category: HandoverCategory
    name: string
    bytes: Buffer | Blob
    mimeType: string | null
    originKind: string
    originId: string
    userId: string
  },
): Promise<{ documentId: string } | { error: string }> {
  const folder = await ensureHandoverCategoryRoot(client, opts.orgId, opts.projectId, opts.category, opts.userId)
  if ('error' in folder) return folder

  const cleanFolderPath = (folder.folder_path || '').replace(/^\/+/, '').replace(/\/+/g, '/')
  const safeName = opts.name.replace(/[^a-zA-Z0-9._ -]/g, '_')
  const handoverPath = `${folder.organisation_id}/${opts.projectId}/handover/${cleanFolderPath}/${Date.now()}-${safeName}`

  const { error: upErr } = await client.storage
    .from(HANDOVER_BUCKET)
    .upload(handoverPath, opts.bytes, { contentType: opts.mimeType || 'application/octet-stream', upsert: false })
  if (upErr) return { error: `Handover upload failed: ${upErr.message}` }

  const sizeBytes = opts.bytes instanceof Blob ? opts.bytes.size : opts.bytes.length

  const { data: docRow, error: insErr } = await (client as any)
    .schema('tenants')
    .from('documents')
    .insert({
      organisation_id: folder.organisation_id,
      project_id: opts.projectId,
      name: safeName,
      category: 'handover',
      storage_path: handoverPath,
      mime_type: opts.mimeType,
      size_bytes: sizeBytes,
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

- [ ] **Step 2: Swap the shop-drawing action to import the helper**

In `apps/web/src/actions/node-order-shop-drawing.actions.ts`:
1. Delete the local `ensureHandoverCategoryRoot` function (currently `node-order-shop-drawing.actions.ts:223-259` — from `async function ensureHandoverCategoryRoot(` through its closing `}`).
2. Add to the existing `@esite/shared` import nothing new, but add a new import line near the other `@/lib` imports:

```typescript
import { ensureHandoverCategoryRoot } from '@/lib/handover/handover-filing'
```

3. If `CATEGORY_LABELS` is now unused in `node-order-shop-drawing.actions.ts` (it was only referenced inside the removed function), remove it from the `@esite/shared` import. Verify with: `grep -n "CATEGORY_LABELS" apps/web/src/actions/node-order-shop-drawing.actions.ts` — if the only hit was the import, drop it.

- [ ] **Step 3: Typecheck the touched files**

Run: `cd ~/dev/e-site-inspcert/apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "handover-filing|node-order-shop-drawing" || echo "no type errors in touched files"`
Expected: `no type errors in touched files`.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/e-site-inspcert
git add apps/web/src/lib/handover/handover-filing.ts apps/web/src/actions/node-order-shop-drawing.actions.ts
git commit -m "refactor(handover): extract ensureHandoverCategoryRoot + add fileIntoHandover with origin provenance"
```

---

## Task 3: Worker — generateAndFileInspectionReport

**Files:**
- Create: `apps/web/src/lib/reports/file-inspection-report.ts`

- [ ] **Step 1: Create the worker**

Create `apps/web/src/lib/reports/file-inspection-report.ts`. This mirrors `certifyValuationAction`'s save pattern (`valuation.actions.ts:579-637`) and the `report-preview` route's branding mapping (`api/projects/[id]/inspections/[inspectionId]/report-preview/route.ts:51-81`).

```typescript
/**
 * Render an inspection's branded report (Node renderer — no glyph bug),
 * save it versioned to projects.reports, supersede prior issued rows, then
 * auto-file the cert + the inspection's own file-uploads into handover with
 * origin provenance. RLS-bypassing service client — callers authorize.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { gatherInspectionReportData } from './inspection-report-data'
import { renderInspectionReport } from './render-inspection'
import { resolveBranding, type BrandingInput } from './branding'
import { fileIntoHandover } from '@/lib/handover/handover-filing'
import { buildHandoverDrawingName } from '@esite/shared'

const REPORTS_BUCKET = 'reports'
const ATTACHMENT_BUCKET = 'inspection-attachments'

export async function generateAndFileInspectionReport(params: {
  inspectionId: string
  projectId: string
  orgId: string
  userId: string
}): Promise<{ reportId: string; storagePath: string } | { error: string }> {
  const { inspectionId, projectId, orgId, userId } = params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // ── 1. Gather + render the PDF ─────────────────────────────────────────────
  let pdfBuffer: Buffer
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
    const issuerWordmark = (branding.issuer as { wordmark?: string }).wordmark
    brandingSnapshot = {
      accent: branding.accent,
      issuer: issuerWordmark ? { wordmark: issuerWordmark } : { hasLogo: true },
      kicker: branding.kicker,
      projectLine: branding.projectLine,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  // ── 2. Title (COC number) + template (for file-field detection) ────────────
  const { data: insp } = await service
    .schema('inspections')
    .from('inspections')
    .select('coc_number, template_id')
    .eq('id', inspectionId)
    .maybeSingle()
  const coc = (insp?.coc_number as string | null) ?? null
  const templateId = insp?.template_id as string | undefined

  // ── 3. Version vs prior issued ─────────────────────────────────────────────
  const { data: priorRow } = await service
    .schema('projects')
    .from('reports')
    .select('id, version')
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // ── 4. Upload PDF to the reports bucket ────────────────────────────────────
  const storagePath = `${orgId}/${projectId}/inspection-${inspectionId}-v${newVersion}.pdf`
  const { error: upErr } = await service.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  // ── 5. Insert projects.reports row ─────────────────────────────────────────
  const { data: newReport, error: insErr } = await service
    .schema('projects')
    .from('reports')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      kind: 'inspection',
      source_table: 'inspections',
      source_id: inspectionId,
      title: coc ? `Certificate ${coc}` : 'Inspection & Test Report',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdfBuffer.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      generated_by: userId,
    })
    .select('id')
    .single()
  if (insErr || !newReport) {
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return { error: `Failed to save report record: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  const reportId = (newReport as { id: string }).id

  // ── 6. Supersede all prior issued rows for this inspection ─────────────────
  await service
    .schema('projects')
    .from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .neq('id', reportId)

  // ── 7. Dedup prior auto-filed handover docs for THIS inspection ────────────
  const { data: priorDocs } = await service
    .schema('tenants')
    .from('documents')
    .select('id, storage_path')
    .eq('origin_kind', 'inspection')
    .eq('origin_id', inspectionId)
  const priorList = (priorDocs ?? []) as Array<{ id: string; storage_path: string }>
  if (priorList.length > 0) {
    await service.storage
      .from('project-documents')
      .remove(priorList.map((d) => d.storage_path))
      .catch(() => undefined)
    await service
      .schema('tenants')
      .from('documents')
      .delete()
      .eq('origin_kind', 'inspection')
      .eq('origin_id', inspectionId)
  }

  // ── 8. File the cert PDF → compliance_certs (best-effort) ──────────────────
  const certName = coc ? `${coc}.pdf` : `inspection-${inspectionId}.pdf`
  const certFiled = await fileIntoHandover(service, {
    orgId,
    projectId,
    category: 'compliance_certs',
    name: certName,
    bytes: pdfBuffer,
    mimeType: 'application/pdf',
    originKind: 'inspection',
    originId: inspectionId,
    userId,
  })
  if ('error' in certFiled) console.warn('[file-inspection-report] cert handover filing failed:', certFiled.error)

  // ── 9. File the inspection's own file-uploads → test_certificates ──────────
  //     Top-level + subsection `file` fields only (group-nested excluded in v1):
  //     their photos rows carry a synthetic field_id that won't match these ids.
  const { data: template } = await service
    .schema('inspections')
    .from('templates')
    .select('schema_json')
    .eq('id', templateId)
    .maybeSingle()
  const fileFieldLabels = new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = (template?.schema_json as any) ?? {}
  for (const section of (schema.sections ?? []) as Array<Record<string, any>>) {
    const fields = [
      ...((section.fields ?? []) as Array<Record<string, any>>),
      ...((section.subsections ?? []).flatMap((ss: any) => ss.fields ?? []) as Array<Record<string, any>>),
    ]
    for (const f of fields) {
      if (f.type === 'file') fileFieldLabels.set(String(f.field_id), String(f.label ?? f.field_id))
    }
  }
  if (fileFieldLabels.size > 0) {
    const { data: photos } = await service
      .schema('inspections')
      .from('photos')
      .select('field_id, storage_path, caption')
      .eq('inspection_id', inspectionId)
    for (const ph of (photos ?? []) as Array<{ field_id: string; storage_path: string; caption: string | null }>) {
      const label = fileFieldLabels.get(ph.field_id)
      if (!label) continue // photo field, orphan, or group-nested file — skip
      const { data: blob } = await service.storage.from(ATTACHMENT_BUCKET).download(ph.storage_path)
      if (!blob) continue
      const bytes = Buffer.from(await (blob as Blob).arrayBuffer())
      const fileName = ph.caption ?? 'attachment'
      const filed = await fileIntoHandover(service, {
        orgId,
        projectId,
        category: 'test_certificates',
        name: buildHandoverDrawingName(label, fileName),
        bytes,
        mimeType: (blob as Blob).type || null,
        originKind: 'inspection',
        originId: inspectionId,
        userId,
      })
      if ('error' in filed) console.warn('[file-inspection-report] upload handover filing failed:', filed.error)
    }
  }

  return { reportId, storagePath }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/dev/e-site-inspcert/apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "file-inspection-report" || echo "ok"`
Expected: `ok`. (If `BrandingInput` field names mismatch, re-check `apps/web/src/lib/reports/branding.ts` and the `report-preview` route mapping and align.)

- [ ] **Step 3: Commit**

```bash
cd ~/dev/e-site-inspcert
git add apps/web/src/lib/reports/file-inspection-report.ts
git commit -m "feat(inspections): worker to render + save report to projects.reports + auto-file handover"
```

---

## Task 4: Wire certify to the worker (retire the edge invoke)

**Files:**
- Modify: `apps/web/src/actions/inspections-certify.actions.ts`

- [ ] **Step 1: Add the import**

Near the top imports of `apps/web/src/actions/inspections-certify.actions.ts`, add:

```typescript
import { generateAndFileInspectionReport } from '@/lib/reports/file-inspection-report'
```

- [ ] **Step 2: Replace the edge-invoke block**

Find this block (`inspections-certify.actions.ts:239-247`):

```typescript
  // Best-effort PDF render — Phase 6 ships the edge function; this swallows
  // failures so the cert state remains valid and the render can be retried.
  try {
    const { error: fnErr } = await supabase.functions.invoke('render-inspection-pdf', {
      body: { inspection_id: input.inspectionId },
    })
    if (fnErr) console.warn('render-inspection-pdf failed (Phase 6 pending):', fnErr.message)
  } catch (e) {
    console.warn('render-inspection-pdf invocation failed:', (e as Error).message)
  }
```

Replace it with:

```typescript
  // Best-effort branded report → projects.reports + handover auto-file (Node
  // renderer; no glyph bug). The cert is a committed DB fact — a render/file
  // failure logs but never blocks certification, and is retryable via
  // regenerateInspectionReportAction.
  try {
    const result = await generateAndFileInspectionReport({
      inspectionId: input.inspectionId,
      projectId: input.projectId,
      orgId: insp.organisation_id,
      userId: user.id,
    })
    if ('error' in result)
      console.warn('inspection report generate/file failed (cert still valid):', result.error)
  } catch (e) {
    console.warn('inspection report generate/file threw (cert still valid):', (e as Error).message)
  }
```

Leave the downstream `validate-inspection` block unchanged — it reads `inspections.certificates` (no longer written), finds no cert, and no-ops.

- [ ] **Step 3: Typecheck**

Run: `cd ~/dev/e-site-inspcert/apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "inspections-certify" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/e-site-inspcert
git add apps/web/src/actions/inspections-certify.actions.ts
git commit -m "feat(inspections): certify renders+files via Node worker; retire render-inspection-pdf edge invoke"
```

---

## Task 5: Regenerate server action (TDD)

**Files:**
- Create: `apps/web/src/actions/inspection-report.actions.ts`
- Test: `apps/web/src/actions/inspection-report.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/actions/inspection-report.actions.test.ts` (mock shape mirrors `valuation.actions.test.ts:1-72`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  createClientMock,
  createServiceClientMock,
  requireEffectiveRoleMock,
  getByIdMock,
  workerMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  getByIdMock: vi.fn(),
  workerMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))
vi.mock('@esite/shared', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  projectService: { getById: getByIdMock },
}))
vi.mock('@/lib/reports/file-inspection-report', () => ({
  generateAndFileInspectionReport: workerMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

import { regenerateInspectionReportAction } from './inspection-report.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const OTHER_PROJECT = '22222222-2222-2222-2222-222222222222'
const INSPECTION = '33333333-3333-3333-3333-333333333333'

// Service client whose inspections lookup returns a fixed project_id.
function serviceReturning(inspProjectId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: inspProjectId ? { project_id: inspProjectId, organisation_id: 'org-1' } : null,
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const schema = vi.fn(() => ({ from }))
  return { schema }
}

beforeEach(() => {
  vi.clearAllMocks()
  createClientMock.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  })
  getByIdMock.mockResolvedValue({ id: PROJECT })
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'owner' })
  workerMock.mockResolvedValue({ reportId: 'rep-1', storagePath: 'p/x.pdf' })
})

describe('regenerateInspectionReportAction', () => {
  it('rejects an inspection that belongs to a different project', async () => {
    createServiceClientMock.mockReturnValue(serviceReturning(OTHER_PROJECT))
    const r = await regenerateInspectionReportAction(INSPECTION, PROJECT)
    expect(r).toEqual({ error: 'Not found' })
    expect(workerMock).not.toHaveBeenCalled()
  })

  it('regenerates when the inspection belongs to the project', async () => {
    createServiceClientMock.mockReturnValue(serviceReturning(PROJECT))
    const r = await regenerateInspectionReportAction(INSPECTION, PROJECT)
    expect(r).toEqual({ reportId: 'rep-1' })
    expect(workerMock).toHaveBeenCalledWith({
      inspectionId: INSPECTION,
      projectId: PROJECT,
      orgId: 'org-1',
      userId: 'user-1',
    })
  })

  it('blocks a caller without a write role', async () => {
    createServiceClientMock.mockReturnValue(serviceReturning(PROJECT))
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })
    const r = await regenerateInspectionReportAction(INSPECTION, PROJECT)
    expect(r).toEqual({ error: 'No access to this project' })
    expect(workerMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/dev/e-site-inspcert/apps/web && npx vitest run src/actions/inspection-report.actions.test.ts`
Expected: FAIL — cannot import `regenerateInspectionReportAction` (module not found).

- [ ] **Step 3: Implement the action**

Create `apps/web/src/actions/inspection-report.actions.ts`:

```typescript
'use server'

/**
 * Manual re-issue of an inspection's branded report. Certify does this
 * automatically; this is the gated fallback / regenerate button.
 *
 * Gate shape mirrors valuation.actions.ts: cookie client for auth + role,
 * service client (RLS-bypassing) behind the gate, cross-project guard before
 * any write.
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { generateAndFileInspectionReport } from '@/lib/reports/file-inspection-report'

const argsSchema = z.tuple([z.string().uuid(), z.string().uuid()])

export async function regenerateInspectionReportAction(
  inspectionId: string,
  projectId: string,
): Promise<{ error: string } | { reportId: string }> {
  const parsed = argsSchema.safeParse([inspectionId, projectId])
  if (!parsed.success) return { error: 'Invalid request' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthenticated' }

  const project = await projectService.getById(projectId, supabase)
  if (!project) return { error: 'Project not found' }

  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  // Cross-project guard — the inspection must belong to this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: insp } = await service
    .schema('inspections')
    .from('inspections')
    .select('project_id, organisation_id')
    .eq('id', inspectionId)
    .maybeSingle()
  if (!insp || insp.project_id !== projectId) return { error: 'Not found' }

  const result = await generateAndFileInspectionReport({
    inspectionId,
    projectId,
    orgId: insp.organisation_id as string,
    userId: user.id,
  })
  if ('error' in result) return { error: result.error }

  revalidatePath(`/projects/${projectId}/inspections/${inspectionId}/report`)
  revalidatePath(`/projects/${projectId}/handover/documents`)
  return { reportId: result.reportId }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/dev/e-site-inspcert/apps/web && npx vitest run src/actions/inspection-report.actions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/dev/e-site-inspcert
git add apps/web/src/actions/inspection-report.actions.ts apps/web/src/actions/inspection-report.actions.test.ts
git commit -m "feat(inspections): regenerateInspectionReportAction with cross-project guard + tests"
```

---

## Task 6: Gatherer — annex only the inspection's own uploads

**Files:**
- Modify: `apps/web/src/lib/reports/inspection-report-data.ts`

- [ ] **Step 1: Narrow the ReportAnnexure source union**

In `apps/web/src/lib/reports/inspection-report-data.ts` (lines ~61-67), change:

```typescript
export interface ReportAnnexure {
  name: string
  source: 'attachment' | 'handover'
  href: string | null             // short-lived signed URL printed as a reference link
  thumbnailDataUri?: string | null // image attachments only
  meta?: string | null            // e.g. "PDF · 142 KB" or a handover category
}
```

to:

```typescript
export interface ReportAnnexure {
  name: string
  source: 'attachment'
  href: string | null             // short-lived signed URL printed as a reference link
  thumbnailDataUri?: string | null // image attachments only
  meta?: string | null            // e.g. "PDF · 142 KB"
}
```

- [ ] **Step 2: Remove the handover constants**

Delete the `HANDOVER_BUCKET` const (line ~138, with its preceding comment block) and the `HANDOVER_CATEGORIES` const (line ~144, with its comment). Leave `PHOTO_BUCKET` and `ATTACHMENT_BUCKET` intact.

- [ ] **Step 3: Remove the "8b. Handover annexures" block**

Delete the entire block (lines ~592-618) from the comment `// 8b. Handover annexures (best-effort, LIST ONLY ...` through the closing `}` of its `try/catch`, including the `const handoverAnnexures: ReportAnnexure[] = []` declaration.

- [ ] **Step 4: Fix the annexures assembly**

Change (line ~620):

```typescript
  const annexures = [...attachmentAnnexures, ...handoverAnnexures]
```

to:

```typescript
  const annexures = attachmentAnnexures
```

- [ ] **Step 5: Typecheck + confirm no orphan references**

Run:
```bash
cd ~/dev/e-site-inspcert/apps/web
grep -n "handoverAnnexures\|HANDOVER_BUCKET\|HANDOVER_CATEGORIES" src/lib/reports/inspection-report-data.ts || echo "no orphan refs"
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "inspection-report-data" || echo "ok"
```
Expected: `no orphan refs` then `ok`.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/e-site-inspcert
git add apps/web/src/lib/reports/inspection-report-data.ts
git commit -m "refactor(inspections): report annexes only its own uploads (drop project-wide handover pull)"
```

---

## Task 7: Report page — read projects.reports + Regenerate; drop Share/Revoke

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RegenerateButton.tsx`
- Rewrite: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx`
- Delete: `.../report/ShareLinkButton.tsx`, `.../report/RevokeButton.tsx`

- [ ] **Step 1: Create the Regenerate button**

Create `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RegenerateButton.tsx` (useTransition pattern from `OptBackInButton.tsx`):

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
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button
        variant="primary"
        disabled={isPending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const r = await regenerateInspectionReportAction(inspectionId, projectId)
            if ('error' in r) setError(r.error)
            else router.refresh()
          })
        }}
      >
        {isPending ? 'Generating…' : hasReport ? '↻ Regenerate' : 'Generate certificate'}
      </Button>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</span>}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite the report page**

Replace the entire contents of `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/page.tsx` with:

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

  // Inspection row = source of truth for COC + certified status.
  const { data: insp } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('coc_number, status, certified_at')
    .eq('id', inspectionId)
    .maybeSingle()
  if (!insp) notFound()

  // Branded PDF artifact = latest issued projects.reports row for this inspection.
  const { data: report } = await supabase
    .schema('projects')
    .from('reports')
    .select('id, storage_path, version, created_at')
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const signed = report
    ? (await supabase.storage.from('reports').createSignedUrl(report.storage_path, 3600)).data
    : null

  const isCertified = insp.status === 'certified'
  const coc = (insp.coc_number as string | null) ?? null

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/inspections/${inspectionId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Inspection
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Certificate {coc ?? '—'}</h1>
          <p className="page-subtitle">
            {report
              ? `Generated ${new Date(report.created_at).toLocaleString('en-ZA')} · v${report.version}`
              : 'No certificate generated yet'}
          </p>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant={isCertified ? 'success' : 'info'}>{insp.status}</Badge>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {signed?.signedUrl && (
            <a href={signed.signedUrl} download={`${coc ?? inspectionId}.pdf`} style={{ textDecoration: 'none' }}>
              <Button variant="primary">↓ Download</Button>
            </a>
          )}
          {isCertified && (
            <RegenerateButton inspectionId={inspectionId} projectId={projectId} hasReport={!!report} />
          )}
        </div>
      </div>

      {signed?.signedUrl ? (
        <iframe
          src={signed.signedUrl}
          title={`Certificate ${coc ?? ''}`}
          style={{
            width: '100%',
            height: '80vh',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            background: 'var(--c-panel)',
          }}
        />
      ) : (
        <div
          style={{
            padding: 16,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            color: 'var(--c-text-dim)',
            fontSize: 13,
          }}
        >
          {isCertified
            ? 'No certificate PDF on file yet — use “Generate certificate” to produce it.'
            : 'This inspection is not certified yet. The certificate appears here once it is certified.'}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Delete the retired button files**

```bash
cd ~/dev/e-site-inspcert
git rm "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/ShareLinkButton.tsx" \
       "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/RevokeButton.tsx"
```

- [ ] **Step 4: Confirm Button variant + no dangling references**

Run:
```bash
cd ~/dev/e-site-inspcert/apps/web
grep -n "variant=" src/components/ui/Button.tsx | head            # confirm 'primary' exists
grep -rn "ShareLinkButton\|RevokeButton" src/app || echo "no dangling refs"
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "report/page|RegenerateButton" || echo "ok"
```
Expected: a `primary` variant is listed, `no dangling refs`, then `ok`. (If `generateShareLinkAction`/`revokeCertificateAction` in `inspections-certify.actions.ts` are now unreferenced, leave them — they are exported actions, not orphaned imports; removing them is out of scope.)

- [ ] **Step 5: Commit**

```bash
cd ~/dev/e-site-inspcert
git add "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/"
git commit -m "feat(inspections): report page reads projects.reports + Regenerate; drop Share/Revoke (v1)"
```

---

## Task 8: RBAC matrix doc

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Add the rows**

In `docs/rbac-matrix.md`, find the inspections section (grep for `certifyInspectionAction`) and add, in the same table format used there:

- `regenerateInspectionReportAction` — **W** for owner / admin / project_manager (`ORG_WRITE_ROLES`); requires `has_feature('inspections')`; cross-project guarded.
- A note on the report page read: the artifact source moved from `inspections.certificates` to `projects.reports` (read via the `reports_select` RLS by project role); Share/Revoke are deferred in v1.

Match the existing column layout exactly (don't invent a new format). If a header row legend exists, follow it.

- [ ] **Step 2: Commit**

```bash
cd ~/dev/e-site-inspcert
git add docs/rbac-matrix.md
git commit -m "docs(rbac): regenerateInspectionReportAction + inspection report-read source change"
```

---

## Task 9: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Lint + typecheck + targeted tests**

```bash
cd ~/dev/e-site-inspcert/apps/web
npx tsc --noEmit -p tsconfig.json && echo "TYPECHECK OK"
npx eslint src/lib/handover/handover-filing.ts src/lib/reports/file-inspection-report.ts src/actions/inspection-report.actions.ts "src/app/(admin)/projects/[id]/inspections/[inspectionId]/report/" src/actions/inspections-certify.actions.ts src/lib/reports/inspection-report-data.ts src/actions/node-order-shop-drawing.actions.ts && echo "LINT OK"
npx vitest run src/actions/inspection-report.actions.test.ts && echo "UNIT OK"
```
Expected: `TYPECHECK OK`, `LINT OK`, `UNIT OK`.

- [ ] **Step 2: Production build (catches RSC/use-client boundary errors)**

Run: `cd ~/dev/e-site-inspcert/apps/web && npx next build 2>&1 | tail -20`
Expected: build completes (no type/RSC errors). A long build is fine.

- [ ] **Step 3: Live verification (local stack)**

Bring up the local stack (Docker + supabase + `pnpm --filter @esite/web dev`), apply migration 00140, then with a smoke inspection that has a `file`-type upload:
1. Certify it. Confirm: a `projects.reports` row (`kind='inspection'`, `status='issued'`, `version=1`); the PDF object in the `reports` bucket; handover docs filed — the cert in `compliance_certs`, the upload in `test_certificates` — each with `origin_kind='inspection'`, `origin_id=<inspection id>`.
2. Open the report page — the PDF renders in the iframe (the #83 CSP fix permits `https://*.supabase.co` in `frame-src`).
3. Click **Regenerate**. Confirm: a new `projects.reports` row `version=2 issued`, the v1 row `superseded` with `superseded_by` set; handover has exactly one cert + one upload (the v1 origin-matched docs were deleted, not duplicated); an *unrelated* handover doc in those categories is untouched.
4. Confirm the certify path does not invoke `render-inspection-pdf` (grep the dev server logs; no edge call).

Use the project's DB-inspection approach for assertions (service-role SQL or the Supabase Studio). Record the row counts/ids checked.

- [ ] **Step 4: Commit any fixes from verification**

If verification surfaces a fix, make it, re-run Step 1, and commit with a descriptive message.

---

## Self-Review (completed during planning)

- **Spec coverage:** migration 00140 (Task 1) ✓; handover-filing extract + fileIntoHandover (Task 2) ✓; worker render→save→supersede→dedup→file (Task 3) ✓; certify wiring / retire edge invoke (Task 4) ✓; regenerate action + RBAC guard (Task 5/8) ✓; report page rewrite + Regenerate, drop Share/Revoke (Task 7) ✓; gatherer annex-own-only (Task 6) ✓; verification incl. dedup + CSP iframe (Task 9) ✓.
- **Type consistency:** worker `generateAndFileInspectionReport(params)` signature is identical in Task 3 (def), Task 4 (certify call), Task 5 (regenerate call + test mock). `fileIntoHandover(client, opts)` opts keys identical between Task 2 def and Task 3 calls. `ReportAnnexure.source` narrowed to `'attachment'` consistently (Task 6). `requireEffectiveRole` result uses `.ok`/`.error` per the real helper.
- **Out of scope (v1), per spec:** Share-link + Revoke (removed); group-nested `file` fields (excluded by field_id matching); deleting the `render-inspection-pdf` edge function (only retired from the certify path).
