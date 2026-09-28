/** The WorkCalendar a schedule is measured in: its mode + SA holidays for every year it touches (±1). Client-safe. */
import { makeWorkCalendar, saHolidaySet, type CalendarDate, type DurationMode, type WorkCalendar } from '@esite/shared'

export function scheduleCalendar(mode: DurationMode, dates: readonly CalendarDate[], today: CalendarDate): WorkCalendar {
  const years = [...dates, today].map((d) => Number(d.slice(0, 4))).filter(Number.isFinite)
  return makeWorkCalendar(mode, saHolidaySet(Math.min(...years) - 1, Math.max(...years) + 1))
}
