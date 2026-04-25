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
  type CreateRfiInput,
  type RespondToRfiInput,
} from '@esite/shared'
import { z } from 'zod'

const uuidSchema = z.string().uuid()

interface NotifyArgs {
  userIds: string[]
  title: string
  body: string
  route: string
  type: string          // notification type (e.g. 'rfi_assigned', 'rfi_response')
  entityType?: string   // 'rfi' | 'rfi_response' — drives in-app linking
  entityId?: string     // the rfi or response uuid
}

async function dispatchNotification({
  userIds, title, body, route, type, entityType, entityId,
}: NotifyArgs): Promise<void> {
  // Best-effort: never block the parent action on notification failure.
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return

    const unique = [...new Set(userIds.filter(Boolean))]
    if (unique.length === 0) return

    await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        userIds: unique,
        title,
        body,
        type,
        entityType,
        entityId,
        data: { route },
      }),
    }).catch(() => {/* non-blocking */})
  } catch {
    // Notification failure must never propagate.
  }
}

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
  const { data: rfi, error } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .insert({
      project_id: i.projectId,
      organisation_id: mem.organisation_id,
      raised_by: user.id,
      subject: i.subject,
      description: i.description,
      priority: i.priority,
      category: i.category ?? null,
      due_date: i.dueDate || null,
      assigned_to: i.assignedTo || null,
      status: 'open',
    })
    .select('id, subject')
    .single()

  if (error || !rfi) return { error: error?.message ?? 'Failed to create RFI' }

  await trackServer(user.id, ANALYTICS_EVENTS.RFI_CREATED, {
    rfi_id: rfi.id,
    project_id: i.projectId,
    org_id: mem.organisation_id,
    has_assignee: !!i.assignedTo,
    priority: i.priority,
  })

  // Notify the assignee (skip if they raised it themselves).
  if (i.assignedTo && i.assignedTo !== user.id) {
    await dispatchNotification({
      userIds: [i.assignedTo],
      title: 'New RFI assigned to you',
      body: `"${rfi.subject}" — ${i.priority} priority${i.dueDate ? ` · due ${i.dueDate}` : ''}`,
      route: `/rfis/${rfi.id}`,
      type: 'rfi_assigned',
      entityType: 'rfi',
      entityId: rfi.id,
    })
  }

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
