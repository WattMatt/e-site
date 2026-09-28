import { describe, it, expect } from 'vitest'
import { resolveSolarEntry, solarNavBadge, requestableLevels, type SolarEntryInput } from './entry'

const base: SolarEntryInput = {
  effectiveRole: 'contractor',
  level: null,
  isGrantor: false,
  isOwnOrgMember: true,
  orgSubscribed: true,
  pendingAccessRequestAt: null,
  pendingSubscribeRequestAt: null,
}

describe('resolveSolarEntry — the five rows of spec §0.2', () => {
  it('row 1: org not subscribed, owner/admin → subscribe', () => {
    expect(resolveSolarEntry({ ...base, effectiveRole: 'admin', isGrantor: true, orgSubscribed: false }))
      .toEqual({ kind: 'subscribe' })
  })

  it('row 2: org not subscribed, any other member → ask an admin (not yet asked)', () => {
    expect(resolveSolarEntry({ ...base, orgSubscribed: false })).toEqual({ kind: 'ask_admin', requestedAt: null })
  })

  it('row 2: already asked → carries the date', () => {
    expect(resolveSolarEntry({ ...base, orgSubscribed: false, pendingSubscribeRequestAt: '2026-09-28T08:00:00Z' }))
      .toEqual({ kind: 'ask_admin', requestedAt: '2026-09-28T08:00:00Z' })
  })

  it('row 3: subscribed, no grant → request access up to edit + financials for own-org members', () => {
    expect(resolveSolarEntry(base)).toEqual({ kind: 'request_access', maxLevel: 'edit_financials' })
  })

  it('row 3: an external member (not in the project org) may only ask for View', () => {
    expect(resolveSolarEntry({ ...base, isOwnOrgMember: false, orgSubscribed: false }))
      .toEqual({ kind: 'request_access', maxLevel: 'view' })
  })

  it('row 4: request pending → pending with its date', () => {
    expect(resolveSolarEntry({ ...base, pendingAccessRequestAt: '2026-09-28T08:00:00Z' }))
      .toEqual({ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' })
  })

  it('row 5: granted → granted at that level', () => {
    expect(resolveSolarEntry({ ...base, level: 'view' })).toEqual({ kind: 'granted', level: 'view' })
  })

  it('suppliers, client viewers and non-members never see Solar', () => {
    expect(resolveSolarEntry({ ...base, effectiveRole: 'supplier' })).toEqual({ kind: 'hidden' })
    expect(resolveSolarEntry({ ...base, effectiveRole: 'client_viewer' })).toEqual({ kind: 'hidden' })
    expect(resolveSolarEntry({ ...base, effectiveRole: null })).toEqual({ kind: 'hidden' })
  })
})

describe('solarNavBadge', () => {
  it('maps each state to the sidebar badge', () => {
    expect(solarNavBadge({ kind: 'hidden' })).toBe('hidden')
    expect(solarNavBadge({ kind: 'granted', level: 'edit' })).toBe('open')
    expect(solarNavBadge({ kind: 'pending', requestedAt: 'x' })).toBe('pending')
    expect(solarNavBadge({ kind: 'subscribe' })).toBe('locked')
    expect(solarNavBadge({ kind: 'ask_admin', requestedAt: 'x' })).toBe('locked')
    expect(solarNavBadge({ kind: 'request_access', maxLevel: 'view' })).toBe('locked')
  })
})

describe('requestableLevels', () => {
  it('lists every level up to and including the maximum', () => {
    expect(requestableLevels('view')).toEqual(['view'])
    expect(requestableLevels('edit_financials')).toEqual(['view', 'edit', 'edit_financials'])
  })
})
