# C12 — Editable Cable Schedule · Design Spec

**Status:** Approved design — ready for implementation plan
**Date:** 2026-05-14
**Module:** Cable Schedule Manager (`cable_schedule.*`)
**Predecessor slices:** C1–C9 shipped to production (`main` = `ae4a1d1`). C10 (React Flow schematic) deferred.
**This slice:** C12 — make the cable schedule fully editable as a live spreadsheet.
**Next slice:** C13 — auto-sizing (platform recommends a cable size from V + load + length + VD limit).

---

## 1. Summary

C12 turns the read-mostly cable schedule grid into a fully editable, spreadsheet-feel
surface. Engineers edit electrical attributes inline (voltage, load, size, length,
install conditions, …); volt drop recomputes instantly in-browser; SANS-derived
values (Ω/km, derated rating) recompute on the autosave round-trip. Nodes
(Council RMU / Consumer RMU / Transformer / Main Board / Sub Board) are managed
in a dedicated panel with structured types. Cables can be added, removed, and
re-routed across revisions, with every field edit written to `change_log` so the
C6 diff viewer stays meaningful.

---

## 2. Scope

### In scope
1. **Migration bundle** (`00054_*`) — extend the supply voltage CHECK (add 22 kV, 33 kV) + add structured node types.
2. **Node-management panel** — dedicated add / remove / rename of nodes, structured types, transformer modelled as a mid-network node.
3. **Live-edit grid** — every editable cell in `CableScheduleGrid` becomes a click/Tab-to-edit inline input; edits autosave on blur/Tab/Enter; hybrid recompute.
4. **Re-pointing** — change a run's From/To without losing the cable's data.
5. **Add / remove cables** — wire the existing delete actions into the UI with cascade-aware (blast-radius) confirmations.
6. **Edit actions + change_log** — new `updateSupplyAction` / `updateCableAction` / re-point action; every field edit logs one `change_log` row.

### Already built — no C12 work
- *"Total length + terminations per cable size, summarised in a separate tab"* → the **Cost Summary tab** (C5) already aggregates length and terminations per size. It re-queries on navigation, so it reflects C12 edits automatically.
- *"Cable tag schedule in a separate tab"* → the **Tags tab** (C5).

### Deferred to C13
- **Auto-sizing.** In C12 the engineer sets V + load + length and *sees* the resulting volt drop / utilisation live, then adjusts the size manually. The platform *recommending or auto-selecting* the optimal size is C13.

---

## 3. Locked decisions (from brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Voltage + load live on the supply**, not the cable. Parallel cables on one supply share them. Editing V/A on any row updates the whole supply. | Electrically conventional. The network steps MV→LV because each supply link carries its own voltage. |
| 2 | **Live-spreadsheet edit pattern** — cells autosave, no modal. | User's explicit choice over per-cell-popover / row-edit-mode. |
| 3 | **Grid edits electrical attributes only.** From/To are node references, not free cells. Node CRUD lives in a dedicated panel. | User: "when a node needs updating we have a dedicated node edit option." |
| 4 | **Runs are re-pointable** — change a supply's From/To via a node picker, keeping the cable's length/measurements/tags. | User: "fully editable for possible changes." |
| 5 | **Hybrid recompute** — pure-math values (volt drop, ΣVD) recompute instantly client-side; SANS-table lookups (Ω/km, base rating, derate factors) recompute on the autosave round-trip. | Volt drop is the number the engineer watches; it stays instant. Ω/km lagging ¼ s is imperceptible. Reuses all existing server-side lookup code. |
| 6 | **Structured node types**; transformer is a mid-network node. | Enables type filtering + future schematic colour-coding (C10) + validation. |
| 7 | **Approach 1 — extend the existing custom `CableScheduleGrid.tsx`**, not a grid library. | The component already owns the column model, cloud markers, length-mode toggle, popover editors. What's needed is an extension, not a heavy dependency with licensing questions. |
| 8 | **Measured length → inline cell. Confirmed length → keeps its existing popover.** | Confirmed length carries a real workflow (method, evidence upload, Verifier sign-off) — too rich for a bare cell. |
| 9 | **Click/Tab-to-edit, not always-on inputs.** | A 200-row × ~15-editable-column grid would render ~3,000 input elements. Click-to-edit-in-place is how Excel/Sheets actually work and is the performant path. |

---

## 4. Schema & migration

### 4.1 Current state (migration `00051`)
- `cable_schedule.supplies.voltage_v NUMERIC NOT NULL CHECK (voltage_v IN (230, 400, 525, 1000, 3300, 6600, 11000))`
- `cable_schedule.sources.type TEXT NOT NULL CHECK (type IN ('MINISUB','STANDBY','PV','UTILITY','RMU'))`
- `cable_schedule.boards` — has `pole_config`, `section`, `parent_board_id` (→ `boards(id) ON DELETE SET NULL`). **No `kind` column.**
- FK cascades: `sources`/`boards` → `supplies` (CASCADE); `supplies` → `cables` (CASCADE); `cables` → `terminations` + `cable_tags` (CASCADE).
- `change_log` columns: `revision_id, organisation_id, entity_type, entity_id, field_name, old_value, new_value, reason, changed_by, changed_at`.

### 4.2 Node-type model
The structural axis already in the schema is **origin** (`sources` — no upstream) vs **distribution node** (`boards` — can be both a "from" and a "to"). The user's node taxonomy maps onto it:

| User term | Category | Storage |
|-----------|----------|---------|
| Council RMU | Origin | `sources`, `type = 'COUNCIL_RMU'` |
| Consumer RMU | Distribution | `boards`, `kind = 'CONSUMER_RMU'` |
| Transformer / Minisub | Distribution | `boards`, `kind = 'TRANSFORMER'` |
| Main Board | Distribution | `boards`, `kind = 'MAIN_BOARD'` |
| Sub Board | Distribution | `boards`, `kind = 'SUB_BOARD'` |

Everything except Council RMU is a board because the MV→LV chain
(Council RMU → Consumer RMU → Transformer → Main Board → Sub Board) needs every
node after the first to receive *and* re-distribute — only `boards` can be both
a `from` and a `to`. This is also the transformer-as-mid-network treatment.

### 4.3 Migration `00054_cable_schedule_c12_editable.sql`
1. **Voltage CHECK** — drop + recreate `supplies.voltage_v` CHECK with `22000, 33000` added.
2. **Source types** — extend `sources.type` CHECK to allow `COUNCIL_RMU` (alongside `UTILITY`, `PV`, `STANDBY`).
3. **Board kind** — add `boards.kind TEXT` with CHECK `IN ('CONSUMER_RMU','TRANSFORMER','MAIN_BOARD','SUB_BOARD')`. Backfill existing rows: `MAIN_BOARD` where `parent_board_id IS NULL`, else `SUB_BOARD`. Set `NOT NULL` after backfill.
4. **Data reconciliation** — for existing `sources` rows:
   - `type = 'RMU'` → `COUNCIL_RMU` (in-place type change).
   - `type = 'MINISUB'` → migrate to a `boards` row with `kind = 'TRANSFORMER'` and re-point its supplies (`from_source_id` → `from_board_id`). **Exact SQL is finalised at plan-time after querying staging** — the module is days old, so this is demo-seed data only and likely zero or near-zero rows. `MINISUB`/`RMU` stay temporarily in the CHECK during the migration transaction, then the CHECK is tightened.
5. `parent_board_id` is unchanged — it still expresses the actual board tree; `kind` just makes main-vs-sub explicit.

---

## 5. Node-management panel

The current `AddEntityPanel`'s **Source** + **Board** tabs become a dedicated **Nodes panel**:
- **List** nodes grouped by type (Origins: Council RMU / Utility / PV / Standby; Distribution: Consumer RMU / Transformer / Main Board / Sub Board).
- **Add** a node — pick type → short form (code, plus type-specific fields: rating/voltage for sources, breaker/section/parent for boards).
- **Rename** a node — inline edit of `code`.
- **Remove** a node — blast-radius confirm (see §8).

Supply + cable creation **moves out** of this panel into the grid's add-cable flow (§7) — "supply" stays an invisible implementation detail; the engineer thinks in nodes + cables.

---

## 6. The live-edit grid

Extends `CableScheduleGrid.tsx` (Approach 1). The component already owns the column
model, revision-cloud markers, parallel-cable brace, length-mode toggle, search,
and the `locked` read-only path.

### 6.1 Editable cells
| Field | Editor | Level | Recompute trigger |
|-------|--------|-------|-------------------|
| voltage_v | dropdown (CHECK-constrained list) | supply | pure-math (VD) |
| design_load_a | number | supply | pure-math (VD, util) |
| section | dropdown (NORMAL/EMERGENCY) | supply | — |
| size_mm2 | dropdown (standard sizes) | cable | SANS lookup + pure-math |
| cores | dropdown (3 / 3+E / 4) | cable | SANS lookup |
| conductor | dropdown (CU / AL) | cable | SANS lookup |
| insulation | dropdown (PVC / XLPE / PILC) | cable | SANS lookup |
| armour | dropdown (SWA / UNARMOURED) | cable | — |
| installation_method | dropdown (5 options) | cable | SANS derating |
| depth_mm | number | cable | SANS derating |
| grouped_with | number | cable | SANS derating |
| ambient_temp_c | number | cable | SANS derating |
| measured_length_m | number (inline cell) | cable | pure-math (VD) |

When `measured_length_m` is edited via the inline cell, `measured_length_method` is
set to `MANUAL` (the engineer is manually entering it). The `CAD` / `SCALE_RULE`
methods remain reachable only through the Excel-import path and the existing
length workflow — they are not exposed as an inline-cell choice in C12.
| ohm_per_km override | number — sets the ⚑ manual_override flag | cable | pure-math (VD) |
| tag_override | text | cable | — |
| notes | text | cable | — |

**Read-only / derived** (never editable): Ω/km (unless overridden), VD %, ΣVD %, derated rating A, utilisation %, cable_no, length status.

**Confirmed length** keeps its existing `LengthEditPopover` workflow (method, evidence upload, Verifier sign-off) — unchanged by C12.

### 6.2 Cell behaviour
- Cells render as values. Click — or Tab into — a cell and it becomes an inline input *in place*.
- Commit on **blur / Tab / Enter**; **Escape** cancels.
- Per-cell state machine: `idle → editing → saving → saved✓` (brief) or `error↩` (revert + inline message).
- Optimistic: the cell shows the new value immediately; pure-math derived columns recompute in the same tick; SANS-derived columns update when the round-trip returns.

### 6.3 Hybrid recompute
- **Client-side, instant** — volt drop % and cumulative VD % via the shared `cable-calc.service` (`computeCumulativeVdMap`, `voltDropPctForSupply`). Already computed at render today; C12 re-runs them on every VD-affecting commit.
- **Server-side, on the autosave round-trip** — for SANS-affecting edits (size, cores, conductor, insulation, install method, depth, grouped-with, ambient), `updateCableAction` re-runs `lookupCableProperties` + `lookupDeratingFactors` + `deratedRating` (the same code `addCableAction` uses) and returns the recomputed `ohm_per_km` + `derated_current_rating_a`. The grid patches those columns on response.
- A `manual_override` on Ω/km is **cleared** when a SANS-affecting field changes (the override was for the old spec); the lookup re-runs fresh.

---

## 7. Add cable / re-point

### 7.1 Add cable
- "Add cable" → pick **From** node + **To** node + the cable spec.
- A supply for that exact (From, To) pair is created implicitly if none exists; otherwise the cable joins the existing supply as a parallel run.
- A new route's supply needs `voltage_v` + `design_load_a` (both NOT NULL) — the add form collects them. A parallel cable on an existing route inherits the supply's V/load.
- Reuses `addSupplyAction` + `addCableAction` (with their SANS auto-fill).

### 7.2 Re-point
- A small "re-route" action on a cable row opens a node picker.
- Changes the supply's `from_source_id` / `from_board_id` / `to_board_id`.
- **All parallel cables on that supply move together** — consistent with decision #1.
- Phase-1 simplification: re-pointing changes the supply in place; it does **not** merge into an existing supply that happens to share the new (From, To) pair. Flagged as a follow-up.

---

## 8. Delete & blast-radius

The schema cascades hard, so every delete shows its blast radius first:
- **Delete a cable** → also removes its terminations + tags. Simple confirm.
- **Delete the last cable on a supply** → the supply auto-deletes (an empty route has no meaning in the nodes-and-cables model and would otherwise be an invisible orphan).
- **Delete a node** → cascades to every supply touching it (as `from` *or* `to`) → their cables → terminations/tags. **Strong confirm** showing counts: *"Removing Main Board A will also delete 3 supplies and 7 cables. Continue?"* Child boards are **not** deleted — they re-parent to top-level (`parent_board_id` is `ON DELETE SET NULL`).
- Affordances: a delete action per cable row in the grid; node deletion in the Nodes panel.
- **change_log on delete** — C12 adds a `change_log` entry on cable/supply removal (the existing delete actions don't log). Keeps the per-revision audit trail and C6 diff viewer complete.

---

## 9. Server actions & change_log

New actions in `cable-entities.actions.ts`, mirroring the `cable-length.actions.ts` pattern (load context → assert DRAFT → role check → update → write change_log → revalidate):

- **`updateSupplyAction`** — voltage / load / section / re-point. Writes one `change_log` row per changed field.
- **`updateCableAction`** — all cable-level fields. If a SANS-affecting field changed, re-runs the lookups and persists recomputed `ohm_per_km` + `derated_current_rating_a`. One `change_log` row per changed field.
- **Delete actions** — extend the existing `deleteCableAction` / `deleteSupplyAction` / `deleteSourceAction` / `deleteBoardAction` to write a `change_log` entry on removal.

Every action runs through `assertDraft` — ISSUED revisions are read-only server-side.

---

## 10. Concurrency, locking, roles, edge cases

- **Concurrency — last-write-wins (Phase 1).** Two people editing the same DRAFT: the later save wins; `revalidatePath` means each sees the other's changes on next render. No optimistic locking — a deliberate Phase-1 simplification given the DRAFT-only model and a small team. An `updated_at` guard can be added later if it bites.
- **ISSUED lock — inherited.** `assertDraft` already blocks all writes to ISSUED revisions; the grid renders read-only via the `locked` prop. C12's new actions all run through the same guard. To change an issued schedule you start a new revision (existing flow).
- **Role gating.** C12 adds an `editSchedule` capability to `ROLE_CAPS` (`lib/cable-schedule/roles.ts`): Designer + Verifier + Admin can edit cells, add/remove cables, and manage nodes; SiteOperator stays confined to confirmed-length capture; Viewer is read-only.
- **Validation** — voltage is dropdown-constrained; load/size/depth/etc. are validated by the Zod action schemas; invalid values revert with an inline cell error.

---

## 11. Anticipated files

| File | Change |
|------|--------|
| `apps/edge-functions/supabase/migrations/00054_cable_schedule_c12_editable.sql` | new — migration bundle (§4.3) |
| `apps/web/src/actions/cable-entities.actions.ts` | extend — `updateSupplyAction`, `updateCableAction`, re-point action; `change_log` on deletes |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` | major extension — editable cells, autosave, optimistic recompute |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/EditableCell.tsx` | new — inline cell-editor primitives (number / dropdown / text / node-picker) |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/NodesPanel.tsx` | new — dedicated node-management panel |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | refactor — Source/Board tabs extracted to NodesPanel; **Supply tab removed** (supplies are now implicit, created by the add-cable flow); Cable tab becomes the add-cable-with-node-pick flow |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | wire NodesPanel + pass editable data + node-type lists |
| `apps/web/src/lib/cable-schedule/roles.ts` | add `editSchedule` capability to `ROLE_CAPS` |
| `packages/shared/src/services/cable-calc.service.ts` | confirm client-side recompute exports are clean (likely no change) |
| `packages/db/src/types.ts` | regen after migration (if used by cable-schedule) |

---

## 12. Verification plan

1. **Migration** applies cleanly to staging; existing boards backfilled with `kind`; voltage CHECK accepts 22 kV / 33 kV; any `MINISUB`/`RMU` source rows reconciled.
2. **Typecheck** — `pnpm --filter web type-check` clean for all new/changed files.
3. **Browser (preview):**
   - Edit a voltage cell → VD updates instantly; the supply's parallel cables update together.
   - Edit a size cell → Ω/km + derated rating update on the round-trip (~¼ s).
   - Create a 22 kV supply via add-cable → accepted.
   - Add a parallel cable to an existing run; add a cable on a new route.
   - Delete a cable → terminations/tags gone; delete the last cable on a supply → supply auto-removed.
   - Delete a node → blast-radius confirm shows correct counts; child boards re-parent.
   - Re-point a run → all parallel cables move; data preserved.
   - Open an ISSUED revision → grid is read-only; edit actions rejected server-side.
4. **change_log** — every field edit + delete produces a row; the C6 diff viewer reflects the edits.
5. **Cost Summary + Tags tabs** re-query and reflect C12 edits with no code change.

---

## 13. Out of scope / follow-ups

- **C13 — auto-sizing** (platform recommends a size from V + load + length + VD limit).
- **Re-point merge** — re-pointing into an existing (From, To) pair merges supplies (Phase-1 just re-points in place).
- **Optimistic locking** — `updated_at` guard for concurrent DRAFT edits.
- **C10** — React Flow schematic distribution tree (still deferred).
