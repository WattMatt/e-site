'use client'
/**
 * Meters (spec §10): generation meters (kind solar) and the council/bulk meter for realised
 * consumption. The role follows the meter's kind, so a council meter can never be linked as
 * generation (00217 refuses it too).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OpsAvailableMeter, OpsMeterView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { linkMeterAction, setMeterShareAction, unlinkMeterAction } from '@/actions/solar-operations.actions'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'
import { GenerationImport } from './GenerationImport'

interface Props {
  projectId: string; installationId: string; organisationId: string; canEdit: boolean
  meters: OpsMeterView[]; availableMeters: OpsAvailableMeter[]
  /** The view's sentence when the expected shares do not add to 100 % (review B4). */
  shareNote?: string | null
}
const HINT = { fontSize: 13, color: 'var(--c-text-dim)', margin: 0 } as const

function MeterRow({ p, m }: { p: Props; m: OpsMeterView }) {
  const router = useRouter()
  const { armed, arm, disarm } = useArmedConfirm()
  const [share, setShare] = useState(m.sharePct === null ? '' : String(m.sharePct))
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  return (
    <tr>
      <td>{m.label}</td>
      <td>{m.role === 'generation' ? 'Generation' : 'Consumption (grid)'}</td>
      <td>
        {m.role === 'generation' ? (p.canEdit ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <TextInput aria-label={`Expected share of ${m.label}`} inputMode="decimal" value={share} style={{ width: 80 }} onChange={(e) => setShare(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={saving} onClick={async () => {
              if (saving) return
              setSaving(true)
              setMsg(null)
              try {
                const r = await setMeterShareAction({ projectId: p.projectId, installationId: p.installationId, meterId: m.meterId, sharePct: share.trim() === '' ? null : Number(share) })
                if ('error' in r) setMsg(r.error); else router.refresh()
              } finally {
                setSaving(false)
              }
            }}>Save share</Button>
          </span>
        ) : (m.sharePct === null ? 'equal' : `${m.sharePct} %`)) : '—'}
        {msg ? <span role="alert" style={{ color: 'var(--c-red)', marginLeft: 8 }}>{msg}</span> : null}
      </td>
      <td>
        {p.canEdit ? (armed
          ? <Button size="sm" variant="danger" aria-label={`Confirm unlink ${m.label}`} onClick={async () => {
              disarm()
              const r = await unlinkMeterAction({ projectId: p.projectId, installationId: p.installationId, meterId: m.meterId })
              if ('error' in r) setMsg(r.error); else router.refresh()
            }}>Confirm</Button>
          : <Button size="sm" variant="ghost" aria-label={`Unlink ${m.label}`} onClick={arm}>Unlink</Button>) : null}
      </td>
    </tr>
  )
}

export function MetersCard(p: Props) {
  const router = useRouter()
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const generation = p.meters.filter((m) => m.role === 'generation')
  const equal = generation.length > 0 && generation.every((m) => m.sharePct === null)
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Meters</span></CardHeader>
      <CardBody>
        {p.meters.length === 0 ? <p style={HINT}>No meter is linked yet. Import generation data below, or link a meter already in the study.</p> : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Meter</th><th align="left">Role</th><th align="left">Expected share</th><th /></tr></thead>
            <tbody>{p.meters.map((m) => <MeterRow key={m.meterId} p={p} m={m} />)}</tbody>
          </table>
        )}
        {equal ? <p style={{ ...HINT, marginTop: 8 }}>The guarantee is allocated equally between the generation meters until you set shares.</p>
          : generation.some((m) => m.sharePct === null) ? <p style={{ ...HINT, marginTop: 8 }}>Meters without a share take equal parts of what the set shares leave.</p> : null}
        {p.shareNote ? <p role="status" style={{ ...HINT, color: 'var(--c-amber)', marginTop: 8 }}>{p.shareNote}</p> : null}
        {p.canEdit && p.availableMeters.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
            <FormField label="Meter to link" htmlFor="ops-link">
              <Select id="ops-link" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose…</option>
                {p.availableMeters.map((m) => <option key={m.meterId} value={m.meterId}>{`${m.label} (${m.kind})`}</option>)}
              </Select>
            </FormField>
            <Button disabled={!pick} onClick={async () => {
              const m = p.availableMeters.find((x) => x.meterId === pick)
              if (!m) return
              const r = await linkMeterAction({ projectId: p.projectId, installationId: p.installationId, meterId: m.meterId, role: m.kind === 'solar' ? 'generation' : 'consumption' })
              if ('error' in r) { setMsg(r.error); return }
              setPick('')
              router.refresh()
            }}>Link meter</Button>
          </div>
        ) : null}
        {msg ? <p role="alert" style={{ ...HINT, color: 'var(--c-red)', marginTop: 8 }}>{msg}</p> : null}
        {p.canEdit ? (
          <div style={{ marginTop: 16 }}>
            <GenerationImport projectId={p.projectId} organisationId={p.organisationId} installationId={p.installationId}
              generationMeters={generation.map((m) => ({ meterId: m.meterId, label: m.label }))} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
