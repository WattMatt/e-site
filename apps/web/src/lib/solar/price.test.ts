import { describe, it, expect } from 'vitest'
import { solarPriceLine } from './price'

describe('solarPriceLine', () => {
  it('reads the annual price and states the org-wide, VAT-exclusive scope', () => {
    expect(solarPriceLine()).toBe('R1,999 per year excl. VAT for your whole organisation — every project')
  })
})
