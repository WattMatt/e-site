'use server'
/**
 * Grantor actions for the Solar Access panel (spec §1.3). Each re-checks
 * public.solar_is_grantor (org owner/admin of the project's org) — never the
 * page gate. The database remains the last word: 00207's project_access RLS
 * (grantor-only writes), project_access_bind (eligibility + per-user maximum:
 * externals cap at View, clients/suppliers refused) and access_requests_guard
 * (approval writes the grant). Every write is conditioned on what the grantor
 * saw (updated_at / status = 'pending') so a concurrent change is refused.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, SOLAR_LEVEL_LABELS } from '@esite/shared'
import { notifySolarUsers } from '@/lib/solar/notify'
import { recordSolarAudit } from '@/lib/solar/audit'
import { profileEmail } from '@/lib/solar/grantors'
import { ALREADY_ANSWERED, STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export type SolarAccessActionResult = { ok: true } | { error: string }
export type SetLevelResult = { ok: true; updatedAt: string | null } | { error: string }
export type CopyAccessResult = { ok: true; copied: number; skipped: number } | { error: string }

const NOT_GRANTOR = 'Only an organisation owner or admin can manage Solar access.'
const accessPath = (projectId: string) => `/projects/${projectId}/solar/access`

async function grantorCheck(supabase: AnyClient, projectId: string): Promise<{ userId: string } | { error: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  const { data, error } = await supabase.rpc('solar_is_grantor', { p_project_id: projectId })
  if (error || data !== true) return { error: NOT_GRANTOR }
  return { userId: user.id }
}

/**
 * Owner default 4 (2026-09-28): an access decision reaches the person it is
 * about by bell AND email — the same channels a request reaches the admins by.
 * notifySolarUsers filters the suppression list; there is no per-project Solar
 * email toggle (project_settings toggles are per module).
 */
async function recipientEmails(userId: string): Promise<string[]> {
  const email = await profileEmail(userId)
  return email ? [email] : []
}

async function projectName(supabase: AnyClient, projectId: string): Promise<string> {
  const { data } = await supabase.schema('projects').from('projects').select('name').eq('id', projectId).maybeSingle()
  return (data as { name?: string } | null)?.name ?? 'this project'
}

export async function setSolarMemberLevelAction(input: {
  projectId: string
  userId: string
  level: string | null
  expectedUpdatedAt: string | null
}): Promise<SetLevelResult> {
  const { projectId, userId, expectedUpdatedAt } = input
  const level = input.level
  if (level !== null && !isSolarAccessLevel(level)) return { error: 'Choose a level.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await grantorCheck(supabase, projectId)
  if ('error' in gate) return gate

  const table = () => supabase.schema('solar').from('project_access')
  let updatedAt: string | null = null
  let verb: 'access_granted' | 'access_changed' | 'access_removed'

  if (level === null) {
    if (!expectedUpdatedAt) return { error: 'This member has no Solar access to remove.' }
    const { data, error } = await table().delete()
      .eq('project_id', projectId).eq('user_id', userId).eq('updated_at', expectedUpdatedAt)
      .select('user_id')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    verb = 'access_removed'
  } else if (!expectedUpdatedAt) {
    // organisation_id, granted_by and granted_at are bound by project_access_bind.
    const { data, error } = await table().insert({ project_id: projectId, user_id: userId, level }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanSolarError(error) }
    updatedAt = (Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined) ?? null
    verb = 'access_granted'
  } else {
    const { data, error } = await table().update({ level })
      .eq('project_id', projectId).eq('user_id', userId).eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
    if (error) return { error: humanSolarError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = (data[0]?.updated_at as string | undefined) ?? null
    verb = 'access_changed'
  }

  const name = await projectName(supabase, projectId)
  await recordSolarAudit({ projectId, actorId: gate.userId, verb, objectRef: { user_id: userId, level } })
  await notifySolarUsers([userId], await recipientEmails(userId), {
    type: 'solar_access_changed',
    projectId,
    projectName: name,
    title: level ? 'Your Solar access changed' : 'Your Solar access was removed',
    body: level
      ? `You now have ${SOLAR_LEVEL_LABELS[level]} access to Solar on ${name}.`
      : `Your Solar access on ${name} was removed.`,
    route: `/projects/${projectId}/solar`,
    email: true,
  })
  await emitProductEvent({ actorId: gate.userId, projectId, event: 'solar_access_changed', properties: { level, via: 'panel' } })
  revalidatePath(accessPath(projectId))
  return { ok: true, updatedAt }
}

export async function decideSolarRequestAction(input: {
  requestId: string
  decision: 'approve' | 'decline'
  level?: string
  reason?: string
}): Promise<SolarAccessActionResult> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: req } = await supabase.schema('solar').from('access_requests')
    .select('id, project_id, requester_id, kind, status')
    .eq('id', input.requestId)
    .maybeSingle()
  if (!req) return { error: 'Request not found.' }
  const r = req as { id: string; project_id: string; requester_id: string; kind: string; status: string }

  const gate = await grantorCheck(supabase, r.project_id)
  if ('error' in gate) return gate
  // One control per intent: a subscribe request is closed with "Mark done"
  // (markSubscribeRequestDoneAction), never approved at a level.
  if (r.kind !== 'access') return { error: 'That is not an access request.' }
  if (r.status !== 'pending') return { error: ALREADY_ANSWERED }

  const approve = input.decision === 'approve'
  const level = input.level
  const approvedLevel = approve && r.kind === 'access' && isSolarAccessLevel(level) ? level : null
  if (approve && r.kind === 'access' && !approvedLevel) return { error: 'Choose the level to approve.' }
  const reason = (input.reason ?? '').trim().slice(0, 500)

  const { data, error } = await supabase.schema('solar').from('access_requests')
    .update({ status: approve ? 'approved' : 'declined', approved_level: approvedLevel })
    .eq('id', r.id).eq('status', 'pending')
    .select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: ALREADY_ANSWERED }

  const name = await projectName(supabase, r.project_id)
  await recordSolarAudit({
    projectId: r.project_id,
    actorId: gate.userId,
    verb: approve ? 'access_request_approved' : 'access_request_declined',
    objectRef: { request_id: r.id, user_id: r.requester_id, level: approvedLevel, ...(!approve && reason ? { reason } : {}) },
  })
  await notifySolarUsers([r.requester_id], await recipientEmails(r.requester_id), approve
    ? {
        type: 'solar_access_changed',
        projectId: r.project_id,
        projectName: name,
        title: 'Your Solar access request was approved',
        body: approvedLevel
          ? `You now have ${SOLAR_LEVEL_LABELS[approvedLevel]} access to Solar on ${name}.`
          : `Your Solar request on ${name} was approved.`,
        route: `/projects/${r.project_id}/solar`,
        email: true,
      }
    : {
        type: 'solar_access_declined',
        projectId: r.project_id,
        projectName: name,
        title: 'Your Solar access request was declined',
        body: `Your request for Solar access on ${name} was declined.${reason ? ` Reason: ${reason}` : ''}`,
        route: `/projects/${r.project_id}/solar`,
        email: true,
      })
  if (approvedLevel) {
    await emitProductEvent({ actorId: gate.userId, projectId: r.project_id, event: 'solar_access_changed', properties: { level: approvedLevel, via: 'request' } })
  }
  revalidatePath(accessPath(r.project_id))
  return { ok: true }
}

/**
 * Owner default 3 (2026-09-28): close an "ask an admin to subscribe" request.
 * Sets status 'approved' through 00207's access_requests_guard, which checks
 * the caller is a grantor, stamps decided_by/decided_at and forces
 * approved_level NULL for a subscribe request. Conditioned on status =
 * 'pending' so a concurrent answer is reported, not overwritten.
 */
export async function markSubscribeRequestDoneAction(requestId: string): Promise<SolarAccessActionResult> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: req } = await supabase.schema('solar').from('access_requests')
    .select('id, project_id, requester_id, kind, status')
    .eq('id', requestId)
    .maybeSingle()
  if (!req) return { error: 'Request not found.' }
  const r = req as { id: string; project_id: string; requester_id: string; kind: string; status: string }

  const gate = await grantorCheck(supabase, r.project_id)
  if ('error' in gate) return gate
  if (r.kind !== 'subscribe') return { error: 'That is not a subscription request.' }
  if (r.status !== 'pending') return { error: ALREADY_ANSWERED }

  const { data, error } = await supabase.schema('solar').from('access_requests')
    .update({ status: 'approved' })
    .eq('id', r.id).eq('kind', 'subscribe').eq('status', 'pending')
    .select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: ALREADY_ANSWERED }

  const name = await projectName(supabase, r.project_id)
  await recordSolarAudit({ projectId: r.project_id, actorId: gate.userId, verb: 'subscribe_request_done', objectRef: { request_id: r.id, user_id: r.requester_id } })
  await notifySolarUsers([r.requester_id], await recipientEmails(r.requester_id), {
    type: 'solar_access_changed',
    projectId: r.project_id,
    projectName: name,
    title: 'Your request for Solar was answered',
    body: `An admin marked your request for Solar on ${name} as done.`,
    route: `/projects/${r.project_id}/solar`,
    email: true,
  })
  revalidatePath(`/projects/${r.project_id}/solar`, 'layout')
  return { ok: true }
}

export async function copySolarAccessFromProjectAction(input: {
  projectId: string
  sourceProjectId: string
}): Promise<CopyAccessResult> {
  const { projectId, sourceProjectId } = input
  if (projectId === sourceProjectId) return { error: 'Choose a different project to copy from.' }

  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await grantorCheck(supabase, projectId)
  if ('error' in gate) return gate
  const { data: projects } = await supabase.schema('projects').from('projects')
    .select('id, organisation_id').in('id', [projectId, sourceProjectId])
  const rows = (projects ?? []) as Array<{ id: string; organisation_id: string }>
  if (rows.length !== 2 || new Set(rows.map((p) => p.organisation_id)).size !== 1) {
    return { error: 'Copy only works between projects of the same organisation.' }
  }
  const sourceGate = await grantorCheck(supabase, sourceProjectId)
  if ('error' in sourceGate) return sourceGate

  const pa = () => supabase.schema('solar').from('project_access')
  const [{ data: source }, { data: target }] = await Promise.all([
    pa().select('user_id, level').eq('project_id', sourceProjectId),
    pa().select('user_id, level').eq('project_id', projectId),
  ])
  const current = new Map(((target ?? []) as Array<{ user_id: string; level: string }>).map((g) => [g.user_id, g.level]))

  let copied = 0
  let skipped = 0
  const changed: Array<{ userId: string; level: string }> = []
  for (const g of (source ?? []) as Array<{ user_id: string; level: string }>) {
    const have = current.get(g.user_id)
    if (have === g.level) continue
    // A member not on this project (or not eligible here) is refused by
    // project_access_bind — counted as skipped, never an error for the batch.
    // Spec §1.3 "copies levels": the source level wins, including a lower one.
    const { data, error } = have === undefined
      ? await pa().insert({ project_id: projectId, user_id: g.user_id, level: g.level }).select('user_id')
      : await pa().update({ level: g.level }).eq('project_id', projectId).eq('user_id', g.user_id).select('user_id')
    // Zero rows (the grant vanished meanwhile, or RLS filtered it) is not a copy.
    if (error || !Array.isArray(data) || data.length === 0) { skipped += 1; continue }
    copied += 1
    changed.push({ userId: g.user_id, level: g.level })
  }

  await recordSolarAudit({ projectId, actorId: gate.userId, verb: 'access_copied', objectRef: { source_project_id: sourceProjectId, copied, skipped } })
  // A copied level is an access decision about that member (spec §1.3 "the
  // member is notified"; owner default 4: bell + email). One notice per user.
  if (changed.length > 0) {
    const name = await projectName(supabase, projectId)
    for (const c of changed) {
      await notifySolarUsers([c.userId], await recipientEmails(c.userId), {
        type: 'solar_access_changed',
        projectId,
        projectName: name,
        title: 'Your Solar access changed',
        body: `You now have ${isSolarAccessLevel(c.level) ? SOLAR_LEVEL_LABELS[c.level] : c.level} access to Solar on ${name}.`,
        route: `/projects/${projectId}/solar`,
        email: true,
      })
    }
  }
  if (copied > 0) {
    await emitProductEvent({ actorId: gate.userId, projectId, event: 'solar_access_changed', properties: { via: 'copy', copied } })
  }
  revalidatePath(accessPath(projectId))
  return { ok: true, copied, skipped }
}
