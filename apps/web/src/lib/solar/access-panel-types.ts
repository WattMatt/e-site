/** Access panel data — JSON only (crosses the server → client boundary). */
import type { SolarAccessLevel } from '@esite/shared'

export interface AccessPanelMember {
  userId: string
  name: string
  email: string | null
  /** E-Site role on the project (org role for owners/admins/PMs, else the project_members role). */
  role: string
  /** Not an active member of the project's organisation → capped at View. */
  external: boolean
  /** Org owner/admin: Edit + financials implicitly, cannot be changed here. */
  implicit: boolean
  level: SolarAccessLevel | null
  grantedByName: string | null
  grantedAt: string | null
  /** project_access.updated_at — the stale-write token for this row. */
  updatedAt: string | null
}

export interface AccessPanelRequest {
  id: string
  requesterId: string
  requesterName: string
  requestedLevel: SolarAccessLevel | null
  maxLevel: SolarAccessLevel
  note: string | null
  createdAt: string
}

export interface AccessPanelData {
  projectId: string
  projectName: string
  organisationId: string
  members: AccessPanelMember[]
  requests: AccessPanelRequest[]
  otherProjects: Array<{ id: string; name: string }>
  subscription: { status: string; currentPeriodEnd: string | null } | null
}
