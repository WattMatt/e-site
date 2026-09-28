import { describe, it, expect } from 'vitest'
import { humanSolarError, STALE_MESSAGE } from './errors'

describe('humanSolarError', () => {
  it('maps the 00207 guard and bind sentences to plain English', () => {
    expect(humanSolarError({ code: '23505', message: 'duplicate key value violates unique constraint "access_requests_one_pending"' }))
      .toBe('You already have a request waiting for an answer.')
    expect(humanSolarError({ code: '42501', message: 'access_requests: requester is not an eligible member of this project' }))
      .toBe('Your account cannot be given Solar access on this project.')
    expect(humanSolarError({ code: '23514', message: 'solar.project_access: user is not an eligible member of this project' }))
      .toBe('This person cannot be given Solar access on this project. Clients and suppliers never can, and only active project members can.')
    expect(humanSolarError({ code: '23514', message: 'solar.project_access: level edit exceeds this user\'s maximum (view)' }))
      .toBe('That level is higher than this person can hold. Members from outside the organisation can have View only.')
    expect(humanSolarError({ code: '42501', message: 'access_requests: request already approved' }))
      .toBe('This request has already been answered — reload to see it.')
    expect(humanSolarError({ code: '42501', message: 'access_requests: only members of the project\'s organisation may request a subscription' }))
      .toBe('Only members of this project’s organisation can ask for a subscription.')
  })
  it('never leaks a raw message', () => {
    expect(humanSolarError({ code: 'XX000', message: 'internal error at pg_foo.c:12' })).toBe('Something went wrong — try again.')
    expect(humanSolarError({ code: '42501', message: 'new row violates row-level security policy' })).toBe('You do not have permission to do that.')
    expect(humanSolarError(null)).toBe('Something went wrong — try again.')
  })
  it('exports the stale-write sentence verbatim', () => {
    expect(STALE_MESSAGE).toBe('Someone else changed this — reload to see their version.')
  })
})
