'use client'

import { useState, useTransition } from 'react'
import { createCatalogueItemAction, updateCatalogueItemAction } from '@/actions/supplier.actions'
import { useRouter } from 'next/navigation'

const CATEGORIES = ['electrical', 'mechanical', 'civil', 'safety', 'general', 'tools', 'materials']
const UNITS = ['each', 'metre', 'kg', 'litre', 'box', 'roll', 'pack', 'set', 'pair']

interface Item {
  id: string
  name: string
  sku?: string | null
  description?: string | null
  category: string
  unit: string
  unit_price: number
  min_order_qty: number
  lead_time_days?: number | null
  marketplace_visible: boolean
}

interface Props {
  item?: Item
}

export function CatalogueItemForm({ item }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const data = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = item
        ? await updateCatalogueItemAction(item.id, data)
        : await createCatalogueItemAction(data)

      if (result.error) {
        setError(result.error)
      } else {
        router.push('/supplier/catalogue')
      }
    })
  }

  const isEdit = !!item

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div>
        <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Item Name *</label>
        <input
          name="name"
          type="text"
          required
          defaultValue={item?.name ?? ''}
          placeholder="e.g. 16mm² NYY Cable"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">SKU / Part No</label>
          <input
            name="sku"
            type="text"
            defaultValue={item?.sku ?? ''}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Category *</label>
          <select
            name="category"
            required
            defaultValue={item?.category ?? ''}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select category</option>
            {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Description</label>
        <textarea
          name="description"
          rows={3}
          defaultValue={item?.description ?? ''}
          placeholder="Specifications, brand, certifications…"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Unit Price (ZAR) *</label>
          <input
            name="unit_price"
            type="number"
            required
            min="0"
            step="0.01"
            defaultValue={item?.unit_price ?? ''}
            placeholder="0.00"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Unit</label>
          <select
            name="unit"
            defaultValue={item?.unit ?? 'each'}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Min Order</label>
          <input
            name="min_order_qty"
            type="number"
            min="1"
            defaultValue={item?.min_order_qty ?? 1}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Lead Time (days)</label>
        <input
          name="lead_time_days"
          type="number"
          min="0"
          defaultValue={item?.lead_time_days ?? ''}
          placeholder="e.g. 3"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="flex items-center gap-3">
        <input
          id="marketplace_visible"
          name="marketplace_visible"
          type="checkbox"
          defaultChecked={item?.marketplace_visible ?? false}
          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600"
        />
        <label htmlFor="marketplace_visible" className="text-sm text-slate-300">
          Visible in marketplace
        </label>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm"
        >
          {isPending ? 'Saving…' : isEdit ? 'Update Item' : 'Add Item'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/supplier/catalogue')}
          className="text-sm text-slate-400 hover:text-white px-5 py-2.5 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
