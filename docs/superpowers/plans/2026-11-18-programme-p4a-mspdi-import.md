# Programme P4a — Contractor Programmes from MS Project (MSPDI XML) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A planner can create a contractor programme, import the main contractor's MS Project programme, and re-import each later revision, and see what changed. The import is the XML that *File → Save As → XML Format* writes. It keeps the activities, the WBS outline, durations, logic links with lag, constraints, deadlines, milestones, calendars, actuals and % complete, and the file's own baseline dates.

**Why now:** the owner starts using the module today with main-contractor programmes, and Saxby's programme is already waiting. It currently sits in the old Solar schedule with no logic.

**Architecture:**
- The browser reads the file with `DOMParser`. No new dependency, and the file never travels to the server.
- A pure shared function turns the parsed XML into an `MspdiProgramme`. A second pure function plans the import against the current programme state (`planImport`). It matches activities by `external_uid` (the MS Project task UID) and produces `ProgrammeOp[]` plus a human diff.
- The client previews the result, including the engine schedule, then saves through the existing `saveProgrammeChangesAction`. The save is one call and one transaction.
- One small migration adds a definer `programme.record_import` that writes the `imports` row and the revision baseline.

**Tech Stack:** TypeScript, DOMParser (browser and jsdom in tests), Next.js server actions, Postgres plpgsql.

**Spec:** `docs/superpowers/specs/2026-11-16-project-programme-design.md`
- §4.3 Exchange (MSPDI with a real XML parser, the file's own `MinutesPerDay`)
- §4.7 Contractor programmes: separate tracked programmes merged by `external_uid`. Each revision is kept as an `imports` row plus an automatic baseline. Removed activities are tombstoned and never deleted silently.
- P2 ops: `packages/shared/src/programme/persistence/ops.ts`

## Global Constraints

- **Format.** MSPDI XML only (namespace `http://schemas.microsoft.com/project`). An `.mpp` file is refused with: "Open the programme in MS Project and use File → Save As → XML Format, then import the .xml file." P6 XER is out of scope (P4b).
- **Units.** Durations convert using the file's `MinutesPerDay`, default 480. The result is working days to 2 dp.
  - `LinkLag` is in tenths of a minute.
  - `LagFormat` maps to `lag_unit`:
    - 7 (d), 5 (h), 3 (m), 9 (w) and 11 (mo) → `working_days`, converted with MinutesPerDay; weeks use DaysPerWeek and months use DaysPerMonth from the file;
    - 8, 6, 4, 10 and 12 (elapsed) → `elapsed_days`;
    - 19 and 20 (%) → `percent`.
- **Link types.** `Type` 0=FF, 1=FS, 2=SF, 3=SS.
- **Constraints.** `ConstraintType`:
  - 0 ASAP → none
  - 1 ALAP → `alap`
  - 2 MSO → `mso`
  - 3 MFO → `mfo`
  - 4 SNET → `snet`
  - 5 SNLT → `snlt`
  - 6 FNET → `fnet`
  - 7 FNLT → `fnlt`
- **Activity types.** `Summary=1` → summary. `Milestone=1` with zero duration → `finish_milestone` (MS Project's default), or `start_milestone` when the task has no predecessors and has successors. A non-zero-duration milestone flag is ignored (the activity stays a task) and a warning is listed.
- **External UID.** Every activity carries `external_uid = String(UID)`. The project summary task, UID 0 at outline level 0, is skipped.
- **Re-import:**
  - matched UIDs update their writable fields;
  - new UIDs are created with keys from the store's `newKey()`;
  - UIDs missing from the new file get `delete_activity`, which tombstones because `external_uid` is set;
  - activities created in E-Site, with no `external_uid`, are left alone;
  - links between imported activities are replaced to match the file.
- **Scheduling rules.** `scheduling_rules` stays `msp`.
- **Calendars.**
  - The file's project calendar becomes the programme default: work weekdays from `WeekDays/DayType` 1–7 (Sun=1) → ISO weekdays, and exceptions (non-working date ranges) → `non_work`.
  - Task calendars are mapped when the file assigns them.
- **Saving.** One `saveProgrammeChangesAction` call per import, then `recordImportAction` in a second call. If the save succeeds and the record fails, the action returns a sentence saying the programme was imported but the revision record was not saved. That record is history only; there is no compensation.
- **Size.** 5,000 activities parse, plan and preview in under 3 s in jsdom. The ops payload stays under the 10 MB server-action body limit (`next.config.ts`).
- **Strings.** Every string is trimmed. Names are capped at the column limits (read them in `00261`). Nothing from the file reaches the DOM as HTML.
- **Migration** `apps/edge-functions/supabase/migrations/00262_programme_record_import.sql`:
  - the number is provisional and claimed at apply time;
  - it carries a `@verify` block;
  - the function is SECURITY DEFINER with `search_path=''`, `REVOKE ALL FROM PUBLIC, anon`, and `GRANT EXECUTE TO authenticated`;
  - the gate is `programme.can_edit`;
  - add role assertions in `scripts/db/assert-programme-roles.sql`.
- **Tests:**
  - `TMPDIR="/Volumes/Extreme SSD/tmp" pnpm --filter @esite/shared test`
  - `--filter web test programme`
  - `--filter @esite/db test:ci`
  - type-check and lint
  - `pnpm --filter web build` with the CI placeholder env
  - SQL: `scripts/db/dry-run-migration.sh` with both migrations concatenated (00261 is not applied yet). Read its header for how to pass two files, or make a temp concatenation in the scratch area.

## Review Focus

1. **A real MS Project export**: UTF-8 with a BOM, the default namespace, a `<Calendars>` block of base and resource calendars, the project summary task UID 0, inactive tasks (`Active=0`), and null tasks (`IsNull=1`). Expected: inactive and null tasks are skipped with a count shown, and nothing crashes.
2. **Re-import after planners edited in E-Site.** Expected: E-Site-only activities, codes and field updates survive. A removed UID is tombstoned with its history kept. The diff lists added, changed (with the changed fields), removed, and links added and removed.
3. **A link to a summary task.** MSP allows it. Expected: it is kept under `msp` rules, and the engine schedules it.
4. **Lag in hours, elapsed days and %.** Expected: each converts as the Global Constraints say, and the preview finish matches what the engine computes after saving.
5. **A malformed file** (not XML, the wrong root, or a task with no UID). Expected: one plain sentence, and nothing is saved.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/programme/exchange/mspdi-parse.ts` | `parseMspdi(doc: Document): MspdiProgramme \| { error }`. Pure, takes a DOM Document. |
| `packages/shared/src/programme/exchange/mspdi-plan.ts` | `planImport(state, mspdi, newKey): { ops, diff, warnings }` |
| `packages/shared/src/programme/exchange/fixtures/*.xml` | Hand-written MSPDI fixtures, plus one synthetic 5,000-task fixture generator |
| `apps/edge-functions/supabase/migrations/00262_programme_record_import.sql` | `programme.record_import` |
| `apps/web/src/actions/programme.actions.ts` | `recordImportAction` |
| `.../programme/ImportDialog.tsx` | Choose file → parse → preview diff and schedule → Import |
| `.../programme/CreateProgrammeForm.tsx`, `ProgrammeClient.tsx`, `GanttToolbar.tsx` | Contractor kind and label; "Import from MS Project" entry points |
| `docs/programme/runbook.md`, `docs/rbac-matrix.md` | How to export from MS Project; roles |

---

### Task 1: MSPDI parser

**Files:** `exchange/mspdi-parse.ts` and its tests; fixtures. Export from `packages/shared/src/programme/index.ts`.

**Interfaces — produces:**

`MspdiProgramme = { name: string; startDate: CalendarDate; minutesPerDay: number; daysPerWeek: number; daysPerMonth: number; calendars: MspdiCalendar[]; projectCalendarUid: string | null; tasks: MspdiTask[]; skipped: { inactive: number; nulls: number }; warnings: string[] }`
- `MspdiCalendar = { uid; name; isBase: boolean; workWeekdays: number[] (ISO); exceptions: { from: CalendarDate; to: CalendarDate; working: boolean; name: string }[] }`
- `MspdiTask = { uid: string; name; outlineLevel: number; wbs: string | null; outlineNumber: string | null; summary: boolean; milestone: boolean; durationDays: number; constraint: { type; date: CalendarDate | null } | null; deadline; actualStart; actualFinish; percentComplete; calendarUid: string | null; start: CalendarDate | null; finish: CalendarDate | null; baselineStart; baselineFinish; predecessors: { uid: string; type: LinkType; lag: number; lagUnit: LagUnit }[] }`
- Durations: ISO-8601 `PT…H…M…S` (MSPDI writes hours) / `minutesPerDay`, rounded to 2 dp. Elapsed durations (`ElapsedDuration`, `DurationFormat` elapsed) produce a warning and are converted the same way.
- Errors: `{ error: string }` for not-MSPDI, no tasks, or a duplicate UID.

- [ ] **Step 1:** Write fixtures by hand.
  - **`small.xml`:** project summary UID 0, 3 levels, a milestone, an inactive task, a null task, every link type, lag in hours / elapsed days / %, an SNET and an MFO constraint, a deadline, actuals, % complete, a 6-day calendar with a holiday range, baseline dates, a BOM and the default namespace.
  - **`bad-*.xml`:** malformed variants.
- [ ] **Step 2:** Write the tests and watch them FAIL. One assertion block per field mapping and per Global Constraints rule; the errors; skipped counts.
- [ ] **Step 3:** Implement with namespace-agnostic element lookup (`getElementsByTagNameNS('*', …)` or a localName walk). Run until the tests PASS.
- [ ] **Step 4:** Commit `feat(programme): MSPDI XML parser`.

### Task 2: Import planner

**Files:** `exchange/mspdi-plan.ts` and its tests.

**Interfaces — produces:**
- `planImport(state: ProgrammeState, m: MspdiProgramme, newKey: () => string): { ops: ProgrammeOp[]; diff: ImportDiff; warnings: string[] }`
- `ImportDiff = { added: { uid; name }[]; changed: { uid; name; fields: string[] }[]; removed: { uid; name }[]; linksAdded: number; linksRemoved: number; calendarChanged: boolean; unchanged: number }`

**Ops:**
- `set_programme`: `project_start` from the file's `startDate` on a first import only. On a re-import it is left alone unless the field is empty.
- Calendar: `upsert_calendar` / `set_calendar_exceptions` for the project calendar and any task calendars. Name them from the file and reuse them on re-import by name.
- Activities:
  - parents before children, using the outline from `outlineLevel` order;
  - `sort_order` follows file order;
  - `wbs_code` comes from WBS or OutlineNumber;
  - the type follows the Global Constraints;
  - `original_duration` = `durationDays` (0 for milestones and summaries);
  - constraint, deadline, actuals, `percent_complete` and calendar are mapped.
- Links: `upsert_dependency` for the file's links between imported activities; `delete_dependency` for existing links between imported activities that are no longer in the file.
- Removed UIDs: `delete_activity`.
- Every op must be accepted by `applyOps`. The test runs the ops through `applyOps` and `scheduleProgramme`.

- [ ] **Step 1:** Write the tests and watch them FAIL:
  - first import of `small.xml` gives the expected outline, types, durations, links and calendar;
  - the engine's early dates for a simple FS chain match the file's Start/Finish within the calendar;
  - a re-import with one task renamed, one added, one removed and one link changed gives the exact diff and the right ops; the removed task is tombstoned with its field update kept; an E-Site-only activity is untouched;
  - a re-import of an identical file gives no ops except no-ops, and `unchanged` equals the task count;
  - a summary-link import keeps the link;
  - 5,000 synthetic tasks plan in under 3 s, asserted only under `PERF_STRICT`; a functional assertion runs always.
- [ ] **Step 2:** Implement until the tests PASS.
- [ ] **Step 3:** Commit `feat(programme): plan MS Project imports and re-imports by UID`.

### Task 3: `record_import` migration and action

**Files:** `00262_programme_record_import.sql`; assertion rows; `recordImportAction` and its tests; rbac-matrix row.

**Interfaces:**
- `programme.record_import(p_programme_id uuid, p_file_name text, p_revision_label text, p_diff jsonb, p_mapping jsonb) returns jsonb`:
  - gated by `can_edit`, and takes the programme advisory lock;
  - inserts the `imports` row with format `mspdi`;
  - calls the same snapshot logic as `save_baseline`, with name = `revision_label` (or `"Import <file name> <date>"`), `source = 'import'` and active = true;
  - sets `imports.baseline_id`;
  - writes audit;
  - returns `{ import_id, baseline_id }`.
  - `p_diff` must carry counts and UIDs and names only, never rands; reject keys other than the `ImportDiff` keys.
- `recordImportAction({ programmeId, fileName, revisionLabel, diff })` → `{ ok, importId, baselineId } | { ok:false, error }`.
- Assertions:
  - owner records an import, getting a baseline with `source='import'` that is active and holds the snapshot;
  - a contractor gets 42501;
  - a diff with an unknown key gets 22023.

- [ ] **Step 1:** Write the assertions and the action tests, and watch them FAIL. For the SQL red run, use 00261 alone.
- [ ] **Step 2:** Implement. Get the dry-run green with 00261 and 00262 together. Run `@esite/db test:ci`, the `@verify` sweep and the web tests.
- [ ] **Step 3:** Commit `feat(programme): record MS Project imports with a revision baseline`.

### Task 4: Contractor programmes and the import dialog

**Files:** `CreateProgrammeForm.tsx` (choose "Our programme" or "Contractor programme", with a contractor name); `ImportDialog.tsx` and its test; entry points in the empty state ("Import from MS Project" right after creating a programme) and in the toolbar (editors only); the programme switcher shows contractor programmes by label; runbook "Importing a main contractor's programme".

**Behaviour:**
- **Choose the file:** a `.xml` file input. An `.mpp` gets the export sentence.
- **Parse and plan:** `parseMspdi(new DOMParser().parseFromString(text, 'application/xml'))`, then `planImport(store.state, m, store.newKey)`.
- **Preview:**
  - the counts from the diff, with expandable lists;
  - warnings and skipped counts;
  - the file's date range against the E-Site schedule's project finish, computed from `applyOps` + `scheduleProgramme` on a copy;
  - a revision label field, required on a re-import and defaulting to the file name.
- **Import:**
  - `store.apply(ops, 'Import <label>')`; wait for the save to settle; then `recordImportAction`; then `router.refresh()`;
  - on a refusal, show the sentence; the store has already rolled back.
- **Undo:** an import goes onto the undo stack like any gesture. Undoing an import removes the added rows and restores tombstoned ones (P3's `diffToOps`). The revision baseline remains.

- [ ] **Step 1:** Write the tests and watch them FAIL:
  - an `.mpp` refusal;
  - preview counts for `small.xml`;
  - import calls apply once, then `recordImportAction`;
  - re-import requires a label;
  - read-only users see no import entry;
  - contractor create sends `kind:'contractor'` and the label;
  - the switcher lists the contractor programme.
- [ ] **Step 2:** Implement until the tests PASS. Then run the full web suite, type-check, lint and build.
- [ ] **Step 3:** Commit `feat(programme): contractor programmes and MS Project import dialog`.
