import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService } from '@esite/shared'
import type { OrgRole } from '@esite/shared'
import { getProjectHistoryCached } from '@/lib/project-settings'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { HistoryTable } from './HistoryTable'

const VIEW_ROLES: ReadonlyArray<OrgRole> = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
]

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

  // Fetch audit history rows.
  const rows = await getProjectHistoryCached(id)

  // Resolve changed_by UUIDs → display names in one query.
  const changedByIds = [...new Set(rows.map(r => r.changedBy).filter(Boolean))] as string[]
  let nameById: Record<string, string> = {}
  if (changedByIds.length > 0) {
    const { data: profiles } = await (supabase as any)
      .from('profiles')
      .select('id, full_name')
      .in('id', changedByIds)
    ;(profiles ?? []).forEach((p: { id: string; full_name: string | null }) => {
      if (p.full_name) nameById[p.id] = p.full_name
    })
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Settings history</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>
            Every change to project settings is logged here. Use Restore to roll back.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <HistoryTable projectId={id} rows={rows} nameById={nameById} />
      </CardBody>
    </Card>
  )
}
