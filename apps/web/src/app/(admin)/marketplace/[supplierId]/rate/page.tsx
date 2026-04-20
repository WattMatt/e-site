import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { supplierService } from '@esite/shared'
import { RateSupplierForm } from './RateSupplierForm'

interface Props {
  params: Promise<{ supplierId: string }>
  searchParams: Promise<{ orderId?: string }>
}

export default async function RateSupplierPage({ params, searchParams }: Props) {
  const { supplierId } = await params
  const { orderId } = await searchParams

  if (!orderId) redirect(`/marketplace/${supplierId}`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [supplier, order] = await Promise.all([
    supplierService.getById(supabase as any, supplierId).catch(() => null),
    orderId
      ? (supabase as any)
          .schema('marketplace')
          .from('orders')
          .select('id, status, created_at')
          .eq('id', orderId)
          .single()
          .then((r: any) => r.data)
      : null,
  ])

  if (!supplier) notFound()
  if (!order || order.status !== 'delivered') {
    redirect(`/marketplace/orders/${orderId}`)
  }

  const { data: existing } = await (supabase as any)
    .schema('marketplace')
    .from('supplier_ratings')
    .select('id')
    .eq('order_id', orderId)
    .eq('rated_by', user.id)
    .single()

  if (existing) {
    return (
      <div className="animate-fadeup" style={{ maxWidth: 560 }}>
        <div style={{ marginBottom: 16 }}>
          <Link
            href={`/marketplace/${supplierId}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
          >
            ← {(supplier as any).name}
          </Link>
        </div>
        <div className="data-panel">
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 32 }}>⭐</div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)' }}>
              You&apos;ve already rated this order
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
              Thank you for your feedback!
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/marketplace/${supplierId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {(supplier as any).name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Rate Supplier</h1>
          <p className="page-subtitle">{(supplier as any).name}</p>
        </div>
      </div>

      <RateSupplierForm supplierId={supplierId} orderId={orderId} />
    </div>
  )
}
