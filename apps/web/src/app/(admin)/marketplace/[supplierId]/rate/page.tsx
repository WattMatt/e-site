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

  // Check if already rated
  const { data: existing } = await (supabase as any)
    .schema('marketplace')
    .from('supplier_ratings')
    .select('id')
    .eq('order_id', orderId)
    .eq('rated_by', user.id)
    .single()

  if (existing) {
    return (
      <div className="max-w-lg">
        <Link href={`/marketplace/${supplierId}`} className="text-slate-400 hover:text-white text-sm">
          ← {(supplier as any).name}
        </Link>
        <div className="mt-8 text-center py-12 bg-slate-900 border border-slate-800 rounded-2xl">
          <div className="text-4xl mb-3">⭐</div>
          <p className="text-white font-semibold">You&apos;ve already rated this order</p>
          <p className="text-slate-400 text-sm mt-1">Thank you for your feedback!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <Link href={`/marketplace/${supplierId}`} className="text-slate-400 hover:text-white text-sm">
        ← {(supplier as any).name}
      </Link>

      <h1 className="text-xl font-bold text-white mt-6 mb-1">Rate Supplier</h1>
      <p className="text-sm text-slate-400 mb-8">{(supplier as any).name}</p>

      <RateSupplierForm supplierId={supplierId} orderId={orderId} />
    </div>
  )
}
