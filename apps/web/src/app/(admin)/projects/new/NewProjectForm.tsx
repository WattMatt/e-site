'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createProjectSchema, type CreateProjectInput } from '@esite/shared'
import { createProjectAction } from '@/actions/project.actions'
import Link from 'next/link'

const PROVINCES = [
  'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
  'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
]

const STATUSES: { value: CreateProjectInput['status']; label: string }[] = [
  { value: 'planning',  label: 'Planning' },
  { value: 'active',    label: 'Active' },
  { value: 'on_hold',   label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function NewProjectForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { status: 'active' },
  })

  async function onSubmit(input: CreateProjectInput) {
    setError(null)
    // Server action handles auth + tier gate + insert + project_members +
    // conversion-prompt nudge + revalidation. If a user races past the
    // server-rendered paywall (via direct API call or stale tab), the gate
    // here is the canonical enforcement and returns code='paywall'.
    const result = await createProjectAction(input)

    if ('error' in result) {
      if (result.code === 'paywall') {
        router.push('/projects/new')
        router.refresh()
        return
      }
      setError(result.error)
      return
    }

    router.push(`/projects/${result.projectId}`)
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/projects"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Projects
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">New Project</h1>
          <p className="page-subtitle">Create a project to start tracking snags, RFIs and compliance</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Basic Info</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="ob-label">Project Name *</label>
              <input className="ob-input" {...register('name')} placeholder="Sandton Office Block" />
              {errors.name && <p className="ob-error">{errors.name.message}</p>}
            </div>
            <div>
              <label className="ob-label">Description</label>
              <textarea className="ob-input" rows={3} style={{ resize: 'none' }} {...register('description')} placeholder="Short project description…" />
              {errors.description && <p className="ob-error">{errors.description.message}</p>}
            </div>
            <div>
              <label className="ob-label">Status</label>
              <select className="ob-select" {...register('status')}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {errors.status && <p className="ob-error">{errors.status.message}</p>}
            </div>
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Location</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="ob-label">Address</label>
              <input className="ob-input" {...register('address')} placeholder="1 Main St" />
              {errors.address && <p className="ob-error">{errors.address.message}</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="ob-label">City</label>
                <input className="ob-input" {...register('city')} placeholder="Johannesburg" />
                {errors.city && <p className="ob-error">{errors.city.message}</p>}
              </div>
              <div>
                <label className="ob-label">Province</label>
                <select className="ob-select" {...register('province')}>
                  <option value="">Select…</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {errors.province && <p className="ob-error">{errors.province.message}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Client &amp; Contract</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="ob-label">Client Name</label>
              <input className="ob-input" {...register('clientName')} placeholder="ACME Properties (Pty) Ltd" />
              {errors.clientName && <p className="ob-error">{errors.clientName.message}</p>}
            </div>
            <div>
              <label className="ob-label">Client Contact</label>
              <input className="ob-input" {...register('clientContact')} placeholder="Jane Smith · jane@acme.co.za" />
              {errors.clientContact && <p className="ob-error">{errors.clientContact.message}</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label className="ob-label">Contract Value (R)</label>
                <input className="ob-input" type="number" min="0" step="0.01" {...register('contractValue', { valueAsNumber: true })} placeholder="1500000" />
                {errors.contractValue && <p className="ob-error">{errors.contractValue.message}</p>}
              </div>
              <div>
                <label className="ob-label">Start Date</label>
                <input className="ob-input" type="date" {...register('startDate')} />
                {errors.startDate && <p className="ob-error">{errors.startDate.message}</p>}
              </div>
              <div>
                <label className="ob-label">End Date</label>
                <input className="ob-input" type="date" {...register('endDate')} />
                {errors.endDate && <p className="ob-error">{errors.endDate.message}</p>}
              </div>
            </div>
          </div>
        </div>

        {error && <p className="ob-error" role="alert">{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn-primary-amber" style={{ flex: 1 }} disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create Project'}
          </button>
          <Link
            href="/projects"
            className="btn-primary-amber"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 16px',
            }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
