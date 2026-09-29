import { describe, it, expect } from 'vitest'
import { humanTariffError } from './errors'

describe('humanTariffError', () => {
  it('maps the exact 00209/00213 sentences and SQLSTATEs, never the raw message', () => {
    expect(humanTariffError({ message: 'tariffs.tariff_year x: not validated, or 2 blocking issue(s); validate again after any change' }))
      .toBe('Run the checks again: the year changed since it was last checked, or the checks found blocking issues.')
    expect(humanTariffError({ message: 'tariffs.tariff_year x: 3 inferred unit(s) not reviewed' }))
      .toBe('Some charges with an inferred unit are not reviewed yet. Approve them first.')
    expect(humanTariffError({ message: 'tariffs.charge: tariff year y is published; published tariff data is immutable (correct it through a new version)' }))
      .toBe('Published tariff data cannot be changed. Correct it in a new version.')
    expect(humanTariffError({ code: '23505', message: 'duplicate key value violates unique constraint "licensee_name_key"' })).toBe('That already exists.')
    expect(humanTariffError({ code: 'XX000', message: 'secret internals' })).toBe('Something went wrong. Try again.')
  })
})
