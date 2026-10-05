import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { listTendersAction } from '@/actions/tender.actions'
import { NewTenderForm } from './_components/NewTenderForm'
import { formatRand, tenderStatusVariant } from './_components/format'

export const dynamic = 'force-dynamic'

export default async function TendersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const project = await projectService.getById(supabase as never, id).catch(() => null)
  if (!project) notFound()
  const guard = await requireEffectiveRole(supabase, id, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${id}`)

  const res = await listTendersAction(id)
  const tenders = 'data' in res ? res.data : []

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 className="page-title">Tenders</h1>
        <p style={{ color: 'var(--c-text-muted)', fontSize: 14, margin: '4px 0 0' }}>
          Import a tender BOQ workbook, check it reconciles to the cent, then (in a later release) invite contractors to price it.
          Only owners, admins and project managers can see this page.
        </p>
      </div>

      <NewTenderForm projectId={id} />

      <Card>
        <CardHeader><span className="data-panel-title">Tenders on this project</span></CardHeader>
        <CardBody>
          {'error' in res && <p role="alert" style={{ color: 'var(--c-red)' }}>{res.error}</p>}
          {tenders.length === 0 ? (
            <EmptyState title="No tenders yet" description="Create one above, then import its BOQ workbook." dense />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {tenders.map((t) => {
                const rec = t.reconciliation
                const matched = rec ? rec.source.matched && (rec.estimate?.matched ?? true) && (t.structure_diff?.identical ?? true) : null
                return (
                  <li key={t.id} style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12 }}>
                    <Link href={`/projects/${id}/tenders/${t.id}`} style={{ fontWeight: 600 }}>
                      {t.package} — {t.title}{t.revision ? ` (${t.revision})` : ''}
                    </Link>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 13, alignItems: 'center' }}>
                      <Badge variant={tenderStatusVariant(t.status)}>{t.status}</Badge>
                      {matched === null && <Badge variant="ghost">not imported</Badge>}
                      {matched === true && <Badge variant="success">reconciled to the cent</Badge>}
                      {matched === false && <Badge variant="danger">does not reconcile</Badge>}
                      {t.stated_subtotal != null && <span>Subtotal {formatRand(t.stated_subtotal)}</span>}
                      {t.closing_at && <span>Closes {new Date(t.closing_at).toLocaleString('en-ZA')}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
