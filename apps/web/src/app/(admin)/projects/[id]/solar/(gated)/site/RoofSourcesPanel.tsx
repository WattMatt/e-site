'use client'
/**
 * Site & Supply — C. Roof sources (functional spec §3.2). Pick project drawings
 * (no upload here: uploads go through Floor Plans so Dropbox sync keeps
 * working), see scale and north per page, open the sheet to calibrate or set
 * north, or capture a satellite view (D-08). View level reads only.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SATELLITE_CAPTURE } from '@esite/shared'
import { addDrawingRoofSourceAction, removeRoofSourceAction } from '@/actions/solar-roof-sources.actions'
import type { RoofSourceRow } from '@/lib/solar/layout-loader'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

function Tick({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span aria-label={ok ? yes : no} style={{ color: ok ? 'var(--c-green, #16a34a)' : 'var(--c-red, #dc2626)' }}>{ok ? '✓' : '✗'}</span>
}

function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
  const { armed, arm, disarm } = useArmedConfirm()
  return armed
    ? <button type="button" onClick={() => { disarm(); onConfirm() }} style={{ color: '#dc2626' }}>Confirm remove</button>
    : <button type="button" onClick={arm}>Remove</button>
}

export function RoofSourcesPanel({
  projectId, canEdit, sources, drawings, hasStudy, satelliteConfigured,
}: {
  projectId: string
  canEdit: boolean
  sources: RoofSourceRow[]
  drawings: Array<{ id: string; name: string }>
  hasStudy: boolean
  satelliteConfigured: boolean
}) {
  const router = useRouter()
  const [drawingId, setDrawingId] = useState('')
  const [page, setPage] = useState('1')
  const [zoom, setZoom] = useState(String(SATELLITE_CAPTURE.defaultZoom))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true); setError(null)
    const res = await addDrawingRoofSourceAction({ projectId, floorPlanId: drawingId, pageIndex: Number(page) })
    setBusy(false)
    if ('error' in res) setError(res.error)
    else { setDrawingId(''); setPage('1'); router.refresh() }
  }
  async function remove(id: string) {
    setError(null)
    const res = await removeRoofSourceAction({ projectId, roofSourceId: id })
    if ('error' in res) setError(res.error)
    else router.refresh()
  }
  async function capture() {
    setBusy(true); setError(null)
    const res = await fetch(`/api/projects/${projectId}/solar/roof-sources/satellite`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ zoom: Number(zoom) }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      setError(j.error ?? 'Something went wrong — try again.')
    } else router.refresh()
  }

  const captureBlocked = !satelliteConfigured
    ? 'Satellite capture is not configured on this server.'
    : !hasStudy ? 'Save the site location above first.' : null

  return (
    <section aria-labelledby="roof-sources-h" style={{ marginTop: 24 }}>
      <h2 id="roof-sources-h" style={{ fontSize: 15, fontWeight: 600 }}>C. Roof sources</h2>
      {sources.length === 0 ? (
        <p style={{ color: 'var(--c-text-dim)' }}>Add the roof plan from the project&apos;s drawings</p>
      ) : (
        <table style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th align="left">Sheet</th><th>Scale</th><th>North</th><th /></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>{s.label}{s.drawingChanged && <span style={{ color: '#b45309' }}> · drawing changed</span>}</td>
                <td align="center"><Tick ok={s.pixelsPerMeter !== null} yes="Scale set" no="Scale not set" /></td>
                <td align="center"><Tick ok={s.northSet} yes="North set" no="North not set" /></td>
                <td align="right">
                  <Link href={`/projects/${projectId}/solar/layout/sources/${s.id}`}>Open sheet</Link>
                  {canEdit && <> · <RemoveButton onConfirm={() => void remove(s.id)} /></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', marginTop: 12 }}>
          <label>Drawing
            <select aria-label="Drawing" value={drawingId} onChange={(e) => setDrawingId(e.target.value)}>
              <option value="">Choose…</option>
              {drawings.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label>Page <input aria-label="Page" type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} style={{ width: 64 }} /></label>
          <button type="button" disabled={busy || !drawingId || !hasStudy} onClick={() => void add()}>Add roof drawing</button>
          <span style={{ width: 16 }} />
          <label>Zoom
            <select aria-label="Zoom" value={zoom} onChange={(e) => setZoom(e.target.value)}>
              {[17, 18, 19, 20].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy || captureBlocked !== null} onClick={() => void capture()}>Capture satellite view</button>
          {captureBlocked && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{captureBlocked}</span>}
        </div>
      )}
      {!hasStudy && canEdit && <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Save the site location above before adding roof sources.</p>}
      {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
    </section>
  )
}
