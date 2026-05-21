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
export type ProjectRole = 'project_manager' | 'contractor' | 'client_viewer'
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise'
export type SnagStatus = 'open' | 'in_progress' | 'resolved' | 'pending_sign_off' | 'signed_off' | 'closed'
export type RfiStatus = 'draft' | 'open' | 'responded' | 'closed'
export type CocStatus = 'missing' | 'submitted' | 'under_review' | 'approved' | 'rejected'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
