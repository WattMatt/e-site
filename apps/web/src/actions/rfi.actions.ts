'use server'

/**
 * RFI server actions — RFI lifecycle (create / respond / close), each one
 * announced on the project's shared notification channel.
 *
 * All three events go through `notifyRfiEvent` → `notifyEntityEvent`, the same
 * bell+email channel diary, QC, snags and site forms use. Before that, only
 * `create` sent an email while the toggle promised all three, and respond/close
 * relied on push — which delivers nothing, because `public.push_tokens` is
 * empty. See apps/web/src/lib/rfi-email.ts for the close-window rule.
 *
 * Attachment uploads stay client-side (they need access to browser File
 * objects + signed-URL flow); these actions return the inserted row's id
 * so the caller can run `commitStagedAttachments` against it.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'
import { emitProductEvent } from '@/lib/analytics/product-events'
import {
  createRfiSchema,
  respondToRfiSchema,
  rfiService,
  ORG_WRITE_ROLES,
  RFI_CLOSE_REFUSED,
  type CreateRfiInput,
  type RespondToRfiInput,
} from '@esite/shared'
import { z } from 'zod'

import { requireEffectiveRole } from '@/lib/auth/require-role'
import { notifyRfiEvent } from '@/lib/rfi-email'

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
  // First-party copy of the moment above, including the assignee_source
  // diagnostic §15 names: PostHog goes silent when its key is unset, and a
  // quiet quarter and a missing env var are then indistinguishable.
  await emitProductEvent({
    actorId: user.id,
    projectId: i.projectId,
    event: 'rfi_created',
    properties: {
      rfi_id: rfi.id,
      has_assignee: !!rfi.assigned_to,
      assignee_source: assigneeSource,
      priority: i.priority,
    },
  })

  // Bell to the whole project team minus the raiser (every active member +
  // implicit org owners/admins/PMs, resolved live), email to the roster gated
  // on notifyRfiEmail — one resolve for both channels.
  await notifyRfiEvent({
    event: 'created',
    projectId: i.projectId,
    rfiId: rfi.id,
    rfiSubject: rfi.subject,
    actorId: user.id,
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
): Promise<{ responseId?: string; error?: string; statusWarning?: string }> {
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
  //
  // The answer is already saved, so a refused flip must never discard it. It is
  // reported by ROWS AFFECTED rather than by an error: migration 00201's
  // RESTRICTIVE policy narrows UPDATE to callers with an effective role on the
  // RFI's project, and a policy that matches no row raises nothing. An org
  // member with no role on this project can still write the response row
  // (projects.rfi_responses admits any non-client_viewer org member), so this
  // is reachable — 43 of 108 member/project pairs on the four RFI-bearing
  // projects, measured 2026-09-14.
  const { data: moved, error: statusErr } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .update({ status: 'responded' })
    .eq('id', parsed.data.rfiId)
    .select('id')
  const statusWarning =
    statusErr?.message ??
    ((moved ?? []).length === 0
      ? 'Your response was saved, but the RFI could not be moved to Responded — you have no role on this project. Ask a project manager to add you.'
      : undefined)

  await trackServer(user.id, ANALYTICS_EVENTS.RFI_RESPONDED, {
    rfi_id: rfi.id,
    response_id: response.id,
    project_id: rfi.project_id,
    org_id: rfi.organisation_id,
  })
  await emitProductEvent({
    actorId: user.id,
    projectId: rfi.project_id,
    event: 'rfi_responded',
    properties: { rfi_id: rfi.id, response_id: response.id },
  })

  // The contractually significant half. This used to be a bell to raiser +
  // assignee only — and every responded RFI in production has assigned_to
  // null, so "both" was one person, on a channel with no push behind it.
  await notifyRfiEvent({
    event: 'responded',
    projectId: rfi.project_id,
    rfiId: rfi.id,
    rfiSubject: rfi.subject,
    actorId: user.id,
    assigneeId: rfi.assigned_to,
    bellEntityId: response.id,
  })

  revalidatePath(`/rfis/${rfi.id}`)
  revalidatePath('/rfis')
  return { responseId: response.id, ...(statusWarning ? { statusWarning } : {}) }
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

  // Only the raiser, or a governing role on the RFI's own project, may close.
  // This is §03 §1.8's "only the gatekeeper closes" — the RFI work item's
  // gatekeeper is its creator, and a mirrored RFI item's creator is raised_by.
  // Migration 00201 enforces the same rule at the database for every write
  // path; this check exists so the person who cannot close is told why here,
  // rather than meeting a raw policy refusal. Server actions are directly
  // invocable and sit outside (admin)/layout.tsx, so it is a real gate and not
  // decoration.
  if (rfi.raised_by !== user.id) {
    const gate = await requireEffectiveRole(supabase, rfi.project_id, ORG_WRITE_ROLES)
    if (!gate.ok) return { error: RFI_CLOSE_REFUSED }
  }

  const { data: closed, error } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user.id,
    })
    .eq('id', rfiId)
    .select('id')

  if (error) return { error: error.message }
  // 00201's RESTRICTIVE policy refuses SILENTLY — a policy that matches no row
  // raises nothing, so without this the action would report a close that never
  // happened and the page would re-render unchanged with no explanation.
  if ((closed ?? []).length === 0) return { error: RFI_CLOSE_REFUSED }

  await trackServer(user.id, ANALYTICS_EVENTS.RFI_CLOSED, {
    rfi_id: rfi.id,
    project_id: rfi.project_id,
    org_id: rfi.organisation_id,
  })
  await emitProductEvent({
    actorId: user.id,
    projectId: rfi.project_id,
    event: 'rfi_closed',
    properties: { rfi_id: rfi.id },
  })

  // Bell always; the email is withheld when a response landed moments ago, so
  // one answer-and-close sitting is one email, not two.
  await notifyRfiEvent({
    event: 'closed',
    projectId: rfi.project_id,
    rfiId: rfi.id,
    rfiSubject: rfi.subject,
    actorId: user.id,
    assigneeId: rfi.assigned_to,
  })

  revalidatePath(`/rfis/${rfi.id}`)
  revalidatePath('/rfis')
  return {}
}
