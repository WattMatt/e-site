# Cable Schedule — auto-parallel cables + supply under-rating flag

**Date:** 2026-05-14
**Status:** Design approved — ready for implementation plan
**Branch:** `feat/powersync`
**Scope owner:** Arno

---

## 1. Context & problem

In the Cable Schedule, a supply carries a `design_load_a` (e.g. 1600 A). A single cable of a given spec has a finite current rating (a 4-core 240mm² cable is rated ~340 A in isolation). When the design load exceeds one cable's rating, the engineer runs cables **in parallel** — but today the tool gives no help: you add the cables one at a time by hand, with no calculation of how many you need and no check that the set actually carries the load.

This feature adds:
- **Auto-parallel on add** — when you add a cable to a supply whose design load exceeds one cable's rating, the form computes how many parallel cables are needed and creates the whole set in one action.
- **A supply under-rating flag** in the schedule grid — so supplies that aren't freshly auto-built (legacy data, or a design load bumped up later) are visibly flagged when their combined capacity falls short.

### Key decisions (from brainstorming)

1. **Trigger model — auto-create on Add.** As the user picks size + conductor, the Add-cable form shows a live readout ("5 × 4Cx240mm Cu needed for 1600 A"); the count is pre-filled but editable; Add creates all N parallel cables at once.
2. **Calculation — grouping-aware / iterative.** The SANS derated rating includes a *grouping factor* that worsens as more cables are bundled, so `ceil(load ÷ isolated-rating)` under-counts. The calc finds the smallest N where N cables — each derated for being in a group of N — together carry the design load, and stamps `grouped_with = N` on every created cable.
3. **Existing cables — auto-create only on an empty supply.** If the target supply already has cables, the readout still shows as guidance but Add reverts to adding a single cable. Nothing is bulk-created or deleted on a non-empty supply (non-destructive, predictable).
4. **Warning scope — include a supply-level under-rating flag.** Because auto-parallel deliberately skips non-empty supplies, the grid flag is the safety net for everything not freshly auto-built. It also corrects the existing per-cable utilisation, which is misleading for parallel sets.

### Approach (chosen: A — shared calc, one source of truth)

The iterative grouping-aware math lives once in `@esite/shared` and is reused three ways: a thin read-only preview server action the form debounce-calls, the batch-create server action, and `page.tsx`'s grid under-rating computation. Rejected alternatives: a client-side calc with a preloaded SANS table (duplicates safety-critical math, drift risk); calc-only-at-submit (kills the live readout chosen in decision 1).

---

## 2. Goals & non-goals

### Goals
- Compute the correct parallel count for a cable spec against a supply's design load, grouping-aware.
- Let the Add-cable form show that count live and create the whole set in one action (empty supplies only).
- Flag under-rated supplies in the schedule grid and fix the misleading per-cable utilisation.

### Non-goals
- The system never auto-*sizes* the cable — the user picks the size/conductor (240 vs 300mm², Cu vs Al); the tool only computes *how many*.
- Supplies that already have cables are never bulk-modified or deleted.
- No migration to recompute historical `derated_current_rating_a` — the grid flag uses stored per-cable values.
- Topic A (structure hierarchy / `parent_board_id` editing) is a separate spec, not part of this work.
- No new DB columns — `cables.grouped_with` and `cables.derated_current_rating_a` already exist (migration 00051).

---

## 3. Design

### Section 1 — The calculation (`packages/shared/src/services/cable-calc.service.ts`)

Two helpers, next to `deratedRating`:

**`requiredParallelSet`** — the iterative, grouping-aware core. A *pure* function: it is handed the cable's base SANS rating and a means of obtaining the derate factors for any group size (the server layer supplies that — the function does no DB calls, so it is unit-testable in isolation). Algorithm: for N = 1, 2, 3…, compute each cable's derated rating *at group size N* (`base × depth × thermal × grouping(N) × temperature`); return the first N where `N × perCableRating ≥ design_load_a`, as `{ count, perCableRatingA, combinedRatingA }`. Because the grouping factor worsens as N rises, this lands on the genuinely-rated count, not the naive `ceil(load ÷ isolated-rating)`.

Edge cases: iteration is capped at N ≤ 16. If the cap still cannot carry the load, it returns `{ count: 16, …, insufficient: true }`. If no base rating resolves for the spec, it returns `null` (caller falls back to a plain single-cable add).

**`supplyParallelCapacity`** — companion for the grid flag: sums the *stored* `derated_current_rating_a` across a supply's existing cables (each parallel cable already carries its grouping-derated rating). The caller derives `underRated = combinedCapacity < design_load_a`.

### Section 2 — Server actions (`apps/web/src/actions/cable-entities.actions.ts`)

**`previewParallelCableSet`** — read-only; the form debounce-calls it. Input: supply identity (`revisionId`, `fromSourceId`/`fromBoardId`, `toBoardId`, `designLoadA`) + the cable spec (size, cores, conductor, insulation, installationMethod, depthMm, ambientTempC, thermalResistivityKmw). It fetches the SANS base rating + the grouping derate factors, runs `requiredParallelSet`, and checks whether a supply already exists for that (from, to) pair and has cables. Returns `{ count, perCableRatingA, combinedRatingA, insufficient, mode }` where `mode` is `'create-set'` (supply empty/new) or `'add-single'` (supply already has cables). No writes.

**`addParallelCableSetAction`** — the create. Input: supply identity + cable spec + `count`. Flow: (1) `findOrCreateSupplyAction` resolves the supply; (2) **empty-supply guard** — if it already has cables, create exactly one cable (today's single-add behaviour) and return, ignoring `count`; (3) if empty, do the SANS lookup once (same spec, group size = `count`), build an array of `count` cable rows — `cable_no` 1…N, every row stamped `grouped_with = count` and the derated rating for group-size N — and insert them in **one array `.insert([...])` call** (atomic at the statement level); (4) write one `change_log` entry ("auto-parallel: N cables").

The spec → `{ ohm_per_km, derated_rating }` resolution that `addCableAction` already performs is extracted into a small shared helper so it is not duplicated across `addCableAction`, `previewParallelCableSet`, and `addParallelCableSetAction`.

Error handling: a preview-call failure degrades the form to a plain single-cable add (no readout) — it never blocks. A batch-insert failure is surfaced inline exactly as `addCableAction`'s errors are.

### Section 3 — Add-cable form UX (`apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx`)

A **live readout block** sits always-visible just above the submit button. It reacts to the design load + the spec fields (defaults included, so it works whether or not the "More cable detail" expander is open), debounce-calling `previewParallelCableSet` on relevant changes. Display precedence: `insufficient` (a boolean on the response) wins over everything; otherwise the readout reflects `mode`:
- **`insufficient` (any mode):** "Even 16 in parallel won't carry 1600 A at this size — pick a larger cable."
- **`create-set` (not insufficient):** "5 × 4Cx240mm Cu → combined 1700 A (≥ 1600 A design load)"
- **`add-single` (not insufficient):** "This supply already has cables — Add will add 1 more. (≈5 recommended for 1600 A.)"

A **count field** appears only in `create-set` mode when not `insufficient`, pre-filled with the computed N but editable. Editing it below the recommended N shows a subtle "below recommended (5)" note — allowed, not blocked (the Section 4 grid flag also catches it).

The **Add button** branches on `mode`: in `create-set` it calls `addParallelCableSetAction` with the count, labelled "Add N cables"; in `add-single` (or when the readout is unavailable) it is the existing single-cable path, labelled "Add cable". After a successful set-add, the form's existing flash reports "N cables added."

Everything else in the progressive form (the 5 primary fields, the "More cable detail" expander, the existing `go()` field handling) is untouched.

### Section 4 — Grid under-rating flag (`page.tsx` + `CableScheduleGrid.tsx`)

`page.tsx` already loads every supply and cable and runs the volt-drop precompute. Alongside it, for each supply it computes `combinedCapacity` via `supplyParallelCapacity` and an `underRated` boolean (`combinedCapacity < design_load_a`), passed down per row.

`CableScheduleGrid.tsx`:
- **Under-rating flag** — rows whose supply is under-rated get a visible amber/red marker (same vocabulary as the existing cloud markers / length-status badges), tooltip: "Supply under-rated: 1500 A capacity < 1600 A design load."
- **Fix the misleading utilisation** — the current per-cable `utilisationPct` (`load_a ÷ one cable's rating`) reads ~600% for a healthy parallel set. It is replaced with **supply-level** utilisation: `design_load_a ÷ combinedCapacity` — so a correct 5-parallel set shows ~94%, and the flag and the utilisation number agree.

---

## 4. Components touched

| File | Change |
|---|---|
| `packages/shared/src/services/cable-calc.service.ts` | New `requiredParallelSet` (pure, iterative, grouping-aware) + `supplyParallelCapacity` (sum of stored derated ratings) |
| `packages/shared/src/services/cable-calc.service.test.ts` | Unit tests for both new helpers |
| `apps/web/src/actions/cable-entities.actions.ts` | New `previewParallelCableSet` (read-only) + `addParallelCableSetAction` (batch create); extract a shared spec→`{ohm_per_km, derated_rating}` resolver from `addCableAction` |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | Live readout block, editable count field, mode-aware Add button |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | Compute per-supply `combinedCapacity` + `underRated`, pass into the grid |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` | Render the under-rating flag; replace per-cable utilisation with supply-level utilisation |

No DB migration, no RLS changes, no changes to `@esite/shared`'s existing exports beyond the two additions.

---

## 5. Error handling

All existing patterns carry over. The preview action is read-only and best-effort — any failure degrades the form to a plain single-cable add. The batch-create action surfaces errors inline via the form's existing `role="alert"` / `useTransition` handling. The single array-`.insert` keeps the create atomic — no partial parallel sets. `requiredParallelSet` returning `null` or `insufficient` is a normal, handled outcome, not an error.

---

## 6. Testing & verification

- **Unit tests** (`cable-calc.service.test.ts`, runs under vitest in `@esite/shared`): `requiredParallelSet` — exact-divide, round-up, grouping-pushes-N-higher, the `insufficient` cap case, and the `null` no-base-rating case; `supplyParallelCapacity` — a sum plus the under-rated boundary.
- **Typecheck** — `pnpm --filter web exec tsc --noEmit` must add zero new errors beyond the known pre-existing baseline (5 schema-drift errors in unrelated files — see the redesign plan's conventions); `pnpm --filter @esite/shared exec tsc --noEmit` stays clean.
- **Manual walkthrough** — add a 1600 A supply, pick 4Cx240mm Cu, confirm the readout shows the grouping-aware count and Add creates that many cables; switch the conductor to Al and confirm the count rises; bump an existing supply's design load and confirm the grid under-rating flag lights up and the utilisation number is supply-level.

---

## 7. Deferred / out-of-scope notes

- Topic A — structure hierarchy / `parent_board_id` editing + tree visualisation in the Structure panel — is a separate spec.
- No recompute migration for historical `derated_current_rating_a`; the grid flag trusts stored values.
- Auto-*sizing* the cable (choosing the conductor size) is intentionally not done — the engineer picks the spec, the tool only counts.
