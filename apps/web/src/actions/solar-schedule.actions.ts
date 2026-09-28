'use server'
/**
 * Schedule task actions (spec §14). Each re-checks the Solar level itself;
 * writes go through the caller's session to the 00212 RPCs, which re-check
 * solar_can_edit and run the work-item spine's triggers (including the Q4
 * owner guard, SQLSTATE SOL01). Nothing here trusts the page gate or the
 * client's shapes. Every mutation returns a small result; the client then
 * calls loadScheduleAction to replace its data.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { loadScheduleData } from '@/lib/solar/schedule/loader'
import { SCHEDULE_LOAD_ERROR, ScheduleLoadError } from '@/lib/solar/schedule/load-error'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import {
  BAD_TASK, LinkInputSchema, TaskInputSchema, TaskPatchSchema, toRpcPatch, toRpcTask,
  type LinkInput, type TaskInput, type TaskPatch,
} from '@/lib/solar/schedule/inputs'
import type { ScheduleData } from '@/lib/solar/schedule/types'
import { sastToday } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Fail = { error: string }

async function session(projectId: string, need: 'view' | 'edit') {
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(projectId, need, supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, level, userId: user?.id ?? null }
}

export async function loadScheduleAction(input: { projectId: string }): Promise<{ ok: true; data: ScheduleData } | Fail> {
  const { supabase, level } = await session(input.projectId, 'view')
  try {
    return { ok: true, data: await loadScheduleData(input.projectId, supabase, level, sastToday()) }
  } catch (err) {
    if (!(err instanceof ScheduleLoadError)) throw err
    console.error('[solar-schedule] load failed', { project: input.projectId, source: err.source, detail: err.detail })
    return { error: SCHEDULE_LOAD_ERROR }
  }
}

export async function createScheduleTasksAction(input: {
  projectId: string
  tasks: TaskInput[]
  links: LinkInput[]
  replace?: boolean
}): Promise<{ ok: true; ids: Record<string, string> } | Fail> {
  const { supabase, userId } = await session(input.projectId, 'edit')
  if (!userId) return { error: 'You are not signed in.' }
  const tasks = z.array(TaskInputSchema).min(1).max(2000).safeParse(input.tasks)
  const links = z.array(LinkInputSchema).max(10000).safeParse(input.links ?? [])
  if (!tasks.success || !links.success) return { error: BAD_TASK }
  const { data, error } = await supabase.schema('solar').rpc('schedule_create_tasks', {
    p_project_id: input.projectId,
    p_tasks: tasks.data.map(toRpcTask),
    p_links: links.data.map((l) => ({ from: l.from, to: l.to, type: l.type, lag: l.lagDays })),
    p_replace: input.replace === true,
  })
  if (error) return { error: humanScheduleError(error) }
  // The verb is fixed here, never taken from the caller: a server action's
  // input is client-controlled, so a plain add must not be able to label
  // itself an import or a template. Imports and templates have their own
  // actions (solar-schedule-import / -template), which call the RPC after
  // their own validation and record their own verb.
  await recordSolarAudit({
    projectId: input.projectId, actorId: userId, verb: 'schedule_tasks_added',
    objectRef: { count: tasks.data.length },
  })
  return { ok: true, ids: (data ?? {}) as Record<string, string> }
}

export async function updateScheduleTasksAction(input: {
  projectId: string
  patches: TaskPatch[]
}): Promise<{ ok: true; updated: Array<{ id: string; updatedAt: string }> } | Fail> {
  const { supabase } = await session(input.projectId, 'edit')
  if (!Array.isArray(input.patches) || input.patches.length === 0) return { error: 'Nothing to change.' }
  const patches = z.array(TaskPatchSchema).max(2000).safeParse(input.patches)
  if (!patches.success) return { error: BAD_TASK }
  // Every update is concurrency-guarded: a patch that does not say which version
  // it was made against cannot be told apart from a stale one.
  if (patches.data.some((p) => typeof p.expectedUpdatedAt !== 'string' || p.expectedUpdatedAt === '')) {
    return { error: STALE_MESSAGE }
  }
  const { data, error } = await supabase.schema('solar').rpc('schedule_update_tasks', {
    p_project_id: input.projectId,
    p_patches: patches.data.map(toRpcPatch),
  })
  if (error) return { error: humanScheduleError(error) }
  const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; updated_at: string }>
  return { ok: true, updated: rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })) }
}

export async function deleteScheduleTasksAction(input: {
  projectId: string
  taskIds: string[]
}): Promise<{ ok: true; removed: number } | Fail> {
  const { supabase, userId } = await session(input.projectId, 'edit')
  if (!userId) return { error: 'You are not signed in.' }
  const ids = z.array(z.string().uuid()).min(1).max(2000).safeParse(input.taskIds)
  if (!ids.success) return { error: 'Choose at least one task.' }
  const { data, error } = await supabase.schema('solar').rpc('schedule_delete_tasks', {
    p_project_id: input.projectId, p_task_ids: ids.data,
  })
  if (error) return { error: humanScheduleError(error) }
  const removed = Number(data ?? 0)
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schedule_tasks_removed', objectRef: { count: removed } })
  return { ok: true, removed }
}

export async function reorderScheduleTasksAction(input: { projectId: string; orderedIds: string[] }): Promise<{ ok: true } | Fail> {
  const { supabase } = await session(input.projectId, 'edit')
  const ids = z.array(z.string().uuid()).min(1).max(5000).safeParse(input.orderedIds)
  if (!ids.success) return { error: 'Nothing to reorder.' }
  const { error } = await supabase.schema('solar').rpc('schedule_reorder', { p_project_id: input.projectId, p_ids: ids.data })
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}
