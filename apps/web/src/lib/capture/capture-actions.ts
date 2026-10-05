import {
  FORMS_FIELD_ROLES,
  ORG_WRITE_ROLES,
  SNAG_FIELD_ROLES,
  type OrgRole,
} from '@esite/shared'

/**
 * The in-project Capture menu (E1, 2026-10-05). Site capture is always about
 * one project, so there is no global capture surface: `/projects/[id]/capture`
 * lists these actions, each pre-scoped to the project and each pointing at a
 * route that already exists.
 *
 * Every role set mirrors the gate its target already enforces, so a tile is
 * never offered to someone the target page would bounce:
 * - snag       → SNAG_FIELD_ROLES  (snags/new + snag actions)
 * - site form  → FORMS_FIELD_ROLES (forms/new redirects anyone else)
 * - inspection → the caller's ORG role (not the effective project role) must
 *                be in ORG_WRITE_ROLES, because createInspectionAction gates on
 *                requirePmOrAbove against user_organisations — a contractor
 *                promoted to PM on one project would see the page but be
 *                refused on submit. The caller passes `canAssignInspection`.
 *                The org must also have unlocked the inspections module.
 * - diary/photo → owner/admin/PM/contractor, the write set of the
 *                `/projects/[id]/diary` row in docs/rbac-matrix.md
 *
 * This is the discovery surface only. Each target re-checks on its own.
 */

export const CAPTURE_KEYS = ['diary', 'snag', 'form', 'inspection', 'photo'] as const
export type CaptureKey = (typeof CAPTURE_KEYS)[number]

export interface CaptureAction {
  key: CaptureKey
  label: string
  description: string
  href: string
  /** True when the module is not unlocked; the href then points at the unlock page. */
  locked: boolean
}

const DIARY_CAPTURE_ROLES: readonly OrgRole[] = SNAG_FIELD_ROLES.filter(
  (r) => r !== 'inspector' && r !== 'supplier',
)

const ROLES: Record<Exclude<CaptureKey, 'inspection'>, readonly OrgRole[]> = {
  diary: DIARY_CAPTURE_ROLES,
  snag: SNAG_FIELD_ROLES,
  form: FORMS_FIELD_ROLES,
  photo: DIARY_CAPTURE_ROLES,
}

/** True when an org role may assign inspections (createInspectionAction's requirePmOrAbove). */
export function orgRoleCanAssignInspection(orgRole: OrgRole | null): boolean {
  return orgRole !== null && ORG_WRITE_ROLES.includes(orgRole)
}

const COPY: Record<CaptureKey, { label: string; description: string }> = {
  diary: { label: 'Diary entry', description: 'Record progress, weather, workforce or a delay for today.' },
  snag: { label: 'Snag', description: 'Raise a defect with priority, assignee and photos.' },
  form: { label: 'Site form', description: 'Start a termination & making-safe record for a board.' },
  inspection: { label: 'Inspection', description: 'Assign an inspection from a template to a board.' },
  photo: { label: 'Photo', description: 'Take or upload site photos into a diary entry.' },
}

export function captureActions(
  projectId: string,
  role: OrgRole | null,
  opts: { inspectionsUnlocked: boolean; canAssignInspection: boolean },
): CaptureAction[] {
  if (!role) return []
  const base = `/projects/${encodeURIComponent(projectId)}`
  const href: Record<CaptureKey, string> = {
    diary: `${base}/diary?new=entry`,
    snag: `${base}/snags/new`,
    form: `${base}/forms/new`,
    inspection: opts.inspectionsUnlocked ? `${base}/inspections/new` : '/inspections/unlock',
    photo: `${base}/diary?new=photo`,
  }
  const offered = (k: CaptureKey) =>
    k === 'inspection' ? opts.canAssignInspection : ROLES[k].includes(role)
  return CAPTURE_KEYS.filter(offered).map((key) => ({
    key,
    ...COPY[key],
    href: href[key],
    locked: key === 'inspection' && !opts.inspectionsUnlocked,
  }))
}
