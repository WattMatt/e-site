import { describe, it, expect } from 'vitest'
import {
  FEATURE_PRICES,
  ONE_TIME_FEATURE_KEYS,
  isSubscriptionFeature,
} from '../../services/billing.service'

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

describe('FEATURE_PRICES — solar org subscription (D-01)', () => {
  it('is an org-wide annual subscription at R1,999 excl. VAT', () => {
    expect(FEATURE_PRICES.solar.key).toBe('solar')
    expect(FEATURE_PRICES.solar.model).toBe('org_subscription')
    expect(FEATURE_PRICES.solar.interval).toBe('annual')
    expect(FEATURE_PRICES.solar.amountKobo).toBe(199900)
  })

  it('names the env var holding the Paystack plan code', () => {
    expect(FEATURE_PRICES.solar.planCodeEnv).toBe('PAYSTACK_PLAN_SOLAR_ANNUAL')
  })

  it('does not change the model of any existing entry', () => {
    expect(FEATURE_PRICES.inspections.model).toBe('org')
    expect(FEATURE_PRICES.jbcc.model).toBe('org')
    expect(FEATURE_PRICES.generator_cost_recovery.model).toBe('seat')
  })
})

describe('one-time vs subscription feature keys', () => {
  it('classifies solar as a subscription and the rest as one-time', () => {
    expect(isSubscriptionFeature('solar')).toBe(true)
    expect(isSubscriptionFeature('jbcc')).toBe(false)
    expect(isSubscriptionFeature('inspections')).toBe(false)
    expect(isSubscriptionFeature('generator_cost_recovery')).toBe(false)
  })

  it('answers false for a key that does not exist, including prototype names', () => {
    expect(isSubscriptionFeature('not_a_feature')).toBe(false)
    expect(isSubscriptionFeature('constructor')).toBe(false)
    expect(isSubscriptionFeature('toString')).toBe(false)
  })

  it('ONE_TIME_FEATURE_KEYS excludes every subscription key', () => {
    expect(ONE_TIME_FEATURE_KEYS).not.toContain('solar')
    for (const k of ONE_TIME_FEATURE_KEYS) expect(isSubscriptionFeature(k)).toBe(false)
  })

  it('ONE_TIME_FEATURE_KEYS keeps every existing one-time key', () => {
    expect([...ONE_TIME_FEATURE_KEYS].sort()).toEqual(['generator_cost_recovery', 'inspections', 'jbcc'])
  })
})
