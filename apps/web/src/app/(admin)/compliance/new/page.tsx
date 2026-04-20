import { createSiteAction } from '@/actions/compliance.actions'
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
    <div className="animate-fadeup" style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/compliance"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Compliance
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Add Compliance Site</h1>
          <p className="page-subtitle">Create a new site to track COC status across its subsections.</p>
        </div>
      </div>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <form action={createSiteAction as any} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="data-panel">
          <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label htmlFor="name" className="ob-label">
                Site name <span style={{ color: 'var(--c-red)' }}>*</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                placeholder="e.g. Sandton City Phase 3"
                className="ob-input"
              />
            </div>

            <div>
              <label htmlFor="address" className="ob-label">
                Street address <span style={{ color: 'var(--c-red)' }}>*</span>
              </label>
              <input
                id="address"
                name="address"
                type="text"
                required
                placeholder="e.g. 7 Alice Lane, Sandton"
                className="ob-input"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="city" className="ob-label">City</label>
                <input
                  id="city"
                  name="city"
                  type="text"
                  placeholder="e.g. Johannesburg"
                  className="ob-input"
                />
              </div>
              <div>
                <label htmlFor="province" className="ob-label">Province</label>
                <select id="province" name="province" className="ob-select">
                  <option value="">Select province</option>
                  {SA_PROVINCES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="erf_number" className="ob-label">ERF / Stand number</label>
                <input
                  id="erf_number"
                  name="erf_number"
                  type="text"
                  placeholder="e.g. ERF 1234"
                  className="ob-input"
                />
              </div>
              <div>
                <label htmlFor="site_type" className="ob-label">Site type</label>
                <select id="site_type" name="site_type" className="ob-select">
                  {SITE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn-primary-amber" style={{ padding: '9px 18px' }}>
            Create site
          </button>
          <Link
            href="/compliance"
            className="btn-primary-amber"
            style={{
              padding: '9px 18px',
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
            }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
