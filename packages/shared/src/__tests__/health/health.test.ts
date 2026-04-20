import { describe, it, expect } from 'vitest'
import {
  computeHealthScore,
  normalizeLoginRecency,
  normalizeComplianceActivity,
  tierFromScore,
  HEALTH_WEIGHTS,
} from '../../services/health.service'

describe('normalizeLoginRecency', () => {
  it('gives 100 for a login today (0 days)', () => {
    expect(normalizeLoginRecency(0)).toBe(100)
  })

  it('gives 50 at the midpoint of the 30-day window', () => {
    expect(normalizeLoginRecency(15)).toBe(50)
  })

  it('clamps to 0 at the window boundary', () => {
    expect(normalizeLoginRecency(30)).toBe(0)
  })

  it('clamps to 0 beyond the window', () => {
    expect(normalizeLoginRecency(90)).toBe(0)
  })

  it('treats null (never logged in) as 0', () => {
    expect(normalizeLoginRecency(null)).toBe(0)
  })

  it('treats negative input defensively as 0', () => {
    expect(normalizeLoginRecency(-5)).toBe(0)
  })
})

describe('normalizeComplianceActivity', () => {
  it('gives 0 for zero uploads', () => {
    expect(normalizeComplianceActivity(0)).toBe(0)
  })

  it('gives 50 at half the benchmark', () => {
    expect(normalizeComplianceActivity(5)).toBe(50)
  })

  it('saturates at 100 when benchmark is hit', () => {
    expect(normalizeComplianceActivity(10)).toBe(100)
  })

  it('clamps to 100 above the benchmark', () => {
    expect(normalizeComplianceActivity(42)).toBe(100)
  })

  it('treats negative input defensively as 0', () => {
    expect(normalizeComplianceActivity(-3)).toBe(0)
  })
})

describe('tierFromScore', () => {
  // Boundaries per spec-v2.md §17:
  //   GREEN 70–100 · YELLOW 40–69 · ORANGE 20–39 · RED 0–19
  it.each<[number, ReturnType<typeof tierFromScore>]>([
    [0,   'red'],
    [19,  'red'],
    [20,  'orange'],
    [39,  'orange'],
    [40,  'yellow'],
    [69,  'yellow'],
    [70,  'green'],
    [100, 'green'],
  ])('score %i → tier %s', (score, expected) => {
    expect(tierFromScore(score)).toBe(expected)
  })
})

describe('computeHealthScore', () => {
  it('applies the Phase 1 weights (60% login, 40% compliance)', () => {
    expect(HEALTH_WEIGHTS.loginRecency).toBe(0.6)
    expect(HEALTH_WEIGHTS.complianceActivity).toBe(0.4)
  })

  it('gives 100 for a perfect org: logged in today + 10 uploads last 30d', () => {
    const result = computeHealthScore({ loginRecencyDays: 0, complianceCountLast30d: 10 })
    expect(result.score).toBe(100)
    expect(result.tier).toBe('green')
  })

  it('gives 0 for a fully disengaged org: never logged in + no uploads', () => {
    const result = computeHealthScore({ loginRecencyDays: null, complianceCountLast30d: 0 })
    expect(result.score).toBe(0)
    expect(result.tier).toBe('red')
  })

  it('weights login at 60% and compliance at 40%', () => {
    // login today (100) but zero compliance → 100*0.6 + 0 = 60 → yellow
    const loginOnly = computeHealthScore({ loginRecencyDays: 0, complianceCountLast30d: 0 })
    expect(loginOnly.score).toBe(60)
    expect(loginOnly.tier).toBe('yellow')

    // no login (0) but perfect compliance (100) → 0 + 100*0.4 = 40 → yellow (boundary)
    const complOnly = computeHealthScore({ loginRecencyDays: null, complianceCountLast30d: 10 })
    expect(complOnly.score).toBe(40)
    expect(complOnly.tier).toBe('yellow')
  })

  it('lands in GREEN for a realistically healthy org', () => {
    // logged in 2 days ago (~93) + 8 uploads (80) → 93*0.6 + 80*0.4 = 55.8 + 32 = 87.8 → 88
    const result = computeHealthScore({ loginRecencyDays: 2, complianceCountLast30d: 8 })
    expect(result.score).toBe(88)
    expect(result.tier).toBe('green')
  })

  it('lands in RED for a realistically at-risk org (spec worked example)', () => {
    // logged in 21 days ago → normalizeLoginRecency(21) = 100 - (21/30)*100 = 30
    // 0 compliance uploads → 0
    // score = 30*0.6 + 0*0.4 = 18 → RED
    const result = computeHealthScore({ loginRecencyDays: 21, complianceCountLast30d: 0 })
    expect(result.score).toBe(18)
    expect(result.tier).toBe('red')
  })

  it('returns a signals breakdown for debugging + audit', () => {
    const result = computeHealthScore({ loginRecencyDays: 15, complianceCountLast30d: 5 })
    expect(result.signals.login_recency).toEqual({
      raw: 15,
      normalized: 50,
      weight: 0.6,
      contribution: 30,
    })
    expect(result.signals.compliance_activity).toEqual({
      raw: 5,
      normalized: 50,
      weight: 0.4,
      contribution: 20,
    })
    expect(result.score).toBe(50)
    expect(result.tier).toBe('yellow')
  })

  it('never exceeds 100 even with extreme inputs', () => {
    const result = computeHealthScore({ loginRecencyDays: 0, complianceCountLast30d: 9999 })
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.score).toBe(100)
  })

  it('never falls below 0', () => {
    const result = computeHealthScore({ loginRecencyDays: 9999, complianceCountLast30d: -5 })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBe(0)
  })
})
