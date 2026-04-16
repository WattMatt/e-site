import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatZAR } from '@esite/shared'
import { OrderActionForm } from './OrderActionForm'

interface Props { params: Promise<{ orderId: string }> }

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Submitted', confirmed: 'Confirmed',
  in_transit: 'In Transit', delivered: 'Delivered', invoiced: 'Invoiced', cancelled: 'Cancelled',
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-300',
  submitted: 'bg-blue-900/30 text-blue-400 border border-blue-700/40',
  confirmed: 'bg-amber-900/30 text-amber-400',
  in_transit: 'bg-purple-900/30 text-purple-400',
  delivered: 'bg-emerald-900/30 text-emerald-400',
  invoiced: 'bg-cyan-900/30 text-cyan-400',
  cancelled: 'bg-red-900/30 text-red-400',
}

// Status transitions available to the supplier
const SUPPLIER_TRANSITIONS: Record<string, string[]> = {
  submitted: ['confirmed', 'cancelled'],
  confirmed: ['in_transit', 'cancelled'],
  in_transit: ['delivered'],
  delivered: ['invoiced'],
}

export default async function SupplierOrderDetailPage({ params }: Props) {
  const { orderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!mem) redirect('/register')

  const { data: order } = await supabase
    .schema('marketplace')
    .from('orders')
    .select(`
      *,
      order_items(
        id, quantity, unit_price, line_total, description, unit,
        catalogue_item:marketplace.catalogue_items(id, name, sku, unit)
      ),
      contractor:public.organisations!contractor_org_id(id, name),
      creator:public.profiles!created_by(id, full_name, email)
    `)
    .eq('id', orderId)
    .eq('supplier_org_id', mem.organisation_id)
    .single()

  if (!order) notFound()

  const items = (order.order_items ?? []) as any[]
  const subtotal = items.reduce((sum: number, i: any) => sum + (i.line_total ?? i.quantity * i.unit_price), 0)
  const availableTransitions = SUPPLIER_TRANSITIONS[order.status] ?? []
  const contractor = (order as any).contractor
  const creator = (order as any).creator

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/supplier/orders" className="text-slate-400 hover:text-white text-sm">← Orders</Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Order #{orderId.slice(0, 8).toUpperCase()}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{formatDate(order.created_at)}</p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_BADGE[order.status] ?? STATUS_BADGE.draft}`}>
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      {/* Contractor info */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">From</p>
        <p className="text-white font-medium">{contractor?.name ?? 'Unknown contractor'}</p>
        {creator && <p className="text-xs text-slate-400 mt-0.5">{creator.full_name} · {creator.email}</p>}
        {order.notes && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <p className="text-xs text-slate-400 mb-1">Notes</p>
            <p className="text-sm text-slate-200 whitespace-pre-wrap">{order.notes}</p>
          </div>
        )}
      </div>

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
          <p className="text-sm text-slate-300 font-medium">Subtotal</p>
          <p className="text-sm font-bold text-white">{formatZAR(order.total_amount ?? subtotal)}</p>
        </div>
      </div>

      {/* Commission note */}
      {order.total_amount && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 mb-4 text-xs text-slate-400">
          6% E-Site commission deducted at payment. You receive approx. {formatZAR((order.total_amount ?? subtotal) * 0.94)} on settlement.
        </div>
      )}

      {/* Action form */}
      {availableTransitions.length > 0 && (
        <OrderActionForm
          orderId={orderId}
          currentStatus={order.status}
          availableTransitions={availableTransitions}
          currentNotes={order.notes ?? ''}
          currentTotal={order.total_amount ?? subtotal}
        />
      )}
    </div>
  )
}
