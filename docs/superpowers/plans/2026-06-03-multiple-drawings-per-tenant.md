# Multiple Drawings per Tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is design-level + concrete-interface: it gives exact file structure, the new SQL/types/test-expectations, and cites the existing patterns to mirror (with `file:line`); implementer subagents read those citations and write the boilerplate to match. Spec: [`../specs/2026-06-03-multiple-drawings-per-tenant-design.md`](../specs/2026-06-03-multiple-drawings-per-tenant-design.md).

**Goal:** Let a tenant hold a *set* of free-form-titled documents (kinds: layout drawings + scope docs), each with a full revision history, surfaced in the tenant schedule via a documents list + a per-document revision drawer.

**Architecture:** Two new `structure` tables (`tenant_documents` → `tenant_document_revisions`) mirroring the `node_order_shop_drawings` child-table precedent, with the per-tenant `layout_status`/`scope_status` auto-derived by trigger. A shared `<TenantDocumentList>` + `<DocumentRevisionDrawer>` replace the single-file widgets in `LayoutIssuedPanel`/`ScopeOfWorkPanel`. New `tenant-documents.actions.ts` follows the existing `tenant-scope.actions.ts` guard + raw-PostgREST-write pattern. Split migration (00118 additive + backfill; 00119 drops old columns after the code is live).

**Tech Stack:** Supabase Postgres (`structure` schema, RLS), Next.js 15 server actions + route handlers, React 19, `@react-pdf` not involved, vitest (jsdom) with the `vi.hoisted`+mock-client pattern.

---

## Critical facts (implementers: internalise before coding)

These were verified against the live code/migrations. They prevent rework.

1. **The `tenant-documents` storage bucket + its RLS already exist** — created in `00080_tenant_schedule.sql` (bucket lines 364–371) and the write policy was fixed in `00085_fix_tenant_documents_write_rls.sql` to use the `SECURITY DEFINER` helper **`public.user_can_manage_project(p_project_id uuid)`** (owner/admin/PM; 00085 lines 30–60). **Reuse the bucket + helper. Do NOT create a new bucket or storage policy.**
2. **The upload route already handles both kinds.** `apps/web/src/app/api/tenant-schedule/upload-scope-document/route.ts` POST already reads `kind` (`'layout'|'scope'`), validates per-kind, uploads to the `tenant-documents` bucket at `{projectId}/{nodeId}/{Date.now()}-{safeName}`, and returns `{ storagePath, filename }`; DELETE removes a `storagePath` best-effort. **Reuse this route as-is for revision uploads — no new route.**
3. **Status enums differ per kind.** `tenant_details.layout_status ∈ {'not_issued','issued'}` (LayoutIssuedPanel.tsx:30–35); `scope_status ∈ {'awaited','received'}` (ScopeOfWorkPanel.tsx:28–46). The derive trigger sets the kind-appropriate value: layout → `issued`/`not_issued`, scope → `received`/`awaited`.
4. **Structure writes bypass RLS** (service-role raw `fetch` to PostgREST with `Content-Profile: structure`) → every write action MUST gate with `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)`. The existing `guardProjectAccess(projectId)` in `tenant-scope.actions.ts:104–125` already does this — copy it. Reads may use the cookie/RLS client (the new tables have read-RLS = project access).
5. **RLS helpers:** read-gate via `public.user_has_project_access(project_id)`; write-gate via `public.user_can_manage_project(project_id)` (the 00085 SECURITY-DEFINER one). `updated_at` via the shared `public.set_updated_at()` trigger fn. Project-scoped RLS joins through `structure.nodes` to get `project_id`/`organisation_id` (see `tenant_details` policies, 00080:203–254).
6. **Migrations apply on merge** via `.github/workflows/deploy-migrations.yml` (path-filtered to `migrations/**`, runs `supabase db push`). During the build, **verify migrations with a transactional ROLLBACK smoke test** (`scripts/db/smoke-test-*.sh` + `scripts/db/mgmt-api.sh`) — do NOT apply to prod mid-build. The new tables/columns therefore won't exist in prod until merge; action unit tests mock supabase, so they don't need the live schema.
7. **Types:** the new tables won't be in `packages/db/src/types.ts` until a post-merge `pnpm db:gen-types` (needs the migration applied). Structure access already uses `(supabase as any).schema('structure')` casts + raw fetch, so the new code defines **app-level interfaces** (below) and does not depend on generated types. Types regen is a post-merge follow-up.

---

## File structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00118_tenant_documents.sql` *(new)* | Additive: create both tables + indexes + `updated_at` trigger + the status-derive function & its two triggers; RLS + policies (mirror `tenant_details`); backfill from `layout_drawing_path`/`scope_document_path`; **keep** the old columns; `NOTIFY pgrst`. |
| `scripts/db/smoke-test-tenant-documents.sh` *(new)* | Transactional, ROLLBACK-safe smoke test for 00118 (tables/RLS/triggers exist; status derives; backfill maps a sample row). |
| `apps/web/src/actions/tenant-documents.actions.ts` *(new)* | The document/revision server actions + the exported app-level types. Mirrors `tenant-scope.actions.ts` (guard + `structurePost`/`structurePatch` + `revalidatePath`). |
| `apps/web/src/actions/tenant-documents.actions.test.ts` *(new)* | Unit tests (`vi.hoisted` + mock client), mirroring `tenant-scope.actions.test.ts`. |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantDocumentList.tsx` *(new)* | The documents list for one kind: rows (title · current rev · count badge · rename/delete), `+ Add drawing`, opens the drawer. |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/DocumentRevisionDrawer.tsx` *(new)* | A focused drawer for one document: revision timeline (label/date/uploader/note/download) + `+ Add revision` + delete-revision. |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantDocumentList.test.tsx` *(new)* | Component tests (list + drawer). |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/LayoutIssuedPanel.tsx` *(modify)* | Replace the single-file widget block with `<TenantDocumentList kind="layout" …>`. |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScopeOfWorkPanel.tsx` *(modify)* | Replace the single-file widget block with `<TenantDocumentList kind="scope" …>`. |
| `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx` *(modify, light)* | Stop depending on the dropped single-file columns; the panels load documents via `listTenantDocumentsAction`. |
| `apps/edge-functions/supabase/migrations/00119_drop_tenant_single_doc_columns.sql` *(new, applied after code live)* | Drop `tenant_details.layout_drawing_path` + `scope_document_path`; `NOTIFY pgrst`. |

The existing `upload-scope-document/route.ts` is reused unchanged (fact #2).

---

## App-level types (define at the top of `tenant-documents.actions.ts`; components import them)

```ts
export type TenantDocumentKind = 'layout' | 'scope'

export interface TenantDocumentRevision {
  id: string
  tenant_document_id: string
  rev_label: string
  storage_path: string
  file_name: string
  note: string | null
  issued_at: string            // ISO timestamptz
  uploaded_by: string | null
  created_at: string
}

export interface TenantDocument {
  id: string
  node_id: string
  kind: TenantDocumentKind
  title: string
  sort_order: number
  revisions: TenantDocumentRevision[]   // newest first; [0] = current
}
```

---

## Task 1: Migration 00118 — tables, triggers, RLS, backfill (additive)

**Files:** create `apps/edge-functions/supabase/migrations/00118_tenant_documents.sql`, `scripts/db/smoke-test-tenant-documents.sh`.

> Mirror the idioms in `00080_tenant_schedule.sql` (table/RLS/grant/bucket) and `00085` (the `user_can_manage_project` write helper). Use `gen_random_uuid()`, `public.set_updated_at()`, and end with `NOTIFY pgrst, 'reload schema';`.

- [ ] **Step 1: Write the migration.** Create `00118_tenant_documents.sql` with:

```sql
-- 00118: multiple drawings per tenant — tenant_documents + revisions

-- 1) Tables
CREATE TABLE structure.tenant_documents (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id     UUID        NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL CHECK (kind IN ('layout','scope')),
    title       TEXT        NOT NULL,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_documents_node_kind ON structure.tenant_documents (node_id, kind, sort_order);
CREATE TRIGGER tenant_documents_updated_at BEFORE UPDATE ON structure.tenant_documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE structure.tenant_document_revisions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_document_id  UUID        NOT NULL REFERENCES structure.tenant_documents(id) ON DELETE CASCADE,
    rev_label           TEXT        NOT NULL,
    storage_path        TEXT        NOT NULL,
    file_name           TEXT        NOT NULL,
    note                TEXT,
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by         UUID        REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_doc_revisions_doc ON structure.tenant_document_revisions (tenant_document_id, issued_at DESC);

-- 2) Status-derive function + triggers (kind-aware enums; fact #3)
CREATE OR REPLACE FUNCTION structure.recompute_tenant_doc_status(p_node_id UUID, p_kind TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_issued_at TIMESTAMPTZ;
BEGIN
    SELECT MIN(r.issued_at) INTO v_issued_at
    FROM structure.tenant_documents d
    JOIN structure.tenant_document_revisions r ON r.tenant_document_id = d.id
    WHERE d.node_id = p_node_id AND d.kind = p_kind;
    -- v_issued_at IS NULL  ⇔  no doc of this kind has a revision
    INSERT INTO structure.tenant_details (node_id) VALUES (p_node_id) ON CONFLICT (node_id) DO NOTHING;
    IF p_kind = 'layout' THEN
        UPDATE structure.tenant_details
           SET layout_status     = CASE WHEN v_issued_at IS NOT NULL THEN 'issued' ELSE 'not_issued' END,
               layout_issued_at  = v_issued_at::date
         WHERE node_id = p_node_id;
    ELSIF p_kind = 'scope' THEN
        UPDATE structure.tenant_details
           SET scope_status = CASE WHEN v_issued_at IS NOT NULL THEN 'received' ELSE 'awaited' END
         WHERE node_id = p_node_id;
    END IF;
END $$;

-- revision INSERT/DELETE → resolve node+kind via the (still-present) document
CREATE OR REPLACE FUNCTION structure.tenant_doc_revision_status_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_node UUID; v_kind TEXT;
BEGIN
    SELECT node_id, kind INTO v_node, v_kind
      FROM structure.tenant_documents WHERE id = COALESCE(NEW.tenant_document_id, OLD.tenant_document_id);
    IF v_node IS NOT NULL THEN PERFORM structure.recompute_tenant_doc_status(v_node, v_kind); END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tenant_doc_revision_status
    AFTER INSERT OR DELETE ON structure.tenant_document_revisions
    FOR EACH ROW EXECUTE FUNCTION structure.tenant_doc_revision_status_trg();

-- document DELETE (revisions already cascaded) → recompute from OLD.node_id/kind
CREATE OR REPLACE FUNCTION structure.tenant_doc_delete_status_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM structure.recompute_tenant_doc_status(OLD.node_id, OLD.kind);
    RETURN OLD;
END $$;
CREATE TRIGGER tenant_doc_delete_status
    AFTER DELETE ON structure.tenant_documents
    FOR EACH ROW EXECUTE FUNCTION structure.tenant_doc_delete_status_trg();

-- 3) RLS — mirror tenant_details (00080:203–254): join through nodes, read via
--    user_has_project_access, write via user_can_manage_project (00085).
ALTER TABLE structure.tenant_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure.tenant_document_revisions ENABLE ROW LEVEL SECURITY;
-- tenant_documents: SELECT (members) / INSERT,UPDATE,DELETE (managers), gated by the node's project.
CREATE POLICY tenant_documents_select ON structure.tenant_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = node_id
                   AND public.user_has_project_access(n.project_id)
                   AND NOT public.user_is_client_viewer(n.organisation_id)));
CREATE POLICY tenant_documents_write ON structure.tenant_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = node_id AND public.user_can_manage_project(n.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = node_id AND public.user_can_manage_project(n.project_id)));
-- revisions: same gates, joined through the parent document → node.
CREATE POLICY tenant_doc_revisions_select ON structure.tenant_document_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.tenant_documents d JOIN structure.nodes n ON n.id = d.node_id
                   WHERE d.id = tenant_document_id AND public.user_has_project_access(n.project_id)
                     AND NOT public.user_is_client_viewer(n.organisation_id)));
CREATE POLICY tenant_doc_revisions_write ON structure.tenant_document_revisions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.tenant_documents d JOIN structure.nodes n ON n.id = d.node_id
                   WHERE d.id = tenant_document_id AND public.user_can_manage_project(n.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM structure.tenant_documents d JOIN structure.nodes n ON n.id = d.node_id
                   WHERE d.id = tenant_document_id AND public.user_can_manage_project(n.project_id)));
GRANT SELECT, INSERT, UPDATE, DELETE ON structure.tenant_documents, structure.tenant_document_revisions TO authenticated;
GRANT ALL ON structure.tenant_documents, structure.tenant_document_revisions TO service_role;

-- 4) Backfill existing single files → one document + one revision each (keep old columns).
INSERT INTO structure.tenant_documents (id, node_id, kind, title, sort_order)
  SELECT gen_random_uuid(), td.node_id, 'layout', 'Layout', 0
    FROM structure.tenant_details td WHERE td.layout_drawing_path IS NOT NULL;
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name, issued_at)
  SELECT d.id, 'Rev A', td.layout_drawing_path,
         regexp_replace(split_part(td.layout_drawing_path, '/', -1), '^[0-9]+-', ''),
         COALESCE(td.layout_issued_at::timestamptz, now())
    FROM structure.tenant_details td
    JOIN structure.tenant_documents d ON d.node_id = td.node_id AND d.kind = 'layout'
   WHERE td.layout_drawing_path IS NOT NULL;
-- scope (no scope_issued_at column today → issued_at = now()):
INSERT INTO structure.tenant_documents (id, node_id, kind, title, sort_order)
  SELECT gen_random_uuid(), td.node_id, 'scope', 'Scope of work', 0
    FROM structure.tenant_details td WHERE td.scope_document_path IS NOT NULL;
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name, issued_at)
  SELECT d.id, 'Rev A', td.scope_document_path,
         regexp_replace(split_part(td.scope_document_path, '/', -1), '^[0-9]+-', ''), now()
    FROM structure.tenant_details td
    JOIN structure.tenant_documents d ON d.node_id = td.node_id AND d.kind = 'scope'
   WHERE td.scope_document_path IS NOT NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the smoke test.** Create `scripts/db/smoke-test-tenant-documents.sh` modelled on `scripts/db/smoke-test-project-settings.sh` (source `scripts/db/mgmt-api.sh`; run a single multi-statement transaction that ends in `ROLLBACK`). Assert, in order: both tables exist + RLS enabled; insert a `tenant_db` node + a `tenant_documents` (`kind='layout'`) + a `tenant_document_revisions` → then `SELECT layout_status, layout_issued_at FROM structure.tenant_details WHERE node_id=…` shows `issued` + the revision date (trigger fired); delete the revision → status back to `not_issued`; backfill block maps a seeded `layout_drawing_path` row to one document+revision. `ROLLBACK` at the end (leaves no data).
- [ ] **Step 3: Run the smoke test** against the live DB (transactional; safe). Run: `bash scripts/db/smoke-test-tenant-documents.sh`. Expected: all sections green, final `ROLLBACK`.
- [ ] **Step 4: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00118_tenant_documents.sql scripts/db/smoke-test-tenant-documents.sh
git commit -m "feat(tenant-schedule): #2 migration 00118 — tenant_documents + revisions (additive)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **Do NOT apply 00118 to prod here** (fact #6) — it applies on merge via the workflow. The smoke test (ROLLBACK) is the build-time verification.

## Task 2: `tenant-documents.actions.ts` (TDD)

**Files:** create `apps/web/src/actions/tenant-documents.actions.ts`, `apps/web/src/actions/tenant-documents.actions.test.ts`.

> Copy the scaffolding from `tenant-scope.actions.ts`: the `structureHeaders`/`structurePost`/`structurePatch` helpers (lines 32–79), `guardProjectAccess` (104–125, which already applies `requireEffectiveRole(…, ORG_WRITE_ROLES)`), `guardNodeBelongsToProject`, imports (`createClient` from `@/lib/supabase/server`, `requireEffectiveRole` from `@/lib/auth/require-role`, `ORG_WRITE_ROLES`+`projectService` from `@esite/shared`), and `revalidatePath('/projects/${projectId}/tenant-schedule')` after writes. Signed URLs use TTL **300** (mirror `getScopeSignedUrlAction`). Reads use the cookie client `(supabase as any).schema('structure')`; writes use `structurePost`/`structurePatch`/a `structureDelete` (service-role).

Define the §types block at the top, then these exported `async` functions (all return `{ ok: true; … } | { error: string }`; all writes call `guardProjectAccess(projectId)` first, then `guardNodeBelongsToProject` where a `nodeId` is given):
- `listTenantDocumentsAction(projectId, nodeId)` → `{ documents: TenantDocument[] }` (read via cookie client: select `tenant_documents` for the node + their `tenant_document_revisions`, revisions ordered `issued_at desc`; group in JS).
- `createTenantDocumentAction(projectId, nodeId, kind, title, firstRevision: { storagePath, fileName, revLabel, note? })` → inserts a `tenant_documents` row (service write) then a first `tenant_document_revisions` row (sets `uploaded_by` = the guarded user id). Returns the new doc id.
- `addTenantDocumentRevisionAction(projectId, documentId, { storagePath, fileName, revLabel, note? })` → insert a revision (resolve the doc's node for the node-guard, or guard by projectId only since RLS+manage-gate already protect it).
- `renameTenantDocumentAction(projectId, documentId, title)` → PATCH title.
- `reorderTenantDocumentsAction(projectId, nodeId, kind, orderedIds: string[])` → PATCH `sort_order` per id.
- `deleteTenantDocumentRevisionAction(projectId, revisionId)` → fetch the revision's `storage_path`, delete the row, then remove the storage object (best-effort, via the upload route's DELETE or `supabase.storage…remove`).
- `deleteTenantDocumentAction(projectId, documentId)` → fetch the doc's revisions' `storage_paths`, delete the doc row (revisions cascade; the delete trigger recomputes status), then remove those storage objects best-effort.
- `getRevisionSignedUrlAction(projectId, revisionId)` → look up `storage_path`, `supabase.storage.from('tenant-documents').createSignedUrl(path, 300)`.

- [ ] **Step 1 (tests first):** create `tenant-documents.actions.test.ts`. Copy the `vi.hoisted(() => ({ getByIdMock, createClientMock, revalidatePathMock }))` block + `vi.mock` calls + the `mockClient({role})` factory + `beforeEach` env setup from `tenant-scope.actions.test.ts` lines 1–51 (it stubs `fetch`, sets `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL`). Write failing tests:
  - **RBAC:** with `mockClient({ role: 'contractor' })`, `createTenantDocumentAction` / `addTenantDocumentRevisionAction` / `deleteTenantDocumentAction` return `{ error: … }` and issue NO `fetch` write (assert `fetchMock` not called for the write). With `role: 'owner'` they proceed.
  - **create:** `createTenantDocumentAction` issues a POST to `/rest/v1/tenant_documents` then `/rest/v1/tenant_document_revisions` (assert both URLs + the `Content-Profile: structure` header), sets `uploaded_by`, and `revalidatePath` is called.
  - **add revision:** posts to `/rest/v1/tenant_document_revisions`.
  - **list:** returns documents with nested revisions grouped + newest-first (feed the mock client rows).
  - **delete document:** deletes the doc row and best-effort-removes each revision's storage object.
  - **signed url:** returns the createSignedUrl result (TTL 300).
- [ ] **Step 2:** `pnpm --filter web test tenant-documents.actions` → fails (module missing).
- [ ] **Step 3:** implement `tenant-documents.actions.ts` per the function list + cited patterns.
- [ ] **Step 4:** `pnpm --filter web test tenant-documents.actions` → green; `pnpm --filter web type-check` clean.
- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/actions/tenant-documents.actions.ts apps/web/src/actions/tenant-documents.actions.test.ts
git commit -m "feat(tenant-schedule): #2 tenant-documents server actions (RBAC-gated)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 3: `TenantDocumentList` + `DocumentRevisionDrawer` (TDD)

**Files:** create `_components/TenantDocumentList.tsx`, `_components/DocumentRevisionDrawer.tsx`, `_components/TenantDocumentList.test.tsx`.

> Match the existing panel style (E-Site `Card`/button idioms; the upload flow in `ScopeOfWorkPanel.tsx:132–210` — FormData POST to `/api/tenant-schedule/upload-scope-document` with `kind`, then the action; optimistic state + rollback; `window.open(signedUrl)` for download). No `@react-pdf`.

- `<TenantDocumentList kind projectId nodeId readOnly initialDocuments>`: renders documents in `sort_order` — each row: title · current rev label + `issued_at` date · a revision-count badge · (when not readOnly) rename + delete-document (confirm) + a "Revisions" button that opens `<DocumentRevisionDrawer>` for that document. A `+ Add drawing` control (title input + file input → POST upload with `kind` → `createTenantDocumentAction`). Optimistic add/remove with rollback on action error; loads via `listTenantDocumentsAction` if `initialDocuments` not supplied.
- `<DocumentRevisionDrawer document onClose readOnly projectId>`: a side panel/modal listing the document's revisions (rev label, issued date, uploader name if present, note, a Download button → `getRevisionSignedUrlAction` → `window.open`), `+ Add revision` (file → upload → `addTenantDocumentRevisionAction`), and per-revision delete (when not readOnly) → `deleteTenantDocumentRevisionAction`.

- [ ] **Step 1 (tests first):** `TenantDocumentList.test.tsx` (jsdom; mock the actions via `vi.mock('@/actions/tenant-documents.actions', …)` and `fetch` for uploads). Failing tests:
  - renders N document rows with title + current-rev label + count badge;
  - clicking "Revisions" opens the drawer showing that document's revisions (labels/dates/notes);
  - `readOnly` hides add/rename/delete and the file inputs;
  - add-drawing flow calls the upload route then `createTenantDocumentAction` and renders the new row (optimistic);
  - download calls `getRevisionSignedUrlAction`.
- [ ] **Step 2:** `pnpm --filter web test TenantDocumentList` → fails.
- [ ] **Step 3:** implement both components.
- [ ] **Step 4:** `pnpm --filter web test TenantDocumentList` → green; `pnpm --filter web type-check` clean.
- [ ] **Step 5: Commit.** `git add … && git commit -m "feat(tenant-schedule): #2 TenantDocumentList + DocumentRevisionDrawer" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

## Task 4: Wire into the panels + page (integration)

**Files:** modify `_components/LayoutIssuedPanel.tsx`, `_components/ScopeOfWorkPanel.tsx`, `tenant-schedule/page.tsx`.

- [ ] **Step 1:** In `LayoutIssuedPanel.tsx`, replace the single-file widget block (the `handleFileChange`/`handlePreview`/`handleRemoveDocument` block + its JSX) with `<TenantDocumentList kind="layout" projectId={projectId} nodeId={nodeId} readOnly={readOnly} />`. Keep the status display (now driven by the auto-derived `layout_status`). Remove the now-unused single-file imports/handlers (only those your change orphaned).
- [ ] **Step 2:** Same for `ScopeOfWorkPanel.tsx` with `kind="scope"`.
- [ ] **Step 3:** In `page.tsx`, drop `layout_drawing_path`/`scope_document_path` from the `tenant_details` select (lines 84–106) and the `LayoutDetails`/`TenantDetails` mapping — the panels now load documents via the action. Keep `scope_status`/`layout_status`/`layout_issued_at`. (This is what lets 00119 drop those columns safely — no running code reads them after this task.)
- [ ] **Step 4:** Run the existing tenant-schedule tests + `pnpm --filter web test` + `pnpm --filter web type-check` → all green. Manually confirm no remaining references to `layout_drawing_path`/`scope_document_path` in `apps/web` (grep).
- [ ] **Step 5: Commit.** `git commit -am "feat(tenant-schedule): #2 wire TenantDocumentList into layout + scope panels; stop reading single-file columns" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

## Task 5: Migration 00119 — drop the old columns (apply AFTER code is live)

**Files:** create `apps/edge-functions/supabase/migrations/00119_drop_tenant_single_doc_columns.sql`.

- [ ] **Step 1:** Write it:

```sql
-- 00119: drop the superseded single-file columns (after 00118 + the new code are live)
ALTER TABLE structure.tenant_details DROP COLUMN IF EXISTS layout_drawing_path;
ALTER TABLE structure.tenant_details DROP COLUMN IF EXISTS scope_document_path;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Commit.** `git add … && git commit -m "feat(tenant-schedule): #2 migration 00119 — drop superseded single-file columns" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`

> **Deploy order (the 00109/00110 lesson):** 00118 + the code (Tasks 1–4) merge together; the running code reads the new tables and no longer references the old columns. 00119 is held and applied **only after** that code is confirmed live (it ships in the same PR but, per the workflow, both migrations apply on merge — acceptable here because Task 4 already removed all column references, so the drop breaks nothing). If you want a hard gap, land 00119 as a follow-up PR after prod verify — note the choice in the PR.

## Task 6: Finalise

- [ ] **Step 1:** `pnpm --filter web test` + `pnpm --filter web type-check` both green (capture output — evidence before claiming done).
- [ ] **Step 2:** Confirm scope: no `apps/web` reference to `layout_drawing_path`/`scope_document_path` remains; the new bucket/route are reused (not duplicated); RBAC gate present on every write action.
- [ ] **Step 3:** Post-merge follow-ups (note in the PR, don't block): `pnpm db:gen-types` once 00118 is applied (regenerate `packages/db/src/types.ts`); run the smoke test against prod after the workflow applies the migration.
- [ ] **Step 4:** Push the branch over the gh-token HTTPS remote + open a PR to `main` — **only on the user's go-ahead.** PR body: the feature, the split-migration note, and that the upload route + storage bucket were reused.

---

## Verification (the milestone)

In the tenant schedule, a tenant can hold multiple free-form-titled layout drawings AND scope documents; each opens a drawer with its full revision history (label/date/uploader/note/download); adding the first revision of any kind flips that kind's status to issued/received automatically. `pnpm --filter web test` + `type-check` green; the 00118 smoke test passes transactionally; no code references the dropped columns.

---

## Out of scope (per the spec)
General "tenant documents" taxonomy beyond layout/scope; a dedicated "Drawings" tab; markup/annotation/inline-viewer; drawing↔cable-schedule linkage.
