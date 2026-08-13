/**
 * Read policy for saved report artifacts (projects.reports).
 *
 * WHY THIS EXISTS
 * ---------------
 * reports_select (migration 00117) gates only on public.user_has_project_access(),
 * which returns TRUE for ANY projects.project_members row regardless of role
 * (00106 clause (a)). Neither listProjectReportsAction nor getProjectReportUrlAction
 * historically re-checked role before minting a service-client signed URL — the only
 * role gate in project-reports.actions.ts is on DELETE. So a client_viewer with
 * project access could list and download ANY saved report by invoking the server
 * action directly. Page-level gating is not a gate (the PR #135 lesson).
 *
 * That is acceptable for kinds whose PDF shows nothing the reader cannot already
 * see on screen. It is not acceptable for kinds carrying commercial detail the
 * client portal deliberately withholds.
 *
 * Every kind must make that call EXPLICITLY: a kind belongs to exactly one of the
 * two sets below, and report-kind-access.contract.test.ts fails if the codebase
 * writes a kind that appears in neither. A new report kind therefore cannot
 * silently inherit open reads.
 *
 * Migration 00184 enforces the same split in the database via a RESTRICTIVE
 * SELECT policy, so direct PostgREST is closed too — this module is the
 * application half of a defence that does not depend on it.
 */
import { ORG_WRITE_ROLES, COST_VIEW_ROLES, type OrgRole } from '@esite/shared'

/**
 * Kinds gated on READ, with the roles permitted to list and download them.
 * Keep in lockstep with public.report_kind_is_sensitive() in migration 00184.
 *
 * The two sets coincide today; they are named separately on purpose, because
 * COST_VIEW_ROLES documents itself as the money-field gate and asks not to be
 * conflated with ORG_WRITE_ROLES. If either is widened later, each kind should
 * follow the concern it actually belongs to.
 */
export const REPORT_KIND_READ_ROLES: Readonly<Record<string, readonly OrgRole[]>> = {
  // Order notes + quote/order-instruction status. The portal's read-only
  // equipment register deliberately omits these as commercial artefacts.
  equipment_materials: ORG_WRITE_ROLES,
  // Payment certificates — a cost artefact. Matches the COST_VIEW_ROLES gate
  // already on /projects/[id]/settings/valuations, so no current reader of the
  // certificate panel loses access when the RESTRICTIVE policy lands.
  valuation: COST_VIEW_ROLES,
}

/**
 * Kinds deliberately readable by anyone with project access, because the PDF
 * discloses nothing beyond what the reader can already open in the app. Listed
 * explicitly so the choice is recorded rather than assumed.
 */
export const OPEN_READ_REPORT_KINDS: readonly string[] = [
  'tenant_schedule',
  'inspection',
  'snag',
  'qc',
  'site_form',
]

/** Roles required to read this kind, or null when it is open to project members. */
export function readRolesForKind(kind: string): readonly OrgRole[] | null {
  return REPORT_KIND_READ_ROLES[kind] ?? null
}

/** True when the kind has a recorded read policy (gated or explicitly open). */
export function hasDeclaredReadPolicy(kind: string): boolean {
  return kind in REPORT_KIND_READ_ROLES || OPEN_READ_REPORT_KINDS.includes(kind)
}
