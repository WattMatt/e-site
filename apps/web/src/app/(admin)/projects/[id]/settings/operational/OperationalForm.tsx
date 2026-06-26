'use client'

import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import {
  workingDaysSchema,
  projectSettingsDefaults,
  type ProjectSettings,
} from '@esite/shared'
import { updateProjectSettingsAction } from '@/actions/project-settings.actions'
import { useDirtyForm } from '../_components/UnsavedChangesGuard'
import { StickySaveBar } from '../_components/StickySaveBar'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField, TextInput, Select, Textarea } from '@/components/ui/FormField'

// ─── Form schema (operational fields only) ───────────────────────────────────

const operationalFormSchema = z.object({
  workingDays: workingDaysSchema,
  holidayCalendar: z.string().min(1).max(64),
  buildersHoliday: z.boolean(),
  // extraHolidays stored as comma-separated textarea value — parsed on submit
  extraHolidaysRaw: z.string(),
  units: z.enum(['metric', 'imperial']),
  dateFormat: z.string().min(1).max(32),
  defaultRfiPriority: z.enum(['low', 'medium', 'high', 'critical']),
  defaultRfiAssigneeId: z.string(), // blank = null on submit
  defaultRfiDueDays: z.number().int().min(1),
})

type OperationalFormValues = z.infer<typeof operationalFormSchema>

// ─── Day chip data ────────────────────────────────────────────────────────────

const DAYS = [
  { v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' },
  { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 7, l: 'Sun' },
]

const DATE_FORMATS = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDefaultValues(initial: ProjectSettings | null): OperationalFormValues {
  const src = initial ?? projectSettingsDefaults
  return {
    workingDays: src.workingDays,
    holidayCalendar: src.holidayCalendar,
    buildersHoliday: src.buildersHoliday,
    extraHolidaysRaw: src.extraHolidays.join(', '),
    units: src.units,
    dateFormat: src.dateFormat,
    defaultRfiPriority: src.defaultRfiPriority,
    defaultRfiAssigneeId: src.defaultRfiAssigneeId ?? '',
    defaultRfiDueDays: src.defaultRfiDueDays,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface OperationalFormProps {
  projectId: string
  initial: ProjectSettings | null
}

export function OperationalForm({ projectId, initial }: OperationalFormProps) {
  const { markDirty, markClean } = useDirtyForm()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm<OperationalFormValues>({
    resolver: zodResolver(operationalFormSchema),
    defaultValues: buildDefaultValues(initial),
  })

  // Sync dirty state to the UnsavedChangesGuard context
  useEffect(() => {
    if (isDirty) {
      markDirty('operational')
    } else {
      markClean()
    }
  }, [isDirty, markDirty, markClean])

  const workingDays = watch('workingDays')

  async function onSubmit(values: OperationalFormValues) {
    setServerError(null)
    const extraHolidays = values.extraHolidaysRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    const patch = {
      workingDays: values.workingDays,
      holidayCalendar: values.holidayCalendar,
      buildersHoliday: values.buildersHoliday,
      extraHolidays,
      units: values.units,
      dateFormat: values.dateFormat,
      defaultRfiPriority: values.defaultRfiPriority,
      defaultRfiAssigneeId: values.defaultRfiAssigneeId.trim() || null,
      defaultRfiDueDays: values.defaultRfiDueDays,
    }

    // Validate extraHolidays format before sending
    const badDate = extraHolidays.find(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))
    if (badDate) {
      setServerError(`Invalid date format: "${badDate}". Use YYYY-MM-DD.`)
      return
    }

    const result = await updateProjectSettingsAction(projectId, patch)
    if ('error' in result) {
      setServerError(result.error)
      throw new Error(result.error) // so StickySaveBar shows error state
    }
    reset(buildDefaultValues(result.settings))
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

      {/* ── Calendar ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Calendar
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Working days chip toggle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-mid)', letterSpacing: '0.02em' }}>
                Working Days
                <span style={{ color: 'var(--c-amber)', marginLeft: 4 }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DAYS.map(d => (
                  <button
                    key={d.v}
                    type="button"
                    data-testid={`day-chip-${d.v}`}
                    aria-pressed={workingDays.includes(d.v)}
                    onClick={() => {
                      const next = workingDays.includes(d.v)
                        ? workingDays.filter(x => x !== d.v)
                        : [...workingDays, d.v].sort((a, b) => a - b)
                      setValue('workingDays', next, { shouldDirty: true })
                    }}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--c-border)',
                      background: workingDays.includes(d.v) ? 'var(--c-amber)' : 'transparent',
                      color: workingDays.includes(d.v) ? 'var(--c-text-on-amber)' : 'var(--c-text-mid)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    {d.l}
                  </button>
                ))}
              </div>
              {errors.workingDays && (
                <span role="alert" style={{ fontSize: 11, color: 'var(--c-red)' }}>
                  {errors.workingDays.message ?? 'At least one working day is required'}
                </span>
              )}
            </div>

            <FormField label="Holiday Calendar" error={errors.holidayCalendar?.message}
              hint="ISO 3166-1 alpha-2 country code, e.g. ZA">
              <TextInput
                {...register('holidayCalendar')}
                invalid={!!errors.holidayCalendar}
                placeholder="ZA"
              />
            </FormField>

            {/* Builders holiday checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Controller
                name="buildersHoliday"
                control={control}
                render={({ field }) => (
                  <input
                    type="checkbox"
                    id="buildersHoliday"
                    checked={field.value}
                    onChange={e => field.onChange(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--c-amber)', cursor: 'pointer' }}
                  />
                )}
              />
              <label
                htmlFor="buildersHoliday"
                style={{ fontSize: 13, color: 'var(--c-text-mid)', cursor: 'pointer' }}
              >
                Include builders holiday
              </label>
            </div>

            <FormField
              label="Extra Holidays"
              error={errors.extraHolidaysRaw?.message}
              hint="Comma-separated YYYY-MM-DD dates, e.g. 2025-12-25, 2026-01-01"
            >
              <Textarea
                {...register('extraHolidaysRaw')}
                invalid={!!errors.extraHolidaysRaw}
                placeholder="2025-12-25, 2026-01-01"
                rows={3}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      {/* ── RFI Defaults ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            RFI Defaults
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField label="Default Priority" error={errors.defaultRfiPriority?.message}>
              <Select
                {...register('defaultRfiPriority')}
                invalid={!!errors.defaultRfiPriority}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </FormField>

            <FormField
              label="Default Assignee ID"
              error={errors.defaultRfiAssigneeId?.message}
              hint="UUID of the default assignee, leave blank for none"
            >
              <TextInput
                {...register('defaultRfiAssigneeId')}
                invalid={!!errors.defaultRfiAssigneeId}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </FormField>

            <FormField label="Default Due Days" error={errors.defaultRfiDueDays?.message}>
              <TextInput
                type="number"
                min={1}
                {...register('defaultRfiDueDays', { valueAsNumber: true })}
                invalid={!!errors.defaultRfiDueDays}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      {/* ── General ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            General
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Units radio toggle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-mid)', letterSpacing: '0.02em' }}>
                Units
                <span style={{ color: 'var(--c-amber)', marginLeft: 4 }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['metric', 'imperial'] as const).map(opt => (
                  <label
                    key={opt}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--c-text-mid)' }}
                  >
                    <input
                      type="radio"
                      {...register('units')}
                      value={opt}
                      style={{ accentColor: 'var(--c-amber)' }}
                    />
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </label>
                ))}
              </div>
              {errors.units && (
                <span role="alert" style={{ fontSize: 11, color: 'var(--c-red)' }}>
                  {errors.units.message}
                </span>
              )}
            </div>

            <FormField label="Date Format" error={errors.dateFormat?.message}>
              <Select
                {...register('dateFormat')}
                invalid={!!errors.dateFormat}
              >
                {DATE_FORMATS.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </Select>
            </FormField>

          </div>
        </CardBody>
      </Card>

      {/* Hidden submit for programmatic/test use */}
      <button type="submit" style={{ display: 'none' }} aria-hidden="true" data-testid="submit-hidden" />

      <StickySaveBar
        isDirty={isDirty}
        onSave={handleSubmit(onSubmit)}
        onDiscard={() => reset(buildDefaultValues(initial))}
      />
    </form>
  )
}
