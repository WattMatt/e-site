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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const FORMER_MEMBER = 'Former project member'

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

export async function loadScheduleData(
  projectId: string,
  supabase: AnyClient,
  level: SolarAccessLevel,
  today: CalendarDate,
): Promise<ScheduleData> {
  const solar = () => supabase.schema('solar')
  const [{ data: { user } }, proj, tasksRes, segRes, depRes, blRes, setRes, presetRes, ownersRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.schema('projects').from('projects').select('name').eq('id', projectId).maybeSingle(),
    solar().from('schedule_tasks').select('id, work_item_id, category, zone, start_date, end_date, progress, colour, sort_order, is_milestone, gantt_status, description, updated_at')
      .eq('project_id', projectId).order('sort_order'),
    solar().from('schedule_segments').select('id, task_id, start_date, end_date').eq('project_id', projectId).order('start_date'),
    solar().from('schedule_dependencies').select('id, predecessor_task_id, successor_task_id, link_type, lag_days').eq('project_id', projectId),
    solar().from('schedule_baselines').select('id, name, description, created_at, duration_mode').eq('project_id', projectId).order('created_at'),
    solar().from('schedule_settings').select('duration_mode, workload_threshold, updated_at').eq('project_id', projectId).maybeSingle(),
    solar().from('schedule_filter_presets').select('id, name, filters').eq('project_id', projectId).order('name'),
    solar().rpc('schedule_owner_candidates', { p_project_id: projectId }),
  ])

  const taskRows = (tasksRes.data ?? []) as Row[]
  const wiIds = taskRows.map((t) => str(t.work_item_id))
  const { data: wiRows } = wiIds.length
    ? await supabase.schema('projects').from('work_items').select('id, ref, title, status, assignee_id').in('id', wiIds)
    : { data: [] as Row[] }
  const wiById = new Map(((wiRows ?? []) as Row[]).map((w) => [str(w.id), w]))

  const owners: ScheduleOwner[] = ((ownersRes.data ?? []) as Row[]).map((o) => ({
    id: str(o.user_id), name: str(o.full_name) || str(o.email), email: str(o.email),
  }))
  const ownerName = new Map(owners.map((o) => [o.id, o.name]))

  // Display names only, for current owners who are not (or no longer) eligible.
  const missing = [...new Set(((wiRows ?? []) as Row[]).map((w) => str(w.assignee_id)).filter((id) => id && !ownerName.has(id)))]
  if (missing.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', missing)
    for (const p of (profs ?? []) as Row[]) {
      const name = str(p.full_name) || str(p.email)
      if (name) ownerName.set(str(p.id), name)
    }
  }

  const segs = new Map<string, ScheduleSegment[]>()
  for (const s of (segRes.data ?? []) as Row[]) {
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
      sortOrder: Number(t.sort_order ?? 0), description: str(t.description), updatedAt: str(t.updated_at),
      segments: segs.get(str(t.id)) ?? [],
    })
  }
  const live = new Set(tasks.map((t) => t.id))

  const links: ScheduleLinkView[] = ((depRes.data ?? []) as Row[])
    .filter((d) => isLinkType(d.link_type) && live.has(str(d.predecessor_task_id)) && live.has(str(d.successor_task_id)))
    .map((d) => ({
      id: str(d.id), predecessorId: str(d.predecessor_task_id), successorId: str(d.successor_task_id),
      type: d.link_type as ScheduleLinkView['type'], lagDays: Number(d.lag_days ?? 0),
    }))

  const s = setRes.data as Row | null
  const mode = (m: unknown): DurationMode => (m === 'working' ? 'working' : 'calendar')
  return {
    projectId,
    projectName: str((proj.data as Row | null)?.name),
    canEdit: solarLevelAllows(level, 'edit'),
    currentUserId: user?.id ?? '',
    today,
    tasks,
    links,
    owners,
    baselines: ((blRes.data ?? []) as Row[]).map((b) => ({
      id: str(b.id), name: str(b.name), description: typeof b.description === 'string' ? b.description : null,
      createdAt: str(b.created_at), durationMode: mode(b.duration_mode),
    })),
    presets: ((presetRes.data ?? []) as Row[])
      .filter((p) => isScheduleFilters(p.filters))
      .map((p) => ({ id: str(p.id), name: str(p.name), filters: p.filters as ScheduleData['presets'][number]['filters'] })),
    settings: {
      durationMode: mode(s?.duration_mode),
      workloadThreshold: Number(s?.workload_threshold ?? 2),
      updatedAt: typeof s?.updated_at === 'string' ? s.updated_at : null,
    },
  }
}
