import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { procurementService, formatDate, formatZAR } from '@esite/shared'
import Link from 'next/link'
import { NewProcurementForm } from './NewProcurementForm'
import { ProcurementStatusButton } from './ProcurementStatusButton'

export const metadata: Metadata = { title: 'Procurement' }

const STATUS_BADGE: Record<string, string> = {
  draft:     'badge badge-muted',
  sent:      'badge badge-blue',
  quoted:    'badge badge-amber',
  approved:  'badge badge-green',
  fulfilled: 'badge badge-green',
  cancelled: 'badge badge-muted',
}

const STATUSES = ['draft', 'sent', 'quoted', 'approved', 'fulfilled', 'cancelled']

interface Props {
  searchParams: Promise<{ status?: string; projectId?: string }>
}

export default async function ProcurementPage({ searchParams }: Props) {
  const { status, projectId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const orgId = mem?.organisation_id ?? ''

  const [items, projects, projectRow] = await Promise.all([
    procurementService.listByOrg(supabase as any, orgId, { status, projectId }).catch(() => []),
    supabase.schema('projects').from('projects')
      .select('id, name').eq('organisation_id', orgId).eq('status', 'active').order('name')
      .then(r => r.data ?? []),
    projectId
      ? supabase.schema('projects').from('projects').select('id, name').eq('id', projectId).single().then(r => r.data)
      : Promise.resolve(null),
  ])

  const totalApproved = (items as any[])
    .filter((i: any) => i.status === 'approved' || i.status === 'fulfilled')
    .reduce((s: number, i: any) => s + (Number(i.quoted_price) || 0), 0)

  const baseUrl = projectId ? `/procurement?projectId=${projectId}` : '/procurement'

  return (
    <div className="animate-fadeup">
      {projectId && (
        <div style={{ marginBottom: 16 }}>
          <Link
            href={`/projects/${projectId}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
          >
            ← {projectRow?.name ?? 'Project'}
          </Link>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Procurement</h1>
          <p className="page-subtitle">
            {(items as any[]).length} item{(items as any[]).length !== 1 ? 's' : ''}
            {projectId && projectRow ? ` · ${projectRow.name}` : ''}
          </p>
        </div>
        {totalApproved > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 2 }}>
              Committed Spend
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-amber)' }}>
              {formatZAR(totalApproved)}
            </div>
          </div>
        )}
      </div>

      {/* Status filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        <Link href={baseUrl} className={`filter-tab${!status ? ' active' : ''}`}>
          All ({(items as any[]).length})
        </Link>
        {STATUSES.map(s => {
          const count = (items as any[]).filter((i: any) => i.status === s).length
          if (count === 0 && status !== s) return null
          return (
            <Link
              key={s}
              href={`${baseUrl}&status=${s}`}
              className={`filter-tab${status === s ? ' active' : ''}`}
              style={{ textTransform: 'capitalize' }}
            >
              {s}{count > 0 ? ` (${count})` : ''}
            </Link>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        {/* Items list */}
        <div>
          {(items as any[]).length === 0 ? (
            <div className="data-panel">
              <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
                🛒 No procurement items{status ? ` with status "${status}"` : ''} — add material requisitions to track orders.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(items as any[]).map((item: any) => (
                <div key={item.id} className="data-panel">
                  <div className="data-panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className={STATUS_BADGE[item.status] ?? 'badge badge-muted'} style={{ textTransform: 'capitalize' }}>
                        {item.status}
                      </span>
                      {!projectId && item.project?.name && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                          {item.project.name}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                      {item.quoted_price && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-text)' }}>
                          {formatZAR(item.quoted_price)}
                        </span>
                      )}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {formatDate(item.created_at)}
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '12px 18px' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', marginBottom: 4 }}>
                      {item.description}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      {item.quantity && (
                        <span>{item.quantity} {item.unit ?? 'units'}</span>
                      )}
                      {item.required_by && (
                        <span>Required {formatDate(item.required_by)}</span>
                      )}
                      {item.po_number && (
                        <span>PO: {item.po_number}</span>
                      )}
                      {item.supplier?.name && (
                        <span>Supplier: {item.supplier.name}</span>
                      )}
                    </div>
                    {item.notes && (
                      <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 6 }}>{item.notes}</p>
                    )}
                    <ProcurementStatusButton
                      id={item.id}
                      currentStatus={item.status}
                      quotedPrice={(item as any).quoted_price}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: new item form */}
        <div>
          <NewProcurementForm
            orgId={orgId}
            userId={user!.id}
            projects={projects as any}
            defaultProjectId={projectId}
          />
        </div>
      </div>
    </div>
  )
}
