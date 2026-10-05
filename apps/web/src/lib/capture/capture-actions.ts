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
 * - inspection → ORG_WRITE_ROLES   (createInspectionAction is PM-or-above),
 *                and the org must have unlocked the inspections module
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

const ROLES: Record<CaptureKey, readonly OrgRole[]> = {
  diary: DIARY_CAPTURE_ROLES,
  snag: SNAG_FIELD_ROLES,
  form: FORMS_FIELD_ROLES,
  inspection: ORG_WRITE_ROLES,
  photo: DIARY_CAPTURE_ROLES,
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
  opts: { inspectionsUnlocked: boolean },
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
  return CAPTURE_KEYS.filter((k) => ROLES[k].includes(role)).map((key) => ({
    key,
    ...COPY[key],
    href: href[key],
    locked: key === 'inspection' && !opts.inspectionsUnlocked,
  }))
}
