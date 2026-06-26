'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import {
  projectSettingsDefaults,
  type ProjectSettings,
} from '@esite/shared'
import { updateContractAction } from '@/actions/project-settings.actions'
import { useDirtyForm } from '../_components/UnsavedChangesGuard'
import { StickySaveBar } from '../_components/StickySaveBar'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField, TextInput, Select } from '@/components/ui/FormField'

// ─── Currency options (ZAR first per trading preferences) ────────────────────

const CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP'] as const

// ─── Contract type labels ─────────────────────────────────────────────────────

const CONTRACT_TYPE_OPTIONS = [
  { value: 'jbcc_pba',  label: 'JBCC PBA' },
  { value: 'jbcc_mwa',  label: 'JBCC MWA' },
  { value: 'nec3',      label: 'NEC3' },
  { value: 'nec4',      label: 'NEC4' },
  { value: 'fidic_red', label: 'FIDIC Red Book' },
  { value: 'custom',    label: 'Custom' },
  { value: 'none',      label: 'None' },
] as const

// ─── Form schema ──────────────────────────────────────────────────────────────

const contractFormSchema = z.object({
  // From projects.projects:
  contractValue: z.number().nonnegative().nullable(),
  currency: z.string().max(8).nullable(),
  // From project_settings:
  contractType: z.enum(['jbcc_pba', 'jbcc_mwa', 'nec3', 'nec4', 'fidic_red', 'custom', 'none']),
  contractSignedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable(),
  practicalCompletionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable(),
  retentionPct: z.number().min(0).max(100),
})

type ContractFormValues = z.infer<typeof contractFormSchema>

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  project: { contractValue: number | null; currency: string | null } | null
  settings: ProjectSettings | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDefaultValues(
  project: Props['project'],
  settings: ProjectSettings | null,
): ContractFormValues {
  const src = settings ?? projectSettingsDefaults
  return {
    contractValue: project?.contractValue ?? null,
    currency: project?.currency ?? null,
    contractType: src.contractType,
    contractSignedDate: src.contractSignedDate,
    practicalCompletionDate: src.practicalCompletionDate,
    retentionPct: src.retentionPct,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContractForm({ projectId, project, settings }: Props) {
  const { markDirty, markClean } = useDirtyForm()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues: buildDefaultValues(project, settings),
  })

  // Sync dirty state to the UnsavedChangesGuard context
  useEffect(() => {
    if (isDirty) {
      markDirty('contract')
    } else {
      markClean()
    }
  }, [isDirty, markDirty, markClean])

  async function onSubmit(values: ContractFormValues) {
    setServerError(null)

    // One action writes both tables (sequenced; reverts the projects write if
    // the settings write fails) so the contract figures never end up split.
    const result = await updateContractAction(projectId, {
      contractValue: values.contractValue,
      currency: values.currency,
      contractType: values.contractType,
      contractSignedDate: values.contractSignedDate || null,
      practicalCompletionDate: values.practicalCompletionDate || null,
      retentionPct: values.retentionPct,
    })

    if ('error' in result) {
      setServerError(result.error)
      throw new Error(result.error) // so StickySaveBar shows error state
    }

    // Both succeeded — reset to committed state.
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

      {/* ── Card 1: Contract terms ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Contract terms
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField label="Contract type" error={errors.contractType?.message}>
              <Select
                {...register('contractType')}
                invalid={!!errors.contractType}
              >
                {CONTRACT_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Contract value"
              error={errors.contractValue?.message}
              hint="Numeric value without currency symbol"
            >
              <TextInput
                type="number"
                min={0}
                step="0.01"
                {...register('contractValue', { valueAsNumber: true })}
                invalid={!!errors.contractValue}
                placeholder="0.00"
              />
            </FormField>

            <FormField label="Currency" error={errors.currency?.message}>
              <Select
                {...register('currency')}
                invalid={!!errors.currency}
              >
                <option value="">— select —</option>
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Retention %"
              error={errors.retentionPct?.message}
              hint="0–100"
            >
              <TextInput
                type="number"
                min={0}
                max={100}
                step="0.01"
                {...register('retentionPct', { valueAsNumber: true })}
                invalid={!!errors.retentionPct}
                placeholder="5"
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      {/* ── Card 2: Dates ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Dates
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField
              label="Contract signed date"
              error={errors.contractSignedDate?.message}
            >
              <TextInput
                type="date"
                {...register('contractSignedDate')}
                invalid={!!errors.contractSignedDate}
              />
            </FormField>

            <FormField
              label="Practical completion date"
              error={errors.practicalCompletionDate?.message}
            >
              <TextInput
                type="date"
                {...register('practicalCompletionDate')}
                invalid={!!errors.practicalCompletionDate}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      {/* Hidden submit for programmatic/test use */}
      <button type="submit" style={{ display: 'none' }} aria-hidden="true" data-testid="submit-hidden" />

      <StickySaveBar
        isDirty={isDirty}
        onSave={handleSubmit(onSubmit)}
        onDiscard={() => reset(buildDefaultValues(project, settings))}
      />
    </form>
  )
}
