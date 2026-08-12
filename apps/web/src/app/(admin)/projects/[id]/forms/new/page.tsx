import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, listNodes, FORMS_FIELD_ROLES } from '@esite/shared'
import { cableScheduleNodeIds } from '@/lib/site-forms/prefill-sources'
import { NewFormForm, type BoardOption, type TemplateOption } from './NewFormForm'

interface Props {
  params: Promise<{ id: string }>
}

export default async function NewSiteFormPage({ params }: Props) {
  const { id: projectId } = await params

  const supabase = await createClient()
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) notFound()

  // Creating a form is a field action, so this is wider than ORG_WRITE_ROLES —
  // site electricians are usually `contractor`. Distribution stays restricted.
  const gate = await requireEffectiveRole(supabase as never, projectId, FORMS_FIELD_ROLES)
  if (!gate.ok) redirect(`/projects/${projectId}/forms`)

  const nodes = await listNodes(supabase as never, projectId, { status: 'active' })

  // Resolved once here, for every board at once, so the form can tell instantly
  // whether the board just picked is already covered by the cable schedule
  // without a round trip per selection.
  const { hasSchedule, nodeIds: scheduleNodeIds } = await cableScheduleNodeIds(
    supabase as never,
    projectId,
  )

  const boards: BoardOption[] = (nodes ?? []).map((n) => ({
    id: n.id as string,
    code: n.code as string,
    name: (n.name ?? null) as string | null,
    kind: n.kind as string,
  }))

  const { data: templateRows } = await (supabase as never as {
    schema: (s: string) => {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            a: string,
            b: boolean,
          ) => {
            order: (
              c: string,
              o: object,
            ) => Promise<{ data: { id: string; name: string; version: string }[] | null }>
          }
        }
      }
    }
  })
    .schema('field')
    .from('form_templates')
    .select('id, name, version')
    .eq('is_active', true)
    .order('name', { ascending: true })

  const templates: TemplateOption[] = (templateRows ?? []) as TemplateOption[]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">New form</h1>
          <p className="page-subtitle">
            One record per board, per isolation event. {project.name}
          </p>
        </div>
        <Link href={`/projects/${projectId}/forms`} className="btn">
          Back to forms
        </Link>
      </div>

      <NewFormForm
        projectId={projectId}
        boards={boards}
        templates={templates}
        hasCableSchedule={hasSchedule}
        cableScheduleBoardIds={scheduleNodeIds}
      />
    </div>
  )
}
