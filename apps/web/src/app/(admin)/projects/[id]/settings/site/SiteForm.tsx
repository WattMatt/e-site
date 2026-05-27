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

const siteFormSchema = z.object({
  address: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
})

type SiteFormValues = z.infer<typeof siteFormSchema>

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVINCES = [
  'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
  'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ProjectLike {
  address?: string | null
  city?: string | null
  province?: string | null
}

function buildDefaultValues(initial: ProjectLike | null): SiteFormValues {
  return {
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    province: initial?.province ?? '',
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface SiteFormProps {
  projectId: string
  initial: ProjectLike | null
}

export function SiteForm({ projectId, initial }: SiteFormProps) {
  const { markDirty, markClean } = useDirtyForm()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<SiteFormValues>({
    resolver: zodResolver(siteFormSchema),
    defaultValues: buildDefaultValues(initial),
  })

  useEffect(() => {
    if (isDirty) {
      markDirty('site')
    } else {
      markClean()
    }
  }, [isDirty, markDirty, markClean])

  async function onSubmit(values: SiteFormValues) {
    setServerError(null)
    const result = await updateProjectAction(projectId, {
      address: values.address || null,
      city: values.city || null,
      province: values.province || null,
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
            Site Location
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Physical address of the project site
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField
              label="Street Address"
              error={errors.address?.message}
            >
              <Textarea
                {...register('address')}
                invalid={!!errors.address}
                placeholder="123 Main Street, Block A"
                rows={2}
              />
            </FormField>

            <FormField label="City" error={errors.city?.message}>
              <TextInput
                {...register('city')}
                invalid={!!errors.city}
                placeholder="e.g. Johannesburg"
              />
            </FormField>

            <FormField label="Province" error={errors.province?.message}>
              <Select {...register('province')} invalid={!!errors.province}>
                <option value="">— Select province —</option>
                {PROVINCES.map(p => (
                  <option key={p} value={p}>{p}</option>
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
