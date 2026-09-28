/**
 * The Solar schedule template (spec §14.1 "Use template"). Stored per org in
 * solar.schedule_templates.content = { version: 1, items }. Offsets and
 * durations are in the schedule's duration mode. Instantiation forward-
 * schedules each item after its predecessors, so a seeded programme breaks no
 * link (asserted with criticalPath in the test).
 */
import { addCalendarDays, type CalendarDate } from './dates'
import { endForDuration, nextWorkingDate, shiftDate, type WorkCalendar } from './calendar'
import { findCycle, isLinkType, topoOrder, type LinkType } from './graph'
import type { ImportPlan, PlannedTask } from './import/plan'

export interface ScheduleTemplateItem {
  key: string
  name: string
  category: string
  zone: string
  /** Earliest start, in days after the chosen start date. */
  offsetDays: number
  durationDays: number
  isMilestone: boolean
  after: Array<{ key: string; type: LinkType; lagDays: number }>
}

export const SCHEDULE_TEMPLATE_VERSION = 1

const i = (key: string, name: string, category: string, durationDays: number, after: ScheduleTemplateItem['after'] = [], isMilestone = false): ScheduleTemplateItem =>
  ({ key, name, category, zone: '', offsetDays: 0, durationDays: isMilestone ? 0 : durationDays, isMilestone, after })
const fs = (key: string, lagDays = 0) => ({ key, type: 'FS' as const, lagDays })

export const DEFAULT_SOLAR_SCHEDULE_TEMPLATE: ScheduleTemplateItem[] = [
  i('survey', 'Site survey and design brief', 'Design', 5),
  i('design', 'Detailed design and PV layout', 'Design', 10, [fs('survey')]),
  i('structural', 'Structural assessment of the roof', 'Design', 5, [fs('survey')]),
  i('sseg_submit', 'SSEG application submitted', 'Approvals', 0, [fs('design')], true),
  i('sseg_approval', 'Utility SSEG approval', 'Approvals', 30, [fs('sseg_submit')]),
  i('procure_pv', 'Procure modules and inverters', 'Procurement', 20, [fs('design')]),
  i('procure_bos', 'Procure mounting and balance of system', 'Procurement', 15, [fs('design')]),
  i('mounting', 'Install mounting structure', 'Installation', 10, [fs('procure_bos'), fs('structural')]),
  i('modules', 'Install modules', 'Installation', 10, [{ key: 'mounting', type: 'SS', lagDays: 3 }, fs('procure_pv')]),
  i('inverters', 'Install inverters and AC reticulation', 'Installation', 5, [{ key: 'modules', type: 'FF', lagDays: 0 }]),
  i('commission', 'Testing and commissioning', 'Commissioning', 5, [fs('inverters'), fs('sseg_approval')]),
  i('coc', 'Certificate of Compliance and utility witness test', 'Commissioning', 2, [fs('commission')]),
  i('handover', 'Handover pack and client training', 'Handover', 3, [fs('coc')]),
  i('completion', 'Practical completion', 'Handover', 0, [fs('handover')], true),
]

export function validateScheduleTemplate(items: readonly ScheduleTemplateItem[]): string[] {
  const errors: string[] = []
  const keys = new Set<string>()
  for (const it of items) {
    if (keys.has(it.key)) errors.push(`Two items share the key "${it.key}".`)
    keys.add(it.key)
    if (!it.key.trim()) errors.push('An item has no key.')
    if (!it.name.trim()) errors.push('An item has no name.')
    if (!Number.isInteger(it.offsetDays) || it.offsetDays < 0) errors.push(`Item "${it.key}" starts before day 0.`)
    if (!it.isMilestone && (!Number.isInteger(it.durationDays) || it.durationDays < 1)) errors.push(`Item "${it.key}" needs a duration of at least 1 day.`)
  }
  for (const it of items) {
    for (const a of it.after) {
      if (!keys.has(a.key)) errors.push(`Item "${it.key}" follows "${a.key}", which is not in the template.`)
      if (!isLinkType(a.type)) errors.push(`Item "${it.key}" has an unknown link type.`)
    }
  }
  const cycle = findCycle([...keys], items.flatMap((it) => it.after.filter((a) => keys.has(a.key))
    .map((a) => ({ predecessorId: a.key, successorId: it.key, type: a.type, lagDays: a.lagDays }))))
  if (cycle) errors.push(`The template has a loop: ${[...cycle, cycle[0]].join(' → ')}.`)
  return errors
}

function isItem(v: unknown): v is ScheduleTemplateItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.key === 'string' && typeof o.name === 'string' && typeof o.category === 'string'
    && typeof o.zone === 'string' && typeof o.offsetDays === 'number' && typeof o.durationDays === 'number'
    && typeof o.isMilestone === 'boolean' && Array.isArray(o.after)
    && o.after.every((a) => a && typeof a === 'object' && typeof (a as { key?: unknown }).key === 'string'
      && isLinkType((a as { type?: unknown }).type) && typeof (a as { lagDays?: unknown }).lagDays === 'number')
}

/** solar.schedule_templates.content → items, or null (caller falls back to the default). */
export function readScheduleTemplate(stored: unknown): ScheduleTemplateItem[] | null {
  if (!stored || typeof stored !== 'object') return null
  const items = (stored as { items?: unknown }).items
  if (!Array.isArray(items) || !items.every(isItem)) return null
  return validateScheduleTemplate(items).length === 0 ? items : null
}

export function instantiateScheduleTemplate(items: readonly ScheduleTemplateItem[], start: CalendarDate, cal: WorkCalendar): ImportPlan {
  const byKey = new Map(items.map((it) => [it.key, it]))
  const links = items.flatMap((it) => it.after.map((a) => ({ fromKey: a.key, toKey: it.key, type: a.type, lagDays: a.lagDays })))
  const topo = topoOrder(items.map((it) => it.key), links.map((l) => ({ predecessorId: l.fromKey, successorId: l.toKey, type: l.type, lagDays: l.lagDays })))
  if (!topo.ok) throw new Error('The template has a loop')
  const placed = new Map<string, { start: CalendarDate; end: CalendarDate }>()
  // FS: next unit after the predecessor's end, plus lag. Units follow the calendar's mode.
  const after = (d: CalendarDate, n: number) => (cal.mode === 'working' ? shiftDate(cal, d, n) : addCalendarDays(d, n))
  const startForFinish = (finish: CalendarDate, days: number) => after(finish, -(days - 1))
  for (const key of topo.order) {
    const it = byKey.get(key)!
    const days = it.isMilestone ? 1 : it.durationDays
    let s = after(start, it.offsetDays)
    if (cal.mode === 'working') s = nextWorkingDate(cal, s)
    for (const a of it.after) {
      const p = placed.get(a.key)!
      const cand =
        a.type === 'FS' ? after(p.end, 1 + a.lagDays)
          : a.type === 'SS' ? after(p.start, a.lagDays)
            : a.type === 'FF' ? startForFinish(after(p.end, a.lagDays), days)
              : startForFinish(after(p.start, a.lagDays), days)
      if (cand > s) s = cand
    }
    if (cal.mode === 'working') s = nextWorkingDate(cal, s)
    placed.set(key, { start: s, end: it.isMilestone ? s : endForDuration(cal, s, it.durationDays) })
  }
  const tasks: PlannedTask[] = items.map((it) => ({
    key: it.key, sourceRow: null, name: it.name, category: it.category, zone: it.zone,
    start: placed.get(it.key)!.start, end: placed.get(it.key)!.end, isMilestone: it.isMilestone,
    progress: 0, status: 'not_started', colour: null, ownerHint: null, description: '', segments: [],
  }))
  return { tasks, links }
}
