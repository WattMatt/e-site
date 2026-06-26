'use client'

/**
 * MV protection study sign-off form (spec §9 gated-issue evidence). Mirrors the
 * FaultSourceForm pattern: react-hook-form + zodResolver + Card/FormField +
 * StickySaveBar, with the server action (upsertMvStudySignoff) re-validating via
 * the shared Zod schema and stamping signed_off_by/at when the gate is complete.
 *
 * The four gates: Pr.Eng approver (name + ECSA reg), curve re-validation manual
 * rev, source-data confirmation, signed validation pack reference. Live per-gate
 * status renders below from the current field values (the same rule the server
 * guard enforces), so the engineer sees what is still outstanding as they type.
 */

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { upsertMvStudySignoff } from '@/actions/mv-protection.actions'
import { mvSignoffComplete, type MvStudySignoffInput } from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { FormField, TextInput } from '@/components/ui/FormField'
import { StickySaveBar } from '../../../settings/_components/StickySaveBar'

const formSchema = z.object({
  prEngName: z.string().optional(),
  prEngEcsaReg: z.string().optional(),
  curveManualRev: z.string().optional(),
  sourceDataConfirmed: z.boolean().optional(),
  validationPackRef: z.string().optional(),
})
type FormValues = z.infer<typeof formSchema>

export interface ExistingSignoff {
  prEngName: string | null
  prEngEcsaReg: string | null
  curveManualRev: string | null
  sourceDataConfirmed: boolean
  validationPackRef: string | null
}

interface Props {
  revisionId: string
  initial?: ExistingSignoff | null
  locked?: boolean
}

function buildDefaults(initial: ExistingSignoff | null | undefined): FormValues {
  return {
    prEngName: initial?.prEngName ?? '',
    prEngEcsaReg: initial?.prEngEcsaReg ?? '',
    curveManualRev: initial?.curveManualRev ?? '',
    sourceDataConfirmed: initial?.sourceDataConfirmed ?? false,
    validationPackRef: initial?.validationPackRef ?? '',
  }
}

const gateLabel: Record<string, string> = {
  'Pr.Eng approver name': 'GATE-1 · Pr.Eng approver name',
  'Pr.Eng ECSA registration': 'GATE-1 · Pr.Eng ECSA registration',
  'curve re-validation manual revision': 'GATE-2 · Curve re-validation manual rev',
  'source data confirmation': 'GATE-3 · Source data confirmed',
  'signed validation pack reference': 'GATE-4 · Signed validation pack ref',
}
const ALL_GATES = Object.keys(gateLabel)

export function SignoffForm({ revisionId, initial, locked }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: buildDefaults(initial),
  })

  useEffect(() => {
    reset(buildDefaults(initial))
  }, [initial, reset])

  // Live gate evaluation from the current field values — same rule as the
  // server guard (mvSignoffComplete), so the on-screen status matches the
  // precondition that issueRevisionAction enforces.
  const values = watch()
  const { complete, missing } = mvSignoffComplete({
    id: '', organisationId: '', revisionId,
    prEngName: values.prEngName ?? null,
    prEngEcsaReg: values.prEngEcsaReg ?? null,
    curveManualRev: values.curveManualRev ?? null,
    sourceDataConfirmed: values.sourceDataConfirmed ?? false,
    validationPackRef: values.validationPackRef ?? null,
    signedOffBy: null, signedOffAt: null, createdAt: '', updatedAt: '',
  })
  const missingSet = new Set(missing)

  async function onSubmit(v: FormValues) {
    setServerError(null)
    const input: MvStudySignoffInput = {
      revisionId,
      prEngName: v.prEngName?.trim() || null,
      prEngEcsaReg: v.prEngEcsaReg?.trim() || null,
      curveManualRev: v.curveManualRev?.trim() || null,
      sourceDataConfirmed: v.sourceDataConfirmed ?? false,
      validationPackRef: v.validationPackRef?.trim() || null,
    }
    const result = await upsertMvStudySignoff(input)
    if ('error' in result) {
      setServerError(result.error)
      throw new Error(result.error)
    }
    reset(v)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {serverError && (
        <div role="alert" style={{
          padding: '10px 14px', background: 'var(--c-red-dim)',
          border: '1px solid var(--c-red)', borderRadius: 6, color: 'var(--c-red)', fontSize: 13,
        }}>
          {serverError}
        </div>
      )}

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Pr.Eng sign-off
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            All four gates must pass before this revision can be issued
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <FormField label="Pr.Eng approver name" hint="GATE-1 · named registered professional">
              <TextInput type="text" maxLength={160} {...register('prEngName')} placeholder="e.g. J. Smith" disabled={locked} />
            </FormField>
            <FormField label="Pr.Eng ECSA registration" hint="GATE-1 · ECSA reg number">
              <TextInput type="text" maxLength={80} {...register('prEngEcsaReg')} placeholder="e.g. 20071234" disabled={locked} />
            </FormField>
            <FormField label="Curve re-validation manual rev" hint="GATE-2 · curve constants & ranges re-validated vs manual rev ___">
              <TextInput type="text" maxLength={120} {...register('curveManualRev')} placeholder="e.g. Rev C" disabled={locked} />
            </FormField>
            <FormField label="Signed validation pack ref" hint="GATE-4 · completed & signed validation pack reference">
              <TextInput type="text" maxLength={200} {...register('validationPackRef')} placeholder="e.g. VP-2026-001" disabled={locked} />
            </FormField>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, fontSize: 13, color: 'var(--c-text-mid)' }}>
            <input type="checkbox" {...register('sourceDataConfirmed')} disabled={locked} style={{ width: 16, height: 16 }} />
            <span><strong>GATE-3</strong> · Source data confirmed (utility / transformer / generator impedances)</span>
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>Gate status</span>
          <Badge variant={complete ? 'success' : 'warning'}>
            {complete ? 'Ready to issue' : `${missing.length} outstanding`}
          </Badge>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ALL_GATES.map((g) => {
              const ok = !missingSet.has(g)
              return (
                <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Badge variant={ok ? 'success' : 'danger'}>{ok ? '✓' : '✗'}</Badge>
                  <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{gateLabel[g]}</span>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 12, lineHeight: 1.5 }}>
            {complete
              ? 'All gates satisfied. Saving stamps the sign-off; the revision can then be issued from the schedule.'
              : 'The issue action refuses while any gate is outstanding — this is enforced server-side.'}
          </p>
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
