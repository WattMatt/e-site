import { describe, it, expect } from 'vitest'
import { ASSUMED_ESKOM_HOURS, touHoursLabel } from './calendar'

describe('touHoursLabel', () => {
  it('a run made before TOU provenance was recorded says nothing', () => {
    expect(touHoursLabel(undefined)).toBeNull()
  })
  it('published hours name whose calendar and from when', () => {
    expect(touHoursLabel({ source: 'published', calendarLicenseeName: 'Eskom', validFrom: '2025-04-01', datedHolidays: 0 }))
      .toBe('TOU hours Eskom from 2025-04-01')
  })
  it('assumed hours carry the Tariff tab’s notice word for word', () => {
    expect(touHoursLabel({ source: 'assumed_eskom', calendarLicenseeName: 'Eskom', validFrom: '2025-04-01', datedHolidays: 0 }))
      .toBe(`${ASSUMED_ESKOM_HOURS} (Eskom from 2025-04-01)`)
  })
  it('dated holidays are counted', () => {
    expect(touHoursLabel({ source: 'published', calendarLicenseeName: 'Eskom', validFrom: '2025-04-01', datedHolidays: 1 }))
      .toBe('TOU hours Eskom from 2025-04-01; 1 public holiday billed per the tariff’s dated schedule')
    expect(touHoursLabel({ source: 'published', calendarLicenseeName: 'Eskom', validFrom: '2025-04-01', datedHolidays: 11 }))
      .toContain('; 11 public holidays billed per the tariff’s dated schedule')
  })
})
