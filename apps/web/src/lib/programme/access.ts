/**
 * Who may open the programme screen (docs/rbac-matrix.md "Programme screen").
 * Read = every role except client_viewer (spec §4.6); edit = ORG_WRITE_ROLES, or
 * Solar Edit for a module programme. The database stays the authority.
 */
import { ORG_ROLES, ORG_WRITE_ROLES, type OrgRole } from '@esite/shared'

export const PROGRAMME_READ_ROLES: readonly OrgRole[] = ORG_ROLES.filter((r) => r !== 'client_viewer')
export const PROGRAMME_WRITE_ROLES: readonly OrgRole[] = ORG_WRITE_ROLES
