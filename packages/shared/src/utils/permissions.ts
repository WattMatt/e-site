import type { OrgRole, ProjectRole } from '../types'

const ORG_ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 100,
  admin: 90,
  project_manager: 70,
  contractor: 50,
  client_viewer: 10,
}

export function canCreateProject(orgRole: OrgRole): boolean {
  return ORG_ROLE_HIERARCHY[orgRole] >= ORG_ROLE_HIERARCHY.project_manager
}

export function canManageTeam(orgRole: OrgRole): boolean {
  return ORG_ROLE_HIERARCHY[orgRole] >= ORG_ROLE_HIERARCHY.admin
}

export function canManageBilling(orgRole: OrgRole): boolean {
  return ORG_ROLE_HIERARCHY[orgRole] >= ORG_ROLE_HIERARCHY.admin
}

export function canCreateSnag(projectRole: ProjectRole): boolean {
  return ['project_manager', 'contractor'].includes(projectRole)
}

export function canSignOffSnag(projectRole: ProjectRole): boolean {
  return projectRole === 'project_manager'
}

export function canManageProcurement(projectRole: ProjectRole): boolean {
  return projectRole === 'project_manager'
}

export function canUploadCoc(projectRole: ProjectRole): boolean {
  return ['project_manager', 'contractor'].includes(projectRole)
}

export function canCreateRfi(projectRole: ProjectRole): boolean {
  return ['project_manager', 'contractor'].includes(projectRole)
}

export function isReadOnly(orgRole: OrgRole): boolean {
  return orgRole === 'client_viewer'
}

export function orgRoleWeight(role: OrgRole): number {
  return ORG_ROLE_HIERARCHY[role] ?? 0
}
