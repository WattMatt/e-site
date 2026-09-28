'use client'
/**
 * Tenants sub-tab (spec §4.4): one row per tenant from the tenant schedule (no separate tenant list).
 * Source, meters (weighted), density override, archetype; BO date read-only. Each row saves explicitly
 * on its loaded version; figures come from the last build. kW/kWh only — no rand values on this tab.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { applyAutoMatchAction, excludeVacantAction, saveCommonAreaAction, saveTenantBasisAction } from '@/actions/solar-load.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import { formatNumber } from '@/components/charts/scale'
import { useResyncedState } from '@/lib/solar/use-resynced-state'
import { ARCHETYPE_OPTIONS, type TenantRowView, type TenantsView } from '@/lib/solar/load/view-types'
import { AssignMetersDialog } from './AssignMetersDialog'
import { AutoMatchDialog } from './AutoMatchDialog'

type Source = 'metered' | 'synthesised' | 'excluded' | ''

const SOURCE_LABEL: Record<Source, string> = { '': 'Unassigned (synthesised)', metered: 'Metered', synthesised: 'Synthesised', excluded: 'Excluded' }

function TenantRow({ projectId, t, meters, canEdit }: { projectId: string; t: TenantRowView; meters: TenantsView['studyMeters']; canEdit: boolean }) {
  const router = useRouter()
  // Every field re-seeds when the row's version changes, so a refresh after Auto-match / Exclude vacant
  // shows the landed meters and the next Save carries the fresh version (not refused as stale).
  const rowVersion = t.basis?.updatedAt ?? null
  const [source, setSource] = useResyncedState<Source>(t.basis?.source ?? '', rowVersion)
  const [assigned, setAssigned] = useResyncedState(t.basis?.meters ?? [], rowVersion)
  const [density, setDensity] = useResyncedState(t.basis?.densityOverride == null ? '' : String(t.basis.densityOverride), rowVersion)
  const [archetype, setArchetype] = useResyncedState(t.basis?.archetype ?? '', rowVersion)
  const [version, setVersion] = useResyncedState<string | null>(rowVersion, rowVersion)
  const [assign, setAssign] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const label = `${t.shopNumber ?? ''} ${t.name}`.trim()
  const meterLabels = assigned.map((a) => `${meters.find((m) => m.id === a.meterId)?.label ?? 'meter'}${a.weight !== 1 ? ` ×${a.weight}` : ''}`).join(', ')
  const archetypeLabel = (v: string) => ARCHETYPE_OPTIONS.find((a) => a.value === v)?.label ?? v

  async function save() {
    const d = density.trim() === '' ? null : Number(density)
    if (d !== null && !(Number.isFinite(d) && d > 0)) { setMsg('Density must be a number greater than 0 W/m².'); return }
    setBusy(true); setMsg(null)
    const r = await saveTenantBasisAction({
      projectId, nodeId: t.nodeId, source: source as Exclude<Source, ''>,
      meters: source === 'excluded' ? [] : assigned, archetype: archetype || null, densityOverride: d, expectedUpdatedAt: version,
    })
    setBusy(false)
    if ('error' in r) { setMsg(r.error); return }
    setVersion(r.updatedAt)
    setMsg('Saved')
    router.refresh()
  }

  return (
    <tr aria-label={label} style={{ borderTop: '1px solid var(--c-border)' }}>
      <td>{t.shopNumber ?? '—'}</td>
      <td>{t.name}</td>
      <td>{t.category ?? '—'}</td>
      <td align="right">{t.areaM2 == null ? '—' : `${formatNumber(t.areaM2)} m²`}</td>
      <td>
        {canEdit ? (
          <select aria-label={`Source for ${label}`} value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="" disabled>{SOURCE_LABEL['']}</option>
            <option value="metered" disabled={assigned.length === 0}>Metered</option>
            <option value="synthesised">Synthesised</option>
            <option value="excluded">Excluded</option>
          </select>
        ) : SOURCE_LABEL[source]}
      </td>
      <td>{meterLabels || '—'}{canEdit && <> <button type="button" onClick={() => setAssign(true)}>Assign meters</button></>}</td>
      <td>
        {canEdit
          ? <input aria-label={`Density for ${label}`} inputMode="decimal" placeholder={`${t.defaultDensity}`} value={density} onChange={(e) => setDensity(e.target.value)} style={{ width: 64 }} />
          : (density || t.defaultDensity)}
        {' '}W/m²
      </td>
      <td>
        {canEdit ? (
          <select aria-label={`Archetype for ${label}`} value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            <option value="">Default ({archetypeLabel(t.defaultArchetype)})</option>
            {ARCHETYPE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        ) : archetypeLabel(archetype || t.defaultArchetype)}
      </td>
      <td>{t.boDate ?? '—'}</td>
      <td align="right">{t.summary ? `${formatNumber(t.summary.annualKwh)} kWh` : '—'}</td>
      <td align="right">{t.summary?.wPerM2 == null ? '—' : `${t.summary.wPerM2.toFixed(1)} W/m²`}</td>
      <td align="right">{t.summary ? `${t.summary.peakKw.toFixed(1)} kW` : '—'}</td>
      <td>
        {canEdit && <button type="button" disabled={busy || source === ''} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
        {msg && <span role={msg === 'Saved' ? 'status' : 'alert'} style={{ marginLeft: 4, fontSize: 11, color: msg === 'Saved' ? 'var(--c-text-mid)' : '#dc2626' }}>{msg}</span>}
        {assign && (
          <AssignMetersDialog tenantLabel={label} meters={meters} initial={assigned} onClose={() => setAssign(false)}
            onUse={(m) => { setAssigned(m); setSource(m.length > 0 ? 'metered' : source === 'metered' ? 'synthesised' : source); setAssign(false) }} />
        )}
      </td>
    </tr>
  )
}

export function TenantsPanel({ projectId, view, canEdit }: { projectId: string; view: TenantsView; canEdit: boolean }) {
  const router = useRouter()
  const [auto, setAuto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The study row is shared with the Load basis bar and the settings: re-seed on its version.
  const [common, setCommon] = useResyncedState(String(view.commonAreaPct), view.studyUpdatedAt)
  const [commonVersion, setCommonVersion] = useResyncedState(view.studyUpdatedAt, view.studyUpdatedAt)
  const [notice, setNotice] = useState<string | null>(null)
  const vacant = view.tenants.filter((t) => t.vacant && t.basis?.source !== 'excluded')
  const confirmVacant = useArmedConfirm()

  if (view.tenants.length === 0) {
    return <p style={{ fontSize: 13 }}>No tenants in the tenant schedule — import one on the Tenant Schedule page, or use the Bulk meter or Monthly bills basis.</p>
  }
  return (
    <div>
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10, fontSize: 13 }}>
          <button type="button" onClick={() => setAuto(true)}>Auto-match meters</button>
          {vacant.length > 0 && (!confirmVacant.armed
            ? <button type="button" disabled={busy} onClick={confirmVacant.arm}>{`Exclude vacant (${vacant.length})`}</button>
            : <button type="button" disabled={busy} style={{ color: '#dc2626' }} onClick={async () => {
                confirmVacant.disarm()
                setBusy(true); setError(null)
                const r = await excludeVacantAction({ projectId, nodeIds: vacant.map((t) => t.nodeId) })
                setBusy(false)
                if ('error' in r) setError(r.error)
                else {
                  const left = r.stale.length > 0 ? ` Changed by someone else since you loaded the page, so left as they are: ${r.stale.join(', ')} — review them after the reload.` : ''
                  setNotice(`${r.count} vacant tenant${r.count === 1 ? '' : 's'} excluded.${left}`)
                  router.refresh()
                }
              }}>{`Exclude ${vacant.length} vacant tenant${vacant.length === 1 ? '' : 's'}?`}</button>)}
          <label style={{ marginLeft: 'auto' }}>Common-area allowance{' '}
            <input aria-label="Common-area allowance (%)" inputMode="decimal" value={common} onChange={(e) => setCommon(e.target.value)} style={{ width: 60 }} /> %
          </label>
          <button type="button" disabled={busy} onClick={async () => {
            const pct = common.trim() === '' ? NaN : Number(common)
            if (!(Number.isFinite(pct) && pct >= 0 && pct <= 100)) { setError('Common-area allowance must be between 0 and 100 %'); return }
            setBusy(true); setError(null)
            const r = await saveCommonAreaAction({ projectId, commonAreaPct: pct, expectedUpdatedAt: commonVersion })
            setBusy(false)
            if ('error' in r) setError(r.error)
            else { setCommonVersion(r.updatedAt); setNotice('Common-area allowance saved. Rebuild the site profile to use it.'); router.refresh() }
          }}>Save allowance</button>
        </div>
      )}
      {!canEdit && <p style={{ fontSize: 13 }}>Common-area allowance: {view.commonAreaPct} %</p>}
      {error && !auto && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      {notice && <p role="status" style={{ fontSize: 13 }}>{notice}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr>
            <th align="left">Shop</th><th align="left">Name</th><th align="left">Category</th><th align="right">Area</th><th align="left">Source</th><th align="left">Meter(s)</th>
            <th align="left">Density</th><th align="left">Archetype</th><th align="left">BO date</th><th align="right">Annual energy</th><th align="right">Average</th><th align="right">Peak</th><th />
          </tr></thead>
          <tbody>{view.tenants.map((t) => <TenantRow key={t.nodeId} projectId={projectId} t={t} meters={view.studyMeters} canEdit={canEdit} />)}</tbody>
        </table>
      </div>
      {auto && (
        <AutoMatchDialog proposals={view.proposals} busy={busy} error={error} onClose={() => { setAuto(false); setError(null) }} onApply={async (pairs) => {
          setBusy(true); setError(null)
          const r = await applyAutoMatchAction({ projectId, pairs })
          setBusy(false)
          if ('error' in r) { setError(r.error); return }
          setAuto(false)
          const stale = r.staleMeters > 0 ? ` ${r.staleMeters} meter${r.staleMeters === 1 ? ' was' : 's were'} changed by someone else and ${r.staleMeters === 1 ? 'was' : 'were'} not re-linked — check ${r.staleMeters === 1 ? 'it' : 'them'} on the Meters tab.` : ''
          setNotice(`${r.applied} meter${r.applied === 1 ? '' : 's'} assigned. Rebuild the site profile to use them.${stale}`)
          router.refresh()
        }} />
      )}
    </div>
  )
}
