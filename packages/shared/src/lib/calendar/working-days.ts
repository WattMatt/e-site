// packages/shared/src/lib/calendar/working-days.ts
//
// The TypeScript mirror of projects.working_days_between (Appendix A(h)).
//
// ⚠ This is NOT the JBCC helper. lib/jbcc/working-days.ts keeps a FIXED
// statutory calendar — Mon-Fri minus SA public holidays — and never reads
// project_settings, because JBCC defines "working day" in the contract, not in
// a project preference. Do not merge the two.
//
// `calendar` is a REQUIRED field, never defaulted, for the same reason the SQL
// function has no DEFAULT on p_calendar: the chase ladder uses 'site' and
// metric 4 uses 'office', they are written weeks apart, and a silent default
// produces a one-day drift in the direction that makes a contractor look late.
//
// The shutdown push lives in the due-date rule (addWorkingDays), never in the
// count: projects.working_days_between in migration 00194 has no shutdown arm,
// by design (A(h)) — the count must not skip a window it never entered — and
// the two must stay in step.

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000   // UTC+2, no DST
const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface CalendarInput {
  /** ISO day-of-week numbers, 1 = Monday … 7 = Sunday. projects.project_settings.working_days. */
  workingDays: number[]
  /** projects.project_settings.extra_holidays, as 'YYYY-MM-DD'. */
  extraHolidays: string[]
  calendar: 'office' | 'site'
  /** Seeded projects.public_holidays dates, as 'YYYY-MM-DD'. */
  holidays: Set<string>
  /** Years present in projects.calendar_years. */
  seededYears: Set<number>
  /** Per-project December shutdown window, inclusive, as 'YYYY-MM-DD'. */
  shutdown?: { from: string; to: string }
}

export interface ProjectCalendar extends CalendarInput {
  /** The resolved working-day set after the office/site rule is applied. */
  readonly effectiveDays: ReadonlySet<number>
}

export function buildCalendar(input: CalendarInput): ProjectCalendar {
  const days = new Set(input.workingDays)
  // site = office plus Saturday where Saturday is absent. SA sites work
  // Saturdays, which is also why the recap fires `0 5 * * 1-6`.
  if (input.calendar === 'site' && !days.has(6)) days.add(6)
  return { ...input, effectiveDays: days }
}

/** The local (SAST) calendar date of an instant, as 'YYYY-MM-DD'. */
export function sastDate(d: Date): string {
  return new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10)
}

/** ISO day-of-week, 1 = Monday … 7 = Sunday, in SAST. */
function sastIsoDow(ymd: string): number {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function assertSeeded(ymd: string, cal: ProjectCalendar): void {
  const year = Number(ymd.slice(0, 4))
  if (!cal.seededYears.has(year)) {
    throw new Error(`working-days: ${year} is not seeded in calendar_years — refusing to fall back to calendar days`)
  }
}

/** The base predicate — effective day-of-week, public holiday, extra holiday. Mirrors the SQL exactly. */
function isWorkingDay(ymd: string, cal: ProjectCalendar): boolean {
  if (!cal.effectiveDays.has(sastIsoDow(ymd))) return false
  if (cal.holidays.has(ymd)) return false
  if (cal.extraHolidays.includes(ymd)) return false
  return true
}

/** Inside the per-project shutdown window. Applied by the due-date rule ONLY, never by the count. */
function inShutdown(ymd: string, cal: ProjectCalendar): boolean {
  return cal.shutdown !== undefined && ymd >= cal.shutdown.from && ymd <= cal.shutdown.to
}

function nextDay(ymd: string): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * Working days from `from` (exclusive) to `to` (inclusive), both evaluated in
 * Africa/Johannesburg. Raises on any year in the span with no calendar_years
 * row — a silent one-day drift changes whether an item escalates.
 */
export function workingDaysBetween(from: Date, to: Date, cal: ProjectCalendar): number {
  let cursor = sastDate(from)
  const end = sastDate(to)
  assertSeeded(cursor, cal)
  assertSeeded(end, cal)
  if (end <= cursor) return 0

  let count = 0
  while (cursor < end) {
    cursor = nextDay(cursor)
    assertSeeded(cursor, cal)
    if (isWorkingDay(cursor, cal)) count += 1
  }
  return count
}

/**
 * The instant `n` working days after `from`, skipping the shutdown window —
 * this is the due-date rule, and the only place the shutdown applies.
 *
 * Returns UTC midnight of the landing day (02:00 SAST, not local midnight).
 * Take the date with sastDate() or .toISOString().slice(0, 10); do not read
 * local-time fields off it.
 */
export function addWorkingDays(from: Date, n: number, cal: ProjectCalendar): Date {
  let cursor = sastDate(from)
  assertSeeded(cursor, cal)
  let remaining = n
  while (remaining > 0) {
    cursor = nextDay(cursor)
    assertSeeded(cursor, cal)
    if (isWorkingDay(cursor, cal) && !inShutdown(cursor, cal)) remaining -= 1
  }
  return new Date(`${cursor}T00:00:00Z`)
}
