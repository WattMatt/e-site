'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { updateProjectAction } from '@/actions/project.actions'
import { useDirtyForm } from '../_components/UnsavedChangesGuard'
import { StickySaveBar } from '../_components/StickySaveBar'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'

// ─── Schema ───────────────────────────────────────────────────────────────────

const datesFormSchema = z.object({
  // Date inputs return '' when empty, or a YYYY-MM-DD string.
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}).refine(
  data => {
    if (!data.startDate || !data.endDate) return true
    return data.startDate <= data.endDate
  },
  { message: 'End date must be on or after start date', path: ['endDate'] },
)

type DatesFormValues = z.infer<typeof datesFormSchema>

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ProjectLike {
  startDate?: string | null
  start_date?: string | null
  endDate?: string | null
  end_date?: string | null
}

function buildDefaultValues(initial: ProjectLike | null): DatesFormValues {
  return {
    startDate: initial?.startDate ?? initial?.start_date ?? '',
    endDate: initial?.endDate ?? initial?.end_date ?? '',
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface DatesFormProps {
  projectId: string
  initial: ProjectLike | null
}

export function DatesForm({ projectId, initial }: DatesFormProps) {
  const { markDirty, markClean } = useDirtyForm()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<DatesFormValues>({
    resolver: zodResolver(datesFormSchema),
    defaultValues: buildDefaultValues(initial),
  })

  useEffect(() => {
    if (isDirty) {
      markDirty('dates')
    } else {
      markClean()
    }
  }, [isDirty, markDirty, markClean])

  async function onSubmit(values: DatesFormValues) {
    setServerError(null)
    const result = await updateProjectAction(projectId, {
      startDate: values.startDate || null,
      endDate: values.endDate || null,
    })
    if ('error' in result) {
      setServerError(result.error)
      throw new Error(result.error)
    }
    reset(values)
    markClean()
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {serverError && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
            color: 'var(--c-red)',
            fontSize: 13,
          }}
        >
          {serverError}
        </div>
      )}

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Project Dates
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Planned start and end dates for the project
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField
              label="Start Date"
              error={errors.startDate?.message}
              hint="Leave blank if not yet confirmed"
            >
              <input
                type="date"
                {...register('startDate')}
                aria-invalid={!!errors.startDate}
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  border: errors.startDate
                    ? '1px solid var(--c-red)'
                    : '1px solid var(--c-border)',
                  borderRadius: 4,
                  background: 'var(--c-input-bg)',
                  color: 'var(--c-text)',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </FormField>

            <FormField
              label="End Date"
              error={errors.endDate?.message}
              hint="Leave blank if not yet confirmed"
            >
              <input
                type="date"
                {...register('endDate')}
                aria-invalid={!!errors.endDate}
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  border: errors.endDate
                    ? '1px solid var(--c-red)'
                    : '1px solid var(--c-border)',
                  borderRadius: 4,
                  background: 'var(--c-input-bg)',
                  color: 'var(--c-text)',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      <button type="submit" style={{ display: 'none' }} aria-hidden="true" data-testid="submit-hidden" />

      <StickySaveBar
        isDirty={isDirty}
        onSave={handleSubmit(onSubmit)}
        onDiscard={() => reset(buildDefaultValues(initial))}
      />
    </form>
  )
}
