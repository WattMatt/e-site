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
      <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-emerald-400 mb-2">✓ Paystack Bank Account Linked</h3>
        <p className="text-sm text-slate-300">{subaccount.account_name}</p>
        <p className="text-xs text-slate-400 mt-0.5">{subaccount.bank_name} · Subaccount: {subaccount.subaccount_code}</p>
        <p className="text-xs text-slate-500 mt-2">
          Payments will be split automatically. Settlement typically 24–48 hours after payment.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-1">Link Bank Account (Paystack)</h3>
      <p className="text-xs text-slate-400 mb-4">
        Required to receive marketplace payments. E-Site deducts 6% commission; you receive the remainder directly.
      </p>

      {success && <p className="text-emerald-400 text-sm mb-3">Bank account linked successfully!</p>}
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          + Link Bank Account
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Business Name (as on bank account) *</label>
              <input name="business_name" type="text" required
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Bank *</label>
              <select name="bank_code" required
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">Select bank</option>
                {SA_BANKS.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Account Number *</label>
              <input name="account_number" type="text" required
                placeholder="1234567890"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Contact Email *</label>
              <input name="contact_email" type="email" required
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {isPending ? 'Linking…' : 'Link Account'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
