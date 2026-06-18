import { describe, it, expect } from 'vitest'
import { resolveConfirmFlow } from './confirm-flow'

describe('resolveConfirmFlow', () => {
  it('flow=invite → keep session, land in /dashboard', () => {
    const r = resolveConfirmFlow(new URLSearchParams('flow=invite'))
    expect(r).toEqual({ kind: 'invite', signOut: false, redirectTo: '/dashboard' })
  })

  it('no flow param → reset: sign out, back to /login', () => {
    const r = resolveConfirmFlow(new URLSearchParams(''))
    expect(r).toEqual({ kind: 'reset', signOut: true, redirectTo: '/login' })
  })

  it('flow=reset (or any other value) → reset behaviour', () => {
    const r = resolveConfirmFlow(new URLSearchParams('flow=reset'))
    expect(r).toEqual({ kind: 'reset', signOut: true, redirectTo: '/login' })
  })
})
