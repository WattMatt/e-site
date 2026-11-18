/**
 * MSPDI (MS Project XML, "File → Save As → XML Format") → a plain programme
 * description. Pure: takes a DOM `Document` the caller built with DOMParser
 * (browser, or jsdom in tests) and never touches the DOM it renders into.
 *
 * Units (plan P4a Global Constraints):
 * - `Duration` is ISO-8601 (`PT40H0M0S`, working hours) ÷ the file's
 *   `MinutesPerDay` (default 480) → working days, 2 dp. An elapsed duration
 *   is hours ÷ 24 → calendar days, used as the working-day count (the engine
 *   has no elapsed durations), with a warning.
 * - `LinkLag` is tenths of a minute. Working formats (m/h/d/w/mo) ÷
 *   MinutesPerDay → working days; elapsed formats ÷ 1440 → elapsed days;
 *   percent formats ÷ 10 → percent.
 *
 * Element lookup is by local name, so a default namespace, a prefix or no
 * namespace all read the same. Booleans accept 0/1 and true/false.
 */
import {
  addCalendarDays,
  daysBetween,
  isCalendarDate,
  weekdayOf,
  type CalendarDate,
} from '../../lib/dates/calendar-date'
import type { ConstraintType, LagUnit, LinkType } from '../types'

export const MSPDI_NAMESPACE = 'http://schemas.microsoft.com/project'

export const MSPDI_NOT_MSPDI_ERROR =
  'This is not an MS Project XML file. Open the programme in MS Project and use File → Save As → XML Format, then import the .xml file.'

export interface MspdiException {
  from: CalendarDate
  to: CalendarDate
  working: boolean
  name: string
}
export interface MspdiCalendar {
  uid: string
  name: string
  isBase: boolean
  /** ISO weekdays, 1 = Mon … 7 = Sun, ascending. */
  workWeekdays: number[]
  /** Ranges; a recurring exception is expanded into one single-day entry per occurrence. */
  exceptions: MspdiException[]
}
export interface MspdiLink {
  uid: string
  type: LinkType
  lag: number
  lagUnit: LagUnit
}
export interface MspdiTask {
  uid: string
  name: string
  outlineLevel: number
  wbs: string | null
  outlineNumber: string | null
  summary: boolean
  /** True only for a milestone flag on a zero-duration task. */
  milestone: boolean
  /** Manually scheduled in MS Project; a manual non-summary task is pinned with MSO at its start. */
  manual: boolean
  durationDays: number
  constraint: { type: ConstraintType; date: CalendarDate | null } | null
  deadline: CalendarDate | null
  actualStart: CalendarDate | null
  actualFinish: CalendarDate | null
  percentComplete: number
  calendarUid: string | null
  start: CalendarDate | null
  finish: CalendarDate | null
  baselineStart: CalendarDate | null
  baselineFinish: CalendarDate | null
  predecessors: MspdiLink[]
}
export interface MspdiProgramme {
  name: string
  startDate: CalendarDate
  minutesPerDay: number
  daysPerWeek: number
  daysPerMonth: number
  calendars: MspdiCalendar[]
  projectCalendarUid: string | null
  tasks: MspdiTask[]
  skipped: { inactive: number; nulls: number }
  warnings: string[]
}
export type MspdiParseResult = MspdiProgramme | { error: string }

const DEFAULT_MINUTES_PER_DAY = 480
const DEFAULT_MINUTES_PER_WEEK = 2400
const DEFAULT_DAYS_PER_MONTH = 20
const MINUTES_PER_ELAPSED_DAY = 1440
const MON_TO_FRI = [1, 2, 3, 4, 5]
const BOM = String.fromCharCode(0xfeff)

const LINK_TYPES: Record<string, LinkType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' }
const CONSTRAINTS: Record<string, ConstraintType | null> = {
  '0': null, '1': 'alap', '2': 'mso', '3': 'mfo', '4': 'snet', '5': 'snlt', '6': 'fnet', '7': 'fnlt',
}
const FINISH_CONSTRAINTS = new Set<ConstraintType>(['mfo', 'fnet', 'fnlt'])
/** MSPDI duration/lag formats: 3 m, 4 em, 5 h, 6 eh, 7 d, 8 ed, 9 w, 10 ew, 11 mo, 12 emo, 19 %, 20 e%. */
const WORKING_FORMATS = new Set([3, 5, 7, 9, 11])
const ELAPSED_FORMATS = new Set([4, 6, 8, 10, 12])
const PERCENT_FORMATS = new Set([19, 20])
const ELAPSED_DURATION_FORMATS = new Set([4, 6, 8, 10, 12, 20])

// ---------------------------------------------------------------- DOM helpers

function childElements(el: Element, name: string): Element[] {
  const out: Element[] = []
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) out.push(c)
  }
  return out
}
function childElement(el: Element, name: string): Element | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) return c
  }
  return null
}
/** Trimmed text of a direct child, or null when absent or blank. */
function childText(el: Element, name: string): string | null {
  const c = childElement(el, name)
  const t = c?.textContent?.trim() ?? ''
  return t === '' ? null : t
}
function childNumber(el: Element, name: string): number | null {
  const t = childText(el, name)
  if (t === null) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
/** xsd:boolean: 1/true → true, 0/false → false (any case), anything else → null. */
function childBool(el: Element, name: string): boolean | null {
  const t = childText(el, name)?.toLowerCase()
  if (t === '1' || t === 'true') return true
  if (t === '0' || t === 'false') return false
  return null
}
const flag = (el: Element, name: string) => childBool(el, name) === true

// ---------------------------------------------------------------- value helpers

const round2 = (n: number) => Math.round(n * 100) / 100 + 0 // + 0 turns -0 into 0

/** The date part of an MSPDI local datetime (`2026-10-09T08:00:00`). */
function datePart(raw: string | null): CalendarDate | null {
  if (raw === null) return null
  const d = raw.slice(0, 10)
  return isCalendarDate(d) ? d : null
}
/** A finish-type datetime: exactly 00:00 is the end of the previous day. */
function finishDatePart(raw: string | null): CalendarDate | null {
  const d = datePart(raw)
  if (d === null || raw === null) return d
  return /^T00:00(:00(\.0+)?)?$/.test(raw.slice(10)) ? addCalendarDays(d, -1) : d
}

const ISO_DURATION =
  /^(-)?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/

/** ISO-8601 duration → minutes. Years and months are refused (null). A `D` part is 24 hours. */
export function isoDurationMinutes(raw: string): number | null {
  const m = ISO_DURATION.exec(raw.trim())
  if (!m || raw.trim() === 'P' || raw.trim() === 'PT') return null
  const [, neg, d, h, min, s] = m
  const minutes =
    Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Number(s ?? 0) / 60
  return neg ? -minutes : minutes
}

/** Estimated formats ("3d?") are the plain format + 32. */
function plainFormat(n: number): number {
  return n >= 35 && n <= 52 ? n - 32 : n
}

// ---------------------------------------------------------------- calendar arithmetic

const pad2 = (n: number) => String(n).padStart(2, '0')
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
const ymd = (y: number, m0: number, d: number): CalendarDate => `${y}-${pad2(m0 + 1)}-${pad2(d)}`

function addYears(d: CalendarDate, n: number): CalendarDate {
  const y = Number(d.slice(0, 4)) + n
  const m0 = Number(d.slice(5, 7)) - 1
  return ymd(y, m0, Math.min(Number(d.slice(8, 10)), daysInMonth(y, m0)))
}

/**
 * The `position`-th `weekday` (0 = Sun) of a month; position 0–3 = first–fourth,
 * 4 = last.
 */
function nthWeekdayOfMonth(y: number, m0: number, position: number, weekday: number): CalendarDate {
  if (position === 4) {
    const last = ymd(y, m0, daysInMonth(y, m0))
    return addCalendarDays(last, -((weekdayOf(last) - weekday + 7) % 7))
  }
  const first = ymd(y, m0, 1)
  return addCalendarDays(first, ((weekday - weekdayOf(first) + 7) % 7) + 7 * position)
}

// ---------------------------------------------------------------- recurring exceptions

interface Window {
  from: CalendarDate
  to: CalendarDate
}

/**
 * Expand a 2007+ `<Exception>` recurrence into dates.
 * Types: 1 daily, 2 yearly by date, 3 yearly by position, 4 monthly by day,
 * 5 monthly by position, 6 weekly. `Month` is 0-based, `MonthPosition` 0–3 =
 * first–fourth and 4 = last, `MonthItem` 3–9 = Sunday–Saturday, `DaysOfWeek`
 * is a mask with 1 = Sunday … 64 = Saturday.
 * Returns the dates, or a reason string when the recurrence cannot be read.
 */
function expandRecurrence(ex: Element, type: number, from: CalendarDate, win: Window): CalendarDate[] | string {
  const period = Math.max(1, Math.trunc(childNumber(ex, 'Period') ?? 1))
  const occurrences = Math.trunc(childNumber(ex, 'Occurrences') ?? 0)
  const byOccurrences = flag(ex, 'EnteredByOccurrences') && occurrences > 0
  const period_ = childElement(ex, 'TimePeriod')
  const toBound = period_ ? datePart(childText(period_, 'ToDate')) : null
  if (!byOccurrences && toBound === null) return 'it has neither an end date nor a number of occurrences'
  const end = toBound !== null && toBound < win.to ? toBound : win.to
  const limit = byOccurrences ? occurrences : Number.POSITIVE_INFINITY

  const y0 = Number(from.slice(0, 4))
  const m00 = Number(from.slice(5, 7)) - 1
  let next: (i: number) => CalendarDate | null // i-th candidate in ascending order, null = past the end of time

  const monthRaw = childNumber(ex, 'Month')
  const monthDay = childNumber(ex, 'MonthDay')
  const position = childNumber(ex, 'MonthPosition')
  const item = childNumber(ex, 'MonthItem')
  const weekdayFromItem = () => (item !== null && item >= 3 && item <= 9 ? item - 3 : null)

  switch (type) {
    case 1:
      next = (i) => addCalendarDays(from, i * period)
      break
    case 6: {
      const mask = Math.trunc(childNumber(ex, 'DaysOfWeek') ?? 0)
      if (mask <= 0 || mask > 127) return 'it names no weekday'
      const weekStart = addCalendarDays(from, -weekdayOf(from))
      // Pre-compute the dates once; `next` walks the list.
      const dates: CalendarDate[] = []
      for (let d = from; d <= end; d = addCalendarDays(d, 1)) {
        const week = Math.floor(daysBetween(weekStart, d) / 7)
        if (week % period === 0 && (mask & (1 << weekdayOf(d))) !== 0) dates.push(d)
      }
      next = (i) => dates[i] ?? null
      break
    }
    case 4:
    case 5: {
      const weekday = weekdayFromItem()
      if (type === 4 && (monthDay === null || monthDay < 1 || monthDay > 31)) return 'its day of the month is missing'
      if (type === 5 && (weekday === null || position === null || position < 0 || position > 4)) {
        return 'its position in the month is not a specific weekday'
      }
      const dates: CalendarDate[] = []
      for (let k = 0; ; k++) {
        const total = m00 + k * period
        const y = y0 + Math.floor(total / 12)
        const m0 = total % 12
        if (ymd(y, m0, 1) > end) break
        const d =
          type === 4
            ? ymd(y, m0, Math.min(monthDay as number, daysInMonth(y, m0)))
            : nthWeekdayOfMonth(y, m0, position as number, weekday as number)
        if (d >= from) dates.push(d)
      }
      next = (i) => dates[i] ?? null
      break
    }
    case 2:
    case 3: {
      const m0 = monthRaw !== null && monthRaw >= 0 && monthRaw <= 11 ? monthRaw : m00
      const weekday = weekdayFromItem()
      if (type === 3 && (weekday === null || position === null || position < 0 || position > 4)) {
        return 'its position in the month is not a specific weekday'
      }
      const day = monthDay !== null && monthDay >= 1 && monthDay <= 31 ? monthDay : Number(from.slice(8, 10))
      const dates: CalendarDate[] = []
      for (let y = y0; ymd(y, m0, 1) <= end; y++) {
        const d =
          type === 2
            ? ymd(y, m0, Math.min(day, daysInMonth(y, m0)))
            : nthWeekdayOfMonth(y, m0, position as number, weekday as number)
        if (d >= from) dates.push(d)
      }
      next = (i) => dates[i] ?? null
      break
    }
    default:
      return `its recurrence type ${type} is not supported`
  }

  const out: CalendarDate[] = []
  for (let i = 0; i < limit; i++) {
    const d = next(i)
    if (d === null || d > end) break
    if (d >= win.from) out.push(d)
  }
  return out
}

// ---------------------------------------------------------------- calendars

interface RawCalendar {
  uid: string
  name: string
  isBase: boolean
  baseUid: string | null
  weekOverrides: Map<number, boolean>
  exceptions: MspdiException[]
}

function readCalendar(el: Element, win: Window, warnings: string[]): RawCalendar | null {
  const uid = childText(el, 'UID')
  if (uid === null) {
    warnings.push('A calendar without a UID was ignored.')
    return null
  }
  const name = childText(el, 'Name') ?? ''
  const label = `Calendar "${name}" (UID ${uid})`
  const baseRaw = childText(el, 'BaseCalendarUID')
  const weekOverrides = new Map<number, boolean>()
  const legacyExceptions: MspdiException[] = []

  const weekDays = childElement(el, 'WeekDays')
  for (const wd of weekDays ? childElements(weekDays, 'WeekDay') : []) {
    const dayType = childNumber(wd, 'DayType')
    const working = flag(wd, 'DayWorking')
    if (dayType !== null && dayType >= 1 && dayType <= 7) {
      // MSPDI DayType 1 = Sunday … 7 = Saturday → ISO 1 = Monday … 7 = Sunday.
      weekOverrides.set(dayType === 1 ? 7 : dayType - 1, working)
    } else if (dayType === 0) {
      const period = childElement(wd, 'TimePeriod')
      const from = period ? datePart(childText(period, 'FromDate')) : null
      const to = period ? datePart(childText(period, 'ToDate')) : null
      if (from && to && from <= to) legacyExceptions.push({ from, to, working, name: '' })
      else warnings.push(`${label}: an exception with unreadable dates was not imported.`)
    }
  }

  let exceptions = legacyExceptions
  const exceptionsEl = childElement(el, 'Exceptions')
  if (exceptionsEl) {
    // 2007+ files: <Exceptions> is the source of truth; the DayType 0 copies are ignored.
    exceptions = []
    for (const ex of childElements(exceptionsEl, 'Exception')) {
      const exName = childText(ex, 'Name') ?? ''
      const working = flag(ex, 'DayWorking')
      const type = childNumber(ex, 'Type') ?? 1
      const period = Math.max(1, Math.trunc(childNumber(ex, 'Period') ?? 1))
      const tp = childElement(ex, 'TimePeriod')
      const from = tp ? datePart(childText(tp, 'FromDate')) : null
      let to = tp ? datePart(childText(tp, 'ToDate')) : null
      if (!from) {
        warnings.push(`${label}: the exception "${exName}" has unreadable dates and was not imported.`)
        continue
      }
      if (type === 1 && period === 1) {
        // A plain range: kept as one entry.
        const occ = Math.trunc(childNumber(ex, 'Occurrences') ?? 0)
        if (to === null && occ > 0) to = addCalendarDays(from, occ - 1)
        if (to === null || from > to) {
          warnings.push(`${label}: the exception "${exName}" has unreadable dates and was not imported.`)
          continue
        }
        exceptions.push({ from, to, working, name: exName })
        continue
      }
      const dates = expandRecurrence(ex, type, from, win)
      if (typeof dates === 'string') {
        warnings.push(`${label}: the recurring exception "${exName}" was not imported because ${dates}. Add those dates by hand.`)
        continue
      }
      for (const d of dates) exceptions.push({ from: d, to: d, working, name: exName })
    }
  }
  if (childElement(el, 'WorkWeeks')) {
    warnings.push(`${label}: alternative work weeks were not imported; the default week applies all year.`)
  }

  return {
    uid,
    name,
    isBase: flag(el, 'IsBaseCalendar'),
    baseUid: baseRaw === null || baseRaw === '-1' ? null : baseRaw,
    weekOverrides,
    exceptions,
  }
}

function resolveCalendars(raw: RawCalendar[]): MspdiCalendar[] {
  const byUid = new Map(raw.map((c) => [c.uid, c]))
  const memo = new Map<string, number[]>()
  const weekdaysOf = (c: RawCalendar, seen: Set<string>): number[] => {
    const cached = memo.get(c.uid)
    if (cached) return cached
    seen.add(c.uid)
    const base = !c.isBase && c.baseUid ? byUid.get(c.baseUid) : undefined
    const inherited = base && !seen.has(base.uid) ? weekdaysOf(base, seen) : MON_TO_FRI
    const set = new Set(inherited)
    for (const [day, working] of c.weekOverrides) {
      if (working) set.add(day)
      else set.delete(day)
    }
    const days = [...set].sort((a, b) => a - b)
    memo.set(c.uid, days)
    return days
  }
  return raw.map((c) => ({
    uid: c.uid,
    name: c.name,
    isBase: c.isBase,
    workWeekdays: weekdaysOf(c, new Set()),
    exceptions: c.exceptions,
  }))
}

// ---------------------------------------------------------------- tasks

function readLink(
  el: Element,
  label: string,
  minutesPerDay: number,
  warnings: string[],
): (MspdiLink & { crossProject: boolean }) | null {
  const uid = childText(el, 'PredecessorUID')
  if (uid === null) {
    warnings.push(`${label}: a link without a predecessor UID was dropped.`)
    return null
  }
  const typeRaw = childText(el, 'Type')
  let type: LinkType = 'FS'
  if (typeRaw !== null) {
    const mapped = LINK_TYPES[typeRaw]
    if (mapped) type = mapped
    else warnings.push(`${label}: link type ${typeRaw} from UID ${uid} is unknown and was read as FS.`)
  }
  const linkLag = childNumber(el, 'LinkLag') ?? 0
  const fmtRaw = childNumber(el, 'LagFormat')
  const fmt = plainFormat(fmtRaw ?? 7)
  let lag: number
  let lagUnit: LagUnit
  if (PERCENT_FORMATS.has(fmt)) {
    lag = linkLag / 10
    lagUnit = 'percent'
  } else if (ELAPSED_FORMATS.has(fmt)) {
    lag = linkLag / 10 / MINUTES_PER_ELAPSED_DAY
    lagUnit = 'elapsed_days'
  } else {
    // LinkLag is working minutes × 10 whatever the display unit. A file week is
    // MinutesPerWeek = DaysPerWeek × MinutesPerDay and a file month is
    // DaysPerMonth × MinutesPerDay, so ÷ MinutesPerDay gives days for all five.
    if (!WORKING_FORMATS.has(fmt)) {
      warnings.push(`${label}: lag format ${fmtRaw} on the link from UID ${uid} is unknown; the lag was read as working days.`)
    }
    lag = linkLag / 10 / minutesPerDay
    lagUnit = 'working_days'
  }
  return { uid, type, lag: round2(lag), lagUnit, crossProject: flag(el, 'CrossProject') }
}

function baselineZero(el: Element): Element | null {
  for (const b of childElements(el, 'Baseline')) {
    const n = childText(b, 'Number')
    if (n === null || n === '0') return b
  }
  return null
}

// ---------------------------------------------------------------- entry points

/** Parse MSPDI text (a leading BOM is stripped) with the global DOMParser. */
export function parseMspdiText(text: string): MspdiParseResult {
  if (typeof DOMParser === 'undefined') return { error: 'XML parsing is not available here.' }
  const clean = text.startsWith(BOM) ? text.slice(1) : text
  return parseMspdi(new DOMParser().parseFromString(clean, 'application/xml'))
}

export function parseMspdi(doc: Document): MspdiParseResult {
  const root = doc.documentElement
  if (!root || doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'Project') {
    return { error: MSPDI_NOT_MSPDI_ERROR }
  }
  const warnings: string[] = []
  if (root.namespaceURI === null) {
    warnings.push('The file does not declare the MS Project XML namespace; it was read as MS Project XML.')
  } else if (root.namespaceURI !== MSPDI_NAMESPACE) {
    return { error: MSPDI_NOT_MSPDI_ERROR }
  }

  // Units.
  let minutesPerDay = childNumber(root, 'MinutesPerDay') ?? DEFAULT_MINUTES_PER_DAY
  if (minutesPerDay <= 0) {
    warnings.push(`MinutesPerDay ${minutesPerDay} is not usable; 480 was used.`)
    minutesPerDay = DEFAULT_MINUTES_PER_DAY
  }
  let minutesPerWeek = childNumber(root, 'MinutesPerWeek') ?? DEFAULT_MINUTES_PER_WEEK
  if (minutesPerWeek <= 0) minutesPerWeek = DEFAULT_MINUTES_PER_WEEK
  let daysPerMonth = childNumber(root, 'DaysPerMonth') ?? DEFAULT_DAYS_PER_MONTH
  if (daysPerMonth <= 0) daysPerMonth = DEFAULT_DAYS_PER_MONTH

  // Tasks: first pass reads every row and applies the skip rules.
  const tasksEl = childElement(root, 'Tasks')
  const taskEls = tasksEl ? childElements(tasksEl, 'Task') : []
  const seen = new Set<string>()
  const skippedUids = new Set<string>()
  const skipped = { inactive: 0, nulls: 0 }
  let summaryName: string | null = null
  let inactiveLevel: number | null = null // outline level of the nearest inactive ancestor
  const kept: Array<{ task: MspdiTask; links: Element[] }> = []

  for (const el of taskEls) {
    if (flag(el, 'IsNull')) {
      skipped.nulls++
      continue
    }
    const uid = childText(el, 'UID')
    if (uid === null) {
      warnings.push('A task without a UID was ignored.')
      continue
    }
    if (seen.has(uid)) return { error: `The file has two tasks with UID ${uid}. Fix the file in MS Project and export it again.` }
    seen.add(uid)

    const name = childText(el, 'Name') ?? ''
    const label = `Task "${name}" (UID ${uid})`
    const outlineLevel = childNumber(el, 'OutlineLevel') ?? 1
    if (outlineLevel === 0) {
      summaryName = name || summaryName
      skippedUids.add(uid)
      continue
    }
    if (inactiveLevel !== null && outlineLevel <= inactiveLevel) inactiveLevel = null
    if (childBool(el, 'Active') === false) {
      skipped.inactive++
      skippedUids.add(uid)
      if (inactiveLevel === null) inactiveLevel = outlineLevel
      continue
    }
    if (flag(el, 'ExternalTask')) {
      warnings.push(`${label} is an external task from another project and was not imported.`)
      skippedUids.add(uid)
      continue
    }
    if (inactiveLevel !== null) {
      warnings.push(`${label} is active but sits under an inactive summary; it was imported.`)
    }

    const durationRaw = childText(el, 'Duration')
    const durationFormat = childNumber(el, 'DurationFormat')
    const elapsed = durationFormat !== null && ELAPSED_DURATION_FORMATS.has(plainFormat(durationFormat))
    let durationDays = 0
    if (durationRaw !== null) {
      const minutes = isoDurationMinutes(durationRaw)
      if (minutes === null) warnings.push(`${label}: the duration "${durationRaw}" could not be read and was set to 0.`)
      else durationDays = round2(minutes / (elapsed ? MINUTES_PER_ELAPSED_DAY : minutesPerDay))
    }
    if (elapsed) {
      warnings.push(`${label}: elapsed duration of ${durationDays} days imported as ${durationDays} working days.`)
    }

    const summary = flag(el, 'Summary')
    let milestone = false
    if (flag(el, 'Milestone')) {
      if (durationDays === 0) milestone = true
      else warnings.push(`${label}: marked as a milestone but has a duration of ${durationDays} days; it was imported as a task.`)
    }

    const constraintRaw = childText(el, 'ConstraintType')
    let constraint: MspdiTask['constraint'] = null
    if (constraintRaw !== null) {
      if (!(constraintRaw in CONSTRAINTS)) {
        warnings.push(`${label}: constraint type ${constraintRaw} is unknown and was ignored.`)
      } else {
        const type = CONSTRAINTS[constraintRaw]
        if (type === 'alap') constraint = { type, date: null }
        else if (type) {
          const rawDate = childText(el, 'ConstraintDate')
          const date = FINISH_CONSTRAINTS.has(type) ? finishDatePart(rawDate) : datePart(rawDate)
          if (date) constraint = { type, date }
          else warnings.push(`${label}: the ${type.toUpperCase()} constraint has no date and was ignored.`)
        }
      }
    }

    const start = datePart(childText(el, 'Start'))
    const manual = flag(el, 'Manual')
    if (manual) {
      const pin = start ?? datePart(childText(el, 'ManualStart'))
      if (summary) {
        warnings.push(`${label} is a manually scheduled summary in MS Project; its dates come from its tasks.`)
      } else if (pin) {
        constraint = { type: 'mso', date: pin }
        warnings.push(`${label} is manually scheduled in MS Project; it is pinned to start on ${pin}.`)
      } else {
        warnings.push(`${label} is manually scheduled in MS Project but has no start date; it is scheduled automatically.`)
      }
    }

    const calendarRaw = childText(el, 'CalendarUID')
    const baseline = baselineZero(el)
    const percent = childNumber(el, 'PercentComplete') ?? 0

    kept.push({
      links: childElements(el, 'PredecessorLink'),
      task: {
        uid,
        name,
        outlineLevel,
        wbs: childText(el, 'WBS'),
        outlineNumber: childText(el, 'OutlineNumber'),
        summary,
        milestone,
        manual,
        durationDays,
        constraint,
        deadline: finishDatePart(childText(el, 'Deadline')),
        actualStart: datePart(childText(el, 'ActualStart')),
        actualFinish: finishDatePart(childText(el, 'ActualFinish')),
        percentComplete: Math.min(100, Math.max(0, percent)),
        calendarUid: calendarRaw === null || calendarRaw === '-1' ? null : calendarRaw,
        start,
        finish: finishDatePart(childText(el, 'Finish')),
        baselineStart: baseline ? datePart(childText(baseline, 'Start')) : null,
        baselineFinish: baseline ? finishDatePart(childText(baseline, 'Finish')) : null,
        predecessors: [],
      },
    })
  }

  if (kept.length === 0) return { error: 'The file has no tasks to import.' }

  // Second pass: links, now that every kept UID is known.
  const keptUids = new Set(kept.map((k) => k.task.uid))
  for (const { task, links } of kept) {
    const label = `Task "${task.name}" (UID ${task.uid})`
    for (const el of links) {
      const link = readLink(el, label, minutesPerDay, warnings)
      if (!link) continue
      const { crossProject, ...rest } = link
      if (crossProject) {
        warnings.push(`${label}: the link from another project (UID ${link.uid}) was dropped.`)
      } else if (skippedUids.has(link.uid)) {
        warnings.push(`${label}: the link from skipped task UID ${link.uid} was dropped.`)
      } else if (!keptUids.has(link.uid)) {
        warnings.push(`${label}: the link from UID ${link.uid}, which is not in the file, was dropped.`)
      } else {
        task.predecessors.push(rest)
      }
    }
  }

  const tasks = kept.map((k) => k.task)

  let startDate = datePart(childText(root, 'StartDate'))
  if (!startDate) {
    const starts = tasks.map((t) => t.start).filter((d): d is CalendarDate => d !== null).sort()
    if (starts.length === 0) return { error: 'The file has no project start date.' }
    startDate = starts[0]
    warnings.push(`The file has no project start date; the earliest task start, ${startDate}, was used.`)
  }

  // Calendars: recurring exceptions are expanded over start − 1 year … start + 5 years.
  const window: Window = { from: addYears(startDate, -1), to: addYears(startDate, 5) }
  const calendarsEl = childElement(root, 'Calendars')
  const rawCalendars: RawCalendar[] = []
  for (const c of calendarsEl ? childElements(calendarsEl, 'Calendar') : []) {
    const read = readCalendar(c, window, warnings)
    if (read) rawCalendars.push(read)
  }
  const calendars = resolveCalendars(rawCalendars)
  const calendarUids = new Set(calendars.map((c) => c.uid))
  const projectCalRaw = childText(root, 'CalendarUID')
  const firstBase = calendars.find((c) => c.isBase) ?? null
  let projectCalendarUid: string | null = null
  if (projectCalRaw !== null && calendars.some((c) => c.uid === projectCalRaw && c.isBase)) {
    projectCalendarUid = projectCalRaw
  } else if (firstBase) {
    projectCalendarUid = firstBase.uid
    if (projectCalRaw !== null && projectCalRaw !== '-1') {
      warnings.push(`The project calendar UID ${projectCalRaw} is not a base calendar; "${firstBase.name}" was used instead.`)
    }
  }
  for (const t of tasks) {
    if (t.calendarUid !== null && !calendarUids.has(t.calendarUid)) {
      warnings.push(`Task "${t.name}" (UID ${t.uid}): calendar UID ${t.calendarUid} is not in the file; the project calendar applies.`)
      t.calendarUid = null
    }
  }

  const fileName = childText(root, 'Name')
  const name = childText(root, 'Title') ?? summaryName ?? (fileName ? fileName.replace(/\.(xml|mpp)$/i, '') : '')

  return {
    name,
    startDate,
    minutesPerDay,
    daysPerWeek: round2(minutesPerWeek / minutesPerDay),
    daysPerMonth,
    calendars,
    projectCalendarUid,
    tasks,
    skipped,
    warnings,
  }
}
