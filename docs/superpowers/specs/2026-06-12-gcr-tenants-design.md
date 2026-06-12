# Generator Cost Recovery — Tenants tab redesign + report pagination

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan
**Scope:** Two independently shippable phases. Phase A: Tenants tab (persistence, bulk workflow, lifecycle, coverage, data correctness). Phase B: report PDF formatting and pagination.

## Problem

1. **Silent data loss.** On the Tenants tab, some selections persist and others appear saved but are gone when the user returns. Root cause (investigated 2026-06-12, code-level evidence in `TenantsPanel.tsx`):
   - The participation segmented buttons fire `saveTenantAssignmentAction` and discard the result — failures are swallowed while the optimistic UI keeps the value.
   - Category / zone / manual-kW commit only on `blur`, and one global `useTransition` disables every control in the table while any save is in flight. Chrome does not fire blur on controls disabled mid-focus, so rapid editing silently drops commits.
   - Row state is seeded once on mount and never reconciled with server data, so a failed save is indistinguishable from a successful one until the panel remounts (tab switch), which reveals the divergence.
2. **Tedium.** Assigning 100+ shops cell-by-cell (zone, participation, category) with no bulk operations. Zones are manual knowledge but few (typically 1–3), so bulk-select + assign covers most of the work.
3. **Data leak.** `loadGcrConfigAction` does not filter `deleted_at` or `status`, so recycle-binned and decommissioned shops appear in the tab, in readiness counts, and in report data.
4. **Report output.** The generated PDF (`@react-pdf/renderer`, `apps/web/src/lib/reports/generator-report.tsx`) lacks proper page structure: no consistent page header/footer, table headers do not repeat across pages, rows/headings split awkwardly.

## Decisions (from design dialogue)

- Zones are manual knowledge, few per project → bulk-select workflow, no rule-based/import-time derivation.
- Commit model: **instant save with visible per-row status** — no draft/Save-all.
- Scope includes: new-import lifecycle, coverage/confidence view, report formatting + pagination.
- Out of scope: import-time zone columns, spreadsheet keyboard navigation, undo, row virtualization.

---

## Phase A — Tenants tab

### A1. Data correctness

`loadGcrConfigAction` tenants query adds `.is('deleted_at', null)` and excludes `status = 'decommissioned'`. This corrects the tab, readiness, coverage, and report data in one place. Ships first; independent of everything else.

### A2. Persistence model

**Server.** One new action replaces per-row saves:

```ts
bulkSaveTenantAssignmentsAction(
  projectId: string,
  nodeIds: string[],            // 1..500
  patch: {
    zone_id?: string | null     // null = clear
    participation?: 'shared' | 'own' | 'none'
    shop_category?: ShopCategory | null
    manual_kw_override?: number | null
  },
): Promise<{ ok: true; updated: number } | { error: string }>
```

- Gate: `resolveOrgId` + `requireRole(ORG_WRITE_ROLES)` (same as existing actions). Zod schema: `nodeIds` uuid array min 1 max 500; every patch field optional; at least one patch field required.
- Writes go through a new Postgres function `gcr.bulk_save_tenant_assignments(...)` (new migration), `SECURITY INVOKER` so RLS applies unchanged. The function:
  - verifies all `node_ids` belong to `p_project_id` and are `kind = 'tenant_db'` (else raises);
  - upserts `gcr.tenant_assignments` rows for all ids (insert missing, update present) when `zone_id`/`manual_kw_override` are in the patch;
  - updates `structure.nodes.generator_participation` / `shop_category` when those are in the patch;
  - runs in one transaction — the half-saved-row failure mode is eliminated;
  - distinguishes "not provided" from "set to NULL" via paired `p_set_<field> boolean` parameters;
  - returns the affected row count.
- Single-cell edits call the same action with one node id — one code path, one test surface.
- Existing `saveTenantAssignmentAction` is removed and its callers migrated (it has no other call sites).

**Client.** The fork-once `rows` state is replaced by **server truth + pending-patch overlay**:

- `serverRows` derive from props on every render (so `router.refresh()` reconciles automatically).
- `pending: Record<nodeId, { patch: Patch; status: 'saving' | 'error'; error?: string }>` — display value = server value with patch overlaid.
- On save success: pending entry cleared (server props now carry the value); a ✓ flashes ~1.5 s in the row-status cell.
- On save failure: patch dropped → cell visibly snaps back to server truth; row shows ⚠ with the error message and a **Retry** affordance. `console.error` with node id + patch for diagnostics.
- Per-node coalescing queue: a change made while that node's save is in flight coalesces into one follow-up save (last-write-wins per field). Different nodes never block each other. The global `busy` disable is deleted.
- Commit triggers: selects and participation buttons save **on the click/choice itself**; the kW input saves on Enter or blur, with a pending dot while the typed value differs from server truth. Every trigger path checks the action result.

### A3. Bulk workflow

- New checkbox column; header checkbox selects **all currently filtered rows**; count badge.
- Sticky bulk bar appears when selection ≥ 1: `Assign zone ▾ · Participation ▾ · Category ▾ · N selected · Clear`.
- Apply calls `bulkSaveTenantAssignmentsAction` once for the selection. Per-row status indicators animate from the same pending-overlay machinery. The RPC is transactional, so a bulk apply is all-or-nothing: the bar shows "Applied to N shops" on success, or the error with a **Retry** on failure (no partially-applied selections to reason about).
- Selection clears when the active filter changes.

### A4. Filters + new-import lifecycle

- Filter chips with live counts above the table: `All · No zone · Uncategorized · Opted out · <one chip per zone>`. Filtering is client-side on the displayed (server+patch) values.
- Setup banner whenever participating (`shared`) shops are missing zone or category: "12 shops need setup — Show" → applies the corresponding filter. Newly imported shops land in this bucket by definition, so re-imports surface themselves.
- The existing "Set all uncategorized to Standard" readiness shortcut remains (it already works and is one click).

### A5. Coverage strip

Cards above the table, computed client-side from displayed values via the existing engine (`calculateTenantLoadingKw`):

- Per zone: shop count, total loading kW. If **all** of the zone's `generator_size` values parse numerically (`parseFloat` on the free-text column yields finite numbers), also show capacity and utilisation %; otherwise omit that line — never guess.
- Overall card: "X of Y shops configured" — configured = has category AND (has zone OR participation is own/none).
- The readiness panel stays as-is, now fed by corrected data.

### A6. Phase A testing

- Action unit tests (pattern of existing `gcr.actions.test.ts`): role gating, zod rejection (empty ids, empty patch), per-field set/clear semantics, RPC error propagation.
- Migration verified against the local stack (psql): transactional behaviour, RLS enforcement with a non-member user, node/project mismatch raises.
- Component tests (extend `TenantsPanel.test.tsx`): change commits on click (no blur needed); failure reverts the cell and shows ⚠ + Retry; bulk apply patches all selected rows; select-all respects the active filter; coverage counts; banner filter link.
- Live verification on the seeded smoke project (60 tenants, 12 scope types, local stack) before PR: rapid multi-row editing with induced failures (e.g. revoked role) must show errors, never silently lose a change.

---

## Phase B — Report PDF formatting + pagination

All inside `apps/web/src/lib/reports/generator-report.tsx` (and small helpers next to it); generation/storage flow is untouched.

- **Page frame:** every `<Page>` gets a `fixed` header (branding/logo per `ResolvedBranding`, project name, "Generator Cost Recovery — Rev N", date) and a `fixed` footer with `render={({ pageNumber, totalPages })}` → "Page X of Y".
- **Tables:** shared table primitives where the header row is `fixed` (repeats on every page) and each data row is `wrap={false}` (never splits mid-row). Long tenant tables paginate cleanly.
- **Sections:** summary, zones & generators, tenant schedule, capital breakdown, operational costs, narrative. Headings use `minPresenceAhead` so a title never orphans at a page bottom; major sections may `break` to a new page where appropriate.
- **Numbers:** one shared formatter module — en-ZA locale, "R 1 234 567.89" currency, kW to 2 dp, right-aligned numeric columns.
- **Acceptance:** generate against the seeded smoke project and inspect the PDF page by page: header/footer on every page, table headers repeated, no split rows, no orphan headings, formatted numbers. This inspection is part of the PR, not an afterthought.

---

## Rollout

- Phase A and Phase B are separate PRs (A first; B does not depend on A but reads corrected data once A lands).
- Phase A waits for the in-flight `TableScrollX` branch to merge (it edits `TenantsPanel.tsx`); rebase A on top.
- Diagnostics ship in the first deploy: per-row error surfacing + `console.error` context on every failed save. If users still report losses, the errors are visible evidence, not silence.
