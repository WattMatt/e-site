'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { saveGcrSettingsAction } from './gcr.actions'
import { gcrSettingsSchema, type GcrSettingsInput } from './gcr.schemas'
import { useDirtyForm } from '../settings/_components/UnsavedChangesGuard'
import { StickySaveBar } from '../settings/_components/StickySaveBar'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField, TextInput } from '@/components/ui/FormField'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SettingsLike {
  standard_kw_per_sqm?:             number | null
  fast_food_kw_per_sqm?:            number | null
  restaurant_kw_per_sqm?:           number | null
  national_kw_per_sqm?:             number | null
  capital_recovery_period_years?:   number | null
  capital_recovery_rate_percent?:   number | null
  rate_per_tenant_db?:              number | null
  num_main_boards?:                 number | null
  rate_per_main_board?:             number | null
  additional_cabling_cost?:         number | null
  control_wiring_cost?:             number | null
  diesel_cost_per_litre?:           number | null
  running_hours_per_month?:         number | null
  maintenance_cost_annual?:         number | null
  power_factor?:                    number | null
  running_load_percentage?:         number | null
  maintenance_contingency_percent?: number | null
}

function buildDefaultValues(s: SettingsLike | null): GcrSettingsInput {
  return {
    standard_kw_per_sqm:             s?.standard_kw_per_sqm             ?? 0.03,
    fast_food_kw_per_sqm:            s?.fast_food_kw_per_sqm            ?? 0.045,
    restaurant_kw_per_sqm:           s?.restaurant_kw_per_sqm           ?? 0.045,
    national_kw_per_sqm:             s?.national_kw_per_sqm             ?? 0.03,
    capital_recovery_period_years:   s?.capital_recovery_period_years   ?? 10,
    capital_recovery_rate_percent:   s?.capital_recovery_rate_percent   ?? 12,
    rate_per_tenant_db:              s?.rate_per_tenant_db              ?? 23,
    num_main_boards:                 s?.num_main_boards                 ?? 0,
    rate_per_main_board:             s?.rate_per_main_board             ?? 18800,
    additional_cabling_cost:         s?.additional_cabling_cost         ?? 0,
    control_wiring_cost:             s?.control_wiring_cost             ?? 0,
    diesel_cost_per_litre:           s?.diesel_cost_per_litre           ?? 0,
    running_hours_per_month:         s?.running_hours_per_month         ?? 0,
    maintenance_cost_annual:         s?.maintenance_cost_annual         ?? 0,
    power_factor:                    s?.power_factor                    ?? 0.95,
    running_load_percentage:         s?.running_load_percentage         ?? 75,
    maintenance_contingency_percent: s?.maintenance_contingency_percent ?? 10,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface SettingsFormProps {
  projectId: string
  settings:  SettingsLike | null
}

export function SettingsForm({ projectId, settings }: SettingsFormProps) {
  const { markDirty, markClean } = useDirtyForm()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<GcrSettingsInput>({
    resolver: zodResolver(gcrSettingsSchema),
    defaultValues: buildDefaultValues(settings),
  })

  useEffect(() => {
    if (isDirty) {
      markDirty('gcr-settings')
    } else {
      markClean()
    }
  }, [isDirty, markDirty, markClean])

  async function onSubmit(values: GcrSettingsInput) {
    setServerError(null)
    const result = await saveGcrSettingsAction(projectId, values)
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

      {/* ── Loading rates ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Loading rates
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            kW per m² by tenant category
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField
              label="Standard (kW/m²)"
              required
              error={errors.standard_kw_per_sqm?.message}
            >
              <TextInput
                {...register('standard_kw_per_sqm')}
                type="number"
                step="0.001"
                invalid={!!errors.standard_kw_per_sqm}
              />
            </FormField>

            <FormField
              label="Fast food (kW/m²)"
              required
              error={errors.fast_food_kw_per_sqm?.message}
            >
              <TextInput
                {...register('fast_food_kw_per_sqm')}
                type="number"
                step="0.001"
                invalid={!!errors.fast_food_kw_per_sqm}
              />
            </FormField>

            <FormField
              label="Restaurant (kW/m²)"
              required
              error={errors.restaurant_kw_per_sqm?.message}
            >
              <TextInput
                {...register('restaurant_kw_per_sqm')}
                type="number"
                step="0.001"
                invalid={!!errors.restaurant_kw_per_sqm}
              />
            </FormField>

            <FormField
              label="National (kW/m²)"
              required
              error={errors.national_kw_per_sqm?.message}
            >
              <TextInput
                {...register('national_kw_per_sqm')}
                type="number"
                step="0.001"
                invalid={!!errors.national_kw_per_sqm}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      {/* ── Capital ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Capital
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Capital recovery parameters and infrastructure costs
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField
              label="Recovery period (years)"
              required
              error={errors.capital_recovery_period_years?.message}
            >
              <TextInput
                {...register('capital_recovery_period_years')}
                type="number"
                step="1"
                invalid={!!errors.capital_recovery_period_years}
              />
            </FormField>

            <FormField
              label="Recovery rate (%)"
              required
              error={errors.capital_recovery_rate_percent?.message}
            >
              <TextInput
                {...register('capital_recovery_rate_percent')}
                type="number"
                step="0.01"
                invalid={!!errors.capital_recovery_rate_percent}
              />
            </FormField>

            <FormField
              label="Rate per tenant DB (R)"
              required
              error={errors.rate_per_tenant_db?.message}
            >
              <TextInput
                {...register('rate_per_tenant_db')}
                type="number"
                step="0.01"
                invalid={!!errors.rate_per_tenant_db}
              />
            </FormField>

            <FormField
              label="Number of main boards"
              required
              error={errors.num_main_boards?.message}
            >
              <TextInput
                {...register('num_main_boards')}
                type="number"
                step="1"
                invalid={!!errors.num_main_boards}
              />
            </FormField>

            <FormField
              label="Rate per main board (R)"
              required
              error={errors.rate_per_main_board?.message}
            >
              <TextInput
                {...register('rate_per_main_board')}
                type="number"
                step="0.01"
                invalid={!!errors.rate_per_main_board}
              />
            </FormField>

            <FormField
              label="Additional cabling cost (R)"
              required
              error={errors.additional_cabling_cost?.message}
            >
              <TextInput
                {...register('additional_cabling_cost')}
                type="number"
                step="0.01"
                invalid={!!errors.additional_cabling_cost}
              />
            </FormField>

            <FormField
              label="Control wiring cost (R)"
              required
              error={errors.control_wiring_cost?.message}
            >
              <TextInput
                {...register('control_wiring_cost')}
                type="number"
                step="0.01"
                invalid={!!errors.control_wiring_cost}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      {/* ── Operational ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Operational
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Running costs, power parameters, and contingency
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField
              label="Diesel cost per litre (R)"
              required
              error={errors.diesel_cost_per_litre?.message}
            >
              <TextInput
                {...register('diesel_cost_per_litre')}
                type="number"
                step="0.01"
                invalid={!!errors.diesel_cost_per_litre}
              />
            </FormField>

            <FormField
              label="Running hours per month"
              required
              error={errors.running_hours_per_month?.message}
            >
              <TextInput
                {...register('running_hours_per_month')}
                type="number"
                step="0.1"
                invalid={!!errors.running_hours_per_month}
              />
            </FormField>

            <FormField
              label="Maintenance cost per year (R)"
              required
              error={errors.maintenance_cost_annual?.message}
            >
              <TextInput
                {...register('maintenance_cost_annual')}
                type="number"
                step="0.01"
                invalid={!!errors.maintenance_cost_annual}
              />
            </FormField>

            <FormField
              label="Power factor"
              required
              error={errors.power_factor?.message}
              hint="0 – 100 (e.g. 0.95 → enter 0.95)"
            >
              <TextInput
                {...register('power_factor')}
                type="number"
                step="0.01"
                invalid={!!errors.power_factor}
              />
            </FormField>

            <FormField
              label="Running load (%)"
              required
              error={errors.running_load_percentage?.message}
            >
              <TextInput
                {...register('running_load_percentage')}
                type="number"
                step="0.1"
                invalid={!!errors.running_load_percentage}
              />
            </FormField>

            <FormField
              label="Maintenance contingency (%)"
              required
              error={errors.maintenance_contingency_percent?.message}
            >
              <TextInput
                {...register('maintenance_contingency_percent')}
                type="number"
                step="0.1"
                invalid={!!errors.maintenance_contingency_percent}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      <button type="submit" style={{ display: 'none' }} aria-hidden="true" data-testid="submit-hidden" />

      <StickySaveBar
        isDirty={isDirty}
        onSave={handleSubmit(onSubmit)}
        onDiscard={() => reset(buildDefaultValues(settings))}
      />
    </form>
  )
}
