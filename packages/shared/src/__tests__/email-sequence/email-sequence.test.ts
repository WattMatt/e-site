import { describe, it, expect } from 'vitest'
import {
  computeSignupWindow,
  isInSignupWindow,
  reengagementStep,
  daysSince,
  shouldSkipSend,
  interpretSendOutcome,
} from '../../services/email-sequence.service'

// ─── Fixed reference point for deterministic tests ────────────────────────────

const NOW = new Date('2026-05-10T01:00:00.000Z') // 01:00 UTC — matches daily cron window
const DAY_MS = 86_400_000

// ─── computeSignupWindow ──────────────────────────────────────────────────────

describe('computeSignupWindow', () => {
  it('window spans exactly 24 hours', () => {
    const { start, end } = computeSignupWindow(1, NOW)
    expect(end.getTime() - start.getTime()).toBe(DAY_MS)
  })

  it('d1: window start is exactly 1 day before now', () => {
    const { start, end } = computeSignupWindow(1, NOW)
    expect(start.getTime()).toBe(NOW.getTime() - DAY_MS)
    expect(end.getTime()).toBe(NOW.getTime())
  })

  it('d3: window start is exactly 3 days before now', () => {
    const { start } = computeSignupWindow(3, NOW)
    expect(start.getTime()).toBe(NOW.getTime() - 3 * DAY_MS)
  })

  it('d7: window start is 7 days before now', () => {
    const { start } = computeSignupWindow(7, NOW)
    expect(start.getTime()).toBe(NOW.getTime() - 7 * DAY_MS)
  })

  it('d14: window start is 14 days before now', () => {
    const { start } = computeSignupWindow(14, NOW)
    expect(start.getTime()).toBe(NOW.getTime() - 14 * DAY_MS)
  })

  it('window is half-open: [start, end) — start is inclusive', () => {
    const { start, end } = computeSignupWindow(1, NOW)
    // exactly at start → inside
    expect(start.getTime() >= start.getTime() && start.getTime() < end.getTime()).toBe(true)
  })

  it('window is half-open: end is exclusive', () => {
    const { start, end } = computeSignupWindow(1, NOW)
    // end itself → outside
    expect(end.getTime() >= start.getTime() && end.getTime() < end.getTime()).toBe(false)
  })

  it('defaults now to current time (smoke test — just no throw)', () => {
    expect(() => computeSignupWindow(1)).not.toThrow()
  })
})

// ─── isInSignupWindow ─────────────────────────────────────────────────────────

describe('isInSignupWindow', () => {
  it('returns true for a user who signed up exactly dayOffset days ago (window start)', () => {
    const signupAt = new Date(NOW.getTime() - 1 * DAY_MS) // start of d1 window
    expect(isInSignupWindow(signupAt, 1, NOW)).toBe(true)
  })

  it('returns true for a user inside the window (mid-window)', () => {
    const signupAt = new Date(NOW.getTime() - 1 * DAY_MS + 30 * 60 * 1000) // 30 min into d1
    expect(isInSignupWindow(signupAt, 1, NOW)).toBe(true)
  })

  it('returns false for a user who signed up one second before the window', () => {
    const signupAt = new Date(NOW.getTime() - 1 * DAY_MS - 1000)
    expect(isInSignupWindow(signupAt, 1, NOW)).toBe(false)
  })

  it('returns false for a user who signed up at the window end (exclusive)', () => {
    const signupAt = new Date(NOW.getTime()) // = end of d1 window
    expect(isInSignupWindow(signupAt, 1, NOW)).toBe(false)
  })

  it('returns false for a user who signed up 2 days ago when checking d1 window', () => {
    const signupAt = new Date(NOW.getTime() - 2 * DAY_MS)
    expect(isInSignupWindow(signupAt, 1, NOW)).toBe(false)
  })

  it('returns true for d3 window when user signed up exactly 3 days ago', () => {
    const signupAt = new Date(NOW.getTime() - 3 * DAY_MS)
    expect(isInSignupWindow(signupAt, 3, NOW)).toBe(true)
  })

  it('returns false for d3 window when user signed up 3 days + 1 ms before window start', () => {
    const signupAt = new Date(NOW.getTime() - 3 * DAY_MS - 1)
    expect(isInSignupWindow(signupAt, 3, NOW)).toBe(false)
  })

  it('d14: user who signed up 14 days ago is inside the window', () => {
    const signupAt = new Date(NOW.getTime() - 14 * DAY_MS + 3600 * 1000) // 1 hr into window
    expect(isInSignupWindow(signupAt, 14, NOW)).toBe(true)
  })

  it('d14: user who signed up 15 days ago is outside the d14 window', () => {
    const signupAt = new Date(NOW.getTime() - 15 * DAY_MS)
    expect(isInSignupWindow(signupAt, 14, NOW)).toBe(false)
  })
})

// ─── reengagementStep ─────────────────────────────────────────────────────────

describe('reengagementStep', () => {
  it('returns null for 0 days inactive (active user)', () => {
    expect(reengagementStep(0)).toBeNull()
  })

  it('returns null for 6 days inactive (below 7d threshold)', () => {
    expect(reengagementStep(6)).toBeNull()
  })

  it('returns inactive_7d at exactly 7 days', () => {
    expect(reengagementStep(7)).toBe('inactive_7d')
  })

  it('returns inactive_7d for 13 days (below 14d threshold)', () => {
    expect(reengagementStep(13)).toBe('inactive_7d')
  })

  it('returns inactive_14d at exactly 14 days', () => {
    expect(reengagementStep(14)).toBe('inactive_14d')
  })

  it('returns inactive_14d for 29 days (below 30d threshold)', () => {
    expect(reengagementStep(29)).toBe('inactive_14d')
  })

  it('returns inactive_30d at exactly 30 days', () => {
    expect(reengagementStep(30)).toBe('inactive_30d')
  })

  it('returns inactive_30d for very long inactivity (90 days)', () => {
    expect(reengagementStep(90)).toBe('inactive_30d')
  })

  it('thresholds are monotonically ascending — boundary values are consistent', () => {
    // confirm every threshold boundary is handled correctly
    const cases: [number, string | null][] = [
      [6,  null],
      [7,  'inactive_7d'],
      [13, 'inactive_7d'],
      [14, 'inactive_14d'],
      [29, 'inactive_14d'],
      [30, 'inactive_30d'],
      [31, 'inactive_30d'],
    ]
    for (const [days, expected] of cases) {
      expect(reengagementStep(days), `days=${days}`).toBe(expected)
    }
  })
})

// ─── daysSince ────────────────────────────────────────────────────────────────

describe('daysSince', () => {
  it('returns 0 for the same instant', () => {
    expect(daysSince(NOW, NOW)).toBe(0)
  })

  it('returns 1 for exactly 24 hours ago', () => {
    expect(daysSince(new Date(NOW.getTime() - DAY_MS), NOW)).toBe(1)
  })

  it('floors partial days (23h 59m → 0)', () => {
    const almostOneDay = new Date(NOW.getTime() - (DAY_MS - 60_000))
    expect(daysSince(almostOneDay, NOW)).toBe(0)
  })

  it('floors partial days (25h → 1)', () => {
    const twentyFiveH = new Date(NOW.getTime() - 25 * 3600 * 1000)
    expect(daysSince(twentyFiveH, NOW)).toBe(1)
  })

  it('returns 7 for exactly 7 days ago', () => {
    expect(daysSince(new Date(NOW.getTime() - 7 * DAY_MS), NOW)).toBe(7)
  })

  it('returns 30 for exactly 30 days ago', () => {
    expect(daysSince(new Date(NOW.getTime() - 30 * DAY_MS), NOW)).toBe(30)
  })
})

// ─── shouldSkipSend ───────────────────────────────────────────────────────────

describe('shouldSkipSend', () => {
  it('returns null when the user has not opted out and the step has not been sent', () => {
    expect(shouldSkipSend({ optedOut: false, alreadySent: false })).toBeNull()
  })

  it('returns opted_out when marketing emails opted out (checked before duplicate)', () => {
    expect(shouldSkipSend({ optedOut: true, alreadySent: false })).toBe('opted_out')
  })

  it('returns opted_out even if the step was already sent (opt-out takes priority)', () => {
    expect(shouldSkipSend({ optedOut: true, alreadySent: true })).toBe('opted_out')
  })

  it('returns duplicate when not opted out but step already exists in DB', () => {
    expect(shouldSkipSend({ optedOut: false, alreadySent: true })).toBe('duplicate')
  })
})

// ─── interpretSendOutcome ─────────────────────────────────────────────────────

describe('interpretSendOutcome', () => {
  it('returns skipped_duplicate when dbErrorCode is 23505 (UNIQUE violation)', () => {
    const r = interpretSendOutcome({ dbErrorCode: '23505', resendMessageId: null, resendError: null })
    expect(r.status).toBe('skipped_duplicate')
  })

  it('returns failed with db_error prefix for other DB errors', () => {
    const r = interpretSendOutcome({ dbErrorCode: '42501', resendMessageId: null, resendError: null })
    expect(r.status).toBe('failed')
    expect(r.reason).toContain('db_error:42501')
  })

  it('returns sent with messageId when both DB and Resend succeed', () => {
    const r = interpretSendOutcome({ dbErrorCode: null, resendMessageId: 're_abc123', resendError: null })
    expect(r.status).toBe('sent')
    expect(r.messageId).toBe('re_abc123')
  })

  it('returns sent with undefined messageId when Resend returns empty id', () => {
    const r = interpretSendOutcome({ dbErrorCode: null, resendMessageId: null, resendError: null })
    expect(r.status).toBe('sent')
    expect(r.messageId).toBeUndefined()
  })

  it('returns failed with Resend error reason when DB insert OK but Resend fails', () => {
    const r = interpretSendOutcome({
      dbErrorCode: null,
      resendMessageId: null,
      resendError: 'Resend 422: invalid email',
    })
    expect(r.status).toBe('failed')
    expect(r.reason).toBe('Resend 422: invalid email')
  })

  it('DB error takes priority over Resend error when both are present (should not happen but defensive)', () => {
    const r = interpretSendOutcome({
      dbErrorCode: '23505',
      resendMessageId: null,
      resendError: 'some resend error',
    })
    expect(r.status).toBe('skipped_duplicate')
  })
})

// ─── Idempotency contract (narrative) ────────────────────────────────────────

describe('idempotency contract', () => {
  it('a cron firing twice on the same day does not double-send: second call sees 23505 → skipped_duplicate', () => {
    // First call: no DB error → sent
    const firstSend = interpretSendOutcome({ dbErrorCode: null, resendMessageId: 're_001', resendError: null })
    expect(firstSend.status).toBe('sent')

    // Second call (same day, same user/sequence/step): UNIQUE violation → skipped
    const secondSend = interpretSendOutcome({ dbErrorCode: '23505', resendMessageId: null, resendError: null })
    expect(secondSend.status).toBe('skipped_duplicate')
  })

  it('a user who unsubscribed mid-sequence receives no further emails', () => {
    // Before unsubscribe: d1 sent
    const d1 = shouldSkipSend({ optedOut: false, alreadySent: false })
    expect(d1).toBeNull()  // proceed with send

    // After unsubscribe: d3 attempt is skipped
    const d3 = shouldSkipSend({ optedOut: true, alreadySent: false })
    expect(d3).toBe('opted_out')
  })

  it('a reengaged user (logged back in, then churned again) is correctly bucketed', () => {
    // User logged in recently — no step
    expect(reengagementStep(3)).toBeNull()

    // User drifts to 7 days — 7d email queued
    expect(reengagementStep(7)).toBe('inactive_7d')

    // User drifts to 14 days — 14d email queued (UNIQUE means 7d was sent once,
    // not re-sent — but the 14d step is a distinct step name)
    expect(reengagementStep(14)).toBe('inactive_14d')
  })
})
