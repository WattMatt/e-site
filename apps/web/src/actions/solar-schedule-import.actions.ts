'use server'
/**
 * Commit an import (spec §14.1). Re-checks Edit, re-reads and re-validates the
 * plan (it is directly invocable: shapes, dates, loops, sizes), resolves owners
 * (owner decision Q5) and writes everything — including "replace" — in ONE RPC
 * transaction.
 *
 * Owners: matched ONLY against the Solar-eligible list
 * (solar.schedule_owner_candidates — owner decision Q4), email first, then a
 * unique full name. Anything else — an unknown name, an ambiguous name, or a
 * client viewer / supplier named in the file — is sent as null, which the RPC
 * resolves to the project's default owner (falling back to the importer, who
 * holds Solar Edit and is therefore eligible), and is listed back to the user.
 * An ineligible person is never sent to the database, so the SOL01 guard cannot
 * refuse the whole import over one row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import { ImportPlanSchema, planToInputs, resolveOwnerHints, toRpcTask } from '@/lib/solar/schedule/inputs'
import { validateImportPlan, type ImportPlan } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** A task whose owner in the file could not be given the task (row = the file's row, null for a template). */
export interface UnmatchedOwnerRow { row: number | null; task: string; owner: string }

export async function commitScheduleImportAction(input: {
  projectId: string
  mode: 'append' | 'replace'
  plan: ImportPlan
}): Promise<{ ok: true; created: number; unmatchedOwners: string[]; unmatchedRows: UnmatchedOwnerRow[] } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (input.mode !== 'append' && input.mode !== 'replace') return { error: 'Choose whether to add to the programme or replace it.' }
  const parsed = ImportPlanSchema.safeParse(input.plan)
  if (!parsed.success) return { error: 'The import could not be read. Start the import again.' }
  const plan = parsed.data as ImportPlan
  const issues = validateImportPlan(plan)
  if (issues.length) return { error: issues[0].message }

  const { data: ownerRows, error: ownerErr } = await supabase.schema('solar').rpc('schedule_owner_candidates', { p_project_id: input.projectId })
  if (ownerErr) return { error: humanScheduleError(ownerErr) }
  const owners = ((ownerRows ?? []) as Array<{ user_id: string; full_name: string | null; email: string | null }>)
    .map((o) => ({ id: o.user_id, name: o.full_name ?? '', email: o.email ?? '' }))
  const hints = plan.tasks.map((t) => t.ownerHint)
  const { ids, unmatched } = resolveOwnerHints(hints, owners)
  const unmatchedRows: UnmatchedOwnerRow[] = plan.tasks.flatMap((t, i) => {
    const h = hints[i]?.trim()
    return h && ids[i] === null ? [{ row: t.sourceRow, task: t.name, owner: h }] : []
  })
  const { tasks, links } = planToInputs(plan, (i) => ids[i])

  const { error } = await supabase.schema('solar').rpc('schedule_create_tasks', {
    p_project_id: input.projectId,
    p_tasks: tasks.map(toRpcTask),
    p_links: links.map((l) => ({ from: l.from, to: l.to, type: l.type, lag: l.lagDays })),
    p_replace: input.mode === 'replace',
  })
  if (error) return { error: humanScheduleError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'schedule_imported', objectRef: { count: tasks.length, mode: input.mode } })
  return { ok: true, created: tasks.length, unmatchedOwners: unmatched, unmatchedRows }
}
