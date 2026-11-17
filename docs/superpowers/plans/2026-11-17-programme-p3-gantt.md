# Programme P3 — Virtualised Gantt Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first thing a person sees: `/projects/[id]/programme`, a virtualised grid + timeline over the P2 tables. A planner can create a programme, add/indent/link/move activities, see the critical path, float, baseline bars and data date, and undo/redo. Every save goes through `saveProgrammeChangesAction`. Dark behind `PROGRAMME_ENABLED`.

**Architecture:**
- The client holds a `ProgrammeState` (P2 shared type).
- A gesture produces `ProgrammeOp[]`. The client previews the result instantly (`applyOps` + `scheduleProgramme` in the browser), then sends the same ops to the server action, then reconciles new ids and the version from the response.
- Undo and redo work on state snapshots: `diffToOps(current, target)` produces the ops that restore the target, and those are saved like any other edit.
- Rendering is hand-rolled windowing, with no new dependency and no Konva:
  - The grid is absolutely positioned DOM rows.
  - The timeline is one SVG per visible window: only visible rows, and only links touching visible rows.
  - The time header is sticky, and the date maths are pure functions in shared.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, vitest + @testing-library/react, Playwright (env-gated).

**Spec:** `docs/superpowers/specs/2026-11-16-project-programme-design.md` §4.4 (Screens), §4.6 (Roles). P2 code to build on:
- `apps/web/src/actions/programme.actions.ts`
- `apps/web/src/lib/programme/{load,flag,action-types}.ts`
- `packages/shared/src/programme/` (engine + `persistence/`: `rowsToProgrammeInput`, `applyOps`, `computedForSave`, `ProgrammeOp`, `ProgrammeState`)

## Global Constraints

- **Flag.** `programmeEnabled()` false ⇒ the page shows "The programme module is not switched on yet." and the nav entry is hidden.
- **Reads.** Every project role except `client_viewer` (spec §4.6). The page gate uses `requireEffectiveRole(supabase, id, PROGRAMME_READ_ROLES)` and checks `.ok`. Forbidden is an inline card in the house pattern (`load-profile/page.tsx`).
- **Edits.** `ORG_WRITE_ROLES`, or Solar Edit for a solar module programme. The client receives `canEdit: boolean` from the server and hides every editing control without it. The server actions remain the real gate.
- **Server → client props are JSON only.** No functions, no Maps or Sets, no Dates.
- **No new npm dependency.**
- **Pointer events everywhere** (mouse, touch, pen). Drag snaps to whole working days of the activity's calendar.
- **Dates are `YYYY-MM-DD` strings throughout.** The timeline maps dates to x with pure functions.
- **Every new activity op carries a non-blank `key`.** P2 refuses keyless rows.
- **Fixed bottom elements.** On phones, any fixed-bottom element clears `calc(72px + env(safe-area-inset-bottom))`.
- **Bar colours** come from CSS vars in `globals.css`:
  - critical: `var(--c-red)`
  - normal: `var(--c-amber)`
  - summary: `var(--c-text)`
  - baseline: `var(--c-text-dim)`
  - Do not use solid hatching (house rule since #286).
- **Tests:**
  - `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter web test programme` and `--filter @esite/shared test`.
  - Web type-check and lint.
  - `pnpm --filter web build` with the CI placeholder env from `.github/workflows/ci.yml`.

## Review Focus

1. **5,000 activities.** Expected: the DOM holds only the visible rows plus overscan in both the grid and the timeline, and scrolling stays smooth. A test counts rendered rows.
2. **Two planners editing.** Expected: the second save gets the stale sentence, nothing is lost silently, a "Reload" control appears, and the client never overwrites newer server state.
3. **Undo after a save that created rows.** Expected: undo removes the created activities by their real ids, not their keys, and redo re-creates them with fresh keys.
4. **A read-only role** (contractor on a project programme). Expected: no editing control is rendered, and drag does nothing.
5. **Empty project.** Expected: an editor sees a "Create programme" form; a reader sees "No programme yet."

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/programme/view/timescale.ts` | Zoom levels, day width, `xOfDate`, `dateAtX`, header bands |
| `packages/shared/src/programme/view/outline.ts` | Tree → visible ordered rows (collapse, WBS numbering, depth) |
| `packages/shared/src/programme/view/window.ts` | `visibleRange` for windowing |
| `packages/shared/src/programme/view/diff.ts` | `diffToOps(from, to)` for undo/redo |
| `apps/web/src/lib/programme/access.ts` | `PROGRAMME_READ_ROLES`, `PROGRAMME_WRITE_ROLES` |
| `apps/web/src/lib/programme/view-data.ts` | Server: load programme + active baseline → JSON `ProgrammeViewData` |
| `apps/web/src/app/(admin)/projects/[id]/programme/page.tsx` | Route: flag, gate, pick programme, render client or empty state |
| `.../programme/CreateProgrammeForm.tsx` | Empty-state create form |
| `.../programme/ProgrammeClient.tsx` | State, save pipeline, undo/redo, stale handling |
| `.../programme/GanttGrid.tsx` | Virtualised grid |
| `.../programme/GanttTimeline.tsx` | Virtualised SVG timeline, drag, link drawing |
| `.../programme/GanttToolbar.tsx` | Zoom, add, indent/outdent, undo/redo, filters, baselines |
| `.../programme/LinkDialog.tsx`, `BaselinesMenu.tsx` | Link edit; baselines manager |
| `apps/web/src/components/layout/Sidebar.tsx` | Nav entry, hidden when the flag is off |
| `apps/web/e2e/tests/13-programme.spec.ts` | Env-gated signed-in walk |

---

### Task 1: Shared view maths and diff

**Files:** Create `packages/shared/src/programme/view/{timescale,outline,window,diff}.ts` with tests beside them. Export them from `packages/shared/src/programme/index.ts`.

**Interfaces, produced:**
- `type Zoom = 'day' | 'week' | 'month' | 'quarter' | 'year'`. `DAY_WIDTH: Record<Zoom, number> = { day: 36, week: 14, month: 4, quarter: 1.5, year: 0.5 }`. `ROW_HEIGHT = 28`, `HEADER_HEIGHT = 44`.
- `timescale(start: CalendarDate, end: CalendarDate, zoom: Zoom): { origin: CalendarDate; width: number; dayWidth: number; bands: { top: Band[]; bottom: Band[] } }`. `Band = { x: number; width: number; label: string }`. Header bands by zoom:
  - day: month / day-of-month
  - week: month / ISO week start (`dd MMM`)
  - month: year / month (`MMM`)
  - quarter: year / `Q1`–`Q4`
  - year: none / year
  - The range is padded by 7 days each side.
- `xOfDate(scale, date): number` maps the start of the day. `dateAtX(scale, x): CalendarDate`. `barX(scale, start, finish): { x, width }`. A finish is inclusive, so width = (finish − start + 1) days, with a minimum of 2 px. A milestone is a 0-width point at start.
- `outlineRows(activities: ActivityRow[], collapsed: ReadonlySet<string>): OutlineRow[]`. `OutlineRow = { id: string; depth: number; wbs: string; hasChildren: boolean; collapsed: boolean }`.
  - Order is by `sort_order`, then name, depth-first.
  - Tombstoned activities are excluded.
  - `wbs` is `wbs_code` when set, else generated (`1`, `1.2`, `1.2.3`).
  - Collapsed parents hide their descendants.
- `visibleRange(scrollTop: number, viewport: number, rowCount: number, rowHeight: number, overscan = 10): { first: number; last: number }`. It is clamped to the row count.
- `diffToOps(from: ProgrammeState, to: ProgrammeState, newKey: () => string): ProgrammeOp[]`:
  - Emits ops that turn `from` into `to`: deletions for rows in `from` and not in `to`, upserts for changed or new rows (new rows get keys from `newKey`), and `set_programme` for changed programme fields.
  - Only writable fields are emitted, never cache columns.
  - Dependencies are matched by id. Activities are deleted after their dependencies. Parents are upserted before their children.
  - Property: `applyOps(from, diffToOps(from, to))` equals `to` on every writable field.

- [ ] **Step 1:** Write the tests first:
  - band labels per zoom;
  - `xOfDate`/`dateAtX` round-trip;
  - outline order, depth and collapse with a 3-level tree and a tombstoned activity;
  - `visibleRange` edges (top, middle, bottom, empty);
  - `diffToOps` property over 100 seeded random edits (add, delete, move, re-parent, link, unlink, rename).
  - Run them and confirm they FAIL.
- [ ] **Step 2:** Implement. Run `--filter @esite/shared test`, type-check and lint, and confirm they PASS.
- [ ] **Step 3:** Commit `feat(programme): view maths, outline and undo diff`.

### Task 2: Route, view data, empty state, nav

**Files:** Create `apps/web/src/lib/programme/access.ts`, `apps/web/src/lib/programme/view-data.ts`, `.../programme/page.tsx`, and `CreateProgrammeForm.tsx`, with tests. Modify `Sidebar.tsx`, and the layout that renders it so it can receive a `programmeEnabled` prop (find where `Sidebar` is rendered). Modify `docs/rbac-matrix.md`.

**Interfaces, produced:**
- `PROGRAMME_READ_ROLES`: every `OrgRole` except `client_viewer`. `PROGRAMME_WRITE_ROLES = ORG_WRITE_ROLES`.
- `loadProgrammeView(supabase, projectId, selector: { programmeId?: string; module?: 'solar' }): Promise<{ ok: true; view: ProgrammeViewData | null; programmes: ProgrammeSummary[] } | { ok: false; error: string }>`:
  - `ProgrammeViewData = { state: ProgrammeState (JSON-safe), version: string, activeBaseline: { id: string; name: string; activities: Record<string, { early_start: string|null; early_finish: string|null }> } | null, baselines: { id, name, is_active, created_at }[] }`.
  - `ProgrammeSummary = { id, kind, name, module_key, contractor_label }`.
  - It uses P2's `loadProgramme` for the state.
  - With no selector it opens the `kind='project'` programme. `view` is null when none exists.
- `page.tsx` (`export const dynamic = 'force-dynamic'`):
  - Flag off ⇒ the "not switched on" card.
  - Gate `PROGRAMME_READ_ROLES` ⇒ an inline forbidden card.
  - Reads `?programme=<id>` and `?module=solar`.
  - `canEdit` = the role is in `PROGRAMME_WRITE_ROLES` for project and contractor programmes; for module programmes it uses `getSolarAccessLevel` + `solarLevelAllows(level,'edit')`.
  - With no programme: an editor gets `<CreateProgrammeForm projectId defaultStart={project start or today}>`, a reader gets "No programme yet."
  - Otherwise it renders `<ProgrammeClient projectId view canEdit programmes>`. That component is a stub in this task (renders the name) and is built out in Task 3.
- `CreateProgrammeForm` takes a name (default "Project programme") and a project start date. It calls `createProgrammeAction({ projectId, kind:'project', name, projectStart })`, then `router.refresh()`, and shows the action's error sentence inline.
- `Sidebar.projectNav` gets `{ href: /projects/${id}/programme, label: 'Programme', Icon: <a lucide icon already used in the file family, e.g. GanttChart or CalendarRange> }`, filtered out when the new `programmeEnabled` prop is false. The phone bar shares the list, so check that `MobileProjectBar` passes the same prop.

- [ ] **Step 1:** Write the tests first:
  - page: flag off, client_viewer forbidden, contractor sees "No programme yet.", owner sees the form, existing programme renders the client stub with `canEdit` per role;
  - view-data: JSON-safe output (`JSON.parse(JSON.stringify(view))` deep-equals the view) and active baseline mapping;
  - form: submit calls the action with the right args and shows the error;
  - Sidebar: entry hidden when the flag is off.
  - Confirm they FAIL.
- [ ] **Step 2:** Implement, and add a "Programme screen" row to `rbac-matrix.md`. Confirm the tests PASS.
- [ ] **Step 3:** Commit `feat(programme): programme page, empty state and nav entry`.

### Task 3: ProgrammeClient — state, save pipeline, undo/redo

**Files:** Create `.../programme/ProgrammeClient.tsx`, `.../programme/use-programme-store.ts` (a pure reducer + hook), and tests.

**Interfaces, produced:**
- `useProgrammeStore(initial: ProgrammeViewData, opts: { canEdit: boolean })` returns `{ state, schedule, version, pending, stale, error, apply(ops, label), undo(), redo(), canUndo, canRedo, reload() }`.
  - `schedule` is the browser result of `scheduleProgramme(rowsToProgrammeInput(state))`, memoised on `state`.
  - `apply(ops, label)` previews optimistically. It runs `applyOps` locally; if that throws, it does not save and shows the sentence. Otherwise it pushes `{ before, after, label }` onto the undo stack, clears redo, and queues a save.
  - **Saves are serial.** The next save waits for the previous one. Each save sends that gesture's ops with the latest version.
  - On success, new-row keys are replaced by the returned ids everywhere: state, undo stack and pending ops. The version is updated.
  - On the stale refusal, `stale = true`. Further edits are blocked behind a banner: "Someone else changed this programme. Reload to see their version." with a Reload button (`router.refresh()`), and the local preview is kept visible but marked unsaved.
  - On any other refusal, the state rolls back to `before` and the sentence is shown.
  - `undo()` computes `diffToOps(state, entry.before, newKey)` and saves it as a gesture without pushing a new undo entry. `redo()` does the same with `entry.after`.
  - The undo depth is 100.
- `ProgrammeClient` lays out a toolbar, then a split view (grid left, resizable to 30–70 %, timeline right) sharing one vertical scroll position. It renders the error and stale banners. Keyboard: ⌘/Ctrl+Z undo, ⇧⌘Z redo, ignored while an input has focus.
- A version poll calls a light action every 30 s while the tab is visible, and sets `stale` when the server version moved and nothing is pending. Add `programmeVersionAction({ programmeId })` to `programme.actions.ts`: flag, read gate, returns `{ ok, version }`. Add its tests.

- [ ] **Step 1:** Write the reducer and hook tests first (mock the actions):
  - optimistic apply and save;
  - key → id reconciliation through the undo stack;
  - stale banner and blocked edits;
  - rollback on refusal;
  - undo of a created activity sends a `delete_activity` by real id;
  - redo re-creates with a new key;
  - serial saves (the second waits);
  - `canEdit=false` makes `apply` a no-op.
  - Confirm they FAIL.
- [ ] **Step 2:** Implement and confirm they PASS. Commit `feat(programme): client store, save pipeline, undo/redo`.

### Task 4: Virtualised grid

**Files:** Create `.../programme/GanttGrid.tsx` and its test.

**Behaviour:**
- **Columns:** WBS, Name (indented by depth, with a collapse chevron), Duration (working days), Start, Finish, Total float, % complete. Each column header resizes by drag. A column picker shows or hides columns, and the choice is kept in `localStorage` per user, wrapped in try/catch.
- **Rendering:** rows are absolutely positioned at `index * ROW_HEIGHT` inside a spacer of `rows * ROW_HEIGHT`. Only `visibleRange(...)` rows are rendered. The scroll position is shared with the timeline through a prop and callback.
- **Editing** (`canEdit` only):
  - double-click or Enter on Name/Duration/Start edits inline;
  - Enter commits through `apply([upsert_activity…])`, Escape cancels;
  - Start edits set the constraint `snet` to that date (the MS Project behaviour);
  - Tab/⇧Tab indent/outdent the selected row, which changes `parent_id` to the previous sibling or to the grandparent;
  - Delete removes it, after a two-step inline confirm (never `window.confirm`);
  - "Add task" and "Add milestone" insert below the selection with a fresh key;
  - ⌥↑/⌥↓ move the row (`sort_order`).
- **Selection:** click selects, and Shift/⌘ extend it for bulk delete or indent.
- **Display:** critical rows get a red left border; summary rows are bold.

- [ ] **Step 1:** Write the tests first:
  - 5,000 rows render ≤ 60 row elements (mock `clientHeight` to 800);
  - indent/outdent ops;
  - inline edit ops;
  - Start edit makes an SNET op;
  - delete confirm makes a delete op;
  - read-only shows no inputs and no Add buttons;
  - collapse hides descendants.
  - Confirm they FAIL.
- [ ] **Step 2:** Implement and confirm they PASS. Commit `feat(programme): virtualised grid with inline editing`.

### Task 5: Virtualised timeline

**Files:** Create `.../programme/GanttTimeline.tsx`, `.../programme/timeline-geometry.ts` (pure: bar rects, link paths, hit-testing), `LinkDialog.tsx`, and tests.

**Behaviour:**
- **Header:** a sticky header draws the two bands from `timescale`.
- **Body:** the body SVG draws only the visible rows:
  - task bars `earlyStart → earlyFinish`, with % complete shown as an inner fill;
  - a float tail to `lateFinish` as a thin line;
  - milestones as diamonds;
  - summaries as bracket bars;
  - critical bars in `var(--c-red)`;
  - the baseline bar as a thin line under the bar when an active baseline exists;
  - vertical lines for the data date (dashed) and today (solid, labelled).
- **Links:** drawn only when the predecessor or the successor is visible, as orthogonal paths per type: FS end→start, SS start→start, FF end→end, SF start→end.
- **Drag** (`canEdit`):
  - drag a task body to move it, which sets SNET at the snapped date;
  - drag the right edge to resize, which sets `original_duration` in working days on the activity's calendar, minimum 1 for tasks;
  - drag from a bar's end handle to another bar to create an FS link;
  - the preview is shown while dragging, and the commit happens on pointerup through `apply`;
  - snapping uses the activity's calendar: dragging onto a non-working day snaps forward to the next working day;
  - pointer capture is used, and Escape cancels.
- **Link dialog:** clicking a link opens `LinkDialog` to change the type, lag and lag unit, or to delete it.
- **Zoom:** day/week/month/quarter/year from the toolbar. ⌘+wheel zooms around the cursor date. "Scroll to today" and "Fit programme" buttons.

- [ ] **Step 1:** Write the tests first:
  - geometry: bar rect per type, link path endpoints per type, hit-test bar vs edge vs end-handle, snapping across a weekend and a holiday;
  - component: 5,000 activities render ≤ 60 bar groups;
  - drag move produces one SNET upsert op;
  - resize produces a duration op;
  - link drag produces one `upsert_dependency` op;
  - read-only drag produces no op;
  - link dialog edits.
  - Confirm they FAIL.
- [ ] **Step 2:** Implement and confirm they PASS. Commit `feat(programme): virtualised timeline with drag, resize and links`.

### Task 6: Toolbar, filters, group by code, baselines

**Files:** Create `GanttToolbar.tsx` and `BaselinesMenu.tsx` with tests. Wire them into `ProgrammeClient`.

**Behaviour:**
- **Toolbar:** zoom, undo/redo, add task/milestone, indent/outdent, a programme switcher (from `programmes`), and a "Recalculate" button (`recalculateProgrammeAction`).
- **Filters:**
  - text search on name/code;
  - "Critical only";
  - "Late or negative float";
  - "Milestones only";
  - filtered views keep ancestors so the hierarchy reads correctly.
- **Group by:** "WBS" (default) or any code type. Group header rows show the code value with min start, max finish and a count.
- **Data date:** a control (`set_programme` op).
- **Baselines menu:**
  - list baselines with the active one marked;
  - "Save baseline…" asks for a name and calls `saveBaselineAction` with `setActive` checked by default;
  - "Set active" and "Delete" (two-step confirm);
  - after a change, it re-reads the view (`router.refresh()` is fine here because the page re-renders `view`; the client resets its store when `view.version` changes and nothing is pending).
- **Summary chip:** project finish, and the count of critical and negative-float activities, from `schedule`.

- [ ] **Step 1:** Write the tests first: filter keeps ancestors, group headers, baseline save/activate/delete calls, data date op, read-only hides edit buttons. Confirm they FAIL.
- [ ] **Step 2:** Implement and confirm they PASS. Commit `feat(programme): toolbar, filters, grouping, baselines`.

### Task 7: End-to-end spec, phone layout, docs

**Files:** Create `apps/web/e2e/tests/13-programme.spec.ts`, and add it to the owner project's `testMatch` in `e2e/playwright.config.ts`. Modify `docs/programme/runbook.md`.

- **Spec:** env-gated with `test.skip(!process.env.E2E_PROGRAMME_PROJECT_ID, …)`. It walks from the empty project state, not a deep link: Projects list → project → Programme nav → create programme → add 3 tasks → link them → see the finish move → save baseline → drag the middle task → see the baseline bar differ → undo → reload and confirm persistence.
- **Phone:** below 768 px the timeline is hidden behind a "Timeline" toggle; the grid shows Name, Start and Finish; nothing scrolls sideways at 390 px.
- **Runbook:** add a "Turning the screen on for a test project" section. `PROGRAMME_ENABLED` is global, so instead describe how to verify on a Vercel preview deployment with the flag set in Preview only.

- [ ] **Step 1:** Write the spec and the phone CSS, plus a vitest check that the grid at 390 px renders the 3 phone columns.
- [ ] **Step 2:** Run the full web suite, type-check, lint and build. Confirm everything is green. (The spec skips without env.)
- [ ] **Step 3:** Commit `test(programme): signed-in walk spec, phone layout, runbook`.
