// packages/shared/src/lib/jbcc/sa-public-holidays.ts

const FIXED_DATES: Array<[month: number, day: number, label: string]> = [
  [1,  1,  "New Year's Day"],
  [3,  21, 'Human Rights Day'],
  [4,  27, 'Freedom Day'],
  [5,  1,  "Workers' Day"],
  [6,  16, 'Youth Day'],
  [8,  9,  "National Women's Day"],
  [9,  24, 'Heritage Day'],
  [12, 16, 'Day of Reconciliation'],
  [12, 25, 'Christmas Day'],
  [12, 26, 'Day of Goodwill'],
]

/** Computus — Anonymous Gregorian algorithm. Returns Easter Sunday for a given year (UTC). */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day   = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

const sameYmd = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear()
  && a.getUTCMonth() === b.getUTCMonth()
  && a.getUTCDate()  === b.getUTCDate()

/** All SA public holidays for a year, with Sunday-rule observances appended. */
export function listHolidays(year: number): Date[] {
  const out: Date[] = []

  for (const [m, d] of FIXED_DATES) out.push(utc(year, m, d))

  const easter = easterSunday(year)
  const goodFriday = new Date(easter); goodFriday.setUTCDate(easter.getUTCDate() - 2)
  const familyDay  = new Date(easter); familyDay.setUTCDate(easter.getUTCDate() + 1)
  out.push(goodFriday, familyDay)

  // Sunday rule: any holiday on Sunday is also observed on the following Monday.
  for (const h of [...out]) {
    if (h.getUTCDay() === 0) {
      const mon = new Date(h); mon.setUTCDate(h.getUTCDate() + 1)
      out.push(mon)
    }
  }
  return out
}

export function isPublicHoliday(date: Date): boolean {
  const year = date.getUTCFullYear()
  return listHolidays(year).some(h => sameYmd(h, date))
}
