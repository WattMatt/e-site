// packages/shared/src/lib/jbcc/working-days.test.ts
import { describe, it, expect } from 'vitest'
import {
  addWorkingDays, computeDeadline, deadlineStatus, crossesBuildersHoliday,
} from './working-days'

const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('addWorkingDays', () => {
  it('skips Saturday and Sunday', () => {
    // Fri 5 Jun 2026 + 1 WD = Mon 8 Jun 2026
    expect(iso(addWorkingDays(D('2026-06-05'), 1))).toBe('2026-06-08')
  })

  it('skips SA public holidays (Youth Day Tue 16 Jun 2026)', () => {
    // Mon 15 Jun + 2 WD: Tue 16 (holiday) skipped → Wed 17, Thu 18 → result Thu 18.
    expect(iso(addWorkingDays(D('2026-06-15'), 2))).toBe('2026-06-18')
  })

  it('returns the trigger date when n=0', () => {
    expect(iso(addWorkingDays(D('2026-07-01'), 0))).toBe('2026-07-01')
  })
})

describe('computeDeadline', () => {
  it('WD time-bar: 20 WD from Mon 1 Jun 2026, skipping Youth Day, lands ~Tue 30 Jun 2026', () => {
    const r = computeDeadline(
      { time_bar_days: 20, time_bar_unit: 'WD' },
      D('2026-06-01'),
    )
    expect(iso(r!)).toBe('2026-06-30')
  })

  it('CD time-bar: 14 CD from Mon 1 Jun 2026 = Mon 15 Jun 2026', () => {
    const r = computeDeadline(
      { time_bar_days: 14, time_bar_unit: 'CD' },
      D('2026-06-01'),
    )
    expect(iso(r!)).toBe('2026-06-15')
  })

  it('returns null when the notice has no numeric time-bar (e.g. "promptly")', () => {
    expect(computeDeadline({ time_bar_days: null, time_bar_unit: null }, D('2026-06-01'))).toBeNull()
  })
})

describe('deadlineStatus', () => {
  it('past deadline → overdue', () => {
    expect(deadlineStatus(D('2026-06-15'), D('2026-06-20'))).toBe('overdue')
  })
  it('null deadline → no_deadline', () => {
    expect(deadlineStatus(null, D('2026-06-15'))).toBe('no_deadline')
  })
  it('> 5 WD remaining → clear', () => {
    expect(deadlineStatus(D('2026-07-15'), D('2026-07-01'))).toBe('clear')
  })
  it('≤ 5 WD remaining → due_soon', () => {
    expect(deadlineStatus(D('2026-07-06'), D('2026-07-01'))).toBe('due_soon')
  })
})

describe('crossesBuildersHoliday', () => {
  it('true when the window touches the Dec–Jan shutdown', () => {
    expect(crossesBuildersHoliday(D('2026-12-10'), D('2027-01-20'))).toBe(true)
    expect(crossesBuildersHoliday(D('2026-12-20'), D('2027-01-05'))).toBe(true)
  })
  it('false for windows outside the Dec–Jan shutdown', () => {
    expect(crossesBuildersHoliday(D('2026-06-01'), D('2026-06-30'))).toBe(false)
  })
})
