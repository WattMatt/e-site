import Link from 'next/link'
import type { Metadata } from 'next'
import { listInspectionsAction } from '@/actions/inspections.actions'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'
import InspectionRowDeleteButton from './InspectionRowDeleteButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Inspections' }

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string }>
}

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost'

const STATUS_VARIANT: Record<string, Variant> = {
  assigned: 'ghost',
  in_progress: 'info',
  awaiting_verification: 'warning',
  certified: 'success',
  're-inspect_required': 'warning',
  abandoned: 'ghost',
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_verification', label: 'Awaiting verification' },
  { value: 'certified', label: 'Certified' },
  { value: 're-inspect_required', label: 'Re-inspect required' },
  { value: 'abandoned', label: 'Abandoned' },
]

export default async function InspectionsListPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status } = await searchParams
  const items = await listInspectionsAction(projectId, status ? { status } : undefined)

  // Resolve user's org-level role to gate the inline Delete button (owner only).
  // Use the project's org_id (lookup once, not per row).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let userOrgRole: string | null = null
  if (user) {
    const { data: project } = await supabase
      .schema('projects')
      .from('projects')
      .select('organisation_id')
      .eq('id', projectId)
      .single()
    if (project?.organisation_id) {
      const { data: roleRow } = await supabase
        .from('user_organisations')
        .select('role')
        .eq('user_id', user.id)
        .eq('organisation_id', project.organisation_id)
        .eq('is_active', true)
        .single()
      userOrgRole = (roleRow as { role: string } | null)?.role ?? null
    }
  }
  const canDelete = userOrgRole === 'owner'

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Project
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Inspections</h1>
          <p className="page-subtitle">COCs, factory tests, and structured inspections for this project.</p>
        </div>
        <Link href={`/projects/${projectId}/inspections/new`} style={{ textDecoration: 'none' }}>
          <Button>+ New Inspection</Button>
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATUS_FILTERS.map((s) => {
          const isActive = (status ?? '') === s.value
          const href = s.value
            ? `/projects/${projectId}/inspections?status=${s.value}`
            : `/projects/${projectId}/inspections`
          return (
            <Link key={s.value || 'all'} href={href} style={{ textDecoration: 'none' }}>
              <Badge variant={isActive ? 'info' : 'ghost'}>{s.label}</Badge>
            </Link>
          )
        })}
      </div>

      <Card>
        {items.length === 0 ? (
          <CardBody>
            <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13 }}>
              {status ? (
                <>
                  No inspections with status <span style={{ fontFamily: 'var(--font-mono)' }}>{status}</span>.{' '}
                  <Link href={`/projects/${projectId}/inspections`} style={{ color: 'var(--c-amber)', textDecoration: 'underline' }}>
                    Clear filter
                  </Link>
                  .
                </>
              ) : (
                <>
                  No inspections yet.{' '}
                  <Link href={`/projects/${projectId}/inspections/new`} style={{ color: 'var(--c-amber)', textDecoration: 'underline' }}>
                    Assign one
                  </Link>
                  {' '}from a template.
                </>
              )}
            </div>
          </CardBody>
        ) : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)', color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>TARGET</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>TEMPLATE</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>STATUS</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>COC #</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>VERIFIER</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>SCHEDULED</th>
                <th style={{ textAlign: 'right', padding: '10px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <td style={{ padding: '10px 14px', color: 'var(--c-text)' }}>
                    {i.target_label}{' '}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      ({i.target_node_type})
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--c-text-mid)' }}>
                    {i.template?.name ?? '—'}
                    {i.template?.deliverable_type && (
                      <Badge variant={i.template.deliverable_type === 'coc' ? 'warning' : 'info'} className="ml-1">
                        {i.template.deliverable_type.replace(/_/g, ' ')}
                      </Badge>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <Badge variant={STATUS_VARIANT[i.status] ?? 'default'}>{i.status.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-mid)' }}>
                    {i.coc_number ?? '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--c-text-mid)' }}>
                    {i.verifier?.email ?? '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {i.scheduled_at ? new Date(i.scheduled_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link
                      href={`/projects/${projectId}/inspections/${i.id}`}
                      style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline' }}
                    >
                      Open
                    </Link>
                    {canDelete && (
                      <InspectionRowDeleteButton
                        inspectionId={i.id}
                        projectId={projectId}
                        status={i.status}
                        label={i.target_label ?? i.template?.name ?? 'inspection'}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
