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
