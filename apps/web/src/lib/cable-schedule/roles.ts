/**
 * Cable schedule role mapping (§15.2).
 *
 * The spec defines five role types (Designer / Site Operator / Verifier /
 * Admin / Viewer) on top of the existing org roles. Phase-1 simplification:
 * map them onto user_organisations.role rather than ship a separate role
 * dimension. The mapping below covers the access matrix in §15.2:
 *
 *   role          | edit measured | enter confirmed | sign off | edit design fields
 *   ---           |---            |---              |---       |---
 *   Designer      | yes           | no              | no       | yes
 *   Site Operator | no            | yes (draft)     | no       | no
 *   Verifier      | no            | yes             | yes      | no
 *   Admin         | yes           | yes             | yes      | yes
 *   Viewer        | no            | no              | no       | no
 *
 * Where an org role straddles two cable-schedule roles (e.g. a PM who
 * scales drawings AND signs off as-built), we honour the more permissive
 * mapping — the worst-case real-world user is one human filling both
 * design and verification seats.
 */

import type { OrgRole } from '@esite/shared'

export type CableScheduleRole = 'Designer' | 'SiteOperator' | 'Verifier' | 'Admin' | 'Viewer'

// OrgRole — canonical shared vocabulary (packages/shared/src/types). Re-exported
// so existing cable-schedule importers (export-role.ts) keep their import path.
export type { OrgRole }

export function cableRoleFor(orgRole: OrgRole | null | undefined): CableScheduleRole {
  switch (orgRole) {
    case 'owner':
    case 'admin':
      return 'Admin'
    case 'project_manager':
      // PMs do both design + sign-off in this firm's working model.
      return 'Verifier'
    case 'client_viewer':
      return 'Viewer'
    default:
      return 'Viewer'
  }
}

export const ROLE_CAPS: Record<CableScheduleRole, {
  editMeasured: boolean
  enterConfirmed: boolean
  signOff: boolean
  editDesignFields: boolean
  acceptVariance: boolean
  requestRemeasure: boolean
  requestDesignReview: boolean
}> = {
  Designer: {
    editMeasured: true,
    enterConfirmed: false,
    signOff: false,
    editDesignFields: true,
    acceptVariance: false,
    requestRemeasure: false,
    requestDesignReview: true,
  },
  SiteOperator: {
    editMeasured: false,
    enterConfirmed: true,
    signOff: false,
    editDesignFields: false,
    acceptVariance: false,
    requestRemeasure: true,
    requestDesignReview: false,
  },
  Verifier: {
    editMeasured: true,        // PMs edit design fields in our model
    enterConfirmed: true,
    signOff: true,
    editDesignFields: true,
    acceptVariance: true,
    requestRemeasure: true,
    requestDesignReview: true,
  },
  Admin: {
    editMeasured: true,
    enterConfirmed: true,
    signOff: true,
    editDesignFields: true,
    acceptVariance: true,
    requestRemeasure: true,
    requestDesignReview: true,
  },
  Viewer: {
    editMeasured: false,
    enterConfirmed: false,
    signOff: false,
    editDesignFields: false,
    acceptVariance: false,
    requestRemeasure: false,
    requestDesignReview: false,
  },
}

/** Helper: lookup user's org role for the user's active org. */
export async function lookupCableRole(
  supabase: any,
  userId: string,
  organisationId: string,
): Promise<CableScheduleRole> {
  const { data } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', userId)
    .eq('organisation_id', organisationId)
    .eq('is_active', true)
    .single()
  return cableRoleFor((data as { role?: OrgRole } | null)?.role ?? null)
}
