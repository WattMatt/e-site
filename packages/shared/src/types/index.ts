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
 * Roles permitted to view cost/money fields (contract_value, currency,
 * retention_pct, cable cost summaries, rate libraries). Owner + admin + PM.
 * Distinct from ORG_WRITE_ROLES even though the sets coincide today — keep
 * the concerns separate so changes to one don't silently reshape the other.
 */
export const COST_VIEW_ROLES: readonly OrgRole[] = ['owner', 'admin', 'project_manager']
export type ProjectRole = 'project_manager' | 'contractor' | 'client_viewer'
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise'
export type SnagStatus = 'open' | 'in_progress' | 'resolved' | 'pending_sign_off' | 'signed_off' | 'closed'
export type RfiStatus = 'draft' | 'open' | 'responded' | 'closed'
export type CocStatus = 'missing' | 'submitted' | 'under_review' | 'approved' | 'rejected'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
