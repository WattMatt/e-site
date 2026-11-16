# Programme P1 — Scheduling Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure TypeScript CPM engine in `@esite/shared` that schedules a programme correctly. It covers calendars, all four link types with lag (working, elapsed, percent), constraints, deadlines, data-date progress, float, summary and level-of-effort roll-up, critical and driving paths, and checks of the input. Its results must agree with MS Project on the same input.

**Architecture:** The engine is a set of pure functions under `packages/shared/src/programme/`, with no I/O.
- **Time:** time is a numeric `Instant`, the day number plus the fraction of that day's working time already used. A whole number means a day boundary.
- **Calendars:** each calendar precomputes a prefix sum of working days, so adding work and counting work cost O(log n).
- **Passes:** `scheduleProgramme(input)` runs, in order:
  1. checking the input
  2. normalising it (summary links expanded, topological order)
  3. the forward pass (with progress)
  4. the backward pass
  5. float
  6. roll-up
  7. critical and driving paths

  It returns calendar dates plus a list of issues.
- **Callers:** later phases call `scheduleProgramme` from the browser (to preview) and from server actions (to save the authoritative result).

**Tech Stack:** TypeScript, vitest (`pnpm --filter @esite/shared test`). No new dependencies. The property tests use a small seeded random generator written for them.

**Spec:** `docs/superpowers/specs/2026-11-16-project-programme-design.md` (§4.3 Engine, §4.7 decisions)

## Global Constraints

- Pure functions only. No Supabase, no `Date.now()` inside the engine; today is always the input `dataDate`.
- Dates in and out are `CalendarDate` strings `'YYYY-MM-DD'`. The internal `Instant` never leaves the engine's public result.
- **Display rule:**
  - A start shows the working day it starts on.
  - A finish shows the last working day it occupies (an `Instant` on a day boundary shows the previous working day).
  - A `start_milestone` shows the day of its instant.
  - A `finish_milestone` follows the finish rule.
- Durations, lags and floats are in **working days** of the calendar that owns them (the activity's calendar for duration and float; the lag calendar for lag). They are numbers, so part-days are allowed. Floats are rounded to 3 dp in the output.
- **Scheduling rules:** `msp` (native and MSPDI) and `p6` (XER). They differ in P1 only where a task says so.
- **Programme calendars treat the builders' shutdown as non-working time.** This differs on purpose from `lib/calendar/working-days.ts`, where shutdown only moves a due date. A programme is about who is on site.
- **Do not touch:** `lib/calendar/working-days.ts` and `lib/jbcc/*`.
- **Suites:** `pnpm --filter @esite/shared test` and `pnpm --filter @esite/shared type-check` both green before every commit.

## Review Focus

1. **Gaps in the holiday seed.** When a schedule runs past the calendar's `coverage`, expect a `calendar_out_of_range` warning rather than silent Mon–Fri arithmetic. Pinned in Task 2 and Task 7.
2. **Input order must not change the result.** Shuffling the activities and links gives identical dates and floats. Pinned in Task 8 (property).
3. **Milestones on a day boundary**, the bug in the current Solar tool. A finish milestone after a Friday finish, followed by an FS lag-0 successor, must start the successor on Monday with no violation. Pinned in Task 4.
4. **Hard constraints that contradict logic** (MSO earlier than the predecessor allows) show negative float and a `negative_float` warning. They never throw. Pinned in Task 5.
5. **Bad input from users.** Expect each of the following to come back as an issue, with `ok:false` for errors and no throw:
   - a link to an id that does not exist
   - a duplicate link
   - an actual finish before the actual start
   - an actual date after the data date
   - a parent loop

   Pinned in Task 3 and Task 6.

---

### Task 1: Package skeleton, shared date helpers, engine types

**Files:**
- Create: `packages/shared/src/lib/dates/calendar-date.ts` (moved verbatim from `src/solar/schedule/dates.ts`)
- Modify: `packages/shared/src/solar/schedule/dates.ts` → body becomes `export * from '../../lib/dates/calendar-date'`
- Create: `packages/shared/src/programme/types.ts`, `packages/shared/src/programme/index.ts`
- Modify: `packages/shared/package.json` `exports` → add `"./programme": "./src/programme/index.ts"`
- Test: `packages/shared/src/programme/types.test.ts`

**Interfaces:**
- Produces, in `types.ts`, exactly:

```ts
export type { CalendarDate } from '../lib/dates/calendar-date'
export type Instant = number
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF'
export type LagUnit = 'working_days' | 'elapsed_days' | 'percent'
export type LagCalendar = 'pred' | 'succ' | 'project'
export type ActivityType = 'task' | 'start_milestone' | 'finish_milestone' | 'summary' | 'level_of_effort' | 'module_summary'
export type ConstraintType = 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo' | 'alap'
export type SchedulingRules = 'msp' | 'p6'

export interface EngineCalendarSpec {
  id: string
  workWeekdays: number[]          // ISO 1=Mon … 7=Sun
  hoursPerDay: number
  nonWorkDates: CalendarDate[]    // holidays, extra holidays, shutdown days
  workDates: CalendarDate[]       // exceptional working days
  coverage: { from: CalendarDate; to: CalendarDate }  // range the exception lists are complete for
}
export interface ActivityInput {
  id: string
  parentId: string | null
  type: ActivityType
  originalDuration: number
  remainingDuration: number | null
  calendarId: string | null       // null = programme default
  constraint: { type: ConstraintType; date: CalendarDate | null } | null
  deadline: CalendarDate | null
  actualStart: CalendarDate | null
  actualFinish: CalendarDate | null
  fixed: { start: CalendarDate; finish: CalendarDate } | null   // module_summary only
}
export interface DependencyInput {
  id: string; predId: string; succId: string
  type: LinkType; lag: number; lagUnit: LagUnit; lagCalendar: LagCalendar
}
export interface ScheduleOptions {
  rules: SchedulingRules
  progress: 'retained_logic' | 'progress_override'
  critical: { kind: 'total_float'; threshold: number } | { kind: 'longest_path' }
  floatOn: 'start' | 'finish' | 'smallest'
}
export interface ProgrammeInput {
  projectStart: CalendarDate
  dataDate: CalendarDate | null
  defaultCalendarId: string
  calendars: EngineCalendarSpec[]
  activities: ActivityInput[]
  dependencies: DependencyInput[]
  options: ScheduleOptions
}
export type IssueCode =
  | 'cycle' | 'parent_cycle' | 'missing_parent' | 'unknown_activity' | 'unknown_calendar'
  | 'self_link' | 'duplicate_link' | 'invalid_date' | 'milestone_has_duration'
  | 'constraint_date_missing' | 'summary_link_p6' | 'fixed_dates_missing'
  | 'actual_finish_before_start' | 'actual_after_data_date' | 'out_of_sequence'
  | 'negative_float' | 'deadline_missed' | 'calendar_out_of_range'
export interface ScheduleIssue {
  code: IssueCode; severity: 'error' | 'warning'
  activityIds: string[]; dependencyIds: string[]; message: string
}
export interface ScheduledActivity {
  id: string
  earlyStart: CalendarDate; earlyFinish: CalendarDate
  lateStart: CalendarDate; lateFinish: CalendarDate
  totalFloat: number; freeFloat: number
  isCritical: boolean
}
export interface ScheduleResult {
  ok: boolean                      // false iff any issue has severity 'error'
  activities: Map<string, ScheduledActivity>   // empty when ok === false
  drivingLinkIds: Set<string>
  projectFinish: CalendarDate | null
  issues: ScheduleIssue[]
}
```

Severity: these are `'error'` and stop scheduling:
- `cycle`
- `parent_cycle`
- `missing_parent`
- `unknown_activity`
- `unknown_calendar`
- `self_link`
- `invalid_date`
- `milestone_has_duration`
- `constraint_date_missing`
- `summary_link_p6`
- `fixed_dates_missing`
- `actual_finish_before_start`
- `actual_after_data_date`

Every other code is a `'warning'`.

- [ ] **Step 1: Write the failing test**. `types.test.ts`: `import { ISSUE_SEVERITY } from './index'` and assert:
  - `ISSUE_SEVERITY.cycle === 'error'`
  - `ISSUE_SEVERITY.negative_float === 'warning'`
  - `Object.keys(ISSUE_SEVERITY).length === 18`
  - `import { dayNumber } from '../solar/schedule/dates'` still returns `20514` for `'2026-03-02'`
- [ ] **Step 2: Run** `pnpm --filter @esite/shared vitest run src/programme/types.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - Move the file and leave the re-export shim.
  - Write `types.ts` as above, plus `export const ISSUE_SEVERITY: Record<IssueCode, 'error' | 'warning'>`.
  - `index.ts` re-exports `types`.
  - Add the package export.
- [ ] **Step 4: Run** the test, the whole shared suite, and type-check. Expected: PASS, and the Solar tests are unchanged.
- [ ] **Step 5: Commit** `feat(programme): engine types and shared calendar-date helpers`.

---

### Task 2: Engine calendar

**Files:**
- Create: `packages/shared/src/programme/calendar.ts`
- Test: `packages/shared/src/programme/calendar.test.ts`

**Interfaces:**
- Consumes:
  - `EngineCalendarSpec` and `Instant` (Task 1)
  - `dayNumber`, `fromDayNumber`, `weekdayOf` (`lib/dates/calendar-date`)
  - `buildCalendar`, `CalendarInput` (`lib/calendar/working-days`)
- Produces:

```ts
export interface EngineCalendar {
  readonly id: string
  isWorkingDay(day: number): boolean
  /** Working position of an instant (monotone, non-decreasing). */
  workPos(t: Instant): number
  /** Inverse of workPos. 'start': a whole position lands at the START of that working day;
   *  'finish': a whole position lands at the END of the previous working day (a day boundary). */
  fromWorkPos(pos: number, mode: 'start' | 'finish'): Instant
  addWork(t: Instant, n: number, mode: 'start' | 'finish'): Instant   // = fromWorkPos(workPos(t)+n, mode)
  workBetween(a: Instant, b: Instant): number                          // workPos(b) − workPos(a)
  snapStart(t: Instant): Instant      // earliest working instant ≥ t
  inCoverage(t: Instant): boolean
}
export function buildEngineCalendar(spec: EngineCalendarSpec): EngineCalendar
export function engineCalendarFromProject(id: string, input: CalendarInput, hoursPerDay: number,
  coverage: { from: CalendarDate; to: CalendarDate }): EngineCalendarSpec
export function startOf(d: CalendarDate): Instant           // = dayNumber(d)
export function displayStart(t: Instant): CalendarDate       // fromDayNumber(floor(t))
export function displayFinish(cal: EngineCalendar, t: Instant): CalendarDate
  // whole t → last working day strictly before day t; otherwise fromDayNumber(floor(t))
```

- **Implementation approach:**
  - A prefix array `cum[i]` counts the working days in `[base, base+i)`. The base is the coverage start minus 400 days; the array is extended both ways as needed.
  - `workPos(t) = cum[floor t − base] + (isWorkingDay(floor t) ? t − floor t : 0)`.
  - `fromWorkPos` is a binary search over `cum`.
  - Outside coverage, the weekday rule alone decides.
- **`engineCalendarFromProject`:**
  - calls `buildCalendar(input)`, so the `site` calendar adds Saturday;
  - `nonWorkDates` = `holidays` ∪ `extraHolidays` ∪ every day of `shutdown`, inclusive;
  - `workWeekdays` = `[...effectiveDays]`.

All tests below use calendar `C` = Mon–Fri, `hoursPerDay` 8, no exceptions, coverage `2026-01-01..2027-12-31`. 2026-03-02 is a Monday.

- [ ] **Step 1: Write the failing tests** in `calendar.test.ts`:
  - `addWork(startOf('2026-03-06'), 1, 'finish') === startOf('2026-03-07')`, and `displayFinish` of that is `'2026-03-06'`.
  - `addWork(startOf('2026-03-06'), 2, 'finish') === startOf('2026-03-10')`, and `displayFinish` is `'2026-03-09'`.
  - With `nonWorkDates: ['2026-03-09']`: the same call gives `startOf('2026-03-11')`.
  - `workBetween(startOf('2026-03-02'), startOf('2026-03-09')) === 5`.
  - `addWork(startOf('2026-03-02'), 0.5, 'start') === startOf('2026-03-02') + 0.5`.
  - `snapStart(startOf('2026-03-07')) === startOf('2026-03-09')`.
  - `addWork(startOf('2026-03-09'), -1, 'start') === startOf('2026-03-06')`.
  - `fromWorkPos` on a whole position: `'start'` gives Monday `startOf('2026-03-09')`, while `'finish'` gives `startOf('2026-03-07')` (end of Friday).
  - Saturday working (`workWeekdays [1..6]`): `addWork(startOf('2026-03-06'), 2, 'finish') === startOf('2026-03-08')`.
  - `engineCalendarFromProject` (`workingDays [1..5]`, `calendar 'site'`, `shutdown {from:'2026-12-16', to:'2027-01-10'}`, `holidays` empty, `extraHolidays` empty, `seededYears {2026, 2027}`):
    - `addWork(startOf('2026-12-15'), 2, 'finish') === startOf('2027-01-12')`.
    - `isWorkingDay(dayNumber('2026-12-19'))` is false (shutdown).
  - `inCoverage(startOf('2028-01-03'))` is false.
  - Round trip: for 500 seeded random `(t, n)` with `t` a working-day start and `n` in −30..30, `workBetween(t, addWork(t, n, 'start')) === n`.
- [ ] **Step 2: Run** `pnpm --filter @esite/shared vitest run src/programme/calendar.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `calendar.ts` to the interface above.
- [ ] **Step 4: Run** the tests and type-check. Expected: PASS.
- [ ] **Step 5: Commit** `feat(programme): engine calendar with prefix-sum work arithmetic`.

---

### Task 3: Input checking and normalisation

**Files:**
- Create: `packages/shared/src/programme/validate.ts`, `packages/shared/src/programme/normalise.ts`
- Test: `packages/shared/src/programme/validate.test.ts`, `packages/shared/src/programme/normalise.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `isCalendarDate`.
- Produces:

```ts
export function validateProgramme(input: ProgrammeInput): ScheduleIssue[]
export interface NormalisedProgramme {
  leaves: ActivityInput[]                 // non-summary activities, in topological order
  summaries: ActivityInput[]              // children before parents (post-order)
  childrenOf: Map<string, string[]>       // direct children
  links: DependencyInput[]                // after summary expansion; expanded links keep the source id
  predsOf: Map<string, DependencyInput[]>
  succsOf: Map<string, DependencyInput[]>
}
export function normaliseProgramme(input: ProgrammeInput): { value: NormalisedProgramme | null; issues: ScheduleIssue[] }
export function findCycle(nodes: string[], edges: Array<[string, string]>): string[] | null   // path, first id repeated at end
```

- **Checks (one issue each, every `activityIds`/`dependencyIds` filled in):**
  - unknown pred/succ → `unknown_activity`
  - `predId === succId` → `self_link`
  - same `(predId, succId, type)` twice → `duplicate_link` (warning; the second is ignored)
  - missing `parentId` target → `missing_parent`
  - parent loop → `parent_cycle`
  - unknown `calendarId` → `unknown_calendar`
  - any non-ISO date → `invalid_date`
  - a milestone with `originalDuration !== 0` → `milestone_has_duration`
  - a constraint other than `alap` with a null date → `constraint_date_missing`
  - `actualFinish < actualStart` → `actual_finish_before_start`
  - an actual date after `dataDate` → `actual_after_data_date`
  - `module_summary` without `fixed` → `fixed_dates_missing`
  - under `p6`, any link touching a summary → `summary_link_p6`
- **Summary expansion (`msp`):**
  - a link whose succ is a summary becomes one link to each leaf descendant;
  - a link whose pred is a summary becomes one link from each leaf descendant;
  - both, when both are summaries.
- **Cycle check:** runs after expansion, with Kahn's algorithm. On failure it returns `cycle` with the path in `activityIds`.

- [ ] **Step 1: Write the failing tests.**
  - One test per check above, asserting `code`, `severity` (via `ISSUE_SEVERITY`) and the ids.
  - `findCycle(['A','B','C'], [['A','B'],['B','C'],['C','A']])` deep-equals a rotation of `['A','B','C','A']`.
  - Expansion: summary `S` with leaves `A` and `B`, and link `X FS→ S`, gives links `X→A` and `X→B`, both with the source id.
  - The same input under `p6` gives `summary_link_p6` and `value === null`.
  - Topological order: for every link, the pred's index is less than the succ's in `leaves`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(programme): input validation, summary-link expansion, topological order`.

---

### Task 4: Forward pass (no progress)

**Files:**
- Create: `packages/shared/src/programme/forward.ts`
- Test: `packages/shared/src/programme/forward.test.ts`

**Interfaces:**
- Consumes: `NormalisedProgramme`, `EngineCalendar`, `startOf`.
- Produces:

```ts
export interface Times { es: Instant; ef: Instant }
export function forwardPass(n: NormalisedProgramme, input: ProgrammeInput,
  cals: Map<string, EngineCalendar>): Map<string, Times>
export function linkDemand(link: DependencyInput, pred: Times, predCal: EngineCalendar,
  succCal: EngineCalendar, projectCal: EngineCalendar, predDuration: number):
  { on: 'start' | 'finish'; at: Instant }
```

**Rules (`msp`; `p6` identical in P1):**
- **Demand per link.** The lag is applied on the lag calendar:
  - FS: `on start`, at `pred.ef + lag`
  - SS: `on start`, at `pred.es + lag`
  - FF: `on finish`, at `pred.ef + lag`
  - SF: `on finish`, at `pred.es + lag`
- **Lag units:**
  - `working_days`: `lagCal.addWork(x, lag, on==='start' ? 'start' : 'finish')`
  - `elapsed_days`: `x + lag`
  - `percent`: `lag/100 × predDuration` working days on the pred calendar
- **ES:**
  - the max of `startOf(projectStart)`, every start demand, and (for each finish demand) `succCal.addWork(demand, −duration, 'start')`;
  - then `snapStart`, except a `finish_milestone`, which keeps its boundary.
- **EF:**
  - `addWork(es, duration, 'finish')` for a task;
  - `ef = es` for both milestone types.
  - For a `finish_milestone`, `es = ef =` the max of its demands, unsnapped.
- **Forward constraints:**
  - SNET: `es = max(es, snapStart(startOf(date)))`.
  - FNET: `ef ≥ startOf(date)+1`, back-computing es.
  - MSO: `es = snapStart(startOf(date))`, logic ignored.
  - MFO: `ef = startOf(date)+1`, logic ignored.
  - SNLT, FNLT and ALAP are left to Task 5.
- **`module_summary`:** `es = startOf(fixed.start)`, `ef = startOf(fixed.finish)+1`, logic ignored.

All tests use calendar `C` and `projectStart '2026-03-02'`. Assert through `displayStart`/`displayFinish` against these exact dates:

- [ ] **Step 1: Write the failing tests.**

| Case | Expected |
|---|---|
| A(5) alone | A 03-02 → 03-06 |
| A(5) FS B(3) | B 03-09 → 03-11 |
| FS +2 working | B 03-11 → 03-13 |
| FS −2 (lead) | B 03-05 → 03-09 |
| SS +2 | B 03-04 → 03-06 |
| FF 0, B(3) | B 03-04 → 03-06 |
| SF 0, B(3) | B 03-02 → 03-04 (held at the project start) |
| FS +2 elapsed | B 03-09 → 03-11 |
| A(10) SS 50 % | B 03-09 |
| finish_milestone M after A(5) FS, M FS B(3) | M shows 03-06; B 03-09 → 03-11 |
| start_milestone M after A(5) FS | M shows 03-09 |
| B SNET 03-11 with no preds | B 03-11 |
| B(3) FNET 03-20 | B 03-18 → 03-20 |
| A(5) FS B(3), B MSO 03-04 | B 03-04 → 03-06 |
| projectStart '2026-03-07' (Saturday), A(1) | A 03-09 |
| module_summary fixed 03-10..03-20, FS B(1) | B 03-23 |

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `forward.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(programme): forward pass with lags, lag units, constraints, milestones`.

---

### Task 5: Backward pass, float, late constraints, deadlines, ALAP

**Files:**
- Create: `packages/shared/src/programme/backward.ts`, `packages/shared/src/programme/float.ts`
- Test: `packages/shared/src/programme/backward.test.ts`

**Interfaces:**
- Consumes: `forwardPass`, `Times`, `linkDemand` (Task 4).
- Produces:

```ts
export interface LateTimes { ls: Instant; lf: Instant }
export function backwardPass(n: NormalisedProgramme, input: ProgrammeInput,
  cals: Map<string, EngineCalendar>, early: Map<string, Times>): { late: Map<string, LateTimes>; projectFinish: Instant }
export function totalFloat(cal: EngineCalendar, e: Times, l: LateTimes, on: ScheduleOptions['floatOn']): number
export function freeFloat(id: string, n: NormalisedProgramme, early: Map<string, Times>,
  cals: Map<string, EngineCalendar>, projectFinish: Instant, input: ProgrammeInput): number
export function applyAlap(n: NormalisedProgramme, input: ProgrammeInput, cals: Map<string, EngineCalendar>,
  early: Map<string, Times>, late: Map<string, LateTimes>): void   // mutates early in place
```

**Rules:**
- `projectFinish` is the max `ef`.
- A node with no successors has `lf = projectFinish`.
- Each link gives the mirror of its demand: the latest the pred may be, computed in reverse on the lag calendar. `lf` is the min of the latest-finish limits, and of each latest-start limit converted with `+duration`.
- `ls = addWork(lf, −duration, 'start')`.
- **Late limits:**
  - SNLT: `ls ≤ startOf(date)`
  - FNLT: `lf ≤ startOf(date)+1`
  - deadline: `lf ≤ startOf(deadline)+1`
  - MSO/MFO: fixed both ways
- **Total float** in working days on the activity's calendar:
  - `start`: `ls − es`
  - `finish`: `lf − ef`
  - `smallest`: the min of the two
- **Free float:** the smallest slack to any successor's early date without moving it, or to `projectFinish` if none. Never below 0.
- **Warnings:**
  - TF < 0 → `negative_float` (warning, ids of the negative activities);
  - `ef > deadline` → `deadline_missed`.
- **ALAP:** after the backward pass, `es = ls`, `ef = lf`, freeFloat 0. It runs before roll-up.

Network for the tests:
- A(5) FS B(4), A FS C(1), C FS D(1)
- Early dates: A 03-02..03-06, B 03-09..03-12, C 03-09, D 03-10
- Project finish 03-12

- [ ] **Step 1: Write the failing tests.**
  - Late dates: A 03-02..03-06, B 03-09..03-12, C 03-11..03-11, D 03-12..03-12.
  - Total float: A 0, B 0, C 2, D 2. Free float: C 0, D 2, A 0.
  - D FNLT 03-10: D TF 0 and C TF 0.
  - D FNLT 03-09: D TF −1, plus a `negative_float` issue naming D.
  - B deadline 03-11: B TF −1, plus `deadline_missed`, because early finish 03-12 is after the deadline.
  - C ALAP: C displays 03-11..03-11.
  - `floatOn 'finish'` equals `'start'` on this network (both 2 for C).
  - Task 4's MSO case (A(5) FS B(3), B MSO 03-04):
    - B is fixed both ways, so B TF 0.
    - A must finish by the end of 03-03 but needs five days from 03-02, so A's late start is 02-25 and A TF −3.
    - A `negative_float` warning names A. No throw.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(programme): backward pass, total/free float, late constraints, deadlines, ALAP`.

---

### Task 6: Progress against the data date

**Files:**
- Modify: `packages/shared/src/programme/forward.ts` (progress branch)
- Test: `packages/shared/src/programme/progress.test.ts`

**Interfaces:**
- Consumes: Task 4 and Task 5.
- Produces:
  - `forwardPass` now honours actuals.
  - `export function detectOutOfSequence(n: NormalisedProgramme, input: ProgrammeInput): ScheduleIssue[]`

**Rules,** with `dd = snapStart(startOf(dataDate))`:
- **Complete** (`actualFinish`): `es = startOf(actualStart)`, `ef = startOf(actualFinish)+1`. Logic and constraints are ignored. Float is 0 in the result.
- **In progress** (`actualStart`, no finish): `es = startOf(actualStart)`. Remaining = `remainingDuration ?? max(0, originalDuration − work done to dd)`. The resume point is then:
  - `retained_logic`: the max of `dd` and every link demand, each applied to the remaining part;
  - `progress_override`: just `dd`.

  Then `ef = addWork(resume, remaining, 'finish')`.
- **Not started:** `es ≥ dd`, in addition to the logic.
- **Out of sequence:** an activity with `actualStart` whose FS predecessor has no `actualFinish`, or whose SS predecessor has no `actualStart`. This raises the `out_of_sequence` warning.

Calendar `C`, `projectStart '2026-03-02'`, `dataDate '2026-03-09'`.

- [ ] **Step 1: Write the failing tests.**
  - A(5), actual 03-02..03-06; FS B(3). Expected: B 03-09..03-11.
  - A(5) started 03-02, remaining 3. Expected: A finish 03-11; B 03-12..03-16.
  - Not-started A(5) with no preds. Expected: 03-09..03-13.
  - A(5) not started; B started 03-03 with remaining 2; A FS B. Expected:
    - an `out_of_sequence` warning on B;
    - `retained_logic`: B finish 03-17;
    - `progress_override`: B finish 03-10.
  - `actualFinish '2026-03-10'`. Expected: an `actual_after_data_date` error, with `ok:false` once wired in (Task 7).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole programme folder.** Expected: PASS, and Tasks 4–5 still green.
- [ ] **Step 5: Commit** `feat(programme): data-date progress with retained logic / progress override`.

---

### Task 7: Roll-up, critical and driving paths, `scheduleProgramme`

**Files:**
- Create: `packages/shared/src/programme/rollup.ts`, `packages/shared/src/programme/critical.ts`, `packages/shared/src/programme/schedule.ts`
- Modify: `packages/shared/src/programme/index.ts` (export `scheduleProgramme`, `drivingPath`, `buildEngineCalendar`, `engineCalendarFromProject`)
- Test: `packages/shared/src/programme/schedule.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:

```ts
export function scheduleProgramme(input: ProgrammeInput): ScheduleResult
export function drivingPath(result: ScheduleResult, input: ProgrammeInput, targetId: string):
  { activityIds: string[]; dependencyIds: string[] }   // from a start-driven activity to target, in order
```

**Rules:**
- **Order of work:** validate → normalise (errors stop here with `ok:false`, empty `activities`) → calendars → forward → backward → ALAP → float → roll-up → critical/driving → coverage warning → display.
- **Summary roll-up:** `es` = min of the children's `es`, `ef` = max of their `ef`, late dates the same way, TF = min of the children's TF, FF = 0.
- **`level_of_effort`:**
  - `es` = the earliest demand of its predecessors;
  - `ef` = the max of what its successors demand, taking each successor's date on that link's successor side, minus the lag;
  - TF and FF are 0;
  - it is never critical and never drives anything.
- **Driving link:** its demand equals the successor's early date on that side, within 1e-9.
- **Critical:**
  - `total_float`: TF ≤ threshold (excluding LOE and summaries).
  - `longest_path`: walk the driving links backwards from every activity whose `ef === projectFinish`.
- **`calendar_out_of_range`:** a warning when any early or late instant is outside its calendar's coverage.

- [ ] **Step 1: Write the failing tests.**
  - The Task 5 network through `scheduleProgramme`:
    - `ok`;
    - with threshold 0, `isCritical` is A and B only;
    - `projectFinish '2026-03-12'`;
    - `drivingPath(…, 'B')` gives activities `['A','B']`.
  - Summary S over A(5) FS B(3): S 03-02..03-11, S TF 0.
  - LOE L, with A(5) SS L and L FF B, where A FS B(3): L 03-02..03-11, TF 0, not critical.
  - Longest path: chains P(5)→Q(1) and R(2), with R having 4 days of float. Only P and Q are critical with `{kind:'longest_path'}`.
  - A schedule finishing beyond coverage `to` gives the `calendar_out_of_range` warning, while `ok` stays true.
  - A validation error gives `ok:false` and an empty `activities` map.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole programme folder and type-check. Expected: PASS.
- [ ] **Step 5: Commit** `feat(programme): roll-up, critical/driving paths, scheduleProgramme entry`.

---

### Task 8: Golden fixtures, property tests, performance budget

**Files:**
- Create: `packages/shared/src/programme/goldens/README.md`
- Create: `packages/shared/src/programme/goldens/hand-textbook-cpm.json`
- Create: `packages/shared/src/programme/goldens/hand-progress-retained.json`
- Create: `packages/shared/src/programme/goldens.test.ts`
- Create: `packages/shared/src/programme/test-utils/random-programme.ts`
- Create: `packages/shared/src/programme/property.test.ts`
- Create: `packages/shared/src/programme/performance.test.ts`

**Interfaces:**
- Consumes: `scheduleProgramme`.
- Produces:
  - The fixture format, which P4 reuses for real MS Project and P6 files:
    `{ name, source: 'hand' | 'msp' | 'p6', notes, input: ProgrammeInput, expected: Record<id, { es, ef, ls, lf, tf }> }`
  - `export function mulberry32(seed: number): () => number`
  - `export function randomProgramme(seed: number, opts: { activities: number; links: number; allowConstraints: boolean }): ProgrammeInput`. This builds a layered DAG on calendar `C`, with durations 0–10 (0 means a milestone) and lag −2..5 working days.

**Fixtures:**
- `hand-textbook-cpm.json`: a 10-activity network with all four link types, worked by hand on calendar `C`. The README records the working for every date.
- `hand-progress-retained.json`: the Task 6 out-of-sequence case under both progress modes.

The README states that the owner's real files are added as `msp-*.json` / `p6-*.json` by P4's importers, and that the engine is not switched on until they pass.

- [ ] **Step 1: Write the tests.**
  - **Goldens:** for every `*.json`, `scheduleProgramme(input)` matches `expected` exactly for each activity's `es`, `ef`, `ls`, `lf` and `tf`.
  - **Properties,** over 200 seeds of 50 activities / 90 links with no constraints and no progress:
    1. Every link's demand ≤ the successor's early date on its side.
    2. Every TF ≥ 0.
    3. At least one activity has TF = 0.
    4. `ef === addWork(es, duration, 'finish')` for every task.
    5. A seeded shuffle of the activities and links gives a deep-equal result.
  - **Performance:** `randomProgramme(1, {activities: 5000, links: 10000})`. The median of 5 runs of `scheduleProgramme` must be under 200 ms (`performance.now()`).
- [ ] **Step 2: Run.** Expected: the goldens and properties pass if Tasks 1–7 are correct. The performance test passes, or fails with a measured time; if it fails, profile `workPos`/`fromWorkPos` first.
- [ ] **Step 3: Fix any engine defect the properties expose** in the task's own file. Add a named regression test for each counterexample seed.
- [ ] **Step 4: Run** the full shared suite, type-check and lint (`pnpm --filter @esite/shared lint`). Expected: all green.
- [ ] **Step 5: Commit** `test(programme): golden fixtures, property tests, 5k-activity performance budget`.

---

## Definition of done for P1
- Every task above is committed.
- The shared suite, type-check and lint are green.
- Nothing outside `src/programme/`, `src/lib/dates/` and the `solar/schedule/dates.ts` shim has changed.
- No UI, schema or migration (those are P2/P3).
- Every rule in the Global Constraints is covered by at least one test.
