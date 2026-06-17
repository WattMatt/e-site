'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { generateAndFileInspectionReport } from '@/lib/reports/file-inspection-report'

const uuid = z.string().uuid()

/**
 * Manually (re)generate + save the inspection certificate and re-file it into
 * handover. The certify flow does this automatically; this is the fallback when
 * the certify-time render failed (best-effort) or a re-issue is wanted.
 *
 * Gated to ORG_WRITE_ROLES (owner / admin / project_manager). The worker uses
 * the service client for writes, so this in-app gate is mandatory.
 */
export async function regenerateInspectionReportAction(
  inspectionId: string,
  projectId: string,
): Promise<{ error?: string; reportId?: string }> {
  const parse = z.tuple([uuid, uuid]).safeParse([inspectionId, projectId])
  if (!parse.success) return { error: 'Invalid parameters' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  // Cross-project guard: the inspection must belong to this project.
  const { data: insp } = await (supabase as any)
    .schema('inspections').from('inspections')
    .select('id, project_id').eq('id', inspectionId).maybeSingle()
  if (!insp || insp.project_id !== projectId) {
    return { error: 'Inspection not found or does not belong to this project' }
  }

  const result = await generateAndFileInspectionReport({
    inspectionId,
    projectId,
    orgId: (project as { organisation_id: string }).organisation_id,
    userId: user.id,
  })
  if ('error' in result) return { error: result.error }

  revalidatePath(`/projects/${projectId}/inspections/${inspectionId}/report`)
  revalidatePath(`/projects/${projectId}/handover/documents`)
  return { reportId: result.reportId }
}
