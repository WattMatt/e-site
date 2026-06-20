# Multi-document Quote & Order Instruction slots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each board's **Quote** and **Order Instruction** slots in the Equipment & Materials tab hold *multiple* labelled documents (supplier / revision / variation), instead of one file that gets overwritten on re-upload.

**Architecture:** Drop the `UNIQUE (node_order_id, doc_type)` constraint on `structure.node_order_documents` and add `label` + `kind` columns (non-destructive migration). Reshape the per-slot data from a single `OrderDoc | null` to an `OrderDoc[]`. Replace the replace-on-upload server action with append / edit-meta / delete-by-id actions. Turn `UnifiedDocSlot` into a small list modelled on the existing `UnifiedShopDrawingList`.

**Tech Stack:** Next.js (App Router) + React, TypeScript, Supabase (Postgres `structure` schema via PostgREST + service-role for writes, RLS-gated cookie client for reads), Vitest.

**Working tree:** This plan runs in the worktree `~/dev/e-site-multidoc` on branch `feat/multi-doc-quote-order-docs` (based on `origin/main`, latest migration `00140`). Run all commands from `~/dev/e-site-multidoc/apps/web` unless stated otherwise.

**Pre-flight (run once before Task 1):**
```bash
cd ~/dev/e-site-multidoc
git fetch origin && git log --oneline -1 origin/main
ls apps/edge-functions/supabase/migrations/ | sort | tail -1
```
Expected: the latest migration is `00140_documents_origin_provenance.sql`. If a newer migration appears (origin moved), use the next free number instead of `00141` everywhere below, and rebase this branch onto the new `origin/main`.

---

### Task 1: Migration — drop the per-slot UNIQUE, add `label` + `kind`

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00141_node_order_documents_multi.sql`

- [ ] **Step 1: Write the migration**

Create `apps/edge-functions/supabase/migrations/00141_node_order_documents_multi.sql`:

```sql
-- =============================================================================
-- Migration 00141 — node_order_documents: multi-document Quote / Order slots
-- =============================================================================
-- The Quote and Order Instruction slots become multi-document: a node order may
-- now carry several quotes (e.g. competing suppliers) and several order
-- instructions (revisions, variations). Each document gains an optional
-- free-text label (supplier / note) and a kind tag.
--
-- Non-destructive: existing rows are preserved and default to kind='original',
-- label=NULL. Only the one-document-per-slot UNIQUE constraint is dropped.
--
-- Idempotent: IF EXISTS / IF NOT EXISTS throughout.
-- =============================================================================

-- ── 1. Drop the one-per-slot uniqueness (auto-named by 00086's inline UNIQUE) ──
ALTER TABLE structure.node_order_documents
  DROP CONSTRAINT IF EXISTS node_order_documents_node_order_id_doc_type_key;

-- ── 2. Per-document metadata ──────────────────────────────────────────────────
ALTER TABLE structure.node_order_documents
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS kind  TEXT NOT NULL DEFAULT 'original';

-- Constrain kind to the known set (separate + idempotent — ADD COLUMN cannot
-- re-add a CHECK on a re-run).
ALTER TABLE structure.node_order_documents
  DROP CONSTRAINT IF EXISTS node_order_documents_kind_check;
ALTER TABLE structure.node_order_documents
  ADD CONSTRAINT node_order_documents_kind_check
  CHECK (kind IN ('original', 'revision', 'variation'));
```

- [ ] **Step 2: Sanity-check the constraint name from 00086**

Run:
```bash
grep -n "UNIQUE (node_order_id, doc_type)" ~/dev/e-site-multidoc/apps/edge-functions/supabase/migrations/00086_node_order_documents.sql
```
Expected: one match (the inline `UNIQUE` — Postgres auto-names it `node_order_documents_node_order_id_doc_type_key`, which is what Step 1 drops). The `DROP CONSTRAINT IF EXISTS` is a no-op if the name differs, so confirm visually that 00086 defines it inline (no explicit `CONSTRAINT <name>`).

- [ ] **Step 3: Apply the migration**

Apply through the same path used for migration `00140` (the team's standard Supabase migration deploy — the same flow that put 00128–00140 live). If unsure of the exact command, **stop and confirm with the user how migrations are applied** before proceeding; the UI changes below need these columns to exist on the shared dev DB.

- [ ] **Step 4: Verify the schema change**

Run this against the target DB (psql / Supabase SQL editor):
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'structure' AND table_name = 'node_order_documents'
  AND column_name IN ('label', 'kind')
ORDER BY column_name;

SELECT conname FROM pg_constraint
WHERE conrelid = 'structure.node_order_documents'::regclass
  AND conname = 'node_order_documents_node_order_id_doc_type_key';
```
Expected: first query returns `kind | text | 'original'::text` and `label | text | (null)`; second query returns **zero rows** (the UNIQUE is gone).

- [ ] **Step 5: Commit**

```bash
cd ~/dev/e-site-multidoc
git add apps/edge-functions/supabase/migrations/00141_node_order_documents_multi.sql
git commit -m "feat(materials): migration — node_order_documents multi-doc (drop unique, add label+kind)"
```

---

### Task 2: Types + pure shaping → arrays (with unit test)

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/equipment-materials/_lib/order-types.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/equipment-materials/_lib/gather-unified-boards.ts:29,51`
- Test: `apps/web/src/app/(admin)/projects/[id]/equipment-materials/_lib/gather-unified-boards.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it(...)` block inside the `describe('gatherUnifiedBoards', ...)` in `gather-unified-boards.test.ts` (after the last existing test, before the closing `})`):

```ts
  it('carries multiple labelled documents per slot (quote + order_instruction lists)', () => {
    const docsByOrder: GatherInput['docsByOrder'] = new Map([
      [
        'o1',
        {
          quote: [
            { id: 'd1', storage_path: 'p/q1', file_name: 'supA.pdf', label: 'Supplier A', kind: 'original' },
            { id: 'd2', storage_path: 'p/q2', file_name: 'supB.pdf', label: 'Supplier B', kind: 'original' },
          ],
          order_instruction: [
            { id: 'd3', storage_path: 'p/o1', file_name: 'order.pdf', label: null, kind: 'original' },
            { id: 'd4', storage_path: 'p/o2', file_name: 'var.pdf', label: 'RFI-12', kind: 'variation' },
          ],
        },
      ],
    ])
    const input: GatherInput = { ...base, docsByOrder }
    const ca = gatherUnifiedBoards(input).find((g) => g.key === 'common_area_board')!
    const db10 = ca.boards.find((x) => x.code === 'DB-10')! // node n1 → order o1
    const line = db10.lines[0]
    expect(line.documents.quote).toHaveLength(2)
    expect(line.documents.quote.map((d) => d.label)).toEqual(['Supplier A', 'Supplier B'])
    expect(line.documents.order_instruction.map((d) => d.kind)).toEqual(['original', 'variation'])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd ~/dev/e-site-multidoc/apps/web
npx vitest run src/app/'(admin)'/projects/'[id]'/equipment-materials/_lib/gather-unified-boards.test.ts
```
Expected: FAIL — TypeScript/assertion error because `documents.quote` is currently `OrderDoc | null` (not an array) and `OrderDoc` has no `id`/`label`/`kind`.

- [ ] **Step 3: Update the `OrderDoc` type**

In `order-types.ts`, replace the `OrderDoc` interface (lines 12-16) with:

```ts
export type OrderDocKind = 'original' | 'revision' | 'variation'

/** A single attached order document (Quote / Order instruction). */
export interface OrderDoc {
  id: string
  storage_path: string
  file_name: string
  label: string | null
  kind: OrderDocKind
}
```

- [ ] **Step 4: Update the shaping types + EMPTY_DOCS in gather**

In `gather-unified-boards.ts`:

Line 29 — change the `documents` field of `ProcLine` to arrays:
```ts
  documents: { quote: OrderDoc[]; order_instruction: OrderDoc[] }
```

Line 51 — change `EMPTY_DOCS`:
```ts
const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: [], order_instruction: [] })
```

(The `toLine` body at line 83, `documents: docsByOrder.get(o.id) ?? EMPTY_DOCS()`, needs no change — the shape flows through.)

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd ~/dev/e-site-multidoc/apps/web
npx vitest run src/app/'(admin)'/projects/'[id]'/equipment-materials/_lib/gather-unified-boards.test.ts
```
Expected: PASS — all tests in the file green (the existing tests pass `docsByOrder: new Map()` and are unaffected).

- [ ] **Step 6: Commit**

```bash
cd ~/dev/e-site-multidoc
git add apps/web/src/app/'(admin)'/projects/'[id]'/equipment-materials/_lib/order-types.ts \
        apps/web/src/app/'(admin)'/projects/'[id]'/equipment-materials/_lib/gather-unified-boards.ts \
        apps/web/src/app/'(admin)'/projects/'[id]'/equipment-materials/_lib/gather-unified-boards.test.ts
git commit -m "feat(materials): OrderDoc gains id/label/kind; per-slot docs become arrays"
```

---

### Task 3: Page loader — select label/kind, push into arrays

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/equipment-materials/page.tsx:50,150-171`

- [ ] **Step 1: Update the page's `EMPTY_DOCS`**

In `page.tsx`, line 50, change:
```ts
const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: [], order_instruction: [] })
```

- [ ] **Step 2: Update the `node_order_documents` query + grouping**

In `page.tsx`, replace the document-loading block (the `.from('node_order_documents')` select through the end of its `for` loop — lines 150-171) with:

```ts
      const { data: docs } = await (supabase as never as {
        schema: (s: string) => { from: (t: string) => any }
      })
        .schema('structure')
        .from('node_order_documents')
        .select('id, node_order_id, doc_type, storage_path, file_name, label, kind, created_at')
        .in('node_order_id', orderIds)
        .order('created_at', { ascending: false })
      for (const d of (docs ?? []) as Array<{
        id: string
        node_order_id: string
        doc_type: string
        storage_path: string
        file_name: string
        label: string | null
        kind: 'original' | 'revision' | 'variation'
      }>) {
        let entry = docsByOrder.get(d.node_order_id)
        if (!entry) {
          entry = EMPTY_DOCS()
          docsByOrder.set(d.node_order_id, entry)
        }
        const ref = {
          id: d.id,
          storage_path: d.storage_path,
          file_name: d.file_name,
          label: d.label ?? null,
          kind: d.kind,
        }
        if (d.doc_type === 'quote') entry.quote.push(ref)
        else if (d.doc_type === 'order_instruction') entry.order_instruction.push(ref)
      }
```

- [ ] **Step 3: Type-check**

Run:
```bash
cd ~/dev/e-site-multidoc/apps/web
pnpm type-check
```
Expected: PASS (no errors). If `pnpm` is unavailable, use `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/e-site-multidoc
git add apps/web/src/app/'(admin)'/projects/'[id]'/equipment-materials/page.tsx
git commit -m "feat(materials): load all quote/order docs per slot (label, kind, newest-first)"
```

---

### Task 4: Server actions — add / update-meta / delete-by-id

**Files:**
- Modify: `apps/web/src/actions/node-order-document.actions.ts` (replace `attachNodeOrderDocumentAction` and `clearNodeOrderDocumentAction`; add a `structurePatch` helper)

- [ ] **Step 1: Add a `structurePatch` (PATCH) helper**

In `node-order-document.actions.ts`, directly after `structureDelete` (ends line 72), add:

```ts
async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  return { ok: true }
}
```

- [ ] **Step 2: Replace `attachNodeOrderDocumentAction` with `addNodeOrderDocumentAction`**

In `node-order-document.actions.ts`, replace the whole `attachNodeOrderDocumentAction` section (the `// ---- attachNodeOrderDocumentAction ----` banner through its closing `}` — lines 113-190) with:

```ts
// ---------------------------------------------------------------------------
// addNodeOrderDocumentAction — append a document to a slot (no replace)
// ---------------------------------------------------------------------------

const docKindSchema = z.enum(['original', 'revision', 'variation'])

const addSchema = z.object({
  projectId: uuidSchema,
  nodeOrderId: uuidSchema,
  docType: docTypeSchema,
  storagePath: z.string().min(1),
  fileName: z.string().min(1).max(255),
  label: z.string().max(120).nullable().optional(),
  kind: docKindSchema.optional(),
})

export type AddNodeOrderDocumentResult = { ok: true } | { error: string }

/**
 * Record an uploaded document against a node order's slot. Multiple documents
 * per (order, type) are allowed — this always inserts (append), never replaces.
 */
export async function addNodeOrderDocumentAction(
  projectId: string,
  nodeOrderId: string,
  docType: string,
  storagePath: string,
  fileName: string,
  label?: string | null,
  kind?: 'original' | 'revision' | 'variation',
): Promise<AddNodeOrderDocumentResult> {
  const parsed = addSchema.safeParse({ projectId, nodeOrderId, docType, storagePath, fileName, label, kind })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const orderErr = await guardOrderBelongsToProject(guard.supabase, nodeOrderId, projectId)
  if (orderErr) return orderErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const ins = await structureInsert(supabaseUrl, serviceKey, 'node_order_documents', {
    node_order_id: nodeOrderId,
    doc_type: parsed.data.docType,
    storage_path: parsed.data.storagePath,
    file_name: parsed.data.fileName,
    label: parsed.data.label ?? null,
    kind: parsed.data.kind ?? 'original',
    uploaded_by: guard.user.id,
  })
  if (!ins.ok) return { error: ins.error ?? 'Failed to record document' }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}
```

- [ ] **Step 3: Add `updateNodeOrderDocumentMetaAction` + a doc-ownership guard**

In `node-order-document.actions.ts`, immediately after the `addNodeOrderDocumentAction` you just added, insert:

```ts
// ---------------------------------------------------------------------------
// Shared: confirm a document belongs to the project, returning its row
// ---------------------------------------------------------------------------

/** Read a doc row (RLS-gated) and confirm its order is in the project. */
async function guardDocumentInProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentId: string,
  projectId: string,
): Promise<{ error: string } | { row: { node_order_id: string; storage_path: string } }> {
  const { data: doc } = await (supabase as never as {
    schema: (s: string) => { from: (t: string) => any }
  })
    .schema('structure')
    .from('node_order_documents')
    .select('node_order_id, storage_path')
    .eq('id', documentId)
    .maybeSingle()
  const row = doc as { node_order_id: string; storage_path: string } | null
  if (!row) return { error: 'Document not found' }

  const orderErr = await guardOrderBelongsToProject(supabase, row.node_order_id, projectId)
  if (orderErr) return orderErr
  return { row }
}

// ---------------------------------------------------------------------------
// updateNodeOrderDocumentMetaAction — edit a document's label + kind
// ---------------------------------------------------------------------------

const updateMetaSchema = z.object({
  projectId: uuidSchema,
  documentId: uuidSchema,
  label: z.string().max(120).nullable(),
  kind: docKindSchema,
})

export type UpdateNodeOrderDocumentMetaResult = { ok: true } | { error: string }

export async function updateNodeOrderDocumentMetaAction(
  projectId: string,
  documentId: string,
  meta: { label: string | null; kind: 'original' | 'revision' | 'variation' },
): Promise<UpdateNodeOrderDocumentMetaResult> {
  const parsed = updateMetaSchema.safeParse({ projectId, documentId, label: meta.label, kind: meta.kind })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const owned = await guardDocumentInProject(guard.supabase, documentId, projectId)
  if ('error' in owned) return owned

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const patch = await structurePatch(supabaseUrl, serviceKey, 'node_order_documents', `id=eq.${documentId}`, {
    label: parsed.data.label,
    kind: parsed.data.kind,
  })
  if (!patch.ok) return { error: patch.error ?? 'Failed to update document' }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}
```

- [ ] **Step 4: Replace `clearNodeOrderDocumentAction` with `deleteNodeOrderDocumentAction`**

In `node-order-document.actions.ts`, replace the whole `clearNodeOrderDocumentAction` section (the `// ---- clearNodeOrderDocumentAction ----` banner through its closing `}` — original lines 192-245) with:

```ts
// ---------------------------------------------------------------------------
// deleteNodeOrderDocumentAction — remove one document (row + storage object)
// ---------------------------------------------------------------------------

export type DeleteNodeOrderDocumentResult = { ok: true } | { error: string }

/** Delete a single document by id (DB row + its storage object). */
export async function deleteNodeOrderDocumentAction(
  projectId: string,
  documentId: string,
): Promise<DeleteNodeOrderDocumentResult> {
  const parsed = z
    .object({ projectId: uuidSchema, documentId: uuidSchema })
    .safeParse({ projectId, documentId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const owned = await guardDocumentInProject(guard.supabase, documentId, projectId)
  if ('error' in owned) return owned

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // DB row first (source of truth), then best-effort storage cleanup.
  const del = await structureDelete(supabaseUrl, serviceKey, 'node_order_documents', `id=eq.${documentId}`)
  if (!del.ok) return { error: del.error ?? 'Failed to remove document' }

  if (owned.row.storage_path) {
    await guard.supabase.storage.from(BUCKET).remove([owned.row.storage_path])
  }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}
```

- [ ] **Step 5: Update the file header doc comment**

In `node-order-document.actions.ts`, replace the action bullet list in the top comment (original lines 7-9) with:

```ts
 *   - addNodeOrderDocumentAction          — append a document to a slot
 *   - updateNodeOrderDocumentMetaAction   — edit a document's label + kind
 *   - deleteNodeOrderDocumentAction       — remove a document (row + storage)
 *   - getNodeOrderDocumentSignedUrlAction — short-lived signed URL for view/download
```

- [ ] **Step 6: Confirm no stale callers remain**

Run:
```bash
cd ~/dev/e-site-multidoc
grep -rn "attachNodeOrderDocumentAction\|clearNodeOrderDocumentAction" apps/web/src
```
Expected: matches **only** in `UnifiedDocSlot.tsx` (fixed in Task 5). No other files. (`tenant-delete.actions.ts` touches the table directly, not these actions — it is unaffected.)

- [ ] **Step 7: Type-check**

Run:
```bash
cd ~/dev/e-site-multidoc/apps/web
pnpm type-check
```
Expected: errors **only** from `UnifiedDocSlot.tsx` (still importing the removed actions). The actions file itself must be error-free. Task 5 clears the remaining errors.

- [ ] **Step 8: Commit**

```bash
cd ~/dev/e-site-multidoc
git add apps/web/src/actions/node-order-document.actions.ts
git commit -m "feat(materials): node-order-document actions — add/update-meta/delete-by-id"
```

---

### Task 5: UI — `UnifiedDocSlot` becomes a labelled multi-doc list

**Files:**
- Rewrite: `apps/web/src/app/(admin)/projects/[id]/equipment-materials/_components/UnifiedDocSlot.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/equipment-materials/_components/BoardDetail.tsx:115-116`

- [ ] **Step 1: Rewrite `UnifiedDocSlot.tsx`**

Replace the entire contents of `UnifiedDocSlot.tsx` with:

```tsx
'use client'

/**
 * UnifiedDocSlot — a multi-document slot (Quote / Order Instruction) on an
 * Equipment & Materials procurement line.
 *
 * Each slot holds a labelled list of documents (newest first). A document
 * carries a kind (Original / Revision / Variation) and an optional supplier /
 * note label, both editable inline. Upload appends via /api/node-order-documents
 * then addNodeOrderDocumentAction; the filename opens an in-app
 * DocumentPreviewModal.
 */

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addNodeOrderDocumentAction,
  updateNodeOrderDocumentMetaAction,
  deleteNodeOrderDocumentAction,
  getNodeOrderDocumentSignedUrlAction,
} from '@/actions/node-order-document.actions'
import { triggerDownload } from '@/lib/file-open'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { OrderDoc, OrderDocKind } from '@/app/(admin)/projects/[id]/equipment-materials/_lib/order-types'

export type OrderDocType = 'quote' | 'order_instruction'

const KIND_OPTIONS: { value: OrderDocKind; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'revision', label: 'Revision' },
  { value: 'variation', label: 'Variation' },
]

interface Props {
  projectId: string
  nodeOrderId: string
  docType: OrderDocType
  label: string
  docs: OrderDoc[]
}

export function UnifiedDocSlot({ projectId, nodeOrderId, docType, label, docs }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<OrderDoc | null>(null)
  const [, startTransition] = useTransition()

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('projectId', projectId)
      fd.append('nodeOrderId', nodeOrderId)
      fd.append('docType', docType)
      fd.append('file', file)

      const res = await fetch('/api/node-order-documents', { method: 'POST', body: fd })
      const json = (await res.json()) as { storagePath?: string; fileName?: string; error?: string }
      if (!res.ok || !json.storagePath) {
        throw new Error(json.error ?? `Upload failed (HTTP ${res.status})`)
      }

      const add = await addNodeOrderDocumentAction(
        projectId,
        nodeOrderId,
        docType,
        json.storagePath,
        json.fileName ?? file.name,
      )
      if ('error' in add) {
        await fetch('/api/node-order-documents', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: json.storagePath }),
        }).catch(() => {/* best-effort */})
        throw new Error(add.error)
      }
      refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDownload(d: OrderDoc) {
    setError(null)
    const res = await getNodeOrderDocumentSignedUrlAction(projectId, d.storage_path, d.file_name)
    if ('error' in res) setError(res.error)
    else triggerDownload(res.url)
  }

  async function handleMeta(d: OrderDoc, next: { label?: string | null; kind?: OrderDocKind }) {
    const label = next.label !== undefined ? next.label : d.label
    const kind = next.kind ?? d.kind
    if (label === d.label && kind === d.kind) return
    setError(null)
    setBusy(true)
    try {
      const res = await updateNodeOrderDocumentMetaAction(projectId, d.id, {
        label: label && label.length > 0 ? label : null,
        kind,
      })
      if ('error' in res) throw new Error(res.error)
      refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(d: OrderDoc) {
    setError(null)
    setBusy(true)
    try {
      const res = await deleteNodeOrderDocumentAction(projectId, d.id)
      if ('error' in res) throw new Error(res.error)
      refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
      <span style={{ color: 'var(--c-text-dim)' }}>{label}</span>

      {docs.length === 0 && <span style={{ color: 'var(--c-text-dim)' }}>—</span>}

      {docs.map((d) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setPreview(d)}
            title={d.file_name}
            style={{
              maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)', color: 'var(--c-text)',
              background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 4,
              padding: '1px 6px', cursor: 'pointer',
            }}
          >
            {d.file_name}
          </button>
          <button type="button" onClick={() => handleDownload(d)} disabled={busy} title="Download" style={linkBtn}>
            ↓
          </button>
          <select
            value={d.kind}
            disabled={busy}
            onChange={(e) => handleMeta(d, { kind: e.target.value as OrderDocKind })}
            title="Document kind"
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input
            type="text"
            defaultValue={d.label ?? ''}
            disabled={busy}
            placeholder="Supplier / note"
            onBlur={(e) => handleMeta(d, { label: e.target.value })}
            style={{
              fontSize: 11, padding: '1px 6px', width: 130,
              background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 4,
              color: 'var(--c-text)',
            }}
          />
          <button type="button" onClick={() => handleRemove(d)} disabled={busy} title="Remove" style={removeBtn}>
            ×
          </button>
        </div>
      ))}

      <label style={{ cursor: busy ? 'default' : 'pointer', color: 'var(--c-amber)', border: '1px dashed var(--c-border)', borderRadius: 4, padding: '1px 6px', alignSelf: 'flex-start' }}>
        {busy ? 'Working…' : '+ Add document'}
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={busy} />
      </label>

      {error && <span style={{ color: 'var(--c-red)' }}>{error}</span>}

      {preview && (
        <DocumentPreviewModal
          fileName={preview.file_name}
          fetchUrl={(download) =>
            getNodeOrderDocumentSignedUrlAction(projectId, preview.storage_path, download ? preview.file_name : undefined)
          }
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12, padding: 0,
}
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-red)', fontSize: 13, lineHeight: 1, padding: 0,
}
```

- [ ] **Step 2: Update `BoardDetail.tsx` to pass arrays**

In `BoardDetail.tsx`, replace lines 115-116:

```tsx
        <UnifiedDocSlot projectId={projectId} nodeOrderId={line.orderId} docType="quote" label="Quote" docs={line.documents.quote} />
        <UnifiedDocSlot projectId={projectId} nodeOrderId={line.orderId} docType="order_instruction" label="Order instr." docs={line.documents.order_instruction} />
```

- [ ] **Step 3: Type-check + run the equipment-materials tests**

Run:
```bash
cd ~/dev/e-site-multidoc/apps/web
pnpm type-check
npx vitest run src/app/'(admin)'/projects/'[id]'/equipment-materials
```
Expected: type-check PASS (no errors anywhere now); vitest PASS for the gather + DocumentPreviewModal tests.

- [ ] **Step 4: Lint the touched files**

Run:
```bash
cd ~/dev/e-site-multidoc/apps/web
pnpm lint
```
Expected: PASS (no new lint errors in the touched files).

- [ ] **Step 5: Commit**

```bash
cd ~/dev/e-site-multidoc
git add apps/web/src/app/'(admin)'/projects/'[id]'/equipment-materials/_components/UnifiedDocSlot.tsx \
        apps/web/src/app/'(admin)'/projects/'[id]'/equipment-materials/_components/BoardDetail.tsx
git commit -m "feat(materials): UnifiedDocSlot is a labelled multi-document list"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (runtime verification on the running app).

This needs the migration (Task 1) applied to the dev DB and the dev server running (`cd ~/dev/e-site-multidoc/apps/web && pnpm dev`), signed in to a project where you can manage procurement. See the project's local-dev notes for env/login (the real Supabase config lives under `apps/edge-functions`).

- [ ] **Step 1: Multiple suppliers**

On a board's **Quote** slot, click **+ Add document** and upload three files. Set each kind to `Original` and type a different supplier in each label (e.g. "Supplier A", "Supplier B", "Supplier C"). Reload the page.
Expected: all three persist, newest on top, with their labels and `Original` kind.

- [ ] **Step 2: Revision keeps history**

On the **Order Instruction** slot, add a document and set its kind to `Revision`. Add another and leave it `Original`.
Expected: both rows remain — adding does not overwrite the original.

- [ ] **Step 3: Variation**

Add a document to **Order Instruction**, set kind `Variation`, label "RFI-12".
Expected: it lists alongside the others with the `Variation` kind and label, after reload.

- [ ] **Step 4: Edit persists**

Change a document's label and kind inline (blur the label field; change the kind select). Reload.
Expected: the edited label + kind persist.

- [ ] **Step 5: Delete removes the orphan**

Delete one document (`×`). Reload.
Expected: that row is gone and the others remain. (Optional storage check: in Supabase Storage, the deleted object is no longer present under `node-order-documents/{projectId}/{nodeOrderId}/{docType}/`.)

- [ ] **Step 6: Existing single docs survived the migration**

On a board that had a single Quote / Order Instruction before the migration, confirm it still appears (as a single `Original`, no label) and still downloads/previews.

- [ ] **Step 7: Final full check + finish the branch**

Run:
```bash
cd ~/dev/e-site-multidoc/apps/web
pnpm type-check && pnpm lint && pnpm test
```
Expected: all PASS. Then invoke the **superpowers:finishing-a-development-branch** skill to decide how to integrate (PR vs merge) `feat/multi-doc-quote-order-docs`.

---

## Self-Review (completed while writing this plan)

**Spec coverage:**
- Migration (drop UNIQUE, add label+kind) → Task 1.
- `OrderDoc` gains id/label/kind; per-slot arrays; `EMPTY_DOCS` ×2 → Tasks 2 & 3.
- Loader selects label/kind, newest-first → Task 3.
- add / update-meta / delete-by-id actions + remove old replace/clear → Task 4.
- `UnifiedDocSlot` multi-doc list (preview, download, inline kind/label, delete, add) + `BoardDetail` array props → Task 5.
- Storage / API / RLS / Shop Drawings unchanged → no task touches them (verified by grep in Task 4 Step 6).
- All "Testing / verification" spec bullets → Task 2 unit test + Task 6 manual steps.

**Placeholder scan:** none — every code step shows full code; the only deferred item is the migration-apply *command* (Task 1 Step 3), which is an environment fact the implementer must confirm with the user, flagged explicitly rather than guessed.

**Type consistency:** `OrderDoc { id, storage_path, file_name, label, kind }` and `OrderDocKind` are defined in Task 2 and used identically in Tasks 3 (loader `ref`), 4 (action schemas/params), and 5 (component). `documents: { quote: OrderDoc[]; order_instruction: OrderDoc[] }` is consistent across gather, page loader, and `BoardDetail` props. Action names (`addNodeOrderDocumentAction`, `updateNodeOrderDocumentMetaAction`, `deleteNodeOrderDocumentAction`) match between Task 4 (definitions) and Task 5 (imports/calls).
