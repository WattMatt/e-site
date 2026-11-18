import { describe, expect, it } from 'vitest'
import { calendarSeedsFromProjectSettings, DEFAULT_SHUTDOWN } from './calendars'
import { ProgrammeOpError } from './errors'

const settings = (over = {}) => ({
  projectStart: '2026-03-02', workingDays: [1, 2, 3, 4, 5], extraHolidays: [] as string[],
  shutdown: { ...DEFAULT_SHUTDOWN }, seededYears: [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032], ...over,
})
const holidays = [
  { day: '2026-03-21', name: 'Human Rights Day' },
  { day: '2026-12-25', name: 'Christmas Day' },
  { day: '2020-01-01', name: 'out of window' },
]

describe('calendarSeedsFromProjectSettings', () => {
  it('Office = working days, Site = working days + Saturday, 8 hours', () => {
    const { site, office } = calendarSeedsFromProjectSettings(settings(), holidays)
    expect(office).toMatchObject({ name: 'Office', variant: 'office', workWeekdays: [1, 2, 3, 4, 5], hoursPerDay: 8 })
    expect(site).toMatchObject({ name: 'Site', variant: 'site', workWeekdays: [1, 2, 3, 4, 5, 6], hoursPerDay: 8 })
    expect(calendarSeedsFromProjectSettings(settings({ workingDays: [6, 1, 1, 9] }), []).site.workWeekdays).toEqual([1, 6])
  })
  it('refuses an empty working-day set with the SQL sentence', () => {
    expect(() => calendarSeedsFromProjectSettings(settings({ workingDays: [] }), [])).toThrow(
      new ProgrammeOpError('The project has no working days set. Set them in the project settings first.', '22023'))
  })
  it('holidays and extra holidays go on both; the shutdown on Site only; window -1y..+5y', () => {
    const { site, office } = calendarSeedsFromProjectSettings(settings({ extraHolidays: ['2026-06-01', '2040-01-01'] }), holidays)
    const days = (c: typeof site) => c.exceptions.map((e) => e.day)
    expect(days(office)).toEqual(['2026-03-21', '2026-06-01', '2026-12-25'])
    expect(office.exceptions[1]?.label).toBe('Project holiday')
    expect(days(site)).toContain('2026-03-21')
    expect(days(site)).toContain('2026-12-16')
    expect(days(office)).not.toContain('2026-12-16')
    expect(site.exceptions.every((e) => e.kind === 'non_work')).toBe(true)
  })
  it('the shutdown wraps the year end and is inclusive', () => {
    const { site } = calendarSeedsFromProjectSettings(settings(), [])
    const d = site.exceptions.map((e) => e.day)
    expect(d).toContain('2026-12-15')
    expect(d).toContain('2027-01-01')
    expect(d).toContain('2027-01-15')
    expect(d).not.toContain('2027-01-16')
    expect(d).not.toContain('2026-12-14')
    expect(d).toContain('2026-01-05') // the January tail of the previous season (window starts 2025-03-02)
    expect(site.exceptions.find((e) => e.day === '2026-12-20')?.label).toBe("Builders' shutdown")
  })
  it('a public holiday name wins over the shutdown and project holiday', () => {
    const { site } = calendarSeedsFromProjectSettings(settings({ extraHolidays: ['2026-12-25'] }), holidays)
    expect(site.exceptions.find((e) => e.day === '2026-12-25')?.label).toBe('Christmas Day')
    expect(site.exceptions.filter((e) => e.day === '2026-12-25')).toHaveLength(1)
    const { site: s2 } = calendarSeedsFromProjectSettings(settings({ extraHolidays: ['2026-12-20'] }), [])
    expect(s2.exceptions.find((e) => e.day === '2026-12-20')?.label).toBe('Project holiday')
  })
  it('no shutdown when disabled; a non-wrapping window works', () => {
    const off = calendarSeedsFromProjectSettings(settings({ shutdown: { enabled: false, startMd: '12-15', endMd: '01-15' } }), [])
    expect(off.site.exceptions).toEqual([])
    const mid = calendarSeedsFromProjectSettings(settings({ shutdown: { enabled: true, startMd: '07-01', endMd: '07-03' } }), [])
    expect(mid.site.exceptions.map((e) => e.day)).toContain('2026-07-02')
    expect(mid.site.exceptions.map((e) => e.day)).not.toContain('2026-12-20')
  })
  it('coverage is the window clipped to the seeded years, null when none overlap', () => {
    expect(calendarSeedsFromProjectSettings(settings(), []).site.coverage).toEqual({ from: '2025-03-02', to: '2031-03-02' })
    expect(calendarSeedsFromProjectSettings(settings({ seededYears: [2026, 2027] }), []).office.coverage).toEqual({ from: '2026-01-01', to: '2027-12-31' })
    expect(calendarSeedsFromProjectSettings(settings({ seededYears: [2010] }), []).office.coverage).toBeNull()
    expect(calendarSeedsFromProjectSettings(settings({ seededYears: [] }), []).office.coverage).toBeNull()
  })
  it('month-end clamps the window (Postgres interval arithmetic)', () => {
    const { office } = calendarSeedsFromProjectSettings(settings({ projectStart: '2028-02-29', seededYears: [2020, 2040] }), [])
    expect(office.coverage).toEqual({ from: '2027-02-28', to: '2033-02-28' })
  })
})
