import { describe, it, expect } from 'vitest'
import { FEATURE_PRICES } from '../../services/billing.service'

describe('FEATURE_PRICES — generator_cost_recovery seat entry', () => {
  it('has a generator_cost_recovery entry', () => {
    expect(FEATURE_PRICES).toHaveProperty('generator_cost_recovery')
  })

  it('has model set to "seat"', () => {
    expect(FEATURE_PRICES.generator_cost_recovery.model).toBe('seat')
  })

  it('has the correct amountKobo (R2,000 = 200000 kobo)', () => {
    expect(FEATURE_PRICES.generator_cost_recovery.amountKobo).toBe(200000)
  })

  it('has the correct key value', () => {
    expect(FEATURE_PRICES.generator_cost_recovery.key).toBe('generator_cost_recovery')
  })

  it('existing org-model entries retain model === "org"', () => {
    expect(FEATURE_PRICES.inspections.model).toBe('org')
    expect(FEATURE_PRICES.jbcc.model).toBe('org')
  })

  it('existing entries still expose amountKobo (no regression)', () => {
    expect(FEATURE_PRICES.inspections.amountKobo).toBe(25000)
    expect(FEATURE_PRICES.jbcc.amountKobo).toBe(199900)
  })
})
