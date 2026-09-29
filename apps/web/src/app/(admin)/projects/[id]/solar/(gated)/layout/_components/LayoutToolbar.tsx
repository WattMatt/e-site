'use client'
/** Toolbar (functional spec §6.3). Drawing tools need a scale; View level gets navigation only. */
import Link from 'next/link'
import type { LayoutTool } from './SolarCanvas'

const DRAW: Array<{ tool: LayoutTool; label: string }> = [
  { tool: 'north', label: 'Set north (N)' },
  { tool: 'roof', label: 'Roof area (R)' },
  { tool: 'obstruction', label: 'Obstruction (O)' },
  { tool: 'block', label: 'Place array (A)' },
  { tool: 'inverter', label: 'Inverter (I)' },
  { tool: 'string', label: 'Assign strings (S)' },
  { tool: 'equipment', label: 'Battery / DB / combiner (B)' },
]

export function LayoutToolbar(p: {
  tool: LayoutTool; onTool(t: LayoutTool): void; readOnly: boolean; calibrated: boolean
  canUndo: boolean; canRedo: boolean; dirty: boolean; saving: boolean
  circleMode: boolean; onCircleMode(v: boolean): void
  onUndo(): void; onRedo(): void; onSave(): void; onAutoFill(): void; onExport(): void; on3d(): void
  traceHref: string
}) {
  const btn = (active: boolean) => ({ padding: '4px 8px', fontSize: 12, border: '1px solid var(--c-border)', borderRadius: 6, background: active ? 'var(--c-amber)' : 'transparent' })
  return (
    <div role="toolbar" aria-label="Layout tools" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 8 }}>
      <button type="button" style={btn(p.tool === 'select')} onClick={() => p.onTool('select')}>Select (V)</button>
      <button type="button" style={btn(p.tool === 'measure')} onClick={() => p.onTool('measure')}>Measure (M)</button>
      {!p.readOnly && (
        <>
          {DRAW.map((d) => (
            <button key={d.tool} type="button" style={btn(p.tool === d.tool)} disabled={!p.calibrated && d.tool !== 'north'}
              title={!p.calibrated && d.tool !== 'north' ? 'Calibrate this page first' : undefined} onClick={() => p.onTool(d.tool)}>{d.label}</button>
          ))}
          {p.tool === 'obstruction' && (
            <label style={{ fontSize: 12 }}><input type="checkbox" checked={p.circleMode} onChange={(e) => p.onCircleMode(e.target.checked)} /> Circle</label>
          )}
          <button type="button" style={btn(false)} disabled={!p.calibrated} title={!p.calibrated ? 'Calibrate this page first' : undefined} onClick={p.onAutoFill}>Auto-fill array (F)</button>
          <Link href={p.traceHref} style={{ fontSize: 12 }} title="Create the inverter → point-of-connection supply in the cable schedule, then trace it on its measure page">Trace AC cable</Link>
          <span style={{ width: 8 }} />
          <button type="button" style={btn(false)} disabled={!p.canUndo} onClick={p.onUndo}>Undo (⌘Z)</button>
          <button type="button" style={btn(false)} disabled={!p.canRedo} onClick={p.onRedo}>Redo (⇧⌘Z)</button>
          <button type="button" style={btn(p.dirty)} disabled={p.saving || !p.dirty} onClick={p.onSave}>{p.saving ? 'Saving…' : `Save (⌘S)${p.dirty ? ' •' : ''}`}</button>
          <button type="button" style={btn(false)} disabled={p.dirty} title={p.dirty ? 'Save before exporting' : undefined} onClick={p.onExport}>Export layout sheet</button>
        </>
      )}
      <button type="button" style={btn(false)} onClick={p.on3d}>3D preview</button>
    </div>
  )
}
