import { createClient } from '@/lib/supabase/server'
import { formatDate, formatZAR } from '@esite/shared'
import Link from 'next/link'

const STATUS_BADGE: Record<string, string> = {
  draft:      'badge badge-muted',
  submitted:  'badge badge-blue',
  confirmed:  'badge badge-amber',
  in_transit: 'badge badge-amber',
  delivered:  'badge badge-green',
  invoiced:   'badge badge-blue',
  cancelled:  'badge badge-red',
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
    ? await (supabase as any)
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
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Orders</h1>
          <p className="page-subtitle">{allOrders.length} order{allOrders.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/marketplace" className="filter-tab">Browse Marketplace</Link>
      </div>

      {allOrders.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            No orders yet —{' '}
            <Link href="/marketplace" style={{ color: 'var(--c-amber)', textDecoration: 'none' }}>
              browse the marketplace
            </Link>{' '}
            to place your first order.
          </div>
        </div>
      ) : (
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Orders</span>
          </div>
          {allOrders.map((order: any) => {
            const items = (order.order_items ?? []) as any[]
            const supplier = (order as any).supplier
            return (
              <Link key={order.id} href={`/marketplace/orders/${order.id}`} className="data-panel-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                    {supplier?.name ?? 'Supplier'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    {items.length} item{items.length !== 1 ? 's' : ''}
                    {items[0] && ` · ${(items[0].catalogue_item as any)?.name ?? items[0].description ?? 'Item'}`}
                    {` · ${formatDate(order.created_at)}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {order.total_amount && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
                      {formatZAR(order.total_amount)}
                    </span>
                  )}
                  <span className={STATUS_BADGE[order.status] ?? 'badge badge-muted'}>
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
