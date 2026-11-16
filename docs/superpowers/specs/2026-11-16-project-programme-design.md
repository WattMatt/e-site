# Project Programme (Gantt / CPM) — design

**Date:** 2026-11-16 · **Status:** approved by owner (design); not built · **Supersedes:** roadmap chapter 08 §(b) and §(f) rows on CPM / baseline / earned value / import (see "Decision record").

## 1. Intent

Every E-Site project gets a world-class programme: build one in E-Site, or import the contractor's, then track it, re-plan it, and report on it. The reports must serve two readers:
- **Site personnel** need to know what is happening this week and the next three, by zone, trade or crew.
- **Engineers** need the logic, float, critical path, baseline slippage, progress, resources and earned value.

Modules with their own detailed programme plug into the project programme as one summary bar. Solar is the first, and it keeps its detailed programme.

### Owner decisions (2026-11-16)
| Question | Decision |
|---|---|
| Whose programme | **Both:** WM can build in E-Site, and can import contractor programmes (MS Project / P6 / CSV), track them, and compare revisions |
| Engine and screen | **Build our own**, with no licensed Gantt |
| First release | **Everything:** progress tracking, resources and levelling, cost and earned value, field updates on a phone |
| Solar | **Moves onto the same engine** as a sub-programme, with its existing data migrated |

### Goals
- A scheduling engine that computes correct dates: forward and backward pass, all four link types with lag and lead, constraints, calendars, float, progress against a data date. Its results must match MS Project / P6 on the same input.
- Performance at the size of real programmes: 5,000 activities and 10,000 links.
- Exchange with the tools contractors use: MS Project XML, P6 XER, CSV and Excel.
- Saved, versioned reports for both readers.
- Phone updates from site.

### Non-goals (this release)
- Two-way live sync with MS Project or P6. Exchange is by file only.
- A portfolio (multi-project) Gantt.
- Weather-driven rescheduling.
- Monte Carlo risk analysis.
- Reading `.mpp` binaries directly. Users export XML from MS Project.

### Anti-goals (would make this a failure even if it works)
- **Every bar becomes a chased commitment.** The current Solar tool turns each bar into a work item, which floods My Work and the WhatsApp due/overdue sweep.
- **Dates on screen and in the PDF differ** from what the engine computes.
- **A user who may not see cost** sees a rate, cost or earned value figure anywhere: on screen, in a report or in an export.
- **A module's detail leaks** to users without access to that module.

## 2. Audit of the current Solar tool (origin/main `fe1f50fb`, nothing assumed correct)

### Engine (`packages/shared/src/solar/schedule/`)
- **No forward pass.** Early start = the date the user drew (`cpm.ts:72-78`), so successors never move. Only the backward pass runs. "Critical" means float ≤ 0 measured against the drawn dates.
- **Model:** there is no WBS or summary hierarchy, and duration is not stored. Constraints, free float, actuals, data date, per-task calendars, resources and cost are all missing.
- **Bugs:**
  - A milestone at the start of a day breaks its own FS link (`cpm.ts:74,112`).
  - Imported milestones shift by one day.
  - MSPDI links into summary tasks are dropped silently (`import/mspdi.ts:45-50,81`).
  - Lag assumes 480 min/day and ignores `MinutesPerDay`.
  - Two links between the same pair collide (`graph.ts:17`).
  - Resizing ignores the calendar (`drag.ts:37-42`).
  - The workload view counts the gaps in split tasks as work (`rollup.ts:101`).
  - A Sat–Sun-only task has zero duration in working mode.
- **Import:** MSPDI is parsed with regexes and drops WBS deeper than level 2, calendars, constraints, baselines, actuals and resources. There is no XER import.
- **Calendar:** Mon–Fri minus SA public holidays. It ignores `project_settings.working_days`, `extra_holidays` and the builders' shutdown, and does not read `projects.public_holidays`.
- **Tests:** no negative lag, no multiple predecessors, no FF/SF in working mode, no MSPDI edge cases, no scale tests.

### Data, screen and reports (`00213_solar_schedule.sql`, `projects/[id]/solar/(gated)/schedule/*`)
- **Every bar is a `projects.work_items` row** (`00213:340,1083,1219`):
  - a drag rewrites the due date;
  - "done" needs gatekeeper sign-off;
  - undo mints a new SOLAR ref;
  - every bar is swept by `whatsapp.sweep_due` (`00222:565-583`, which has no type filter);
  - three Solar triggers sit on core `projects.work_items`, plus a verbatim copy of `ensure_ref` (`00213:273,634,675,714`).
- **Canvas:** one full-size Konva canvas with no virtualisation. Inferred to blank out around 1,000 tasks. The time header scrolls away. It is mouse-only, so it cannot be used on a phone.
- **Exports:** streamed downloads, not saved to `projects.reports`. There is no look-ahead, no baseline variance, no float or logic in the PDF, and no A1 size.
- **Integrity:** the audit is partial and written after commit. Link edits are last-write-wins. `assert-solar-schedule-roles.sql` is not in CI.
- **Kept:** the security pattern of the definer functions (`search_path=''`, REVOKE PUBLIC and anon, org derived by trigger), advisory-lock writes, `expectedUpdatedAt`, `dates.ts`, the reuse of the SA holiday list, `ics.ts`, and the column synonyms in `import/table.ts`.

## 3. Approaches considered

| Approach | Trade-off | Chosen |
|---|---|---|
| Extend the Solar engine and un-gate it | Cheapest start, but its core lacks a forward pass, a hierarchy and a stored duration. Its data model binds every bar to the work-item spine. Nearly every layer would be rewritten in place while staying compatible. | No |
| Licence a commercial Gantt (e.g. Bryntum) | Polished quickly, with a built-in engine and MSP import. But it means a vendor dependency, licence cost, and fitting RLS, cost masking and module gating around a foreign data model. | No (owner) |
| **New `programme` module and our own engine; Solar migrates onto it** | Most build. One correct engine, a data model designed for programmes, and Solar inherits every fix. | **Yes** |

## 4. Design

### 4.1 Principles
1. **One engine, many programmes.** A project has one `project` programme and at most one `module` programme per module. They share the same tables, engine, screen and reports.
2. **Activities are not work items.** An activity may optionally *raise* a work item when a commitment needs an owner and a sign-off (e.g. a hand-off milestone). Only those raised items reach My Work, the Inbox and WhatsApp.
3. **The server holds the authoritative schedule.** The same TypeScript engine runs in the browser (instant preview) and in the server action, which recalculates and saves the computed dates in one transaction. Computed columns (early and late dates, floats, critical, driving) are a cache written only by the engine.
4. **Cost is masked in the database.** Rates, costs and earned value are readable only by `COST_VIEW_ROLES`. Screens, reports and exports read through the same rule.
5. **The JBCC statutory calendar is untouched.** `lib/jbcc/working-days.ts` stays separate (see roadmap ch. 08).

### 4.2 Data model: schema `programme`
⚠ A new schema means PATCHing PostgREST `db_schema` *after* the apply. If the PATCH runs before the schema exists, the whole API loops on PGRST002.

| Table | Content |
|---|---|
| `programmes` | `project_id`, `organisation_id`, `kind` (`project`\|`module`\|`contractor`), `module_key`, `contractor_label` (for `contractor`), `scheduling_rules` (`msp`\|`p6`, set from the source format on import; native = `msp`), `name`, `data_date`, `default_calendar_id`, `options` jsonb (progress mode `retained_logic`\|`progress_override`, critical rule `total_float<=n`\|`longest_path`, float on `finish`\|`start`\|`smallest`), `updated_at` used as a version. Unique `(project_id) WHERE kind='project'` and `(project_id, module_key) WHERE kind='module'`. |
| `calendars`, `calendar_exceptions` | Work weekdays, hours per day, and exceptions (non-work and extra-work days). Seeded from `project_settings` (`working_days`, `extra_holidays`, builders' shutdown) and `projects.public_holidays`, as a `site` and an `office` variant. Assignable per activity and per resource. |
| `activities` | `programme_id`, `parent_id` (WBS tree), `wbs_code`, `code`, `name`, `type` (`task`, `start_milestone`, `finish_milestone`, `summary`, `level_of_effort`, `module_summary`), `original_duration`, `remaining_duration` (working days, numeric for part days), `calendar_id`, `constraint_type` (`snet`, `snlt`, `fnet`, `fnlt`, `mso`, `mfo`, `alap`), `constraint_date`, `deadline`, `actual_start`, `actual_finish`, `percent_complete`, `percent_complete_type` (`duration`\|`physical`\|`units`), the computed `early_start`, `early_finish`, `late_start`, `late_finish`, `total_float`, `free_float`, `is_critical`, `is_driving`, `sort_order`, `external_uid`, `anchor` (`opening_date`\|`practical_completion`\|`tenant_bo:<node>`\|`inspection:<id>`, nullable), `work_item_id` (nullable), `updated_at`. |
| `dependencies` | `pred_id`, `succ_id`, `type` (FS/SS/FF/SF), `lag` (numeric), `lag_unit` (`working_days`\|`elapsed_days`\|`percent`), `lag_calendar` (`pred`\|`succ`\|`project`). Unique `(pred_id, succ_id, type)`. |
| `code_types`, `code_values`, `activity_codes` | User-defined codes (zone, trade, contractor, floor) for grouping, filtering and reports. |
| `resources` (organisation library), `resource_assignments` | Type (labour, plant, material), `max_units`, `calendar_id`, `rate` (masked). Each assignment holds `units_per_day`, `budgeted_qty`, `actual_qty`, `budgeted_cost` and `actual_cost` (costs masked). |
| `baselines`, `baseline_activities`, `baseline_dependencies` | Named full snapshots (dates, durations, floats, costs). One is `is_active` per programme. |
| `progress_periods` | One row per data-date update: per-activity and rollup PV, EV, AC and % complete. This feeds the S-curves and the earned value history. |
| `field_updates` | Start, finish, %, remaining and a note from a phone, with author, time and an optional photo. **Recorded immediately and shown as "reported", but moves no dates until a planner runs *Update programme*.** That run applies, adjusts or rejects each update and keeps the history (owner, 2026-11-16). |
| `imports` | Source file in storage, format, column mapping, the diff against the previous import or baseline, and who imported it. |
| `audit` | Every write, inside the same transaction. |

**Security pattern on every table:**
- A trigger derives `organisation_id` and `project_id` from the parent.
- RLS: a permissive read for project access, and a **RESTRICTIVE write gate split by verb**, never `FOR ALL`, because a RESTRICTIVE `FOR ALL` policy also narrows reads.
- Writes go only through SECURITY DEFINER functions with `search_path=''` and REVOKE PUBLIC and anon.
- An entry in `packages/db/src/site-scope/manifest.ts`, a `@verify` block, and `scripts/db/assert-programme-*.sql` wired into CI.
- Module programmes add a RESTRICTIVE module gate: `solar.solar_can_view` and `solar_can_edit` for `module_key='solar'`.

**Module summary bar.** The project programme holds one `module_summary` activity per module. A SECURITY DEFINER function returns only that module programme's minimum start, maximum finish and weighted percent complete. Users without module access, or on a lapsed subscription, see the bar and none of the detail. Project activities may link to and from the bar, which behaves as a task whose dates are fixed by the sub-programme.

### 4.3 Engine: `packages/shared/src/programme/` (pure TypeScript, no I/O)
- **Calendar:** working days with hours per day and exceptions per calendar, built from `packages/shared/src/lib/calendar/working-days.ts` (`buildCalendar`), which mirrors `projects.working_days_between()`.
- **Scheduling:**
  - topological order, reporting a cycle as its path;
  - forward pass for FS/SS/FF/SF with positive or negative lag in working days, elapsed days or percent, on the chosen lag calendar;
  - constraints SNET/SNLT/FNET/FNLT/MSO/MFO/ALAP, and deadlines;
  - backward pass, total and free float;
  - critical path by float threshold or longest path, and a trace of the driving path to any activity;
  - roll-up of summary and level-of-effort activities.
- **Progress:** data date, actuals, remaining duration, retained logic or progress override, and detection of out-of-sequence progress.
- **Resources:** histograms by resource or code, overload detection, and serial levelling by priority. Levelling moves activities only; it never changes logic, and it reports any finish it pushes back.
- **Earned value:** PV, EV, AC, SV, CV, SPI, CPI, EAC, ETC and S-curves.
- **Checks:**
  - baseline variance on start, finish, duration and float;
  - DCMA 14-point health: logic, leads, lags, relationship types, hard constraints, high float, negative float, high duration, invalid dates, resources, missed tasks, the critical path test, CPLI and BEI.
- **Exchange:**
  - MSPDI import and export with a real XML parser, covering WBS and outline, calendars, constraints, baselines, actuals, resources, and the file's own `MinutesPerDay`;
  - P6 XER import;
  - CSV and XLSX in and out (the synonym table moves from `solar/schedule/import/table.ts`);
  - ICS out (`ics.ts` moves).
- **Revision compare:** added, removed and changed activities and logic, and how far dates moved, between two imports or baselines.
- **Performance budget:** 5,000 activities and 10,000 links scheduled in under 200 ms, benchmarked in CI.

### 4.4 Screens
`/projects/[id]/programme` is always in the project navigation (`Sidebar.tsx` `projectNav`):
- **Layout:** a virtualised grid (configurable columns, WBS indent, inline edit) beside a virtualised timeline. Only the visible rows and dates are drawn, and the time scale stays fixed at the top. Zoom runs from day to year.
- **Interaction:** pointer events (mouse, touch, pen), drag and resize snapped to the calendar, drawing links, tracing logic.
- **Display:** critical path and float shading, baseline bars, the progress line, a resource histogram pane, an S-curve pane.
- **Organising:** group by WBS, code or resource; saved layouts and filters; undo and redo; bulk edit.
- **Concurrent edits:** `updated_at` stale checks, plus a realtime "programme changed" notice.
- **Planner actions:**
  - *Update programme*: move the data date, apply field updates, recalculate, and snapshot a progress period.
  - Baselines manager.
  - Import wizard with mapping and a diff preview.
  - Export menu.
- **Module sub-programmes** open in the same screen (`?programme=solar`). The Solar nav entry redirects there, and the old route redirects.

`/projects/[id]/programme/field` is the phone view, a list rather than a Gantt:
- "My 3-week look-ahead", filtered by the user's resource, code or zone.
- Large Start, Finish, % and Remaining buttons, with an optional note and photo.
- Designed for 390 px; every fixed bottom element clears `calc(72px + env(safe-area-inset-bottom))`.

### 4.5 Reports
New `projects.reports` kinds `programme_*`, each declared in `lib/reports/report-kind-access.ts`. Cost kinds read through `COST_VIEW_ROLES`. Every string goes through `lib/pdf/winansi.ts`. Large files go to storage and are served by signed URL, never in the response body. Each report is saved and versioned in `SavedReportsPanel`.

**Site pack:**
- 3-week look-ahead, grouped by zone, trade or contractor, on A4 or A3, with tick boxes and a constraints and notes column.
- This-week and next-week list per crew.
- Key dates and milestones sheet.
- ICS feed.

**Engineer pack:**
- Gantt PDF on A3 or A1 landscape: WBS, optional logic lines, float, critical path, baseline bars, the data-date line and a legend.
- Critical and near-critical report.
- Baseline variance and slippage report.
- Progress report: % against plan, S-curve, and what slipped this period.
- Earned value report: SPI, CPI and their trends (masked).
- Resource histogram report.
- DCMA health report.
- Revision comparison of a contractor's submission against the last.
- Excel, MSPDI, XER and CSV exports.

### 4.6 Roles (to `docs/rbac-matrix.md` in the same PR as each route)
- **Read:** every project role except `client_viewer`. A portal milestone summary is a later item.
- **Edit, baselines, import, update programme:** `ORG_WRITE_ROLES` via `requireEffectiveRole`.
- **Field updates:** project members in site roles (contractor, inspector), and **only on activities tagged to their company or crew**. The tag is an activity code value mapped to an organisation or user. Updates are reported, and a planner applies them.
- **Cost:** **rands only are masked** (rates, costs, budgeted/actual cost, PV/EV/AC in rand, CV, CPI, EAC/ETC) and visible only to `COST_VIEW_ROLES`, enforced in the database. Cost therefore lives in its own columns or tables that can be masked. SPI, % complete and S-curves by duration or quantity are visible to every reader. **Percent complete and the module bar's % are weighted by duration, never by cost** (owner, 2026-11-16).
- **Module programmes:** additionally need the module gate. **Solar keeps today's edit set**, which is whoever passes `solar_can_edit`, contractors included (owner, 2026-11-16).
- **Contractor programmes:** importing and editing need `ORG_WRITE_ROLES`. Reading follows project access.

### 4.7 Decisions settled after the builder check

**Owner decisions (2026-11-16):**
- **Contractor programmes are separate tracked programmes** (`kind='contractor'`, several allowed per project, one per contractor label).
  - Each submitted revision is imported into that programme, merging by `external_uid`, and kept as an `imports` row plus an automatic baseline named after the revision. The revision compare report diffs consecutive revisions.
  - E-Site data on an activity a revision removes (codes, field updates, raised work items) is kept on a tombstoned activity and listed in the import report. It is never deleted silently.
  - WM's project programme may show a contractor programme as a summary bar and link to it, exactly like a module.
- **Field updates:** own tagged activities only; the planner applies them (see `field_updates`, §4.6).
- **Cost masking:** rands only (§4.6).
- **Solar migration (P9):**
  - `solar_task` work items are **voided with the reason** "moved to programme", so their history is kept.
  - Solar edit rights are unchanged.
  - Bars that carried a genuine sign-off may be re-raised later as programme work items. That is not automatic.

**Builder's calls (the owner may override):**
- **Scheduling rules follow the source.** `msp` rules for native and MSPDI-imported programmes, `p6` for XER imports. The `p6` option set covers retained logic vs progress override, the lag calendar, and level-of-effort.
  - P1 starts on synthetic golden fixtures worked by hand, cross-checked in MS Project where possible.
  - The owner's real files (§7) are converted into golden fixtures by P4's importers. **The engine is not switched on until they pass.** P1 may merge, while still switched off, on the hand-worked goldens alone.
- **Anchors flow one way.** The E-Site date drives the activity as a constraint: `opening_date` and practical completion as MFO on a milestone, tenant BO as FNLT, an inspection as SNET. The programme never writes back to the source module.
  - The planned `projects.milestones` table from chapter 08 is **not built**. Programme milestones replace it, and the calendar projection reads them.
- **Raised work items:**
  - Only `ORG_WRITE_ROLES` may raise one, as a new type `programme_commitment`.
  - The link runs one way: activity finish → `due_date`, through the service path.
  - Closing the item records `actual_finish` as a *reported* field update. A planner applies it like any other update.
  - Voiding the activity voids the item, with a reason.

## 5. Delivery
Each phase is its own PR and merges dark behind `PROGRAMME_ENABLED`. The release goes live once P1–P9 are done.

| # | Phase | Evidence that it works |
|---|---|---|
| P0 | This spec, the roadmap chapter 08 amendment, and a vault ADR | Owner approval |
| P1 | Engine core: calendar, passes, constraints, float, hierarchy, progress | Property and fuzz tests; golden fixtures matching MS Project / P6 output |
| P2 | `programme` schema, RLS, site scope, definer writes, server actions, audit | Impersonation assertions, red first and mutation-tested; the `@verify` sweep |
| P3 | Virtualised Gantt, navigation, editing, baselines, undo | Signed-in walk from an empty project; 5,000 activities rendered |
| P4 | Import and export (MSPDI, XER, CSV/XLSX) and revision compare | Round-trip of real files |
| P5 | Site and engineer report packs | Decoded-stream PDF assertions and a glyph audit |
| P6 | Progress update and the phone field view | Contractor walk at 390 px |
| P7 | Resources, histograms, levelling | Levelling fixtures |
| P8 | Cost loading, earned value, S-curves, progress periods | EV fixtures; cost mask asserted per role |
| P9 | Solar onto the engine: migrate `solar.schedule_*`, the summary bar, retire `solar_task` work items and Solar's spine triggers, redirect the old route | Row counts before and after; module gate proven; zero residue |

Migration numbers are claimed at apply time, after checking three places: the ledger, `origin/main`, and the migration filenames in open PRs. Every migration PR runs the web, `@esite/shared` **and** `@esite/db` test suites.

## 6. Left to the builder
- The virtualisation library: TanStack Virtual, or hand-rolled windowing with SVG or canvas for the timeline.
- The XML parser library for MSPDI.
- Engine internals: integer work-day indices against date strings, and the time-of-day convention for milestones. It must reproduce MS Project's results on the golden fixtures.
- The exact page layouts of each report, matched to the sample reports the owner supplies.

## 7. Owed by the owner
- 3–5 real programme files (an MS Project XML export, a P6 XER, and a Candy export if Candy can produce one; unverified) as engine fixtures.
- Sample look-aheads and programme reports people use today.

## 8. Decision record
This reverses roadmap chapter 08 §(b) ("No critical path, no logic links, no resource levelling, no baseline, no earned value") and its §(f) exclusions for CPM, baselines and earned value, MS Project import, auto-rescheduling, and labour and plant scheduling.

The reason: the owner wants E-Site to hold the programme itself (built or imported) rather than only the commitments made against it. WM is now both a programme author and an assessor of contractor programmes.

The rest of chapter 08 stands: the calendar projection, the tenant delivery tracker, procurement lead times, and the separate JBCC calendar. Its milestones and three-week look-ahead become views of this module once P3 lands.
