'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  projectService,
  snagVisitService,
  ORG_WRITE_ROLES,
  SNAG_FIELD_ROLES,
  createSnagVisitSchema,
  updateSnagVisitSchema,
} from '@esite/shared'
import type { CreateSnagVisitInput, UpdateSnagVisitInput, OrgRole } from '@esite/shared'
import { gatherSnagVisitReportData } from '@/lib/reports/snag-visit-report-data'
import { renderSnagVisitReport } from '@/lib/reports/snag-visit-report'
import { notifySnagCreated, dispatchSnagStatusEmail } from '@/lib/snag-email'

// ── Validation schemas (local — 'use server' files may NOT export schemas/consts) ──

const uuidSchema = z.string().uuid()

const addSnagToVisitInputSchema = z.object({
  visitId: uuidSchema,
  projectId: uuidSchema,
  title: z.string().min(2).max(300),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  category: z.string().max(100).default('general'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  assignedTo: uuidSchema.optional(),
})

// ── Guards ──

/**
 * Resolve project → org, verify auth, enforce the write-role gate.
 *
 * Writes in this file use createServiceClient() (bypasses RLS), so the
 * in-app role gate is mandatory — matching the established lesson from
 * tenant-board.actions.ts / tenant-documents.actions.ts.
 *
 * requireEffectiveRole honours per-project promotion (user_effective_project_role).
 */
async function guardProjectAccess(projectId: string, roles: readonly OrgRole[] = ORG_WRITE_ROLES): Promise<
  | { error: string; orgId?: undefined; userId?: undefined }
  | { error?: undefined; orgId: string; userId: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  const roleGate = await requireEffectiveRole(supabase, projectId, roles)
  if (!roleGate.ok) return { error: roleGate.error }

  return { orgId: project.organisation_id as string, userId: user.id }
}

/**
 * Verify a snag_visits row exists for projectId before acting on it.
 * Prevents cross-project tampering even though the service-role client
 * bypasses RLS.
 */
async function guardVisitBelongsToProject(
  visitId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('field')
    .from('snag_visits')
    .select('id')
    .eq('id', visitId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!data) return { error: 'Visit not found or does not belong to this project' }
  return null
}

/**
 * Verify a snag row exists for projectId before acting on it.
 * Prevents cross-project snag writes: a caller with write access to project A
 * must not be able to close a snag that belongs to project B.
 */
async function guardSnagBelongsToProject(
  snagId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('field')
    .from('snags')
    .select('id')
    .eq('id', snagId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!data) return { error: 'Snag not found or does not belong to this project' }
  return null
}

const SNAGS_PATH = (projectId: string) => `/projects/${projectId}/snags`

// ── Visit CRUD actions ──

export async function createSnagVisitAction(
  input: CreateSnagVisitInput,
): Promise<{ error?: string; visitId?: string }> {
  const parse = createSnagVisitSchema.safeParse(input)
  if (!parse.success) return { error: parse.error.errors[0]?.message ?? 'Invalid input' }
  const valid = parse.data

  const guard = await guardProjectAccess(valid.projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // Default conductedBy to the caller
  const conductedBy = valid.conductedBy ?? guard.userId

  const serviceClient = createServiceClient()
  try {
    const visit = await snagVisitService.createVisit(serviceClient as never, {
      ...valid,
      conductedBy,
      organisationId: guard.orgId,
    })
    revalidatePath(SNAGS_PATH(valid.projectId))
    return { visitId: (visit as { id: string }).id }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: msg }
  }
}

export async function updateSnagVisitAction(
  input: UpdateSnagVisitInput & { projectId: string },
): Promise<{ error?: string }> {
  // Require at least one editable field beyond visitId / projectId
  const editableFieldKeys: Array<keyof Omit<UpdateSnagVisitInput, 'visitId'>> = [
    'visitDate', 'conductedBy', 'attendees', 'title', 'notes',
  ]
  const hasEditableField = editableFieldKeys.some(k => input[k] !== undefined)
  if (!hasEditableField) return { error: 'At least one field must be provided to update a visit' }

  const parse = updateSnagVisitSchema.extend({ projectId: uuidSchema }).safeParse(input)
  if (!parse.success) return { error: parse.error.errors[0]?.message ?? 'Invalid input' }
  const { visitId, projectId, ...patch } = parse.data

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const visitGuard = await guardVisitBelongsToProject(visitId, projectId)
  if (visitGuard) return { error: visitGuard.error }

  const serviceClient = createServiceClient()
  try {
    await snagVisitService.updateVisit(serviceClient as never, visitId, patch)
    revalidatePath(SNAGS_PATH(projectId))
    return {}
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: msg }
  }
}

export async function deleteSnagVisitAction(
  visitId: string,
  projectId: string,
): Promise<{ error?: string }> {
  const parse = z.tuple([uuidSchema, uuidSchema]).safeParse([visitId, projectId])
  if (!parse.success) return { error: 'Invalid parameters' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const visitGuard = await guardVisitBelongsToProject(visitId, projectId)
  if (visitGuard) return { error: visitGuard.error }

  const serviceClient = createServiceClient()
  try {
    await snagVisitService.deleteVisit(serviceClient as never, visitId)
    revalidatePath(SNAGS_PATH(projectId))
    return {}
  } catch (err: unknown) {
    // Surface the DB FK block (snags reference this visit) as a friendly error.
    // Match 'foreign key' only — 'violates' alone also matches check/not-null violations.
    const msg = err instanceof Error ? err.message : String(err)
    if (/foreign key/i.test(msg)) {
      return { error: 'This visit cannot be deleted because it still has snags linked to it. Reassign or remove the snags first.' }
    }
    return { error: msg }
  }
}

// ── Add / close snag on visit ──

export async function addSnagToVisitAction(input: {
  visitId: string
  projectId: string
  title: string
  description?: string
  location?: string
  category?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  assignedTo?: string
}): Promise<{ error?: string; snagId?: string }> {
  const parse = addSnagToVisitInputSchema.safeParse(input)
  if (!parse.success) return { error: parse.error.errors[0]?.message ?? 'Invalid input' }
  const { visitId, projectId, ...snagFields } = parse.data

  // Widened (2026-06-04): all site roles except read-only client_viewer may raise a snag on a visit.
  const guard = await guardProjectAccess(projectId, SNAG_FIELD_ROLES)
  if (guard.error !== undefined) return { error: guard.error }

  const visitGuard = await guardVisitBelongsToProject(visitId, projectId)
  if (visitGuard) return { error: visitGuard.error }

  const serviceClient = createServiceClient()

  // Create the snag with raised_on_visit_id forced to this visit.
  // No explicit status — new snags intentionally take the DB default (open), never closed.
  const { data: snag, error: snagErr } = await (serviceClient as any)
    .schema('field')
    .from('snags')
    .insert({
      project_id: projectId,
      organisation_id: guard.orgId,
      raised_by: guard.userId,
      title: snagFields.title,
      description: snagFields.description ?? null,
      location: snagFields.location ?? null,
      category: snagFields.category ?? 'general',
      priority: snagFields.priority ?? 'medium',
      assigned_to: snagFields.assignedTo ?? null,
      raised_on_visit_id: visitId,
    })
    .select('id')
    .single()

  if (snagErr) return { error: snagErr.message }

  const snagId = (snag as { id: string }).id

  // Notify the whole project roster (bell + email) — best-effort.
  await notifySnagCreated({
    snagId,
    projectId,
    title: snagFields.title,
    priority: snagFields.priority ?? 'medium',
    assigneeId: snagFields.assignedTo ?? null,
    raiserId: guard.userId,
  })

  revalidatePath(SNAGS_PATH(projectId))
  revalidatePath(`/projects/${projectId}/snags/visits/${visitId}`)
  return { snagId }
}

export async function closeSnagOnVisitAction(
  snagId: string,
  visitId: string,
  projectId: string,
): Promise<{ error?: string }> {
  const parse = z.tuple([uuidSchema, uuidSchema, uuidSchema]).safeParse([snagId, visitId, projectId])
  if (!parse.success) return { error: 'Invalid parameters' }

  // Widened (2026-06-04): all site roles except read-only client_viewer may close a snag on a visit.
  const guard = await guardProjectAccess(projectId, SNAG_FIELD_ROLES)
  if (guard.error !== undefined) return { error: guard.error }

  // Use the cookie client for the closeout photo read — RLS is fine here
  const supabase = await createClient()

  // Guard: visit must belong to project
  const visitGuard = await guardVisitBelongsToProject(visitId, projectId)
  if (visitGuard) return { error: visitGuard.error }

  // Guard: snag must belong to the SAME project (Fix 1a).
  // Without this, a caller with write access to project A could pass a snagId
  // from project B (with a valid A visit/projectId) and close project B's snag.
  const snagGuard = await guardSnagBelongsToProject(snagId, projectId)
  if (snagGuard) return { error: snagGuard.error }

  // Verify a closeout photo exists (reusing signOffSnagAction's guard pattern)
  const { data: photos, error: photoErr } = await (supabase as any)
    .schema('field')
    .from('snag_photos')
    .select('id')
    .eq('snag_id', snagId)
    .eq('photo_type', 'closeout')
    .limit(1)

  if (photoErr) return { error: photoErr.message }
  if (!photos || photos.length === 0) {
    return { error: 'A closeout photo is required before closing a snag on a visit. Please upload evidence of the resolved defect.' }
  }

  const serviceClient = createServiceClient()

  // Update the snag: status + closed_on_visit_id.
  // Defense-in-depth (Fix 1b): scope by project_id as well as id so that even
  // if the snag guard above were bypassed the service-role write still cannot
  // touch a snag outside this project.
  const { data: snag, error: updateErr } = await (serviceClient as any)
    .schema('field')
    .from('snags')
    .update({
      status: 'signed_off',
      closed_on_visit_id: visitId,
      signed_off_by: guard.userId,
      signed_off_at: new Date().toISOString(),
    })
    .eq('id', snagId)
    .eq('project_id', projectId)
    .select('title, raised_by, assigned_to, organisation_id')
    .single()

  if (updateErr) return { error: updateErr.message }

  // Stamp the closeout photo's visit_id (best-effort; non-blocking)
  await (serviceClient as any)
    .schema('field')
    .from('snag_photos')
    .update({ visit_id: visitId })
    .eq('snag_id', snagId)
    .eq('photo_type', 'closeout')

  // Notify raised_by and assigned_to (best-effort — pattern from updateSnagStatusAction)
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      const notifyUserIds = [snag.raised_by, snag.assigned_to]
        .filter((id): id is string => Boolean(id) && id !== guard.userId)
      const uniqueIds = [...new Set(notifyUserIds)]
      if (uniqueIds.length > 0) {
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            userIds: uniqueIds,
            title: 'Snag closed on site visit',
            body: `"${snag.title}" was signed off on this visit`,
            type: 'snag_status_changed',
            entityType: 'snag',
            entityId: snagId,
            data: { route: `/snags/${snagId}` },
          }),
        }).catch(() => {/* non-blocking */})
      }
    }
  } catch {
    // Notification failure must not block the close
  }

  // Roster email on sign-off (gated by notifySnagEmail).
  await dispatchSnagStatusEmail({
    snagId,
    projectId,
    title: snag.title,
    statusLabel: 'Signed Off',
    changedById: guard.userId,
  })

  revalidatePath(SNAGS_PATH(projectId))
  revalidatePath(`/projects/${projectId}/snags/visits/${visitId}`)
  revalidatePath(`/snags/${snagId}`)
  revalidatePath('/snags')
  return {}
}

// ── Export action ──

const REPORTS_BUCKET = 'reports'

export type ExportSnagVisitReportResult =
  | { error: string }
  | { reportId: string; storagePath: string }

/**
 * Export a Snag & Defect Report for a site visit.
 *
 * - RBAC: ORG_WRITE_ROLES (owner / admin / project_manager).
 * - Renders the PDF via renderSnagVisitReport.
 * - Uploads to `reports/{org_id}/{project_id}/snag-visit-{visitId}-v{n}.pdf`.
 * - Inserts a `projects.reports` row (kind='snag', source_table='snag_visits').
 * - If a prior `status='issued'` report exists for this visit, supersedes it.
 * - Returns { reportId, storagePath } on success.
 */
export async function exportSnagVisitReportAction(
  visitId: string,
  projectId: string,
): Promise<ExportSnagVisitReportResult> {
  const parse = z.tuple([uuidSchema, uuidSchema]).safeParse([visitId, projectId])
  if (!parse.success) return { error: 'Invalid parameters' }

  // ── Access + role gate ────────────────────────────────────────────────────
  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // ── Cross-project guard ───────────────────────────────────────────────────
  const visitGuard = await guardVisitBelongsToProject(visitId, projectId)
  if (visitGuard) return { error: visitGuard.error }

  // ── Gather data + render ──────────────────────────────────────────────────
  const supabase = await createClient()
  let pdfBuffer: Buffer
  let brandingSnapshot: unknown
  let visitTitle: string

  try {
    const reportData = await gatherSnagVisitReportData(supabase, projectId, visitId)
    pdfBuffer = await renderSnagVisitReport(reportData)
    // Serialize branding (strip data: URIs so the snapshot stays small — keep
    // just the plain text / accent fields that describe the identity, not the
    // embedded image bytes).
    brandingSnapshot = {
      accent: reportData.branding.accent,
      issuer: reportData.branding.issuer.wordmark
        ? { wordmark: reportData.branding.issuer.wordmark }
        : { hasLogo: true },
      kicker: reportData.branding.kicker,
      projectLine: reportData.branding.projectLine,
    }
    visitTitle = reportData.visit.isBacklog
      ? 'Snag & Defect Report — Initial Backlog'
      : `Snag & Defect Report — Site Visit ${reportData.visit.visitNo}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[exportSnagVisitReportAction] gather/render error', err)
    return { error: msg }
  }

  // ── Supersede check — find the current issued report for this visit ──────
  const serviceClient = createServiceClient()

  const { data: priorRow } = await (serviceClient as any)
    .schema('projects')
    .from('reports')
    .select('id, version')
    .eq('source_table', 'snag_visits')
    .eq('source_id', visitId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // ── Upload PDF to storage ─────────────────────────────────────────────────
  const storagePath = `${guard.orgId}/${projectId}/snag-visit-${visitId}-v${newVersion}.pdf`
  const { error: uploadError } = await serviceClient.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

  // ── Insert projects.reports row ───────────────────────────────────────────
  const { data: newReport, error: insertError } = await (serviceClient as any)
    .schema('projects')
    .from('reports')
    .insert({
      organisation_id: guard.orgId,
      project_id: projectId,
      kind: 'snag',
      source_table: 'snag_visits',
      source_id: visitId,
      title: visitTitle,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdfBuffer.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      generated_by: guard.userId,
    })
    .select('id')
    .single()

  if (insertError) {
    // Best-effort rollback of the storage upload to avoid orphans.
    await serviceClient.storage.from(REPORTS_BUCKET).remove([storagePath])
    return { error: `Failed to save report record: ${insertError.message}` }
  }

  const reportId = (newReport as { id: string }).id

  // ── Supersede ALL prior issued rows for this visit (self-healing) ─────────
  // One statement supersedes every issued row, including any duplicates that
  // might have been created by a previous interrupted export.
  // Best-effort: a partial unique index (source_table, source_id) WHERE status='issued'
  // is the durable fix; that would require supersede-before-insert reordering — deferred.
  const { error: supersededError } = await (serviceClient as any)
    .schema('projects')
    .from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('source_table', 'snag_visits')
    .eq('source_id', visitId)
    .eq('status', 'issued')
    .neq('id', reportId)
  if (supersededError) {
    console.error('[exportSnagVisitReportAction] supersede error', supersededError)
    // Non-blocking: the new row is valid; the UI reads the latest version by version number.
  }

  revalidatePath(`/projects/${projectId}/snags/visits/${visitId}`)
  return { reportId, storagePath }
}
