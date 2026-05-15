# Cable Schedule — calculation honesty + Add-cable display

**Date:** 2026-05-15
**Status:** Design approved — ready for implementation
**Branch:** `feat/powersync`
**Scope owner:** Arno

---

## 1. Context & problem

Three small, related Cable Schedule changes, batched:

1. **A SANS audit found one silent-fallback hole.** `lookupFactor()` in `sans-lookup.service.ts` returns `1` (i.e. *no derating, full capacity*) on three genuine-miss paths — the factor table is absent, the table is empty, or the chosen row's factor cell is non-numeric. Its own docstring says a missed lookup should "err on the safe side"; returning `1` does the opposite. With the SANS tables now fully populated this is latent, but it is a real "hallucinated value" path — a cable could read fully-rated purely because a table was missing. (Everything else audited clean: Ω/km and base ratings are 100% table-driven, `lookupCableProperties` honestly returns `null` on a miss, the Excel importer reads cell values verbatim, and there are no hardcoded resistance/rating maps anywhere.)
2. **The per-cable load split is computed but never shown.** `voltDropPctForSupply` already divides a supply's `design_load_a` across N same-size parallel cables (effective Ω/km = Ω/km ÷ N), and the under-rating flag is supply-level — but the grid never *displays* the per-cable current share. Users want to see "1600 A supply on 5 cables → 320 A each" on screen.
3. **The Conductor (Cu / Al) selector is hidden.** It already exists in the Add-cable form and genuinely drives the rating (Cu vs Al hit different SANS tables → different current rating → different auto-parallel count), but after the redesign it sits inside the "+ More cable detail" expander. A choice that materially changes the calculation should not be hidden.

### Key decisions (from brainstorming)

- **Missing derate table → honest `null`** (not a hard error). When a derate-factor table is genuinely missing, the cable's `derated_current_rating_a` becomes `null` — the grid shows "—" and the under-rating flag treats it as unknown, consistent with how a missing Ω/km already behaves. Non-destructive; the cable still saves.
- **Per-cable share is a display addition** — the maths is already correct; only a grid column is added.
- **Conductor field is promoted, not redesigned** — pure JSX relocation out of the expander; the control, options, and calc wiring are unchanged.

---

## 2. Goals & non-goals

### Goals
- No SANS derate-factor lookup ever silently substitutes `1` for genuinely-missing data — a missing table yields an honest `null` that propagates to `derated_current_rating_a`.
- The schedule grid shows each cable's per-cable load share for parallel sets.
- The Conductor Cu/Al selector is a primary, always-visible field in the Add-cable form.

### Non-goals
- No change to the *nearest-conservative* row selection in `lookupFactor` for in-range values — that logic is correct and stays.
- No new DB columns or migration — `derate_*` and `derated_current_rating_a` columns are already nullable; the per-cable share is computed, not stored.
- No change to the volt-drop maths — it already divides load across parallel cables correctly.
- No redesign of the Conductor control — just its placement.
- Whether depth-derating *should apply* to in-air cables is a separate domain question, out of scope.
- Topic A (structure hierarchy) remains a separate, paused brainstorm.

---

## 3. Design

### Section 1 — SANS lookup honesty (`packages/shared/src/services/`)

**`sans-lookup.service.ts` — `lookupFactor()`:** the three genuine-miss paths return **`null`** instead of `1`:
- `if (!t) return 1` → `return null` (factor table code not found)
- `if (list.length === 0) return 1` → `return null` (table exists but has no rows)
- `return typeof f === 'number' ? f : 1` → `return typeof f === 'number' ? f : null` (chosen row's factor cell is non-numeric)

Return type widens to `Promise<number | null>`. The nearest-conservative row selection for in-range values (the `for` loop picking the largest `sort_key ≤ value`, or `list[0]` below the lowest) is **unchanged** — that is correct behaviour, not a miss.

**`sans-lookup.service.ts` — `lookupDeratingFactors()`:** return type widens to `{ depth: number | null; thermal: number | null; grouping: number | null; temperature: number | null }`. It simply passes the four `lookupFactor` results through — no logic change.

**`cable-calc.service.ts` — `deratedRating()`:** its `factors` param type already accepts `number | null` per field. New rule in the body: `baseRatingA` null/non-finite → `null` (unchanged); **and if any of the four supplied factors is `null` → return `null`** ("cannot honestly derate — a SANS table is missing"). A factor that is `undefined` (a caller that omits it entirely) still defaults to `1`, so callers that don't supply a factor are unaffected.

**Type propagation:** widening the two return types ripples to `resolveCableElectricals`, `previewParallelCableSet`'s `ratingForN`, `addCableAction`, and `updateCableAction`'s SANS-recompute block (all in `cable-entities.actions.ts`). `deratedRating` already accepts `number | null` factors so it absorbs the change; `resolveCableElectricals`'s returned `derate_depth`/`derate_thermal`/`derate_grouping`/`derate_temp` become `number | null` and are stored into the already-nullable `cables.derate_*` columns. `tsc` will flag every site that needs its type adjusted — follow it through; no behaviour beyond "missing → null" should change.

**Net effect:** with the SANS tables fully populated (current state) — **zero behavioural change**, every factor resolves to a real number. Only a genuinely-absent derate table changes anything: `derated_current_rating_a` becomes `null` instead of a fabricated full-capacity figure.

### Section 2 — Per-cable load-share column (`page.tsx` + `CableScheduleGrid.tsx`)

**`page.tsx`:** alongside the existing per-supply maps (`capacityBySupply`, etc.), compute, per supply, `N` = the actual count of that supply's cables (`cables.filter(c => c.supply_id === sup.id).length`). For each `ScheduleRow`, set **`per_cable_load_a`** = `supply.design_load_a / N` when `N > 0` and `design_load_a` is set, else `null`. N is the *actual* cable count, not the stored `grouped_with` field (which can be stale). Populate `per_cable_load_a` in both branches of the row-build `.map()` — `null` in the no-supply branch.

**`CableScheduleGrid.tsx`:** add `per_cable_load_a: number | null` to the `ScheduleRow` interface. Render a new **"A / cable"** column immediately after the existing Load (`load_a`) column — `per_cable_load_a == null ? '—' : fmt(per_cable_load_a, 0)`. A single-cable supply (N = 1) shows the full load; a 5-parallel 1600 A supply shows `320` on every one of its rows.

### Section 3 — Promote the Conductor (Cu / Al) field (`AddEntityPanel.tsx`)

In `CableForm`, move the existing `<Field label="Conductor">` block **out of** the `{showMore && (…)}` "More cable detail" expander and **up into the primary always-visible `<Field>`s** — placed **immediately after the Size field** (so the primary row reads From / To / Voltage / Design load / Size / Conductor; Size and Conductor are both cable-spec and pair naturally). Pure JSX relocation: the `conductor`/`setConductor` state hook, the `Cu`/`Al` `<option>`s, and the preview effect's existing dependency on `conductor` all stay exactly as they are. No logic change.

---

## 4. Components touched

| File | Change |
|---|---|
| `packages/shared/src/services/sans-lookup.service.ts` | `lookupFactor` returns `null` on the 3 genuine-miss paths; `lookupFactor` + `lookupDeratingFactors` return types widen to allow `null` |
| `packages/shared/src/services/cable-calc.service.ts` | `deratedRating` returns `null` when any supplied factor is `null` |
| `packages/shared/src/services/cable-calc.service.test.ts` | + unit test: `deratedRating` with a `null` factor → `null` |
| `apps/web/src/actions/cable-entities.actions.ts` | type-propagation only (`resolveCableElectricals` / `previewParallelCableSet` / `updateCableAction` derate fields become `number | null`) — no behaviour change beyond null propagation |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | compute per-supply cable count `N`, thread `per_cable_load_a` into each `ScheduleRow` |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` | `ScheduleRow` gains `per_cable_load_a`; render the "A / cable" column |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | relocate the `<Field label="Conductor">` block out of the expander into the primary fields |

No DB migration, no RLS changes.

---

## 5. Error handling

All existing patterns carry over. The honest-`null` change *reduces* a silent-wrong path rather than adding a failure mode — a `null` derated rating is already handled gracefully everywhere downstream (grid shows "—", `requiredParallelSet` returns `null`, the under-rating flag treats it as unknown). The per-cable column and the Conductor relocation introduce no new failure modes.

---

## 6. Testing & verification

- **Unit test** (`cable-calc.service.test.ts`, vitest): `deratedRating` returns `null` when any one of the four factors is `null`; still returns the product when all four are real numbers (a regression guard for the existing happy path).
- **Typecheck:** `pnpm --filter @esite/shared exec tsc --noEmit` stays clean; `pnpm --filter web exec tsc --noEmit` adds zero new errors beyond the known 5-error pre-existing baseline (the type-propagation in `cable-entities.actions.ts` must resolve cleanly).
- **Manual walkthrough** (best-effort — the dev server's Supabase connectivity has been unreliable): the grid shows an "A / cable" column reading the per-cable share for a parallel set; the Conductor field is visible in the Add-cable form without expanding "More cable detail".

---

## 7. Deferred / out-of-scope notes

- Topic A — structure hierarchy (`parent_board_id` / feed-graph tree view) — is a separate, paused brainstorm.
- Whether depth-derating should apply to in-air cables at all is a domain question, not addressed here.
- A future optimisation: replace the 16 concurrent `lookupDeratingFactors` calls in `previewParallelCableSet` with a single batch grouping-table fetch (noted during the auto-parallel work).
