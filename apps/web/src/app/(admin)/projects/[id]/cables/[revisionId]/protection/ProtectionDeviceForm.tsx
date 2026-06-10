'use client'

/**
 * Add / edit a protection device (cable_schedule.protection_devices). Same
 * settings-form pattern as FaultSourceForm / GeneralForm: react-hook-form +
 * zodResolver + Card/FormField + StickySaveBar, with upsertProtectionDevice
 * re-validating server-side via the shared Zod schema.
 *
 * The parametric IDMT settings (std / curve / pickup / tms|td|dt) are folded
 * into the `settings` JSONB the engine reads. Curve options are derived from
 * the engine's IEC_CONSTANTS / IEEE_CONSTANTS keys (never hardcoded), and the
 * timing field switches on the chosen standard (IEC→TMS, IEEE→TD, DT→delay).
 */

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { upsertProtectionDevice } from '@/actions/mv-protection.actions'
import {
  DEVICE_ROLES,
  DEVICE_TYPES,
  IEC_CONSTANTS,
  IEEE_CONSTANTS,
  type DeviceRole,
  type DeviceType,
  type ProtectionDeviceInput,
  type ProtectionDeviceSettings,
} from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField, TextInput, Select } from '@/components/ui/FormField'
import { StickySaveBar } from '../../../settings/_components/StickySaveBar'

const STDS = ['IEC', 'IEEE', 'DT'] as const
const IEC_CURVES = Object.keys(IEC_CONSTANTS) as Array<keyof typeof IEC_CONSTANTS>
const IEEE_CURVES = Object.keys(IEEE_CONSTANTS) as Array<keyof typeof IEEE_CONSTANTS>

const formSchema = z.object({
  attach: z.string().min(1, 'Pick the node and/or feeder this device protects'),
  deviceRole: z.enum(DEVICE_ROLES),
  deviceType: z.enum(DEVICE_TYPES),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  frameRatingA: z.string().optional(),
  curveRef: z.string().optional(),
  // settings (parametric IDMT / definite-time)
  std: z.enum(STDS),
  curve: z.string().optional(),
  pickupA: z.string().optional(),
  tms: z.string().optional(),
  td: z.string().optional(),
  dtS: z.string().optional(),
  instMultiple: z.string().optional(),
  instTimeS: z.string().optional(),
})
type FormValues = z.infer<typeof formSchema>

export interface AttachOption {
  key: string // "node:<id>" | "supply:<id>"
  label: string
}

export interface ExistingDevice {
  id: string
  nodeId: string | null
  supplyId: string | null
  deviceRole: DeviceRole
  deviceType: DeviceType
  manufacturer: string | null
  model: string | null
  frameRatingA: number | null
  curveRef: string | null
  settings: ProtectionDeviceSettings
}

interface Props {
  revisionId: string
  attachOptions: AttachOption[]
  initial?: ExistingDevice | null
  locked?: boolean
  onSaved?: () => void
}

const numStr = (v: number | null | undefined) => (v == null ? '' : String(v))
const toNum = (s: string | undefined): number | undefined => {
  if (s == null || s.trim() === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function buildDefaults(initial: ExistingDevice | null | undefined): FormValues {
  const s = initial?.settings ?? {}
  const attach = initial?.nodeId
    ? `node:${initial.nodeId}`
    : initial?.supplyId
      ? `supply:${initial.supplyId}`
      : ''
  const std = (s.std === 'IEEE' || s.std === 'DT' ? s.std : 'IEC') as (typeof STDS)[number]
  return {
    attach,
    deviceRole: initial?.deviceRole ?? 'feeder',
    deviceType: initial?.deviceType ?? 'relay',
    manufacturer: initial?.manufacturer ?? '',
    model: initial?.model ?? '',
    frameRatingA: numStr(initial?.frameRatingA),
    curveRef: initial?.curveRef ?? '',
    std,
    curve: s.curve ?? '',
    pickupA: numStr(s.pickupA),
    tms: numStr(s.tms),
    td: numStr(s.td),
    dtS: numStr(s.dtS),
    instMultiple: numStr(s.instMultiple),
    instTimeS: numStr(s.instTimeS),
  }
}

export function ProtectionDeviceForm({ revisionId, attachOptions, initial, locked, onSaved }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: buildDefaults(initial),
  })

  useEffect(() => {
    reset(buildDefaults(initial))
  }, [initial, reset])

  const std = watch('std')

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const [kind, id] = values.attach.split(':')

    // Fold the timing fields into the settings JSONB. Only carry the fields
    // relevant to the chosen standard; high-set (50) is optional across all.
    const settings: ProtectionDeviceSettings = {
      std: values.std,
      ...(values.std !== 'DT' && values.curve ? { curve: values.curve } : {}),
      ...(toNum(values.pickupA) != null ? { pickupA: toNum(values.pickupA) } : {}),
      ...(values.std === 'IEC' && toNum(values.tms) != null ? { tms: toNum(values.tms) } : {}),
      ...(values.std === 'IEEE' && toNum(values.td) != null ? { td: toNum(values.td) } : {}),
      ...(values.std === 'DT' && toNum(values.dtS) != null ? { dtS: toNum(values.dtS) } : {}),
      ...(toNum(values.instMultiple) != null ? { instMultiple: toNum(values.instMultiple) } : {}),
      ...(toNum(values.instTimeS) != null ? { instTimeS: toNum(values.instTimeS) } : {}),
    }

    const input: ProtectionDeviceInput = {
      revisionId,
      nodeId: kind === 'node' ? id! : null,
      supplyId: kind === 'supply' ? id! : null,
      deviceRole: values.deviceRole,
      deviceType: values.deviceType,
      manufacturer: values.manufacturer?.trim() || null,
      model: values.model?.trim() || null,
      frameRatingA: toNum(values.frameRatingA) ?? null,
      curveRef: values.curveRef?.trim() || null,
      settings,
    }

    const result = await upsertProtectionDevice(input, initial?.id)
    if ('error' in result) {
      setServerError(result.error)
      throw new Error(result.error)
    }
    reset(values)
    onSaved?.()
  }

  const curveOptions = std === 'IEEE' ? IEEE_CURVES : IEC_CURVES

  return (
    <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {serverError && (
        <div role="alert" style={{
          padding: '10px 14px', background: 'rgba(232,85,85,0.08)',
          border: '1px solid var(--c-red)', borderRadius: 6, color: 'var(--c-red)', fontSize: 13,
        }}>
          {serverError}
        </div>
      )}

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            {initial ? 'Edit protection device' : 'Add protection device'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            The relay / breaker / fuse at a protected point + its parametric curve
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <FormField label="Protects" required error={errors.attach?.message}>
              <Select {...register('attach')} invalid={!!errors.attach} disabled={!!initial}>
                <option value="">— pick node or feeder —</option>
                {attachOptions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Device role" required error={errors.deviceRole?.message}>
              <Select {...register('deviceRole')} invalid={!!errors.deviceRole}>
                {DEVICE_ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Device type" required error={errors.deviceType?.message}>
              <Select {...register('deviceType')} invalid={!!errors.deviceType}>
                {DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Manufacturer" error={errors.manufacturer?.message}>
              <TextInput type="text" maxLength={120} {...register('manufacturer')} placeholder="e.g. Schneider" />
            </FormField>

            <FormField label="Model" error={errors.model?.message}>
              <TextInput type="text" maxLength={120} {...register('model')} placeholder="e.g. Sepam S40" />
            </FormField>

            <FormField label="Frame rating (A)" error={errors.frameRatingA?.message}>
              <TextInput type="number" step="any" min="0" {...register('frameRatingA')} />
            </FormField>

            <FormField label="Curve ref" hint="SANS device-library code (optional)" error={errors.curveRef?.message}>
              <TextInput type="text" maxLength={120} {...register('curveRef')} />
            </FormField>
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--c-border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-mid)', marginBottom: 12 }}>
              Curve settings
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <FormField label="Standard" required error={errors.std?.message}>
                <Select {...register('std')} invalid={!!errors.std}>
                  {STDS.map((s) => (
                    <option key={s} value={s}>{s === 'DT' ? 'Definite time' : s}</option>
                  ))}
                </Select>
              </FormField>

              {std !== 'DT' && (
                <FormField label="Curve" error={errors.curve?.message}>
                  <Select {...register('curve')} invalid={!!errors.curve}>
                    <option value="">—</option>
                    {curveOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                </FormField>
              )}

              <FormField label="Pickup (A)" hint="Is — current setting" error={errors.pickupA?.message}>
                <TextInput type="number" step="any" min="0" {...register('pickupA')} />
              </FormField>

              {std === 'IEC' && (
                <FormField label="TMS" hint="Time multiplier" error={errors.tms?.message}>
                  <TextInput type="number" step="any" min="0" {...register('tms')} />
                </FormField>
              )}
              {std === 'IEEE' && (
                <FormField label="TD" hint="Time dial" error={errors.td?.message}>
                  <TextInput type="number" step="any" min="0" {...register('td')} />
                </FormField>
              )}
              {std === 'DT' && (
                <FormField label="Delay (s)" hint="Definite-time delay" error={errors.dtS?.message}>
                  <TextInput type="number" step="any" min="0" {...register('dtS')} />
                </FormField>
              )}

              <FormField label="High-set ×pickup" hint="ANSI 50 multiple (optional)" error={errors.instMultiple?.message}>
                <TextInput type="number" step="any" min="0" {...register('instMultiple')} />
              </FormField>
              <FormField label="High-set time (s)" hint="50 operate time (optional)" error={errors.instTimeS?.message}>
                <TextInput type="number" step="any" min="0" {...register('instTimeS')} />
              </FormField>
            </div>
          </div>
        </CardBody>
      </Card>

      <button type="submit" style={{ display: 'none' }} aria-hidden="true" />

      {!locked && (
        <StickySaveBar
          isDirty={isDirty}
          onSave={handleSubmit(onSubmit)}
          onDiscard={() => reset(buildDefaults(initial))}
        />
      )}
    </form>
  )
}
