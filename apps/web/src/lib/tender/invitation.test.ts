import { describe, it, expect } from 'vitest'
import {
  checkInvitation,
  hashInvitationToken,
  invitationExpiry,
  looksLikeInvitationToken,
  newInvitationToken,
  emailMatches,
} from './invitation'

const NOW = new Date('2026-10-10T10:00:00Z')
const open = { status: 'issued', closing_at: '2026-10-20T10:00:00Z' }
const fresh = { status: 'prepared', token_expires_at: '2026-10-20T10:00:00Z' }

describe('tokens', () => {
  it('are 43 url-safe characters, unique, and hash to 64 hex', () => {
    const a = newInvitationToken()
    const b = newInvitationToken()
    expect(looksLikeInvitationToken(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(hashInvitationToken(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInvitationToken(a)).toBe(hashInvitationToken(a))
    expect(looksLikeInvitationToken('short')).toBe(false)
    expect(looksLikeInvitationToken(`${a.slice(0, 42)}/`)).toBe(false)
  })
})

describe('checkInvitation', () => {
  it('accepts a fresh invitation to an open tender', () => {
    expect(checkInvitation(fresh, open, NOW)).toEqual({ ok: true })
    expect(checkInvitation({ ...fresh, status: 'sent' }, open, NOW)).toEqual({ ok: true })
  })
  it('refuses each closed door with its own reason', () => {
    expect(checkInvitation(null, open, NOW)).toEqual({ ok: false, reason: 'not_found' })
    expect(checkInvitation({ ...fresh, status: 'revoked' }, open, NOW)).toEqual({ ok: false, reason: 'revoked' })
    expect(checkInvitation({ ...fresh, status: 'accepted' }, open, NOW)).toEqual({ ok: false, reason: 'used' })
    expect(checkInvitation({ ...fresh, token_expires_at: '2026-10-10T09:59:59Z' }, open, NOW)).toEqual({ ok: false, reason: 'expired' })
    expect(checkInvitation(fresh, { status: 'draft', closing_at: null }, NOW)).toEqual({ ok: false, reason: 'not_open' })
    expect(checkInvitation(fresh, { status: 'issued', closing_at: '2026-10-10T10:00:00Z' }, NOW)).toEqual({ ok: false, reason: 'closed' })
    expect(checkInvitation(fresh, { status: 'closed', closing_at: '2026-10-01T10:00:00Z' }, NOW)).toEqual({ ok: false, reason: 'closed' })
  })
})

describe('emailMatches', () => {
  it('compares case- and space-insensitively and refuses a missing session email', () => {
    expect(emailMatches(' Bidder@Co.Example ', 'bidder@co.example')).toBe(true)
    expect(emailMatches('pm@wm.example', 'bidder@co.example')).toBe(false)
    expect(emailMatches(null, 'bidder@co.example')).toBe(false)
  })
})

describe('invitationExpiry', () => {
  it('defers to the closing time, or gives a draft 30 days', () => {
    expect(invitationExpiry('2026-10-20T10:00:00Z', NOW)).toBeNull()
    expect(invitationExpiry(null, NOW)).toBe('2026-11-09T10:00:00.000Z')
  })
})
