'use server'
/**
 * "Use template" (spec §14.1) and the org's template in /settings/solar.
 * Apply: Edit level (re-checked here); reads the org template through a
 * definer RPC that re-checks Edit (solar.schedule_org_template), falls back to
 * the built-in programme, instantiates it in the project's duration mode, and
 * creates everything in ONE RPC call. Save: org owner/admin (requireRole → .ok;
 * the schedule_templates policies say the same), optimistic on updated_at.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import { planToInputs, toRpcTask } from '@/lib/solar/schedule/inputs'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import {
  DEFAULT_SOLAR_SCHEDULE_TEMPLATE, OWNER_ADMIN, SCHEDULE_TEMPLATE_VERSION, instantiateScheduleTemplate, isCalendarDate,
  makeWorkCalendar, readScheduleTemplate, saHolidays, validateScheduleTemplate, type ScheduleTemplateItem,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Fail = { error: string }

export async function applyScheduleTemplateAction(input: { projectId: string; start: string }): Promise<{ ok: true; count: number } | Fail> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (!isCalendarDate(input.start)) return { error: 'Choose the date the programme starts.' }

  const [{ data: stored, error: tplErr }, { data: settings }] = await Promise.all([
    supabase.schema('solar').rpc('schedule_org_template', { p_project_id: input.projectId }),
    supabase.schema('solar').from('schedule_settings').select('duration_mode').eq('project_id', input.projectId).maybeSingle(),
  ])
  if (tplErr) return { error: humanScheduleError(tplErr) }
  const items = readScheduleTemplate(stored) ?? DEFAULT_SOLAR_SCHEDULE_TEMPLATE
  const mode = (settings as { duration_mode?: string } | null)?.duration_mode === 'working' ? 'working' : 'calendar'
  const plan = instantiateScheduleTemplate(items, input.start, makeWorkCalendar(mode, saHolidays()))
  const { tasks, links } = planToInputs(plan, () => null)

  const { error } = await supabase.schema('solar').rpc('schedule_create_tasks', {
    p_project_id: input.projectId,
    p_tasks: tasks.map(toRpcTask),
    p_links: links.map((l) => ({ from: l.from, to: l.to, type: l.type, lag: l.lagDays })),
    p_replace: false,
  })
  if (error) return { error: humanScheduleError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'schedule_template_applied', objectRef: { count: tasks.length } })
  return { ok: true, count: tasks.length }
}

const NOT_ADMIN = 'Only an organisation owner or admin can change the schedule template.'

export async function saveOrgScheduleTemplateAction(input: {
  items: ScheduleTemplateItem[]
  expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | Fail> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!gate.ok) return { error: NOT_ADMIN }
  if (!Array.isArray(input.items) || input.items.length === 0) return { error: 'The template needs at least one item.' }
  if (input.items.length > 200) return { error: 'A template can have at most 200 items.' }
  // readScheduleTemplate also checks the item SHAPES (it is what apply uses to read it back).
  const content = { version: SCHEDULE_TEMPLATE_VERSION, items: input.items }
  if (readScheduleTemplate(content) === null) {
    let errors: string[] = []
    try { errors = validateScheduleTemplate(input.items) } catch { /* malformed shape — the generic sentence below */ }
    return { error: errors[0] ?? 'The template could not be read. Reload the page and try again.' }
  }
  const table = () => supabase.schema('solar').from('schedule_templates')
  let updatedAt: unknown
  if (input.expectedUpdatedAt === null) {
    const { data, error } = await table().insert({ organisation_id: ctx.organisationId, content }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : error.code === '42501' ? NOT_ADMIN : humanScheduleError(error) }
    updatedAt = (data as Array<{ updated_at?: string }>)[0]?.updated_at
  } else {
    const { data, error } = await table().update({ content })
      .eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
    if (error) return { error: error.code === '42501' ? NOT_ADMIN : humanScheduleError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = (data as Array<{ updated_at?: string }>)[0]?.updated_at
  }
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: String(updatedAt ?? '') }
}
