'use client'

import { useState, useTransition } from 'react'

interface Subaccount {
  subaccount_code: string
  bank_name: string
  account_name: string
  is_active: boolean
}

interface Props {
  supplierId: string
  subaccount?: Subaccount | null
}

const SA_BANKS = [
  { code: '632005', name: 'ABSA Bank' },
  { code: '250655', name: 'FNB / First National Bank' },
  { code: '198765', name: 'Nedbank' },
  { code: '051001', name: 'Standard Bank' },
  { code: '679000', name: 'Capitec Bank' },
  { code: '462005', name: 'Investec Bank' },
  { code: '801000', name: 'African Bank' },
  { code: '087373', name: 'TymeBank' },
  { code: '430000', name: 'Discovery Bank' },
]

export function PaystackOnboardingCard({ supplierId, subaccount }: Props) {
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const bankCode = form.get('bank_code') as string
    const accountNumber = form.get('account_number') as string
    const businessName = form.get('business_name') as string
    const primaryContactEmail = form.get('contact_email') as string

    startTransition(async () => {
      const res = await fetch('/api/paystack/subaccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId, bankCode, accountNumber, businessName, primaryContactEmail }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to create Paystack subaccount')
        return
      }
      setSuccess(true)
      setShowForm(false)
    })
  }

  if (subaccount?.is_active) {
    return (
      <div
        className="animate-fadeup animate-fadeup-2"
        style={{
          background: '#14532d',
          border: '1px solid #166534',
          borderRadius: 6,
          padding: 20,
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', marginBottom: 8, letterSpacing: '0.02em' }}>
          ✓ Paystack Bank Account Linked
        </h3>
        <p style={{ fontSize: 13, color: 'var(--c-text)' }}>{subaccount.account_name}</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
          {subaccount.bank_name} · Subaccount: {subaccount.subaccount_code}
        </p>
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 10 }}>
          Payments will be split automatically. Settlement typically 24–48 hours after payment.
        </p>
      </div>
    )
  }

  return (
    <div
      className="data-panel animate-fadeup animate-fadeup-2"
      style={{ borderColor: 'var(--c-amber-mid)' }}
    >
      <div style={{ padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)', marginBottom: 4 }}>
          Link Bank Account (Paystack)
        </h3>
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 16 }}>
          Required to receive marketplace payments. E-Site deducts 6% commission; you receive the remainder directly.
        </p>

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
              marginBottom: 12,
            }}
          >
            Bank account linked successfully!
          </div>
        )}
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
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary-amber"
            style={{ fontSize: 13, padding: '9px 16px', fontWeight: 600 }}
          >
            + Link Bank Account
          </button>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="ob-label" htmlFor="business_name">Business Name (as on bank account) *</label>
                <input id="business_name" name="business_name" type="text" required className="ob-input" />
              </div>
              <div>
                <label className="ob-label" htmlFor="bank_code">Bank *</label>
                <select id="bank_code" name="bank_code" required className="ob-select">
                  <option value="">Select bank</option>
                  {SA_BANKS.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="ob-label" htmlFor="account_number">Account Number *</label>
                <input id="account_number" name="account_number" type="text" required placeholder="1234567890" className="ob-input" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="ob-label" htmlFor="contact_email">Contact Email *</label>
                <input id="contact_email" name="contact_email" type="email" required className="ob-input" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="submit"
                disabled={isPending}
                className="btn-primary-amber"
                style={{
                  fontSize: 13,
                  padding: '9px 16px',
                  fontWeight: 600,
                  opacity: isPending ? 0.5 : 1,
                  cursor: isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {isPending ? 'Linking…' : 'Link Account'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{
                  fontSize: 13,
                  color: 'var(--c-text-mid)',
                  background: 'var(--c-panel)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 6,
                  padding: '9px 16px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
