import 'server-only'
/**
 * Owners/admins of an organisation — the Solar grantors (00207
 * public.solar_is_grantor). Read with the service client because
 * user_organisations RLS is own-row-only; callers only use this AFTER their
 * own gate (a requester notifying the people who can answer, or naming them
 * on the "Request sent to …" line).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface SolarGrantor {
  userId: string
  fullName: string | null
  email: string | null
}

export async function listSolarGrantors(organisationId: string): Promise<SolarGrantor[]> {
  const svc = createServiceClient() as unknown as AnyClient
  const { data: rows, error } = await svc
    .from('user_organisations').select('user_id')
    .eq('organisation_id', organisationId).eq('is_active', true).in('role', ['owner', 'admin'])
  if (error || !rows?.length) return []
  const ids = [...new Set(rows.map((r: { user_id: string }) => r.user_id))]
  const { data: profiles } = await svc.from('profiles').select('id, full_name, email').in('id', ids)
  const byId = new Map((profiles ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p]))
  return ids.map((id) => ({ userId: id, fullName: byId.get(id)?.full_name ?? null, email: byId.get(id)?.email ?? null }))
}

/** Names for "Request sent to Ann and Ben" — never an email address. */
export function grantorDisplayNames(grantors: SolarGrantor[]): string[] {
  const names = grantors.map((g) => g.fullName?.trim() || 'an organisation admin')
  return [...new Set(names)]
}

/**
 * A user's email for a Solar decision notice (owner default 4: decisions reach
 * the requester by bell AND email). Service client: profiles is own-row-only.
 * Callers use it only AFTER their own grantor gate, and only for the person the
 * decision is about.
 */
export async function profileEmail(userId: string): Promise<string | null> {
  const svc = createServiceClient() as unknown as AnyClient
  const { data } = await svc.from('profiles').select('email').eq('id', userId).maybeSingle()
  const email = (data as { email?: string | null } | null)?.email?.trim()
  return email || null
}

/** A user's display name for notification text. */
export async function profileName(userId: string): Promise<string> {
  const svc = createServiceClient() as unknown as AnyClient
  const { data } = await svc.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  const name = (data as { full_name?: string | null } | null)?.full_name?.trim()
  return name || 'A project member'
}
