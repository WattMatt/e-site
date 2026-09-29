/**
 * What a user sees when they open Solar on a project (spec §0.2), as a pure
 * function of the database's answers. The web loader gathers the inputs; the
 * sidebar badge, the /solar redirect, the locked screen and every request
 * action read the SAME resolved state, so they cannot disagree.
 *
 * orgSubscribed comes from public.org_has_solar, which answers only for
 * ACTIVE MEMBERS of the org (false for everyone else). An external member's
 * `false` therefore means "unknown", not "unsubscribed": externals always land
 * on request_access (00208 lets them request View whether or not the org has
 * paid; a grant confers nothing until it does).
 */
import { SOLAR_ACCESS_LEVELS, type SolarAccessLevel } from './access'

/** E-Site roles that can never hold Solar access [D-04b]. */
export const SOLAR_EXCLUDED_ROLES = ['supplier', 'client_viewer'] as const

export const SOLAR_LEVEL_LABELS: Record<SolarAccessLevel, string> = {
  view: 'View',
  edit: 'Edit',
  edit_financials: 'Edit + financials',
}

export interface SolarEntryInput {
  /** public.user_effective_project_role(project, me); null = not a member. */
  effectiveRole: string | null
  /** public.solar_access_level(project); null = no access. */
  level: SolarAccessLevel | null
  /** public.solar_is_grantor(project): org owner/admin of the project's org. */
  isGrantor: boolean
  /** Active member of the project's organisation (own user_organisations row). */
  isOwnOrgMember: boolean
  /** public.org_has_solar(org) — meaningful only when isOwnOrgMember. */
  orgSubscribed: boolean
  /** created_at of my pending 'access' request on THIS project. */
  pendingAccessRequestAt: string | null
  /** created_at of my pending 'subscribe' request on ANY project of this org. */
  pendingSubscribeRequestAt: string | null
}

export type SolarEntryState =
  | { kind: 'hidden' }
  /** maxLevel: the most this user may hold here (externals: View) — bounds an upgrade request. */
  | { kind: 'granted'; level: SolarAccessLevel; maxLevel: SolarAccessLevel }
  | { kind: 'subscribe' }
  | { kind: 'ask_admin'; requestedAt: string | null }
  | { kind: 'request_access'; maxLevel: SolarAccessLevel }
  | { kind: 'pending'; requestedAt: string }

export function resolveSolarEntry(i: SolarEntryInput): SolarEntryState {
  if (!i.effectiveRole || (SOLAR_EXCLUDED_ROLES as readonly string[]).includes(i.effectiveRole)) {
    return { kind: 'hidden' }
  }
  if (i.level) return { kind: 'granted', level: i.level, maxLevel: i.isOwnOrgMember ? 'edit_financials' : 'view' }
  if (i.isOwnOrgMember && !i.orgSubscribed) {
    if (i.isGrantor) return { kind: 'subscribe' }
    return { kind: 'ask_admin', requestedAt: i.pendingSubscribeRequestAt }
  }
  if (i.pendingAccessRequestAt) return { kind: 'pending', requestedAt: i.pendingAccessRequestAt }
  return { kind: 'request_access', maxLevel: i.isOwnOrgMember ? 'edit_financials' : 'view' }
}

export type SolarNavBadge = 'hidden' | 'locked' | 'pending' | 'open'

export function solarNavBadge(s: SolarEntryState): SolarNavBadge {
  switch (s.kind) {
    case 'hidden': return 'hidden'
    case 'granted': return 'open'
    case 'pending': return 'pending'
    default: return 'locked'
  }
}

/** Every level up to and including `max` (the order is view < edit < edit_financials). */
export function requestableLevels(max: SolarAccessLevel): SolarAccessLevel[] {
  return SOLAR_ACCESS_LEVELS.slice(0, SOLAR_ACCESS_LEVELS.indexOf(max) + 1)
}
