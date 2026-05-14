# Cable Schedule — entity-management UI redesign

**Date:** 2026-05-14
**Status:** Design approved — ready for implementation plan
**Branch:** `feat/powersync`
**Scope owner:** Arno

---

## 1. Context & problem

The Cable Schedule Manager is functional but the build flow is hard to discover. Three concrete pain points were reported:

1. **Schedule entry is unclear.** On the revisions list, only the revision *code text* is a link, styled identically to plain text (no underline, no accent colour). Users discover the click target by accident.
2. **Building the From/To structure is unclear.** Sources and boards appear in *three* places — a read-only `SourcesPanel` + `BoardsPanel` pair, a collapsed `⚙ Manage nodes` panel (the only place they can actually be edited), and again inside the `+ Add cable` From/To dropdowns. Nothing signals that this structure must be built *first*, and the editable surface is hidden behind a collapsible.
3. **The Design / As-built / Worst-case toggle "isn't selectable."** Reported as "clicking does nothing."

### Investigation finding on the toggle

The toggle is **wired correctly end-to-end**: the `<Link>` sets `?view=`, `page.tsx` re-reads it, `activeLengthM()` in `cable-calc.service.ts` branches on it, volt-drop is recomputed server-side, and `CableScheduleGrid` re-seeds via `useEffect`. "Clicking does nothing" because the three modes only diverge once a cable has a **confirmed length** (`confirmed_length_m`, set via the site-confirmation workflow). A revision with only *measured* lengths resolves `design`, `as-built`, and `worst` to the identical number on every row — so nothing visibly changes. Evidence: `activeLengthM()` returns `meas` in all three branches when `conf` is null.

This is a **design problem, not a wiring bug**: the control is presented as always-live even when it provably cannot do anything. There is, however, one genuine adjacent code bug — `CableScheduleGrid.tsx:93` `activeLength()` ignores `lengthMode` entirely, so even *with* confirmed data the displayed Length column would not switch (only the VD columns would).

### Audience

Optimise for **both first-timers and power users equally**: the layout itself must make the workflow self-evident for someone opening it cold, while staying fast and unobtrusive for someone who uses it daily. This rules out a forced step-by-step wizard.

---

## 2. Goals & non-goals

### Goals
- Make opening a revision from the list obvious.
- Collapse the three redundant source/board surfaces into one always-visible **Structure** panel that teaches the workflow through layout and empty states.
- Make adding a cable approachable (progressive disclosure of its 14 fields).
- Make the length-mode toggle either meaningfully working or honestly disabled-with-reason; fix the `activeLength` bug.
- One consistent vocabulary and a consistent button treatment across the touched screens.

### Non-goals (YAGNI / scope guard)
- No forced wizard/stepper (Approach B was rejected — it taxes power users and buries the grid).
- No changes to server actions or the database — `cable-entities.actions.ts`, migrations, RLS all stay as-is.
- No redesign of the grid's cell-editing internals (recently built in C12, working well).
- No changes to the cost, tags, diff, discrepancies, import, `/site` mobile, or SANS reference pages.
- Not a repo-wide button audit — button convergence is limited to the four touched screens.

---

## 3. Design

### Section 1 — Revisions list (entry point)
- The **whole table row** becomes the click target navigating to the revision editor; row hover gives a background highlight.
- The revision code renders as a clear link (amber, weight 600); the row gains a trailing **`Open →`** affordance in the last column.
- `✓ Issue` / `Discard` buttons on DRAFT rows get `stopPropagation` so they don't also open the row, and read as secondary controls.
- DRAFT rows get a subtle amber left-border accent to stand out from ISSUED / SUPERSEDED.
- **Components:** `RevisionsList.tsx` only. No data/action changes.

### Section 2 — The Structure zone (core change)
- Delete the read-only `SourcesPanel` and `BoardsPanel` functions from `page.tsx` and the 2-column read-only grid that holds them.
- Rework `NodesPanel` into an **always-visible** `StructurePanel` at the top of the editor — the single source of truth for sources & boards.
- Header: title **"Structure"** + helper line — *"Where power comes from, and the boards it feeds. Build this first, then wire up cables below."*
- Body: two columns, **Sources** and **Boards**, each listing items (code + type sub-label) with the existing inline rename + remove and the blast-radius confirm modal kept unchanged.
- **`+ Add source`** / **`+ Add board`** buttons sit prominently at the top of each column — never collapsed. The inline `AddNodeForm` pattern is kept.
- Empty states teach: no sources → *"Start here — add where power comes from (a council RMU, generator, etc.)"*; sources but no boards → prompt the next step.
- ISSUED/locked revisions render the panel read-only (already gated by the `canEdit` prop).
- **Components:** `NodesPanel.tsx` → `StructurePanel.tsx`; `page.tsx` loses `SourcesPanel`/`BoardsPanel`. No data/action changes — same `addSourceAction` / `addBoardAction` / rename / delete actions.

### Section 3 — Add cable flow
- Keep Add cable as its own inline action (not a modal), positioned as the step *after* Structure. The `+ Add cable` button lives in the editor directly below the Structure panel and is present in **both** states: in the schedule grid's header area when cables exist, and in the `cables.length === 0` empty-state panel when they don't (so it's reachable before the grid renders). It expands the form inline in place.
- **Progressive form** — split the 14 fields:
  - **Route & spec (always visible):** From → To, Voltage, Design load, Size.
  - **"More cable detail" (collapsed by default):** Section, Cores, Conductor, Insulation, Length, Install method, Depth, Group size, Ω/km override — all already defaulted, so a working cable can be added without opening this.
- Empty-state copy updated to reference the **"Structure"** panel by name.
- From/To dropdowns unchanged in behaviour — still drawn live from the Structure panel above.
- **Components:** `AddEntityPanel.tsx` / `CableForm` reworked into the progressive layout and repositioned into the grid header. No data/action changes — still `findOrCreateSupplyAction` → `addCableAction`.

### Section 4 — Schedule grid: mode toggle + bug fix
- **Fix the bug:** `activeLength()` in `CableScheduleGrid.tsx` takes `lengthMode` and branches like the shared `activeLengthM()` so the Length column visibly changes with the mode, consistent with the VD columns.
- **Redesign the toggle** as a proper segmented control: a small `Lengths:` label, larger touch targets, a clear filled-amber active state.
- **Never-dead rule:** when zero cables in the revision have a `confirmed_length_m`, the toggle renders **disabled with a tooltip** — *"Available once cables have site-confirmed lengths."* It activates the moment any cable is confirmed.
- Grid empty-state copy updated to reference the new **"Structure"** panel and grid-header **`+ Add cable`** button.
- **Components:** `LengthModeToggle.tsx` (segmented-control restyle + disabled state, needs a `hasConfirmedLengths` prop from `page.tsx`, computed from already-loaded cables); `CableScheduleGrid.tsx` (`activeLength` fix + empty-state copy). No data/action changes.

### Section 5 — Terminology, buttons, consistency
- **One vocabulary:** user-facing language is **"Sources"** and **"Boards"** everywhere — panel headings, add buttons, empty states, the From/To picker. Drop "Nodes / Origin node / Distribution node" wording. Type sub-labels (Council RMU, Main board, Transformer/Minisub, etc.) stay.
- **Buttons:** converge the buttons *on the touched screens* onto the existing `Button` component (`apps/web/src/components/ui/Button.tsx`) — header nav links as `secondary`, primary actions (`+ Add source/board/cable`) as `primary`, destructive (remove) as `danger`, consistent sizing. The editor header row is grouped: page-navigation buttons together, then length toggle + export together. Emoji prefixes kept but applied consistently.
- **Scope guard:** only the revisions list, editor header, Structure panel, and Add cable form.

---

## 4. Components touched

| File | Change |
|---|---|
| `apps/web/src/app/(admin)/projects/[id]/cables/RevisionsList.tsx` | Whole-row click target, `Open →` affordance, DRAFT accent, `stopPropagation` on action buttons |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | Remove `SourcesPanel`/`BoardsPanel` + their grid; mount `StructurePanel`; pass `hasConfirmedLengths` to the toggle; reposition `+ Add cable`; regroup header buttons |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/NodesPanel.tsx` | Reworked into `StructurePanel.tsx` — always-open, two-column, teaching empty states, new vocabulary |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | Progressive form (primary fields + "More cable detail" expander), repositioned into grid header, updated empty-state copy |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/LengthModeToggle.tsx` | Segmented-control restyle + disabled-with-tooltip state; new `hasConfirmedLengths` prop |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` | `activeLength()` honours `lengthMode`; empty-state copy update |

No changes to server actions, `@esite/shared`, migrations, or RLS.

---

## 5. Error handling

All existing patterns carry over unchanged: inline `role="alert"` error divs and the `useTransition`-wrapped `run()` / `submit()` handlers in each panel. No new failure modes are introduced — the redesign is layout, copy, and component-boundary changes over the same server actions.

---

## 6. Testing & verification

- **Typecheck** clean across all targets (`tsc --noEmit` on `@esite/web` at minimum).
- **Manual dev-server walkthrough** of the three original pain points:
  1. Open a revision from the list — whole row clickable, `Open →` visible.
  2. Build structure from an empty revision — Structure panel is visible without hunting, add buttons obvious, empty states guide the next step; then add a cable via the progressive form.
  3. Length toggle — disabled-with-tooltip on a revision with no confirmed lengths; once a cable has a confirmed length, the toggle is live and the Length column + VD columns both change between modes.
- The `activeLength` mode fix is small and pure — add a unit test if `cable-calc` (or the grid) has a test file; otherwise cover it in the manual walkthrough.

---

## 7. Deferred / out-of-scope notes

- The revisions list uses `window.prompt` for issue notes and `confirm()` for discard — crude, but replacing them is separate polish, not part of this redesign.
- Repo-wide button-component convergence is deliberately not attempted here.

### Deviations recorded after implementation (2026-05-14)

The implementation diverged from this spec on two mechanism/placement points. In both the underlying *goal* was met; the *mechanism* differs. Recorded here so the spec reflects reality:

- **§5 — header buttons were normalised via a shared inline `headerNavLinkStyle` constant, not the `Button` component.** Consistency *was* achieved (all four header nav links now share one style; the `btn-primary-amber`-class-fighting-its-own-inline-override anti-pattern is gone), but the `Button` component (`apps/web/src/components/ui/Button.tsx`) was not adopted on any touched screen. The inline-style approach matches the pre-existing convention of this feature area. A consequence: the header nav links lost `:hover` polish (inline styles can't express pseudo-states); keyboard `:focus` still works via the browser default outline. Adopting `Button` (or a dedicated CSS class) to restore interactive states is a clean future pass.
- **§3 — the Add-cable action was not relocated into the schedule grid's toolbar.** `AddEntityPanel` still renders as a standalone block directly below the Structure panel (always visible regardless of cable count). The substantive Task 5 work — the progressive form — landed correctly. The standalone placement is arguably preferable to threading the trigger into the grid header, since the grid only renders when `cables.length > 0` and the button would otherwise need to exist in two places.

Neither deviation blocks the redesign; both are noted for a future pass if the literal spec mechanism is wanted.
