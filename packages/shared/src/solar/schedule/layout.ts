/**
 * Gantt geometry (spec §14.2). Pure: the Konva component draws exactly what
 * this returns. Rows come from buildScheduleRows, so a group header is a row
 * here as in the list. Bars snap to whole days: a task covers
 * [start, end + 1 day) in x.
 */
import { addCalendarDays, daysBetween, formatCalendarDate, maxCalendarDate, minCalendarDate, weekdayOf, type CalendarDate } from './dates'
import { isWeekendDate, type WorkCalendar } from './calendar'
import { linkKey, type ScheduleLink } from './graph'
import type { ScheduleRow } from './rows'

export const SCHEDULE_ZOOMS = ['day', 'week', 'month'] as const
export type ScheduleZoom = (typeof SCHEDULE_ZOOMS)[number]
export const GANTT_DAY_WIDTH: Record<ScheduleZoom, number> = { day: 36, week: 14, month: 4 }
export const GANTT_ROW_HEIGHT = 28
export const GANTT_HEADER_HEIGHT = 40
export const GANTT_MAX_WIDTH = 16_000
const BAR_PAD = 6

export interface GanttBar {
  taskId: string
  rowIndex: number
  kind: 'task' | 'milestone' | 'segment'
  segmentIndex: number | null
  x: number
  y: number
  w: number
  h: number
  colour: string
  progress: number
  critical: boolean
}
export interface GanttBaselineBar { taskId: string; x: number; y: number; w: number }
export interface GanttLinkPath { key: string; points: number[]; critical: boolean }
export interface GanttShade { x: number; w: number; kind: 'weekend' | 'holiday' }
export interface GanttTick { x: number; label: string; major: boolean }

export interface GanttLayout {
  rangeStart: CalendarDate
  rangeEnd: CalendarDate
  zoom: ScheduleZoom
  clamped: boolean
  dayWidth: number
  width: number
  height: number
  ticks: GanttTick[]
  shades: GanttShade[]
  todayX: number | null
  bars: GanttBar[]
  baselineBars: GanttBaselineBar[]
  links: GanttLinkPath[]
}

export interface GanttLayoutInput {
  rows: readonly ScheduleRow[]
  zoom: ScheduleZoom
  cal: WorkCalendar
  today: CalendarDate
  splitBars: boolean
  links: readonly ScheduleLink[]
  showLinks: boolean
  critical: ReadonlySet<string>
  criticalLinks: ReadonlySet<string>
  baseline: ReadonlyMap<string, { start: CalendarDate; end: CalendarDate }> | null
}

export function xOfDate(l: Pick<GanttLayout, 'rangeStart' | 'dayWidth'>, d: CalendarDate): number {
  return daysBetween(l.rangeStart, d) * l.dayWidth
}

export function dateAtX(l: Pick<GanttLayout, 'rangeStart' | 'dayWidth'>, x: number): CalendarDate {
  return addCalendarDays(l.rangeStart, Math.floor(x / l.dayWidth))
}

export function layoutGantt(input: GanttLayoutInput): GanttLayout {
  const taskRows = input.rows.flatMap((r, i) => (r.kind === 'task' ? [{ i, t: r.task }] : []))
  const dates = taskRows.flatMap(({ t }) => [t.start, t.end])
  if (input.baseline) for (const b of input.baseline.values()) dates.push(b.start, b.end)
  const lo = minCalendarDate(dates)
  const hi = maxCalendarDate(dates)
  const rangeStart = addCalendarDays(lo ?? input.today, -7)
  const rangeEnd = addCalendarDays(hi ?? input.today, lo ? 14 : 30)
  const days = daysBetween(rangeStart, rangeEnd) + 1

  let zoom = input.zoom
  let clamped = false
  while (days * GANTT_DAY_WIDTH[zoom] > GANTT_MAX_WIDTH && zoom !== 'month') {
    zoom = zoom === 'day' ? 'week' : 'month'
    clamped = true
  }
  const dw = GANTT_DAY_WIDTH[zoom]
  const geo = { rangeStart, dayWidth: dw }
  const x = (d: CalendarDate) => xOfDate(geo, d)

  const ticks: GanttTick[] = []
  const shades: GanttShade[] = []
  for (let d = rangeStart; d <= rangeEnd; d = addCalendarDays(d, 1)) {
    const wd = weekdayOf(d)
    if (zoom === 'day') ticks.push({ x: x(d), label: String(Number(d.slice(8))), major: wd === 1 })
    else if (zoom === 'week' && wd === 1) ticks.push({ x: x(d), label: formatCalendarDate(d).split(' ').slice(0, 2).join(' '), major: true })
    else if (zoom === 'month' && d.endsWith('-01')) ticks.push({ x: x(d), label: formatCalendarDate(d).split(' ').slice(1).join(' '), major: true })
    if (input.cal.holidays.has(d)) shades.push({ x: x(d), w: dw, kind: 'holiday' })
    else if (isWeekendDate(d)) shades.push({ x: x(d), w: dw, kind: 'weekend' })
  }

  const bars: GanttBar[] = []
  const baselineBars: GanttBaselineBar[] = []
  const anchors = new Map<string, { left: number; right: number; cy: number }>()
  for (const { i, t } of taskRows) {
    const top = GANTT_HEADER_HEIGHT + i * GANTT_ROW_HEIGHT
    const y = top + BAR_PAD
    const h = GANTT_ROW_HEIGHT - 2 * BAR_PAD
    const common = { taskId: t.id, rowIndex: i, y, h, colour: t.colour, progress: t.progress, critical: input.critical.has(t.id) }
    if (t.isMilestone) {
      const cx = x(t.start) + dw / 2
      bars.push({ ...common, kind: 'milestone', segmentIndex: null, x: cx, w: 0 })
      anchors.set(t.id, { left: cx, right: cx, cy: y + h / 2 })
    } else {
      if (input.splitBars && t.segments.length >= 2) {
        t.segments.forEach((s, k) => bars.push({ ...common, kind: 'segment', segmentIndex: k, x: x(s.start), w: (daysBetween(s.start, s.end) + 1) * dw }))
      } else {
        bars.push({ ...common, kind: 'task', segmentIndex: null, x: x(t.start), w: (daysBetween(t.start, t.end) + 1) * dw })
      }
      anchors.set(t.id, { left: x(t.start), right: x(t.end) + dw, cy: y + h / 2 })
    }
    const b = input.baseline?.get(t.id)
    if (b) baselineBars.push({ taskId: t.id, x: x(b.start), y: top + GANTT_ROW_HEIGHT - 5, w: (daysBetween(b.start, b.end) + 1) * dw })
  }

  const links: GanttLinkPath[] = []
  if (input.showLinks) {
    for (const l of input.links) {
      const a = anchors.get(l.predecessorId)
      const b = anchors.get(l.successorId)
      if (!a || !b) continue
      const from = l.type[0] === 'F' ? a.right : a.left
      const to = l.type[1] === 'S' ? b.left : b.right
      const y1 = a.cy
      const y2 = b.cy
      let points: number[]
      if (l.type[1] === 'S') {
        if (to >= from + 12) points = [from, y1, from + 6, y1, from + 6, y2, to, y2]
        else {
          const yMid = y2 - GANTT_ROW_HEIGHT / 2
          points = [from, y1, from + 6, y1, from + 6, yMid, to - 6, yMid, to - 6, y2, to, y2]
        }
      } else {
        const xr = Math.max(from, to) + 6
        points = [from, y1, xr, y1, xr, y2, to, y2]
      }
      links.push({ key: linkKey(l), points, critical: input.criticalLinks.has(linkKey(l)) })
    }
  }

  const todayX = input.today >= rangeStart && input.today <= rangeEnd ? x(input.today) : null
  return {
    rangeStart, rangeEnd, zoom, clamped, dayWidth: dw, width: days * dw,
    height: GANTT_HEADER_HEIGHT + input.rows.length * GANTT_ROW_HEIGHT,
    ticks, shades, todayX, bars, baselineBars, links,
  }
}
