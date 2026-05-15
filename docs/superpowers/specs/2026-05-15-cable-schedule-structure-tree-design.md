# Cable Schedule — Structure panel as a feed tree

**Date:** 2026-05-15
**Status:** Design approved — ready for implementation plan
**Branch:** `feat/powersync`
**Scope owner:** Arno

---

## 1. Context & problem

The user's original report: *"adding sources or nodes to build out the structure for the from and to is not really clear on how to accomplish… Consumer RMU would be back-to-back with the council RMU with a cable link between the two, the Transformer/Mini-sub sits below RMUs, then main board and sub boards below that."*

Two problems: you **can't see** the feed hierarchy (the Structure panel shows Sources and Boards as two flat lists), and **building it isn't obvious** (you add a flat board, then separately wire a cable via the Add-cable form — the two steps never visibly connect).

### Key decisions (from brainstorming)

1. **The feed graph *is* the hierarchy.** The "supply" rows you already create (one from-node → one to-board, carrying cables) *are* the parent→child links. There is no separate manual `parent_board_id` tree — `parent_board_id` stays dormant; the supply graph is the structure. (The user chose this over a separate manual parent field.)
2. **The Structure panel *becomes* the tree.** The flat two-column Sources/Boards layout is replaced by one tree, rendered from the supply graph — you both *see* the hierarchy and *build/edit* on it in one surface. (Chosen over a read-only tree alongside the flat columns — that would reintroduce the flat-list redundancy the recent redesign removed.)

---

## 2. Goals & non-goals

### Goals
- The Structure panel renders the revision's supply graph as an indented feed tree.
- Each node carries an action to extend the structure ("+ feed a board") that creates the next branch — board + supply + cable — in one flow.
- The two original complaints are both addressed: the hierarchy is *visible*, and adding into it is *one obvious action*.

### Non-goals
- No use of `parent_board_id` — it remains dormant; the tree is built purely from `supplies`. (Cleaning it up as dead schema is a separate, optional future task.)
- No DB migration, no RLS changes — everything is rendering + wiring the graph that already exists.
- No change to the volt-drop / derating / auto-parallel maths — the tree *displays* those existing results on its edges.
- No drag-to-re-parent in this iteration — re-pointing a feed stays the existing grid "re-point" action; the tree is build + view.

---

## 3. Design

### Section 1 — The tree data structure (pure, in `@esite/shared`)

A new pure function `buildStructureTree(sources, boards, supplies, cables, …)` in `packages/shared/src/services/` (testable, no I/O):

- **Roots** = every source. Children of a node = the boards that are the `to_board_id` of a supply whose `from_source_id`/`from_board_id` is that node. Recurse.
- **Each edge = a supply.** The node carries a `feedSummary` for the supply that feeds it: cable count, a size/conductor label (e.g. `5×300mm² Cu`), the per-supply VD%, and the auto-parallel `underRated` flag. Roots (sources) have `feedSummary: null`.
- **Multi-fed boards** — a board can be the `to_board_id` of more than one supply (normal + standby is real). It appears under *each* feeder; the 2nd-and-later occurrences are flagged `alsoFedElsewhere: true` so the UI can render an "↻ also fed from…" marker instead of re-expanding the whole subtree.
- **Unfed group** — boards with *no* incoming supply are not under any source. They are returned as a separate `unfed` list, each still carrying its own subtree (so an orphan sub-chain stays intact).
- **Cycle guard** — a visited-set during the walk prevents infinite recursion on malformed data (same guard `computeCumulativeVdMap` already uses).
- Returns `{ roots: StructureTreeNode[]; unfed: StructureTreeNode[] }`. Each `StructureTreeNode` keeps the existing per-node blast-radius counts (`blastSupplies`, `blastCables`) so the delete-confirm modal still works.

### Section 2 — The Structure panel becomes a recursive tree (`StructurePanel.tsx`)

`StructurePanel` is reworked from the flat two-column layout into a recursive tree renderer:
- Renders `roots` (sources, each with its fed subtree), then the `Unfed` group below.
- Each node row shows: icon + code + type, and — for non-root nodes — the `feedSummary` edge label (`← 5×300mm² Cu`, VD%, the ⚠ under-rating flag).
- Per-node actions: **"+ feed a board"** (see Section 3), plus the existing **rename** and **remove** (the blast-radius confirm modal is kept unchanged).
- Bottom-of-panel actions: **"+ Add source"** and **"+ Add board (unfed)"** — the existing `AddNodeForm` flow, for bare nodes you wire later.
- Multi-fed occurrences render the compact "↻ also fed from X" marker rather than duplicating the subtree.
- ISSUED/locked revisions render the tree read-only (the existing `canEdit` gate).

### Section 3 — The "+ feed a board" build flow

"+ feed a board" on a tree node is the core fix for "building isn't clear". It opens the **existing Add-cable form** (`CableForm`), **pre-seeded** with "From" = the clicked node. The form's **"To (board)"** field gains a **"+ new board…"** option: choosing it reveals an inline board-name input. On submit:
- if "To" is an existing board → today's flow unchanged (`findOrCreateSupplyAction` → `addCableAction`/`addParallelCableSetAction`);
- if "To" is "+ new board" → the form first calls `addBoardAction` to create the board, then proceeds with the resolved board id. A partial failure (board created, supply/cable fails) is recoverable — the new board simply shows in the "Unfed" group.

**Integration point (for the plan to resolve):** `StructurePanel` and the Add-cable `CableForm` must share the pre-seeded "From" node. `page.tsx` is a server component and can't hold the shared client state. The implementation plan chooses the cleanest shape — most likely either a thin client wrapper component holding a `feedFrom` state that renders both, or extracting `CableForm` into its own file so `StructurePanel` can render it inline on "+ feed a board". The spec mandates the *behaviour*; the plan picks the wiring.

### Section 4 — `page.tsx` wiring

`page.tsx` already loads `sources`, `boards`, `supplies`, `cables` and computes per-supply VD / capacity / under-rating. It calls `buildStructureTree(...)` with that data and passes the resulting `{ roots, unfed }` into the reworked `StructurePanel` (replacing the current flat `panelNodes` array). The existing per-supply VD%, `combined_capacity_a`, and `underRated` computations feed the edge `feedSummary` — no recomputation.

---

## 4. Components touched

| File | Change |
|---|---|
| `packages/shared/src/services/` (new file, e.g. `cable-structure.service.ts`) | New pure `buildStructureTree` + `StructureTreeNode` type — builds roots/unfed/children/feedSummary with a cycle guard |
| `packages/shared/src/services/cable-structure.service.test.ts` (new) | Unit tests: roots, nesting, multi-fed, unfed group, cycle guard |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/StructurePanel.tsx` | Reworked from flat two columns into a recursive feed-tree renderer; per-node "+ feed a board"; rename/remove + blast-radius modal kept; `+ Add source` / `+ Add board (unfed)` kept |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | `CableForm` gains a pre-seedable "From", and a "+ new board…" inline option on the "To" field that chains `addBoardAction` before the supply/cable creation |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | Calls `buildStructureTree(...)`, passes `{ roots, unfed }` to `StructurePanel`; wires the shared `feedFrom` state per the plan's chosen integration shape |

No DB migration, no RLS changes, no server-action signature changes (the build flow reuses `addBoardAction` / `findOrCreateSupplyAction` / `addCableAction` / `addParallelCableSetAction` as-is).

---

## 5. Error handling

Existing patterns carry over — the inline `role="alert"` error surfaces and `useTransition`-wrapped action handlers. The "+ new board" chain's partial-failure case (board created, feed fails) is non-destructive and self-evident: the orphan board appears in the "Unfed" group, ready to wire. `buildStructureTree`'s cycle guard means malformed graph data degrades gracefully rather than hanging.

---

## 6. Testing & verification

- **Unit tests** (`cable-structure.service.test.ts`, vitest): `buildStructureTree` — a simple source→board→board chain produces the right nesting; a board fed by two supplies is flagged `alsoFedElsewhere` on the second occurrence; a board with no incoming supply lands in `unfed`; a cyclic `supplies` set terminates (cycle guard) instead of hanging.
- **Typecheck:** `pnpm --filter @esite/shared exec tsc --noEmit` clean; `pnpm --filter web exec tsc --noEmit` adds zero new errors beyond the known 5-error pre-existing baseline.
- **Manual walkthrough** (best-effort — the dev server's Supabase connectivity has been unreliable): the Structure panel shows the feed tree; "+ feed a board" on a node opens the Add-cable form with "From" pre-set; "+ new board" creates the board inline and the new branch appears; an unfed board shows in the Unfed group.

---

## 7. Deferred / out-of-scope notes

- Cleaning up the now-confirmed-dead `parent_board_id` column is an optional separate task — left in place, harmless.
- Drag-to-re-parent on the tree is out of scope — re-pointing a feed stays the existing grid action.
- The auto-parallel optimistic-UI ambiguity noted in the prior batch's review remains a separate follow-up.
