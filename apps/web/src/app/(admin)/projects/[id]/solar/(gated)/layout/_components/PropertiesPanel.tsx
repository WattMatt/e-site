'use client'
/** Properties of the selection (functional spec §6.4). Every commit is one history step. */
import { useEffect, useState } from 'react'
import {
  LAYOUT_EQUIPMENT_KINDS, ROOF_TYPES, arrayAzimuth, isArrayObject, stringCheck, trueAzimuth, sheetBearingForAzimuth,
  type DesignConditions, type LayoutObject,
} from '@esite/shared'

function Num({ label, value, onCommit, step = 0.1, disabled }: { label: string; value: number | null; onCommit(v: number | null): void; step?: number; disabled?: boolean }) {
  const [v, setV] = useState(value === null ? '' : String(value))
  useEffect(() => setV(value === null ? '' : String(value)), [value])
  const commit = () => {
    const n = v.trim() === '' ? null : Number(v)
    if (n === null || Number.isFinite(n)) onCommit(n)
    else setV(value === null ? '' : String(value))
  }
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>{label}
      <input type="number" step={step} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }} style={{ width: 90 }} />
    </label>
  )
}

function Txt({ label, value, onCommit, disabled }: { label: string; value: string; onCommit(v: string): void; disabled?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>{label}
      <input value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={(e) => { if (e.key === 'Enter') onCommit(v) }} style={{ width: 140 }} />
    </label>
  )
}

export function PropertiesPanel({
  object, objects, northBearingDeg, conditions, nodes, readOnly, onChange, onDrawFallLine, onAutoString,
}: {
  object: LayoutObject | null; objects: LayoutObject[]; northBearingDeg: number | null; conditions: DesignConditions
  nodes: Array<{ id: string; label: string }>; readOnly: boolean
  onChange(next: LayoutObject): void; onDrawFallLine(roofId: string): void; onAutoString(inverterId: string): void
}) {
  if (!object) return <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Select an object to see its properties.</p>
  const d = readOnly
  const set = (patch: Record<string, unknown>) => onChange({ ...object, props: { ...object.props, ...patch } } as LayoutObject)
  const box = { display: 'grid', gap: 6, fontSize: 13 } as const

  if (object.kind === 'roof') {
    const p = object.props
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>Roof</h3>
        <Txt label="Name" value={p.name} disabled={d} onCommit={(name) => set({ name })} />
        <label style={{ display: 'flex', justifyContent: 'space-between' }}>Type
          <select value={p.roofType} disabled={d} onChange={(e) => set({ roofType: e.target.value })}>{ROOF_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <Num label="Pitch °" value={p.pitchDeg} disabled={d} onCommit={(v) => set({ pitchDeg: v ?? 0 })} />
        <Num label="Pitch direction (azimuth °)" disabled={d || northBearingDeg === null}
          value={p.fallBearingDeg === null || northBearingDeg === null ? null : Math.round(trueAzimuth(p.fallBearingDeg, northBearingDeg) * 10) / 10}
          onCommit={(v) => set({ fallBearingDeg: v === null || northBearingDeg === null ? null : sheetBearingForAzimuth(v, northBearingDeg) })} />
        {!d && <button type="button" onClick={() => onDrawFallLine(object.id)}>Draw fall line</button>}
        <Num label="Height m" value={p.heightM} disabled={d} onCommit={(v) => set({ heightM: v ?? 0 })} />
        <Num label="Edge setback m" value={p.setbackM} disabled={d} onCommit={(v) => set({ setbackM: Math.max(0, v ?? 0) })} />
        <Num label="Max load kg/m² (note)" value={p.maxLoadKgM2} disabled={d} onCommit={(v) => set({ maxLoadKgM2: v })} />
      </div>
    )
  }
  if (object.kind === 'obstruction') {
    const p = object.props
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>Obstruction</h3>
        <Txt label="Name" value={p.name} disabled={d} onCommit={(name) => set({ name })} />
        <Num label="Setback m" value={p.setbackM} disabled={d} onCommit={(v) => set({ setbackM: Math.max(0, v ?? 0) })} />
        <Num label="Height m" value={p.heightM} disabled={d} onCommit={(v) => set({ heightM: Math.max(0, v ?? 0) })} />
      </div>
    )
  }
  if (isArrayObject(object)) {
    const p = object.props
    const az = arrayAzimuth(p, northBearingDeg)
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>{object.kind === 'array' ? 'Array' : 'Module block'}</h3>
        <div>{p.module.make} {p.module.model}</div>
        <div>{object.geometry.modules.length} modules · {((object.geometry.modules.length * p.module.powerW) / 1000).toFixed(2)} kWp</div>
        <div>{p.orientation} · {p.mounting} · tilt {p.tiltDeg}° · row pitch {p.rowPitchM.toFixed(2)} m</div>
        <div>Azimuth {az === null ? 'needs north' : `${az.toFixed(1)}°`}</div>
        <Num label="Azimuth override °" value={p.azimuthOverrideDeg} disabled={d} onCommit={(v) => set({ azimuthOverrideDeg: v })} />
      </div>
    )
  }
  if (object.kind === 'inverter') {
    const inv = object.props.inverter
    const setInv = (patch: Record<string, unknown>) => set({ inverter: { ...inv, ...patch } })
    const strings = objects.filter((o) => o.kind === 'string' && o.props.inverterId === object.id)
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>Inverter</h3>
        <Txt label="Name" value={object.props.name} disabled={d} onCommit={(name) => set({ name })} />
        <Txt label="Model" value={inv.model} disabled={d} onCommit={(model) => setInv({ model })} />
        <Num label="AC kW" value={inv.acKw} disabled={d} onCommit={(v) => setInv({ acKw: v ?? inv.acKw })} />
        <Num label="MPPTs" step={1} value={inv.mppts} disabled={d} onCommit={(v) => setInv({ mppts: Math.max(1, Math.round(v ?? 1)) })} />
        <Num label="Max DC V" value={inv.vDcMax} disabled={d} onCommit={(v) => setInv({ vDcMax: v ?? inv.vDcMax })} />
        <Num label="MPPT min V" value={inv.vMpptMin} disabled={d} onCommit={(v) => setInv({ vMpptMin: v ?? inv.vMpptMin })} />
        <Num label="MPPT max V" value={inv.vMpptMax} disabled={d} onCommit={(v) => setInv({ vMpptMax: v ?? inv.vMpptMax })} />
        <Num label="Max input A / MPPT" value={inv.iMpptMax} disabled={d} onCommit={(v) => setInv({ iMpptMax: v ?? inv.iMpptMax })} />
        <div>Strings per MPPT: {Array.from({ length: inv.mppts }, (_, i) => strings.filter((s) => s.kind === 'string' && s.props.mppt === i + 1).length).join(' · ')}</div>
        {!d && <button type="button" onClick={() => onAutoString(object.id)}>Auto-string</button>}
      </div>
    )
  }
  if (object.kind === 'string') {
    const inv = objects.find((o) => o.id === object.props.inverterId)
    const first = objects.find((o) => o.id === object.props.modules[0]?.arrayId)
    const onMppt = objects.filter((o) => o.kind === 'string' && o.props.inverterId === object.props.inverterId && o.props.mppt === object.props.mppt).length
    const r = inv?.kind === 'inverter' && first && isArrayObject(first) && object.props.modules.length > 0
      ? stringCheck(first.props.module, inv.props.inverter, object.props.modules.length, onMppt, first.props.mounting, conditions) : null
    return (
      <div style={box}>
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>String</h3>
        <div>{object.props.modules.length} modules on MPPT {object.props.mppt}</div>
        <Num label="MPPT" step={1} value={object.props.mppt} disabled={d} onCommit={(v) => set({ mppt: Math.max(1, Math.round(v ?? 1)) })} />
        {r && (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {r.checks.map((c) => <li key={c.id} style={{ color: c.status === 'fail' ? '#dc2626' : c.status === 'warn' ? '#b45309' : 'inherit' }}>
              {c.id === 'voc-cold' ? 'Voc (cold)' : c.id === 'vmp-hot' ? 'Vmp (hot)' : c.id === 'vmp-cold' ? 'Vmp (cold)' : 'Current'}: {c.value.toFixed(1)} vs {c.limit} — {c.status}
            </li>)}
          </ul>
        )}
      </div>
    )
  }
  const p = object.props
  return (
    <div style={box}>
      <h3 style={{ fontSize: 13, fontWeight: 600 }}>Equipment</h3>
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>Kind
        <select value={p.equipmentKind} disabled={d} onChange={(e) => set({ equipmentKind: e.target.value })}>{LAYOUT_EQUIPMENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      </label>
      <Txt label="Name" value={p.name} disabled={d} onCommit={(name) => set({ name })} />
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>Board
        <select value={p.nodeId ?? ''} disabled={d} onChange={(e) => set({ nodeId: e.target.value || null })}>
          <option value="">— none —</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </label>
      {p.equipmentKind === 'db' && !p.nodeId && <p role="alert" style={{ color: '#dc2626' }}>Link the DB symbol to a board.</p>}
    </div>
  )
}
