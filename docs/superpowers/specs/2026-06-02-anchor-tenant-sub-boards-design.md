# Anchor Tenants with Sub-Boards — Design

**Date:** 2026-06-02
**Status:** Approved (design); ready for implementation planning
**Topic:** Model anchor tenants (e.g. Shoprite) whose internal reticulation contains a tree of sub-distribution-boards (Butchery, Bakery, Deli, Admin…), across the structure/node hierarchy, procurement/materials, and the cable schedule.

---

## 1. Problem

Anchor tenants have **sub-boards**: a Shoprite store has a main DB plus departmental sub-DBs (Butchery, Bakery, Deli, Admin), and larger stores nest deeper (a cold-room board fed from the Butchery board) and take more than one supply (a normal main DB plus an essential/generator-backed main DB). The system must represent this hierarchy in **procurement of materials (and tracking)** and in the **cable schedule**.

Today the model can't express "these boards all belong to Shoprite": `structure.nodes` is a flat registry with no containment, procurement rolls up flat (by scope-type/kind, not by anchor), and while the cable schedule already encodes an electrical *feed graph*, that graph is not the same relationship as lease/ownership grouping.

## 2. Scope (decisions taken during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | How far WM's scope goes into the anchor | **Full internal modelling** — WM cables *and* procures the anchor's internal reticulation; each sub-board is a first-class node, rolled up under the anchor. |
| 2 | Hierarchy depth/generality | **General board tree** — a single nullable `parent_node_id` self-FK on every node; any board, any depth. No anchor-only special-casing. |
| 3 | Procurement granularity per sub-board | **One equipment-style order per sub-board** (required → ordered → received) with quote / order-instruction / shop-drawing slots; rolled up under the anchor. WM supplies them. |
| 4 | Representation approach | **A — containment column + reuse.** Add `parent_node_id` + a `sub_board` kind; the anchor is emergent (the `tenant_db` at the top of a board subtree). No separate anchor table, no `is_anchor` flag. Rejected: B (dedicated anchor entity — redundant) and C (derive grouping from the feed graph — breaks on emergency/alternate feeds). |
| 5 | Which anchor shapes are real | **All four**: dual/multi-supply, sub-tenants/concessions, multi-unit anchors, common-area board trees. |
| 6 | Concession / sub-tenant procurement | **Independent lease** — a concession is a normal tenant with its own scope/party/BO date; the anchor link is physical context + reporting only; procurement rollup stops at the lease boundary. |

## 3. Current system (what exists today)

- **`structure.nodes`** (migration `00074`, kinds extended `00090`): flat registry. Columns include `id, project_id, organisation_id, kind, code, name, status, coc_required, short_code`; tenant facet `shop_number, shop_name, shop_area_m2`; electrical facet `breaker_rating_a, pole_config, section`; equipment facet `rating_kva, voltage_v`; `custom_kind_label`. `kind ∈ {tenant_db, main_board, common_area_board, common_area_lighting, rmu, mini_sub, generator, custom}`. `UNIQUE(project_id, code)`, index `(project_id, kind)`. **No `parent_node_id`.**
- **Procurement** (`structure.node_orders` `00083`, `node_order_documents` `00086`, `node_order_shop_drawings` `00115`): two derivation paths — *tenant orders* (per tenant × `scope_item_type`, with landlord/tenant `party` from `tenant_scope_items` `00080`) and *equipment orders* (one per equipment node, `scope_item_type_id` NULL, status `required`). Derivation logic: `packages/shared/src/structure/node-order.service.ts`. Required-by via `packages/shared/src/structure/bo.service.ts`.
- **Cable schedule** (`cable_schedule.*` `00051`): `supplies` carry `from_node_id`/`to_node_id` → `structure.nodes` (`00076`/`00078`); `cables` hang off `supplies`. `buildStructureTree()` (`packages/shared/src/services/cable-structure.service.ts`) reconstructs the feed tree and already detects rings / multi-fed boards. Revision-gated by `apps/web/src/lib/cable-schedule/require-role.ts`.
- **Key surfaces:** Materials page `apps/web/src/app/(admin)/projects/[id]/materials/page.tsx` (+ `_components/OrderRow.tsx`, `ShopDrawingList.tsx`, `OrderDocSlot.tsx`); Tenant schedule `…/tenant-schedule/page.tsx`; Equipment schedule `…/equipment-schedule/page.tsx` (+ `NodeOrderCell.tsx`); Cable schedule `…/cables/[revisionId]/` (`StructureSection.tsx`, `StructurePanel.tsx`, `CableScheduleGrid.tsx`, `CableFormModal.tsx`, `AddEntityPanel.tsx`). Actions: `equipment.actions.ts`, `node-order.actions.ts`, `tenant-scope.actions.ts`, `cable-entities.actions.ts`.

> **Gotcha to carry into implementation:** cross-schema writes to `structure.*` via supabase-js `.schema('structure')` can silently drop service-role auth on INSERT/UPDATE; existing code uses a raw PostgREST fetch with a `Content-Profile: structure` header + service key. Reuse that pattern.

## 4. Core design

### 4.1 The unifying rule

> `parent_node_id` is a **general containment tree** over *all* nodes. A node's **owning lease** is its nearest `tenant_db` at-or-above it (inclusive). **Scope / party / BO date live on the `tenant_db`** and flow down to its `sub_board` descendants — but **stop at every `tenant_db` boundary**. A board's *feed* is the **supply graph**, which is independent of this containment tree.

Resolution (pure, in-memory over the project's already-fetched node list):

```text
owningLease(node, nodesById):
  cur = node
  loop:
    if cur.kind == 'tenant_db': return cur        # a concession returns itself
    if cur.parent_node_id is null: return null    # e.g. a common-area subtree → no lease
    cur = nodesById[cur.parent_node_id]
```

- **Department sub-board** (Butchery under Shoprite) → owning lease = Shoprite; inherits Shoprite's scope/BO.
- **Concession** (`tenant_db` Coffee Kiosk under Shoprite) → owning lease = itself; its own scope/BO. Shoprite is merely an ancestor → used for footprint grouping/navigation, **not** rollup.
- **Common-area sub-board** → no `tenant_db` ancestor → owning lease = null; rollup root is the common-area board.

### 4.2 Schema changes — migration `00116` (additive, no data loss)

All on `structure.nodes` plus one small new table.

```sql
-- 1. Containment link
ALTER TABLE structure.nodes ADD COLUMN parent_node_id UUID;

-- back the composite FK (id is PK, so this unique is trivially satisfied)
ALTER TABLE structure.nodes ADD CONSTRAINT nodes_project_id_key UNIQUE (project_id, id);

-- parent must live in the SAME project; cannot delete a board that still has children
ALTER TABLE structure.nodes ADD CONSTRAINT nodes_parent_fk
  FOREIGN KEY (project_id, parent_node_id)
  REFERENCES structure.nodes (project_id, id)
  ON DELETE RESTRICT;

CREATE INDEX idx_nodes_parent ON structure.nodes (parent_node_id)
  WHERE parent_node_id IS NOT NULL;

-- 2. Cycle guard
ALTER TABLE structure.nodes ADD CONSTRAINT nodes_no_self_parent
  CHECK (parent_node_id IS NULL OR parent_node_id <> id);
-- + BEFORE INSERT/UPDATE trigger structure.nodes_prevent_cycle(): walk ancestors,
--   reject if NEW.id reappears (deep cycles the CHECK can't catch).

-- 3. New node kind: recreate the kind CHECK (from 00074/00090) adding 'sub_board'.

-- 4. Multi-unit anchors
CREATE TABLE structure.tenant_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         UUID NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
  shop_number     TEXT,
  area_m2         NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_units_node ON structure.tenant_units (node_id);
-- RLS mirrors structure.nodes: read = project member; write = owner/admin/project_manager.
```

- **`sub_board`** uses the electrical facet (`breaker_rating_a, pole_config, section, short_code, coc_required`) and ignores the tenant facet (those stay on the owning `tenant_db`).
- **Convention (default):** an anchor's existing `tenant_db` node doubles as the store's main DB (it already carries `breaker_rating_a` etc.), exactly as a simple tenant's DB does today. **Multi-supply anchors** instead model each main DB as a `sub_board` child (e.g. *Normal Main DB* + *Essential Main DB* as siblings), departments nested under whichever feeds them.
- **`tenant_db` is a lease boundary, not necessarily a root** — it may be parented (a concession under an anchor). The composite FK + cycle guard already permit this safely.
- **Multi-unit back-compat:** the node's existing `shop_number` / `shop_area_m2` remain the **primary** unit; `tenant_units` holds **additional** units only. Single-unit tenants write no `tenant_units` rows and are unaffected. A multi-unit lease's total area = node primary + Σ `tenant_units.area_m2`.
- **PostgREST:** column/table adds need only `NOTIFY pgrst, 'reload schema'` (a schema-cache PATCH is required only for `CREATE/DROP SCHEMA`).
- **Types:** regenerate `packages/db/src/types.ts`; re-apply the `slug?`/`code?` hand-patches per the known gotcha. `parent_node_id` lands nullable (no patch needed).

### 4.3 Procurement & Materials

- **Derivation:** add `sub_board` to the equipment-kind set so each `sub_board` auto-creates one `node_orders` row (`scope_item_type_id` NULL, status `required`, label = board name) via the existing `deriveEquipmentNodeOrder` path — created when the sub-board is created (same as `main_board`/`generator`). A **concession** derives orders exactly like any tenant (per node × scope-item, with `party`); no special path.
- **Rollup (new grouping layer):** on the Materials page, group orders by **owning lease**; nest a lease's `sub_board` orders under the anchor with a rollup pill (e.g. *Shoprite — 1/4 received*; RAG = worst-of-children). A **concession renders as its own group** (own rollup), shown nested under the anchor for context but separated by a **lease-boundary divider**; its orders do *not* count toward the anchor's totals. New helpers `resolveOwningLease()` / `buildAnchorGroups()` in `packages/shared/src/structure/` operate over the already-fetched node list — **no extra query**.
- **Required-by:** `requiredBy(node)` = BO date of `owningLease(node)` when it is a `tenant_db` (via `bo.service.ts`); a concession uses its own BO; common-area sub-boards fall back to project `opening_date` (existing default).

### 4.4 Cable schedule

- **Zero schema change.** `sub_board` nodes are already valid supply endpoints (`supplies.from_node_id/to_node_id → structure.nodes`). Create supplies (*Shoprite DB → Butchery DB*, etc.) and cable each. A concession DB fed from the anchor's board is a supply crossing the lease boundary — fully expressible.
- `buildStructureTree()` already nests boards by feed and detects rings/multi-fed boards, so **dual-supply / changeover works without change**.
- **App changes (small):** the node picker + labels in `AddEntityPanel.tsx` / `CableFormModal.tsx` / `StructureSection.tsx` must include the `sub_board` kind and render its `short_code` for tags.
- **Optional (not v1):** overlay the containment grouping in the structure panel so "these belong to Shoprite" is visible even when an essential board is fed from a generator (the containment ≠ feed case).
- **Follow-up (not v1):** xlsx import setting `parent_node_id` (needs a parent column in the import sheet). v1 creates sub-boards via the structure/tenant UI.

### 4.5 Management UI

- **Tenant schedule** is the home. **"Add sub-board"** on a tenant/board creates a `sub_board` child (editable: name, code, short_code, breaker rating, section, CoC — no shop fields); nesting allowed.
- **"Add concession"** on an anchor creates a `tenant_db` child that then behaves as a normal tenant (own scope grid), shown nested under the anchor.
- **Multi-unit:** a small units editor backed by `structure.tenant_units`; single-unit tenants unaffected (back-compatible).
- The page renders the containment tree with **lease boundaries visually distinct** from board nesting. (The equipment schedule may also surface sub-boards, but primary management is under the anchor.)

### 4.6 Edge cases / non-functional

- **Integrity:** self-parent CHECK + ancestor-walk cycle trigger; same-project parent via the composite FK; `ON DELETE RESTRICT` (can't delete a board with children — re-parent/delete first); leaf deletion cascades its order (existing equipment behaviour).
- **RLS:** row-level on `structure.nodes` already applies; the new column inherits. `tenant_units` gets RLS mirroring nodes. Cross-org/sub-org governed by existing RBAC (`requireRolePage` / `requireEffectiveRole`).
- **Decommission** (`status='decommissioned'`) leaves children intact; rollup may show/hide decommissioned.

## 5. The four anchor shapes — how each maps

| Shape | Mapping | Schema impact |
|---|---|---|
| **Dual / multi-supply** | `tenant_db` Shoprite → `sub_board` *Normal Main DB* + `sub_board` *Essential Main DB* (siblings) → departments under each. All resolve owning-lease = Shoprite. Two feeds = two supplies. | none |
| **Sub-tenant / concession** | `tenant_db` Coffee Kiosk parented under Shoprite. Own lease (own scope/BO); its boards resolve owning-lease = Kiosk, not Shoprite. Shoprite = ancestor → footprint grouping only. Often fed from the anchor's board via the supply graph. | none (allow `tenant_db` to have a parent) |
| **Multi-unit anchor** | One `tenant_db`, several units; one scope/BO; units sum for area. | `structure.tenant_units` |
| **Common-area trees** | `common_area_board` → `sub_board` children; no `tenant_db` ancestor → rollup root is the common-area board. | none |

## 6. Testing

- **Schema smoke** (transactional, rollback): cross-project parent rejected · self-parent rejected · deep cycle rejected · `ON DELETE RESTRICT` blocks parent-with-children · `tenant_units` RLS.
- **Unit (shared):** `sub_board` derivation creates an order · `resolveOwningLease` (dept→anchor; concession board→concession *not* anchor; common-area→null) · required-by inheritance (sub-board inherits anchor BO; concession uses own BO).
- **Component (web):** Materials nested rollup + lease-boundary divider · tenant-schedule add-sub-board / add-concession / units affordances.
- **Cable:** supply anchor DB → sub_board cables; tree nests; ring/multi-fed detection intact.
- Full `apps/web` suite stays green (currently 165).

## 7. Phasing (for the implementation plan)

Each PR independently shippable:

- **PR-A — Schema + types + smoke.** Migration `00116` (parent link, composite FK, cycle guard, `sub_board` kind, `tenant_units`), types regen, smoke tests. No behaviour change.
- **PR-B — Shared helpers + derivation.** `resolveOwningLease` / `buildAnchorGroups`, `sub_board` in equipment-order derivation, required-by inheritance, unit tests.
- **PR-C — Tenant-schedule UI.** Containment tree, add-sub-board, add-concession, units editor.
- **PR-D — Materials rollup.** Nested anchor grouping, lease-boundary divider, RAG rollup, required-by.
- **PR-E — Cable-schedule pickers.** `sub_board` in node pickers/labels/short-codes; (optional) containment overlay.

## 8. Out of scope / follow-ups

- xlsx cable-import setting `parent_node_id` (parent column in the sheet).
- Containment overlay in the cable structure panel (visual only).
- `is_anchor` flag / dedicated anchor entity (Approach B) — only if anchors later need attributes beyond what a `tenant_db` carries.
- Rolling a concession's procurement into the anchor (Decision 6 chose independent leases); revisit only if a real "WM procures the concession as part of the anchor deal" case appears.
