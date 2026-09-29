'use client'
/**
 * Installation (spec §10): created from the ACCEPTED proposal (its run frozen as the baseline), then
 * the as-built record — commissioning date, sizes and the equipment table the monthly report prints.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { EQUIPMENT_KINDS, EQUIPMENT_UNITS, type AsBuilt, type EquipmentLine } from '@esite/shared/solar-operations/client'
import type { OpsInstallationView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput, Textarea } from '@/components/ui/FormField'
import { createInstallationAction, saveInstallationAction } from '@/actions/solar-operations.actions'
import { kwh } from '@/components/solar/ops-format'

interface Props {
  projectId: string
  canEdit: boolean
  installation: OpsInstallationView | null
  acceptedProposal: { id: string; version: number } | null
  setupReason: string | null
  /** Where the setup reason is resolved (e.g. the Reports & Proposal tab), shown as a link. */
  setupAction?: { href: string; label: string } | null
}

const HINT = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 } as const
const str = (v: number | null) => (v === null ? '' : String(v))
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

export function InstallationCard(p: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  if (!p.installation) {
    return (
      <Card>
        <CardHeader><span className="data-panel-title">Installation</span></CardHeader>
        <CardBody>
          {p.setupReason ? (
            <p style={HINT}>
              {p.setupReason}
              {p.setupAction ? <>{' '}<Link href={p.setupAction.href}>{p.setupAction.label}</Link></> : null}
            </p>
          )
            : p.acceptedProposal && p.canEdit ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <p style={HINT}>{`Proposal v${p.acceptedProposal.version} was accepted. Recording the installation freezes its modelled generation as the baseline the guarantee is measured against.`}</p>
                <div>
                  <Button disabled={busy} onClick={async () => {
                    setBusy(true)
                    const r = await createInstallationAction({ projectId: p.projectId })
                    setBusy(false)
                    if ('error' in r) { setMsg(r.error); return }
                    setMsg(r.warning)
                    router.refresh()
                  }}>{`Record installation from proposal v${p.acceptedProposal.version}`}</Button>
                </div>
              </div>
            ) : <p style={HINT}>{`Proposal v${p.acceptedProposal?.version ?? ''} was accepted. Someone with Solar Edit access records the installation.`}</p>}
          {msg ? <p role="alert" style={{ ...HINT, color: 'var(--c-red)', marginTop: 8 }}>{msg}</p> : null}
        </CardBody>
      </Card>
    )
  }
  return <InstallationForm {...p} installation={p.installation} />
}

interface LineForm { kind: EquipmentLine['kind']; make: string; model: string; rating: string; unit: EquipmentLine['unit']; quantity: string }

function InstallationForm({ projectId, canEdit, installation }: Props & { installation: OpsInstallationView }) {
  const router = useRouter()
  const a = installation.asBuilt
  const [date, setDate] = useState(installation.commissioningDate ?? '')
  const [dcKwp, setDcKwp] = useState(String(a.dcKwp))
  const [acKw, setAcKw] = useState(String(a.acKw))
  const [batteryKwh, setBatteryKwh] = useState(str(a.batteryKwh))
  const [batteryKw, setBatteryKw] = useState(str(a.batteryKw))
  const [tilt, setTilt] = useState(str(a.tiltDeg))
  const [azimuth, setAzimuth] = useState(str(a.azimuthDeg))
  const [notes, setNotes] = useState(installation.notes ?? '')
  const [lines, setLines] = useState<LineForm[]>(a.equipment.map((e) => ({ ...e, rating: String(e.rating), quantity: String(e.quantity) })))
  const [updatedAt, setUpdatedAt] = useState(installation.updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setLine = (k: number, patch: Partial<LineForm>) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, ...patch } : l)))

  async function save() {
    const asBuilt: AsBuilt = {
      dcKwp: Number(dcKwp), acKw: Number(acKw), batteryKwh: numOrNull(batteryKwh), batteryKw: numOrNull(batteryKw),
      tiltDeg: numOrNull(tilt), azimuthDeg: numOrNull(azimuth),
      equipment: lines.map((l) => ({ kind: l.kind, make: l.make, model: l.model, rating: Number(l.rating), unit: l.unit, quantity: Number(l.quantity) })),
    }
    setBusy(true)
    const r = await saveInstallationAction({ projectId, installationId: installation.id, commissioningDate: date || null, asBuilt, notes, expectedUpdatedAt: updatedAt })
    setBusy(false)
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    setErrors({})
    if ('error' in r) { setMsg(r.error); return }
    setUpdatedAt(r.updatedAt)
    setMsg('Saved.')
    router.refresh()
  }

  const b = installation.baseline
  const baselineLine = (
    <p style={{ ...HINT, marginBottom: 12 }}>
      {`Modelled baseline: accepted run ${b.caseRunId.slice(0, 8)} — ${kwh(installation.annualP50Kwh)} kWh a year (P50), design PR ${b.performanceRatio.toFixed(2)}. Frozen when the installation was recorded.`}
    </p>
  )
  // Spec §0.2: controls above the viewer's level are hidden, not shown disabled (review B9).
  if (!canEdit) {
    const show = (v: number | null, unit: string) => (v === null ? '—' : `${v} ${unit}`)
    return (
      <Card>
        <CardHeader><span className="data-panel-title">Installation (as built)</span></CardHeader>
        <CardBody>
          {baselineLine}
          <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px' }}>
            <dt>Commissioning date</dt><dd style={{ margin: 0 }}>{installation.commissioningDate ?? 'Not set'}</dd>
            <dt>DC</dt><dd style={{ margin: 0 }}>{show(a.dcKwp, 'kWp')}</dd>
            <dt>AC</dt><dd style={{ margin: 0 }}>{show(a.acKw, 'kW')}</dd>
            <dt>Battery</dt><dd style={{ margin: 0 }}>{a.batteryKwh === null ? '—' : `${a.batteryKwh} kWh / ${show(a.batteryKw, 'kW')}`}</dd>
            <dt>Tilt / azimuth</dt><dd style={{ margin: 0 }}>{`${show(a.tiltDeg, '°')} / ${show(a.azimuthDeg, '°')}`}</dd>
          </dl>
          {a.equipment.length > 0 ? (
            <table style={{ width: '100%', marginTop: 16, fontSize: 13, borderCollapse: 'collapse' }}>
              <thead><tr><th align="left">Kind</th><th align="left">Make</th><th align="left">Model</th><th align="right">Rating</th><th align="right">Qty</th></tr></thead>
              <tbody>
                {a.equipment.map((e, k) => (
                  <tr key={k}><td>{e.kind}</td><td>{e.make}</td><td>{e.model}</td><td align="right">{`${e.rating} ${e.unit}`}</td><td align="right">{e.quantity}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ ...HINT, marginTop: 12 }}>No equipment has been recorded yet.</p>}
          {installation.notes ? <p style={{ fontSize: 13, marginTop: 12, whiteSpace: 'pre-wrap' }}>{installation.notes}</p> : null}
        </CardBody>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Installation (as built)</span></CardHeader>
      <CardBody>
        {baselineLine}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <FormField label="Commissioning date" htmlFor="ops-comm" error={errors.commissioningDate}>
            <TextInput id="ops-comm" type="date" value={date} disabled={!canEdit} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="DC kWp" htmlFor="ops-dc"><TextInput id="ops-dc" inputMode="decimal" value={dcKwp} disabled={!canEdit} onChange={(e) => setDcKwp(e.target.value)} /></FormField>
          <FormField label="AC kW" htmlFor="ops-ac"><TextInput id="ops-ac" inputMode="decimal" value={acKw} disabled={!canEdit} onChange={(e) => setAcKw(e.target.value)} /></FormField>
          <FormField label="Battery kWh" htmlFor="ops-bkwh"><TextInput id="ops-bkwh" inputMode="decimal" value={batteryKwh} disabled={!canEdit} onChange={(e) => setBatteryKwh(e.target.value)} /></FormField>
          <FormField label="Battery kW" htmlFor="ops-bkw"><TextInput id="ops-bkw" inputMode="decimal" value={batteryKw} disabled={!canEdit} onChange={(e) => setBatteryKw(e.target.value)} /></FormField>
          <FormField label="Tilt °" htmlFor="ops-tilt"><TextInput id="ops-tilt" inputMode="decimal" value={tilt} disabled={!canEdit} onChange={(e) => setTilt(e.target.value)} /></FormField>
          <FormField label="Azimuth °" htmlFor="ops-az"><TextInput id="ops-az" inputMode="decimal" value={azimuth} disabled={!canEdit} onChange={(e) => setAzimuth(e.target.value)} /></FormField>
        </div>
        <table style={{ width: '100%', marginTop: 16, fontSize: 13, borderCollapse: 'collapse' }}>
          <thead><tr><th align="left">Kind</th><th align="left">Make</th><th align="left">Model</th><th align="right">Rating</th><th align="left">Unit</th><th align="right">Qty</th><th /></tr></thead>
          <tbody>
            {lines.map((l, k) => (
              <tr key={k}>
                <td><Select aria-label={`Kind of line ${k + 1}`} value={l.kind} disabled={!canEdit} onChange={(e) => setLine(k, { kind: e.target.value as LineForm['kind'] })}>
                  {EQUIPMENT_KINDS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></td>
                <td><TextInput aria-label={`Make of line ${k + 1}`} value={l.make} disabled={!canEdit} onChange={(e) => setLine(k, { make: e.target.value })} /></td>
                <td><TextInput aria-label={`Model of line ${k + 1}`} value={l.model} disabled={!canEdit} onChange={(e) => setLine(k, { model: e.target.value })} /></td>
                <td><TextInput aria-label={`Rating of line ${k + 1}`} inputMode="decimal" value={l.rating} disabled={!canEdit} onChange={(e) => setLine(k, { rating: e.target.value })} /></td>
                <td><Select aria-label={`Unit of line ${k + 1}`} value={l.unit} disabled={!canEdit} onChange={(e) => setLine(k, { unit: e.target.value as LineForm['unit'] })}>
                  {EQUIPMENT_UNITS.map((x) => <option key={x} value={x}>{x}</option>)}</Select></td>
                <td><TextInput aria-label={`Quantity of line ${k + 1}`} inputMode="numeric" value={l.quantity} disabled={!canEdit} onChange={(e) => setLine(k, { quantity: e.target.value })} /></td>
                <td>{canEdit ? <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, i) => i !== k))}>Remove</Button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {errors.asBuilt ? <p role="alert" style={{ ...HINT, color: 'var(--c-red)' }}>{errors.asBuilt}</p> : null}
        {canEdit ? <Button variant="secondary" size="sm" style={{ marginTop: 8 }}
          onClick={() => setLines((ls) => [...ls, { kind: 'module', make: '', model: '', rating: '', unit: 'W', quantity: '1' }])}>Add equipment line</Button> : null}
        <div style={{ marginTop: 12 }}>
          <FormField label="Notes" htmlFor="ops-notes" error={errors.notes}>
            <Textarea id="ops-notes" rows={3} value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>
        {canEdit ? <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button disabled={busy} onClick={save}>Save installation</Button>
          {msg ? <span role="status" style={HINT}>{msg}</span> : null}
        </div> : null}
      </CardBody>
    </Card>
  )
}
