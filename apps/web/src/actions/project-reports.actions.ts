'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole, requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { readRolesForKind } from '@/lib/reports/report-kind-access'

const REPORTS_BUCKET = 'reports'
const SIGNED_URL_TTL_SECONDS = 600 // 10 minutes

type ErrResult = { error: string }

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
  summary?: Record<string, number | string> | null
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
    .select('storage_path, kind, version')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  const report = row as { storage_path: string; kind: string; version: number } | null
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

/** Delete a saved report (row + best-effort storage object). Gate: ORG_WRITE_ROLES. */
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
    .select('storage_path, kind')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  const report = row as { storage_path: string; kind: string } | null
  if (!report) return { error: 'Not found' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteErr } = await (supabase as any)
    .schema('projects').from('reports')
    .delete()
    .eq('id', reportId)
    .eq('project_id', projectId)

  if (deleteErr) return { error: deleteErr.message ?? 'Failed to delete report' }

  // Best-effort object removal — an orphaned private object is harmless.
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).storage.from(bucketForKind(report.kind)).remove([report.storage_path]).catch(() => {})

  return { ok: true }
}
