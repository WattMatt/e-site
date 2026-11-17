/**
 * In-memory twin of `programme.save_changes` (migration 00261, section 2).
 *
 * `ProgrammeOp` is the exact shape the SQL reads; `applyOps` applies a list of
 * them to a `ProgrammeState` with the same references, refusals and sentences,
 * so a server action can apply an edit, run the engine on the result, and send
 * the ops plus the computed cache to the database in one call.
 *
 * Mirrored on purpose:
 *  - a reference (id, pred, succ, activity, calendar, code_type, code_value,
 *    parent_id, calendar_id, default_calendar_id) is a key created earlier in
 *    the same list OR the id of an existing row. New rows created with
 *    `key: k` get the id `key:<k>`; new rows without a key get `new:<n>` (n =
 *    the op's position). The server assigns real uuids and returns the map.
 *  - unknown names in `fields` are refused; the computed-cache names
 *    (early_*, late_*, total_float, free_float, is_critical, is_driving,
 *    work_item_id; project_finish on set_programme) are known and ignored.
 *  - delete_activity tombstones an activity that carries history and
 *    hard-deletes a bare one (see `deleteActivity`).
 *  - upsert/delete/link on a tombstoned activity is refused.
 *
 * What the SQL checks that this cannot, and the optional ProgrammeState
 * arrays that stand in for it:
 *  - field updates, resource assignments and baseline rows are not part of the
 *    editable state, yet delete_activity's tombstone decision reads them.
 *    Callers that load them pass `fieldUpdateActivityIds`,
 *    `assignmentActivityIds` and `baselineActivityIds` (activity ids that have
 *    at least one such row). They are REQUIRED (empty arrays when none) so a
 *    caller cannot silently get a hard delete the database would tombstone.
 *  - Not checked here (the database does, and `save_changes` stays the
 *    authority): permission (42501), the optimistic version (40001), and
 *    "that row belongs to a different programme" (state holds one programme, so
 *    an id outside it is simply "no longer exists").
 *  - Value checks mirror the table CHECK constraints on the columns the ops
 *    can write and raise the same two sentences ("missing or not allowed",
 *    "not in the expected form"). Foreign keys other than the references
 *    above (e.g. an organisation_tag that is not an organisation) are left to
 *    the database.
 */
import { isCalendarDate } from '../../lib/dates/calendar-date'
import { ProgrammeOpError } from './errors'
import type {
  ActivityCodeRow, ActivityRow, CalendarExceptionRow, CalendarRow, CodeTypeRow, CodeValueRow, DependencyRow, ProgrammeRow,
} from './rows'

export interface ProgrammeState {
  programme: ProgrammeRow
  calendars: CalendarRow[]
  exceptions: CalendarExceptionRow[]
  activities: ActivityRow[]
  dependencies: DependencyRow[]
  codeTypes: CodeTypeRow[]
  codeValues: CodeValueRow[]
  activityCodes: ActivityCodeRow[]
  /** Activity ids with at least one field update (history: forces a tombstone). */
  fieldUpdateActivityIds: string[]
  /** Activity ids with at least one resource assignment (and its rand cost). */
  assignmentActivityIds: string[]
  /** Activity ids present in at least one baseline snapshot of this programme. */
  baselineActivityIds: string[]
}

type ActivityWritable = Pick<ActivityRow,
  'parent_id' | 'wbs_code' | 'code' | 'name' | 'type' | 'original_duration' | 'remaining_duration' | 'calendar_id' |
  'constraint_type' | 'constraint_date' | 'deadline' | 'actual_start' | 'actual_finish' | 'percent_complete' |
  'percent_complete_type' | 'fixed_start' | 'fixed_finish' | 'sort_order' | 'external_uid' | 'anchor'>
type ActivityCache = Pick<ActivityRow, 'early_start' | 'early_finish' | 'late_start' | 'late_finish' | 'total_float' |
  'free_float' | 'is_critical' | 'is_driving' | 'work_item_id'>
export type ActivityFields = Partial<ActivityWritable & ActivityCache>
export type CalendarFields = Partial<Pick<CalendarRow, 'name' | 'variant' | 'work_weekdays' | 'hours_per_day' | 'coverage_from' | 'coverage_to'>>
export type ProgrammeFields = Partial<Pick<ProgrammeRow, 'name' | 'data_date' | 'project_start' | 'options' | 'default_calendar_id' | 'project_finish'>>

export type ProgrammeOp =
  | { op: 'upsert_activity'; key?: string; id?: string; fields: ActivityFields }
  | { op: 'delete_activity'; id: string }
  | { op: 'upsert_dependency'; key?: string; id?: string; pred?: string; succ?: string; type?: DependencyRow['type']; lag?: number; lag_unit?: DependencyRow['lag_unit']; lag_calendar?: DependencyRow['lag_calendar'] }
  | { op: 'delete_dependency'; id: string }
  | { op: 'upsert_calendar'; key?: string; id?: string; fields: CalendarFields }
  | { op: 'set_calendar_exceptions'; calendar: string; exceptions: Array<{ day: string; kind?: 'non_work' | 'work'; label?: string | null }> }
  | { op: 'upsert_code_type'; key?: string; id?: string; name?: string }
  | { op: 'upsert_code_value'; key?: string; id?: string; code_type?: string; value?: string; colour?: string | null; organisation_tag?: string | null; user_tag?: string | null }
  | { op: 'set_activity_code'; activity: string; code_type: string; code_value?: string | null }
  | { op: 'set_programme'; fields: ProgrammeFields }

const ACT_FIELDS = ['parent_id', 'wbs_code', 'code', 'name', 'type', 'original_duration', 'remaining_duration', 'calendar_id',
  'constraint_type', 'constraint_date', 'deadline', 'actual_start', 'actual_finish', 'percent_complete', 'percent_complete_type',
  'fixed_start', 'fixed_finish', 'sort_order', 'external_uid', 'anchor'] as const
const ACT_CACHE = ['early_start', 'early_finish', 'late_start', 'late_finish', 'total_float', 'free_float', 'is_critical', 'is_driving', 'work_item_id']
const CAL_FIELDS = ['name', 'variant', 'work_weekdays', 'hours_per_day', 'coverage_from', 'coverage_to'] as const
const PROG_FIELDS = ['name', 'data_date', 'project_start', 'options', 'default_calendar_id'] as const
const PROG_CACHE = ['project_finish']

const BAD = 'One of the values in this change is missing or not allowed.'
const FORM = 'One of the values in this change is not in the expected form.'
const bad = () => new ProgrammeOpError(BAD, '22023')
const badForm = () => new ProgrammeOpError(FORM, '22023')
const fail = (m: string, c: ProgrammeOpError['code'] = '22023') => new ProgrammeOpError(m, c)

type Rec = Record<string, unknown>
type Keys = Map<string, string>
type Table = 'activities' | 'dependencies' | 'calendars' | 'code_types' | 'code_values'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const blank = (v: unknown) => typeof v !== 'string' || v.trim().length === 0
const len = (v: string) => v.trim().length

function date(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string' || !isCalendarDate(v)) throw badForm()
  return v
}
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) throw badForm()
  return n
}
function isRec(v: unknown): v is Rec { return typeof v === 'object' && v !== null && !Array.isArray(v) }

export function applyOps(input: ProgrammeState, ops: ProgrammeOp[]): ProgrammeState {
  const s = clone(input)
  const keys: Keys = new Map()

  const rows = (t: Table): Array<{ id: string }> => {
    switch (t) {
      case 'activities': return s.activities
      case 'dependencies': return s.dependencies
      case 'calendars': return s.calendars
      case 'code_types': return s.codeTypes
      case 'code_values': return s.codeValues
    }
  }
  /** SQL `programme.resolve_ref`: a key made earlier in this call, else an existing id. */
  const ref = (r: unknown, table: Table, what: string): string | null => {
    if (r === null || r === undefined) return null
    const id = typeof r === 'string' ? (keys.get(r) ?? r) : String(r)
    if (!rows(table).some((x) => x.id === id)) {
      throw fail(`That ${what} no longer exists. Reload to see the current programme.`, 'P0002')
    }
    return id
  }
  const findAct = (id: string) => s.activities.find((a) => a.id === id) as ActivityRow

  ops.forEach((o, index) => {
    const op = o as unknown as Rec
    const kind = typeof op.op === 'string' ? op.op : undefined
    const key = typeof op.key === 'string' ? op.key : undefined
    if (key !== undefined && keys.has(key)) throw fail('Each new row in one save needs its own key.')

    if (isRec(op.fields)) {
      const known: readonly string[] = kind === 'upsert_activity' ? [...ACT_FIELDS, ...ACT_CACHE]
        : kind === 'upsert_calendar' ? CAL_FIELDS
        : kind === 'set_programme' ? [...PROG_FIELDS, ...PROG_CACHE] : []
      const unknown = Object.keys(op.fields).filter((k) => !known.includes(k)).sort()[0]
      if (unknown !== undefined) throw fail(`That change names a field the programme does not have: ${unknown}.`)
    }
    const writable = (names: readonly string[]): Rec => {
      const f = isRec(op.fields) ? op.fields : {}
      const out: Rec = {}
      for (const k of names) if (k in f) out[k] = f[k]
      return out
    }
    const newId = () => (key !== undefined ? `key:${key}` : `new:${index}`)
    let id: string | null = null

    switch (kind) {
      case 'upsert_activity': {
        const f = writable(ACT_FIELDS)
        if (typeof f.parent_id === 'string') f.parent_id = ref(f.parent_id, 'activities', 'parent activity')
        if (typeof f.calendar_id === 'string') f.calendar_id = ref(f.calendar_id, 'calendars', 'calendar')
        let a: ActivityRow
        if (op.id !== undefined && op.id !== null) {
          id = ref(op.id, 'activities', 'activity')
          a = findAct(id as string)
          if (a.is_tombstoned) throw fail('That activity was removed. Restore it first.')
          Object.assign(a, f)
        } else {
          id = newId()
          a = {
            id, programme_id: s.programme.id, parent_id: null, wbs_code: null, code: null, name: null as unknown as string,
            type: 'task', original_duration: 0, remaining_duration: null, calendar_id: null, constraint_type: null,
            constraint_date: null, deadline: null, actual_start: null, actual_finish: null, percent_complete: 0,
            percent_complete_type: 'duration', fixed_start: null, fixed_finish: null, early_start: null, early_finish: null,
            late_start: null, late_finish: null, total_float: null, free_float: null, is_critical: false, is_driving: false,
            sort_order: null, external_uid: null, anchor: null, work_item_id: null, is_tombstoned: false, ...f,
          } as ActivityRow
          // A null/absent value for a defaulted column takes the default, as the SQL coalesce does.
          a.original_duration = (a.original_duration ?? 0) as number
          a.percent_complete = (a.percent_complete ?? 0) as number
          a.percent_complete_type = a.percent_complete_type ?? 'duration'
          s.activities.push(a)
        }
        normaliseActivity(a)
        checkActivity(a, s.activities)
        // The WBS tree must stay a tree.
        let cur = a.parent_id
        let hops = 0
        while (cur !== null) {
          if (cur === a.id || hops > 10000) throw fail('An activity cannot sit under one of its own sub-activities.')
          cur = s.activities.find((x) => x.id === cur)?.parent_id ?? null
          hops++
        }
        break
      }

      case 'delete_activity': {
        id = ref(op.id, 'activities', 'activity')
        if (id === null) throw fail('Say which activity to delete.')
        const a = findAct(id)
        if (a.is_tombstoned) throw fail('That activity was removed. Restore it first.')
        const children = s.activities.filter((x) => x.parent_id === id)
        if (children.some((x) => !x.is_tombstoned)) throw fail('Delete or move its sub-activities first.')
        const hasHistory = a.work_item_id !== null || a.external_uid !== null || children.length > 0
          || s.fieldUpdateActivityIds.includes(id)
          || s.assignmentActivityIds.includes(id)
          || s.activityCodes.some((c) => c.activity_id === id)
          || s.baselineActivityIds.includes(id)
        const gone = id
        s.dependencies = s.dependencies.filter((d) => d.pred_id !== gone && d.succ_id !== gone)
        if (hasHistory) a.is_tombstoned = true
        else s.activities = s.activities.filter((x) => x.id !== gone)
        id = null
        break
      }

      case 'upsert_dependency': {
        let pred = ref(op.pred, 'activities', 'activity')
        let succ = ref(op.succ, 'activities', 'activity')
        let dep: DependencyRow | undefined
        if (op.id !== undefined && op.id !== null) {
          id = ref(op.id, 'dependencies', 'link')
          dep = s.dependencies.find((d) => d.id === id)
          pred = pred ?? (dep as DependencyRow).pred_id
          succ = succ ?? (dep as DependencyRow).succ_id
        } else if (pred === null || succ === null) {
          throw fail('A link needs a predecessor and a successor.')
        }
        if (pred === succ) throw fail('An activity cannot be linked to itself.')
        if (s.activities.some((a) => (a.id === pred || a.id === succ) && a.is_tombstoned)) {
          throw fail('That activity was removed. Restore it first.')
        }
        const next = {
          pred_id: pred as string, succ_id: succ as string,
          type: (op.type ?? dep?.type ?? 'FS') as DependencyRow['type'],
          lag: op.lag !== undefined && op.lag !== null ? (num(op.lag) as number) : (dep?.lag ?? 0),
          lag_unit: (op.lag_unit ?? dep?.lag_unit ?? 'working_days') as DependencyRow['lag_unit'],
          lag_calendar: (op.lag_calendar ?? dep?.lag_calendar ?? 'pred') as DependencyRow['lag_calendar'],
        }
        if (!['FS', 'SS', 'FF', 'SF'].includes(next.type) || !['working_days', 'elapsed_days', 'percent'].includes(next.lag_unit)
          || !['pred', 'succ', 'project'].includes(next.lag_calendar)) throw bad()
        if (s.dependencies.some((d) => d.id !== id && d.pred_id === next.pred_id && d.succ_id === next.succ_id && d.type === next.type)) {
          throw fail('Those two activities are already linked that way.', '23505')
        }
        if (dep) Object.assign(dep, next)
        else {
          id = newId()
          s.dependencies.push({ id, programme_id: s.programme.id, ...next })
        }
        break
      }

      case 'delete_dependency': {
        id = ref(op.id, 'dependencies', 'link')
        if (id === null) throw fail('Say which link to delete.')
        const gone = id
        s.dependencies = s.dependencies.filter((d) => d.id !== gone)
        id = null
        break
      }

      case 'upsert_calendar': {
        const f = writable(CAL_FIELDS)
        let c: CalendarRow
        if (op.id !== undefined && op.id !== null) {
          id = ref(op.id, 'calendars', 'calendar')
          c = s.calendars.find((x) => x.id === id) as CalendarRow
          Object.assign(c, f)
        } else {
          id = newId()
          c = { id, programme_id: s.programme.id, name: null as unknown as string, variant: 'custom', work_weekdays: [1, 2, 3, 4, 5],
            hours_per_day: 8, coverage_from: null, coverage_to: null, ...f } as CalendarRow
          c.variant = c.variant ?? 'custom'
          c.work_weekdays = c.work_weekdays ?? [1, 2, 3, 4, 5]
          c.hours_per_day = (c.hours_per_day ?? 8) as number
          s.calendars.push(c)
        }
        c.coverage_from = date(c.coverage_from)
        c.coverage_to = date(c.coverage_to)
        c.hours_per_day = num(c.hours_per_day) as number
        if (blank(c.name) || len(c.name) > 80 || !['site', 'office', 'custom'].includes(c.variant)
          || !Array.isArray(c.work_weekdays) || c.work_weekdays.length < 1 || c.work_weekdays.length > 7
          || c.work_weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
          || !(c.hours_per_day > 0 && c.hours_per_day <= 24)) throw bad()
        break
      }

      case 'set_calendar_exceptions': {
        id = ref(op.calendar, 'calendars', 'calendar')
        if (id === null) throw fail('Say which calendar the exceptions belong to.')
        const list = op.exceptions === undefined || op.exceptions === null ? [] : op.exceptions
        if (!Array.isArray(list)) throw fail('The calendar exceptions must be sent as a list.')
        const calendarId = id
        const next: CalendarExceptionRow[] = list.map((x: Rec) => {
          const day = date(x.day)
          if (day === null) throw bad()
          const k = (x.kind ?? 'non_work') as string
          if (k !== 'non_work' && k !== 'work') throw bad()
          return { id: `${calendarId}:${day}`, calendar_id: calendarId, day, kind: k, label: typeof x.label === 'string' ? x.label : null }
        })
        if (new Set(next.map((e) => e.day)).size !== next.length) {
          throw fail('The same day appears twice in the calendar exceptions.', '23505')
        }
        s.exceptions = [...s.exceptions.filter((e) => e.calendar_id !== calendarId), ...next]
        id = null
        break
      }

      case 'upsert_code_type': {
        let t: CodeTypeRow | undefined
        if (op.id !== undefined && op.id !== null) {
          id = ref(op.id, 'code_types', 'code type')
          t = s.codeTypes.find((x) => x.id === id) as CodeTypeRow
          if (typeof op.name === 'string') t.name = op.name
        } else {
          id = newId()
          t = { id, programme_id: s.programme.id, name: (op.name ?? null) as string, sort_order: null }
          s.codeTypes.push(t)
        }
        if (blank(t.name) || len(t.name) > 60) throw bad()
        const lower = t.name.toLowerCase()
        if (s.codeTypes.some((x) => x !== t && x.name.toLowerCase() === lower)) {
          throw fail('A code type with that name already exists.', '23505')
        }
        break
      }

      case 'upsert_code_value': {
        const type = ref(op.code_type, 'code_types', 'code type')
        let v: CodeValueRow
        if (op.id !== undefined && op.id !== null) {
          id = ref(op.id, 'code_values', 'code value')
          v = s.codeValues.find((x) => x.id === id) as CodeValueRow
          if (type !== null && type !== v.code_type_id) throw fail('A code value cannot move to another code type.')
          if (typeof op.value === 'string') v.value = op.value
          if ('colour' in op) v.colour = (op.colour ?? null) as string | null
          if ('organisation_tag' in op) v.organisation_tag = (op.organisation_tag ?? null) as string | null
          if ('user_tag' in op) v.user_tag = (op.user_tag ?? null) as string | null
        } else {
          if (type === null) throw fail('A code value needs a code type.')
          id = newId()
          v = { id, code_type_id: type, programme_id: s.programme.id, value: (op.value ?? null) as string, description: null,
            colour: (op.colour ?? null) as string | null, organisation_tag: (op.organisation_tag ?? null) as string | null,
            user_tag: (op.user_tag ?? null) as string | null }
          s.codeValues.push(v)
        }
        if (blank(v.value) || len(v.value) > 60 || (v.colour !== null && !/^#[0-9a-f]{6}$/.test(v.colour))) throw bad()
        break
      }

      case 'set_activity_code': {
        const act = ref(op.activity, 'activities', 'activity')
        const type = ref(op.code_type, 'code_types', 'code type')
        if (act === null || type === null) throw fail('Say which activity and which code type.')
        if (op.code_value === undefined || op.code_value === null) {
          s.activityCodes = s.activityCodes.filter((c) => !(c.activity_id === act && c.code_type_id === type))
        } else {
          const val = ref(op.code_value, 'code_values', 'code value') as string
          const cur = s.activityCodes.find((c) => c.activity_id === act && c.code_type_id === type)
          if (cur) cur.code_value_id = val
          else s.activityCodes.push({ activity_id: act, code_type_id: type, code_value_id: val, programme_id: s.programme.id })
        }
        break
      }

      case 'set_programme': {
        const f = writable(PROG_FIELDS)
        if (typeof f.default_calendar_id === 'string') f.default_calendar_id = ref(f.default_calendar_id, 'calendars', 'calendar')
        if ('options' in f && !isRec(f.options)) throw fail('The programme options must be an object.')
        Object.assign(s.programme, f)
        s.programme.data_date = date(s.programme.data_date)
        if (s.programme.project_start === null || s.programme.project_start === undefined) throw bad()
        s.programme.project_start = date(s.programme.project_start) as string
        if (blank(s.programme.name) || len(s.programme.name) > 200) throw bad()
        break
      }

      default:
        throw fail(`Unknown change "${kind ?? '(none)'}".`)
    }

    if (key !== undefined && id !== null) keys.set(key, id)
  })
  return s
}

const ACT_TYPES = ['task', 'start_milestone', 'finish_milestone', 'summary', 'level_of_effort', 'module_summary']
const CONSTRAINTS = ['snet', 'snlt', 'fnet', 'fnlt', 'mso', 'mfo', 'alap']

/** Dates and numbers in the form the database would parse; undefined becomes null. */
function normaliseActivity(a: ActivityRow): void {
  for (const k of ['constraint_date', 'deadline', 'actual_start', 'actual_finish', 'fixed_start', 'fixed_finish'] as const) a[k] = date(a[k])
  a.original_duration = num(a.original_duration) as number
  a.remaining_duration = num(a.remaining_duration)
  a.percent_complete = num(a.percent_complete) as number
  a.sort_order = num(a.sort_order)
  for (const k of ['parent_id', 'wbs_code', 'code', 'calendar_id', 'constraint_type', 'external_uid', 'anchor'] as const) {
    if (a[k] === undefined) (a as unknown as Rec)[k] = null
  }
}

/** The CHECK constraints and unique indexes of programme.activities that an op can trip. */
function checkActivity(a: ActivityRow, all: ActivityRow[]): void {
  if (blank(a.name) || len(a.name) > 300) throw bad()
  if (!ACT_TYPES.includes(a.type)) throw bad()
  if (a.code !== null && a.code.length > 40) throw bad()
  if (a.original_duration < 0 || (a.remaining_duration !== null && a.remaining_duration < 0)) throw bad()
  if (a.percent_complete < 0 || a.percent_complete > 100) throw bad()
  if (!['duration', 'physical', 'units'].includes(a.percent_complete_type)) throw bad()
  if (a.constraint_type !== null && !CONSTRAINTS.includes(a.constraint_type)) throw bad()
  if ((a.type === 'start_milestone' || a.type === 'finish_milestone') && a.original_duration !== 0) throw bad()
  if (a.actual_finish !== null && a.actual_start !== null && a.actual_finish < a.actual_start) throw bad()
  if (a.constraint_type !== null && a.constraint_type !== 'alap' && a.constraint_date === null) throw bad()
  if ((a.fixed_start !== null || a.fixed_finish !== null) && a.type !== 'module_summary') throw bad()
  if (a.anchor !== null && !/^(opening_date|practical_completion|tenant_bo:[0-9a-f-]{36}|inspection:[0-9a-f-]{36})$/.test(a.anchor)) throw bad()
  if (a.external_uid !== null && all.some((x) => x !== a && x.external_uid === a.external_uid)) {
    throw fail('Another activity already has that external id.', '23505')
  }
}
