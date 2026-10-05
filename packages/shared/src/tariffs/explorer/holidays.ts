/**
 * How a tariff bills a public holiday. Eskom's rule differs by tariff family
 * and by holiday (Schedule of standard prices 2026/27 p12): the Megaflex
 * family bills some holidays as Sunday and the rest as Saturday; Homeflex and
 * Ruraflex bill the actual weekday. tariffs.holiday_treatment holds the dated
 * rows; tariffs.holiday_rule is the calendar-wide fallback.
 */
export interface HolidayTreatmentRow {
  tariffFamily: string
  holidayDate: string
  holidayName: string
  treatedAs: 'weekday' | 'saturday' | 'sunday'
}

export interface HolidayTreatment {
  rows: HolidayTreatmentRow[]
  summary: string
}

export function holidayTreatmentFor(
  t: { family: string | null; name: string },
  rows: readonly HolidayTreatmentRow[],
  calendarWide: 'saturday' | 'sunday' | null,
): HolidayTreatment {
  const fam = t.family?.trim().toUpperCase()
  const own = fam ? rows.filter((r) => r.tariffFamily.trim().toUpperCase() === fam).sort((a, b) => a.holidayDate.localeCompare(b.holidayDate)) : []
  if (own.length) {
    return { rows: own, summary: 'Public holidays are billed as a Saturday or a Sunday, as listed below. A holiday not listed follows its day of the week.' }
  }
  if (calendarWide) return { rows: [], summary: `Public holidays are billed as a ${calendarWide === 'sunday' ? 'Sunday' : 'Saturday'}.` }
  return { rows: [], summary: 'Public holidays are billed as the day of the week they fall on.' }
}
