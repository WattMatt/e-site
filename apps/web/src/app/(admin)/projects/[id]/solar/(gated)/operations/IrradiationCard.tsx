'use client'
/**
 * Measured irradiation per month ("irradiation-corrected expected, if weather uploaded"): plane of array
 * gives PR; horizontal (GHI) gives a ratio correction against the TMY. A source note is mandatory.
 * Removing an entry is a two-press confirm (useArmedConfirm), like every destructive Solar control.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { monthLabel } from '@esite/shared/solar-operations/client'
import type { IrradiationRecord } from '@esite/shared/solar-operations'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { deleteIrradiationAction, saveIrradiationAction } from '@/actions/solar-operations.actions'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'

interface Props { projectId: string; installationId: string; canEdit: boolean; entries: IrradiationRecord[] }

function EntryRow({ p, e, onError }: { p: Props; e: IrradiationRecord; onError: (m: string) => void }) {
  const router = useRouter()
  const { armed, arm, disarm } = useArmedConfirm()
  const label = monthLabel(e.month)
  return (
    <tr>
      <td>{label}</td><td>{e.plane === 'poa' ? 'Plane of array' : 'Horizontal (GHI)'}</td>
      <td align="right">{e.kwhPerM2}</td><td>{e.sourceNote}</td>
      <td>{p.canEdit ? (armed
        ? <Button size="sm" variant="danger" aria-label={`Confirm remove ${label}`} onClick={async () => {
            disarm()
            const r = await deleteIrradiationAction({ projectId: p.projectId, installationId: p.installationId, month: e.month })
            if ('error' in r) onError(r.error); else router.refresh()
          }}>Confirm</Button>
        : <Button size="sm" variant="ghost" aria-label={`Remove ${label}`} onClick={arm}>Remove</Button>) : null}</td>
    </tr>
  )
}

export function IrradiationCard(p: Props) {
  const { projectId, installationId, canEdit, entries } = p
  const router = useRouter()
  const [month, setMonth] = useState('')
  const [plane, setPlane] = useState<'ghi' | 'poa'>('poa')
  const [value, setValue] = useState('')
  const [source, setSource] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Measured irradiation</span></CardHeader>
      <CardBody>
        {entries.length === 0 ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>None recorded. Without it the table shows no PR and no irradiation-corrected expectation.</p> : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Month</th><th align="left">Plane</th><th align="right">kWh/m²</th><th align="left">Source</th><th /></tr></thead>
            <tbody>{entries.map((e) => <EntryRow key={e.month} p={p} e={e} onError={setMsg} />)}</tbody>
          </table>
        )}
        {canEdit ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
            <FormField label="Month" htmlFor="ops-irr-month" error={errors.month}><TextInput id="ops-irr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></FormField>
            <FormField label="Plane" htmlFor="ops-irr-plane"><Select id="ops-irr-plane" value={plane} onChange={(e) => setPlane(e.target.value as 'ghi' | 'poa')}>
              <option value="poa">Plane of array (POA)</option><option value="ghi">Horizontal (GHI)</option></Select></FormField>
            <FormField label="Irradiation kWh/m²" htmlFor="ops-irr-val" error={errors.kwhPerM2}><TextInput id="ops-irr-val" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></FormField>
            <FormField label="Source" htmlFor="ops-irr-src" error={errors.sourceNote}><TextInput id="ops-irr-src" value={source} onChange={(e) => setSource(e.target.value)} /></FormField>
            {/* Disabled while saving: a second press would insert the month twice (review round 2). */}
            <Button disabled={saving} onClick={async () => {
              if (saving) return
              setSaving(true)
              try {
                const r = await saveIrradiationAction({ projectId, installationId, month, plane, kwhPerM2: Number(value), sourceNote: source })
                if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
                setErrors({})
                if ('error' in r) { setMsg(r.error); return }
                setMonth(''); setValue(''); setSource('')
                router.refresh()
              } finally {
                setSaving(false)
              }
            }}>Save irradiation</Button>
          </div>
        ) : null}
        {msg ? <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)' }}>{msg}</p> : null}
      </CardBody>
    </Card>
  )
}
