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
    <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-5">
      {error && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Email *</label>
          <input
            name="email"
            type="email"
            required
            placeholder="you@company.co.za"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Password *</label>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Min 8 characters"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Company Name *</label>
          <input
            name="company_name"
            type="text"
            required
            placeholder="ABC Electrical (Pty) Ltd"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Trading Name</label>
          <input
            name="trading_name"
            type="text"
            placeholder="ABC Electrical"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">CIPC Registration No</label>
          <input
            name="registration_no"
            type="text"
            placeholder="2024/123456/07"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">VAT Number</label>
          <input
            name="vat_number"
            type="text"
            placeholder="4520123456"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Province *</label>
          <select
            name="province"
            required
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select province</option>
            {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Business Address</label>
          <input
            name="address"
            type="text"
            placeholder="123 Main St, Sandton, Johannesburg"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Categories */}
      <div>
        <label className="block text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wide">Supply Categories *</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => toggleCategory(value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                selectedCategories.includes(value)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* POPIA consent */}
      <div className="flex items-start gap-3 bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <input
          id="popia_consent"
          name="popia_consent"
          type="checkbox"
          required
          className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600"
        />
        <label htmlFor="popia_consent" className="text-xs text-slate-300 leading-relaxed">
          I consent to E-Site collecting and processing my personal information in accordance with
          the Protection of Personal Information Act (POPIA). My data will be used to operate the
          supplier marketplace and process payments.
        </label>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
      >
        {isPending ? 'Creating account…' : 'Create Supplier Account'}
      </button>

      <p className="text-center text-xs text-slate-500">
        Already have an account?{' '}
        <a href="/login" className="text-blue-400 hover:text-blue-300">Sign in</a>
      </p>
    </form>
  )
}
