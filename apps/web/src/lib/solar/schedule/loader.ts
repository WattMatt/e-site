import 'server-only'
/**
 * Everything the Schedule tab needs, read through the CALLER's session so RLS
 * (solar_can_view; presets = own rows only) decides what comes back. The level
 * is passed in by a caller that already checked it. One loader feeds the page,
 * the export routes and the client's refresh after a mutation.
 *
 * Owners (owner decision Q4): the picker's options come ONLY from
 * solar.schedule_owner_candidates, which applies the same eligibility rule as
 * the write-path trigger (active member, effective role neither client_viewer
 * nor supplier). A task whose current owner is no longer eligible still shows
 * that person's name on its bar, but they are never offered as an owner.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ganttStatusOf, isGanttStatus, isLinkType, isScheduleFilters, solarLevelAllows,
  type CalendarDate, type DurationMode, type GanttStatus, type ScheduleSegment, type ScheduleTaskView, type SolarAccessLevel,
} from '@esite/shared'
import type { ScheduleData, ScheduleLinkView, ScheduleOwner } from './types'
import { ScheduleLoadError } from './load-error'

export { SCHEDULE_LOAD_ERROR, ScheduleLoadError } from './load-error'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const FORMER_MEMBER = 'Former project member'

/** PostgREST's max_rows on this project: a read without .range() is silently cut here. */
export const SCHEDULE_PAGE_SIZE = 1000

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

type Res = { data: unknown; error: { message?: string } | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ranged = { range(from: number, to: number): PromiseLike<any> }

function must(source: string, res: Res): unknown {
  if (res.error) throw new ScheduleLoadError(source, String(res.error.message ?? 'unknown'))
  return res.data
}

/** Read every row, a page at a time, until a short page. `make` builds a fresh, deterministically ordered query. */
async function readAll(source: string, make: () => Ranged): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += SCHEDULE_PAGE_SIZE) {
    const rows = (must(source, await make().range(from, from + SCHEDULE_PAGE_SIZE - 1)) ?? []) as Row[]
    out.push(...rows)
    if (rows.length < SCHEDULE_PAGE_SIZE) return out
  }
}

export async function loadScheduleData(
  projectId: string,
  supabase: AnyClient,
  level: SolarAccessLevel,
  today: CalendarDate,
): Promise<ScheduleData> {
  const solar = () => supabase.schema('solar')
  const [{ data: { user } }, proj, taskRows, segRows, depRows, blRows, setRes, presetRows, ownersRes, wiRows] = await Promise.all([
    supabase.auth.getUser(),
    supabase.schema('projects').from('projects').select('name').eq('id', projectId).maybeSingle(),
    readAll('solar.schedule_tasks', () => solar().from('schedule_tasks')
      .select('id, work_item_id, category, zone, start_date, end_date, progress, colour, sort_order, is_milestone, gantt_status, description, updated_at')
      .eq('project_id', projectId).order('sort_order').order('id')),
    readAll('solar.schedule_segments', () => solar().from('schedule_segments').select('id, task_id, start_date, end_date')
      .eq('project_id', projectId).order('start_date').order('id')),
    readAll('solar.schedule_dependencies', () => solar().from('schedule_dependencies')
      .select('id, predecessor_task_id, successor_task_id, link_type, lag_days').eq('project_id', projectId).order('id')),
    readAll('solar.schedule_baselines', () => solar().from('schedule_baselines').select('id, name, description, created_at, duration_mode')
      .eq('project_id', projectId).order('created_at').order('id')),
    solar().from('schedule_settings').select('duration_mode, workload_threshold, updated_at').eq('project_id', projectId).maybeSingle(),
    readAll('solar.schedule_filter_presets', () => solar().from('schedule_filter_presets').select('id, name, filters')
      .eq('project_id', projectId).order('name').order('id')),
    solar().rpc('schedule_owner_candidates', { p_project_id: projectId }),
    // By project and type, not by an IN list of ids: 2,000 ids is a ~74 KB URL,
    // past the gateway's limit. A task whose work item is missing is dropped below.
    readAll('projects.work_items', () => supabase.schema('projects').from('work_items')
      .select('id, ref, title, status, assignee_id, gatekeeper_id')
      .eq('project_id', projectId).eq('item_type', 'solar_task').order('id')),
  ])
  const projRow = must('projects.projects', proj as Res) as Row | null
  const settingsRow = must('solar.schedule_settings', setRes as Res) as Row | null
  const ownerRows = (must('solar.schedule_owner_candidates', ownersRes as Res) ?? []) as Row[]
  const wiById = new Map(wiRows.map((w) => [str(w.id), w]))

  const owners: ScheduleOwner[] = ownerRows.map((o) => ({
    id: str(o.user_id), name: str(o.full_name) || str(o.email), email: str(o.email),
  }))
  const ownerName = new Map(owners.map((o) => [o.id, o.name]))

  // Display names only, for current owners who are not (or no longer) eligible.
  const wanted = new Set(taskRows.map((t) => str(t.work_item_id)))
  const missing = [...new Set(wiRows.filter((w) => wanted.has(str(w.id))).map((w) => str(w.assignee_id)).filter((id) => id && !ownerName.has(id)))]
  for (let i = 0; i < missing.length; i += 100) {
    const profs = (must('public.profiles', await supabase.from('profiles').select('id, full_name, email').in('id', missing.slice(i, i + 100))) ?? []) as Row[]
    for (const p of profs) {
      const name = str(p.full_name) || str(p.email)
      if (name) ownerName.set(str(p.id), name)
    }
  }

  const segs = new Map<string, ScheduleSegment[]>()
  for (const s of segRows) {
    const k = str(s.task_id)
    if (!segs.has(k)) segs.set(k, [])
    segs.get(k)!.push({ start: str(s.start_date), end: str(s.end_date) })
  }

  const tasks: ScheduleTaskView[] = []
  for (const t of taskRows) {
    const wi = wiById.get(str(t.work_item_id))
    if (!wi) continue
    const stored: GanttStatus = isGanttStatus(t.gantt_status) ? t.gantt_status : 'not_started'
    const st = ganttStatusOf(str(wi.status), stored)
    if (!st) continue
    const ownerId = str(wi.assignee_id)
    tasks.push({
      id: str(t.id), workItemId: str(wi.id), ref: str(wi.ref), name: str(wi.title),
      category: str(t.category), zone: str(t.zone), start: str(t.start_date), end: str(t.end_date),
      isMilestone: t.is_milestone === true, status: st.status, awaitingSignOff: st.awaitingSignOff,
      progress: Number(t.progress ?? 0), colour: str(t.colour, '#3b82f6'),
      ownerId, ownerName: ownerName.get(ownerId) ?? FORMER_MEMBER,
      gatekeeperId: typeof wi.gatekeeper_id === 'string' && wi.gatekeeper_id ? wi.gatekeeper_id : null,
      sortOrder: Number(t.sort_order ?? 0), description: str(t.description), updatedAt: str(t.updated_at),
      segments: segs.get(str(t.id)) ?? [],
    })
  }
  const live = new Set(tasks.map((t) => t.id))

  const links: ScheduleLinkView[] = depRows
    .filter((d) => isLinkType(d.link_type) && live.has(str(d.predecessor_task_id)) && live.has(str(d.successor_task_id)))
    .map((d) => ({
      id: str(d.id), predecessorId: str(d.predecessor_task_id), successorId: str(d.successor_task_id),
      type: d.link_type as ScheduleLinkView['type'], lagDays: Number(d.lag_days ?? 0),
    }))

  const s = settingsRow
  const mode = (m: unknown): DurationMode => (m === 'working' ? 'working' : 'calendar')
  return {
    projectId,
    projectName: str(projRow?.name),
    canEdit: solarLevelAllows(level, 'edit'),
    currentUserId: user?.id ?? '',
    today,
    tasks,
    links,
    owners,
    baselines: blRows.map((b) => ({
      id: str(b.id), name: str(b.name), description: typeof b.description === 'string' ? b.description : null,
      createdAt: str(b.created_at), durationMode: mode(b.duration_mode),
    })),
    presets: presetRows
      .filter((p) => isScheduleFilters(p.filters))
      .map((p) => ({ id: str(p.id), name: str(p.name), filters: p.filters as ScheduleData['presets'][number]['filters'] })),
    settings: {
      durationMode: mode(s?.duration_mode),
      workloadThreshold: Number(s?.workload_threshold ?? 2),
      updatedAt: typeof s?.updated_at === 'string' ? s.updated_at : null,
    },
  }
}
