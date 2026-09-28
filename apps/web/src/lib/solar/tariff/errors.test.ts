import { describe, it, expect } from 'vitest'
import { humanSolarTariffError } from './errors'

describe('humanSolarTariffError', () => {
  it('maps the 00213 sentences', () => {
    expect(humanSolarTariffError({ code: '23514', message: 'solar.studies: only a published tariff can be pinned' })).toBe('That tariff is not published in the library.')
    expect(humanSolarTariffError({ code: '23514', message: 'solar.studies: the project override belongs to another study or tariff; revert it first' }))
      .toBe('Revert the project override before choosing another tariff.')
    expect(humanSolarTariffError({ code: '42501', message: 'solar.studies: the tariff, export rule and escalation need Edit + financials' }))
      .toBe('Choosing the tariff needs Edit + financials access.')
    expect(humanSolarTariffError({ code: '40001', message: 'stale' })).toBe('Someone else changed this — reload to see their version.')
    expect(humanSolarTariffError({ code: '23514', message: 'solar.tariff_override_charges: a changed rate needs a reason' })).toBe('Say why this rate differs from the published one.')
  })
  it('maps the re-review sentences (never a generic error, never a silent success)', () => {
    expect(humanSolarTariffError({ code: '23514', message: "solar.bill_checks: the study's tariff changed while the bill was being checked" }))
      .toBe('Someone else changed this — reload to see their version.')
    expect(humanSolarTariffError({ code: '23514', message: 'solar.tariff_override_charges: the reason and source change only with the rate' }))
      .toBe('Change the rate to change its reason: the reason explains a rate that differs from the published one.')
    expect(humanSolarTariffError({ code: '23514', message: "solar.studies: the project override is missing some of the tariff's charges; create it again" }))
      .toBe('The project override is incomplete. Revert it and create it again.')
    expect(humanSolarTariffError({ code: '23514', message: 'solar.save_export_rule: rates are entered only for a manual export rule' }))
      .toBe('Rates are entered only when the export rate is entered manually.')
  })
})
