import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService } from '@esite/shared'
import type { OrgRole } from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DeleteProjectPanel } from '../../DeleteProjectPanel'

const VIEW_ROLES: ReadonlyArray<OrgRole> = ['owner']

interface Props {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) redirect(`/projects/${id}`)

  const orgId = (project as any).organisation_id ?? (project as any).organisationId
  const guard = await requireRole(supabase, orgId, VIEW_ROLES)
  if (!guard.ok) redirect(`/projects/${id}/settings/general`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Archive stub */}
      <Card>
        <CardHeader>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Archive project</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>
            Archiving moves the project to read-only mode. All data is preserved.
          </p>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12, marginTop: 0 }}>
            Archived projects cannot be edited. They remain visible and searchable.
            You can unarchive at any time.
          </p>
          <Button type="button" size="sm" variant="secondary" disabled title="Coming in a follow-up release">
            Archive project — coming soon
          </Button>
        </CardBody>
      </Card>

      {/* Transfer ownership stub */}
      <Card>
        <CardHeader>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Transfer ownership</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>
            Transfer this project to another organisation.
          </p>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12, marginTop: 0 }}>
            Ownership transfer moves all project data (snags, RFIs, inspections,
            schedules) to the target organisation. This cannot be undone.
          </p>
          <Button type="button" size="sm" variant="secondary" disabled title="Coming in a follow-up release">
            Transfer ownership — coming soon
          </Button>
        </CardBody>
      </Card>

      {/* Delete — real implementation via DeleteProjectPanel */}
      <DeleteProjectPanel projectId={id} projectName={project.name} />
    </div>
  )
}
