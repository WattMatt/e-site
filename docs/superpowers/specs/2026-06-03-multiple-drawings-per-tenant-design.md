# Multiple Drawings per Tenant — Design Spec

**Date:** 2026-06-03
**Status:** Approved in brainstorming — pending implementation plan
**Backlog item:** #2 — tenant schedule must handle tenants with more than one drawing
**Branch:** `feat/tenant-multiple-drawings`

---

## 1. Problem & context

The tenant schedule (`/projects/[id]/tenant-schedule`) models each tenant's documents as **single files**: `structure.tenant_details.layout_drawing_path` (one layout drawing) and `scope_document_path` (one scope-of-work doc) — each a scalar `TEXT` column — with a tenant-level `layout_status` / `scope_status` that flips to `issued` on upload. Real tenants often have **more than one drawing** (e.g. ground-floor layout + mezzanine + shopfront), and drawings get **revised** over time. The single-column model supports neither.

A tenant is a `structure.nodes` row with `kind='tenant_db'` (00074). The schedule UI — `tenant-schedule/page.tsx`, `_components/ScheduleTable.tsx`, `_components/LayoutIssuedPanel.tsx`, `_components/ScopeOfWorkPanel.tsx` — renders one file + status per kind, via `tenant-scope.actions.ts` (`attachLayoutDrawingAction`, `getLayoutSignedUrlAction`) and the `api/tenant-schedule/upload-scope-document` route. The repo already has a proven "multiple-X" child-table precedent: `structure.node_order_shop_drawings` (00115, PR #35).

## 2. Decisions (locked in brainstorming)

1. **Both distinct drawings AND revisions** — a tenant has a *set* of documents, each independently revised. Three levels: tenant → document → revisions.
2. **Free-form titles** — each document has a user-typed title; no fixed type taxonomy.
3. **Full revision records** — each revision tracks a label, issue date, uploader, optional note; any revision is reopenable/downloadable. Latest = current.
4. **Tenant-level, auto-derived status** — `layout_status` / `scope_status` stay per-tenant and flip to `issued` automatically once that kind has ≥1 document with ≥1 revision.
5. **Both kinds** — the model covers layout drawings AND scope documents via a `kind` discriminator (not layout only).
6. **UI = Approach B (list + revision drawer)** — the panel lists the tenant's documents (title + revision count); selecting one opens a focused drawer showing that document's full revision history.

## 3. Data model

Two new tables in the `structure` schema.

### 3.1 `structure.tenant_documents` — one row per distinct document
| column | type | notes |
|--------|------|-------|
| `id` | uuid PK | |
| `node_id` | uuid NOT NULL → `structure.nodes(id)` ON DELETE CASCADE | the tenant (`kind='tenant_db'`) |
| `kind` | text NOT NULL, CHECK `kind IN ('layout','scope')` | document kind |
| `title` | text NOT NULL | free-form |
| `sort_order` | int NOT NULL DEFAULT 0 | display order within a kind |
| `created_at` / `updated_at` | timestamptz | `updated_at` trigger |

Index: `(node_id, kind, sort_order)`.

### 3.2 `structure.tenant_document_revisions` — one row per revision (no UNIQUE on the FK → many per document)
| column | type | notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_document_id` | uuid NOT NULL → `structure.tenant_documents(id)` ON DELETE CASCADE | |
| `rev_label` | text NOT NULL | e.g. "Rev A" (auto-suggested, editable) |
| `storage_path` | text NOT NULL | object in the `tenant-documents` bucket |
| `file_name` | text NOT NULL | original filename |
| `note` | text NULL | "what changed" |
| `issued_at` | timestamptz NOT NULL DEFAULT now() | revision issue date |
| `uploaded_by` | uuid NULL → `auth.users(id)` | actor |
| `created_at` | timestamptz | |

Index: `(tenant_document_id, issued_at DESC)`. Current revision = max `issued_at` (tie-break `created_at`).

### 3.3 Status (kept, auto-derived)
- Keep `tenant_details.layout_status` / `scope_status` (+ `layout_issued_at` / `scope_issued_at`).
- A kind reads `issued` when the tenant has ≥1 `tenant_documents` of that kind with ≥1 revision; otherwise `pending`. `*_issued_at` = the **earliest** revision `issued_at` for that kind (when it first became issued).
- **Mechanism:** a `SECURITY DEFINER` trigger on `tenant_document_revisions` (AFTER INSERT/DELETE — which also fires on cascaded revision deletes when a document is removed) recomputes the owning tenant's `*_status` + `*_issued_at` for the affected kind, so status stays correct regardless of write path.

### 3.4 Storage & RLS
- Reuse the existing `tenant-documents` bucket + `{project_id}/{node_id}/{filename}` path scheme (storage RLS already covers it).
- RLS on both tables mirrors `tenant_scope_items`: read = active org member with project access; write = same, backed by the app-layer role gate in §5.

## 4. UI / components (Approach B — list + revision drawer)

- A shared **`<TenantDocumentList kind="layout"|"scope" projectId nodeId readOnly>`** component, used by both `LayoutIssuedPanel` and `ScopeOfWorkPanel` in place of their single-file widgets.
- Renders the kind's documents in `sort_order` as a clean list — each row: title · current rev label + date · a revision-count badge · rename/delete. **Revisions are NOT nested inline**; selecting a document opens a focused **`<DocumentRevisionDrawer>`** (a side panel / modal) showing that document's full revision timeline (rev label, issue date, uploader, note, download link) + **`+ Add revision`**.
- Actions: **`+ Add drawing`** on the list (title + first-revision file, optional label/note); **`+ Add revision`** in the drawer (file + label, optional note); per-revision download; rename document; delete revision (in the drawer); delete document (from the list, confirm — cascades).
- Optimistic UI with rollback on failure (mirrors `useFieldPhotos`); downloads open a signed URL in a new tab (today's pattern). The schedule row's per-kind status pill stays, reflecting the auto-derived status.
- **Why B over A:** a clean overview list plus a focused drawer scales to long revision histories without cramping the inline panel — at the cost of one extra click to view a document's history.

## 5. Server actions + RBAC

New `apps/web/src/actions/tenant-documents.actions.ts`:
- `listTenantDocuments(projectId, nodeId)` → documents (per kind) with their revisions.
- `createTenantDocument(projectId, nodeId, kind, title, firstRevision)`.
- `addTenantDocumentRevision(projectId, documentId, { storagePath, fileName, label, note })`.
- `getRevisionSignedUrl(projectId, revisionId)` — 300s, mirrors `getLayoutSignedUrlAction`.
- `renameTenantDocument`, `reorderTenantDocuments`, `deleteTenantDocumentRevision`, `deleteTenantDocument`.
- File upload via a route generalised from `api/tenant-schedule/upload-scope-document` (accepts `kind` + `nodeId`; returns `storagePath`).

**RBAC:** every service-role (RLS-bypassing) write gates `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` **after** the access guard — the recurring lesson (org membership alone is insufficient for service-role writes to `structure.*`). Reads gated by project access.

## 6. Delete semantics
- **Delete a document** → DB cascade removes its revisions; the action also deletes those revisions' storage objects; status recomputes.
- **Delete a revision** → allowed; removes its storage object; if it was the last revision of the last document of a kind, that kind's status reverts to `pending`.

## 7. Migration (split, per the deploy-order lesson)

A migration that drops a column the running code still reads breaks production, so the drop is split out and applied **after** the new code is live (the 00109/00110 lesson).

- **00118 — additive** (ships with the new code): create both tables + indexes + `updated_at` trigger + the status-derive trigger; enable RLS + policies (mirror `tenant_scope_items`); **backfill** — for each `tenant_details` row with a non-null `layout_drawing_path`, insert one `tenant_documents` (`kind='layout'`, `title='Layout'`, `sort_order=0`) + one `tenant_document_revisions` (`rev_label='Rev A'`, `storage_path` = the existing path, `file_name` = the basename of that path, `issued_at` = `layout_issued_at` ?? `now()`); same for `scope_document_path` (`kind='scope'`, `title='Scope of work'`). **Keep** the old columns for now. `NOTIFY pgrst, 'reload schema'`. Regenerate `packages/db/src/types.ts`.
- **00119 — drop** `tenant_details.layout_drawing_path` + `scope_document_path`, applied **after** the new code (which no longer references them) is confirmed live.
- No PostgREST `db_schema` PATCH needed — no new schema, just tables in `structure`.

## 8. Testing
- **Actions** (`vi.hoisted` + `qb()`): RBAC gate rejects non-write roles; create / add-revision / delete; status derivation (issued after first revision, pending after the last is removed); signed URL.
- **Component:** `TenantDocumentList` (list + revision-count badge) and `DocumentRevisionDrawer` — render documents, open the drawer to view a document's revisions, add-drawing / add-revision flows, delete confirm, read-only mode.
- **Migration:** transactional, ROLLBACK-safe smoke test — backfill maps a sample tenant's single paths into document + revision; status derives correctly; (00119) column-drop verified.

## 9. Out of scope (now)
- A general "tenant documents" taxonomy beyond `layout`/`scope` (brainstorming option 3).
- A dedicated per-tenant "Drawings" tab (UI Approach C).
- Drawing markup/annotation, an inline PDF viewer, drawing ↔ cable-schedule / equipment linkage.

## 10. Open questions
None outstanding — all brainstorming decisions are resolved.
