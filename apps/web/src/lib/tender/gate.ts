import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = any

export interface GatedTender {
  id: string
  project_id: string
  organisation_id: string
  status: string
  closing_at: string | null
  package: string
  title: string
}

/**
 * Read the tender AS THE CALLER (row security: tenders_select + site_scope),
 * never with the service key first, so a tender on a site the caller cannot
 * access reads as not found. Then gate on ORG_WRITE_ROLES for THAT project.
 * Returns the caller's cookie client so table access stays under row security.
 */
export async function gateTender(
  tenderId: string,
): Promise<{ ok: true; supabase: AnyClient; tender: GatedTender } | { ok: false; error: string }> {
  const supabase = (await createClient()) as AnyClient
  const { data: t } = await supabase
    .schema('projects')
    .from('tenders')
    .select('id, project_id, organisation_id, status, closing_at, package, title')
    .eq('id', tenderId)
    .maybeSingle()
  if (!t) return { ok: false, error: 'Tender not found' }
  const guard = await requireEffectiveRole(supabase, t.project_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }
  return { ok: true, supabase, tender: t as GatedTender }
}

/** Every file of a tender lives under this storage prefix (enforced in SQL too). */
export function tenderPrefix(t: { organisation_id: string; project_id: string; id: string }): string {
  return `${t.organisation_id}/${t.project_id}/${t.id}/`
}

/** Owner switch for emailing invitations to contractors. Shipped unset (off). */
export function tenderInvitesEnabled(): boolean {
  return process.env.TENDER_INVITES_ENABLED === 'true'
}
