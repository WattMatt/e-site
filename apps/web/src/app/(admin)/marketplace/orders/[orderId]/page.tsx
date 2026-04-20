import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatZAR } from '@esite/shared'
import { ConfirmDeliveryButton } from './ConfirmDeliveryButton'

interface Props { params: Promise<{ orderId: string }> }

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
    ? await (supabase as any)
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
  const canConfirmDelivery = order.status === 'in_transit'
  const shortId = orderId.slice(0, 8).toUpperCase()

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
        <Link href="/marketplace/orders" style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          ← Orders
        </Link>
        <span>/</span>
        <span>#{shortId}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Order #{shortId}</h1>
          <p className="page-subtitle">{formatDate(order.created_at)}</p>
        </div>
        <span className={STATUS_BADGE[order.status] ?? 'badge badge-muted'}>
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Supplier */}
        {supplier && (
          <div className="data-panel">
            <div style={{ padding: '14px 18px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 4 }}>
                Supplier
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
                {supplier.name}
              </div>
              {supplier.province && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                  {supplier.province}
                </div>
              )}
              <Link
                href={`/marketplace/${supplier.id}`}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-amber)', textDecoration: 'none', marginTop: 6, display: 'inline-block' }}
              >
                View profile →
              </Link>
            </div>
          </div>
        )}

        {/* Items */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Items ({items.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.map((item: any, idx: number) => {
              const ci = item.catalogue_item
              return (
                <div
                  key={item.id}
                  style={{
                    padding: '12px 18px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                    borderTop: idx > 0 ? '1px solid var(--c-border)' : 'none',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                      {ci?.name ?? item.description ?? 'Item'}
                    </p>
                    {ci?.sku && (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {ci.sku}
                      </p>
                    )}
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      {item.quantity} × {formatZAR(item.unit_price)} / {item.unit ?? ci?.unit ?? 'each'}
                    </p>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)', flexShrink: 0 }}>
                    {formatZAR(item.line_total ?? item.quantity * item.unit_price)}
                  </p>
                </div>
              )
            })}
          </div>
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--c-border)',
              display: 'flex',
              justifyContent: 'space-between',
              background: 'var(--c-elevated)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>Total</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-amber)' }}>
              {formatZAR(order.total_amount ?? subtotal)}
            </span>
          </div>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="data-panel">
            <div style={{ padding: '12px 18px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 4 }}>
                Notes
              </div>
              <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap' }}>
                {order.notes}
              </p>
            </div>
          </div>
        )}

        {/* Payment */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
          }}
        >
          Payment: <span style={{ color: 'var(--c-text)' }}>{order.payment_status}</span>
          {order.paid_at && <> · Paid {formatDate(order.paid_at)}</>}
        </div>

        {/* Confirm delivery */}
        {canConfirmDelivery && <ConfirmDeliveryButton orderId={orderId} />}

        {/* Rate supplier */}
        {order.status === 'delivered' && supplier && (
          <Link
            href={`/marketplace/${supplier.id}/rate?orderId=${orderId}`}
            className="btn-primary-amber"
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '12px 18px',
              textDecoration: 'none',
            }}
          >
            ⭐ Rate this supplier
          </Link>
        )}
      </div>
    </div>
  )
}
