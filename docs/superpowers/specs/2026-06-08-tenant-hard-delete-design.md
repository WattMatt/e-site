# Tenant hard-delete — design spec

**Date:** 2026-06-08
**Goal:** Let an owner/admin/PM permanently delete a tenant board (`structure.nodes` where `kind='tenant_db'`) from the Tenant Schedule, via a confirmation modal that shows exactly what will be destroyed. Irreversible.

## Decisions (locked 2026-06-08)
- **D1 — Cable connection:** the delete also removes the tenant's cable-schedule supply (a cable run to a deleted board is meaningless), but **only from a DRAFT revision**. If any feeding/leaving supply is in an **issued** revision, the delete is **refused** (never silently mutate a locked/handover record).
- **D2 — Confirmation:** a modal showing the full destruction summary + a single **"Delete permanently"** danger button (no type-to-confirm).
- **D3 — Permission:** `ORG_WRITE_ROLES` (owner / admin / project_manager), matching every other destructive action.

## What a delete destroys (cascade map — verified against migrations)
A single `DELETE FROM structure.nodes WHERE id=:node` cascades these (FK `ON DELETE CASCADE`): `tenant_details`, `tenant_scope_items`, `tenant_units`, `tenant_documents` → `tenant_document_revisions`, `node_orders` → `node_order_documents` + `node_order_shop_drawings`. `inspections.inspections.target_node_id` is **SET NULL** (inspection kept, target cleared). The delete is **BLOCKED** by NO-ACTION FKs when the node (a) is referenced by `cable_schedule.supplies.from_node_id`/`to_node_id`, or (b) has child nodes via `parent_node_id`. The DB cascade does **not** touch Storage objects, nor the handover `tenants.documents` rows (linked only by a plain UUID `node_order_shop_drawings.handover_document_id`, no FK).

## Architecture — two server actions (`apps/web/src/actions/tenant-delete.actions.ts`)

### `getTenantDeleteSummaryAction(projectId, nodeId)` — pre-flight for the modal
Gate: `guardProjectAccess` (includes `requireEffectiveRole(…, ORG_WRITE_ROLES)`) + `guardNodeBelongsToProject` + assert `kind='tenant_db'`. Returns either:
- `{ blocked: true, reason }` when there are **issued-revision** supplies referencing the node, or **child nodes** (`parent_node_id=:node`); or
- `{ ok: true, code, name, counts: { scopeItems, documents, documentRevisions, units, orders, shopDrawings, orderDocuments, cableSupplies, inspectionsTargeting, storageFiles } }` — used to render the summary.

### `hardDeleteTenantAction(projectId, nodeId)` — the destructive action
Gate as above. Then, mirroring `deleteTenantDocumentAction`'s read-paths→delete→clean-storage shape, using the service-role raw-fetch PostgREST pattern (per the cross-schema write gotcha — `Content-Profile: structure` / `cable_schedule`):
1. **Re-check blockers** (issued-revision supplies, child nodes) → return `{ error }` if present (defense against a stale pre-flight).
2. **Collect storage paths BEFORE deleting** (the joins die with the cascade): `tenant_document_revisions.storage_path` (bucket `tenant-documents`); `node_order_documents.storage_path` + `node_order_shop_drawings.storage_path` (bucket `node-order-documents`); for shop drawings with `handover_document_id`, the `tenants.documents.storage_path` (bucket `project-documents`) **and** the `tenants.documents.id`s.
3. **Delete the handover `tenants.documents` rows** explicitly (no FK removes them).
4. **Delete the DRAFT-revision cable supplies** referencing the node (`from_node_id=:node OR to_node_id=:node`).
5. **`DELETE FROM structure.nodes WHERE id=:node`** → cascades the rest; nulls the inspection targets.
6. **Best-effort Storage cleanup** of every collected path, per bucket (`storage.from(bucket).remove(paths)`).
7. `revalidatePath` the tenant-schedule, equipment-materials, and cables routes. Return `{ ok: true }`.

Failure handling: if a step fails mid-way the action returns `{ error }`; the node delete (step 5) is the atomic pivot — storage cleanup is best-effort after it (orphaned files are tolerable; orphaned rows are not, and there are none post-cascade).

## UI
- **`ScheduleTable` row** (`tenant-schedule/_components/ScheduleTable.tsx`): a red **Delete** action on each active tenant row (next to / replacing nothing — added to the actions cell), opening `TenantDeleteModal`. Shown to owner/admin/PM (thread the viewer role into the table; if not readily available, show to all and rely on the server gate — matches the equipment Edit/Decommission pattern).
- **`TenantDeleteModal`** (new client component, `createPortal`): on mount calls `getTenantDeleteSummaryAction`; renders either the **blocked** reason (Cancel only) or the **summary** (the counts + an "inspections will lose their target" note) with a **"Delete permanently"** danger button + Cancel. On confirm → `hardDeleteTenantAction` → `router.refresh()` + close; surfaces any error inline.

## RBAC
Both actions gated `ORG_WRITE_ROLES`. Update `docs/rbac-matrix.md` (the Tenant Schedule row / a note for the new destructive action).

## Testing
- Action unit tests (`vi.hoisted` mocks): denies a non-write role before any delete; refuses when an issued-revision supply or a child node exists; on the happy path issues the handover-row delete + draft-supply delete + node delete + storage removes in order and returns `{ ok }`.
- Summary action: returns the right counts shape; returns `blocked` for the issued-revision / child cases.

## Out of scope
- Bulk delete; an "undo"/soft-restore (this is a hard delete by design); deleting a tenant wired into an issued cable revision (refused — user must work in a draft); the equivalent button on the unified Equipment & Materials tab's tenant rows (a later add — this spec is the Tenant Schedule per the request).
