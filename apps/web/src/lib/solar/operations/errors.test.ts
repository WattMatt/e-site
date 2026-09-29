import { describe, it, expect } from 'vitest'
import { opsError } from './errors'

describe('opsError', () => {
  it('turns 00217 trigger refusals into the sentence they carry', () => {
    expect(opsError({ code: '23514', message: 'solar.installation_meters: a generation meter must be a solar meter' })).toBe('A generation meter must be a solar meter.')
    expect(opsError({ code: '23P01', message: 'solar.downtime: this window overlaps recorded downtime' })).toBe('This window overlaps recorded downtime.')
    // Review A6: moving the commissioning date past recorded downtime (00217 installations_bind).
    expect(opsError({ code: '23514', message: 'solar.installations: downtime is recorded before that commissioning date; move or delete it first' }))
      .toBe('Downtime is recorded before that commissioning date; move or delete it first.')
    expect(opsError({ code: '42501', message: 'solar.installations: the installation identity and its modelled baseline are immutable' }))
      .toBe('The installation identity and its modelled baseline are immutable.')
  })
  it('never echoes any other database text', () => {
    expect(opsError({ code: '42501', message: 'new row violates row-level security policy for table "downtime"' })).toBe('You do not have permission to do that.')
    expect(opsError({ code: 'XX000', message: 'internal detail' })).toBe('Something went wrong — try again.')
  })
})
