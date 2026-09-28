/** A spreadsheet-shaped table (CSV or XLSX) → ImportPlan, through a column mapping the user can correct. */
import { fromDayNumber, isCalendarDate, type CalendarDate } from '../dates'
import { endForDuration, type WorkCalendar } from '../calendar'
import { isLinkType, type LinkType } from '../graph'
import type { GanttStatus } from '../status'
import type { ImportIssue, ImportPlan, PlannedLink, PlannedTask } from './plan'

export const IMPORT_FIELDS = [
  'name', 'category', 'zone', 'start', 'end', 'duration', 'owner', 'progress', 'status', 'milestone', 'predecessors', 'notes', 'colour',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
export type ImportMapping = Record<ImportField, number | null>

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Task name', category: 'Category', zone: 'Zone', start: 'Start date', end: 'End date', duration: 'Duration (days)',
  owner: 'Owner', progress: 'Progress %', status: 'Status', milestone: 'Milestone', predecessors: 'Predecessors',
  notes: 'Notes', colour: 'Colour',
}

const SYNONYMS: Record<ImportField, string[]> = {
  name: ['task', 'task name', 'name', 'activity', 'description of work'],
  category: ['category', 'phase', 'group'],
  zone: ['zone', 'area', 'location'],
  start: ['start', 'start date', 'begin'],
  end: ['end', 'end date', 'finish', 'finish date'],
  duration: ['duration', 'days', 'duration (days)'],
  owner: ['owner', 'assigned to', 'resource', 'resource names', 'responsible'],
  progress: ['progress', 'progress (%)', '% complete', 'percent complete', 'complete'],
  status: ['status'],
  milestone: ['milestone'],
  predecessors: ['predecessors', 'depends on', 'dependencies'],
  notes: ['notes', 'comments', 'remarks'],
  colour: ['colour', 'color'],
}

export function guessImportMapping(header: readonly string[]): ImportMapping {
  const norm = header.map((h) => h.trim().toLowerCase())
  const out = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ImportMapping
  for (const f of IMPORT_FIELDS) {
    const i = norm.findIndex((h) => SYNONYMS[f].includes(h))
    if (i !== -1) out[f] = i
  }
  return out
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const EXCEL_EPOCH_OFFSET = 25569 // days from 1899-12-30 (Excel day 0) to 1970-01-01

function ymd(y: number, m: number, d: number): CalendarDate | null {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isCalendarDate(s) ? s : null
}

/** ISO, day-first (SA) numeric, "1 Oct 2026", or an Excel serial. Month-first US dates are NOT read. */
export function parseLooseDate(raw: string): CalendarDate | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) return ymd(+m[3], +m[2], +m[1])
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    return mi === -1 ? null : ymd(+m[3], mi + 1, +m[1])
  }
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s)
    if (serial >= 20000 && serial <= 80000) return fromDayNumber(serial - EXCEL_EPOCH_OFFSET)
  }
  return null
}

export function parseProgress(raw: string): number | null {
  const s = raw.trim().replace('%', '')
  if (s === '') return 0
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const pct = !raw.includes('%') && n > 0 && n <= 1 && s.includes('.') ? n * 100 : n
  return Math.min(100, Math.max(0, Math.round(pct)))
}

export function parsePredecessors(raw: string): Array<{ position: number; type: LinkType; lagDays: number }> | null {
  const s = raw.trim()
  if (!s) return []
  const out: Array<{ position: number; type: LinkType; lagDays: number }> = []
  for (const part of s.split(/[,;]/)) {
    const m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*(?:d|days?|wd)?)?$/i.exec(part.trim())
    if (!m) return null
    const type = (m[2] ?? 'FS').toUpperCase()
    if (!isLinkType(type)) return null
    out.push({ position: Number(m[1]), type, lagDays: m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0 })
  }
  return out
}

function parseStatusCell(raw: string): GanttStatus | null {
  const s = raw.trim().toLowerCase().replace(/[_-]/g, ' ')
  if (!s) return null
  if (['done', 'complete', 'completed', 'finished'].includes(s)) return 'done'
  if (['in progress', 'started', 'underway', 'busy'].includes(s)) return 'in_progress'
  if (['not started', 'todo', 'to do', 'planned', 'pending'].includes(s)) return 'not_started'
  return null
}

const truthy = (s: string) => ['yes', 'y', 'true', '1', 'x'].includes(s.trim().toLowerCase())

export function mapImportTable(
  rows: readonly string[][],
  mapping: ImportMapping,
  cal: WorkCalendar,
): { plan: ImportPlan; issues: ImportIssue[] } {
  if (mapping.name === null) return { plan: { tasks: [], links: [] }, issues: [{ row: null, message: 'Choose which column holds the task name.' }] }
  if (mapping.start === null) return { plan: { tasks: [], links: [] }, issues: [{ row: null, message: 'Choose which column holds the start date.' }] }
  const cell = (r: readonly string[], f: ImportField) => (mapping[f] === null ? '' : (r[mapping[f] as number] ?? '').trim())
  const issues: ImportIssue[] = []
  const tasks: PlannedTask[] = []
  const pending: Array<{ key: string; row: number; raw: string }> = []
  let position = 0
  rows.forEach((r, i) => {
    if (i === 0 || r.every((c) => c.trim() === '')) return
    const rowNo = i + 1
    position++
    const key = `p${position}`
    const name = cell(r, 'name')
    const startRaw = cell(r, 'start')
    const start = parseLooseDate(startRaw)
    if (!name) { issues.push({ row: rowNo, message: `Row ${rowNo}: the task has no name.` }); return }
    if (!start) { issues.push({ row: rowNo, message: `Row ${rowNo}: "${startRaw}" is not a date. Use 2026-10-01 or 01/10/2026.` }); return }
    const durRaw = cell(r, 'duration')
    const isMilestone = truthy(cell(r, 'milestone')) || durRaw === '0'
    let end: CalendarDate | null = start
    if (!isMilestone) {
      const endRaw = cell(r, 'end')
      if (endRaw) {
        end = parseLooseDate(endRaw)
        if (!end) { issues.push({ row: rowNo, message: `Row ${rowNo}: "${endRaw}" is not a date. Use 2026-10-01 or 01/10/2026.` }); return }
      } else if (durRaw) {
        const d = Number(durRaw)
        if (!Number.isInteger(d) || d < 1) { issues.push({ row: rowNo, message: `Row ${rowNo}: duration "${durRaw}" must be a whole number of days.` }); return }
        end = endForDuration(cal, start, d)
      }
    }
    const progress = parseProgress(cell(r, 'progress'))
    if (progress === null) { issues.push({ row: rowNo, message: `Row ${rowNo}: progress "${cell(r, 'progress')}" is not a percentage.` }); return }
    const status = parseStatusCell(cell(r, 'status')) ?? (progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'not_started')
    const colourRaw = cell(r, 'colour').toLowerCase()
    tasks.push({
      key, sourceRow: rowNo, name, category: cell(r, 'category'), zone: cell(r, 'zone'),
      start, end: end as CalendarDate, isMilestone, progress: status === 'done' ? 100 : progress, status,
      colour: /^#[0-9a-f]{6}$/.test(colourRaw) ? colourRaw : null,
      ownerHint: cell(r, 'owner') || null, description: cell(r, 'notes'), segments: [],
    })
    const pred = cell(r, 'predecessors')
    if (pred) pending.push({ key, row: rowNo, raw: pred })
  })
  const keys = new Set(tasks.map((t) => t.key))
  const links: PlannedLink[] = []
  for (const p of pending) {
    const parsed = parsePredecessors(p.raw)
    if (!parsed) { issues.push({ row: p.row, message: `Row ${p.row}: predecessors "${p.raw}" should look like 3FS+2d, 5SS.` }); continue }
    for (const x of parsed) {
      const from = `p${x.position}`
      if (!keys.has(from)) { issues.push({ row: p.row, message: `Row ${p.row}: predecessor ${x.position} is not a task in this file.` }); continue }
      links.push({ fromKey: from, toKey: p.key, type: x.type, lagDays: x.lagDays })
    }
  }
  return { plan: { tasks, links }, issues }
}
