import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatZAR } from '@esite/shared'
import { ConfirmDeliveryButton } from './ConfirmDeliveryButton'

interface Props { params: Promise<{ orderId: string }> }

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

export default async function ContractorOrderDetailPage({ params }: Props) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const { data: order } = mem
    ? await supabase
        .schema('marketplace')
        .from('orders')
        .select(`
          *,
          order_items(id, quantity, unit_price, line_total, description, unit, catalogue_item:marketplace.catalogue_items(name, sku, unit)),
          supplier:suppliers.suppliers!supplier_id(id, name, province, website)
        `)
        .eq('id', orderId)
        .eq('contractor_org_id', mem.organisation_id)
        .single()
    : { data: null }

  if (!order) notFound()

  const items = (order.order_items ?? []) as any[]
  const subtotal = items.reduce((sum: number, i: any) => sum + (i.line_total ?? i.quantity * i.unit_price), 0)
  const supplier = (order as any).supplier

  // Contractor can confirm delivery when status is in_transit
  const canConfirmDelivery = order.status === 'in_transit'

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/marketplace/orders" className="hover:text-white">Orders</Link>
        <span>/</span>
        <span>#{orderId.slice(0, 8).toUpperCase()}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Order #{orderId.slice(0, 8).toUpperCase()}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{formatDate(order.created_at)}</p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_BADGE[order.status] ?? ''}`}>
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      {/* Supplier card */}
      {supplier && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Supplier</p>
          <p className="text-white font-medium">{supplier.name}</p>
          {supplier.province && <p className="text-xs text-slate-400">{supplier.province}</p>}
          <Link
            href={`/marketplace/${supplier.id}`}
            className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
          >
            View profile →
          </Link>
        </div>
      )}

      {/* Order items */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-slate-700">
          <p className="text-sm font-semibold text-white">Items ({items.length})</p>
        </div>
        <div className="divide-y divide-slate-700">
          {items.map((item: any) => {
            const ci = item.catalogue_item
            return (
              <div key={item.id} className="px-4 py-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-white">{ci?.name ?? item.description ?? 'Item'}</p>
                  {ci?.sku && <p className="text-xs text-slate-500 font-mono">{ci.sku}</p>}
                  <p className="text-xs text-slate-400 mt-0.5">
                    {item.quantity} × {formatZAR(item.unit_price)} / {item.unit ?? ci?.unit ?? 'each'}
                  </p>
                </div>
                <p className="font-semibold text-white text-sm flex-shrink-0">
                  {formatZAR(item.line_total ?? item.quantity * item.unit_price)}
                </p>
              </div>
            )
          })}
        </div>
        <div className="px-4 py-3 border-t border-slate-700 flex justify-between">
          <p className="text-sm text-slate-300 font-medium">Total</p>
          <p className="text-sm font-bold text-white">{formatZAR(order.total_amount ?? subtotal)}</p>
        </div>
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 mb-4">
          <p className="text-xs text-slate-400 mb-1">Notes</p>
          <p className="text-sm text-slate-200 whitespace-pre-wrap">{order.notes}</p>
        </div>
      )}

      {/* Payment status */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 mb-4 text-xs text-slate-400">
        Payment: <span className="text-white">{order.payment_status}</span>
        {order.paid_at && <> · Paid {formatDate(order.paid_at)}</>}
      </div>

      {/* Confirm delivery */}
      {canConfirmDelivery && (
        <ConfirmDeliveryButton orderId={orderId} />
      )}

      {/* Rate supplier */}
      {order.status === 'delivered' && supplier && (
        <div className="mt-4">
          <Link
            href={`/marketplace/${supplier.id}/rate?orderId=${orderId}`}
            className="block w-full text-center bg-amber-600/20 hover:bg-amber-600/30 border border-amber-700/50 text-amber-400 font-medium py-3 rounded-xl transition-colors text-sm"
          >
            ⭐ Rate this supplier
          </Link>
        </div>
      )}
    </div>
  )
}
