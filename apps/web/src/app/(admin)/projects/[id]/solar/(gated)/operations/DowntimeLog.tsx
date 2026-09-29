'use client'
/**
 * Downtime log (spec §10): recorded outages (start, end, cause, excluded from the guarantee?) and the
 * auto-detected candidates for the selected month — zero output while the sun is above 5° (the engine's
 * SPA, computed on the server), never a missing reading. Confirm records a candidate; every edit and
 * delete is kept in solar.downtime_history.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAUSE_LABELS, isoToSastLocal, monthLabel } from '@esite/shared/solar-operations/client'
import type { DowntimeCandidate } from '@esite/shared/solar-operations'
import type { OpsDowntimeView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { addDowntimeAction, deleteDowntimeAction, updateDowntimeAction } from '@/actions/solar-operations.actions'
import { kwh, sastDateTime } from '@/components/solar/ops-format'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'

interface Props {
  projectId: string; installationId: string; canEdit: boolean
  downtime: OpsDowntimeView[]; candidates: DowntimeCandidate[]; selectedMonth: string | null
}
const CAUSES = Object.keys(CAUSE_LABELS)
const HINT = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 } as const

function DowntimeRow({ p, d }: { p: Props; d: OpsDowntimeView }) {
  const router = useRouter()
  const { armed, arm, disarm } = useArmedConfirm()
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(isoToSastLocal(d.startsAt))
  const [end, setEnd] = useState(isoToSastLocal(d.endsAt))
  const [cause, setCause] = useState(d.cause)
  const [excluded, setExcluded] = useState(d.excludedFromGuarantee)
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const label = sastDateTime(d.startsAt)
  if (editing) {
    return (
      <tr><td colSpan={7}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <FormField label="Start (SAST)" htmlFor={`e-s-${d.id}`}><TextInput id={`e-s-${d.id}`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="End (SAST)" htmlFor={`e-e-${d.id}`}><TextInput id={`e-e-${d.id}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
          <FormField label="Cause" htmlFor={`e-c-${d.id}`}><Select id={`e-c-${d.id}`} value={cause} onChange={(e) => setCause(e.target.value)}>
            {CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABELS[c]}</option>)}</Select></FormField>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /> Excluded from the guarantee</label>
          <Button size="sm" disabled={saving} onClick={async () => {
            if (saving) return
            setSaving(true)
            try {
              const r = await updateDowntimeAction({ projectId: p.projectId, id: d.id, startsAt: start, endsAt: end, cause, description: d.description ?? '', excludedFromGuarantee: excluded, expectedUpdatedAt: d.updatedAt })
              if ('fieldErrors' in r) { setMsg(Object.values(r.fieldErrors).join(' ')); return }
              if ('error' in r) { setMsg(r.error); return }
              setEditing(false)
              router.refresh()
            } finally {
              setSaving(false)
            }
          }}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          {msg ? <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{msg}</span> : null}
        </div>
      </td></tr>
    )
  }
  return (
    <tr aria-label={label}>
      <td>{label}</td>
      <td>{sastDateTime(d.endsAt)}</td>
      <td>{d.description ? `${CAUSE_LABELS[d.cause] ?? d.cause}: ${d.description}` : (CAUSE_LABELS[d.cause] ?? d.cause)}</td>
      <td>{d.excludedFromGuarantee ? 'Excluded' : 'Counts'}</td>
      <td>{d.source === 'detected' ? 'Detected' : 'Manual'}</td>
      <td align="right">{d.lostKwh === null ? '—' : kwh(d.lostKwh)}</td>
      <td>
        {p.canEdit ? <span style={{ display: 'inline-flex', gap: 4 }}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          {armed
            ? <Button size="sm" variant="danger" aria-label={`Confirm delete ${label}`} onClick={async () => {
                disarm()
                const r = await deleteDowntimeAction({ projectId: p.projectId, id: d.id })
                if ('error' in r) setMsg(r.error); else router.refresh()
              }}>Confirm</Button>
            : <Button size="sm" variant="ghost" aria-label={`Delete downtime ${label}`} onClick={arm}>Delete</Button>}
        </span> : null}
        {msg ? <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{msg}</span> : null}
      </td>
    </tr>
  )
}

export function DowntimeLog(p: Props) {
  const router = useRouter()
  const [hidden, setHidden] = useState<string[]>([])
  const [candCause, setCandCause] = useState<Record<string, string>>({})
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [cause, setCause] = useState('grid_outage')
  const [description, setDescription] = useState('')
  const [excluded, setExcluded] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  // Presses in flight ('add', or a candidate's startsAt): each button is disabled until its action
  // returns, so a double press cannot record the same window twice (review round 2).
  const [pending, setPending] = useState<string[]>([])
  const run = async (key: string, fn: () => Promise<void>) => {
    if (pending.includes(key)) return
    setPending((ks) => [...ks, key])
    try { await fn() } finally { setPending((ks) => ks.filter((k) => k !== key)) }
  }
  const visible = p.candidates.filter((c) => !hidden.includes(c.startsAt))

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Downtime</span></CardHeader>
      <CardBody>
        {p.downtime.length === 0 ? <p style={HINT}>No downtime recorded.</p> : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Start (SAST)</th><th align="left">End (SAST)</th><th align="left">Cause</th><th align="left">Guarantee</th><th align="left">Source</th>
              <th align="right">{`Lost kWh${p.selectedMonth ? ` (${monthLabel(p.selectedMonth)})` : ''}`}</th><th /></tr></thead>
            <tbody>{p.downtime.map((d) => <DowntimeRow key={d.id} p={p} d={d} />)}</tbody>
          </table>
        )}
        {p.canEdit && visible.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <p style={HINT}>{`Possible downtime in ${p.selectedMonth ? monthLabel(p.selectedMonth) : 'this month'}: zero output while the sun was more than 5° above the horizon. Missing readings are never proposed.`}</p>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {visible.map((c) => {
                const l = sastDateTime(c.startsAt)
                return (
                  <li key={c.startsAt} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
                    <span style={{ minWidth: 260, fontSize: 13 }}>{`${l} to ${sastDateTime(c.endsAt)} (${c.hours} h)`}</span>
                    <Select aria-label={`Cause for ${l}`} value={candCause[c.startsAt] ?? 'other'} onChange={(e) => setCandCause((m) => ({ ...m, [c.startsAt]: e.target.value }))}>
                      {CAUSES.map((x) => <option key={x} value={x}>{CAUSE_LABELS[x]}</option>)}
                    </Select>
                    <Button size="sm" aria-label={`Confirm ${l}`} disabled={pending.includes(c.startsAt)} onClick={() => run(c.startsAt, async () => {
                      const r = await addDowntimeAction({ projectId: p.projectId, installationId: p.installationId, startsAt: c.startsAt, endsAt: c.endsAt,
                        cause: candCause[c.startsAt] ?? 'other', description: '', excludedFromGuarantee: false, source: 'detected' })
                      if ('error' in r) { setMsg(r.error); return }
                      if ('fieldErrors' in r) { setMsg(Object.values(r.fieldErrors).join(' ')); return }
                      router.refresh()
                    })}>Confirm</Button>
                    <Button size="sm" variant="ghost" aria-label={`Dismiss ${l}`} onClick={() => setHidden((hs) => [...hs, c.startsAt])}>Dismiss</Button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {p.canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16 }}>
            <FormField label="Start (SAST)" htmlFor="dt-start" error={errors.startsAt}><TextInput id="dt-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
            <FormField label="End (SAST)" htmlFor="dt-end" error={errors.endsAt}><TextInput id="dt-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></FormField>
            <FormField label="Cause" htmlFor="dt-cause" error={errors.cause}><Select id="dt-cause" value={cause} onChange={(e) => setCause(e.target.value)}>
              {CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABELS[c]}</option>)}</Select></FormField>
            <FormField label="Description" htmlFor="dt-desc" error={errors.description}><TextInput id="dt-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /> Excluded from the guarantee</label>
            <Button disabled={pending.includes('add')} onClick={() => run('add', async () => {
              const r = await addDowntimeAction({ projectId: p.projectId, installationId: p.installationId, startsAt: start, endsAt: end, cause, description, excludedFromGuarantee: excluded, source: 'manual' })
              if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
              setErrors({})
              if ('error' in r) { setMsg(r.error); return }
              setStart(''); setEnd(''); setDescription(''); setExcluded(false)
              router.refresh()
            })}>Add downtime</Button>
          </div>
        ) : null}
        {msg ? <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)' }}>{msg}</p> : null}
      </CardBody>
    </Card>
  )
}
