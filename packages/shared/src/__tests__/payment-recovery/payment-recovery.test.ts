import { describe, it, expect } from 'vitest'
import { decideRecoveryAction, daysSince } from '../../services/payment-recovery.service'

const ORG = 'org-test'
const MS = 86_400_000

function daysAgo(n: number, from: Date = new Date('2026-05-01T00:00:00Z')): Date {
  return new Date(from.getTime() - n * MS)
}

const NOW = new Date('2026-05-01T00:00:00Z')

describe('daysSince', () => {
  it('returns floored whole days', () => {
    const ts = new Date('2026-04-28T23:00:00Z')  // ~2.04 days before NOW
    expect(daysSince(ts, NOW)).toBe(2)
  })
})

describe('decideRecoveryAction — happy path', () => {
  it('no-ops for a healthy subscription', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 0,
      lastFailureAt: null,
      currentStatus: 'active',
      now: NOW,
    })
    expect(a.step).toBe('none')
    expect(a.emailStep).toBeNull()
    expect(a.pauseProjects).toBe(false)
  })

  it('no-ops inside the Paystack auto-retry window (day 0–2)', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 1,
      lastFailureAt: daysAgo(1),
      currentStatus: 'past_due',
      now: NOW,
    })
    expect(a.step).toBe('none')
  })

  it('no-ops when already cancelled', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 3,
      lastFailureAt: daysAgo(45),
      currentStatus: 'cancelled',
      now: NOW,
    })
    expect(a.step).toBe('none')
  })
})

describe('decideRecoveryAction — stage transitions', () => {
  it('Day 3 → retry-failed email, no status change', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 2,
      lastFailureAt: daysAgo(3),
      currentStatus: 'past_due',
      now: NOW,
    })
    expect(a.step).toBe('day3_retry_failed')
    expect(a.emailStep).toBe('day3_retry_failed')
    expect(a.setSubscriptionStatus).toBeNull()
    expect(a.pauseProjects).toBe(false)
    expect(a.cancelSubscription).toBe(false)
  })

  it('Day 7 → final-warning email + grace_period', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 2,
      lastFailureAt: daysAgo(7),
      currentStatus: 'past_due',
      now: NOW,
    })
    expect(a.step).toBe('day7_final_warning')
    expect(a.emailStep).toBe('day7_final_warning')
    expect(a.setSubscriptionStatus).toBe('grace_period')
    expect(a.pauseProjects).toBe(false)
  })

  it('Day 7 when already in grace_period → email only, no status change', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 2,
      lastFailureAt: daysAgo(8),
      currentStatus: 'grace_period',
      now: NOW,
    })
    expect(a.step).toBe('day7_final_warning')
    expect(a.emailStep).toBe('day7_final_warning')
    expect(a.setSubscriptionStatus).toBeNull()
  })

  it('Day 14 → pause projects + status=paused', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 3,
      lastFailureAt: daysAgo(14),
      currentStatus: 'grace_period',
      now: NOW,
    })
    expect(a.step).toBe('day14_paused')
    expect(a.emailStep).toBe('day14_paused')
    expect(a.setSubscriptionStatus).toBe('paused')
    expect(a.pauseProjects).toBe(true)
    expect(a.cancelSubscription).toBe(false)
  })

  it('Day 14 is a no-op when already paused (idempotent)', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 3,
      lastFailureAt: daysAgo(14),
      currentStatus: 'paused',
      now: NOW,
    })
    expect(a.step).toBe('none')
    expect(a.pauseProjects).toBe(false)
  })

  it('Day 30 → cancel subscription', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 3,
      lastFailureAt: daysAgo(30),
      currentStatus: 'paused',
      now: NOW,
    })
    expect(a.step).toBe('day30_cancelled')
    expect(a.emailStep).toBe('day30_cancelled')
    expect(a.setSubscriptionStatus).toBe('cancelled')
    expect(a.cancelSubscription).toBe(true)
  })

  it('Day 45 (cron missed days) → still cancels, no double-action', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 3,
      lastFailureAt: daysAgo(45),
      currentStatus: 'paused',
      now: NOW,
    })
    expect(a.step).toBe('day30_cancelled')
  })
})

describe('decideRecoveryAction — boundary behaviour', () => {
  it('exactly at Day 2 boundary → still in auto-retry window', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 1,
      lastFailureAt: daysAgo(2),
      currentStatus: 'past_due',
      now: NOW,
    })
    expect(a.step).toBe('none')
  })

  it('exactly at Day 3 boundary → fires Day 3 email', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 1,
      lastFailureAt: daysAgo(3),
      currentStatus: 'past_due',
      now: NOW,
    })
    expect(a.step).toBe('day3_retry_failed')
  })

  it('Day 6 is still Day 3 stage', () => {
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 2,
      lastFailureAt: daysAgo(6),
      currentStatus: 'past_due',
      now: NOW,
    })
    expect(a.step).toBe('day3_retry_failed')
  })

  it('cron misses Day 3–6 → Day 7 still triggers the grace-period transition', () => {
    // Even though the Day 3 email never fired, the state machine correctly
    // advances to Day 7 — the email_sequence_events UNIQUE key means the
    // Day 3 email can still be sent later if needed (or skipped; it's OK
    // either way since the user knows about the failure by now).
    const a = decideRecoveryAction({
      organisationId: ORG,
      failureCount: 2,
      lastFailureAt: daysAgo(7),
      currentStatus: 'past_due',
      now: NOW,
    })
    expect(a.step).toBe('day7_final_warning')
    expect(a.setSubscriptionStatus).toBe('grace_period')
  })
})
