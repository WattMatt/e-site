# Equipment & Materials merge — Phase 3 (cutover) Plan

**Goal:** Make the unified `/projects/[id]/equipment-materials` tab THE tab: inline equipment management, one sidebar entry, the two old routes redirect to it.

**Branch:** `feat/equipment-materials-unified` (continues PR #44).

## Tasks
1. **Inline equipment management** — new client modal components under `equipment-materials/_components/` (copied/adapted from `EquipmentTable.tsx`'s `AddEquipmentModal` / `EditForm` / `DecommissionModal`, wired to `createEquipmentNodeAction` / `editEquipmentNodeAction` / `decommissionEquipmentNodeAction` / `reactivateEquipmentNodeAction` in `@/actions/equipment.actions`). `BoardRow`'s Manage cell for **equipment** boards → Edit / Decommission (active) or Reactivate (decommissioned); **tenant** boards keep the `Tenant Schedule ↗` deep-link. A client `+ Add board` toolbar button on the page → the Add modal.
2. **Sidebar nav** — replace the two entries ("Equipment Schedule", "Materials") with one **"Equipment & Materials"** → the new route (preserve the existing role-gating).
3. **Redirects** — replace the bodies of `equipment-schedule/page.tsx` and `materials/page.tsx` with `redirect('/projects/<id>/equipment-materials')` (thin redirect pages; keep the files).
4. **rbac-matrix.md** — add the new route; mark the two old as redirected.

## Notes / scope
- The old component files (`EquipmentTable`, `OrderRow`, `MaterialOrderGroup`, `OrderDocSlot`, `ShopDrawingList`) are left in place as dead code — `gather-unified-boards.ts` still imports the `OrderDoc` / `ShopDrawing` **types** from two of them. Deleting the dead files + relocating those types is a trivial cleanup follow-up (kept out of this PR to avoid type-dependency churn before the UI is confirmed).
- **Deploy gate:** building + previewing is safe; the prod merge (which replaces the live tabs) waits for visual confirmation on the PR #44 preview.

## Verify
`pnpm --filter web type-check` clean · full `vitest` suite green · `pnpm --filter web build` succeeds. The route's render is confirmed on the Vercel preview.
