'use client'
/** Meters sub-tab (spec §4.3): import controls (Edit), meters table, detail drawer, the review dialog, and the 2–4 meter comparison overlay (§16). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { formatNumber } from '@/components/charts/scale'
import { METER_KIND_OPTIONS, type MetersView } from '@/lib/solar/load/view-types'
import { CloudImportDialog } from './CloudImportDialog'
import { ImportReviewDialog } from './ImportReviewDialog'
import { LibraryCopyDialog } from './LibraryCopyDialog'
import { MeterComparison } from './MeterComparison'
import { MeterDrawer } from './MeterDrawer'
import { RegisterPanel } from './RegisterPanel'
import { UploadMeterFiles } from './UploadMeterFiles'

const MAX_COMPARE = 4
const day = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 7_200_000).toISOString().slice(0, 10) : '—')

export function MetersPanel({ projectId, view, canEdit, openMeterId }: { projectId: string; view: MetersView; canEdit: boolean; openMeterId: string | null }) {
  const router = useRouter()
  const [reviews, setReviews] = useState<{ list: ReviewModel[]; editMeterId: string | null } | null>(null)
  const [dialog, setDialog] = useState<'cloud' | 'library' | null>(null)
  const [selected, setSelected] = useState<string | null>(openMeterId)
  const [notice, setNotice] = useState<string | null>(null)
  const meter = view.meters.find((m) => m.id === selected) ?? null
  const [picked, setPicked] = useState<string[]>([])
  const [pickNote, setPickNote] = useState<string | null>(null)
  const [comparing, setComparing] = useState<string[] | null>(null)
  const pickedMeters = picked.map((id) => view.meters.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)
  const compareMeters = (comparing ?? []).map((id) => view.meters.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)

  // Picks are pruned against the meters on screen: a meter removed from the study (refresh) no longer
  // holds a slot, and the limit counts only the visible picks.
  const visible = (id: string) => view.meters.some((m) => m.id === id)
  function togglePick(id: string, on: boolean) {
    if (!on) { setPicked((p) => p.filter((x) => x !== id && visible(x))); setPickNote(null); return }
    if (pickedMeters.length >= MAX_COMPARE) { setPickNote(`You can compare at most ${MAX_COMPARE} meters at a time — untick one first.`); return }
    setPicked((p) => [...p.filter(visible), id])
    setPickNote(null)
  }

  return (
    <div>
      {canEdit && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <UploadMeterFiles projectId={projectId} orgId={view.orgId} label="Upload meter files" accept=".csv,.txt,.xlsx,.xls" onReviews={(list) => setReviews({ list, editMeterId: null })} />
          <UploadMeterFiles projectId={projectId} orgId={view.orgId} label="Import meter register" accept=".csv" onReviews={(list) => setReviews({ list, editMeterId: null })} />
          <div style={{ display: 'flex', gap: 8 }}>
            {view.cloudMapped && <button type="button" onClick={() => setDialog('cloud')}>Import from Dropbox folder</button>}
            <button type="button" onClick={() => setDialog('library')}>Copy from org meter library</button>
          </div>
        </div>
      )}
      {notice && <p role="status" style={{ fontSize: 13 }}>{notice}</p>}
      {view.meters.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>No meters in this study yet. Upload meter exports or synthesise load from the tenant schedule (Tenants).</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, margin: '0 0 6px' }}>
            <button type="button" disabled={pickedMeters.length < 2} onClick={() => setComparing(pickedMeters.map((m) => m.id))}>
              Compare{pickedMeters.length > 0 ? ` (${pickedMeters.length})` : ''}
            </button>
            {pickedMeters.length < 2 && <span style={{ color: 'var(--c-text-mid)' }}>Select 2 to 4 meters to compare them on one chart.</span>}
            {pickNote && <span role="status" style={{ color: '#b45309' }}>{pickNote}</span>}
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr>
              <th align="left"><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Compare</span></th>
              <th align="left">Label</th><th align="left">Kind</th><th align="left">Tenant</th><th align="left">Period</th><th align="right">Interval</th>
              <th align="right">Completeness</th><th align="right">Peak (interval max)</th><th align="right">Annual energy</th><th align="left">Status</th>
            </tr></thead>
            <tbody>
              {view.meters.map((m) => (
                <tr key={m.id} onClick={() => setSelected(m.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--c-border)' }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Compare ${m.label}`} checked={picked.includes(m.id)} onChange={(e) => togglePick(m.id, e.target.checked)} />
                  </td>
                  <td><button type="button" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--c-amber)', cursor: 'pointer' }}>{m.label}</button></td>
                  <td>{METER_KIND_OPTIONS.find((k) => k.value === m.kind)?.label}{m.kind === 'bulk' && m.supplyPointConfirmed ? ' · point of supply' : ''}</td>
                  <td>{m.tenantLabel ?? '—'}</td>
                  <td>{day(m.periodStart)} → {day(m.periodEnd)}</td>
                  <td align="right">{m.intervalMin == null ? '—' : `${m.intervalMin} min`}</td>
                  <td align="right">{m.completeness == null ? '—' : `${(m.completeness * 100).toFixed(1)} %`}</td>
                  <td align="right">{m.peakKw == null ? '—' : `${m.peakKw.toFixed(1)} kW`}</td>
                  <td align="right">{m.annualKwh == null ? '—' : `${formatNumber(m.annualKwh)} kWh`}</td>
                  <td>{m.status === 'imported' ? 'Imported' : 'No data'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {comparing && compareMeters.length >= 2 && (
        <MeterComparison key={comparing.join(',')} projectId={projectId} meters={compareMeters} onClose={() => setComparing(null)} />
      )}
      <RegisterPanel projectId={projectId} rows={view.register} canEdit={canEdit} />
      {meter && (
        <MeterDrawer key={meter.id} projectId={projectId} meter={meter} canEdit={canEdit} isGrantor={view.isGrantor} bulkRecon={view.bulkRecon}
          onClose={() => setSelected(null)} onRemoved={(note) => setNotice(note)} onEditMapping={(list, editMeterId) => { setSelected(null); setReviews({ list, editMeterId }) }} />
      )}
      {dialog === 'cloud' && <CloudImportDialog projectId={projectId} onClose={() => setDialog(null)} onReviews={(list) => { setDialog(null); setReviews({ list, editMeterId: null }) }} />}
      {dialog === 'library' && <LibraryCopyDialog projectId={projectId} onClose={() => setDialog(null)} onLinked={(n) => { setDialog(null); setNotice(`${n} meter(s) added to this study. Rebuild the site profile to use them.`); router.refresh() }} />}
      {reviews && (
        <ImportReviewDialog projectId={projectId} reviews={reviews.list} nodes={view.nodes}
          studyMeters={view.meters.map((m) => ({ id: m.id, label: m.label, siteLabel: m.siteLabel }))} editMeterId={reviews.editMeterId}
          onClose={() => { setReviews(null); router.refresh() }}
          onFinished={(s) => { setReviews(null); setNotice(`Imported ${s.imported}, registers ${s.registers}, skipped ${s.skipped}. Rebuild the site profile to use new data.`); router.refresh() }} />
      )}
    </div>
  )
}
