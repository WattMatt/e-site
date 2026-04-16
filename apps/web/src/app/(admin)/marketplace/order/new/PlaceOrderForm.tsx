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
    startTransition(() => placeOrderAction(data))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Item search + add */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Select Items</h3>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search catalogue…"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 mb-3"
        />
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {filteredItems.length === 0 && (
            <p className="text-slate-400 text-sm text-center py-4">No items found.</p>
          )}
          {filteredItems.map(item => {
            const inCart = cart.find(c => c.itemId === item.id)
            return (
              <div key={item.id} className="flex items-center justify-between gap-3 p-3 bg-slate-800 border border-slate-700 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.name}</p>
                  <p className="text-xs text-slate-400">{formatZAR(item.unit_price)} / {item.unit}</p>
                </div>
                {inCart ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateQty(item.id, inCart.qty - 1)}
                      className="w-6 h-6 rounded bg-slate-600 text-white text-xs hover:bg-slate-500">−</button>
                    <span className="text-sm text-white w-8 text-center">{inCart.qty}</span>
                    <button type="button" onClick={() => updateQty(item.id, inCart.qty + 1)}
                      className="w-6 h-6 rounded bg-slate-600 text-white text-xs hover:bg-slate-500">+</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => addToCart(item)}
                    className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    Add
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Cart summary */}
      {cart.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-2">Order ({cart.length} items)</h3>
          <div className="space-y-1">
            {cart.map(c => (
              <div key={c.itemId} className="flex justify-between text-sm text-slate-300">
                <span>{c.qty}× {c.itemName}</span>
                <span>{formatZAR(c.qty * c.unitPrice)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-700 mt-2 pt-2 flex justify-between font-bold text-white text-sm">
            <span>Total</span>
            <span>{formatZAR(total)}</span>
          </div>
        </div>
      )}

      {/* Order details */}
      <div className="space-y-4">
        {projects.length > 0 && (
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Project (optional)</label>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Required By (optional)</label>
          <input
            type="date"
            value={requiredBy}
            onChange={e => setRequiredBy(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Delivery Address</label>
          <input
            type="text"
            value={deliveryAddress}
            onChange={e => setDeliveryAddress(e.target.value)}
            placeholder="Site address or delivery location"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Notes / Special Instructions</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Specifications, packaging requirements, instructions…"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending || cart.length === 0}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
      >
        {isPending ? 'Placing order…' : `Place Order${cart.length > 0 ? ` · ${formatZAR(total)}` : ''}`}
      </button>
    </form>
  )
}
