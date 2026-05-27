'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { updateProjectAction } from '@/actions/project.actions'
import { useDirtyForm } from '../_components/UnsavedChangesGuard'
import { StickySaveBar } from '../_components/StickySaveBar'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField, TextInput, Select, Textarea } from '@/components/ui/FormField'

// ─── Schema ───────────────────────────────────────────────────────────────────

const generalFormSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(120),
  description: z.string().max(2000).optional(),
  code: z.string().max(64).optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']),
})

type GeneralFormValues = z.infer<typeof generalFormSchema>

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = [
  { value: 'planning',  label: 'Planning' },
  { value: 'active',    label: 'Active' },
  { value: 'on_hold',   label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ProjectLike {
  name?: string | null
  description?: string | null
  code?: string | null
  status?: string | null
}

function buildDefaultValues(initial: ProjectLike | null): GeneralFormValues {
  return {
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    code: initial?.code ?? '',
    status: (initial?.status as GeneralFormValues['status']) ?? 'active',
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface GeneralFormProps {
  projectId: string
  initial: ProjectLike | null
}

export function GeneralForm({ projectId, initial }: GeneralFormProps) {
  const { markDirty, markClean } = useDirtyForm()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<GeneralFormValues>({
    resolver: zodResolver(generalFormSchema),
    defaultValues: buildDefaultValues(initial),
  })

  useEffect(() => {
    if (isDirty) {
      markDirty('general')
    } else {
      markClean()
    }
  }, [isDirty, markDirty, markClean])

  async function onSubmit(values: GeneralFormValues) {
    setServerError(null)
    const result = await updateProjectAction(projectId, {
      name: values.name,
      description: values.description || null,
      code: values.code || null,
      status: values.status,
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
            background: 'rgba(232,85,85,0.08)',
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
            General
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Project name, description, short code, and status
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField
              label="Project Name"
              required
              error={errors.name?.message}
            >
              <TextInput
                {...register('name')}
                invalid={!!errors.name}
                placeholder="e.g. Sandton Towers Phase 2"
              />
            </FormField>

            <FormField
              label="Description"
              error={errors.description?.message}
              hint="Optional. Visible to all project members."
            >
              <Textarea
                {...register('description')}
                invalid={!!errors.description}
                placeholder="Short description of the project scope"
                rows={3}
              />
            </FormField>

            <FormField
              label="Project Code"
              error={errors.code?.message}
              hint="Optional short identifier used in reports (e.g. STP-2024)"
            >
              <TextInput
                {...register('code')}
                invalid={!!errors.code}
                placeholder="e.g. STP-2024"
              />
            </FormField>

            <FormField label="Status" error={errors.status?.message}>
              <Select {...register('status')} invalid={!!errors.status}>
                {STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
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
