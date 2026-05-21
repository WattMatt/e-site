import { describe, it, expect } from 'vitest'
import { membershipState } from './membership'

describe('membershipState', () => {
  it('new-user invite (active, unaccepted) is pending', () => {
    expect(membershipState({ is_active: true, accepted_at: null })).toBe('pending')
  })
  it('existing-user invite (inactive, unaccepted) is pending', () => {
    expect(membershipState({ is_active: false, accepted_at: null })).toBe('pending')
  })
  it('accepted + active is active', () => {
    expect(membershipState({ is_active: true, accepted_at: '2026-05-21T00:00:00Z' })).toBe('active')
  })
  it('accepted + inactive is deactivated', () => {
    expect(membershipState({ is_active: false, accepted_at: '2026-05-21T00:00:00Z' })).toBe('deactivated')
  })
})
