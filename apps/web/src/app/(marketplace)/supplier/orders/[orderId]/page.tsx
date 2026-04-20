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
  draft: 'badge badge-muted',
  submitted: 'badge badge-blue',
  confirmed: 'badge badge-amber',
  in_transit: 'badge badge-amber',
  delivered: 'badge badge-green',
  invoiced: 'badge badge-blue',
  cancelled: 'badge badge-red',
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

  const { data: rawOrder } = await (supabase as any)
    .schema('marketplace')
    .from('orders')
    .select(`
      *,
      order_items(
        id, quantity, unit_price, line_total, description, unit,
        catalogue_item:marketplace.catalogue_items(id, name, sku, unit)
      ),
      contractor_org_id, created_by
    `)
    .eq('id', orderId)
    .eq('supplier_org_id', mem.organisation_id)
    .single()

  if (!rawOrder) notFound()

  // Fetch contractor org and creator profile separately (avoids cross-schema FK hints)
  const [{ data: contractorOrg }, { data: creatorProfile }] = await Promise.all([
    rawOrder.contractor_org_id
      ? supabase.from('organisations').select('id, name').eq('id', rawOrder.contractor_org_id).single()
      : Promise.resolve({ data: null }),
    rawOrder.created_by
      ? supabase.from('profiles').select('id, full_name, email').eq('id', rawOrder.created_by).single()
      : Promise.resolve({ data: null }),
  ])

  const order = { ...rawOrder, contractor: contractorOrg, creator: creatorProfile }

  const items = (order.order_items ?? []) as any[]
  const subtotal = items.reduce((sum: number, i: any) => sum + (i.line_total ?? i.quantity * i.unit_price), 0)
  const availableTransitions = SUPPLIER_TRANSITIONS[order.status] ?? []
  const contractor = (order as any).contractor
  const creator = (order as any).creator

  return (
    <div className="animate-fadeup" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/supplier/orders"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Orders
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Order #{orderId.slice(0, 8).toUpperCase()}</h1>
          <p className="page-subtitle">{formatDate(order.created_at)}</p>
        </div>
        <span className={STATUS_BADGE[order.status] ?? STATUS_BADGE.draft}>
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      {/* Contractor info */}
      <div className="data-panel animate-fadeup animate-fadeup-1" style={{ marginBottom: 14 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">From</span>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
            {contractor?.name ?? 'Unknown contractor'}
          </p>
          {creator && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
              {creator.full_name} · {creator.email}
            </p>
          )}
          {order.notes && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--c-text-dim)',
                  marginBottom: 4,
                }}
              >
                Notes
              </p>
              <p style={{ fontSize: 13, color: 'var(--c-text-mid)', whiteSpace: 'pre-wrap' }}>
                {order.notes}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Order items */}
      <div className="data-panel animate-fadeup animate-fadeup-1" style={{ marginBottom: 14 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">Items ({items.length})</span>
        </div>
        {items.map((item: any) => {
          const ci = item.catalogue_item
          return (
            <div key={item.id} className="data-panel-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: 'var(--c-text)' }}>
                  {ci?.name ?? item.description ?? 'Item'}
                </p>
                {ci?.sku && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {ci.sku}
                  </p>
                )}
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                  {item.quantity} × {formatZAR(item.unit_price)} / {item.unit ?? ci?.unit ?? 'each'}
                </p>
              </div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-text)', flexShrink: 0 }}>
                {formatZAR(item.line_total ?? item.quantity * item.unit_price)}
              </p>
            </div>
          )
        })}
        <div
          style={{
            padding: '14px 18px',
            borderTop: '1px solid var(--c-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--c-text-mid)', fontWeight: 600 }}>Subtotal</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--c-amber)' }}>
            {formatZAR(order.total_amount ?? subtotal)}
          </p>
        </div>
      </div>

      {/* Commission note */}
      {order.total_amount && (
        <div
          className="animate-fadeup animate-fadeup-2"
          style={{
            background: 'var(--c-elevated)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 14,
            fontSize: 11,
            color: 'var(--c-text-dim)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.02em',
          }}
        >
          6% E-Site commission deducted at payment. You receive approx.{' '}
          <span style={{ color: 'var(--c-text)', fontWeight: 600 }}>
            {formatZAR((order.total_amount ?? subtotal) * 0.94)}
          </span>{' '}
          on settlement.
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
