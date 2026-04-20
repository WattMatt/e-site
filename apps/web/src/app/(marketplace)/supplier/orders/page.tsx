import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatZAR } from '@esite/shared'

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge badge-muted',
  submitted: 'badge badge-blue',
  confirmed: 'badge badge-amber',
  in_transit: 'badge badge-amber',
  delivered: 'badge badge-green',
  invoiced: 'badge badge-blue',
  cancelled: 'badge badge-red',
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
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-subtitle">{allOrders.length} order{allOrders.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {pendingCount > 0 && (
        <div
          className="animate-fadeup animate-fadeup-1"
          style={{
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber-mid)',
            color: 'var(--c-amber)',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {pendingCount} new order{pendingCount > 1 ? 's' : ''} awaiting response.
        </div>
      )}

      {allOrders.length === 0 ? (
        <div className="data-panel animate-fadeup animate-fadeup-1">
          <div
            className="data-panel-empty"
            style={{ padding: '64px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}
          >
            <div style={{ fontSize: 40 }}>📦</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>No orders yet</p>
            <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Orders from contractors will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="data-panel animate-fadeup animate-fadeup-1">
          <div className="data-panel-header">
            <span className="data-panel-title">Orders</span>
          </div>
          {allOrders.map((order) => {
            const items = (order.order_items ?? []) as any[]
            const totalItems = items.reduce((sum: number, i: any) => sum + i.quantity, 0)
            const contractor = (order as any).contractor

            return (
              <Link
                key={order.id}
                href={`/supplier/orders/${order.id}`}
                className="data-panel-row"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span className={STATUS_BADGE[order.status] ?? STATUS_BADGE.draft}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                    {contractor && (
                      <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{contractor.name}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--c-text)' }}>
                    {totalItems} item{totalItems !== 1 ? 's' : ''}
                    {items[0] && ` · ${(items[0].catalogue_item as any)?.name ?? items[0].description ?? 'Item'}`}
                    {items.length > 1 && ` +${items.length - 1} more`}
                  </p>
                  {order.notes && (
                    <p
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--c-text-dim)',
                        marginTop: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {order.notes}
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  {order.total_amount && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
                      {formatZAR(order.total_amount)}
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {formatDate(order.created_at)}
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
