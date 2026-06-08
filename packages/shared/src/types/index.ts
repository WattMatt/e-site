/**
 * Canonical organisation-role vocabulary — the single source of truth.
 * Mirrors the public.user_organisations.role CHECK constraint (migration 00001).
 * Every role list (UI dropdowns, Zod schemas, permission gates) must derive
 * from ORG_ROLES — never hardcode role strings elsewhere.
 */
export const ORG_ROLES = [
  'owner',
  'admin',
  'project_manager',
  'contractor',
  'inspector',
  'supplier',
  'client_viewer',
] as const
export type OrgRole = (typeof ORG_ROLES)[number]

/** Human-readable labels for OrgRole — used by role dropdowns. */
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner:           'Owner',
  admin:           'Admin',
  project_manager: 'Project Manager',
  contractor:      'Contractor',
  inspector:       'Inspector',
  supplier:        'Supplier',
  client_viewer:   'Client (read-only)',
}

/**
 * Role groups — canonical sets used by RBAC gates.
 * Always import these instead of hardcoding role-string arrays at call sites;
 * adding/renaming a role then flows through a single source. Typed as
 * `readonly OrgRole[]` (not a literal tuple) so .includes() accepts any
 * OrgRole at call sites without narrowing.
 */
export const OWNER_ADMIN: readonly OrgRole[] = ['owner', 'admin']
export const ORG_WRITE_ROLES: readonly OrgRole[] = ['owner', 'admin', 'project_manager']
/**
 * Roles permitted to RAISE and CLOSE snags during a site visit — every active
 * site role except the read-only client_viewer. Broader than ORG_WRITE_ROLES
 * (which still gates visit create/edit/delete + report export); matches the
 * open, field-level nature of snag capture. Per the 2026-06-04 decision:
 * contractors and other site agents can both raise and close snags on a visit.
 */
export const SNAG_FIELD_ROLES: readonly OrgRole[] = ORG_ROLES.filter((r) => r !== 'client_viewer')
/**
 * Roles permitted to view cost/money fields (contract_value, currency,
 * retention_pct, cable cost summaries, rate libraries). Owner + admin + PM.
 * Distinct from ORG_WRITE_ROLES even though the sets coincide today — keep
 * the concerns separate so changes to one don't silently reshape the other.
 */
export const COST_VIEW_ROLES: readonly OrgRole[] = ['owner', 'admin', 'project_manager']
export type ProjectRole = 'project_manager' | 'contractor' | 'client_viewer'

/**
 * Sub-organisation entity. A `public.organisations` row marked as a shadow
 * (is_shadow=TRUE, parent_organisation_id=parent). Holds contact details
 * and acts as the identity boundary for external site agents (Bob's
 * Building's people log in as Bob's Building users, granted access to
 * specific projects via project_members).
 *
 * See migration 00109_sub_organisations.sql for full semantics.
 */
export interface SubOrganisation {
  id: string
  name: string
  parent_organisation_id: string | null
  is_shadow: boolean
  /** Added in migration 00112. FALSE = deactivated (see spec §6.2). */
  is_active: boolean
  address: string | null
  phone: string | null
  registration_number: string | null
  vat_number: string | null
  signatory_name: string | null
  signatory_title: string | null
  created_at: string
}
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise'
export type SnagStatus = 'open' | 'in_progress' | 'resolved' | 'pending_sign_off' | 'signed_off' | 'closed'
export type RfiStatus = 'draft' | 'open' | 'responded' | 'closed'
export type CocStatus = 'missing' | 'submitted' | 'under_review' | 'approved' | 'rejected'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
