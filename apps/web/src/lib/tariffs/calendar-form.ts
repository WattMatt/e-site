/** TOU calendar editor form (spec §12 "TOU calendars & holidays"). */
import { parseTimeLabel, validateTouWindows, type TouPeriod } from '@esite/shared'

export interface CalendarWindowForm {
  season: 'high' | 'low'
  dayType: 'weekday' | 'saturday' | 'sunday'
  start: string
  end: string
  period: TouPeriod
}

export interface CalendarForm {
  licenseeId: string
  validFrom: string
  validTo: string
  highSeasonMonths: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | ''
  windows: CalendarWindowForm[]
}

export interface CalendarValue {
  licensee_id: string
  valid_from: string
  valid_to: string | null
  high_season_months: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | null
  windows: Array<{ season: string; day_type: string; start_minute: number; end_minute: number; period: TouPeriod }>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateCalendarForm(f: CalendarForm): { value: CalendarValue } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (!/^[0-9a-f-]{36}$/i.test(f.licenseeId)) errors.licenseeId = 'Choose a licensee'
  if (!DATE.test(f.validFrom)) errors.validFrom = 'Choose the start date'
  if (f.validTo && !DATE.test(f.validTo)) errors.validTo = 'Use a date'
  else if (f.validTo && DATE.test(f.validFrom) && f.validTo <= f.validFrom) errors.validTo = 'Must be after the start date'
  const months = [...new Set(f.highSeasonMonths)].filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, b) => a - b)
  if (months.length === 0) errors.highSeasonMonths = 'Pick the high-demand months'
  if (f.source !== 'published' && f.source !== 'assumed_eskom') errors.source = 'Choose where the hours come from'
  const windows: CalendarValue['windows'] = []
  f.windows.forEach((w, i) => {
    const s = parseTimeLabel(w.start)
    const e = parseTimeLabel(w.end)
    if (s === null || e === null) errors[`windows.${i}`] = 'Use HH:MM (00:00 to 24:00)'
    else if (e <= s) errors[`windows.${i}`] = 'The end must be after the start'
    else windows.push({ season: w.season, day_type: w.dayType, start_minute: s, end_minute: e, period: w.period })
  })
  const overlaps = validateTouWindows(windows.map((w) => ({
    season: w.season as 'high' | 'low', dayType: w.day_type as 'weekday' | 'saturday' | 'sunday',
    startMinute: w.start_minute, endMinute: w.end_minute, period: w.period,
  })))
  if (overlaps.length > 0) errors.windows = overlaps.map((o) => o.message).join('; ')
  if (Object.keys(errors).length > 0) return { errors }
  return {
    value: {
      licensee_id: f.licenseeId, valid_from: f.validFrom, valid_to: f.validTo || null, high_season_months: months,
      source: f.source, holidayTreatedAs: f.holidayTreatedAs || null, windows,
    },
  }
}
