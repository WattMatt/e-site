import { createClient } from '@/lib/supabase/server'
import { procurementService, formatDate, formatZAR } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import Link from 'next/link'
import { NewProcurementForm } from './NewProcurementForm'

const STATUS_VARIANT: Record<string, any> = {
  draft: 'ghost', sent: 'warning', quoted: 'warning',
  approved: 'success', fulfilled: 'success', cancelled: 'ghost',
}

const STATUSES = ['draft', 'sent', 'quoted', 'approved', 'fulfilled', 'cancelled']

interface Props { searchParams: Promise<{ status?: string; projectId?: string }> }

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

  const [items, projects] = await Promise.all([
    procurementService.listByOrg(supabase as any, orgId, { status, projectId }).catch(() => []),
    supabase.schema('projects').from('projects')
      .select('id, name').eq('organisation_id', orgId).eq('status', 'active').order('name')
      .then(r => r.data ?? []),
  ])

  // Totals
  const totalApproved = items.filter(i => i.status === 'approved' || i.status === 'fulfilled')
    .reduce((s, i) => s + (Number((i as any).quoted_price) || 0), 0)

  return (
    <div>
      <PageHeader
        title="Procurement"
        subtitle="Manage material requisitions across projects"
      />

      {/* Status filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <Link href="/procurement" className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!status ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          All ({items.length})
        </Link>
        {STATUSES.map(s => {
          const count = items.filter(i => i.status === s).length
          return (
            <Link key={s} href={`/procurement?status=${s}`}
              className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${status === s ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {s} {count > 0 ? `(${count})` : ''}
            </Link>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* List */}
        <div className="lg:col-span-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center gap-3">
              <div className="text-5xl">🛒</div>
              <p className="text-white font-semibold">No procurement items</p>
              <p className="text-slate-400 text-sm">Add material requisitions to track orders across projects.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item: any) => (
                <Card key={item.id}>
                  <div className="px-5 py-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-white">{item.description}</p>
                        <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                        <span>{item.project?.name}</span>
                        {item.quantity && <span>{item.quantity} {item.unit ?? 'units'}</span>}
                        {item.required_by && <span>Required {formatDate(item.required_by)}</span>}
                        {item.po_number && <span>PO: {item.po_number}</span>}
                        {item.supplier?.name && <span>Supplier: {item.supplier.name}</span>}
                      </div>
                      {item.notes && <p className="text-xs text-slate-500 mt-1.5">{item.notes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {item.quoted_price && (
                        <p className="text-sm font-semibold text-white">{formatZAR(item.quoted_price)}</p>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">{formatDate(item.created_at)}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: new item form + totals */}
        <div className="space-y-4">
          {totalApproved > 0 && (
            <Card>
              <div className="px-4 py-4">
                <p className="text-xs text-slate-400 mb-1">Committed spend</p>
                <p className="text-xl font-bold text-white">{formatZAR(totalApproved)}</p>
                <p className="text-xs text-slate-500 mt-0.5">approved + fulfilled</p>
              </div>
            </Card>
          )}
          <NewProcurementForm orgId={orgId} userId={user!.id} projects={projects as any} />
        </div>
      </div>
    </div>
  )
}
