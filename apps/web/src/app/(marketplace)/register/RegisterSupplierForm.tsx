'use client'

import { useState, useTransition } from 'react'
import { registerSupplierAction } from '@/actions/supplier.actions'

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

export function RegisterSupplierForm() {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])

  function toggleCategory(val: string) {
    setSelectedCategories(prev =>
      prev.includes(val) ? prev.filter(c => c !== val) : [...prev, val]
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (selectedCategories.length === 0) {
      setError('Select at least one category.')
      return
    }
    const data = new FormData(e.currentTarget)
    selectedCategories.forEach(c => data.append('categories', c))
    startTransition(async () => {
      const result = await registerSupplierAction(data)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="data-panel animate-fadeup animate-fadeup-1" style={{ padding: 0 }}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="ob-label" htmlFor="email">Email *</label>
            <input id="email" name="email" type="email" required placeholder="you@company.co.za" className="ob-input" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="ob-label" htmlFor="password">Password *</label>
            <input id="password" name="password" type="password" required minLength={8} placeholder="Min 8 characters" className="ob-input" />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="ob-label" htmlFor="company_name">Company Name *</label>
            <input id="company_name" name="company_name" type="text" required placeholder="ABC Electrical (Pty) Ltd" className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="trading_name">Trading Name</label>
            <input id="trading_name" name="trading_name" type="text" placeholder="ABC Electrical" className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="registration_no">CIPC Registration No</label>
            <input id="registration_no" name="registration_no" type="text" placeholder="2024/123456/07" className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="vat_number">VAT Number</label>
            <input id="vat_number" name="vat_number" type="text" placeholder="4520123456" className="ob-input" />
          </div>
          <div>
            <label className="ob-label" htmlFor="province">Province *</label>
            <select id="province" name="province" required className="ob-select">
              <option value="">Select province</option>
              {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="ob-label" htmlFor="address">Business Address</label>
            <input id="address" name="address" type="text" placeholder="123 Main St, Sandton, Johannesburg" className="ob-input" />
          </div>
        </div>

        {/* Categories */}
        <div>
          <label className="ob-label">Supply Categories *</label>
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

        {/* POPIA consent */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            background: 'var(--c-elevated)',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: 14,
          }}
        >
          <input
            id="popia_consent"
            name="popia_consent"
            type="checkbox"
            required
            style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--c-amber)' }}
          />
          <label htmlFor="popia_consent" style={{ fontSize: 12, color: 'var(--c-text-mid)', lineHeight: 1.5 }}>
            I consent to E-Site collecting and processing my personal information in accordance with
            the Protection of Personal Information Act (POPIA). My data will be used to operate the
            supplier marketplace and process payments.
          </label>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="ob-btn-primary"
          style={{ opacity: isPending ? 0.5 : 1, cursor: isPending ? 'not-allowed' : 'pointer' }}
        >
          {isPending ? 'Creating account…' : 'Create Supplier Account'}
        </button>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--c-text-dim)' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--c-amber)', textDecoration: 'none' }}>Sign in</a>
        </p>
      </div>
    </form>
  )
}
