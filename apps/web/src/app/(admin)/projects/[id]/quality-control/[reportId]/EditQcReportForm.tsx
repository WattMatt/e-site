'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { updateQcReportAction } from '@/actions/qc.actions'
import { Button } from '@/components/ui/Button'

// ─── Form-local schema (reportId comes from props; matches updateQcReportSchema
//     field rules — title min 2, blank date treated as "no date") ─────────────

const formSchema = z.object({
  title: z.string().min(2, 'Title required').max(300),
  description: z.string().max(10000).optional(),
  location: z.string().max(500).optional(),
  inspectionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
})

type FormValues = z.infer<typeof formSchema>

interface Props {
  reportId: string
  defaultValues: {
    title: string
    description?: string
    location?: string
    inspectionDate?: string
  }
}

// ─── Inline field styles (VisitForm idiom) ───────────────────────────────────

const FIELD_LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
  marginBottom: 6,
  textTransform: 'uppercase',
}

const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--c-panel-deep)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--c-text)',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const FIELD_ERROR: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--c-red)',
  marginTop: 4,
}

/**
 * Inline edit of the report's own metadata (title / description / location /
 * inspection date) via updateQcReportAction — the snags VisitForm edit-mode
 * pattern, collapsed to an "Edit report" toggle. The parent only renders this
 * for QC_WRITE_ROLES on non-closed reports (the action re-gates server-side).
 */
export function EditQcReportForm({ reportId, defaultValues }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: defaultValues.title,
      description: defaultValues.description ?? '',
      location: defaultValues.location ?? '',
      inspectionDate: defaultValues.inspectionDate ?? '',
    },
  })

  function close() {
    setOpen(false)
    setServerError(null)
    reset()
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const result = await updateQcReportAction({
      reportId,
      title: values.title,
      description: values.description || undefined,
      location: values.location || undefined,
      inspectionDate: values.inspectionDate || undefined,
    })
    if (result.error) {
      setServerError(result.error)
      return
    }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          ✎ Edit report
        </Button>
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border-mid)',
        borderRadius: 8,
        padding: '20px 24px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--c-text-mid)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Edit report
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 16, padding: 4, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div>
          <label style={FIELD_LABEL} htmlFor="qc_edit_title">Title</label>
          <input id="qc_edit_title" type="text" style={FIELD_INPUT} {...register('title')} />
          {errors.title && <p style={FIELD_ERROR}>{errors.title.message}</p>}
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={FIELD_LABEL} htmlFor="qc_edit_description">Description</label>
          <textarea
            id="qc_edit_description"
            rows={3}
            style={{ ...FIELD_INPUT, resize: 'vertical' }}
            {...register('description')}
          />
          {errors.description && <p style={FIELD_ERROR}>{errors.description.message}</p>}
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
          <div style={{ flex: '2 1 200px' }}>
            <label style={FIELD_LABEL} htmlFor="qc_edit_location">Location</label>
            <input
              id="qc_edit_location"
              type="text"
              placeholder="e.g. Level 3 — east wing"
              style={FIELD_INPUT}
              {...register('location')}
            />
            {errors.location && <p style={FIELD_ERROR}>{errors.location.message}</p>}
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={FIELD_LABEL} htmlFor="qc_edit_inspection_date">Inspection date</label>
            <input id="qc_edit_inspection_date" type="date" style={FIELD_INPUT} {...register('inspectionDate')} />
            {errors.inspectionDate && <p style={FIELD_ERROR}>{errors.inspectionDate.message}</p>}
          </div>
        </div>

        {serverError && (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)', border: '1px solid var(--c-red)', borderRadius: 6, padding: '8px 12px' }}>
            {serverError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
