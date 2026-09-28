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
import {
  isSolarAccessLevel, solarNavBadge, SOLAR_ACCESS_LEVELS, SOLAR_LEVEL_LABELS, type SolarAccessLevel, type SolarNavBadge,
} from '@esite/shared'
import { loadSolarEntry } from '@/lib/solar/entry-loader'
import { listSolarGrantors, profileName } from '@/lib/solar/grantors'
import { notifySolarUsers, type SolarNotice } from '@/lib/solar/notify'
import { humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type SolarActionResult = { ok: true } | { error: string }

const NOTE_MAX = 500
const rank = (l: SolarAccessLevel): number => SOLAR_ACCESS_LEVELS.indexOf(l)
const lockedPath = (projectId: string) => `/projects/${projectId}/solar/locked`

/**
 * Security review: a requester could withdraw and re-ask in a loop and email
 * every owner/admin each time. The bell always rings; the EMAIL waits until
 * the same person has not raised the same kind of request (on this project
 * for access, anywhere in the org for subscribe) within the cooldown.
 * Reads the requester's OWN rows (RLS: requester_id = auth.uid()).
 */
const EMAIL_COOLDOWN_MS = 30 * 60 * 1000

async function askedRecently(
  supabase: AnyClient,
  r: { userId: string; kind: 'access' | 'subscribe'; projectId: string; organisationId: string; newId: string | null },
): Promise<boolean> {
  const since = new Date(Date.now() - EMAIL_COOLDOWN_MS).toISOString()
  let q = supabase.schema('solar').from('access_requests').select('id')
    .eq('requester_id', r.userId).eq('kind', r.kind).gte('created_at', since)
  q = r.kind === 'access' ? q.eq('project_id', r.projectId) : q.eq('organisation_id', r.organisationId)
  const { data, error } = await q
  if (error) return false
  return ((data ?? []) as Array<{ id: string }>).some((row) => row.id !== r.newId)
}

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
  if (s.kind !== 'request_access' && s.kind !== 'granted') {
    return { error: s.kind === 'pending' ? 'You already have a request waiting for an answer.' : 'There is nothing to request here.' }
  }
  // Bound the request here rather than let 00207's guard silently clamp it:
  // a clamped row would still email every admin the level that was ASKED for.
  if (rank(level) > rank(s.maxLevel)) {
    return { error: 'That level is higher than you can hold on this project. Members from outside the organisation can have View only.' }
  }
  if (s.kind === 'granted' && rank(level) <= rank(s.level)) return { error: 'You already have that level or higher.' }

  const { data: inserted, error } = await supabase.schema('solar').from('access_requests').insert({
    project_id: ctx.projectId,
    organisation_id: ctx.organisationId,
    requester_id: ctx.userId,
    kind: 'access',
    requested_level: level,
    note: note || null,
  }).select('id, requested_level')
  if (error) return { error: humanSolarError(error) }
  // The notice names what the database stored (the guard may still clamp).
  const row = Array.isArray(inserted) ? (inserted[0] as { id?: string; requested_level?: unknown } | undefined) : undefined
  const stored = isSolarAccessLevel(row?.requested_level) ? row.requested_level : level
  const quiet = await askedRecently(supabase, {
    userId: ctx.userId, kind: 'access', projectId: ctx.projectId, organisationId: ctx.organisationId, newId: row?.id ?? null,
  })

  const who = await profileName(ctx.userId)
  await notifyGrantors(ctx.organisationId, ctx.userId, {
    type: 'solar_access_requested',
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    title: `${who} asked for Solar access`,
    body: `${who} asked for ${SOLAR_LEVEL_LABELS[stored]} access to Solar on ${ctx.projectName}.${note ? ` Note: "${note}"` : ''}`,
    route: `/projects/${ctx.projectId}/solar/access`,
    email: !quiet,
  })
  await emitProductEvent({ actorId: ctx.userId, projectId: ctx.projectId, event: 'solar_access_requested', properties: { level: stored } })
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

  const { data: inserted, error } = await supabase.schema('solar').from('access_requests').insert({
    project_id: ctx.projectId,
    organisation_id: ctx.organisationId,
    requester_id: ctx.userId,
    kind: 'subscribe',
    requested_level: null,
    note: null,
  }).select('id')
  if (error) return { error: humanSolarError(error) }
  const newId = Array.isArray(inserted) ? ((inserted[0] as { id?: string } | undefined)?.id ?? null) : null
  const quiet = await askedRecently(supabase, {
    userId: ctx.userId, kind: 'subscribe', projectId: ctx.projectId, organisationId: ctx.organisationId, newId,
  })

  const who = await profileName(ctx.userId)
  await notifyGrantors(ctx.organisationId, ctx.userId, {
    type: 'solar_subscribe_requested',
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    title: `${who} would like Solar for ${ctx.projectName}`,
    body: `${who} would like Solar for ${ctx.projectName}. One subscription covers every project in your organisation.`,
    // Grantors answer subscribe requests on the Access panel (owner default 3).
    route: `/projects/${ctx.projectId}/solar/access`,
    email: !quiet,
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
