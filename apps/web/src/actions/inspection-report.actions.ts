'use server'

/**
 * Manual re-issue of an inspection's branded report. Certify does this
 * automatically; this is the gated fallback / regenerate button.
 *
 * Gate shape mirrors valuation.actions.ts: cookie client for auth + role,
 * service client (RLS-bypassing) behind the gate, cross-project guard before
 * any write.
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { generateAndFileInspectionReport } from '@/lib/reports/file-inspection-report'

const argsSchema = z.tuple([z.string().uuid(), z.string().uuid()])

export async function regenerateInspectionReportAction(
  inspectionId: string,
  projectId: string,
): Promise<{ error: string } | { reportId: string }> {
  const parsed = argsSchema.safeParse([inspectionId, projectId])
  if (!parsed.success) return { error: 'Invalid request' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthenticated' }

  const project = await projectService.getById(supabase, projectId)
  if (!project) return { error: 'Project not found' }

  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  // Cross-project guard — the inspection must belong to this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: insp } = await service
    .schema('inspections')
    .from('inspections')
    .select('project_id, organisation_id')
    .eq('id', inspectionId)
    .maybeSingle()
  if (!insp || insp.project_id !== projectId) return { error: 'Not found' }

  const result = await generateAndFileInspectionReport({
    inspectionId,
    projectId,
    orgId: insp.organisation_id as string,
    userId: user.id,
  })
  if ('error' in result) return { error: result.error }

  revalidatePath(`/projects/${projectId}/inspections/${inspectionId}/report`)
  revalidatePath(`/projects/${projectId}/handover/documents`)
  return { reportId: result.reportId }
}
