import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatZAR } from '@esite/shared'

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

export default async function SupplierOrdersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/supplier/orders')

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!mem) redirect('/register')

  const { data: ordersRaw } = await (supabase as any)
    .schema('marketplace')
    .from('orders')
    .select(`
      *,
      order_items(id, quantity, unit_price, description, catalogue_item:marketplace.catalogue_items(name, unit)),
      contractor:public.organisations!contractor_org_id(name)
    `)
    .eq('supplier_org_id', mem.organisation_id)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })

  const allOrders: any[] = ordersRaw ?? []
  const pendingCount = allOrders.filter(o => o.status === 'submitted').length

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Orders</h1>
          <p className="text-sm text-slate-400 mt-0.5">{allOrders.length} orders</p>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="bg-blue-900/20 border border-blue-700/40 rounded-xl px-4 py-3 mb-6 text-sm text-blue-400">
          {pendingCount} new order{pendingCount > 1 ? 's' : ''} awaiting response.
        </div>
      )}

      {allOrders.length === 0 ? (
        <div className="flex flex-col items-center py-24 gap-3 text-center border border-dashed border-slate-700 rounded-xl">
          <div className="text-5xl">📦</div>
          <p className="text-white font-semibold">No orders yet</p>
          <p className="text-slate-400 text-sm">Orders from contractors will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {allOrders.map((order) => {
            const items = (order.order_items ?? []) as any[]
            const totalItems = items.reduce((sum: number, i: any) => sum + i.quantity, 0)
            const contractor = (order as any).contractor

            return (
              <Link
                key={order.id}
                href={`/supplier/orders/${order.id}`}
                className="block bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-slate-500 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[order.status] ?? STATUS_BADGE.draft}`}>
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                      {contractor && <span className="text-xs text-slate-400">{contractor.name}</span>}
                    </div>
                    <p className="text-sm text-white">
                      {totalItems} item{totalItems !== 1 ? 's' : ''}
                      {items[0] && ` · ${(items[0].catalogue_item as any)?.name ?? items[0].description ?? 'Item'}`}
                      {items.length > 1 && ` +${items.length - 1} more`}
                    </p>
                    {order.notes && (
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{order.notes}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {order.total_amount && (
                      <p className="font-bold text-white text-sm">{formatZAR(order.total_amount)}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(order.created_at)}</p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
