'use server'
/**
 * Links, baselines, per-user filter presets and schedule settings (spec §14.1–14.2).
 * Direct table writes through the caller's session: 00212's RLS and bind
 * triggers (loop refusal, user binding, org binding) are the authority; each
 * action re-checks the Solar level itself first. Presets are View-level
 * (filtering is reading); everything else needs Edit.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import type { BaselineTaskView } from '@/lib/solar/schedule/types'
import { LINK_TYPES, isScheduleFilters, type DurationMode, type LinkType, type ScheduleFilters } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Fail = { error: string }
type Row = Record<string, unknown>

const LINK_GONE = 'That link is no longer on this schedule. Reload to see the current programme.'
const BAD_LINK = 'Choose two tasks, a link type and a lag of at most 365 days.'
const uuid = z.string().uuid()

async function session(projectId: string, need: 'view' | 'edit') {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, need, supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null, solar: () => supabase.schema('solar') }
}

const validLink = (type: unknown, lag: unknown) =>
  (LINK_TYPES as readonly unknown[]).includes(type) && Number.isInteger(lag) && Math.abs(lag as number) <= 365

export async function addScheduleLinkAction(input: {
  projectId: string; predecessorId: string; successorId: string; type: LinkType; lagDays: number
}): Promise<{ ok: true; id: string } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.predecessorId).success || !uuid.safeParse(input.successorId).success || !validLink(input.type, input.lagDays)) {
    return { error: BAD_LINK }
  }
  if (input.predecessorId === input.successorId) return { error: 'A task cannot depend on itself.' }
  const { data, error } = await solar().from('schedule_dependencies').insert({
    project_id: input.projectId, predecessor_task_id: input.predecessorId, successor_task_id: input.successorId,
    link_type: input.type, lag_days: input.lagDays,
  }).select('id')
  if (error) return { error: humanScheduleError(error) }
  return { ok: true, id: String((data as Row[])[0]?.id ?? '') }
}

/**
 * solar.schedule_dependencies carries no updated_at, so a link edit has no
 * concurrency token: the last type/lag written wins. A link removed meanwhile
 * is reported, never silently re-created.
 */
export async function updateScheduleLinkAction(input: {
  projectId: string; linkId: string; type: LinkType; lagDays: number
}): Promise<{ ok: true } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.linkId).success || !validLink(input.type, input.lagDays)) {
    return { error: 'Choose a link type and a lag of at most 365 days.' }
  }
  const { data, error } = await solar().from('schedule_dependencies')
    .update({ link_type: input.type, lag_days: input.lagDays })
    .eq('id', input.linkId).eq('project_id', input.projectId).select('id')
  if (error) return { error: humanScheduleError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: LINK_GONE }
  return { ok: true }
}

export async function removeScheduleLinkAction(input: { projectId: string; linkId: string }): Promise<{ ok: true } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.linkId).success) return { error: LINK_GONE }
  const { error } = await solar().from('schedule_dependencies').delete().eq('id', input.linkId).eq('project_id', input.projectId)
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}

export async function saveBaselineAction(input: { projectId: string; name: string; description: string }): Promise<{ ok: true; id: string } | Fail> {
  const { supabase, userId } = await session(input.projectId, 'edit')
  if (!userId) return { error: 'You are not signed in.' }
  const name = (input.name ?? '').trim()
  if (!name) return { error: 'Give the baseline a name.' }
  if (name.length > 120 || (input.description ?? '').length > 1000) return { error: 'That name or description is too long.' }
  const { data, error } = await supabase.schema('solar').rpc('schedule_save_baseline', {
    p_project_id: input.projectId, p_name: name, p_description: input.description ?? '',
  })
  if (error) return { error: humanScheduleError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schedule_baseline_saved', objectRef: { name } })
  return { ok: true, id: String(data ?? '') }
}

export async function deleteBaselineAction(input: { projectId: string; baselineId: string }): Promise<{ ok: true } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.baselineId).success) return { error: 'That baseline is no longer there.' }
  const { error } = await solar().from('schedule_baselines').delete().eq('id', input.baselineId).eq('project_id', input.projectId)
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}

export async function loadBaselineTasksAction(input: { projectId: string; baselineId: string }): Promise<{ ok: true; tasks: BaselineTaskView[] } | Fail> {
  const { solar } = await session(input.projectId, 'view')
  const { data, error } = await solar().from('schedule_baseline_tasks')
    .select('task_id, work_item_ref, name, start_date, end_date, is_milestone, sort_order')
    .eq('baseline_id', input.baselineId).eq('project_id', input.projectId).order('sort_order')
  if (error) return { error: humanScheduleError(error) }
  return {
    ok: true,
    tasks: ((data ?? []) as Row[]).map((r) => ({
      taskId: typeof r.task_id === 'string' ? r.task_id : null, ref: String(r.work_item_ref ?? ''), name: String(r.name ?? ''),
      start: String(r.start_date), end: String(r.end_date), isMilestone: r.is_milestone === true,
    })),
  }
}

export async function saveFilterPresetAction(input: { projectId: string; name: string; filters: ScheduleFilters }): Promise<{ ok: true; id: string } | Fail> {
  const { solar, userId } = await session(input.projectId, 'view')
  if (!userId) return { error: 'You are not signed in.' }
  const name = (input.name ?? '').trim()
  if (!name || name.length > 80) return { error: 'Give the preset a name of up to 80 characters.' }
  if (!isScheduleFilters(input.filters)) return { error: 'That filter could not be saved.' }
  const filters: ScheduleFilters = {
    search: input.filters.search, statuses: input.filters.statuses, ownerIds: input.filters.ownerIds, colours: input.filters.colours,
  }
  const { data, error } = await solar().from('schedule_filter_presets')
    .insert({ project_id: input.projectId, user_id: userId, name, filters }).select('id')
  if (error) return { error: humanScheduleError(error) }
  return { ok: true, id: String((data as Row[])[0]?.id ?? '') }
}

export async function deleteFilterPresetAction(input: { projectId: string; presetId: string }): Promise<{ ok: true } | Fail> {
  const { solar, userId } = await session(input.projectId, 'view')
  if (!userId) return { error: 'You are not signed in.' }
  if (!uuid.safeParse(input.presetId).success) return { error: 'That preset is no longer there.' }
  const { error } = await solar().from('schedule_filter_presets').delete()
    .eq('id', input.presetId).eq('project_id', input.projectId).eq('user_id', userId)
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}

export async function saveScheduleSettingsAction(input: {
  projectId: string; durationMode: DurationMode; workloadThreshold: number; expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (input.durationMode !== 'calendar' && input.durationMode !== 'working') return { error: 'Choose calendar days or working days.' }
  if (!Number.isInteger(input.workloadThreshold) || input.workloadThreshold < 1 || input.workloadThreshold > 50) {
    return { error: 'The workload limit must be a whole number from 1 to 50.' }
  }
  const values = { duration_mode: input.durationMode, workload_threshold: input.workloadThreshold }
  if (input.expectedUpdatedAt === null) {
    // No row yet (the loader returned the defaults). If someone saved first, the
    // primary key refuses this insert: that is a stale write, not an error.
    const { data, error } = await solar().from('schedule_settings').insert({ project_id: input.projectId, ...values }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanScheduleError(error) }
    return { ok: true, updatedAt: String((data as Row[])[0]?.updated_at ?? '') }
  }
  const { data, error } = await solar().from('schedule_settings').update(values)
    .eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanScheduleError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  return { ok: true, updatedAt: String((data as Row[])[0]?.updated_at ?? '') }
}
