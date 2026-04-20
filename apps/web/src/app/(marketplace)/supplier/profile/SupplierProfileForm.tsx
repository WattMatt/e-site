'use client'

import { useState, useTransition } from 'react'
import { updateSupplierProfileAction } from '@/actions/supplier.actions'

const SA_PROVINCES = [
  'Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape',
  'Limpopo', 'Mpumalanga', 'North West', 'Free State', 'Northern Cape',
]

const CATEGORIES = [
  { value: 'electrical', label: 'Electrical' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'civil', label: 'Civil' },
  { value: 'safety', label: 'Safety' },
  { value: 'general', label: 'General' },
]

interface Supplier {
  id: string
  name: string
  trading_name?: string | null
  registration_no?: string | null
  vat_number?: string | null
  province?: string | null
  address?: string | null
  website?: string | null
  categories: string[]
  is_verified: boolean
}

export function SupplierProfileForm({ supplier }: { supplier: Supplier }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(supplier.categories ?? [])

  function toggleCategory(val: string) {
    setSelectedCategories(prev =>
      prev.includes(val) ? prev.filter(c => c !== val) : [...prev, val]
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const data = new FormData(e.currentTarget)
    selectedCategories.forEach(c => data.append('categories', c))
    startTransition(async () => {
      const result = await updateSupplierProfileAction(supplier.id, data)
      if (result.error) setError(result.error)
      else setSuccess(true)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="data-panel animate-fadeup animate-fadeup-1">
      <div className="data-panel-header">
        <span className="data-panel-title">Company Details</span>
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
        {success && (
          <div
            role="status"
            style={{
              background: '#14532d',
              border: '1px solid #166534',
              color: '#4ade80',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 12,
            }}
          >
            Profile saved.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="ob-label" htmlFor="name">Company Name *</label>
            <input id="name" name="name" type="text" required defaultValue={supplier.name} className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="trading_name">Trading Name</label>
            <input id="trading_name" name="trading_name" type="text" defaultValue={supplier.trading_name ?? ''} className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="registration_no">CIPC Reg No</label>
            <input id="registration_no" name="registration_no" type="text" defaultValue={supplier.registration_no ?? ''} placeholder="2024/123456/07" className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="vat_number">VAT Number</label>
            <input id="vat_number" name="vat_number" type="text" defaultValue={supplier.vat_number ?? ''} className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="province">Province</label>
            <select id="province" name="province" defaultValue={supplier.province ?? ''} className="ob-select">
              <option value="">Select province</option>
              {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="ob-label" htmlFor="address">Business Address</label>
            <input id="address" name="address" type="text" defaultValue={supplier.address ?? ''} className="ob-input" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="ob-label" htmlFor="website">Website</label>
            <input id="website" name="website" type="url" defaultValue={supplier.website ?? ''} placeholder="https://yourcompany.co.za" className="ob-input" />
          </div>
        </div>

        <div>
          <label className="ob-label">Categories</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map(({ value, label }) => {
              const selected = selectedCategories.includes(value)
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleCategory(value)}
                  className={`filter-tab${selected ? ' active' : ''}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
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
            {isPending ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </form>
  )
}
