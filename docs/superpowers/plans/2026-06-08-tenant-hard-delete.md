# Tenant hard-delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Permanently delete a tenant board (`structure.nodes` `kind='tenant_db'`) from the Tenant Schedule, via a confirmation modal showing what will be destroyed — owner/admin/PM only, irreversible.

**Architecture:** Two server actions in `tenant-delete.actions.ts` (a pre-flight summary + the orchestrated destroy), mirroring `deleteTenantDocumentAction`'s gate → collect-storage-paths → delete → best-effort storage cleanup shape. A `TenantDeleteModal` client component wired to a red Delete button on each Tenant Schedule row.

**Tech Stack:** Next.js server actions, service-role raw-fetch PostgREST writes (cross-schema gotcha), Supabase Storage, vitest.

**Branch:** `feat/tenant-hard-delete` (off `main`). Spec: `docs/superpowers/specs/2026-06-08-tenant-hard-delete-design.md` (decisions D1–D3 LOCKED).

**Reference files to read + mirror (do not re-derive):**
- `apps/web/src/actions/tenant-documents.actions.ts` — `guardProjectAccess` (wraps `requireEffectiveRole(…, ORG_WRITE_ROLES)`), `guardNodeBelongsToProject`, the `structureDelete` raw-fetch helper, and **`deleteTenantDocumentAction` (≈:557-612)** — the exact read-storage-paths → service-role-delete → best-effort `storage.remove` template.
- `apps/web/src/actions/cable-entities.actions.ts` — the `cable_schedule`-schema service-role write pattern (`Content-Profile: cable_schedule`) for deleting `supplies`.
- `apps/web/src/actions/equipment.actions.ts` — `structurePost`/`structurePatch` raw-fetch shape + `ORG_WRITE_ROLES` import.
- `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/ScheduleTable.tsx` (the actions cell ≈:273-315) — where the Delete button goes.
- The `createPortal` modal pattern: `equipment-materials/_components/BoardManageModals.tsx` (`DecommissionBoardModal`).

## File structure
```
apps/web/src/actions/tenant-delete.actions.ts        # getTenantDeleteSummaryAction + hardDeleteTenantAction
apps/web/src/actions/tenant-delete.actions.test.ts   # gating, blockers, orchestration order
apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantDeleteModal.tsx
…/tenant-schedule/_components/ScheduleTable.tsx       # add the Delete button (modify)
docs/rbac-matrix.md                                   # add the action (modify)
```

---

### Task 1: `tenant-delete.actions.ts` — the two actions (TDD)

**Files:** Create `apps/web/src/actions/tenant-delete.actions.ts` + `tenant-delete.actions.test.ts`.

Result types:
```ts
export type TenantDeleteSummary =
  | { blocked: true; reason: string }
  | { ok: true; code: string; name: string | null; counts: {
      scopeItems: number; documents: number; documentRevisions: number; units: number;
      orders: number; shopDrawings: number; orderDocuments: number;
      cableSupplies: number; inspectionsTargeting: number; storageFiles: number } }
export type HardDeleteResult = { ok: true } | { error: string }
```

- [ ] **Step 1: Write failing tests** in `tenant-delete.actions.test.ts`. Mirror `equipment.actions.test.ts`'s `vi.hoisted` mock setup (mock `@/lib/supabase/server` `createClient`, `next/cache`, and `projectService.getById`). Cover:
  1. `hardDeleteTenantAction` **denies a non-write role** before any fetch (role RPC → `'contractor'` → `{ error }`, `fetch` never called).
  2. `getTenantDeleteSummaryAction` returns **`{ blocked }`** when the node has an issued-revision supply (mock the supplies/revisions read to return an issued row).
  3. `getTenantDeleteSummaryAction` returns **`{ blocked }`** when a child node exists (`parent_node_id` read returns a row).
  4. Happy-path `hardDeleteTenantAction`: with role `'owner'` and no blockers, it issues (in order) the handover-`tenants.documents` DELETE, the draft-supply DELETE, the node DELETE, then the storage removes, and returns `{ ok: true }` (assert the sequence/URLs via the fetch mock + the storage mock).

  (Write the full test bodies following the `equipment.actions.test.ts` `mockClient`/`fetchMock` style — chained `.schema().from().select().eq()...` for the reads, `vi.stubGlobal('fetch', …)` for the service-role writes, and a `storage.from().remove` spy.)

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter web exec vitest run tenant-delete.actions` → module-missing / assertion failures.

- [ ] **Step 3: Implement `tenant-delete.actions.ts`** per spec §Architecture. Reuse from `tenant-documents.actions.ts`: `guardProjectAccess`, `guardNodeBelongsToProject`, `structureDelete`; add a `cableScheduleDelete` twin (same as `structureDelete` but `Content-Profile: cable_schedule`). `getTenantDeleteSummaryAction`: gate → assert `kind='tenant_db'` → read blockers (issued-revision supplies via `cable_schedule.supplies` join `revisions` where `status<>'DRAFT'` and (`from_node_id=:n OR to_node_id=:n`); child nodes via `structure.nodes` `parent_node_id=:n`) → if blocked return `{ blocked, reason }`; else read the counts (the §"what gets destroyed" tables) and the storage-file total → return `{ ok, code, name, counts }`. `hardDeleteTenantAction`: gate → re-check blockers (return `{ error }` if any) → collect storage paths + handover `tenants.documents` ids → `structureDelete` the handover `tenants.documents` rows → `cableScheduleDelete` the **DRAFT** supplies (`from_node_id=eq.:n` and `to_node_id=eq.:n`, both, scoped to draft revisions) → `structureDelete` `nodes?id=eq.:n` → best-effort `storage.from(bucket).remove(paths)` for `tenant-documents` / `node-order-documents` / `project-documents` → `revalidatePath` tenant-schedule + equipment-materials + cables → `{ ok: true }`.

- [ ] **Step 4: Run tests, verify PASS** + `pnpm --filter web type-check`.
- [ ] **Step 5: Commit** — `feat(tenant): hard-delete server actions + tests`.

---

### Task 2: `TenantDeleteModal.tsx`

**Files:** Create `…/tenant-schedule/_components/TenantDeleteModal.tsx`.

- [ ] **Step 1: Implement** a `'use client'` `createPortal` modal (mirror `DecommissionBoardModal`). Props `{ projectId; nodeId; code; onClose: () => void }`. On mount, `useEffect` → `getTenantDeleteSummaryAction(projectId, nodeId)` into state. Render: a loading state; if `blocked`, the `reason` + a Cancel button only; if `ok`, a **destruction summary** (list the non-zero counts: "{scopeItems} scope items · {documents} documents · {orders} orders · {cableSupplies} cable connection(s) · {storageFiles} files") + an "Inspections targeting this tenant will lose their target." note when `inspectionsTargeting > 0`, then a **"Delete permanently"** danger `Button` + Cancel. On delete: `useTransition` → `hardDeleteTenantAction` → on `{ ok }` `router.refresh()` + `onClose()`; on `{ error }` show it inline. All hooks unconditional (React #310).
- [ ] **Step 2: Type-check** → clean.
- [ ] **Step 3: Commit** — `feat(tenant): TenantDeleteModal`.

---

### Task 3: Wire the Delete button into `ScheduleTable`

**Files:** Modify `…/tenant-schedule/_components/ScheduleTable.tsx`.

- [ ] **Step 1:** In the active-row actions cell (the `{!decommissioned && (<div>… Scope ↓ … Layout ↓ …)}` block ≈:275-314), add a third red **Delete** button. Add `const [deletingNode, setDeletingNode] = useState<{ id: string; code: string } | null>(null)` (with the other hooks, top-level) and render `{deletingNode && <TenantDeleteModal projectId={projectId} nodeId={deletingNode.id} code={deletingNode.code} onClose={() => setDeletingNode(null)} />}`. The button `onClick={() => setDeletingNode({ id: node.id, code: node.code })}`. (Button visibility: if `ScheduleTable` already receives the viewer role, gate to owner/admin/PM; otherwise show it — the server action is the hard gate, matching the equipment Edit/Decommission pattern.)
- [ ] **Step 2:** `pnpm --filter web type-check` + `pnpm --filter web exec vitest run ScheduleTable` (the existing ScheduleTable tests still pass).
- [ ] **Step 3: Commit** — `feat(tenant): Delete button on the Tenant Schedule row`.

---

### Task 4: rbac-matrix + final verify

- [ ] **Step 1:** In `docs/rbac-matrix.md`, add a line for the tenant hard-delete (owner/admin/PM write; gated by `ORG_WRITE_ROLES`).
- [ ] **Step 2: Full verify** — `pnpm --filter web type-check` (clean), `pnpm --filter web exec vitest run` (full suite green), `pnpm --filter web build` (succeeds).
- [ ] **Step 3: Commit** — `docs(rbac): tenant hard-delete`.

## Self-review (vs spec)
- D1 cable-cascade-from-draft + refuse-if-issued → Task 1 blockers + draft-supply delete. ✅
- D2 simple confirm + summary → Task 2 (no type-to-confirm). ✅
- D3 ORG_WRITE_ROLES → Task 1 gate (`guardProjectAccess`). ✅
- Cascade + storage cleanup + handover-row delete → Task 1 Step 3 orchestration. ✅
- Delete button on the row → Task 3. ✅
- No render test for the modal/UI (build is the gate); the destructive action is unit-tested + adversarially reviewed.
