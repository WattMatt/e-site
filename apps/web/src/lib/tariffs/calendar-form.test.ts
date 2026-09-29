import { describe, it, expect } from 'vitest'
import { validateCalendarForm, type CalendarForm } from './calendar-form'

const base: CalendarForm = {
  licenseeId: '11111111-1111-1111-1111-111111111111', validFrom: '2025-04-01', validTo: '', highSeasonMonths: [6, 7, 8],
  source: 'published', holidayTreatedAs: 'sunday',
  windows: [{ season: 'high', dayType: 'weekday', start: '06:00', end: '09:00', period: 'peak' }],
}

describe('calendar form', () => {
  it('converts times to minutes', () => {
    expect(validateCalendarForm(base)).toEqual({ value: {
      licensee_id: base.licenseeId, valid_from: '2025-04-01', valid_to: null, high_season_months: [6, 7, 8], source: 'published',
      holidayTreatedAs: 'sunday',
      windows: [{ season: 'high', day_type: 'weekday', start_minute: 360, end_minute: 540, period: 'peak' }],
    } })
  })
  it('refuses bad dates, empty seasons, reversed and overlapping windows', () => {
    const r = validateCalendarForm({
      ...base, validTo: '2025-01-01', highSeasonMonths: [],
      windows: [
        { season: 'high', dayType: 'weekday', start: '09:00', end: '06:00', period: 'peak' },
        { season: 'low', dayType: 'weekday', start: '07:00', end: '10:00', period: 'peak' },
        { season: 'low', dayType: 'weekday', start: '09:00', end: '12:00', period: 'standard' },
      ],
    })
    expect(r).toEqual({ errors: {
      validTo: 'Must be after the start date', highSeasonMonths: 'Pick the high-demand months',
      'windows.0': 'The end must be after the start',
      windows: 'Low season weekday: 07:00-10:00 overlaps 09:00-12:00',
    } })
  })
})
