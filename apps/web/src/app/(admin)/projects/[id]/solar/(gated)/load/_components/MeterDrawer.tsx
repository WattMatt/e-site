'use client'
/** Meter detail drawer (spec §4.3): Chart · Heatmap · Details (kind, tenant, area, point of supply, edit mapping, remove) · normalised CSV. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { NOT_TENANT_KINDS, type BulkReconciliation } from '@esite/shared/solar-load'
import { removeStudyMeterAction, updateStudyMeterAction, type MeterPatch } from '@/actions/solar-load.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import { HeatmapCanvas } from '@/components/charts/HeatmapCanvas'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { parseFiles } from '@/lib/solar/load/import-client'
import { METER_KIND_OPTIONS, type MeterKind, type MeterView } from '@/lib/solar/load/view-types'
import { loadHref } from '@/lib/solar/load/subtabs'
import { MeterSeriesChart } from './MeterSeriesChart'

type Tab = 'chart' | 'heatmap' | 'details'

function Heatmap({ projectId, meterId }: { projectId: string; meterId: string }) {
  const [data, setData] = useState<{ dates: string[]; cells: Array<Array<number | null>>; unit: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/solar/meters/${meterId}/heatmap`)
      .then(async (r) => {
        const b = await r.json()
        if (!r.ok) throw new Error(b.message ?? 'The heatmap could not be loaded — try again.')
        if (!cancelled) setData(b)
      })
      .catch((e: Error) => { if (!cancelled) setMsg(e.message || 'The heatmap could not be loaded — try again.') })
    return () => { cancelled = true }
  }, [projectId, meterId])
  if (msg) return <p role="alert" style={{ fontSize: 13 }}>{msg}</p>
  if (!data) return <p style={{ fontSize: 13 }}>Loading heatmap…</p>
  if (data.dates.length === 0) return <p style={{ fontSize: 13 }}>No readings in the last 12 months.</p>
  return <HeatmapCanvas title="Day × time-of-day heatmap (last 12 months)" rows={data.dates} cells={data.cells} unit={data.unit} />
}

export function MeterDrawer({ projectId, meter, canEdit, isGrantor, bulkRecon, onClose, onEditMapping, onRemoved }: {
  projectId: string; meter: MeterView; canEdit: boolean; isGrantor: boolean; bulkRecon: BulkReconciliation[]
  onClose: () => void; onEditMapping: (reviews: ReviewModel[], meterId: string) => void
  /** After a removal: the note to show on the list (e.g. "kept in the library because…"), or null. */
  onRemoved?: (note: string | null) => void
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('chart')
  const [label, setLabel] = useState(meter.label)
  const [kind, setKind] = useState<MeterKind>(meter.kind)
  const [area, setArea] = useState(meter.areaM2 == null ? '' : String(meter.areaM2))
  const [supply, setSupply] = useState(meter.supplyPointConfirmed)
  const [version, setVersion] = useState(meter.updatedAt)
  const [alsoLibrary, setAlsoLibrary] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const remove = useArmedConfirm()
  const recon = bulkRecon.find((b) => b.meterId === meter.id)

  async function save() {
    const patch: MeterPatch = {}
    if (label !== meter.label) patch.label = label
    if (kind !== meter.kind) patch.kind = kind
    const a = area.trim() === '' ? null : Number(area)
    if (a !== null && !(Number.isFinite(a) && a > 0)) { setMsg({ ok: false, text: 'Enter the area as a positive number of m², or leave it blank.' }); return }
    if (a !== meter.areaM2) patch.areaM2 = a
    if (supply !== meter.supplyPointConfirmed) patch.supplyPointConfirmed = supply
    if (Object.keys(patch).length === 0) { setMsg({ ok: true, text: 'Nothing changed.' }); return }
    setBusy(true)
    const r = await updateStudyMeterAction({ projectId, meterId: meter.id, patch, expectedUpdatedAt: version })
    setBusy(false)
    if ('error' in r) { setMsg({ ok: false, text: r.error }); return }
    setVersion(r.updatedAt)
    setMsg({ ok: true, text: 'Saved. Rebuild the site profile to use the change.' })
    router.refresh()
  }

  return (
    <aside aria-label={`Meter ${meter.label}`} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px, 100vw)', background: 'var(--c-bg)', borderLeft: '1px solid var(--c-border)', zIndex: 40, overflow: 'auto', padding: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{meter.label}</h2>
        <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{meter.siteLabel ?? ''}</span>
        <a href={`/api/projects/${projectId}/solar/meters/${meter.id}/csv`} style={{ marginLeft: 'auto', fontSize: 12 }}>Download normalised CSV</a>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div role="tablist" style={{ display: 'flex', gap: 4, margin: '10px 0' }}>
        {(['chart', 'heatmap', 'details'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}>{t === 'chart' ? 'Chart' : t === 'heatmap' ? 'Heatmap' : 'Details'}</button>
        ))}
      </div>
      {tab === 'chart' && <MeterSeriesChart projectId={projectId} meterId={meter.id} />}
      {tab === 'heatmap' && <Heatmap projectId={projectId} meterId={meter.id} />}
      {tab === 'details' && (
        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          {canEdit ? (
            <>
              <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
              <label>Kind <select value={kind} onChange={(e) => { setKind(e.target.value as MeterKind); if (e.target.value !== 'bulk') setSupply(false) }}>
                {METER_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select></label>
              {/* The tenant a meter feeds lives in the tenant's load basis; it is changed on the Tenants tab only. */}
              {!NOT_TENANT_KINDS.has(kind) && <p style={{ margin: 0 }}>Tenant: {meter.tenantLabel ?? '—'} · <Link href={loadHref(projectId, 'tenants')}>Change it on the Tenants tab</Link></p>}
              <label>Area (m²) <input inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} /></label>
            </>
          ) : (
            <p style={{ margin: 0 }}>Kind: {METER_KIND_OPTIONS.find((k) => k.value === meter.kind)?.label} · Tenant: {meter.tenantLabel ?? '—'} · Area: {meter.areaM2 == null ? '—' : `${meter.areaM2} m²`}</p>
          )}
          {kind === 'bulk' && (
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>Reconciliation: Σ metered tenants vs this meter</h3>
              {recon && recon.months.length > 0 ? (
                <table style={{ fontSize: 12, width: '100%' }}>
                  <thead><tr><th align="left">Month</th><th align="right">Bulk kWh</th><th align="right">Σ tenants kWh</th><th align="right">Tenants / bulk</th></tr></thead>
                  <tbody>{recon.months.map((m) => (
                    <tr key={m.month} style={{ color: m.flagged ? '#b45309' : undefined }}>
                      <td>{m.month}</td><td align="right">{Math.round(m.bulkKwh).toLocaleString('en-ZA')} kWh</td><td align="right">{Math.round(m.tenantsKwh).toLocaleString('en-ZA')} kWh</td>
                      <td align="right">{m.ratio === null ? '—' : `${Math.round(m.ratio * 100)} %`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p style={{ fontSize: 12, margin: 0 }}>Assign tenant meters and rebuild the site profile to see the reconciliation.</p>}
              {canEdit && (
                <label style={{ display: 'block', marginTop: 6 }}>
                  <input type="checkbox" checked={supply} onChange={(e) => setSupply(e.target.checked)} /> This meter is the point of supply (basis &quot;Bulk meter&quot; may use it)
                </label>
              )}
              {!canEdit && <p style={{ fontSize: 12, margin: '4px 0 0' }}>Point of supply: {meter.supplyPointConfirmed ? 'confirmed' : 'not confirmed'}</p>}
            </div>
          )}
          {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--c-text-mid)' : '#dc2626', margin: 0 }}>{msg.text}</p>}
          {canEdit && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button type="button" disabled={busy} onClick={save}>{busy ? 'Working…' : 'Save meter'}</button>
              <button type="button" disabled={busy || meter.fileIds.length === 0} onClick={async () => {
                setBusy(true)
                const r = await parseFiles(projectId, meter.fileIds)
                setBusy(false)
                if (r.reviews.length === 0) { setMsg({ ok: false, text: r.failed[0]?.message ?? 'The stored file could not be read.' }); return }
                onEditMapping(r.reviews, meter.id)
              }}>Edit mapping</button>
              {isGrantor && meter.otherStudyLinks === 0 && (
                <label><input type="checkbox" checked={alsoLibrary} onChange={(e) => setAlsoLibrary(e.target.checked)} /> Also delete from library</label>
              )}
              {!remove.armed ? (
                <button type="button" disabled={busy} onClick={remove.arm}>Remove from study</button>
              ) : (
                <button type="button" disabled={busy} style={{ color: '#dc2626' }} onClick={async () => {
                  remove.disarm()
                  setBusy(true)
                  const r = await removeStudyMeterAction({ projectId, meterId: meter.id, alsoDeleteFromLibrary: alsoLibrary && isGrantor && meter.otherStudyLinks === 0 })
                  setBusy(false)
                  if ('error' in r) { setMsg({ ok: false, text: r.error }); return }
                  onRemoved?.(r.note ?? null)
                  router.refresh()
                  onClose()
                }}>Confirm remove</button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
