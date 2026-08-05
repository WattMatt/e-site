import { describe, it, expect } from 'vitest'
import { safeNext } from './safe-next'

// Ported from kit/login-safety/loginNext.test.ts (Onboarding Standard A7),
// prefixes adapted to this app's route groups.
describe('safeNext', () => {
  it('allows allow-listed relative paths', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard')
    expect(safeNext('/projects/abc-123/settings/rates?tab=boq')).toBe(
      '/projects/abc-123/settings/rates?tab=boq',
    )
    expect(safeNext('/portal/11111111-2222-3333-4444-555555555555')).toBe(
      '/portal/11111111-2222-3333-4444-555555555555',
    )
    expect(safeNext('/onboarding')).toBe('/onboarding')
    expect(safeNext('/settings/users')).toBe('/settings/users')
    expect(safeNext('/portal?welcome=1')).toBe('/portal?welcome=1')
  })

  it('rejects absolute/protocol-relative/external', () => {
    expect(safeNext('https://evil.example')).toBeNull()
    expect(safeNext('//evil.example')).toBeNull()
    expect(safeNext('javascript:alert(1)')).toBeNull()
  })

  it('rejects non-allow-listed prefixes and empties', () => {
    expect(safeNext('/account-deleted')).toBeNull()
    expect(safeNext('/verify-mfa')).toBeNull()
    expect(safeNext('/api/notifications/dispatch')).toBeNull()
    expect(safeNext(null)).toBeNull()
    expect(safeNext(undefined)).toBeNull()
    expect(safeNext('')).toBeNull()
  })

  it('rejects prefix look-alikes', () => {
    expect(safeNext('/dashboardevil')).toBeNull()
    expect(safeNext('/portalx/foo')).toBeNull()
    expect(safeNext('/sitemap.xml')).toBeNull() // '/site' must not match '/sitemap.xml'
  })

  it('rejects dot-segment traversal that escapes the allow-list', () => {
    expect(safeNext('/dashboard/../../account-deleted')).toBeNull()
    expect(safeNext('/projects/../../../verify-mfa')).toBeNull()
  })

  it('rejects backslash and encoded-slash tricks', () => {
    expect(safeNext('/\\evil.example')).toBeNull()
    expect(safeNext('%2F%2Fevil.example')).toBeNull()
  })

  it('normalizes harmless internal dot-segments to a clean allow-listed path', () => {
    expect(safeNext('/dashboard/./')).toBe('/dashboard/')
    expect(safeNext('/projects/abc/../def')).toBe('/projects/def')
  })
})
