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
    <form onSubmit={handleSubmit} className="data-panel animate-fadeup animate-fadeup-1" style={{ maxWidth: 640 }}>
      <div className="data-panel-header">
        <span className="data-panel-title">{isEdit ? 'Edit Item' : 'New Item'}</span>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
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

        <div>
          <label className="ob-label" htmlFor="name">Item Name *</label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={item?.name ?? ''}
            placeholder="e.g. 16mm² NYY Cable"
            className="ob-input"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <div>
            <label className="ob-label" htmlFor="sku">SKU / Part No</label>
            <input id="sku" name="sku" type="text" defaultValue={item?.sku ?? ''} className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="category">Category *</label>
            <select
              id="category"
              name="category"
              required
              defaultValue={item?.category ?? ''}
              className="ob-select"
            >
              <option value="">Select category</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c} style={{ textTransform: 'capitalize' }}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="ob-label" htmlFor="description">Description</label>
          <textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={item?.description ?? ''}
            placeholder="Specifications, brand, certifications…"
            className="ob-input"
            style={{ resize: 'vertical', minHeight: 72 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <div>
            <label className="ob-label" htmlFor="unit_price">Unit Price (ZAR) *</label>
            <input
              id="unit_price"
              name="unit_price"
              type="number"
              required
              min="0"
              step="0.01"
              defaultValue={item?.unit_price ?? ''}
              placeholder="0.00"
              className="ob-input"
            />
          </div>
          <div>
            <label className="ob-label" htmlFor="unit">Unit</label>
            <select id="unit" name="unit" defaultValue={item?.unit ?? 'each'} className="ob-select">
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="ob-label" htmlFor="min_order_qty">Min Order</label>
            <input
              id="min_order_qty"
              name="min_order_qty"
              type="number"
              min="1"
              defaultValue={item?.min_order_qty ?? 1}
              className="ob-input"
            />
          </div>
        </div>

        <div>
          <label className="ob-label" htmlFor="lead_time_days">Lead Time (days)</label>
          <input
            id="lead_time_days"
            name="lead_time_days"
            type="number"
            min="0"
            defaultValue={item?.lead_time_days ?? ''}
            placeholder="e.g. 3"
            className="ob-input"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="marketplace_visible"
            name="marketplace_visible"
            type="checkbox"
            defaultChecked={item?.marketplace_visible ?? false}
            style={{ width: 16, height: 16, accentColor: 'var(--c-amber)' }}
          />
          <label htmlFor="marketplace_visible" style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
            Visible in marketplace
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary-amber"
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 600,
              opacity: isPending ? 0.5 : 1,
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {isPending ? 'Saving…' : isEdit ? 'Update Item' : 'Add Item'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/supplier/catalogue')}
            style={{
              fontSize: 13,
              color: 'var(--c-text-mid)',
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              padding: '10px 20px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}
