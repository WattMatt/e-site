// packages/shared/src/lib/jbcc/working-days.ts
import { isPublicHoliday } from './sa-public-holidays'

export type DeadlineStatus = 'clear' | 'due_soon' | 'overdue' | 'no_deadline'

export interface TimeBarSpec {
  time_bar_days: number | null
  time_bar_unit: 'WD' | 'CD' | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const addUTCDays = (d: Date, n: number): Date =>
  new Date(d.getTime() + n * MS_PER_DAY)

const isWeekend = (d: Date): boolean => {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

const isWorkingDay = (d: Date): boolean =>
  !isWeekend(d) && !isPublicHoliday(d)

/** Returns the date that is `n` working days after `from` (Mon–Fri minus SA public holidays). */
export function addWorkingDays(from: Date, n: number): Date {
  if (n === 0) return from
  let cursor = from
  let remaining = n
  while (remaining > 0) {
    cursor = addUTCDays(cursor, 1)
    if (isWorkingDay(cursor)) remaining -= 1
  }
  return cursor
}

/** Computes the deadline date from a notice spec and a trigger date. Null for non-numeric time-bars. */
export function computeDeadline(notice: TimeBarSpec, triggerDate: Date): Date | null {
  if (notice.time_bar_days === null || notice.time_bar_unit === null) return null
  return notice.time_bar_unit === 'WD'
    ? addWorkingDays(triggerDate, notice.time_bar_days)
    : addUTCDays(triggerDate, notice.time_bar_days)
}

/** Returns the working days remaining between `today` (exclusive) and `deadline` (inclusive). */
function workingDaysUntil(deadline: Date, today: Date): number {
  if (deadline <= today) return 0
  let count = 0
  let cursor = today
  while (cursor < deadline) {
    cursor = addUTCDays(cursor, 1)
    if (isWorkingDay(cursor)) count += 1
  }
  return count
}

export function deadlineStatus(deadline: Date | null, today: Date): DeadlineStatus {
  if (!deadline) return 'no_deadline'
  if (deadline < today) return 'overdue'
  return workingDaysUntil(deadline, today) <= 5 ? 'due_soon' : 'clear'
}

/**
 * True if the closed window [start..end] crosses the SA construction-industry
 * year-end shutdown (~mid-Dec to mid-Jan). Heuristic: 15 Dec through 15 Jan.
 * The UI shows this as a verify caveat (see spec §3 builders' holiday).
 */
export function crossesBuildersHoliday(start: Date, end: Date): boolean {
  if (end < start) return false
  // Walk years touched by the window and check each year's 15 Dec–15 Jan band.
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    const bandStart = new Date(Date.UTC(y, 11, 15))      // 15 Dec y
    const bandEnd   = new Date(Date.UTC(y + 1, 0, 15))   // 15 Jan y+1
    if (start <= bandEnd && end >= bandStart) return true
  }
  return false
}
