'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole, requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, OWNER_ADMIN } from '@esite/shared'
import { readRolesForKind, solarLevelForKind } from '@/lib/reports/report-kind-access'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { solarLevelAllows } from '@esite/shared'
import { reportPathBelongsTo, REPORT_PATH_REFUSED } from '@/lib/reports/report-path'
import type { SupabaseClient } from '@supabase/supabase-js'

const REPORTS_BUCKET = 'reports'
const SIGNED_URL_TTL_SECONDS = 600 // 10 minutes

type ErrResult = { error: string }

const NO_SOLAR_ACCESS = 'You do not have Solar access on this project.'

/** Solar kinds read on the caller's Solar level (00211/00216 mirror this in SQL). Null when allowed or not a Solar kind. */
async function solarReadDenied(supabase: unknown, projectId: string, kind: string): Promise<string | null> {
  const need = solarLevelForKind(kind)
  if (!need) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
  return solarLevelAllows(level, need) ? null : NO_SOLAR_ACCESS
}

const SOLAR_PDF_PATH = /\/solar-(reports|proposals)\//

/**
 * The Solar kind a Solar PDF path holds: proposals under /solar-proposals/, and under /solar-reports/
 * the `<kind>-v…` file name generate.ts writes. An unrecognised Solar file is treated as feasibility
 * (the strictest read), never as technical.
 */
function solarKindForPath(path: string): string {
  if (path.includes('/solar-proposals/')) return 'solar_proposal'
  const file = path.slice(path.indexOf('/solar-reports/') + '/solar-reports/'.length)
  if (file.startsWith('solar_monthly-')) return 'solar_monthly'
  return file.startsWith('solar_technical-') ? 'solar_technical' : 'solar_feasibility'
}

/**
 * The URL action signs with the SERVICE client, so the row's storage_path is trusted only when it
 * belongs to the row (review round 2, C1): it must sit under the row's own `<org>/<project>/`, and a
 * Solar PDF path is signed only for a Solar kind whose file the caller's Solar level can read. 00216
 * refuses a session write of such a row; this holds even for a row that predates it.
 */
async function reportPathDenied(
  supabase: unknown, projectId: string, report: { storage_path: string; kind: string; organisation_id: string },
): Promise<string | null> {
  // FIRST: every check below reads the raw string, and the URL parser rewrites a non-canonical one
  // into a different object before it is signed (review round 3). See lib/reports/report-path.ts.
  if (!reportPathBelongsTo(report.storage_path, report.organisation_id, projectId)) return REPORT_PATH_REFUSED
  if (!SOLAR_PDF_PATH.test(report.storage_path)) return null
  if (!solarLevelForKind(report.kind)) return REPORT_PATH_REFUSED
  const need = solarLevelForKind(solarKindForPath(report.storage_path))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
  return need && solarLevelAllows(level, need) ? null : REPORT_PATH_REFUSED
}

/** A saved report artifact row (projects.reports) as listed in the UI. */
export interface ProjectReportRow {
  id: string
  project_id: string
  organisation_id: string
  kind: string
  title: string
  storage_path: string
  mime_type: string
  size_bytes: number | null
  status: 'issued' | 'superseded' | 'draft' | 'revoked'
  version: number
  generated_by: string | null
  generated_at: string
  created_at: string
  /** Optional revision note captured at generate time (migration 00183). */
  note?: string | null
  /** Headline figures for the list, so it never re-gathers (migration 00183). */
  summary?: Record<string, number | string | null> | null
  /** Resolved display name for generated_by — not a column. */
  generated_by_name?: string | null
}

const SELECT_COLS =
  'id, project_id, organisation_id, kind, title, storage_path, mime_type, size_bytes, status, version, generated_by, generated_at, created_at, note, summary'

/**
 * Pre-00183 databases have no note/summary columns; PostgREST answers the whole
 * SELECT with 42703 rather than ignoring them. Retrying without them keeps the
 * panel working between merge and migration.
 */
const SELECT_COLS_LEGACY =
  'id, project_id, organisation_id, kind, title, storage_path, mime_type, size_bytes, status, version, generated_by, generated_at, created_at'

/**
 * True for "column does not exist". Matched on the Postgres code AND the message
 * because PostgREST has surfaced this as both `42703` and `PGRST204` depending on
 * version — relying on one alone would leave the panel broken between merge and
 * migration rather than silently degrading.
 */
function isMissingColumnError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === '42703' || e.code === 'PGRST204') return true
  return /column .* does not exist|could not find the .* column/i.test(e.message ?? '')
}

/** Resolve generated_by ids to display names; failure degrades to no name. */
async function attachAuthorNames(
  rows: ProjectReportRow[],
): Promise<ProjectReportRow[]> {
  const ids = [...new Set(rows.map((r) => r.generated_by).filter((v): v is string => !!v))]
  if (ids.length === 0) return rows
  try {
    const service = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (service as any)
      .from('profiles').select('id, full_name, email').in('id', ids)
    const byId = new Map<string, string>()
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      const name = p.full_name?.trim() || p.email || null
      if (name) byId.set(p.id, name)
    }
    return rows.map((r) => ({
      ...r,
      generated_by_name: r.generated_by ? byId.get(r.generated_by) ?? null : null,
    }))
  } catch {
    return rows
  }
}

/** Download-disposition filename, derived from kind + version. */
function downloadFileName(kind: string, version: number): string {
  return `${kind.replace(/_/g, '-')}-report-v${version}.pdf`
}

/** QC report PDFs live in their own dedicated bucket; every other kind shares `reports`. */
function bucketForKind(kind: string): string {
  return kind === 'qc' ? 'qc-reports' : REPORTS_BUCKET
}

/** Resolve organisation_id from projects.projects. */
async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .schema('projects').from('projects')
    .select('organisation_id').eq('id', projectId).maybeSingle()
  return (data as { organisation_id: string } | null)?.organisation_id ?? null
}

/**
 * Saved reports of a kind for a project, newest version first. Read access is
 * enforced by the reports_select RLS policy (user_has_project_access) on the
 * cookie client — no project access ⇒ no rows. Drafts/revoked excluded.
 */
export async function listProjectReportsAction(
  projectId: string,
  kind: string,
  source?: { table: string; id: string },
): Promise<ProjectReportRow[] | ErrResult> {
  const supabase = await createClient()

  // Sensitive kinds carry more than the reader can see on screen — RLS alone
  // would let any project member list them (see report-kind-access.ts).
  const readRoles = readRolesForKind(kind)
  if (readRoles) {
    const guard = await requireEffectiveRole(supabase, projectId, readRoles)
    if (!guard.ok) return { error: guard.error }
  }
  const solarDenied = await solarReadDenied(supabase, projectId, kind)
  if (solarDenied) return { error: solarDenied }

  const run = async (cols: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .schema('projects').from('reports')
      .select(cols)
      .eq('project_id', projectId)
      .eq('kind', kind)
      .in('status', ['issued', 'superseded'])
    // Per-entity sections (inspection/snag/valuation) scope to one source row;
    // project-level sections (tenant_schedule) pass no source.
    if (source) {
      query = query.eq('source_table', source.table).eq('source_id', source.id)
    }
    return query.order('version', { ascending: false })
  }

  let { data, error } = await run(SELECT_COLS)
  if (error && isMissingColumnError(error)) {
    ;({ data, error } = await run(SELECT_COLS_LEGACY))
  }

  if (error) return { error: error.message ?? 'Failed to load saved reports' }
  return attachAuthorNames((data ?? []) as ProjectReportRow[])
}

/**
 * Short-lived signed URL for a saved report PDF. `download: true` adds an
 * attachment disposition with a derived filename; otherwise serves inline (for
 * the in-app viewer iframe). Read is project-access gated by RLS; the lookup is
 * project-scoped so a foreign report id is a miss.
 */
export async function getProjectReportUrlAction(
  projectId: string,
  reportId: string,
  opts: { download?: boolean } = {},
): Promise<{ url: string } | ErrResult> {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .schema('projects').from('reports')
    .select('storage_path, kind, version, organisation_id')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  const report = row as { storage_path: string; kind: string; version: number; organisation_id: string } | null
  if (!report) return { error: 'Not found' }

  // The kind is only known once the row is read, so the gate runs here. After
  // migration 00183 the RESTRICTIVE policy already hides the row from an
  // unauthorised reader; this keeps the action correct before it is applied and
  // if the service client is ever used for the lookup.
  const readRoles = readRolesForKind(report.kind)
  if (readRoles) {
    const guard = await requireEffectiveRole(supabase, projectId, readRoles)
    if (!guard.ok) return { error: guard.error }
  }
  const solarDenied = await solarReadDenied(supabase, projectId, report.kind)
  if (solarDenied) return { error: solarDenied }
  // The path is signed with the SERVICE client, which bypasses storage RLS, so it is trusted only when
  // it is canonical and under the row's own <org>/<project>/ (00207 refuses writing any other; this also
  // holds for a row that predates it). See lib/reports/report-path.ts.
  if (!reportPathBelongsTo(report.storage_path, report.organisation_id, projectId)) {
    console.error('getProjectReportUrlAction: refused a report path outside its row', { projectId, reportId })
    return { error: REPORT_PATH_REFUSED }
  }
  // Then the Solar rule: a Solar PDF path is signed only for a Solar kind the caller's level can read.
  const pathDenied = await reportPathDenied(supabase, projectId, report)
  if (pathDenied) return { error: pathDenied }

  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signed, error: signErr } = await (service as any).storage
    .from(bucketForKind(report.kind))
    .createSignedUrl(
      report.storage_path,
      SIGNED_URL_TTL_SECONDS,
      opts.download ? { download: downloadFileName(report.kind, report.version) } : undefined,
    )

  if (signErr || !signed?.signedUrl) return { error: 'Failed to create report link' }
  return { url: signed.signedUrl as string }
}

/** Delete a saved report (row + best-effort storage object). Gate: ORG_WRITE_ROLES; a Solar kind needs OWNER_ADMIN + Solar Edit (spec §9.2). */
export async function deleteProjectReportAction(
  projectId: string,
  reportId: string,
): Promise<{ ok: true } | ErrResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .schema('projects').from('reports')
    .select('storage_path, kind, organisation_id')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  const report = row as { storage_path: string; kind: string; organisation_id: string } | null
  if (!report) return { error: 'Not found' }

  // An issued proposal's PDF is the evidence the client's acceptance is stamped against (00216).
  if (report.kind === 'solar_proposal') {
    return { error: 'An issued proposal’s PDF is kept as evidence and cannot be deleted — withdraw the proposal instead.' }
  }
  // A generated monthly report is the record of what the client received (00217 keeps its snapshot).
  if (report.kind === 'solar_monthly') {
    return { error: 'A monthly report is kept as the record of what the client received — generate a new version instead.' }
  }
  // A Solar kind is removed by OWNER_ADMIN only (spec §9.2) and on the Solar EDIT level.
  if (solarLevelForKind(report.kind)) {
    const admin = await requireRole(supabase, orgId, OWNER_ADMIN)
    if (!admin.ok) return { error: admin.error }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const level = await getSolarAccessLevel(projectId, supabase as SupabaseClient<any, any, any>)
    if (!solarLevelAllows(level, 'edit')) return { error: 'You do not have Solar edit access on this project.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deleted, error: deleteErr } = await (supabase as any)
    .schema('projects').from('reports')
    .delete()
    .eq('id', reportId)
    .eq('project_id', projectId)
    .select('id')

  if (deleteErr) {
    // The raw database message can name tables, policies and triggers — log it, show a sentence.
    console.error('deleteProjectReportAction: delete failed', { projectId, reportId, kind: report.kind, error: deleteErr.message ?? deleteErr })
    return { error: 'The report could not be deleted — try again.' }
  }

  // RLS answers a refused delete with zero rows, not an error: only remove the file when exactly
  // this one row went (review round 3), or a caller who may not delete the row still removes its file.
  if (!Array.isArray(deleted) || deleted.length !== 1) {
    return { error: 'Nothing was deleted — the report may already be gone, or you may not be allowed to delete it.' }
  }

  // The object is removed with the SERVICE client, so its path is trusted only when it belongs to the
  // row (a forged row could otherwise name another org's file). The row is already gone; an orphaned
  // private object is harmless.
  if (!reportPathBelongsTo(report.storage_path, report.organisation_id, projectId)) {
    console.error('deleteProjectReportAction: kept an object outside its row', { projectId, reportId })
    return { ok: true }
  }

  // Best-effort object removal — an orphaned private object is harmless.
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).storage.from(bucketForKind(report.kind)).remove([report.storage_path]).catch(() => {})

  return { ok: true }
}
