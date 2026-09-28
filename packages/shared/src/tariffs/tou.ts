import type { BillingSeason, MonthUsage, TouKwh, TouPeriod } from './types'

export type WindowDayType = 'weekday' | 'saturday' | 'sunday'

export interface TouWindow {
  season: BillingSeason
  dayType: WindowDayType
  /** [startMinute, endMinute) minutes after local midnight. */
  startMinute: number
  endMinute: number
  period: TouPeriod
}

export interface TouCalendar {
  highSeasonMonths: number[]
  windows: TouWindow[]
  holidayTreatedAs: 'saturday' | 'sunday' | null
  /** Municipal books state seasons, never hours: their calendars are assumed_eskom. */
  source: 'published' | 'assumed_eskom'
}

/** Days per month of the 8760-hour reference year (29 Feb dropped). */
export const REFERENCE_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export function zeroTouKwh(): TouKwh {
  return { peak: 0, standard: 0, off_peak: 0 }
}

export function sumTouKwh(t: TouKwh): number {
  return t.peak + t.standard + t.off_peak
}

export function seasonForMonth(month: number, cal: Pick<TouCalendar, 'highSeasonMonths'>): BillingSeason {
  return cal.highSeasonMonths.includes(month) ? 'high' : 'low'
}

export function dayTypeOf(
  year: number, month: number, day: number,
  holidays: ReadonlySet<string> | undefined,
  cal: Pick<TouCalendar, 'holidayTreatedAs'>,
): WindowDayType {
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (cal.holidayTreatedAs && holidays?.has(key)) return cal.holidayTreatedAs
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
}

export function touPeriodAt(cal: Pick<TouCalendar, 'windows'>, season: BillingSeason, dayType: WindowDayType, minute: number): TouPeriod {
  const hit = cal.windows.find(
    (x) => x.season === season && x.dayType === dayType && minute >= x.startMinute && minute < x.endMinute,
  )
  return hit ? hit.period : 'off_peak'
}

/**
 * 8760 hourly kWh (interval-ending averages, hour 0 = 1 Jan 00:00-01:00 SAST)
 * into twelve TOU-split months. Maximum demand needs sub-hourly data and is
 * left unset here (engine spec §2.6).
 */
export function aggregateHourly(input: {
  importKwh: ArrayLike<number>
  exportKwh?: ArrayLike<number>
  calendar: TouCalendar
  year: number
  holidays?: ReadonlySet<string>
}): MonthUsage[] {
  if (input.importKwh.length !== 8760) throw new RangeError(`importKwh has ${input.importKwh.length} hours, expected 8760`)
  if (input.exportKwh && input.exportKwh.length !== 8760) {
    throw new RangeError(`exportKwh has ${input.exportKwh.length} hours, expected 8760`)
  }
  const months: MonthUsage[] = REFERENCE_MONTH_DAYS.map((days, k) => ({
    year: input.year,
    month: k + 1,
    days,
    season: seasonForMonth(k + 1, input.calendar),
    importKwh: zeroTouKwh(),
    ...(input.exportKwh ? { exportKwh: zeroTouKwh() } : {}),
  }))
  let h = 0
  for (let m = 1; m <= 12; m++) {
    const usage = months[m - 1]
    for (let d = 1; d <= REFERENCE_MONTH_DAYS[m - 1]; d++) {
      const dayType = dayTypeOf(input.year, m, d, input.holidays, input.calendar)
      for (let hr = 0; hr < 24; hr++, h++) {
        const p = touPeriodAt(input.calendar, usage.season, dayType, hr * 60)
        usage.importKwh[p] += input.importKwh[h]
        if (input.exportKwh && usage.exportKwh) usage.exportKwh[p] += input.exportKwh[h]
      }
    }
  }
  return months
}
