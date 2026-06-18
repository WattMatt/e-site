import { describe, it, expect } from 'vitest'
import { resolveAcceptInvite } from './accept-invite'

describe('resolveAcceptInvite', () => {
  it('PKCE code → exchange_code', () => {
    const r = resolveAcceptInvite(new URLSearchParams('code=PKCE123'))
    expect(r).toEqual({ kind: 'exchange_code', code: 'PKCE123' })
  })

  it('OTP token_hash + type=invite → verify_otp', () => {
    const r = resolveAcceptInvite(new URLSearchParams('token_hash=HASH&type=invite'))
    expect(r).toEqual({ kind: 'verify_otp', tokenHash: 'HASH', type: 'invite' })
  })

  it('legacy ?token alias is accepted as token_hash', () => {
    const r = resolveAcceptInvite(new URLSearchParams('token=HASH&type=invite'))
    expect(r).toEqual({ kind: 'verify_otp', tokenHash: 'HASH', type: 'invite' })
  })

  it('error_code bounce → error', () => {
    const r = resolveAcceptInvite(new URLSearchParams('error_code=otp_expired'))
    expect(r).toEqual({ kind: 'error', code: 'otp_expired' })
  })

  it('nothing usable → error invalid_link', () => {
    const r = resolveAcceptInvite(new URLSearchParams(''))
    expect(r).toEqual({ kind: 'error', code: 'invalid_link' })
  })
})
