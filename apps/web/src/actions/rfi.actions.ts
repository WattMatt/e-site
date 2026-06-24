'use server'

/**
 * RFI server actions — RFI lifecycle (create / respond / close) with
 * notification dispatch to the affected parties.
 *
 * Mirrors the snag.actions.ts pattern: validates with Zod, performs the
 * write, then best-effort fires the `send-notification` Edge Function
 * (service_role) so the affected users get a push notification with a
 * deep-link route to the RFI.
 *
 * Attachment uploads stay client-side (they need access to browser File
 * objects + signed-URL flow); these actions return the inserted row's id
 * so the caller can run `commitStagedAttachments` against it.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'
import {
  createRfiSchema,
  respondToRfiSchema,
  rfiService,
  type CreateRfiInput,
  type RespondToRfiInput,
} from '@esite/shared'
import { z } from 'zod'

import { dispatchNotification } from '@/lib/notifications'
import { dispatchRfiEmail } from '@/lib/rfi-email'

const uuidSchema = z.string().uuid()

// ─── createRfiAction ────────────────────────────────────────────────────

export async function createRfiAction(
  input: CreateRfiInput,
): Promise<{ rfiId?: string; error?: string }> {
  const parsed = createRfiSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: mem, error: memErr } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (memErr || !mem) return { error: 'No active organisation membership' }

  const i = parsed.data

  // Delegate the insert to the shared service so the project-default assignee
  // fallback + empty-string coercion apply uniformly across web, mobile, and
  // the floor-plan markup caller.
  let rfi: { id: string; subject: string; assigned_to: string | null }
  try {
    rfi = (await rfiService.create(supabase as any, mem.organisation_id, user.id, i)) as any
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to create RFI' }
  }

  // Diagnostic: record where the assignee came from so we can confirm
  // post-deploy how many RFIs still land unassigned and via which path.
  const assigneeSource = i.assignedTo ? 'explicit' : rfi.assigned_to ? 'project_default' : 'none'

  await trackServer(user.id, ANALYTICS_EVENTS.RFI_CREATED, {
    rfi_id: rfi.id,
    project_id: i.projectId,
    org_id: mem.organisation_id,
    has_assignee: !!rfi.assigned_to,
    assignee_source: assigneeSource,
    priority: i.priority,
  })

  // In-app bell → the whole project team (active members, minus the raiser).
  // RFIs are team-wide; same audience as the email (see dispatchRfiEmail).
  const { data: memberRows } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', i.projectId)
    .eq('is_active', true)
  const memberIds: string[] = [
    ...new Set(
      ((memberRows ?? []) as { user_id: string }[])
        .map((m) => m.user_id)
        .filter((uid) => uid && uid !== user.id),
    ),
  ]
  if (memberIds.length) {
    await dispatchNotification({
      userIds: memberIds,
      title: 'New RFI raised',
      body: `"${rfi.subject}" — ${i.priority} priority${i.dueDate ? ` · due ${i.dueDate}` : ''}`,
      route: `/rfis/${rfi.id}`,
      type: 'rfi_created',
      entityType: 'rfi',
      entityId: rfi.id,
    })
  }

  // Email channel → all active project members, gated on notifyRfiEmail.
  await dispatchRfiEmail({
    client: supabase,
    projectId: i.projectId,
    rfiId: rfi.id,
    rfiSubject: rfi.subject,
    priority: i.priority,
    dueDate: i.dueDate ?? null,
    assigneeId: rfi.assigned_to,
    raiserId: user.id,
  })

  revalidatePath('/rfis')
  revalidatePath(`/projects/${i.projectId}`)
  return { rfiId: rfi.id }
}

// ─── respondToRfiAction ─────────────────────────────────────────────────

export async function respondToRfiAction(
  input: RespondToRfiInput,
): Promise<{ responseId?: string; error?: string }> {
  const parsed = respondToRfiSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch RFI parties so we know whom to notify.
  const { data: rfi, error: rfiErr } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .select('id, subject, raised_by, assigned_to, organisation_id, project_id')
    .eq('id', parsed.data.rfiId)
    .single()
  if (rfiErr || !rfi) return { error: 'RFI not found' }

  const { data: response, error } = await (supabase as any)
    .schema('projects')
    .from('rfi_responses')
    .insert({
      rfi_id: parsed.data.rfiId,
      body: parsed.data.body,
      responded_by: user.id,
    })
    .select('id')
    .single()

  if (error || !response) return { error: error?.message ?? 'Failed to save response' }

  // Flip RFI status — status='responded' is the canonical "awaiting raiser
  // review" state per the schema enum.
  await (supabase as any)
    .schema('projects')
    .from('rfis')
    .update({ status: 'responded' })
    .eq('id', parsed.data.rfiId)

  await trackServer(user.id, ANALYTICS_EVENTS.RFI_RESPONDED, {
    rfi_id: rfi.id,
    response_id: response.id,
    project_id: rfi.project_id,
    org_id: rfi.organisation_id,
  })

  // Notify the raiser + assignee (skip the responder themselves).
  await dispatchNotification({
    userIds: [rfi.raised_by, rfi.assigned_to].filter(
      (uid): uid is string => Boolean(uid) && uid !== user.id,
    ),
    title: 'RFI response received',
    body: `"${rfi.subject}" — new response posted`,
    route: `/rfis/${rfi.id}`,
    type: 'rfi_response',
    entityType: 'rfi_response',
    entityId: response.id,
  })

  revalidatePath(`/rfis/${rfi.id}`)
  revalidatePath('/rfis')
  return { responseId: response.id }
}

// ─── closeRfiAction ────────────────────────────────────────────────────

export async function closeRfiAction(rfiId: string): Promise<{ error?: string }> {
  const idParse = uuidSchema.safeParse(rfiId)
  if (!idParse.success) return { error: 'Invalid RFI id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: rfi, error: rfiErr } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .select('id, subject, raised_by, assigned_to, organisation_id, project_id, status')
    .eq('id', rfiId)
    .single()
  if (rfiErr || !rfi) return { error: 'RFI not found' }

  if (rfi.status === 'closed') return { error: 'RFI is already closed' }

  const { error } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user.id,
    })
    .eq('id', rfiId)

  if (error) return { error: error.message }

  await trackServer(user.id, ANALYTICS_EVENTS.RFI_CLOSED, {
    rfi_id: rfi.id,
    project_id: rfi.project_id,
    org_id: rfi.organisation_id,
  })

  // Notify both raiser and assignee unless the closer is one of them.
  await dispatchNotification({
    userIds: [rfi.raised_by, rfi.assigned_to].filter(
      (uid): uid is string => Boolean(uid) && uid !== user.id,
    ),
    title: 'RFI closed',
    body: `"${rfi.subject}" — closed`,
    route: `/rfis/${rfi.id}`,
    type: 'rfi_closed',
    entityType: 'rfi',
    entityId: rfi.id,
  })

  revalidatePath(`/rfis/${rfi.id}`)
  revalidatePath('/rfis')
  return {}
}
