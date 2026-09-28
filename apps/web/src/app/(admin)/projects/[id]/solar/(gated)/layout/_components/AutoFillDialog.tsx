'use client'
/** Auto-fill dialog (functional spec §6.3 "F"): options → live preview on the canvas → Place. */
import { useEffect, useMemo, useState } from 'react'
import { planAutoFill, type AutoFillPlan, type AutoFillRequest } from '@/lib/solar/auto-fill-plan'
import type { LayoutModuleSpec, ObstructionObject, RoofObject } from '@esite/shared'

export function AutoFillDialog(p: {
  roof: RoofObject; obstructions: ObstructionObject[]; sheetPixelsPerMeter: number | null; latDeg: number | null
  northBearingDeg: number | null; module: LayoutModuleSpec; defaultTiltDeg: number; shadeFree: { fromHour: number; toHour: number }
  newId: string; onPreview(quads: number[][] | null): void; onPlace(plan: Extract<AutoFillPlan, { ok: true }>): void; onClose(): void
}) {
  const pitched = p.roof.props.roofType === 'pitched'
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [mode, setMode] = useState<'racked' | 'flat'>(pitched ? 'flat' : 'racked')
  const [tilt, setTilt] = useState(String(p.defaultTiltDeg))
  const [spacing, setSpacing] = useState<'auto' | 'manual'>('auto')
  const [pitch, setPitch] = useState('4')
  const [gap, setGap] = useState('20')

  const req: AutoFillRequest = {
    roof: p.roof, obstructions: p.obstructions, sheetPixelsPerMeter: p.sheetPixelsPerMeter, latDeg: p.latDeg,
    northBearingDeg: p.northBearingDeg, module: p.module, orientation, mode, tiltDeg: Number(tilt) || 0,
    rowSpacing: spacing === 'auto' ? { kind: 'auto' } : { kind: 'manual', pitchM: Number(pitch) || 0 },
    gapMm: Number(gap) || 0, shadeFree: p.shadeFree,
  }
  const plan = useMemo(() => planAutoFill(req, p.newId), [JSON.stringify(req), p.newId]) // eslint-disable-line react-hooks/exhaustive-deps
  const { onPreview } = p
  useEffect(() => { onPreview(plan.ok ? plan.object.geometry.modules : null) }, [plan, onPreview])
  useEffect(() => () => onPreview(null), [onPreview])

  return (
    <div role="dialog" aria-label="Auto-fill array" style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, display: 'grid', gap: 6, fontSize: 13, background: 'var(--c-surface, white)' }}>
      <strong>Auto-fill {p.roof.props.name}</strong>
      {pitched
        ? <div>Flush on the {p.roof.props.pitchDeg}° pitch, along the drawn fall line.</div>
        : (
          <label>Layout <select value={mode} onChange={(e) => setMode(e.target.value as 'racked' | 'flat')}>
            <option value="racked">Tilted racking rows</option><option value="flat">Flat-mount</option></select></label>
        )}
      <label>Orientation <select value={orientation} onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}>
        <option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      {!pitched && mode === 'racked' && (
        <>
          <label>Tilt ° <input type="number" value={tilt} onChange={(e) => setTilt(e.target.value)} style={{ width: 70 }} /></label>
          <label>Row spacing <select value={spacing} onChange={(e) => setSpacing(e.target.value as 'auto' | 'manual')}>
            <option value="auto">Auto — no shade {p.shadeFree.fromHour}:00–{p.shadeFree.toHour}:00 on 21 June</option><option value="manual">Manual pitch</option></select></label>
          {spacing === 'manual' && <label>Pitch m <input type="number" value={pitch} onChange={(e) => setPitch(e.target.value)} style={{ width: 70 }} /></label>}
        </>
      )}
      <label>Module gap mm <input type="number" value={gap} onChange={(e) => setGap(e.target.value)} style={{ width: 70 }} /></label>
      {plan.ok
        ? <div>{plan.count} modules · {((plan.count * p.module.powerW) / 1000).toFixed(2)} kWp{plan.alphaDeg !== null ? ` · design sun ${plan.alphaDeg.toFixed(1)}°` : ''}</div>
        : <p role="alert" style={{ color: '#dc2626' }}>{plan.error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!plan.ok || plan.count === 0} onClick={() => { if (plan.ok) p.onPlace(plan) }}>Place</button>
        <button type="button" onClick={p.onClose}>Cancel</button>
      </div>
    </div>
  )
}
