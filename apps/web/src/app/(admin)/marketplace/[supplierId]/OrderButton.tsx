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
        description: item.name,
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
        type="button"
        onClick={() => setShowForm(true)}
        className="btn-primary-amber"
        style={{ marginTop: 8, fontSize: 11, padding: '5px 12px' }}
      >
        + Order
      </button>
    )
  }

  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <input
        type="number"
        min={item.min_order_qty}
        value={qty}
        onChange={e => setQty(Number(e.target.value))}
        className="ob-input"
        style={{ width: 64, padding: '4px 6px', fontSize: 12, textAlign: 'center' }}
      />
      <button
        type="button"
        onClick={placeOrder}
        disabled={placing}
        className="btn-primary-amber"
        style={{ fontSize: 11, padding: '5px 10px', opacity: placing ? 0.5 : 1 }}
      >
        {placing ? '…' : 'Place'}
      </button>
      <button
        type="button"
        onClick={() => setShowForm(false)}
        style={{
          fontSize: 12,
          color: 'var(--c-text-dim)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
      {error && (
        <p role="alert" style={{ color: 'var(--c-red)', fontSize: 11, width: '100%', textAlign: 'right' }}>
          {error}
        </p>
      )}
    </div>
  )
}
