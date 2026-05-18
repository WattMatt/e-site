/**
 * Role-gating + cost-redaction policy for cable-schedule export routes.
 *
 * Today the export routes verify auth (user has a session) but don't enforce
 * project membership or cost-data redaction. Per spec §3 + the Session 16
 * client_viewer RLS work (migration 00034), client_viewers are project-scoped
 * read-only and should never see cost data.
 *
 * `lookupCableRole` in ./roles.ts maps onwards to a CableScheduleRole
 * (Designer/SiteOperator/Verifier/Admin/Viewer) and defaults to Viewer when
 * the user has no row in user_organisations — which collapses two distinct
 * outcomes (genuinely unassigned vs. genuinely client_viewer) into one
 * "Viewer". For export gating we need to distinguish them, so this module
 * reads the raw org role directly.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrgRole } from './roles'
import type { ExportPayload } from './export-payload'

export type ExportPolicy = {
  canExport: boolean
  redactCost: boolean
  reason?: string
}

/**
 * Decide whether a user may export this revision and whether cost data
 * must be redacted.
 *
 * - owner / admin / project_manager / field_worker: full export.
 * - client_viewer: project-scoped — must be active in project_members for
 *   the project. Cost data always redacted.
 * - Anyone else (no membership / unknown role): blocked.
 */
export async function getExportPolicy(
  supabase: SupabaseClient,
  userId: string,
  organisationId: string,
  projectId: string,
): Promise<ExportPolicy> {
  const { data: orgRow } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', userId)
    .eq('organisation_id', organisationId)
    .eq('is_active', true)
    .maybeSingle()

  const role = (orgRow as { role?: OrgRole } | null)?.role ?? null
  if (!role) {
    return {
      canExport: false,
      redactCost: false,
      reason: 'Not a member of this organisation',
    }
  }

  if (
    role === 'owner' ||
    role === 'admin' ||
    role === 'project_manager' ||
    role === 'field_worker'
  ) {
    return { canExport: true, redactCost: false }
  }

  if (role === 'client_viewer') {
    const { data: pm } = await (supabase as any)
      .schema('projects')
      .from('project_members')
      .select('id')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .eq('is_active', true)
      .maybeSingle()
    if (!pm) {
      return {
        canExport: false,
        redactCost: true,
        reason: 'Not assigned to this project',
      }
    }
    return { canExport: true, redactCost: true }
  }

  return {
    canExport: false,
    redactCost: false,
    reason: `Unknown role: ${role}`,
  }
}

/**
 * Strip cost data from an ExportPayload for client_viewer exports.
 *
 * Sets `costRedacted: true` so each renderer's cost section can short-
 * circuit entirely (otherwise the renderers derive the BoM — sizes ×
 * lengths × terminations — from `cables` and emit a fully-itemised
 * bill with R0 rates, leaking contract scale through quantities).
 *
 * Also empties `costLines` and nulls `revision.vat_pct` as a defence-
 * in-depth measure for any future renderer that forgets the flag check.
 *
 * Schedule / tag / change_log content is unaffected — client_viewers can
 * still see what cables exist, just not what they cost.
 */
export function redactPayloadCost<T extends ExportPayload>(payload: T): T {
  return {
    ...payload,
    costRedacted: true,
    costLines: [],
    revision: { ...payload.revision, vat_pct: null },
  }
}
