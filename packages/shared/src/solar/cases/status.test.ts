import { describe, it, expect } from 'vitest'
import { caseStatus, RUN_TIMEOUT_MS } from './status'

const now = Date.parse('2026-09-28T10:00:00Z')
const at = (msAgo: number) => new Date(now - msAgo).toISOString()
const H = 'a'.repeat(64), H2 = 'b'.repeat(64)

describe('caseStatus', () => {
  it('not run', () => expect(caseStatus(null, null, H, now)).toEqual({ status: 'not_run', label: 'Not run' }))
  it('running, then timed out after 90 s', () => {
    expect(caseStatus({ status: 'running', inputsHash: H, startedAt: at(10_000) }, null, H, now).status).toBe('running')
    expect(caseStatus({ status: 'running', inputsHash: H, startedAt: at(RUN_TIMEOUT_MS + 1) }, null, H, now)).toEqual({ status: 'failed', label: 'Failed (timed out)' })
  })
  it('done when the last success matches the current inputs; stale when not; stale when inputs cannot be built', () => {
    const ok = { status: 'succeeded' as const, inputsHash: H, startedAt: at(1000) }
    expect(caseStatus(ok, { inputsHash: H }, H, now).status).toBe('done')
    expect(caseStatus(ok, { inputsHash: H }, H2, now)).toEqual({ status: 'stale', label: 'Stale' })
    expect(caseStatus(ok, { inputsHash: H }, null, now)).toEqual({ status: 'stale', label: 'Stale (inputs incomplete)' })
  })
  it('a failed latest run is Failed even with an older success', () => {
    expect(caseStatus({ status: 'failed', inputsHash: H, startedAt: at(1000) }, { inputsHash: H }, H, now).status).toBe('failed')
  })
  it('a cancelled latest run falls back to the last success', () => {
    expect(caseStatus({ status: 'cancelled', inputsHash: H2, startedAt: at(1000) }, { inputsHash: H }, H, now).status).toBe('done')
    expect(caseStatus({ status: 'cancelled', inputsHash: H2, startedAt: at(1000) }, null, H, now)).toEqual({ status: 'not_run', label: 'Cancelled' })
  })
})

describe('caseStatus — pricing changed is not energy stale', () => {
  const E = 'e'.repeat(64), E2 = 'f'.repeat(64)
  const ok = { status: 'succeeded' as const, inputsHash: H, startedAt: at(1000) }
  it('only the pricing moved (the energy input hash still matches the run): Pricing changed', () => {
    expect(caseStatus(ok, { inputsHash: H, energyHash: E }, H2, now, { currentEnergyHash: E }))
      .toEqual({ status: 'pricing_changed', label: 'Pricing changed' })
  })
  it('the financials were already re-run on the new pricing: Done', () => {
    expect(caseStatus(ok, { inputsHash: H, energyHash: E }, H2, now, { currentEnergyHash: E, financialsOnCurrentPricing: true }).status).toBe('done')
  })
  it('the energy inputs moved: Stale, whatever the financials say', () => {
    expect(caseStatus(ok, { inputsHash: H, energyHash: E }, H2, now, { currentEnergyHash: E2, financialsOnCurrentPricing: true }))
      .toEqual({ status: 'stale', label: 'Stale' })
  })
  it('an unknown stored or current energy hash is Stale (never guessed as pricing only)', () => {
    expect(caseStatus(ok, { inputsHash: H }, H2, now, { currentEnergyHash: E }).status).toBe('stale')
    expect(caseStatus(ok, { inputsHash: H, energyHash: E }, H2, now, { currentEnergyHash: null }).status).toBe('stale')
    expect(caseStatus(ok, { inputsHash: H, energyHash: E }, H2, now).status).toBe('stale')
  })
})
