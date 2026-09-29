'use client'
/**
 * One roof sheet: calibrate its scale (drawing pages only, through the existing
 * role-gated calibrateFloorPlanAction — owner/admin/PM) and set north.
 */
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sheetBearing } from '@esite/shared'
import { calibrateFloorPlanAction } from '@/actions/cable-route.actions'
import { setRoofNorthAction } from '@/actions/solar-roof-sources.actions'
import type { RoofSourceRow } from '@/lib/solar/layout-loader'
import { EMPTY_SELECTION, type LayoutTool } from '../../_components/SolarCanvas'

const SolarCanvas = dynamic(() => import('../../_components/SolarCanvas').then((m) => m.SolarCanvas), { ssr: false })

export function SheetSettings({ projectId, source, sheet, canEdit, canCalibrate }: {
  projectId: string; source: RoofSourceRow; sheet: { key: string; signedUrl: string | null; isPdf: boolean; pageIndex: number }; canEdit: boolean
  /** calibrateFloorPlanAction admits ORG_WRITE_ROLES only (decision 3); say so up front rather than after the click. */
  canCalibrate: boolean
}) {
  const router = useRouter()
  const [tool, setTool] = useState<LayoutTool>('select')
  const [points, setPoints] = useState<number[] | null>(null)
  const [metres, setMetres] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState(source.updatedAt)

  async function calibrate() {
    if (!points || !source.floorPlanId) return
    const res = await calibrateFloorPlanAction({ floorPlanId: source.floorPlanId, points, realMetres: Number(metres), pageIndex: source.pageIndex })
    setMsg(res.error ?? `Scale set: ${res.pixelsPerMeter?.toFixed(1)} px/m.`)
    if (!res.error) { setPoints(null); setTool('select'); router.refresh() }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ fontSize: 13 }}>{source.label} · scale {source.pixelsPerMeter === null ? 'not set' : `${source.pixelsPerMeter.toFixed(1)} px/m`} · north {source.northSet ? `${source.northBearingDeg}°` : 'not set'}</p>
      {canEdit && (
        <div style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'center' }}>
          {source.kind === 'drawing' && <button type="button" disabled={!canCalibrate} onClick={() => { setPoints(null); setTool('calibrate') }}>Calibrate scale</button>}
          {source.kind === 'drawing' && !canCalibrate && <span>Only an owner, admin or project manager can set a drawing’s scale.</span>}
          <button type="button" onClick={() => setTool('north')}>Set north (click two points: from, then towards north)</button>
          {tool === 'calibrate' && points && (<>
            <label>Real distance m <input type="number" value={metres} onChange={(e) => setMetres(e.target.value)} style={{ width: 80 }} /></label>
            <button type="button" disabled={!(Number(metres) > 0)} onClick={() => void calibrate()}>Save scale</button>
          </>)}
        </div>
      )}
      {msg && <p role="status" style={{ fontSize: 12 }}>{msg}</p>}
      <SolarCanvas sheet={sheet} objects={[]} preview={null} selection={EMPTY_SELECTION} tool={tool} readOnly={!canEdit} circleMode={false}
        sheetPixelsPerMeter={source.pixelsPerMeter}
        onSelect={() => {}} onPolygon={() => {}} onCircle={() => {}} onPoint={() => {}} onBlock={() => {}} onModuleClick={() => {}} onTranslate={() => {}} onTransform={() => {}}
        onTwoPoints={(purpose, pts) => {
          if (purpose === 'calibrate') { setPoints(pts); return }
          if (purpose === 'north') {
            void setRoofNorthAction({ projectId, roofSourceId: source.id, bearingDeg: sheetBearing({ x: pts[0]!, y: pts[1]! }, { x: pts[2]!, y: pts[3]! }), points: pts, expectedUpdatedAt: updatedAt })
              .then((res) => {
                if ('error' in res) setMsg(res.error)
                else { setUpdatedAt(res.updatedAt); setMsg(`North set to ${res.bearingDeg}°.`); setTool('select'); router.refresh() }
              })
          }
        }} />
    </div>
  )
}
