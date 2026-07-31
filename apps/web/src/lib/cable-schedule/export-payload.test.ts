import { describe, it, expect } from 'vitest'
import { effectiveNodeBreaker } from './export-payload'

/**
 * Breaker display fallback (2026-06-24 spec §A1, completed 2026-07-31):
 * display value = breaker_rating_a ?? incomer_breaker_a (and pole_config ??
 * incomer_pole_config). In prod, boards rarely have the manual value set but
 * the tenant-electrical rollup persists incomer_* on most nodes — without
 * the fallback the Breaker column rendered blank in every export format.
 */
describe('effectiveNodeBreaker', () => {
  it('prefers the manual breaker_rating_a + pole_config', () => {
    expect(
      effectiveNodeBreaker({
        breaker_rating_a: 63,
        pole_config: 'TP',
        incomer_breaker_a: 100,
        incomer_pole_config: 'SP',
      }),
    ).toEqual({ breaker_a: 63, pole_config: 'TP' })
  })

  it('falls back to the derived incomer values when manual is null', () => {
    expect(
      effectiveNodeBreaker({
        breaker_rating_a: null,
        pole_config: null,
        incomer_breaker_a: 100,
        incomer_pole_config: 'TP',
      }),
    ).toEqual({ breaker_a: 100, pole_config: 'TP' })
  })

  it('falls back per-field independently', () => {
    expect(
      effectiveNodeBreaker({
        breaker_rating_a: 63,
        pole_config: null,
        incomer_breaker_a: null,
        incomer_pole_config: 'TP',
      }),
    ).toEqual({ breaker_a: 63, pole_config: 'TP' })
  })

  it('returns nulls when nothing is set, and for a missing node', () => {
    expect(
      effectiveNodeBreaker({
        breaker_rating_a: null,
        pole_config: null,
        incomer_breaker_a: null,
        incomer_pole_config: null,
      }),
    ).toEqual({ breaker_a: null, pole_config: null })
    expect(effectiveNodeBreaker(undefined)).toEqual({ breaker_a: null, pole_config: null })
  })
})
