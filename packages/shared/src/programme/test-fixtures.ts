import type { ActivityInput, DependencyInput, ProgrammeInput } from './types'

export const act = (id: string, over: Partial<ActivityInput> = {}): ActivityInput => ({
  id, parentId: null, type: 'task', originalDuration: 1, remainingDuration: null, calendarId: null,
  constraint: null, deadline: null, actualStart: null, actualFinish: null, fixed: null, ...over,
})
export const dep = (id: string, predId: string, succId: string, over: Partial<DependencyInput> = {}): DependencyInput => ({
  id, predId, succId, type: 'FS', lag: 0, lagUnit: 'working_days', lagCalendar: 'succ', ...over,
})
export const prog = (activities: ActivityInput[], dependencies: DependencyInput[] = [], over: Partial<ProgrammeInput> = {}): ProgrammeInput => ({
  projectStart: '2026-03-02', dataDate: null, defaultCalendarId: 'C',
  calendars: [{ id: 'C', workWeekdays: [1, 2, 3, 4, 5], hoursPerDay: 8, nonWorkDates: [], workDates: [], coverage: { from: '2026-01-01', to: '2027-12-31' } }],
  activities, dependencies,
  options: { rules: 'msp', progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'smallest' },
  ...over,
})
