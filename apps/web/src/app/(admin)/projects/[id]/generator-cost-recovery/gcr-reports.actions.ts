'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole, requireEffectiveRole } from '@/lib/auth/require-role'
import { hasFeatureSeat } from '@/lib/features'
import {
  ORG_WRITE_ROLES,
  COST_VIEW_ROLES,
  type GcrReportRevisionRow,
} from '@esite/shared'

const REPORTS_BUCKET = 'reports'
const SIGNED_URL_TTL_SECONDS = 600 // 10 minutes

type ErrResult = { error: string }

/** Resolve organisation_id from projects.projects (same pattern as gcr.actions). */
async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  const { data } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  return (data as { organisation_id: string } | null)?.organisation_id ?? null
}

// ─── listGcrReportRevisionsAction ────────────────────────────────────────────

/** Saved report revisions for a project, newest first. Gate: COST_VIEW_ROLES. */
export async function listGcrReportRevisionsAction(
  projectId: string,
): Promise<GcrReportRevisionRow[] | ErrResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('gcr')
    .from('report_revisions')
    .select('*')
    .eq('project_id', projectId)
    .order('revision_number', { ascending: false })

  if (error) return { error: error.message ?? 'Failed to load report revisions' }
  return (data ?? []) as GcrReportRevisionRow[]
}

// ─── getGcrReportUrlAction ───────────────────────────────────────────────────

/**
 * Short-lived signed URL for a saved revision PDF.
 * `download: true` adds an attachment disposition with the stored file name;
 * otherwise the URL serves inline (for the in-app viewer iframe).
 * Gates: COST_VIEW_ROLES + the generator_cost_recovery seat (paid content).
 */
export async function getGcrReportUrlAction(
  projectId: string,
  revisionId: string,
  opts: { download?: boolean } = {},
): Promise<{ url: string } | ErrResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data: { user } } = await supabase.auth.getUser()
  const orgId = await resolveOrgId(supabase, projectId)
  if (!user || !orgId) return { error: 'Not found' }

  const seat = await hasFeatureSeat(orgId, user.id, 'generator_cost_recovery', supabase)
  if (!seat) return { error: 'No generator cost-recovery seat' }

  // Project-scoped lookup — a revision id from another project is a miss.
  const { data: row } = await (supabase as any)
    .schema('gcr')
    .from('report_revisions')
    .select('storage_path, file_name')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .maybeSingle()

  const revision = row as { storage_path: string; file_name: string } | null
  if (!revision) return { error: 'Not found' }

  const service = createServiceClient()
  const { data: signed, error: signErr } = await (service as any).storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(
      revision.storage_path,
      SIGNED_URL_TTL_SECONDS,
      opts.download ? { download: revision.file_name } : undefined,
    )

  if (signErr || !signed?.signedUrl) {
    return { error: 'Failed to create report link' }
  }
  return { url: signed.signedUrl as string }
}

// ─── deleteGcrReportRevisionAction ───────────────────────────────────────────

/** Delete a saved revision (row + best-effort storage object). Gate: ORG_WRITE_ROLES. */
export async function deleteGcrReportRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<{ ok: true } | ErrResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data: row } = await (supabase as any)
    .schema('gcr')
    .from('report_revisions')
    .select('storage_path')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .maybeSingle()

  const revision = row as { storage_path: string } | null
  if (!revision) return { error: 'Not found' }

  const { error: deleteErr } = await (supabase as any)
    .schema('gcr')
    .from('report_revisions')
    .delete()
    .eq('id', revisionId)
    .eq('project_id', projectId)

  if (deleteErr) return { error: deleteErr.message ?? 'Failed to delete revision' }

  // Best-effort object removal — an orphaned object is invisible (private
  // bucket) and harmless; the row is the source of truth.
  const service = createServiceClient()
  await (service as any).storage
    .from(REPORTS_BUCKET)
    .remove([revision.storage_path])
    .catch(() => {})

  return { ok: true }
}
