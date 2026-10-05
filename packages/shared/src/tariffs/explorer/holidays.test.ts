import { describe, expect, it } from 'vitest'
import { holidayTreatmentFor, type HolidayTreatmentRow } from './holidays'

const ROWS: HolidayTreatmentRow[] = [
  { tariffFamily: 'Megaflex', holidayDate: '2026-04-27', holidayName: 'Freedom Day', treatedAs: 'saturday' },
  { tariffFamily: 'Megaflex', holidayDate: '2026-04-03', holidayName: 'Good Friday', treatedAs: 'sunday' },
  { tariffFamily: 'Miniflex', holidayDate: '2026-04-03', holidayName: 'Good Friday', treatedAs: 'sunday' },
]

describe('holidayTreatmentFor', () => {
  it('lists the tariff family\'s own dated rules, oldest first', () => {
    const r = holidayTreatmentFor({ family: 'Megaflex', name: '> 1 MVA (Me01N)' }, ROWS, null)
    expect(r.rows.map((x) => x.holidayName)).toEqual(['Good Friday', 'Freedom Day'])
    expect(r.summary).toBe('Public holidays are billed as a Saturday or a Sunday, as listed below. A holiday not listed follows its day of the week.')
  })
  it('falls back to the calendar-wide rule, then to the actual weekday', () => {
    expect(holidayTreatmentFor({ family: 'Homeflex', name: 'Homeflex 1' }, ROWS, 'sunday')).toEqual({ rows: [], summary: 'Public holidays are billed as a Sunday.' })
    expect(holidayTreatmentFor({ family: 'Homeflex', name: 'Homeflex 1' }, ROWS, null)).toEqual({ rows: [], summary: 'Public holidays are billed as the day of the week they fall on.' })
  })
  it('matches the family case-insensitively and ignores a missing family', () => {
    expect(holidayTreatmentFor({ family: 'MEGAFLEX', name: 'x' }, ROWS, null).rows).toHaveLength(2)
    expect(holidayTreatmentFor({ family: null, name: 'x' }, ROWS, null).rows).toHaveLength(0)
  })
})
