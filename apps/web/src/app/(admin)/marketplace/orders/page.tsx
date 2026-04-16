import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/Header'
import { formatDate, formatZAR } from '@esite/shared'
import Link from 'next/link'

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-300',
  submitted: 'bg-blue-900/30 text-blue-400',
  confirmed: 'bg-amber-900/30 text-amber-400',
  in_transit: 'bg-purple-900/30 text-purple-400',
  delivered: 'bg-emerald-900/30 text-emerald-400',
  invoiced: 'bg-cyan-900/30 text-cyan-400',
  cancelled: 'bg-red-900/30 text-red-400',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', confirmed: 'Confirmed',
  in_transit: 'In Transit', delivered: 'Delivered', invoiced: 'Invoiced', cancelled: 'Cancelled',
}

export default async function ContractorOrdersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const { data: orders } = mem
    ? await supabase
        .schema('marketplace')
        .from('orders')
        .select(`
          *,
          supplier:suppliers.suppliers!supplier_id(id, name),
          order_items(id, quantity, unit_price, line_total, description, catalogue_item:marketplace.catalogue_items(name))
        `)
        .eq('contractor_org_id', mem.organisation_id)
        .order('created_at', { ascending: false })
    : { data: [] }

  const allOrders = orders ?? []

  return (
    <div>
      <PageHeader
        title="My Orders"
        subtitle={`${allOrders.length} orders`}
        actions={
          <Link
            href="/marketplace"
            className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
          >
            Browse Marketplace
          </Link>
        }
      />

      {allOrders.length === 0 ? (
        <div className="flex flex-col items-center py-24 gap-3 text-center">
          <div className="text-5xl">🛒</div>
          <p className="text-white font-semibold">No orders yet</p>
          <p className="text-slate-400 text-sm">Browse the marketplace to place your first order.</p>
          <Link
            href="/marketplace"
            className="mt-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Browse Marketplace
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {allOrders.map((order) => {
            const items = (order.order_items ?? []) as any[]
            const supplier = (order as any).supplier
            return (
              <Link
                key={order.id}
                href={`/marketplace/orders/${order.id}`}
                className="flex items-start justify-between gap-4 p-4 bg-slate-800 border border-slate-700 rounded-xl hover:border-slate-500 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[order.status] ?? ''}`}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                    {supplier && <span className="text-sm text-white">{supplier.name}</span>}
                  </div>
                  <p className="text-xs text-slate-400">
                    {items.length} item{items.length !== 1 ? 's' : ''}
                    {items[0] && ` · ${(items[0].catalogue_item as any)?.name ?? items[0].description ?? 'Item'}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {order.total_amount && (
                    <p className="font-bold text-white text-sm">{formatZAR(order.total_amount)}</p>
                  )}
                  <p className="text-xs text-slate-400">{formatDate(order.created_at)}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
