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
// the two must stay in step. The push itself mirrors
// projects.push_past_builders_shutdown() (00196 §5): the walk counts every
// working day, window included, exactly as projects.add_working_days() does;
// only a LANDING date inside the window moves, to the first SITE working day
// strictly after it — site whatever the item's own calendar is, because the
// push is about who is back on site, not about who is counting.

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

/**
 * The base predicate — day-of-week, public holiday, extra holiday. Mirrors the
 * SQL exactly. `days` defaults to the calendar's own effective set; the
 * shutdown push passes the SITE set instead.
 */
function isWorkingDay(ymd: string, cal: ProjectCalendar, days: ReadonlySet<number> = cal.effectiveDays): boolean {
  if (!days.has(sastIsoDow(ymd))) return false
  if (cal.holidays.has(ymd)) return false
  if (cal.extraHolidays.includes(ymd)) return false
  return true
}

/** Inside the per-project shutdown window, inclusive at both ends (the SQL's BETWEEN). Read by the due-date rule ONLY, never by the count. */
function inShutdown(ymd: string, cal: ProjectCalendar): boolean {
  return cal.shutdown !== undefined && ymd >= cal.shutdown.from && ymd <= cal.shutdown.to
}

/**
 * Mirrors projects.push_past_builders_shutdown()'s return arm,
 * `add_working_days(band_end, 1, 'site')`: the first working day STRICTLY after
 * `to` on the SITE calendar — Saturday added whatever `cal.calendar` says, so an
 * office-calendar RFI landing in the window is pushed to the Saturday the site
 * reopens on, not the Monday after it.
 */
function firstSiteWorkingDayAfter(to: string, cal: ProjectCalendar): string {
  const siteDays = new Set(cal.effectiveDays)
  siteDays.add(6)
  let cursor = to
  do {
    cursor = nextDay(cursor)
    assertSeeded(cursor, cal)
  } while (!isWorkingDay(cursor, cal, siteDays))
  return cursor
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
 * The instant `n` working days after `from` — the due-date rule, and the only
 * place the shutdown applies. The walk counts every working day INCLUDING
 * those inside the shutdown window (parity with projects.add_working_days,
 * which knows nothing about the window); only a LANDING date inside the window
 * moves, to the first site working day after it (parity with
 * projects.push_past_builders_shutdown). Skipping the window while counting
 * would land a week or more later than the database does.
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
    if (isWorkingDay(cursor, cal)) remaining -= 1
  }
  if (cal.shutdown !== undefined && inShutdown(cursor, cal)) {
    cursor = firstSiteWorkingDayAfter(cal.shutdown.to, cal)
  }
  return new Date(`${cursor}T00:00:00Z`)
}
