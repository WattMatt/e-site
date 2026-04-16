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
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {success && <p className="text-emerald-400 text-sm">Profile saved.</p>}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Company Name *</label>
          <input
            name="name"
            type="text"
            required
            defaultValue={supplier.name}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Trading Name</label>
          <input name="trading_name" type="text" defaultValue={supplier.trading_name ?? ''}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">CIPC Reg No</label>
          <input name="registration_no" type="text" defaultValue={supplier.registration_no ?? ''}
            placeholder="2024/123456/07"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">VAT Number</label>
          <input name="vat_number" type="text" defaultValue={supplier.vat_number ?? ''}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Province</label>
          <select name="province" defaultValue={supplier.province ?? ''}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500">
            <option value="">Select province</option>
            {SA_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Business Address</label>
          <input name="address" type="text" defaultValue={supplier.address ?? ''}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">Website</label>
          <input name="website" type="url" defaultValue={supplier.website ?? ''}
            placeholder="https://yourcompany.co.za"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wide">Categories</label>
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

      <button
        type="submit"
        disabled={isPending}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
      >
        {isPending ? 'Saving…' : 'Save Profile'}
      </button>
    </form>
  )
}
