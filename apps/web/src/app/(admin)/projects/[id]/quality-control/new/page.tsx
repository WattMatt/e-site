'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createQcReportSchema, type CreateQcReportInput } from '@esite/shared'
import { createQcReportAction } from '@/actions/qc.actions'
import Link from 'next/link'

interface Props { params: Promise<{ id: string }> }

export default function NewQcReportPage({ params }: Props) {
  const { id: projectId } = use(params)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateQcReportInput>({
    resolver: zodResolver(createQcReportSchema),
    defaultValues: { projectId },
  })

  async function onSubmit(input: CreateQcReportInput) {
    setError(null)
    const res = await createQcReportAction(input)
    if (res.error || !res.reportId) {
      setError(res.error ?? 'Failed to create report')
      return
    }
    router.push(`/projects/${projectId}/quality-control/${res.reportId}`)
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/quality-control`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Quality Control
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">New QC Report</h1>
          <p className="page-subtitle">Group photos and drawing markups, comment, then issue as a versioned PDF</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Report</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="ob-label">Title *</label>
              <input className="ob-input" {...register('title')} autoFocus placeholder="e.g. First-fix conduits — Level 2" />
              {errors.title && <p className="ob-error">{errors.title.message}</p>}
            </div>
            <div>
              <label className="ob-label">Description</label>
              <textarea className="ob-input" rows={3} style={{ resize: 'none' }} {...register('description')} placeholder="Scope, context, what was inspected…" />
              {errors.description && <p className="ob-error">{errors.description.message}</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="ob-label">Location</label>
                <input className="ob-input" {...register('location')} placeholder="e.g. DB Room, Level 2" />
                {errors.location && <p className="ob-error">{errors.location.message}</p>}
              </div>
              <div>
                <label className="ob-label">Inspection date</label>
                <input className="ob-input" type="date" {...register('inspectionDate')} />
                {errors.inspectionDate && <p className="ob-error">{errors.inspectionDate.message}</p>}
              </div>
            </div>
          </div>
        </div>

        {error && <p className="ob-error" role="alert">{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn-primary-amber" style={{ flex: 1 }} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Create Report'}
          </button>
          <Link
            href={`/projects/${projectId}/quality-control`}
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
