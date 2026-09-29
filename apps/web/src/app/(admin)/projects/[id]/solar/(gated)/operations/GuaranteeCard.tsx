'use client'
/** Guarantee basis (spec §10): expected kWh is derived for every month automatically — never retyped (WM D.7). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GUARANTEE_BASES, GUARANTEE_BASIS_LABELS, MONTH_NAMES, type Guarantee, type GuaranteeBasis } from '@esite/shared/solar-operations/client'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { saveGuaranteeAction } from '@/actions/solar-operations.actions'

interface Props { projectId: string; installationId: string; canEdit: boolean; guarantee: (Guarantee & { updatedAt: string }) | null }

export function GuaranteeCard({ projectId, installationId, canEdit, guarantee }: Props) {
  const router = useRouter()
  const [basis, setBasis] = useState<GuaranteeBasis>(guarantee?.basis ?? 'p50')
  const [pct, setPct] = useState(guarantee?.pct === null || guarantee?.pct === undefined ? '' : String(guarantee.pct))
  const [deg, setDeg] = useState(String(guarantee?.degradationPctPerYear ?? 0))
  const [manual, setManual] = useState<string[]>((guarantee?.manualMonthlyKwh ?? new Array<string>(12).fill('')).map((v) => String(v)))
  const [updatedAt, setUpdatedAt] = useState<string | null>(guarantee?.updatedAt ?? null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Disabled while saving: a second press would carry the same (now stale) version (review round 2).
  async function save() {
    if (saving) return
    setSaving(true)
    try { await submit() } finally { setSaving(false) }
  }

  async function submit() {
    // Review B5: Number('') is 0, so a blank month would silently guarantee nothing. All 12 are required.
    if (basis === 'manual') {
      const blank = MONTH_NAMES.filter((_, k) => (manual[k] ?? '').trim() === '')
      if (blank.length > 0) {
        setErrors({ manualMonthlyKwh: `Enter the guaranteed kWh for every month (${blank.join(', ')} ${blank.length === 1 ? 'is' : 'are'} blank).` })
        return
      }
    }
    const r = await saveGuaranteeAction({
      projectId, installationId, expectedUpdatedAt: updatedAt,
      guarantee: {
        basis, pct: basis === 'pct_of_modelled' ? Number(pct) : null,
        manualMonthlyKwh: basis === 'manual' ? manual.map((v) => Number(v)) : null,
        degradationPctPerYear: Number(deg),
      },
    })
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    setErrors({})
    if ('error' in r) { setMsg(r.error); return }
    setUpdatedAt(r.updatedAt)
    setMsg('Saved.')
    router.refresh()
  }

  const intro = (
    <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>
      Expected generation is derived for every month automatically from this basis and the frozen baseline. The commissioning month is prorated; degradation applies from operating year 2 (not to a manual schedule).
    </p>
  )
  // Spec §0.2: controls above the viewer's level are hidden, not shown disabled (review B9).
  if (!canEdit) {
    return (
      <Card>
        <CardHeader><span className="data-panel-title">Guarantee</span></CardHeader>
        <CardBody>
          {intro}
          {guarantee ? (
            <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px' }}>
              <dt>Basis</dt>
              <dd style={{ margin: 0 }}>{guarantee.basis === 'pct_of_modelled' && guarantee.pct !== null
                ? `${guarantee.pct} % of modelled (P50)` : GUARANTEE_BASIS_LABELS[guarantee.basis]}</dd>
              {guarantee.basis !== 'manual' ? <><dt>Degradation</dt><dd style={{ margin: 0 }}>{`${guarantee.degradationPctPerYear} % a year`}</dd></> : null}
              {guarantee.basis === 'manual' && guarantee.manualMonthlyKwh ? MONTH_NAMES.map((name, k) => (
                <span key={name} style={{ display: 'contents' }}><dt>{name}</dt><dd style={{ margin: 0 }}>{`${guarantee.manualMonthlyKwh![k]} kWh`}</dd></span>
              )) : null}
            </dl>
          ) : <p style={{ fontSize: 13, margin: 0 }}>No guarantee basis has been saved yet.</p>}
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Guarantee</span></CardHeader>
      <CardBody>
        {intro}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <FormField label="Guarantee basis" htmlFor="ops-basis" error={errors.basis}>
            <Select id="ops-basis" value={basis} disabled={!canEdit} onChange={(e) => setBasis(e.target.value as GuaranteeBasis)}>
              {GUARANTEE_BASES.map((b) => <option key={b} value={b}>{GUARANTEE_BASIS_LABELS[b]}</option>)}
            </Select>
          </FormField>
          {basis === 'pct_of_modelled' ? (
            <FormField label="Percentage of modelled" htmlFor="ops-pct" error={errors.pct}>
              <TextInput id="ops-pct" inputMode="decimal" value={pct} disabled={!canEdit} onChange={(e) => setPct(e.target.value)} />
            </FormField>
          ) : null}
          {basis !== 'manual' ? (
            <FormField label="Degradation % a year" htmlFor="ops-deg" error={errors.degradationPctPerYear}>
              <TextInput id="ops-deg" inputMode="decimal" value={deg} disabled={!canEdit} onChange={(e) => setDeg(e.target.value)} />
            </FormField>
          ) : null}
        </div>
        {basis === 'manual' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
            {MONTH_NAMES.map((name, k) => (
              <FormField key={name} label={name} htmlFor={`ops-man-${k}`}>
                <TextInput id={`ops-man-${k}`} aria-label={`kWh guaranteed in ${name}`} inputMode="decimal" value={manual[k] ?? ''} disabled={!canEdit}
                  onChange={(e) => setManual((m) => m.map((v, i) => (i === k ? e.target.value : v)))} />
              </FormField>
            ))}
            {errors.manualMonthlyKwh ? <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.manualMonthlyKwh}</p> : null}
          </div>
        ) : null}
        {canEdit ? <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button disabled={saving} onClick={save}>Save guarantee</Button>
          {msg ? <span role="status" style={{ fontSize: 13 }}>{msg}</span> : null}
        </div> : null}
      </CardBody>
    </Card>
  )
}
