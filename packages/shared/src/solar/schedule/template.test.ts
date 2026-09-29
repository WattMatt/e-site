import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SOLAR_SCHEDULE_TEMPLATE, instantiateScheduleTemplate, validateScheduleTemplate, readScheduleTemplate,
  type ScheduleTemplateItem,
} from './template'
import { validateImportPlan } from './import/plan'
import { criticalPath } from './cpm'
import { makeWorkCalendar, saHolidaySet, isWorkingDate, nextWorkingDate } from './calendar'
import { addCalendarDays } from './dates'

const wcal = makeWorkCalendar('working', saHolidaySet(2026, 2027))
const cal = makeWorkCalendar('calendar')

describe('the default template', () => {
  it('is valid and covers design, approvals, procurement, installation, commissioning, handover', () => {
    expect(validateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE)).toEqual([])
    expect(new Set(DEFAULT_SOLAR_SCHEDULE_TEMPLATE.map((i) => i.category)))
      .toEqual(new Set(['Design', 'Approvals', 'Procurement', 'Installation', 'Commissioning', 'Handover']))
  })
})

describe('instantiateScheduleTemplate', () => {
  for (const [name, c] of [['working', wcal], ['calendar', cal]] as const) {
    it(`${name} mode: seeded programme breaks no link and passes import validation`, () => {
      const plan = instantiateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE, '2026-10-01', c)
      expect(validateImportPlan(plan)).toEqual([])
      const cpm = criticalPath(
        plan.tasks.map((t) => ({ id: t.key, start: t.start, end: t.end, isMilestone: t.isMilestone })),
        plan.links.map((l) => ({ predecessorId: l.fromKey, successorId: l.toKey, type: l.type, lagDays: l.lagDays })),
        c,
      )
      expect(cpm.ok && cpm.violations).toEqual([])
      expect(plan.tasks[0].start).toBe('2026-10-01')
      // The critical chain runs THROUGH the milestones: nothing mid-programme gets float from a milestone.
      if (!cpm.ok) throw new Error('cycle')
      expect(cpm.critical.has('completion')).toBe(true)
      expect(cpm.critical.has('handover')).toBe(true)
      expect(cpm.critical.has('sseg_submit')).toBe(true)
      expect(cpm.critical.has('design')).toBe(true)
      expect(cpm.critical.has('survey')).toBe(true)
      expect(cpm.totalFloat.get('sseg_submit')).toBe(0)
    })
    it(`${name} mode: an FS milestone sits ON its predecessor's finish, and its successor starts the next day`, () => {
      const plan = instantiateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE, '2026-10-01', c)
      const by = (k: string) => plan.tasks.find((t) => t.key === k)!
      expect(by('sseg_submit').start).toBe(by('design').end)
      expect(by('completion').start).toBe(by('handover').end)
      const next = c.mode === 'working' ? nextWorkingDate(c, addCalendarDays(by('sseg_submit').start, 1)) : addCalendarDays(by('sseg_submit').start, 1)
      expect(by('sseg_approval').start).toBe(next)
    })
  }
  it('working mode starts every task on a working day', () => {
    const plan = instantiateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE, '2026-10-03', wcal) // a Saturday
    for (const t of plan.tasks) expect(isWorkingDate(wcal, t.start)).toBe(true)
  })
  it('FS lag and SS lag are honoured', () => {
    const items: ScheduleTemplateItem[] = [
      { key: 'a', name: 'A', category: 'X', zone: '', offsetDays: 0, durationDays: 3, isMilestone: false, after: [] },
      { key: 'b', name: 'B', category: 'X', zone: '', offsetDays: 0, durationDays: 2, isMilestone: false, after: [{ key: 'a', type: 'FS', lagDays: 2 }] },
      { key: 'c', name: 'C', category: 'X', zone: '', offsetDays: 0, durationDays: 2, isMilestone: false, after: [{ key: 'a', type: 'SS', lagDays: 1 }] },
    ]
    const p = instantiateScheduleTemplate(items, '2026-10-01', cal)
    expect(p.tasks.find((t) => t.key === 'b')).toMatchObject({ start: '2026-10-06', end: '2026-10-07' })
    expect(p.tasks.find((t) => t.key === 'c')).toMatchObject({ start: '2026-10-02', end: '2026-10-03' })
  })
})

describe('validateScheduleTemplate / readScheduleTemplate', () => {
  it('refuses duplicate keys, unknown predecessors and loops', () => {
    const bad: ScheduleTemplateItem[] = [
      { key: 'a', name: 'A', category: '', zone: '', offsetDays: 0, durationDays: 1, isMilestone: false, after: [{ key: 'b', type: 'FS', lagDays: 0 }] },
      { key: 'b', name: 'B', category: '', zone: '', offsetDays: 0, durationDays: 1, isMilestone: false, after: [{ key: 'a', type: 'FS', lagDays: 0 }] },
      { key: 'b', name: '', category: '', zone: '', offsetDays: -1, durationDays: 0, isMilestone: false, after: [{ key: 'z', type: 'FS', lagDays: 0 }] },
    ]
    const errors = validateScheduleTemplate(bad)
    expect(errors).toEqual(expect.arrayContaining([
      'Two items share the key "b".', 'An item has no name.', 'Item "b" starts before day 0.',
      'Item "b" needs a duration of at least 1 day.', 'Item "b" follows "z", which is not in the template.',
    ]))
    expect(errors.some((e) => e.startsWith('The template has a loop'))).toBe(true)
  })
  it('reads a stored { version, items } and falls back to null on anything else', () => {
    expect(readScheduleTemplate({ version: 1, items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE })).toHaveLength(DEFAULT_SOLAR_SCHEDULE_TEMPLATE.length)
    expect(readScheduleTemplate({ version: 1, items: [{ key: 'x' }] })).toBeNull()
    expect(readScheduleTemplate(null)).toBeNull()
  })
})
