'use server'
/**
 * Solar entry actions for NON-grantors (and the sidebar). Each re-resolves the
 * caller's state with loadSolarEntry — the locked page's rendering is never
 * trusted. 00207's access_requests_guard is the last word on eligibility
 * (it binds requester/org/status, clamps the level, and refuses externals'
 * subscribe requests); these actions only decide which button made sense.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, solarNavBadge, SOLAR_LEVEL_LABELS, type SolarNavBadge } from '@esite/shared'
import { loadSolarEntry } from '@/lib/solar/entry-loader'
import { listSolarGrantors, profileName } from '@/lib/solar/grantors'
import { notifySolarUsers, type SolarNotice } from '@/lib/solar/notify'
import { humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type SolarActionResult = { ok: true } | { error: string }

const NOTE_MAX = 500
const lockedPath = (projectId: string) => `/projects/${projectId}/solar/locked`

async function notifyGrantors(organisationId: string, actorId: string, n: SolarNotice): Promise<void> {
  const grantors = (await listSolarGrantors(organisationId)).filter((g) => g.userId !== actorId)
  await notifySolarUsers(
    grantors.map((g) => g.userId),
    grantors.map((g) => g.email).filter((e): e is string => Boolean(e)),
    n,
  )
}

/** Sidebar badge for the current project. Only ever describes the caller. */
export async function getSolarNavStateAction(projectId: string): Promise<SolarNavBadge> {
  const ctx = await loadSolarEntry(projectId)
  return ctx ? solarNavBadge(ctx.state) : 'hidden'
}

/** Polled after the Paystack return: true once the webhook has activated the org. */
export async function getSolarSubscriptionStateAction(projectId: string): Promise<{ active: boolean }> {
  const ctx = await loadSolarEntry(projectId)
  return { active: ctx?.state.kind === 'granted' }
}

export async function requestSolarAccessAction(input: {
  projectId: string
  level: string
  note?: string
}): Promise<SolarActionResult> {
  const level = input.level
  if (!isSolarAccessLevel(level)) return { error: 'Choose the level you need.' }
  const note = (input.note ?? '').trim()
  if (note.length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX} characters.` }

  const supabase = (await createClient()) as unknown as AnyClient
  const ctx = await loadSolarEntry(input.projectId, supabase)
  if (!ctx) return { error: 'Project not found.' }
  const s = ctx.state
  const mayAsk = s.kind === 'request_access' || (s.kind === 'granted' && s.level !== 'edit_financials')
  if (!mayAsk) {
    return { error: s.kind === 'pending' ? 'You already have a request waiting for an answer.' : 'There is nothing to request here.' }
  }

  const { error } = await supabase.schema('solar').from('access_requests').insert({
    project_id: ctx.projectId,
    organisation_id: ctx.organisationId,
    requester_id: ctx.userId,
    kind: 'access',
    requested_level: level,
    note: note || null,
  })
  if (error) return { error: humanSolarError(error) }

  const who = await profileName(ctx.userId)
  await notifyGrantors(ctx.organisationId, ctx.userId, {
    type: 'solar_access_requested',
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    title: `${who} asked for Solar access`,
    body: `${who} asked for ${SOLAR_LEVEL_LABELS[level]} access to Solar on ${ctx.projectName}.${note ? ` Note: "${note}"` : ''}`,
    route: `/projects/${ctx.projectId}/solar/access`,
    email: true,
  })
  await emitProductEvent({ actorId: ctx.userId, projectId: ctx.projectId, event: 'solar_access_requested', properties: { level } })
  revalidatePath(lockedPath(ctx.projectId))
  return { ok: true }
}

export async function askAdminToSubscribeAction(projectId: string): Promise<SolarActionResult> {
  const supabase = (await createClient()) as unknown as AnyClient
  const ctx = await loadSolarEntry(projectId, supabase)
  if (!ctx) return { error: 'Project not found.' }
  if (ctx.state.kind !== 'ask_admin') return { error: 'There is nothing to request here.' }
  // One open request per user per ORG (the DB index is per project).
  if (ctx.state.requestedAt) return { error: 'You have already asked — the admins have been told.' }

  const { error } = await supabase.schema('solar').from('access_requests').insert({
    project_id: ctx.projectId,
    organisation_id: ctx.organisationId,
    requester_id: ctx.userId,
    kind: 'subscribe',
    requested_level: null,
    note: null,
  })
  if (error) return { error: humanSolarError(error) }

  const who = await profileName(ctx.userId)
  await notifyGrantors(ctx.organisationId, ctx.userId, {
    type: 'solar_subscribe_requested',
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    title: `${who} would like Solar for ${ctx.projectName}`,
    body: `${who} would like Solar for ${ctx.projectName}. One subscription covers every project in your organisation.`,
    route: lockedPath(ctx.projectId),
    email: true,
  })
  await emitProductEvent({ actorId: ctx.userId, projectId: ctx.projectId, event: 'solar_subscribe_requested' })
  revalidatePath(lockedPath(ctx.projectId))
  return { ok: true }
}

export async function withdrawSolarRequestAction(projectId: string): Promise<SolarActionResult> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  const { data, error } = await supabase.schema('solar').from('access_requests')
    .update({ status: 'withdrawn' })
    .eq('project_id', projectId).eq('requester_id', user.id).eq('kind', 'access').eq('status', 'pending')
    .select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'There was no request waiting — reload the page.' }
  revalidatePath(lockedPath(projectId))
  return { ok: true }
}
