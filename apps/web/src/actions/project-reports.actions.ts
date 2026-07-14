'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'

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
}

const SELECT_COLS =
  'id, project_id, organisation_id, kind, title, storage_path, mime_type, size_bytes, status, version, generated_by, generated_at, created_at'

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .schema('projects').from('reports')
    .select(SELECT_COLS)
    .eq('project_id', projectId)
    .eq('kind', kind)
    .in('status', ['issued', 'superseded'])
  // Per-entity sections (inspection/snag/valuation) scope to one source row;
  // project-level sections (tenant_schedule) pass no source.
  if (source) {
    query = query.eq('source_table', source.table).eq('source_id', source.id)
  }
  const { data, error } = await query.order('version', { ascending: false })

  if (error) return { error: error.message ?? 'Failed to load saved reports' }
  return (data ?? []) as ProjectReportRow[]
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
