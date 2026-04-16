import { createSiteAction } from '@/actions/compliance.actions'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'

const SA_PROVINCES = [
  'Gauteng',
  'Western Cape',
  'KwaZulu-Natal',
  'Eastern Cape',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Free State',
  'Northern Cape',
]

const SITE_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'infrastructure', label: 'Infrastructure' },
]

export default function NewSitePage() {
  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link href="/compliance" className="text-slate-400 hover:text-white text-sm">
          ← Compliance
        </Link>
      </div>

      <h1 className="text-xl font-semibold text-white mb-1">Add Compliance Site</h1>
      <p className="text-slate-400 text-sm mb-8">
        Create a new site to track COC status across its subsections.
      </p>

      <form action={createSiteAction} className="space-y-5">
        {/* Site name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-1.5">
            Site name <span className="text-red-400">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="e.g. Sandton City Phase 3"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Address */}
        <div>
          <label htmlFor="address" className="block text-sm font-medium text-slate-300 mb-1.5">
            Street address <span className="text-red-400">*</span>
          </label>
          <input
            id="address"
            name="address"
            type="text"
            required
            placeholder="e.g. 7 Alice Lane, Sandton"
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* City + Province */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-slate-300 mb-1.5">
              City
            </label>
            <input
              id="city"
              name="city"
              type="text"
              placeholder="e.g. Johannesburg"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="province" className="block text-sm font-medium text-slate-300 mb-1.5">
              Province
            </label>
            <select
              id="province"
              name="province"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select province</option>
              {SA_PROVINCES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ERF number + Site type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="erf_number" className="block text-sm font-medium text-slate-300 mb-1.5">
              ERF / Stand number
            </label>
            <input
              id="erf_number"
              name="erf_number"
              type="text"
              placeholder="e.g. ERF 1234"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="site_type" className="block text-sm font-medium text-slate-300 mb-1.5">
              Site type
            </label>
            <select
              id="site_type"
              name="site_type"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {SITE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit">Create site</Button>
          <Link href="/compliance">
            <Button type="button" variant="ghost">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
