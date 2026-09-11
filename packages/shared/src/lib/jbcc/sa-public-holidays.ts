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

export interface NamedHoliday {
  date: Date
  name: string
}

/**
 * All SA public holidays for a year, named, with Sunday-rule observances
 * appended. This is the single statutory source; projects.public_holidays is
 * a materialisation of it (Appendix A(h)), seeded by
 * scripts/db/gen-public-holidays-seed.ts and asserted equal by
 * public-holidays.contract.test.ts.
 */
export function listHolidaysNamed(year: number): NamedHoliday[] {
  const out: NamedHoliday[] = []

  for (const [m, d, label] of FIXED_DATES) out.push({ date: utc(year, m, d), name: label })

  const easter = easterSunday(year)
  const goodFriday = new Date(easter); goodFriday.setUTCDate(easter.getUTCDate() - 2)
  const familyDay  = new Date(easter); familyDay.setUTCDate(easter.getUTCDate() + 1)
  out.push({ date: goodFriday, name: 'Good Friday' }, { date: familyDay, name: 'Family Day' })

  // Sunday rule: any holiday on Sunday is also observed on the following Monday
  // — unless that Monday is already a holiday. projects.public_holidays(d date
  // PRIMARY KEY) can hold one row per date, so this source of truth must yield
  // one entry per date. Only 2033 collides in 2024-2035: Christmas Day falls on
  // a Sunday, so its observed Monday (26 Dec) would duplicate the already-fixed
  // Day of Goodwill; the fixed holiday's name wins.
  for (const h of [...out]) {
    if (h.date.getUTCDay() === 0) {
      const mon = new Date(h.date); mon.setUTCDate(h.date.getUTCDate() + 1)
      if (out.some((o) => sameYmd(o.date, mon))) continue
      out.push({ date: mon, name: `${h.name} (observed)` })
    }
  }
  return out
}

/** All SA public holidays for a year, with Sunday-rule observances appended. */
export function listHolidays(year: number): Date[] {
  return listHolidaysNamed(year).map((h) => h.date)
}

export function isPublicHoliday(date: Date): boolean {
  const year = date.getUTCFullYear()
  return listHolidays(year).some(h => sameYmd(h, date))
}
