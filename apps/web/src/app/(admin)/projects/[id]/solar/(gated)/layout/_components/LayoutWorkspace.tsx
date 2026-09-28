'use client'
/**
 * The Layout editor (functional spec §6.1): list + layers left, canvas centre,
 * properties + summary right. Owns the object list, snapshot history, IndexedDB
 * draft, dirty guard and the save. Everything it receives is JSON.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GENERIC_INVERTER_50KW, autoString, bomToCsv, diffObjects, isArrayObject, layoutBom, layoutSummary,
  removeModules, removeObjects, rotateObjects, sheetBearing, translateObjects,
  type LayoutObject, type ModuleRef, type ObstructionObject, type RoofObject,
} from '@esite/shared'
import { saveLayoutObjectsAction } from '@/actions/solar-layout.actions'
import { setRoofNorthAction } from '@/actions/solar-roof-sources.actions'
import { exportLayoutSheetAction } from '@/actions/solar-layout-export.actions'
import { emptyHistory, pushHistory, redoHistory, undoHistory } from '@/lib/solar/layout-history'
import { planModuleBlock } from '@/lib/solar/block-plan'
import { getDraft, setDraft, clearDraft } from '@/lib/sheet/draft-store'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import type { LayoutEditorData } from '@/lib/solar/layout-loader'
import { applySaveResult, draftOffer, exportBlockedBy, LAYERS, pruneSelection, restoreDraft, visibleObjects, type LayoutDraft } from '@/lib/solar/layout-editor-state'
import { EMPTY_SELECTION, type ExportJpeg, type LayoutTool, type Selection } from './SolarCanvas'
import { LayoutToolbar } from './LayoutToolbar'
import { PropertiesPanel } from './PropertiesPanel'
import { SummaryPanel } from './SummaryPanel'
import { AutoFillDialog } from './AutoFillDialog'

const SolarCanvas = dynamic(() => import('./SolarCanvas').then((m) => m.SolarCanvas), {
  ssr: false,
  loading: () => <div style={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-dim)' }}>Loading canvas…</div>,
})
const Layout3DPreview = dynamic(() => import('./Layout3DPreview').then((m) => m.Layout3DPreview), { ssr: false })

type Draft = LayoutDraft
const uuid = () => crypto.randomUUID()

export function LayoutWorkspace({ data, canEdit }: { data: LayoutEditorData; canEdit: boolean }) {
  const readOnly = !canEdit
  const draftKey = `solar-layout:${data.layout.id}`
  const [saved, setSaved] = useState<LayoutObject[]>(data.objects)
  const [hist, setHist] = useState(() => emptyHistory<LayoutObject[]>(data.objects))
  const objects = hist.present
  const [updatedAt, setUpdatedAt] = useState(data.layout.updatedAt)
  const [north, setNorth] = useState<number | null>(data.source.northBearingDeg)
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState(data.source.updatedAt)
  const [tool, setTool] = useState<LayoutTool>('select')
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [circleMode, setCircleMode] = useState(false)
  const [fallFor, setFallFor] = useState<string | null>(null)
  const [stringDraft, setStringDraft] = useState<{ inverterId: string | null; modules: ModuleRef[] }>({ inverterId: null, modules: [] })
  const [autoFillRoof, setAutoFillRoof] = useState<RoofObject | null>(null)
  const [preview, setPreview] = useState<number[][] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [restorable, setRestorable] = useState<{ draft: Draft; stale: boolean } | null>(null)
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(() => new Set())
  // A STABLE id for the auto-fill result: a fresh uuid() per render re-planned
  // and re-previewed on every render (review C1).
  const [fillId, setFillId] = useState('')
  const [show3d, setShow3d] = useState(false)
  const [northInput, setNorthInput] = useState(north === null ? '' : String(north))
  const exporterRef = useRef<ExportJpeg | null>(null)
  const onExporter = useCallback((fn: ExportJpeg | null) => { exporterRef.current = fn }, [])
  const conditions = { tMinC: data.layout.tMinC, tAmbMaxC: data.layout.tAmbMaxC }
  const calibrated = data.sheetPixelsPerMeter !== null

  const diff = useMemo(() => diffObjects(saved, objects), [saved, objects])
  const dirty = diff.upserts.length > 0 || diff.deletes.length > 0
  useSolarDirtyGuard(dirty && canEdit)

  const commit = useCallback((next: LayoutObject[]) => setHist((h) => pushHistory(h, next)), [])

  // Drafts: autosave every change; offer a restore when a stored draft differs
  // from the server copy — including a draft of an OLDER version (after a
  // stale-save refusal and a reload), flagged so, so work is never dropped.
  const [draftChecked, setDraftChecked] = useState(false)
  useEffect(() => {
    void getDraft<Draft>(draftKey).then((d) => {
      setRestorable(draftOffer(d ?? null, data.layout.updatedAt, data.objects))
      setDraftChecked(true)
    })
  }, [draftKey, data.layout.updatedAt, data.objects])
  useEffect(() => {
    // Never overwrite a draft the user has not yet restored or discarded.
    if (!canEdit || !draftChecked || restorable) return
    const t = setTimeout(() => { if (dirty) void setDraft<Draft>(draftKey, { objects, base: saved, basedOn: updatedAt, savedAt: new Date().toISOString() }) }, 500)
    return () => clearTimeout(t)
  }, [objects, saved, dirty, draftKey, updatedAt, canEdit, draftChecked, restorable])

  const roofs = objects.filter((o): o is RoofObject => o.kind === 'roof')
  const obstructions = objects.filter((o): o is ObstructionObject => o.kind === 'obstruction')
  const selectedObject = selection.ids.length === 1 ? objects.find((o) => o.id === selection.ids[0]) ?? null : null
  const roofUnder = (x: number, y: number) => roofs.find((r) => {
    const pts = r.geometry.points
    let inside = false
    for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
      const xi = pts[2 * i]!, yi = pts[2 * i + 1]!, xj = pts[2 * j]!, yj = pts[2 * j + 1]!
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }) ?? null

  async function save() {
    if (!dirty || saving) return
    setSaving(true); setMessage(null)
    const sent = objects
    const res = await saveLayoutObjectsAction({ projectId: data.projectId, layoutId: data.layout.id, expectedUpdatedAt: updatedAt,
      upserts: diff.upserts.map(({ id, kind, geometry, props }) => ({ id, kind, geometry, props })), deletes: diff.deletes })
    setSaving(false)
    if ('error' in res) { setMessage(res.error); return }
    if ('fieldErrors' in res) { setMessage(Object.values(res.fieldErrors)[0] ?? 'Could not save.'); return }
    // Fold into what the user has NOW: edits made during the round trip stay (review I3).
    setSaved(applySaveResult(sent, [], res.pixelsPerMeter).saved)
    setHist((h) => ({ ...h, present: applySaveResult(sent, h.present, res.pixelsPerMeter).present }))
    setUpdatedAt(res.updatedAt)
    await clearDraft(draftKey)
    setRestorable(null) // the stored draft is gone; a later Restore would revert this save
    setMessage('Saved.')
  }

  async function saveNorth(bearingDeg: number, points: number[] | null) {
    const res = await setRoofNorthAction({ projectId: data.projectId, roofSourceId: data.source.id, bearingDeg, points, expectedUpdatedAt: sourceUpdatedAt })
    if ('error' in res) { setMessage(res.error); return }
    setNorth(res.bearingDeg); setNorthInput(String(res.bearingDeg)); setSourceUpdatedAt(res.updatedAt); setMessage(`North set to ${res.bearingDeg}°.`)
  }

  function deleteSelection() {
    if (selection.modules.length) commit(removeModules(objects, selection.modules))
    else if (selection.ids.length) commit(removeObjects(objects, selection.ids))
    setSelection(EMPTY_SELECTION)
  }

  function finishString() {
    if (!stringDraft.inverterId || stringDraft.modules.length === 0) return
    const inv = objects.find((o) => o.id === stringDraft.inverterId)
    if (!inv || inv.kind !== 'inverter') return
    const used = new Map<number, number>()
    for (const s of objects) if (s.kind === 'string' && s.props.inverterId === inv.id) used.set(s.props.mppt, (used.get(s.props.mppt) ?? 0) + 1)
    let mppt = 1
    for (let m = 1; m <= inv.props.inverter.mppts; m++) if ((used.get(m) ?? 0) < (used.get(mppt) ?? 0)) mppt = m
    commit([...objects, { id: uuid(), kind: 'string', pixelsPerMeter: null, geometry: {}, props: { inverterId: inv.id, mppt, modules: stringDraft.modules } }])
    setStringDraft({ inverterId: inv.id, modules: [] })
  }

  function runAutoString(inverterId: string) {
    const inv = objects.find((o) => o.id === inverterId)
    const first = objects.find(isArrayObject)
    if (!inv || inv.kind !== 'inverter' || !first) { setMessage('Place an array and an inverter first.'); return }
    // Same module AND mounting (the check is computed for one mounting); strings
    // never span two arrays — autoString cuts per array (review I6).
    const sameModule = objects.filter(isArrayObject).filter((a) => a.props.module.model === first.props.module.model
      && a.props.module.make === first.props.module.make && a.props.mounting === first.props.mounting)
    try {
      const r = autoString({
        arrays: sameModule.map((a) => ({ id: a.id, quads: a.geometry.modules, facingSheetDeg: a.props.facingSheetDeg })),
        existingStrings: objects.flatMap((o) => (o.kind === 'string' ? [o.props] : [])),
        inverterId, inverter: inv.props.inverter, module: first.props.module, mounting: first.props.mounting, conditions,
      })
      commit([...objects, ...r.strings.map((s) => ({ id: uuid(), kind: 'string' as const, pixelsPerMeter: null, geometry: {} as Record<string, never>, props: { inverterId, mppt: s.mppt, modules: s.modules } }))])
      setMessage(`${r.strings.length} strings of ${r.stringLength}.${r.reason ? ` ${r.reason}` : ''}`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Auto-string failed.')
    }
  }

  async function exportSheet() {
    const blocked = exportBlockedBy(hiddenLayers)
    if (blocked) { setMessage(blocked); return }
    const shot = await exporterRef.current?.()
    if (!shot) { setMessage('The sheet is not ready yet.'); return }
    const res = await exportLayoutSheetAction({ projectId: data.projectId, layoutId: data.layout.id, jpegBase64: shot.jpegBase64, crop: shot.crop })
    setMessage('error' in res ? res.error : `Saved as version ${res.version} — listed under Exported sheets below.`)
  }

  function downloadBom() {
    const csv = bomToCsv(layoutBom(objects, layoutSummary(objects, conditions, data.sheetPixelsPerMeter), data.sheetPixelsPerMeter))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${data.layout.name.replace(/[^\w.-]+/g, '_')}-bom.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function openAutoFill() {
    const roof = selectedObject?.kind === 'roof' ? selectedObject : roofs.length === 1 ? roofs[0]! : null
    if (!roof) { setMessage('Select a roof area to fill.'); return }
    setFillId(uuid())
    setAutoFillRoof(roof)
  }

  // Keyboard (§6.3 keys). Skipped while typing. ⌘/Ctrl for undo/redo/save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); setHist((h) => (e.shiftKey ? redoHistory(h) : undoHistory(h))); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return }
      if (mod || e.altKey) return
      if (e.key === 'Escape') { setTool('select'); setStringDraft({ inverterId: null, modules: [] }); setAutoFillRoof(null); return }
      if (e.key === 'Enter' && tool === 'string') { finishString(); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) { e.preventDefault(); deleteSelection(); return }
      const map: Record<string, LayoutTool> = { v: 'select', m: 'measure', n: 'north', r: 'roof', o: 'obstruction', a: 'block', i: 'inverter', s: 'string', b: 'equipment' }
      const k = e.key.toLowerCase()
      if (k === 'f' && !readOnly && calibrated) { e.preventDefault(); openAutoFill(); return }
      const next = map[k]
      if (next && (!readOnly || next === 'select' || next === 'measure') && (calibrated || next === 'select' || next === 'measure' || next === 'north')) setTool(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const defaultSetback = (roofType: string) => (roofType === 'pitched' ? data.setbackDefaults.pitchedM : data.setbackDefaults.flatM)

  return (
    <div>
      {data.drawingChanged && (
        <p role="alert" style={{ padding: 8, border: '1px solid #b45309', color: '#b45309', borderRadius: 6 }}>
          The drawing has changed since this layout was drawn. The layout is shown where it was drawn and is not realigned.
        </p>
      )}
      {!calibrated && <p role="alert">This sheet has no scale yet. <a href={`/projects/${data.projectId}/solar/layout/sources/${data.source.id}`}>Calibrate it</a> before drawing.</p>}
      {restorable && (
        <p role="status">Unsaved changes from {new Date(restorable.draft.savedAt).toLocaleString('en-ZA')} were found
          {restorable.stale ? ' on an older version of this layout; they can be restored only if nobody else has changed the layout since' : ''}.{' '}
          <button type="button" onClick={() => {
            const r = restoreDraft(restorable.draft, saved, updatedAt)
            // A refusal keeps the draft stored and the banner up; only Discard drops it.
            if (!r.ok) { setMessage(r.error); return }
            commit(r.objects); setRestorable(null)
          }}>Restore</button>{' '}
          <button type="button" onClick={() => { void clearDraft(draftKey); setRestorable(null) }}>Discard</button>
        </p>
      )}
      <LayoutToolbar tool={tool} onTool={(t) => { setTool(t); if (t !== 'string') setStringDraft({ inverterId: null, modules: [] }) }}
        readOnly={readOnly} calibrated={calibrated} canUndo={hist.canUndo} canRedo={hist.canRedo} dirty={dirty} saving={saving}
        circleMode={circleMode} onCircleMode={setCircleMode} onUndo={() => setHist(undoHistory)} onRedo={() => setHist(redoHistory)}
        onSave={() => void save()} onAutoFill={openAutoFill} onExport={() => void exportSheet()} on3d={() => setShow3d((v) => !v)}
        traceHref={`/projects/${data.projectId}/cables`} />
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
          North (° clockwise from sheet-up) <input type="number" value={northInput} onChange={(e) => setNorthInput(e.target.value)} style={{ width: 70 }} />
          <button type="button" onClick={() => void saveNorth(Number(northInput), null)} disabled={northInput.trim() === '' || !Number.isFinite(Number(northInput))}>Set</button>
          {tool === 'string' && <span>{stringDraft.inverterId ? `String: ${stringDraft.modules.length} modules — Enter to finish` : 'Click an inverter, then modules in order'}</span>}
          {tool === 'string' && stringDraft.inverterId && stringDraft.modules.length > 0 && <button type="button" onClick={finishString}>Finish string</button>}
          {tool === 'fall' && <span>Click the ridge (high side), then the eave (low side) — the fall line runs downhill.</span>}
          {(selection.ids.length > 0 || selection.modules.length > 0) && <button type="button" onClick={deleteSelection}>Delete selection</button>}
        </div>
      )}
      {message && <p role="status" style={{ fontSize: 12 }}>{message}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0,1fr) 300px', gap: 12 }}>
        <aside aria-label="Layouts and layers" style={{ display: 'grid', gap: 12, alignContent: 'start', fontSize: 13 }}>
          <nav aria-label="Layouts">
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Layouts</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {data.siblings.map((l) => (
                <li key={l.id}>{l.id === data.layout.id
                  ? <strong aria-current="page">{l.name}</strong>
                  : <a href={`/projects/${data.projectId}/solar/layout/${l.id}`}>{l.name}</a>}</li>
              ))}
            </ul>
            <a href={`/projects/${data.projectId}/solar/layout`} style={{ fontSize: 12 }}>All layouts</a>
          </nav>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 600 }}>Layers</legend>
            {LAYERS.map((l) => (
              <label key={l.key} style={{ display: 'block' }}>
                <input type="checkbox" checked={!hiddenLayers.has(l.key)} onChange={() => {
                  const n = new Set(hiddenLayers)
                  if (n.has(l.key)) n.delete(l.key); else n.add(l.key)
                  setHiddenLayers(n)
                  setSelection((sel) => pruneSelection(sel, visibleObjects(objects, n)))
                }} /> {l.label}
              </label>
            ))}
          </fieldset>
        </aside>
        <div>
          <SolarCanvas onExporter={onExporter} sheet={data.source.sheet} objects={visibleObjects(objects, hiddenLayers)} preview={preview} selection={selection} tool={tool}
            readOnly={readOnly} circleMode={circleMode} sheetPixelsPerMeter={data.sheetPixelsPerMeter}
            onSelect={(sel) => {
              setSelection(sel)
              const one = sel.ids.length === 1 ? objects.find((o) => o.id === sel.ids[0]) : undefined
              if (tool === 'string' && one?.kind === 'inverter') setStringDraft({ inverterId: one.id, modules: [] })
            }}
            onPolygon={(kind, points) => {
              const id = uuid()
              commit([...objects, kind === 'roof'
                ? { id, kind: 'roof', pixelsPerMeter: null, geometry: { points }, props: { name: `Roof ${roofs.length + 1}`, roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: defaultSetback('flat'), maxLoadKgM2: null } }
                : { id, kind: 'obstruction', pixelsPerMeter: null, geometry: { points }, props: { name: `Obstruction ${obstructions.length + 1}`, setbackM: 0.5, heightM: 1 } }])
              setSelection({ ids: [id], modules: [] })
            }}
            onCircle={(cx, cy, r) => commit([...objects, { id: uuid(), kind: 'obstruction', pixelsPerMeter: null, geometry: { cx, cy, r }, props: { name: `Obstruction ${obstructions.length + 1}`, setbackM: 0.3, heightM: 1 } }])}
            onPoint={(kind, x, y) => commit([...objects, kind === 'inverter'
              ? { id: uuid(), kind: 'inverter', pixelsPerMeter: null, geometry: { x, y }, props: { name: `INV-${objects.filter((o) => o.kind === 'inverter').length + 1}`, inverter: GENERIC_INVERTER_50KW } }
              : { id: uuid(), kind: 'equipment', pixelsPerMeter: null, geometry: { x, y }, props: { equipmentKind: 'combiner', name: 'Combiner', nodeId: null } }])}
            onBlock={(a, b) => {
              const roof = roofUnder(a.x, a.y)
              if (!roof) { setMessage('Start the block inside a roof area.'); return }
              const plan = planModuleBlock({ roof, obstructions, sheetPixelsPerMeter: data.sheetPixelsPerMeter, startPx: a, endPx: b,
                module: data.layout.moduleSpec, orientation: 'portrait', mounting: 'flush', tiltDeg: roof.props.roofType === 'pitched' ? roof.props.pitchDeg : 0,
                facingSheetDeg: roof.props.fallBearingDeg ?? 0, gapM: 0.02, rowPitchM: null }, uuid())
              if (plan.ok) commit([...objects, plan.object])
              else setMessage(plan.error)
            }}
            onTwoPoints={(purpose, pts) => {
              const bearing = sheetBearing({ x: pts[0]!, y: pts[1]! }, { x: pts[2]!, y: pts[3]! })
              if (purpose === 'north') void saveNorth(bearing, pts)
              if (purpose === 'fall' && fallFor) {
                commit(objects.map((o) => (o.id === fallFor && o.kind === 'roof' ? { ...o, props: { ...o.props, fallBearingDeg: bearing } } : o)))
                setFallFor(null); setTool('select')
              }
            }}
            onModuleClick={(ref) => {
              if (!stringDraft.inverterId) { setMessage('Click an inverter first.'); return }
              if (stringDraft.modules.some((m) => m.arrayId === ref.arrayId && m.index === ref.index)) return
              setStringDraft((d) => ({ ...d, modules: [...d.modules, ref] }))
            }}
            onTranslate={(ids, dx, dy) => commit(translateObjects(objects, ids, dx, dy))}
            onTransform={(ids, deg, dx, dy) => commit(translateObjects(rotateObjects(objects, ids, deg, { x: 0, y: 0 }), ids, dx, dy))}
          />
          {show3d && <Layout3DPreview objects={objects} framePpm={data.sheetPixelsPerMeter} />}
        </div>
        <aside style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {autoFillRoof && (
            <AutoFillDialog roof={autoFillRoof} obstructions={obstructions} sheetPixelsPerMeter={data.sheetPixelsPerMeter} latDeg={data.latitude}
              northBearingDeg={north} module={data.layout.moduleSpec} defaultTiltDeg={data.layout.defaultTiltDeg} shadeFree={data.shadeFree}
              newId={fillId} onPreview={setPreview} onClose={() => setAutoFillRoof(null)}
              onPlace={(plan) => { commit([...objects, plan.object]); setAutoFillRoof(null); setPreview(null) }} />
          )}
          <PropertiesPanel object={selectedObject} objects={objects} northBearingDeg={north} conditions={conditions} nodes={data.nodes} readOnly={readOnly}
            onChange={(next) => commit(objects.map((o) => (o.id === next.id ? next : o)))}
            onDrawFallLine={(roofId) => { setFallFor(roofId); setTool('fall') }} onAutoString={runAutoString} />
          <SummaryPanel objects={objects} conditions={conditions} layoutName={data.layout.name} onDownloadBom={downloadBom} fallbackPpm={data.sheetPixelsPerMeter} />
        </aside>
      </div>
    </div>
  )
}
