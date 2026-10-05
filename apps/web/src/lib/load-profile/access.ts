/**
 * Who may see and change a project's load profile (docs/rbac-matrix.md "Load profile").
 * Mirrors migration 00231's policies: read = every effective project role except client_viewer;
 * write = owner / admin / project_manager. Not gated by the Solar subscription (owner decision E8-D1).
 */
import { ORG_WRITE_ROLES, SNAG_FIELD_ROLES, type OrgRole } from '@esite/shared'

export const LOAD_PROFILE_READ_ROLES: readonly OrgRole[] = SNAG_FIELD_ROLES
export const LOAD_PROFILE_WRITE_ROLES: readonly OrgRole[] = ORG_WRITE_ROLES

export const LOAD_PROFILE_BUCKET = 'load-profile-files'
export const LOAD_PROFILE_UPLOAD_RE = /\.(csv|txt|xlsx)$/i
export const LOAD_PROFILE_MAX_BYTES = 50 * 1024 * 1024

/**
 * Every page view composes the profile from the stored channels, so their total size is capped
 * (a paired kVA array counts too): 1 000 000 slots ≈ 28 channel-years at 30 minutes, or about 9 at 5.
 */
export const MAX_PROFILE_SLOTS = 1_000_000

/** {project_id}/{sha256}.{ext} — the shape 00231's storage policies parse. */
export function loadProfileFilePath(projectId: string, sha256: string, fileName: string): string | null {
  const ext = fileName.match(LOAD_PROFILE_UPLOAD_RE)?.[1]?.toLowerCase()
  if (!ext || !/^[0-9a-f]{64}$/.test(sha256)) return null
  return `${projectId}/${sha256}.${ext}`
}

const PATH_RE = /^([0-9a-f-]{36})\/([0-9a-f]{64})\.(csv|txt|xlsx)$/

/** Parse a stored path and confirm it belongs to `projectId`; null when it does not. */
export function parseLoadProfileFilePath(path: string, projectId: string): { sha256: string; ext: string } | null {
  const m = PATH_RE.exec(path)
  if (!m || m[1] !== projectId) return null
  return { sha256: m[2], ext: m[3] }
}
