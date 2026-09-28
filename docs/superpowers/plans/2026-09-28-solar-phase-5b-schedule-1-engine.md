# E-Site Solar Phase 5b — Schedule (Gantt) Implementation Plan — Part 1 of 5: dates, calendar, dependency graph, critical path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Solar **Schedule** tab (`/projects/[id]/solar/schedule`, functional spec §14, decision D-20): a Gantt programme whose tasks are E-Site work items of a new type `solar_task`, with Gantt fields in `solar.schedule_*` side tables, a correct critical path (FS/SS/FF/SF + lag), working-day mode with SA public holidays, baselines, split bars, per-user filter presets in the database, template seeding, CSV/XLSX/MS Project XML import, PNG/PDF/XLSX/DOCX/ICS export, and working undo/redo.

**Architecture:** All scheduling maths is pure TypeScript in `packages/shared/src/solar/schedule/` (dates as `'YYYY-MM-DD'` strings, arithmetic on UTC day numbers, never a local `Date`). One migration (`00212_solar_schedule.sql`, number claimed at apply time) registers `solar_task` in `projects.work_item_types`, re-declares the two spine objects that enumerate types (`work_items_source_required`, `work_items_ensure_ref()`), creates eight `solar.schedule_*` tables with FORCE RLS and per-verb policies on `solar_can_view` / `solar_can_edit`, and adds SECURITY DEFINER RPCs that create/update/delete a work item **and** its side row in one transaction (the spine's `work_items_insert_gate` stays `task`-only, so a `solar_task` can only be born through the gated RPC). Server actions in `apps/web` call those RPCs through the caller's session; the page is a server loader + one client component with a DOM row list and a Konva timeline whose geometry comes from a pure `layoutGantt()`.

**Tech Stack:** Postgres (Supabase) + PostgREST, Next.js 15 server actions and route handlers, React 19, react-konva 19 / konva 10 (already dependencies), exceljs 4 (already a dependency), @react-pdf/renderer 4 + `winAnsiSafe` (existing PDF pipeline), pizzip (already a dependency) for DOCX, plain-text ICS, vitest.

---

## The five parts (execute in order)

| Part | File | Tasks |
|---|---|---|
| 1 | `2026-09-28-solar-phase-5b-schedule-1-engine.md` (this file) | 0 worktree · 1 calendar dates (SAST round trip) · 2 working-day calendar · 3 dependency graph + critical path |
| 2 | `2026-09-28-solar-phase-5b-schedule-2-model-import.md` | 4 status/rows/filters/grouping/drag · 5 roll-up, baseline variance, workload · 6 template · 7 import (plan, CSV, MS Project XML, table mapping) · 8 ICS · 9 Gantt layout |
| 3 | `2026-09-28-solar-phase-5b-schedule-3-registry-migration.md` | 10 `solar_task` registry in TypeScript + contract tests + Appendix A(b) · 11 migration `00212` red → green → mutations |
| 4 | `2026-09-28-solar-phase-5b-schedule-4-server.md` | 12 fake-supabase `schema().rpc` · 13 errors + audit sentences · 14 loader · 15 task actions · 16 links/baselines/presets/settings actions · 17 template (apply + org editor) · 18 import route + commit · 19 exports (XLSX, ICS, PDF A3) · 20 DOCX (optional, separate) |
| 5 | `2026-09-28-solar-phase-5b-schedule-5-ui.md` | 21 undo/redo history · 22 keyboard shortcuts · 23 tab + readiness · 24 toolbar (filters/presets, baselines, settings, export menu) · 25 row list + Konva chart · 26 task + link dialogs · 27 bulk bar, stats, workload, shortcuts overlay, empty state · 28 import dialog · 29 ScheduleClient + page (undo/redo, keyboard, PNG) · 30 RBAC matrix, suites, push, draft PR · open questions |

## Ground rules (all parts)

- Work only in the worktree `~/.config/superpowers/worktrees/esite/solar-phase-5b` (branch `feat/solar-phase-5b`, based on `origin/feat/solar-phase-1c`). Commands run from the worktree root. Never touch the canonical `esite/` checkout.
- **Dates:** a schedule date is `CalendarDate` (`'YYYY-MM-DD'`). Never `new Date('2026-10-01')`, never `toISOString().split('T')[0]`, never `parseISO`. `<input type="date">` values are passed through as strings. The one place a `Date` is allowed is `sastToday()` (formats "now" in `Africa/Johannesburg`) and `calendarDateFromUtc()` (reads UTC components of a UTC-midnight `Date`, e.g. exceljs cells and the holiday source).
- **Never trust the page gate.** Every action re-checks with `requireSolarLevel(projectId, 'edit' | 'view', supabase)`; every RPC re-checks `solar_can_edit`; RLS is the last layer.
- Page → client props are JSON only (no functions — the #201 lesson).
- Destructive controls use the two-step inline confirm (`useArmedConfirm`), never `window.confirm`.
- Human sentences only; raw Postgres messages never reach the user (`humanScheduleError`).
- Controls above the caller's level are **hidden**, not disabled.
- Tests: `vi.hoisted` + `vi.mock`, block-bodied `beforeEach`. Shared tests: `pnpm --filter @esite/shared exec vitest run <file>`. Web tests: `pnpm --filter web exec vitest run <file>`.
- Commit after every task with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The three suites before any push: `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci` (packages/db holds the repo-wide migration guards that read migration TEXT) + `pnpm -r type-check`.

## WM defects this plan must not repeat (as-is/06 Part B) and where each is fixed

| WM defect | Fixed by |
|---|---|
| D1 −1 day drift per edit in SAST | Task 1 (`dates.ts`, SAST round-trip test), rule above |
| D5 critical path FS-only, no lag, calendar dates ignored, silent `[]` on cycle, filtered-set CP | Task 3 (`criticalPath` on all tasks, 4 types + lag, reports cycles), Task 11 (DB refuses cycles) |
| D6 milestones / dependencies / segments not editable | Tasks 15–16, 26 |
| Undo/redo stubs | Task 21 (history applies inverse ops through actions) |
| Browser-stored presets | Task 11 `solar.schedule_filter_presets` + Task 16 |
| D4 grouped list and bars misaligned | Task 4 `buildScheduleRows` + Task 9 layout from the same rows |
| D2 deleting a task erased it from baselines | Task 11 `schedule_baseline_tasks.task_id ON DELETE SET NULL` + name/dates copied |
| D3 Delete key with no confirmation | Task 22 (Delete arms the two-step confirm) |
| D7 non-transactional import, N toasts, duplicate sort orders | Task 11 `schedule_create_tasks` (one transaction, replace inside it), Task 18 |
| S1–S3 open RLS | Task 11 |
| ICS VTODO statuses on VEVENT, fake organiser, local DTSTAMP with `Z`, no folding | Task 8 |
| Word export = unescaped HTML `.doc` | Task 20 (real OOXML, escaped) |
| Export not round-trippable with import | Task 19 round-trip test |
| 1-day task cannot be made by dragging | Task 4 `applyBarDrag` |
| Reorder over the filtered list collides | Task 4 `reorderTaskIds` over ALL ids |
| Overload threshold hard-coded 2 | Task 11 `schedule_settings.workload_threshold` |
| Colour filter offers 8 fixed colours, not those in use | Task 24 (options = distinct colours in the schedule) |

## File structure (whole phase)

**Shared — `packages/shared/src/solar/schedule/`** (pure; imports nothing outside `@esite/shared`)
- `dates.ts` — `CalendarDate`, day numbers, `sastToday`, formatting.
- `calendar.ts` — `WorkCalendar` (calendar / working mode + SA holidays), spans, shifts.
- `graph.ts` — link types, topological order, cycle detection.
- `cpm.ts` — `criticalPath()`.
- `status.ts` — Gantt status vocabulary, `ganttStatusOf()` (work-item status → Gantt status).
- `rows.ts` — task view model, filters, grouping rows, reorder.
- `drag.ts` — bar drag maths, segment fitting/splitting.
- `rollup.ts` — stats, baseline variance, owner workload.
- `template.ts` — default solar programme, validation, instantiation.
- `import/plan.ts`, `import/csv.ts`, `import/mspdi.ts`, `import/table.ts` — import model + parsers.
- `ics.ts` — calendar export.
- `layout.ts` — `layoutGantt()` geometry.
- `index.ts` — re-exports; `packages/shared/src/solar/index.ts` gains `export * from './schedule'`.

**Shared — work items**
- Modify `packages/shared/src/work-items/types.ts` (register `solar_task`), both contract tests, and `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md` (A(b) row).

**Database**
- `apps/edge-functions/supabase/migrations/00212_solar_schedule.sql`
- `scripts/db/assert-solar-schedule-roles.sql`

**Web — lib / actions / routes**
- `apps/web/src/test/fake-supabase.ts` (add `schema(s).rpc`)
- `apps/web/src/lib/solar/schedule/errors.ts`, `loader.ts`, `types.ts`, `export-xlsx.ts`, `read-xlsx.ts`, `schedule-pdf.tsx`, `render-schedule-pdf.ts`, `export-docx.ts`, `history.ts`, `shortcuts.ts`
- `apps/web/src/actions/solar-schedule.actions.ts` (+ test), `solar-schedule-meta.actions.ts` (+ test), `solar-schedule-template.actions.ts` (+ test), `solar-schedule-import.actions.ts` (+ test)
- `apps/web/src/app/api/projects/[id]/solar/schedule/import/parse/route.ts`
- `apps/web/src/app/api/projects/[id]/solar/schedule/export/[format]/route.ts`

**Web — UI** (`…` = `apps/web/src/app/(admin)/projects/[id]/solar`)
- `…/(gated)/schedule/page.tsx`, `ScheduleClient.tsx`, `ScheduleToolbar.tsx`, `ScheduleRowList.tsx`, `GanttCanvas.tsx`, `TaskDialog.tsx`, `LinkDialog.tsx`, `BaselineMenu.tsx`, `FilterPopover.tsx`, `SettingsMenu.tsx`, `BulkBar.tsx`, `StatsPanel.tsx`, `WorkloadView.tsx`, `ImportDialog.tsx`, `ExportMenu.tsx`, `ShortcutsOverlay.tsx`, `TemplateStart.tsx` (+ tests for the DOM components; `GanttCanvas` is Konva and is exercised through a stub in `ScheduleClient.test.tsx`)
- `apps/web/src/lib/solar/schedule/inputs.ts`, `work-calendar.ts`, `template-editor.ts` (+ tests)
- `apps/web/src/app/(admin)/settings/solar/ScheduleTemplateEditor.tsx` (+ test)
- Modify `packages/shared/src/solar/readiness.ts`, `packages/shared/src/solar/activity.ts`, `…/_components/ActivityList.tsx`, `…/(gated)/layout.tsx`, `…/(gated)/overview/page.tsx`, `docs/rbac-matrix.md`.

---

### Task 0: Worktree, baseline, migration head

**Files:** none (records `/tmp/solar-5b-base.txt`)

- [ ] **Step 1: Create the worktree from `origin/feat/solar-phase-1c`**

```bash
git -C ~/.config/superpowers/worktrees/esite/solar-phase-1c fetch origin
git -C ~/.config/superpowers/worktrees/esite/solar-phase-1c worktree add \
  ~/.config/superpowers/worktrees/esite/solar-phase-5b -b feat/solar-phase-5b origin/feat/solar-phase-1c
cd ~/.config/superpowers/worktrees/esite/solar-phase-5b
pnpm install --frozen-lockfile
```
Expected: `Preparing worktree (new branch 'feat/solar-phase-5b')`, install completes.

- [ ] **Step 2: Record baseline suite counts**

```bash
{ echo "== shared"; pnpm --filter @esite/shared test 2>&1 | tail -4
  echo "== web";    pnpm --filter web test 2>&1 | tail -4
  echo "== db";     pnpm --filter @esite/db test:ci 2>&1 | tail -4; } > /tmp/solar-5b-base.txt
cat /tmp/solar-5b-base.txt
```
Expected: all three green. If any is red before you change anything, stop and report it — do not build on a red base.

- [ ] **Step 3: Record the migration head (informational — the number is claimed at APPLY time, Task 29)**

```bash
ls apps/edge-functions/supabase/migrations | tail -5 >> /tmp/solar-5b-base.txt
bash -c '. scripts/db/mgmt-api.sh && mgmt_query "SELECT max(version) AS head, bool_or(version = '"'"'00207'"'"') AS has_00207, bool_or(version = '"'"'00208'"'"') AS has_00208 FROM supabase_migrations.schema_migrations;"' >> /tmp/solar-5b-base.txt
gh pr list --state open --json number,headRefName,files --jq '.[] | select(any(.files[]; .path | test("migrations/002"))) | "\(.number) \(.headRefName) \([.files[].path | select(test("migrations/"))] | join(","))"' >> /tmp/solar-5b-base.txt
tail -12 /tmp/solar-5b-base.txt
```
Expected: `has_00207`/`has_00208` tell Task 11 whether to prepend 00207/00208 to the dry run. Note every open PR migration number ≥ `00209` (tariffs `00209`, and whatever 3a/4a claimed); `00212` is this phase's working name only.

No commit (nothing changed).

---

### Task 1: Calendar dates — `dates.ts` with the SAST round-trip test

**Files:**
- Create: `packages/shared/src/solar/schedule/dates.ts`
- Create: `packages/shared/src/solar/schedule/dates.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/schedule/dates.test.ts`:
```ts
// The time zone must be SAST BEFORE any Date is built in this file; the guard
// test below fails loudly if the runtime ignored it (a round-trip test that
// silently ran in UTC would prove nothing — UTC is exactly where WM's bug hides).
process.env.TZ = 'Africa/Johannesburg'

import { describe, it, expect } from 'vitest'
import {
  isCalendarDate, dayNumber, fromDayNumber, addCalendarDays, daysBetween, weekdayOf,
  sastToday, parseDateInput, formatCalendarDate, calendarDateFromUtc, mondayOf,
  minCalendarDate, maxCalendarDate,
} from './dates'

describe('the test really runs in SAST', () => {
  it('local offset is UTC+2', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-120)
  })
  it('reproduces WM Solar’s defect with WM’s own code path (proves the environment can fail)', () => {
    // WM: parse local midnight, write with toISOString() (as-is/06 B.3.1, PG:147-148)
    const wmSave = (s: string) => new Date(`${s}T00:00:00`).toISOString().split('T')[0]
    expect(wmSave('2026-10-01')).toBe('2026-09-30')
  })
})

describe('CalendarDate arithmetic never drifts', () => {
  it('every day of 2026–2028 round-trips through dayNumber unchanged', () => {
    let d = '2026-01-01'
    for (let i = 0; i < 366 * 3; i++) {
      expect(fromDayNumber(dayNumber(d))).toBe(d)
      d = addCalendarDays(d, 1)
    }
    expect(d).toBe('2029-01-01')
  })
  it('ten successive edit round trips keep the date (WM lost ten days)', () => {
    let d = '2026-10-01'
    for (let i = 0; i < 10; i++) d = fromDayNumber(dayNumber(parseDateInput(d)!))
    expect(d).toBe('2026-10-01')
  })
  it('adds and subtracts across month, year and leap boundaries', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7)
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7)
  })
  it('knows the weekday without a local Date', () => {
    expect(weekdayOf('2026-10-01')).toBe(4) // Thursday
    expect(weekdayOf('2026-09-21')).toBe(1) // Monday
    expect(weekdayOf('2026-08-09')).toBe(0) // Sunday
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
  })
})

describe('validation and formatting', () => {
  it('accepts only real ISO calendar dates', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-1-01')).toBe(false)
    expect(isCalendarDate('2026-10-01T00:00:00Z')).toBe(false)
    expect(isCalendarDate(20261001)).toBe(false)
    expect(() => dayNumber('nope')).toThrow('Not a calendar date')
  })
  it('parseDateInput trims and refuses junk', () => {
    expect(parseDateInput(' 2026-10-01 ')).toBe('2026-10-01')
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('01/10/2026')).toBeNull()
  })
  it('formats for people without a Date', () => {
    expect(formatCalendarDate('2026-10-01')).toBe('1 Oct 2026')
  })
  it('reads UTC components of a UTC-midnight Date (exceljs cells, holiday source)', () => {
    expect(calendarDateFromUtc(new Date(Date.UTC(2026, 8, 24)))).toBe('2026-09-24')
  })
  it('min / max of a list', () => {
    expect(minCalendarDate(['2026-10-05', '2026-09-30', '2026-10-01'])).toBe('2026-09-30')
    expect(maxCalendarDate(['2026-10-05', '2026-09-30'])).toBe('2026-10-05')
    expect(minCalendarDate([])).toBeNull()
  })
})

describe('sastToday', () => {
  it('23:30 UTC is already tomorrow in South Africa', () => {
    expect(sastToday(new Date('2026-09-28T23:30:00Z'))).toBe('2026-09-29')
  })
  it('21:59 UTC is still today', () => {
    expect(sastToday(new Date('2026-09-28T21:59:00Z'))).toBe('2026-09-28')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/dates.test.ts`
Expected: FAIL — `Failed to resolve import "./dates"`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/schedule/dates.ts`:
```ts
/**
 * Calendar dates for the Solar schedule (functional spec §14.3).
 *
 * A task date is a Postgres `date` and travels as the 'YYYY-MM-DD' string
 * PostgREST returns. It is NEVER turned into a local-time Date: arithmetic
 * runs on UTC day numbers. WM Solar parsed dates as local midnight and wrote
 * them back with toISOString() (UTC), which moved every edited task one day
 * EARLIER in SAST (docs/solar/as-is/06 B.3.1, defect B.7 D1). ISO strings also
 * sort lexically, so `a < b` compares two CalendarDates correctly.
 */
export type CalendarDate = string

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const pad = (n: number) => String(n).padStart(2, '0')

export function isCalendarDate(v: unknown): v is CalendarDate {
  if (typeof v !== 'string') return false
  const m = ISO.exec(v)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 1900 || y > 2999) return false
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** Days since 1970-01-01 (UTC). */
export function dayNumber(d: CalendarDate): number {
  if (!isCalendarDate(d)) throw new Error(`Not a calendar date: ${String(d)}`)
  const m = ISO.exec(d) as RegExpExecArray
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY)
}

export function fromDayNumber(n: number): CalendarDate {
  const t = new Date(n * MS_PER_DAY)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** A Date that represents a UTC midnight (exceljs date cells, the holiday source) → its calendar date. */
export function calendarDateFromUtc(d: Date): CalendarDate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addCalendarDays(d: CalendarDate, n: number): CalendarDate {
  return fromDayNumber(dayNumber(d) + n)
}

/** `to − from` in calendar days. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return dayNumber(to) - dayNumber(from)
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(d: CalendarDate): number {
  return (((dayNumber(d) + 4) % 7) + 7) % 7
}

/** The Monday on or before `d` (ISO week start). */
export function mondayOf(d: CalendarDate): CalendarDate {
  return addCalendarDays(d, -((weekdayOf(d) + 6) % 7))
}

export function minCalendarDate(ds: readonly CalendarDate[]): CalendarDate | null {
  return ds.length === 0 ? null : ds.reduce((m, d) => (d < m ? d : m))
}

export function maxCalendarDate(ds: readonly CalendarDate[]): CalendarDate | null {
  return ds.length === 0 ? null : ds.reduce((m, d) => (d > m ? d : m))
}

const SAST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Today's calendar date in South Africa, whatever the server's or browser's zone. */
export function sastToday(now: Date = new Date()): CalendarDate {
  const p = Object.fromEntries(SAST.formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** An `<input type="date">` value (already 'YYYY-MM-DD') → CalendarDate, or null. */
export function parseDateInput(v: string): CalendarDate | null {
  const s = v.trim()
  return isCalendarDate(s) ? s : null
}

/** '2026-10-01' → '1 Oct 2026'. */
export function formatCalendarDate(d: CalendarDate): string {
  const [y, m, day] = d.split('-').map(Number)
  return `${day} ${MONTHS[m - 1]} ${y}`
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/dates.test.ts`
Expected: PASS (15 tests). If the first guard test fails (`getTimezoneOffset()` is 0), the runtime ignored the in-file `process.env.TZ`: add `env: { TZ: 'Africa/Johannesburg' }` under `test:` in `packages/shared/vitest.config.ts` and re-run — never delete the guard.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/schedule/dates.ts packages/shared/src/solar/schedule/dates.test.ts
git commit -m "feat(solar-schedule): calendar dates on UTC day numbers, SAST round-trip test

The test reproduces WM Solar's -1 day drift with WM's own code path in
Africa/Johannesburg, then proves ours does not drift over three years of days.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Working-day calendar with SA public holidays — `calendar.ts`

**Files:**
- Create: `packages/shared/src/solar/schedule/calendar.ts`
- Create: `packages/shared/src/solar/schedule/calendar.test.ts`

The holiday source is the existing statutory function `listHolidaysNamed()` (`packages/shared/src/lib/jbcc/sa-public-holidays.ts:54`), which `projects.public_holidays` materialises (00194) — so the Gantt shades exactly the days the work-item due-date trigger skips. It returns UTC-midnight `Date`s, read with `calendarDateFromUtc`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/schedule/calendar.test.ts`:
```ts
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import {
  saHolidaySet, makeWorkCalendar, isWeekendDate, isWorkingDate, spanDays, endForDuration,
  shiftDate, signedShift, nextWorkingDate,
} from './calendar'

const hol = saHolidaySet(2026, 2027)
const working = makeWorkCalendar('working', hol)
const calendar = makeWorkCalendar('calendar', hol)

describe('saHolidaySet', () => {
  it('holds the statutory 2026 days, incl. Easter and the Sunday rule', () => {
    expect(hol.has('2026-09-24')).toBe(true) // Heritage Day (Thursday)
    expect(hol.has('2026-04-03')).toBe(true) // Good Friday
    expect(hol.has('2026-04-06')).toBe(true) // Family Day
    expect(hol.has('2026-08-10')).toBe(true) // Women's Day (Sun 9 Aug) observed Monday
    expect(hol.has('2026-09-25')).toBe(false)
  })
})

describe('working-day checks', () => {
  it('weekends and holidays are non-working only in working mode', () => {
    expect(isWeekendDate('2026-09-26')).toBe(true)
    expect(isWorkingDate(working, '2026-09-26')).toBe(false)
    expect(isWorkingDate(working, '2026-09-24')).toBe(false)
    expect(isWorkingDate(working, '2026-09-25')).toBe(true)
    expect(isWorkingDate(calendar, '2026-09-26')).toBe(true)
    expect(nextWorkingDate(working, '2026-09-26')).toBe('2026-09-28')
  })
})

describe('spanDays (inclusive)', () => {
  it('counts working days across Heritage Day', () => {
    expect(spanDays(working, '2026-09-21', '2026-09-25')).toBe(4)
    expect(spanDays(calendar, '2026-09-21', '2026-09-25')).toBe(5)
  })
  it('a same-day task is one day; an inverted span is zero', () => {
    expect(spanDays(calendar, '2026-10-01', '2026-10-01')).toBe(1)
    expect(spanDays(working, '2026-10-02', '2026-10-01')).toBe(0)
  })
})

describe('endForDuration', () => {
  it('working: 3 days from Wed 23 Sep skip Heritage Day and the weekend', () => {
    expect(endForDuration(working, '2026-09-23', 3)).toBe('2026-09-28')
    expect(endForDuration(calendar, '2026-09-23', 3)).toBe('2026-09-25')
  })
  it('working: a start on Saturday begins on Monday', () => {
    expect(endForDuration(working, '2026-09-26', 1)).toBe('2026-09-28')
  })
  it('refuses a duration below one day', () => {
    expect(() => endForDuration(working, '2026-09-23', 0)).toThrow('at least 1')
  })
})

describe('shiftDate and signedShift', () => {
  it('working shifts step over weekends and holidays in both directions', () => {
    expect(shiftDate(working, '2026-09-25', 1)).toBe('2026-09-28')
    expect(shiftDate(working, '2026-09-28', -1)).toBe('2026-09-25')
    expect(shiftDate(working, '2026-09-25', -1)).toBe('2026-09-23')
    expect(shiftDate(calendar, '2026-09-25', 3)).toBe('2026-09-28')
  })
  it('signedShift measures slip in the calendar’s units', () => {
    expect(signedShift(working, '2026-09-23', '2026-09-28')).toBe(2)
    expect(signedShift(working, '2026-09-28', '2026-09-23')).toBe(-2)
    expect(signedShift(calendar, '2026-09-23', '2026-09-28')).toBe(5)
    expect(signedShift(calendar, '2026-09-23', '2026-09-23')).toBe(0)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/calendar.test.ts`
Expected: FAIL — cannot resolve `./calendar`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/schedule/calendar.ts`:
```ts
/**
 * Working-day calendar for the Solar schedule (spec §14.3 "optional working
 * days only duration mode"). `calendar` mode counts every day; `working` mode
 * counts Monday–Friday excluding SA public holidays. Holidays come from the
 * statutory source `listHolidaysNamed()` that projects.public_holidays (00194)
 * materialises, so the Gantt skips the same days the work-item due-date
 * trigger does. WM Solar had no working days and no holidays (as-is/06 B.3.1).
 */
import { listHolidaysNamed } from '../../lib/jbcc/sa-public-holidays'
import { addCalendarDays, calendarDateFromUtc, daysBetween, weekdayOf, type CalendarDate } from './dates'

export const DURATION_MODES = ['calendar', 'working'] as const
export type DurationMode = (typeof DURATION_MODES)[number]

export interface WorkCalendar {
  readonly mode: DurationMode
  readonly holidays: ReadonlySet<CalendarDate>
}

const LIMIT = 40_000 // ~110 years of days; a loop that runs longer is a bug

export function saHolidaySet(fromYear: number, toYear: number): Set<CalendarDate> {
  const out = new Set<CalendarDate>()
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of listHolidaysNamed(y)) out.add(calendarDateFromUtc(h.date))
  }
  return out
}

export function makeWorkCalendar(mode: DurationMode, holidays: ReadonlySet<CalendarDate> = new Set()): WorkCalendar {
  return { mode, holidays }
}

export function isWeekendDate(d: CalendarDate): boolean {
  const w = weekdayOf(d)
  return w === 0 || w === 6
}

export function isWorkingDate(cal: WorkCalendar, d: CalendarDate): boolean {
  return cal.mode === 'calendar' || (!isWeekendDate(d) && !cal.holidays.has(d))
}

export function nextWorkingDate(cal: WorkCalendar, d: CalendarDate): CalendarDate {
  let c = d
  for (let i = 0; i < LIMIT; i++) {
    if (isWorkingDate(cal, c)) return c
    c = addCalendarDays(c, 1)
  }
  throw new Error('No working day found')
}

/** Inclusive length of start..end in the calendar's units (0 when end < start). */
export function spanDays(cal: WorkCalendar, start: CalendarDate, end: CalendarDate): number {
  if (end < start) return 0
  if (cal.mode === 'calendar') return daysBetween(start, end) + 1
  let n = 0
  for (let c = start; c <= end; c = addCalendarDays(c, 1)) if (isWorkingDate(cal, c)) n++
  return n
}

/** The inclusive end date of a task of `days` units starting at `start`. */
export function endForDuration(cal: WorkCalendar, start: CalendarDate, days: number): CalendarDate {
  if (!Number.isInteger(days) || days < 1) throw new Error('A duration is a whole number of days, at least 1')
  if (cal.mode === 'calendar') return addCalendarDays(start, days - 1)
  let c = nextWorkingDate(cal, start)
  let left = days - 1
  while (left > 0) {
    c = addCalendarDays(c, 1)
    if (isWorkingDate(cal, c)) left--
  }
  return c
}

/** Move `d` by `n` units (negative = earlier). Working mode lands on working days. */
export function shiftDate(cal: WorkCalendar, d: CalendarDate, n: number): CalendarDate {
  if (cal.mode === 'calendar' || n === 0) return addCalendarDays(d, n)
  const step = n > 0 ? 1 : -1
  let left = Math.abs(n)
  let c = d
  while (left > 0) {
    c = addCalendarDays(c, step)
    if (isWorkingDate(cal, c)) left--
  }
  return c
}

/** Signed distance from `from` to `to` in the calendar's units (positive = later = slip). */
export function signedShift(cal: WorkCalendar, from: CalendarDate, to: CalendarDate): number {
  if (from === to) return 0
  if (cal.mode === 'calendar') return daysBetween(from, to)
  const later = to > from
  const lo = later ? from : to
  const hi = later ? to : from
  let n = 0
  for (let c = addCalendarDays(lo, 1); c <= hi; c = addCalendarDays(c, 1)) if (isWorkingDate(cal, c)) n++
  return later ? n : -n
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/calendar.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/schedule/calendar.ts packages/shared/src/solar/schedule/calendar.test.ts
git commit -m "feat(solar-schedule): working-day calendar on the statutory SA holiday source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dependency graph and critical path — `graph.ts`, `cpm.ts`

**Files:**
- Create: `packages/shared/src/solar/schedule/graph.ts`
- Create: `packages/shared/src/solar/schedule/cpm.ts`
- Create: `packages/shared/src/solar/schedule/cpm.test.ts`

**Model (write it into the `cpm.ts` header, it is the contract the tests pin).** Tasks keep their PLANNED dates (this Gantt is manually scheduled). Units are days since the earliest start (calendar mode) or working days before the date since the earliest start (working mode). `S = unit(start)`, `d = spanDays(start, end)` (0 for a milestone), `F = S + d` (exclusive). Backward pass in reverse topological order: `LF(p) = min(projectFinish, bound over every outgoing link)`, where for a link `p → s` with lag `L`:

| Type | Constraint | Bound on `LF(p)` |
|---|---|---|
| FS | `S_s ≥ F_p + L` | `LS_s − L` |
| SS | `S_s ≥ S_p + L` | `LS_s − L + d_p` |
| FF | `F_s ≥ F_p + L` | `LF_s − L` |
| SF | `F_s ≥ S_p + L` | `LF_s − L + d_p` |

`LS = LF − d`, total float `= LS − S`; critical ⇔ float ≤ 0 (negative float = the plan already violates a link, also listed in `violations`). Computed on **all** tasks whatever the filters (spec §14.2). WM treated every link as FS without lag, ignored real dates (all independent tasks started at 0, so only the *longest* task was critical) and returned `[]` silently on a cycle (as-is/06 B.3.2).

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/schedule/cpm.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { criticalPath, type CpmTask } from './cpm'
import { findCycle, linkWouldCycle, topoOrder, linkKey, type ScheduleLink } from './graph'
import { makeWorkCalendar, saHolidaySet } from './calendar'

const cal = makeWorkCalendar('calendar')
const wcal = makeWorkCalendar('working', saHolidaySet(2026, 2026))
const t = (id: string, start: string, end: string, isMilestone = false): CpmTask => ({ id, start, end, isMilestone })
const link = (p: string, s: string, type: ScheduleLink['type'] = 'FS', lagDays = 0): ScheduleLink =>
  ({ predecessorId: p, successorId: s, type, lagDays })

function ok(r: ReturnType<typeof criticalPath>) {
  if (!r.ok) throw new Error(`unexpected cycle ${r.cycle.join(',')}`)
  return r
}

describe('graph', () => {
  it('orders predecessors first and ignores links to unknown tasks', () => {
    const r = topoOrder(['a', 'b', 'c'], [link('b', 'c'), link('a', 'b'), link('x', 'a')])
    expect(r).toEqual({ ok: true, order: ['a', 'b', 'c'] })
  })
  it('names the tasks in a loop', () => {
    const c = findCycle(['a', 'b', 'c'], [link('a', 'b'), link('b', 'c'), link('c', 'a')])
    expect(new Set(c)).toEqual(new Set(['a', 'b', 'c']))
    expect(findCycle(['a', 'b'], [link('a', 'b')])).toBeNull()
  })
  it('refuses a self link and a closing link before it is saved', () => {
    expect(linkWouldCycle(['a'], [], link('a', 'a'))).toBe(true)
    expect(linkWouldCycle(['a', 'b'], [link('a', 'b')], link('b', 'a'))).toBe(true)
    expect(linkWouldCycle(['a', 'b', 'c'], [link('a', 'b')], link('a', 'c'))).toBe(false)
  })
})

describe('criticalPath — no links', () => {
  it('marks every task that finishes on the programme end, not just the longest (WM’s bug)', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-10'), t('B', '2026-10-01', '2026-10-20'), t('C', '2026-10-15', '2026-10-20')], [], cal))
    expect(r.critical).toEqual(new Set(['B', 'C']))
    expect(r.totalFloat.get('A')).toBe(10)
    expect(r.lengthDays).toBe(20)
  })
  it('an empty schedule has no critical path and length 0', () => {
    const r = ok(criticalPath([], [], cal))
    expect(r.critical.size).toBe(0)
    expect(r.lengthDays).toBe(0)
  })
})

describe('criticalPath — FS with lag', () => {
  const tasks = [t('A', '2026-10-01', '2026-10-05'), t('B', '2026-10-08', '2026-10-10')]
  it('lag 2 makes the gap tight, so A is critical (WM ignored lag and said it was not)', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B', 'FS', 2)], cal))
    expect(r.critical).toEqual(new Set(['A', 'B']))
    expect(r.criticalLinks).toEqual(new Set([linkKey(link('A', 'B'))]))
    expect(r.violations).toEqual([])
  })
  it('lag 1 leaves A one day of float', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B', 'FS', 1)], cal))
    expect(r.totalFloat.get('A')).toBe(1)
    expect(r.critical.has('A')).toBe(false)
  })
})

describe('criticalPath — SS, FF, SF', () => {
  it('SS lag 2: A drives B’s start', () => {
    const tasks = [t('A', '2026-10-01', '2026-10-03'), t('B', '2026-10-03', '2026-10-10')]
    expect(ok(criticalPath(tasks, [link('A', 'B', 'SS', 2)], cal)).totalFloat.get('A')).toBe(0)
    expect(ok(criticalPath(tasks, [link('A', 'B', 'SS', 1)], cal)).totalFloat.get('A')).toBe(1)
    // Read as FS (WM): B would start before A finished — a violation that SS does not have.
    expect(ok(criticalPath(tasks, [link('A', 'B', 'FS', 0)], cal)).violations).toHaveLength(1)
  })
  it('FF lag 2: A must finish 2 days before B finishes', () => {
    const tasks = [t('A', '2026-10-01', '2026-10-05'), t('B', '2026-10-02', '2026-10-07')]
    expect(ok(criticalPath(tasks, [link('A', 'B', 'FF', 2)], cal)).totalFloat.get('A')).toBe(0)
    expect(ok(criticalPath(tasks, [link('A', 'B', 'FF', 0)], cal)).totalFloat.get('A')).toBe(2)
  })
  it('SF lag 3: B cannot finish until 3 days after A starts', () => {
    const tasks = [t('A', '2026-10-03', '2026-10-04'), t('B', '2026-10-01', '2026-10-05')]
    const r = ok(criticalPath(tasks, [link('A', 'B', 'SF', 3)], cal))
    expect(r.totalFloat.get('A')).toBe(0)
    expect(r.violations).toEqual([])
    expect(ok(criticalPath(tasks, [link('A', 'B', 'SF', 2)], cal)).totalFloat.get('A')).toBe(1)
  })
})

describe('criticalPath — working days and holidays', () => {
  const tasks = [t('A', '2026-09-21', '2026-09-23'), t('B', '2026-09-25', '2026-09-25')]
  it('Heritage Day (Thu 24 Sep) closes the gap in working mode', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B')], wcal))
    expect(r.critical).toEqual(new Set(['A', 'B']))
    expect(r.lengthDays).toBe(4)
  })
  it('in calendar mode the holiday is a day of float', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B')], cal))
    expect(r.totalFloat.get('A')).toBe(1)
    expect(r.lengthDays).toBe(5)
  })
  it('a weekend gap is tight in working mode', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-02'), t('B', '2026-10-05', '2026-10-06')], [link('A', 'B')], wcal))
    expect(r.critical).toEqual(new Set(['A', 'B']))
  })
})

describe('criticalPath — milestones, violations, cycles', () => {
  it('a milestone the day after its predecessor ends is tight', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-09'), t('M', '2026-10-10', '2026-10-10', true)], [link('A', 'M')], cal))
    expect(r.critical).toEqual(new Set(['A', 'M']))
  })
  it('a plan that breaks a link has negative float and a listed violation', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-05'), t('B', '2026-10-03', '2026-10-06')], [link('A', 'B')], cal))
    expect(r.totalFloat.get('A')).toBe(-3)
    expect(r.critical.has('A')).toBe(true)
    expect(r.violations).toEqual([{ link: link('A', 'B'), shortByDays: 3 }])
  })
  it('reports a loop instead of silently returning nothing (WM)', () => {
    const r = criticalPath([t('A', '2026-10-01', '2026-10-02'), t('B', '2026-10-03', '2026-10-04')], [link('A', 'B'), link('B', 'A')], cal)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(new Set(r.cycle)).toEqual(new Set(['A', 'B']))
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/cpm.test.ts`
Expected: FAIL — cannot resolve `./cpm`.

- [ ] **Step 3: Implement `graph.ts`**

`packages/shared/src/solar/schedule/graph.ts`:
```ts
/** Dependency links between schedule tasks (spec §14.2): four types with lag days. */
export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const
export type LinkType = (typeof LINK_TYPES)[number]
export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish', SF: 'Start to finish',
}

export interface ScheduleLink {
  readonly predecessorId: string
  readonly successorId: string
  readonly type: LinkType
  /** Whole days, in the schedule's duration mode; negative = lead. */
  readonly lagDays: number
}

export const isLinkType = (v: unknown): v is LinkType => (LINK_TYPES as readonly unknown[]).includes(v)
export const linkKey = (l: Pick<ScheduleLink, 'predecessorId' | 'successorId'>): string => `${l.predecessorId}>${l.successorId}`

export type TopoResult = { ok: true; order: string[] } | { ok: false; cycle: string[] }

/** Kahn's algorithm. Links whose ends are not both in `ids` are ignored. */
export function topoOrder(ids: readonly string[], links: readonly ScheduleLink[]): TopoResult {
  const known = new Set(ids)
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]))
  const pred = new Map<string, string[]>(ids.map((id) => [id, []]))
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const l of links) {
    if (!known.has(l.predecessorId) || !known.has(l.successorId)) continue
    succ.get(l.predecessorId)!.push(l.successorId)
    pred.get(l.successorId)!.push(l.predecessorId)
    indeg.set(l.successorId, indeg.get(l.successorId)! + 1)
  }
  const queue = ids.filter((id) => indeg.get(id) === 0)
  const done = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    done.add(id)
    for (const s of succ.get(id)!) {
      const n = indeg.get(s)! - 1
      indeg.set(s, n)
      if (n === 0) queue.push(s)
    }
  }
  if (queue.length === ids.length) return { ok: true, order: queue }
  // Every task left over has a predecessor that is also left over: walk back until one repeats.
  const left = new Set(ids.filter((id) => !done.has(id)))
  let cur = [...left][0]
  const seen: string[] = []
  while (!seen.includes(cur)) {
    seen.push(cur)
    cur = pred.get(cur)!.find((p) => left.has(p)) as string
  }
  return { ok: false, cycle: seen.slice(seen.indexOf(cur)).reverse() }
}

export function findCycle(ids: readonly string[], links: readonly ScheduleLink[]): string[] | null {
  const r = topoOrder(ids, links)
  return r.ok ? null : r.cycle
}

/** Would adding `candidate` create a loop (or a self link)? */
export function linkWouldCycle(ids: readonly string[], links: readonly ScheduleLink[], candidate: ScheduleLink): boolean {
  if (candidate.predecessorId === candidate.successorId) return true
  return findCycle(ids, [...links, candidate]) !== null
}
```

- [ ] **Step 4: Implement `cpm.ts`**

`packages/shared/src/solar/schedule/cpm.ts`:
```ts
/**
 * Critical path for the Solar schedule (spec §14.2): all four link types and
 * lag, on the tasks' PLANNED dates, on ALL tasks regardless of filters.
 *
 * Units: calendar mode = days since the earliest start; working mode = working
 * days before the date since the earliest start (a non-working date shares the
 * unit of the next working day). S = unit(start); d = spanDays (0 for a
 * milestone); F = S + d (exclusive). Backward pass in reverse topological order:
 *   LF(p) = min(projectFinish, bound per outgoing link p→s, lag L)
 *     FS: LS_s − L        SS: LS_s − L + d_p
 *     FF: LF_s − L        SF: LF_s − L + d_p
 * LS = LF − d; total float = LS − S; critical ⇔ float ≤ 0. Negative float means
 * the plan breaks a link; each such link is listed in `violations`.
 */
import { addCalendarDays, daysBetween, type CalendarDate } from './dates'
import { isWorkingDate, spanDays, type WorkCalendar } from './calendar'
import { linkKey, topoOrder, type ScheduleLink } from './graph'

export interface CpmTask {
  readonly id: string
  readonly start: CalendarDate
  readonly end: CalendarDate
  readonly isMilestone: boolean
}

export interface LinkViolation {
  readonly link: ScheduleLink
  readonly shortByDays: number
}

export type CpmResult =
  | {
      ok: true
      critical: ReadonlySet<string>
      criticalLinks: ReadonlySet<string>
      totalFloat: ReadonlyMap<string, number>
      /** Programme length on the critical path, in the calendar's units. */
      lengthDays: number
      violations: LinkViolation[]
    }
  | { ok: false; cycle: string[] }

function unitScale(cal: WorkCalendar, anchor: CalendarDate): (d: CalendarDate) => number {
  if (cal.mode === 'calendar') return (d) => daysBetween(anchor, d)
  const cum: number[] = [0] // cum[i] = working days in [anchor, anchor + i)
  return (d) => {
    const i = daysBetween(anchor, d)
    while (cum.length <= i) {
      const k = cum.length - 1
      cum.push(cum[k] + (isWorkingDate(cal, addCalendarDays(anchor, k)) ? 1 : 0))
    }
    return cum[i]
  }
}

export function criticalPath(tasks: readonly CpmTask[], links: readonly ScheduleLink[], cal: WorkCalendar): CpmResult {
  if (tasks.length === 0) {
    return { ok: true, critical: new Set(), criticalLinks: new Set(), totalFloat: new Map(), lengthDays: 0, violations: [] }
  }
  const ids = tasks.map((t) => t.id)
  const topo = topoOrder(ids, links)
  if (!topo.ok) return { ok: false, cycle: topo.cycle }

  const byId = new Map(tasks.map((t) => [t.id, t]))
  const anchor = tasks.reduce((m, t) => (t.start < m ? t.start : m), tasks[0].start)
  const unit = unitScale(cal, anchor)
  const dur = new Map<string, number>()
  const S = new Map<string, number>()
  const F = new Map<string, number>()
  for (const t of tasks) {
    const d = t.isMilestone ? 0 : spanDays(cal, t.start, t.end)
    dur.set(t.id, d)
    S.set(t.id, unit(t.start))
    F.set(t.id, unit(t.start) + d)
  }
  const projectFinish = Math.max(...F.values())
  const projectStart = Math.min(...S.values())

  const live = links.filter((l) => byId.has(l.predecessorId) && byId.has(l.successorId))
  const outgoing = new Map<string, ScheduleLink[]>(ids.map((id) => [id, []]))
  for (const l of live) outgoing.get(l.predecessorId)!.push(l)

  const LF = new Map<string, number>()
  const LS = new Map<string, number>()
  for (const id of [...topo.order].reverse()) {
    const d = dur.get(id)!
    let lf = projectFinish
    for (const l of outgoing.get(id)!) {
      const s = l.successorId
      const bound =
        l.type === 'FS' ? LS.get(s)! - l.lagDays
          : l.type === 'SS' ? LS.get(s)! - l.lagDays + d
            : l.type === 'FF' ? LF.get(s)! - l.lagDays
              : LF.get(s)! - l.lagDays + d
      if (bound < lf) lf = bound
    }
    LF.set(id, lf)
    LS.set(id, lf - d)
  }

  const totalFloat = new Map(ids.map((id) => [id, LS.get(id)! - S.get(id)!]))
  const critical = new Set(ids.filter((id) => totalFloat.get(id)! <= 0))
  const violations: LinkViolation[] = []
  const criticalLinks = new Set<string>()
  for (const l of live) {
    const p = l.predecessorId
    const s = l.successorId
    const slack =
      l.type === 'FS' ? S.get(s)! - (F.get(p)! + l.lagDays)
        : l.type === 'SS' ? S.get(s)! - (S.get(p)! + l.lagDays)
          : l.type === 'FF' ? F.get(s)! - (F.get(p)! + l.lagDays)
            : F.get(s)! - (S.get(p)! + l.lagDays)
    if (slack < 0) violations.push({ link: l, shortByDays: -slack })
    if (slack <= 0 && critical.has(p) && critical.has(s)) criticalLinks.add(linkKey(l))
  }
  return { ok: true, critical, criticalLinks, totalFloat, lengthDays: projectFinish - projectStart, violations }
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/cpm.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 6: Mutation check (prove the lag tests can fail)**

Temporarily change `LS.get(s)! - l.lagDays` in the FS arm to `LS.get(s)!`. Re-run: the two "FS with lag" tests FAIL. Revert; re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/solar/schedule/graph.ts packages/shared/src/solar/schedule/cpm.ts packages/shared/src/solar/schedule/cpm.test.ts
git commit -m "feat(solar-schedule): critical path with FS/SS/FF/SF and lag on planned dates

Replaces WM Solar's FS-only, lag-free, date-blind CPM; cycles are reported,
not swallowed. Mutation-checked on the FS lag arm.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Continue with Part 2 (`2026-09-28-solar-phase-5b-schedule-2-model-import.md`).
