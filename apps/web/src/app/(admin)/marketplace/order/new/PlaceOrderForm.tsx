'use client'

import { useState, useTransition } from 'react'
import { placeOrderAction } from '@/actions/supplier.actions'

interface CatalogueItem {
  id: string
  name: string
  unit: string
  unit_price: number
  min_order_qty: number
  category: string
  sku?: string | null
}

interface Project {
  id: string
  name: string
}

interface CartItem {
  itemId: string
  itemName: string
  unit: string
  unitPrice: number
  qty: number
}

interface Props {
  supplierId: string
  supplierOrgId: string | null
  catalogueItems: CatalogueItem[]
  projects: Project[]
}

function formatZAR(amount: number) {
  return `R${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function PlaceOrderForm({ supplierId, supplierOrgId, catalogueItems, projects }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [notes, setNotes] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [requiredBy, setRequiredBy] = useState('')
  const [projectId, setProjectId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const filteredItems = catalogueItems.filter(i =>
    i.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (i.sku ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  function addToCart(item: CatalogueItem) {
    setCart(prev => {
      const existing = prev.find(c => c.itemId === item.id)
      if (existing) {
        return prev.map(c => c.itemId === item.id ? { ...c, qty: c.qty + item.min_order_qty } : c)
      }
      return [...prev, { itemId: item.id, itemName: item.name, unit: item.unit, unitPrice: item.unit_price, qty: item.min_order_qty }]
    })
  }

  function updateQty(itemId: string, qty: number) {
    if (qty <= 0) {
      setCart(prev => prev.filter(c => c.itemId !== itemId))
    } else {
      setCart(prev => prev.map(c => c.itemId === itemId ? { ...c, qty } : c))
    }
  }

  const total = cart.reduce((sum, c) => sum + c.qty * c.unitPrice, 0)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (cart.length === 0) { setError('Add at least one item to the order.'); return }
    setError(null)
    const data = new FormData()
    data.set('supplier_id', supplierId)
    if (supplierOrgId) data.set('supplier_org_id', supplierOrgId)
    if (projectId) data.set('project_id', projectId)
    if (notes) data.set('notes', notes)
    if (deliveryAddress) data.set('delivery_address', deliveryAddress)
    if (requiredBy) data.set('required_by', requiredBy)
    cart.forEach(c => {
      data.append('item_id', c.itemId)
      data.append('item_qty', c.qty.toString())
      data.append('item_price', c.unitPrice.toString())
    })
    startTransition(() => { void placeOrderAction(data) })
  }

  const qtyBtnStyle: React.CSSProperties = {
    width: 24, height: 24, borderRadius: 4,
    background: 'var(--c-elevated)', border: '1px solid var(--c-border-mid)',
    color: 'var(--c-text)', fontSize: 12, fontFamily: 'var(--font-mono)',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--c-red-dim)',
            border: '1px solid rgba(127,29,29,0.6)',
            color: '#fca5a5',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Item search + list */}
      <div className="data-panel">
        <div className="data-panel-header">
          <span className="data-panel-title">Select Items</span>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search catalogue…"
            className="ob-input"
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
            {filteredItems.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--c-text-dim)', textAlign: 'center', padding: '16px 0' }}>
                No items found.
              </p>
            )}
            {filteredItems.map(item => {
              const inCart = cart.find(c => c.itemId === item.id)
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '10px 12px',
                    background: 'var(--c-elevated)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      {formatZAR(item.unit_price)} / {item.unit}
                    </p>
                  </div>
                  {inCart ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button type="button" onClick={() => updateQty(item.id, inCart.qty - 1)} style={qtyBtnStyle}>−</button>
                      <span style={{ fontSize: 12, color: 'var(--c-text)', width: 28, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                        {inCart.qty}
                      </span>
                      <button type="button" onClick={() => updateQty(item.id, inCart.qty + 1)} style={qtyBtnStyle}>+</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToCart(item)}
                      className="btn-primary-amber"
                      style={{ fontSize: 11, padding: '5px 12px' }}
                    >
                      Add
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Cart summary */}
      {cart.length > 0 && (
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Order ({cart.length} items)</span>
          </div>
          <div style={{ padding: '12px 18px' }}>
            {cart.map(c => (
              <div key={c.itemId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-text-mid)', padding: '3px 0' }}>
                <span>{c.qty}× {c.itemName}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{formatZAR(c.qty * c.unitPrice)}</span>
              </div>
            ))}
            <div
              style={{
                borderTop: '1px solid var(--c-border)',
                marginTop: 8, paddingTop: 8,
                display: 'flex', justifyContent: 'space-between',
                fontSize: 13, fontWeight: 700,
              }}
            >
              <span style={{ color: 'var(--c-text)' }}>Total</span>
              <span style={{ color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{formatZAR(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Order details */}
      <div className="data-panel">
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {projects.length > 0 && (
            <div>
              <label className="ob-label" htmlFor="project">Project (optional)</label>
              <select
                id="project"
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="ob-select"
              >
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="ob-label" htmlFor="required-by">Required by (optional)</label>
            <input
              id="required-by"
              type="date"
              value={requiredBy}
              onChange={e => setRequiredBy(e.target.value)}
              className="ob-input"
            />
          </div>
          <div>
            <label className="ob-label" htmlFor="delivery-address">Delivery address</label>
            <input
              id="delivery-address"
              type="text"
              value={deliveryAddress}
              onChange={e => setDeliveryAddress(e.target.value)}
              placeholder="Site address or delivery location"
              className="ob-input"
            />
          </div>
          <div>
            <label className="ob-label" htmlFor="notes">Notes / special instructions</label>
            <textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Specifications, packaging requirements, instructions…"
              className="ob-input"
              style={{ resize: 'vertical', minHeight: 72 }}
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending || cart.length === 0}
        className="btn-primary-amber"
        style={{
          padding: '12px 18px',
          fontSize: 13,
          fontWeight: 700,
          opacity: (isPending || cart.length === 0) ? 0.5 : 1,
          cursor: (isPending || cart.length === 0) ? 'not-allowed' : 'pointer',
        }}
      >
        {isPending ? 'Placing order…' : `Place Order${cart.length > 0 ? ` · ${formatZAR(total)}` : ''}`}
      </button>
    </form>
  )
}
