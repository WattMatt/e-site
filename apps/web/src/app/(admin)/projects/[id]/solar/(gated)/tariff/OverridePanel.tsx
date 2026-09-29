'use client'
/**
 * Project override (spec §5; D-10 landlord resale). Create copies the pinned
 * tariff; each edited rate needs a unit and a reason; Revert is two-step and
 * drops every project rate.
 */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import {
  COMPONENT_LABELS, SEASON_LABELS, TARIFF_UNITS, TOU_LABELS, UNIT_LABELS, formatChargeAmount,
  type OverrideChargeRow, type TariffUnit,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { createSolarTariffOverrideAction, editSolarOverrideChargeAction, revertSolarTariffOverrideAction } from '@/actions/solar-tariff.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }

export function OverridePanel({ projectId, studyUpdatedAt, override, published }: {
  projectId: string
  studyUpdatedAt: string
  override: { id: string; rows: OverrideChargeRow[] } | null
  /** base charge id -> the published amount + unit, to show beside the project rate. */
  published: Record<string, { amount: number; unit: TariffUnit }>
}) {
  const router = useRouter()
  const revert = useArmedConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!override) {
    return (
      <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
        <p style={{ margin: 0 }}>Negotiated or landlord resale rates? Copy the pinned tariff into a project override and change the rates that differ.</p>
        <div><Button variant="secondary" isLoading={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await createSolarTariffOverrideAction({ projectId, expectedUpdatedAt: studyUpdatedAt })
          setBusy(false)
          if ('error' in r) setError(r.error); else router.refresh()
        }}>Create project override</Button></div>
        {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{error}</p>}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p role="note" style={{ margin: 0, fontSize: 13, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 }}>
        Project-specific rates: the bill check uses these instead of the published tariff.
      </p>
      {override.rows.length === 0
        ? <p style={{ margin: 0, fontSize: 13 }}>This override has no rates. Revert to the published tariff to start again.</p>
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Component</th><th style={TH}>Season / period</th><th style={TH}>Published</th><th style={TH}>Project rate</th><th style={TH}>Reason</th><th style={TH} /></tr></thead>
              <tbody>{override.rows.map((r) => <OverrideRow key={`${r.id}:${r.updatedAt}`} projectId={projectId} row={r} published={r.baseChargeId ? published[r.baseChargeId] : undefined} />)}</tbody>
            </table>
          </div>}
      <div>
        <Button variant="danger" size="sm" isLoading={busy} onClick={async () => {
          if (!revert.armed) return revert.arm()
          revert.disarm(); setBusy(true); setError(null)
          const r = await revertSolarTariffOverrideAction({ projectId, expectedUpdatedAt: studyUpdatedAt })
          setBusy(false)
          if ('error' in r) setError(r.error); else router.refresh()
        }}>{revert.armed ? `Confirm revert (drops ${override.rows.length} project rate${override.rows.length === 1 ? '' : 's'})` : 'Revert to published tariff'}</Button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0, fontSize: 13 }}>{error}</p>}
    </div>
  )
}

function OverrideRow({ projectId, row, published }: { projectId: string; row: OverrideChargeRow; published?: { amount: number; unit: TariffUnit } }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(row.amountExclVat))
  const [unit, setUnit] = useState<TariffUnit | ''>(row.unit)
  const [reason, setReason] = useState(row.reason ?? '')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)
  return (
    <tr>
      <td style={TD}>{COMPONENT_LABELS[row.component]}</td>
      <td style={TD}>{SEASON_LABELS[row.season]} / {TOU_LABELS[row.tou]}</td>
      <td style={TD}>{published ? formatChargeAmount(published.amount, published.unit) : 'Added'}</td>
      <td style={TD}>
        {editing
          ? <span style={{ display: 'inline-flex', gap: 4 }}>
              <input aria-label="New amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} />
              <select aria-label="Unit" required value={unit} onChange={(e) => setUnit(e.target.value as TariffUnit | '')}>
                <option value="">Choose a unit</option>{TARIFF_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
              </select>
            </span>
          : <span>{formatChargeAmount(row.amountExclVat, row.unit)}{row.editedAt ? ' (changed)' : ''}</span>}
        {errors.amount && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.amount}</div>}
        {errors.unit && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.unit}</div>}
      </td>
      <td style={TD}>
        {editing
          ? <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lease cl. 14 resale rate" style={{ minWidth: 200 }} />
          : (row.reason ?? '—')}
        {errors.reason && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.reason}</div>}
        {errors.form && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.form}</div>}
      </td>
      <td style={TD}>
        {editing
          ? <>
              <Button size="sm" isLoading={busy} onClick={async () => {
                setBusy(true); setErrors({})
                const r = await editSolarOverrideChargeAction({ projectId, chargeId: row.id, expectedUpdatedAt: row.updatedAt, form: { amount, unit, reason } })
                setBusy(false)
                if ('fieldErrors' in r) setErrors(r.fieldErrors)
                else if ('error' in r) setErrors({ form: r.error })
                else { setEditing(false); router.refresh() }
              }}>Save rate</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          : <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </td>
    </tr>
  )
}
