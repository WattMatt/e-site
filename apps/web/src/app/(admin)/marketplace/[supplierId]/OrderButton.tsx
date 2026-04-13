'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface CatalogueItem {
  id: string
  name: string
  unit: string
  unit_price: number
  min_order_qty: number
}

interface Props {
  supplierId: string
  supplierOrgId?: string
  item: CatalogueItem
}

export function OrderButton({ supplierId, supplierOrgId, item }: Props) {
  const [qty, setQty] = useState<number>(item.min_order_qty)
  const [showForm, setShowForm] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function placeOrder() {
    if (qty < item.min_order_qty) {
      setError(`Minimum order: ${item.min_order_qty}`)
      return
    }
    setPlacing(true)
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setPlacing(false); return }

    const { data: mem } = await supabase
      .from('user_organisations')
      .select('organisation_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()
    if (!mem) { setError('No organisation'); setPlacing(false); return }

    // Create order + item directly via supabase
    const { data: order, error: orderErr } = await supabase
      .schema('marketplace')
      .from('orders')
      .insert({
        contractor_org_id: mem.organisation_id,
        supplier_org_id: supplierOrgId ?? null,
        supplier_id: supplierId,
        created_by: user.id,
        status: 'draft',
      })
      .select()
      .single()

    if (orderErr) { setError(orderErr.message); setPlacing(false); return }

    const { error: itemErr } = await supabase
      .schema('marketplace')
      .from('order_items')
      .insert({
        order_id: order.id,
        catalogue_item_id: item.id,
        quantity: qty,
        unit_price: item.unit_price,
      })

    if (itemErr) { setError(itemErr.message); setPlacing(false); return }

    setShowForm(false)
    router.refresh()
    setPlacing(false)
    alert(`Order created for ${qty}× ${item.name}. Status: draft — confirm via procurement.`)
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
      >
        + Order
      </button>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="number"
        min={item.min_order_qty}
        value={qty}
        onChange={e => setQty(Number(e.target.value))}
        className="w-16 bg-slate-600 text-white rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        onClick={placeOrder}
        disabled={placing}
        className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
      >
        {placing ? '…' : 'Place'}
      </button>
      <button onClick={() => setShowForm(false)} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
