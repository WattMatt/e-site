'use client'

/**
 * Add / edit a fault-source impedance facet (cable_schedule.fault_sources) for
 * one node XOR source. Mirrors the settings-form pattern (GeneralForm):
 * react-hook-form + zodResolver + Card/FormField + StickySaveBar, with the
 * server action (upsertFaultSource) re-validating via the shared Zod schema.
 *
 * The visible fields switch on `role` (utility / transformer / generator /
 * inverter) — only the role-relevant impedance inputs render, matching the
 * per-role columns the engine adapter reads (spec §5.2).
 */

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { upsertFaultSource } from '@/actions/mv-protection.actions'
import {
  FAULT_SOURCE_ROLES,
  EARTHING_KINDS,
  type FaultSourceRole,
  type FaultSourceInput,
} from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField, TextInput, Select } from '@/components/ui/FormField'
import { StickySaveBar } from '../../../settings/_components/StickySaveBar'

// UI-local schema. Numerics are kept as strings in the form (empty = unset) and
// coerced on submit; the server action enforces the real per-role bounds via
// faultSourceInputSchema. attach = "node:<id>" | "source:<id>".
const formSchema = z.object({
  attach: z.string().min(1, 'Pick the node or source this impedance describes'),
  role: z.enum(FAULT_SOURCE_ROLES),
  // utility
  sscMva: z.string().optional(),
  xrRatio: z.string().optional(),
  z0OverZ1: z.string().optional(),
  // transformer
  ukPct: z.string().optional(),
  pkrW: z.string().optional(),
  sRatedVa: z.string().optional(),
  vectorGroup: z.string().optional(),
  lvEarthingKind: z.string().optional(),
  lvEarthingOhm: z.string().optional(),
  // generator
  xdPct: z.string().optional(),
  // inverter
  currentLimitFactor: z.string().optional(),
})
type FormValues = z.infer<typeof formSchema>

export interface AttachOption {
  key: string // "node:<id>" | "source:<id>"
  label: string
}

export interface ExistingFaultSource {
  id: string
  nodeId: string | null
  sourceId: string | null
  role: FaultSourceRole
  sscMva: number | null
  xrRatio: number | null
  z0OverZ1: number | null
  ukPct: number | null
  pkrW: number | null
  sRatedVa: number | null
  vectorGroup: string | null
  lvEarthingKind: string | null
  lvEarthingOhm: number | null
  xdPct: number | null
  currentLimitFactor: number | null
}

interface Props {
  revisionId: string
  attachOptions: AttachOption[]
  /** When set, the form edits this row in place; otherwise it creates a new one. */
  initial?: ExistingFaultSource | null
  locked?: boolean
  onSaved?: () => void
}

const numStr = (v: number | null | undefined) => (v == null ? '' : String(v))
const toNum = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function buildDefaults(initial: ExistingFaultSource | null | undefined): FormValues {
  const attach = initial?.nodeId
    ? `node:${initial.nodeId}`
    : initial?.sourceId
      ? `source:${initial.sourceId}`
      : ''
  return {
    attach,
    role: initial?.role ?? 'utility',
    sscMva: numStr(initial?.sscMva),
    xrRatio: numStr(initial?.xrRatio),
    z0OverZ1: numStr(initial?.z0OverZ1),
    ukPct: numStr(initial?.ukPct),
    pkrW: numStr(initial?.pkrW),
    sRatedVa: numStr(initial?.sRatedVa),
    vectorGroup: initial?.vectorGroup ?? '',
    lvEarthingKind: initial?.lvEarthingKind ?? '',
    lvEarthingOhm: numStr(initial?.lvEarthingOhm),
    xdPct: numStr(initial?.xdPct),
    currentLimitFactor: numStr(initial?.currentLimitFactor),
  }
}

export function FaultSourceForm({ revisionId, attachOptions, initial, locked, onSaved }: Props) {
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

  // Re-seed when switching which row is being edited.
  useEffect(() => {
    reset(buildDefaults(initial))
  }, [initial, reset])

  const role = watch('role') as FaultSourceRole

  async function onSubmit(values: FormValues) {
    setServerError(null)
    const [kind, id] = values.attach.split(':')
    const input: FaultSourceInput = {
      revisionId,
      nodeId: kind === 'node' ? id! : null,
      sourceId: kind === 'source' ? id! : null,
      role: values.role,
      // Role-relevant fields only (others left undefined → mapper skips them).
      sscMva: values.role === 'utility' ? toNum(values.sscMva) : undefined,
      xrRatio:
        values.role === 'utility' || values.role === 'generator' ? toNum(values.xrRatio) : undefined,
      z0OverZ1:
        values.role === 'utility' || values.role === 'transformer' ? toNum(values.z0OverZ1) : undefined,
      ukPct: values.role === 'transformer' ? toNum(values.ukPct) : undefined,
      pkrW: values.role === 'transformer' ? toNum(values.pkrW) : undefined,
      sRatedVa:
        values.role === 'transformer' || values.role === 'inverter' ? toNum(values.sRatedVa) : undefined,
      vectorGroup: values.role === 'transformer' ? values.vectorGroup?.trim() || null : undefined,
      lvEarthingKind:
        values.role === 'transformer' && values.lvEarthingKind
          ? (values.lvEarthingKind as FaultSourceInput['lvEarthingKind'])
          : values.role === 'transformer'
            ? null
            : undefined,
      lvEarthingOhm: values.role === 'transformer' ? toNum(values.lvEarthingOhm) : undefined,
      xdPct: values.role === 'generator' ? toNum(values.xdPct) : undefined,
      currentLimitFactor: values.role === 'inverter' ? toNum(values.currentLimitFactor) : undefined,
    }

    const result = await upsertFaultSource(input, initial?.id)
    if ('error' in result) {
      setServerError(result.error)
      throw new Error(result.error)
    }
    reset(values)
    onSaved?.()
  }

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
            {initial ? 'Edit source impedance' : 'Add source impedance'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            The grid / transformer / generator / inverter data the Z-bus solve needs
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <FormField label="Attaches to" required error={errors.attach?.message}>
              <Select {...register('attach')} invalid={!!errors.attach} disabled={!!initial}>
                <option value="">— pick node or source —</option>
                {attachOptions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Role" required error={errors.role?.message}>
              <Select {...register('role')} invalid={!!errors.role}>
                {FAULT_SOURCE_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </FormField>

            {role === 'utility' && (
              <>
                <FormField label="S″k (MVA)" hint="Utility short-circuit level" error={errors.sscMva?.message}>
                  <TextInput type="number" step="any" min="0" {...register('sscMva')} />
                </FormField>
                <FormField label="X/R ratio" error={errors.xrRatio?.message}>
                  <TextInput type="number" step="any" min="0" {...register('xrRatio')} />
                </FormField>
                <FormField label="Z0/Z1" hint="Zero-seq ratio (optional)" error={errors.z0OverZ1?.message}>
                  <TextInput type="number" step="any" min="0" {...register('z0OverZ1')} />
                </FormField>
              </>
            )}

            {role === 'transformer' && (
              <>
                <FormField label="uk (%)" hint="Short-circuit voltage" error={errors.ukPct?.message}>
                  <TextInput type="number" step="any" min="0" {...register('ukPct')} />
                </FormField>
                <FormField label="Pkr (W)" hint="Load (copper) loss" error={errors.pkrW?.message}>
                  <TextInput type="number" step="any" min="0" {...register('pkrW')} />
                </FormField>
                <FormField label="S rated (VA)" error={errors.sRatedVa?.message}>
                  <TextInput type="number" step="any" min="0" {...register('sRatedVa')} />
                </FormField>
                <FormField label="Vector group" hint="e.g. Dyn11" error={errors.vectorGroup?.message}>
                  <TextInput type="text" maxLength={40} {...register('vectorGroup')} placeholder="Dyn11" />
                </FormField>
                <FormField label="LV earthing" error={errors.lvEarthingKind?.message}>
                  <Select {...register('lvEarthingKind')}>
                    <option value="">—</option>
                    {EARTHING_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="NER (Ω)" hint="Earthing resistance/reactance" error={errors.lvEarthingOhm?.message}>
                  <TextInput type="number" step="any" min="0" {...register('lvEarthingOhm')} />
                </FormField>
                <FormField label="Z0/Z1" hint="Zero-seq ratio (optional)" error={errors.z0OverZ1?.message}>
                  <TextInput type="number" step="any" min="0" {...register('z0OverZ1')} />
                </FormField>
              </>
            )}

            {role === 'generator' && (
              <>
                <FormField label="x″d (%)" hint="Sub-transient reactance" error={errors.xdPct?.message}>
                  <TextInput type="number" step="any" min="0" {...register('xdPct')} />
                </FormField>
                <FormField label="X/R ratio" error={errors.xrRatio?.message}>
                  <TextInput type="number" step="any" min="0" {...register('xrRatio')} />
                </FormField>
              </>
            )}

            {role === 'inverter' && (
              <>
                <FormField label="S rated (VA)" error={errors.sRatedVa?.message}>
                  <TextInput type="number" step="any" min="0" {...register('sRatedVa')} />
                </FormField>
                <FormField label="Current limit factor" hint="× rated (≈1.2)" error={errors.currentLimitFactor?.message}>
                  <TextInput type="number" step="any" min="0" {...register('currentLimitFactor')} />
                </FormField>
              </>
            )}
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
