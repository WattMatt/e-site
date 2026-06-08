# Equipment + Materials → one unified tab — design spec

**Date:** 2026-06-08
**Status:** design locked (all decisions LOCKED or DONE — see Decisions). Planning only; no implementation in this document.
**Context project:** Kings Walk (`KINGSWALK`, `81fc2329-2462-457d-9d24-9b051673c909`)
**Companion artifacts (Obsidian vault):** `sessions/equipment-materials-merge-2026-06-08-plan.html`, `sessions/equipment-materials-merge-2026-06-08-mockup.html`

---

## 1. Goal

Replace the two confusing tabs — **Equipment Schedule** (`/projects/[id]/equipment-schedule`) and **Materials** (`/projects/[id]/materials`) — with **one tab, “Equipment & Materials”**, built on a single mental model: **a board is the unit of work; its procurement is detail of that board.** The new tab absorbs all four Part A fixes (classification, pull-through, natural sort, file preview/download).

## 2. Background — why the split confuses users

The two tabs are two views of overlapping data fed by **different tables**:

- **Equipment Schedule** lists `structure.nodes` (boards), grouped by `kind`, with add/edit/decommission and a small order-status cell. Source: `listNodes` + a side query of `node_orders`.
- **Materials** lists `structure.node_orders` (procurement lines: tenant scope orders + equipment orders), with status, dates and documents.

A board exists in `nodes` but only appears in Materials if it also has a `node_orders` row. The two can **drift**: in Kings Walk, 6 common-area boards were visible in Equipment yet absent from Materials because they had no order row (imported after the one-time backfill migration `00089`). The user must cross-reference two tabs to answer one question — “what is the state of this board?”

## 3. Decisions (record)

| ID | Decision | Status | Date |
|----|----------|--------|------|
| D1 | One tab replaces both; the **board (node) is the unit**, procurement is its detail. | LOCKED | 2026-06-08 |
| D2 | Scope = **all boards** in one buy-list: equipment boards (managed here) + tenant/shop boards (procurement rollup, authored in Tenant Schedule). | LOCKED | 2026-06-08 |
| D3 | **Master-detail** layout (board list → expandable procurement detail). | LOCKED | 2026-06-08 |
| D4 | Board classification corrected: shop/tenant boards are `tenant_db`, not common-area (DB-32/DB-52A moved). Grouping stays kind-based. | DONE (Part A) | 2026-06-08 |
| D5 | Single source of existence: the board list is driven by `nodes`; procurement is attached — a board can never be silently dropped. | LOCKED | 2026-06-08 |
| D6 | Natural/alphanumeric ordering by code (DB-2 before DB-10) in every group. | DONE (Part A) | 2026-06-08 |
| D7 | File preview (popup-safe new tab) + forced download on every attached document. | DONE (Part A) | 2026-06-08 |
| D8 | Unified tab name: **“Equipment & Materials”**. | LOCKED | 2026-06-08 |
| D9 | Invariant enforced by a **DB trigger** (auto-create the equipment order on node insert); remove the redundant app-level insert; keep the Part-A read harden as a safety net. | LOCKED | 2026-06-08 |
| D10 | Document **preview = an in-app modal/panel** (PDF in an `<iframe>`, image inline, other types fall back to download), with a download button — **not** a new browser tab. Supersedes D7's "new tab" for the unified tab; the Part-A `triggerDownload` helper is reused, a new `DocumentPreviewModal` replaces the new-tab `previewViaSignedUrl` here. | LOCKED | 2026-06-08 |

No decision is left in PROPOSED.

## 4. Data model — one board-centric read

The unified tab reads board-first, then attaches procurement:

- **Boards** — `listNodes(projectId)` returns every `structure.nodes` row (all kinds). Existence of a board row is the *only* condition for it to appear. (D5)
- **Equipment orders** — `node_orders` where `scope_item_type_id IS NULL`: exactly one per equipment board, guaranteed by the D9 trigger.
- **Tenant orders** — `node_orders` where `scope_item_type_id IS NOT NULL`: one per tenant scope item (DB / Lighting / Other), derived from the tenant’s scope.
- **Documents** — `node_order_documents` (Quote, Order Instruction) and `node_order_shop_drawings` (multi-drawing list), keyed by `node_order_id`.

Two board types, one list:

| | Equipment board (`kind != tenant_db`) | Tenant / shop board (`kind = tenant_db`) |
|---|---|---|
| Managed (add/edit/decommission) | **here** | in Tenant Schedule (deep-link) |
| Orders | exactly 1 (trigger-guaranteed) | 0..N scope orders |
| Procurement summary | status chip | rollup ("DB ✓ · Lt ○") |
| Procurement actions (mark ordered/received, upload docs) | here | here |
| Scope / drawings / BO authoring | n/a | Tenant Schedule |

## 5. UI specification — the “Equipment & Materials” tab

**Route:** new canonical route `/projects/[id]/equipment-materials`. The old `/equipment-schedule` and `/materials` routes **redirect** to it (preserve existing links/bookmarks). One sidebar nav entry, “Equipment & Materials”, replaces the two.

**Page header:** title “Equipment & Materials”, subtitle `{project.name} · one board register + buy-list`.

**Filter bar:** status pills — `All` / `Required` / `Ordered` / `Received` / `By tenant` (counts) — filtering on procurement status (mirrors today’s Materials pills, plus a visible `By tenant`). A code/name search box. Toolbar: `+ Add board`, `Show decommissioned` toggle.

**Groups:** boards grouped by category, **collapsible** (`<details>`/disclosure), fixed order:
RMU · Mini-Substations · Generators · Main Boards · Common Area Boards · Common Area Lighting · *(custom kinds, by label)* · **Tenant / Shop Boards**.
Within each group: **natural sort by `code`** (D6). Empty groups are hidden.

**Master row (a board):**
- `Code` (mono, natural-sorted) · `Name` / shop name
- `Procurement`: equipment → a status chip (`Required`/`Ordered`/`Received`); tenant → a compact rollup of its scope lines.
- `Required by`: date + RAG dot (red overdue / amber due-soon / green on-track / neutral none).
- `COC`: badge for equipment boards that require a Certificate of Compliance.
- `Manage`: equipment → `Edit` · `Decommission`; tenant → `Tenant Schedule ↗` deep-link.
- Clicking the row toggles the **detail panel**.

**Detail panel — equipment board:**
- Procurement line: status chip + the single advance action (`Mark ordered` when Required, `Mark received` when Ordered); `required by` / `ordered` / `received` dates.
- Documents: `Quote`, `Order instruction`, `Shop drawings`. Each attached file shows the filename with **`⤢ preview`** (opens an **in-app preview modal** — PDF in an `<iframe>`, image inline; D10) and **`↓ download`** (forced); empty slots show an upload control. (Reuses the Part-A `triggerDownload` helper + a new `DocumentPreviewModal`; the new-tab `previewViaSignedUrl` is replaced by the modal here.)

**Detail panel — tenant / shop board:**
- The scope-order lines (DB / Lighting / Other), each with its status chip, dates, and any documents (same preview/download). `By tenant` lines are shown but carry no buy action.
- A `Open {code} in Tenant Schedule — scope · drawings · BO ↗` link for authoring.

**States:**
- **Orderless equipment board** (legacy / safety only): rendered as a read-only `Required` row with a “no order yet” hint. With D9 in place this cannot arise for new boards; the Part-A read-layer harden remains as a backstop.
- **Decommissioned** boards hidden unless `Show decommissioned` is on.

## 6. How each Part A fix lives in the unified tab

- **① Classification (D4):** `tenant_db` boards (incl. the moved DB-32 / DB-52A) sit under **Tenant / Shop Boards**, never Common Area. The Common Area Boards group is the 6 genuine infra boards.
- **② Pull-through (D5 + D9):** the list is existence-driven from `nodes`, and the trigger guarantees every equipment board has an order — the buy-list can never silently drop a board.
- **③ Natural sort (D6):** applied in every group via the shared `naturalCompare`.
- **④ Files (D7):** every document exposes popup-safe preview + forced download.

## 7. D9 — the equipment-order trigger (structural lock)

Migration `00121`:

- `AFTER INSERT ON structure.nodes FOR EACH ROW`, `SECURITY DEFINER`, when `NEW.kind = ANY(EQUIPMENT_KINDS)` (the equipment set: `rmu, mini_sub, generator, main_board, common_area_board, common_area_lighting, custom` — i.e. not `tenant_db`/`sub_board`): insert the equipment `node_orders` row (`node_id, project_id, organisation_id, label=NEW.code, scope_item_type_id=NULL, status='required'`) **if one does not already exist** (the partial unique index `idx_node_orders_equipment_unique` is the guard; `WHERE NOT EXISTS` keeps it idempotent).
- **Remove** the now-redundant app-level order insert in `createEquipmentNodeAction` (`equipment.actions.ts:190–222`) so node creation and its order are a single atomic DB effect, on every insert path (UI, bulk import, manual).
- `REVOKE EXECUTE … FROM PUBLIC` on the trigger function per the project’s `SECURITY DEFINER` convention.
- Trigger fires on INSERT only — decommission/reactivate and code edits do not touch it. (Label does not follow a later code rename; this matches today’s behaviour and is out of scope.)

## 8. Permissions (RBAC)

- **Board management** (add / edit / decommission equipment boards): `ORG_WRITE_ROLES` (owner / admin / project_manager), as the Equipment Schedule enforces today via `requireEffectiveRole`.
- **Procurement actions** (mark ordered/received, upload/clear documents, shop-drawing status): unchanged from today’s Materials actions.
- **Preview / download**: read access (`guardProjectRead`) — any project member.
- `docs/rbac-matrix.md` updated in the same PR that introduces the route (project convention).

## 9. Out of scope / deferred

- Tenant board authoring (scope, drawings, BO dates) stays in the Tenant Schedule; this tab links out, it does not duplicate it.
- Syncing an equipment order’s `label` to a later board-code rename (pre-existing behaviour; unchanged).
- The Cable Schedule and JBCC modules are untouched.

## 10. Suggested implementation phasing (for the plan, not this spec)

1. **Structural lock** — migration `00121` (D9 trigger) + remove the app-level insert; verify on prod that all equipment boards retain exactly one order.
2. **Unified route + master-detail UI** — the new `equipment-materials` page reading board-first, reusing the Part-A `OrderDocSlot` / `ShopDrawingList` / `naturalCompare` / file helpers; the existing `OrderRow`/`KindGroup` logic folds into the board-centric rows.
3. **Cutover** — sidebar nav → one entry; redirect `equipment-schedule` + `materials`; retire the old pages once the new one reaches parity.

The detailed step-by-step plan is produced separately (writing-plans), not here.
