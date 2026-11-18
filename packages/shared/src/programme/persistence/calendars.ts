/**
 * TypeScript mirror of the calendar seeding in `programme.create_programme`
 * (migration 00261, section 2). Used by tests and by P3's "new calendar"
 * button. Mirrors the SQL exactly:
 *
 *  - Office = project working_days; Site = working_days plus Saturday (6).
 *  - Both carry public holidays and the project's extra_holidays as
 *    `non_work` exceptions; a public holiday's name wins over the other labels
 *    for the same day.
 *  - The builders' shutdown ('MM-DD' window, may wrap the year end) is a SITE
 *    closure only, labelled "Builders' shutdown".
 *  - Window: project_start - 1 year .. project_start + 5 years (month-end
 *    clamped). `coverage` is that window clipped to the seeded holiday years
 *    (`seededYears`, projects.calendar_years), or null when none overlaps, so
 *    the engine can tell an unseeded year from a year with no holidays.
 *  - hours_per_day 8.
 */
import type { CalendarDate } from '../../lib/dates/calendar-date'
import { dayNumber, fromDayNumber, isCalendarDate } from '../../lib/dates/calendar-date'
import { ProgrammeOpError } from './errors'
import { addYears } from './rows'

export interface ProjectCalendarSettings {
  projectStart: CalendarDate
  /** ISO weekdays, 1 = Monday .. 7 = Sunday (projects.project_settings.working_days). */
  workingDays: number[]
  extraHolidays: CalendarDate[]
  /** builders_holiday + builders_shutdown_start_md / _end_md. */
  shutdown: { enabled: boolean; startMd: string; endMd: string }
  /** Years present in projects.calendar_years. */
  seededYears: number[]
}
export interface PublicHoliday { day: CalendarDate; name: string }

export interface SeededCalendar {
  name: 'Site' | 'Office'
  variant: 'site' | 'office'
  workWeekdays: number[]
  hoursPerDay: number
  coverage: { from: CalendarDate; to: CalendarDate } | null
  exceptions: Array<{ day: CalendarDate; kind: 'non_work'; label: string }>
}

/** The project_settings column defaults, used when the project has no settings row. */
export const DEFAULT_SHUTDOWN = { enabled: true, startMd: '12-15', endMd: '01-15' } as const

const MD = /^(\d{2})-(\d{2})$/

export function calendarSeedsFromProjectSettings(
  s: ProjectCalendarSettings,
  holidays: PublicHoliday[],
): { site: SeededCalendar; office: SeededCalendar } {
  const office = [...new Set(s.workingDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
  if (office.length === 0) {
    throw new ProgrammeOpError('The project has no working days set. Set them in the project settings first.', '22023')
  }
  const site = office.includes(6) ? office : [...office, 6].sort((a, b) => a - b)

  const from = addYears(s.projectStart, -1)
  const to = addYears(s.projectStart, 5)

  let coverage: SeededCalendar['coverage'] = null
  if (s.seededYears.length > 0) {
    const seedFrom = `${Math.min(...s.seededYears)}-01-01`
    const seedTo = `${Math.max(...s.seededYears)}-12-31`
    if (seedFrom <= to && seedTo >= from) {
      coverage = { from: seedFrom > from ? seedFrom : from, to: seedTo < to ? seedTo : to }
    }
  }

  const inWindow = (d: CalendarDate) => d >= from && d <= to
  // day -> label with the lowest priority number winning (1 public holiday, 2 project holiday, 3 shutdown)
  const base = new Map<CalendarDate, { pri: number; label: string }>()
  const put = (m: Map<CalendarDate, { pri: number; label: string }>, day: CalendarDate, pri: number, label: string) => {
    const cur = m.get(day)
    if (!cur || pri < cur.pri) m.set(day, { pri, label })
  }
  for (const h of holidays) if (inWindow(h.day)) put(base, h.day, 1, h.name)
  for (const e of s.extraHolidays) if (inWindow(e)) put(base, e, 2, 'Project holiday')

  const siteMap = new Map(base)
  if (s.shutdown.enabled) {
    const a = MD.exec(s.shutdown.startMd)
    const b = MD.exec(s.shutdown.endMd)
    if (!a || !b) throw new ProgrammeOpError('The builders\' shutdown dates must be month-day values like 12-15.', '22023')
    const wraps = s.shutdown.endMd < s.shutdown.startMd
    const y0 = Number(from.slice(0, 4)) - 1
    const y1 = Number(to.slice(0, 4))
    for (let y = y0; y <= y1; y++) {
      const start = `${y}-${s.shutdown.startMd}`
      const end = `${y + (wraps ? 1 : 0)}-${s.shutdown.endMd}`
      if (!isCalendarDate(start) || !isCalendarDate(end)) {
        throw new ProgrammeOpError('The builders\' shutdown dates must be real dates.', '22023')
      }
      for (let n = dayNumber(start); n <= dayNumber(end); n++) {
        const d = fromDayNumber(n)
        if (inWindow(d)) put(siteMap, d, 3, 'Builders\' shutdown')
      }
    }
  }

  const list = (m: Map<CalendarDate, { pri: number; label: string }>): SeededCalendar['exceptions'] =>
    [...m.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      .map(([day, v]) => ({ day, kind: 'non_work' as const, label: v.label }))

  return {
    site: { name: 'Site', variant: 'site', workWeekdays: site, hoursPerDay: 8, coverage, exceptions: list(siteMap) },
    office: { name: 'Office', variant: 'office', workWeekdays: office, hoursPerDay: 8, coverage, exceptions: list(base) },
  }
}
