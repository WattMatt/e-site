/** The WorkCalendar a schedule is measured in: its mode + SA holidays for any year, looked up lazily. Client-safe. */
import { makeWorkCalendar, saHolidays, type CalendarDate, type DurationMode, type WorkCalendar } from '@esite/shared'

/**
 * `dates` and `today` are kept in the signature for existing callers; the
 * holidays no longer depend on them, so a task added or imported in a later
 * year still skips that year's holidays.
 */
export function scheduleCalendar(mode: DurationMode, _dates: readonly CalendarDate[], _today: CalendarDate): WorkCalendar {
  return makeWorkCalendar(mode, saHolidays())
}
