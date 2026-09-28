'use client'
/**
 * Schematic editor (functional spec §13.2): tools V/P/C, Del, ⌘Z / ⇧⌘Z, ⌘S; layers; connections
 * manager; explicit save with stale-write refusal and an IndexedDB draft between saves; PDF sheet
 * export (projects.reports kind solar_schematic_sheet) and SVG download with the background embedded.
 *
 * View level: the diagram, layers, SVG download and saved sheets only — no tools, no save, no
 * export PDF, no include toggle, no connection editing, no draft.
 *
 * Removing a card or line here is a single step on purpose: it is undoable (⌘Z) and nothing is
 * written until Save. Replace drawing (persisted at once) is two-step inside its dialog.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from 'react'
import { useRouter } from 'next/navigation'
import { exportSchematicSheetAction, saveSchematicAction, setIncludeInLoadAction } from '@/actions/solar-schematics.actions'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { downloadBlob } from '@/components/charts/export'
import { clearDraft, getDraft, setDraft } from '@/lib/sheet/draft-store'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import {
  addLine, historyCommit, historyInit, historyRedo, historyUndo, linePoints, moveCard, placeCard, removeCard, removeLine, resizeCard,
  setWaypoints, snapCard, toSavePayload, type History, type SchematicDoc,
} from '@/lib/solar/schematics/editor'
import { buildSchematicSvg } from '@/lib/solar/schematics/svg'
import type { EditorMeter, EditorView } from '@/lib/solar/schematics/view-types'
import { ReplaceDrawingDialog } from '../../_components/ReplaceDrawingDialog'
import type { CanvasHandle, Layers, PressEvent, SchematicCanvasProps, Tool } from './SchematicCanvas'
import { ConnectionsManager } from './ConnectionsManager'
import { PlaceMeterDialog } from './PlaceMeterDialog'

const SchematicCanvas = dynamic(() => import('./SchematicCanvas').then((m) => m.SchematicCanvas), {
  ssr: false,
  loading: () => <div style={{ padding: 32 }}>Loading editor…</div>,
}) as unknown as ForwardRefExoticComponent<SchematicCanvasProps & RefAttributes<CanvasHandle>>

const SNAP_TOL = 8

export function SchematicWorkspace({ projectId, view, canEdit }: { projectId: string; view: EditorView; canEdit: boolean }) {
  const router = useRouter()
  const draftKey = `solar-schematic:${view.schematic.id}`
  const canvasRef = useRef<CanvasHandle | null>(null)
  const [history, setHistory] = useState<History<SchematicDoc>>(() => historyInit(view.doc))
  const [live, setLive] = useState<SchematicDoc | null>(null)
  const doc = live ?? history.present
  const [meters, setMeters] = useState<EditorMeter[]>(view.meters)
  const meterMap = useMemo(() => new Map(meters.map((m) => [m.id, m])), [meters])
  const [tool, setTool] = useState<Tool>('select')
  const [layers, setLayers] = useState<Layers>({ background: true, meters: true, lines: true })
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [selectedLine, setSelectedLine] = useState<string | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [draft, setDraftPts] = useState<number[]>([])
  const [guides, setGuides] = useState<Array<{ axis: 'x' | 'y'; at: number }>>([])
  const [placeAt, setPlaceAt] = useState<{ x: number; y: number } | null>(null)
  const [version, setVersion] = useState(view.schematic.updatedAt)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [restorable, setRestorable] = useState<SchematicDoc | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [pageInfo, setPageInfo] = useState<{ page: number; count: number } | null>(null)
  useSolarDirtyGuard(dirty)

  // A draft saved against THIS version (a crash or tab close) can be restored.
  useEffect(() => {
    if (!canEdit) return
    let live = true
    void getDraft<{ doc: SchematicDoc; basedOn: string }>(draftKey).then((d) => {
      if (live && d && d.basedOn === view.schematic.updatedAt && JSON.stringify(d.doc) !== JSON.stringify(view.doc)) setRestorable(d.doc)
    })
    return () => { live = false }
  }, [canEdit, draftKey, view.schematic.updatedAt, view.doc])

  const commit = useCallback((next: SchematicDoc) => {
    setHistory((h) => historyCommit(h, next))
    setLive(null)
    setDirty(true)
  }, [])
  // The draft follows history.present — new edits, undo and redo alike — while there are unsaved changes.
  useEffect(() => {
    if (!canEdit || !dirty) return
    void setDraft(draftKey, { doc: history.present, basedOn: version })
  }, [canEdit, dirty, draftKey, history.present, version])
  const fail = useCallback((text: string) => setMsg({ ok: false, text }), [])

  const onPress = useCallback((e: PressEvent) => {
    setMsg(null)
    if (!canEdit) return
    if (tool === 'place') {
      if (e.kind === 'empty') setPlaceAt({ x: e.x, y: e.y })
      return
    }
    if (tool === 'connect') {
      if (e.kind === 'card' && e.id) {
        if (!connectFrom) { setConnectFrom(e.id); setDraftPts([]); return }
        if (e.id === connectFrom) return
        const r = addLine(doc, { fromMeterId: connectFrom, toMeterId: e.id, waypoints: draft, lineType: 'supply' }, view.externalLines)
        setConnectFrom(null); setDraftPts([])
        if (!r.ok) { fail(r.reason); return }
        commit(r.doc)
        return
      }
      if (e.kind === 'empty' && connectFrom && draft.length < 400) setDraftPts((d) => [...d, e.x, e.y])
      return
    }
    if (e.kind === 'card') { setSelectedCard(e.id ?? null); setSelectedLine(null) }
    else if (e.kind === 'line') { setSelectedLine(e.id ?? null); setSelectedCard(null) }
    else { setSelectedCard(null); setSelectedLine(null) }
  }, [canEdit, tool, connectFrom, doc, draft, view.externalLines, commit, fail])

  // Nothing to undo / redo is a no-op: it must not mark the schematic dirty (⌘Z works with the button disabled).
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0
  const undo = useCallback(() => { if (!canUndo) return; setLive(null); setHistory((h) => historyUndo(h)); setDirty(true) }, [canUndo])
  const redo = useCallback(() => { if (!canRedo) return; setLive(null); setHistory((h) => historyRedo(h)); setDirty(true) }, [canRedo])
  const del = useCallback(() => {
    if (selectedCard) { commit(removeCard(doc, selectedCard)); setSelectedCard(null) }
    else if (selectedLine) { commit(removeLine(doc, selectedLine)); setSelectedLine(null) }
  }, [selectedCard, selectedLine, doc, commit])

  const save = useCallback(async () => {
    setBusy(true); setMsg(null)
    const payload = toSavePayload(history.present)
    const r = await saveSchematicAction({ projectId, schematicId: view.schematic.id, expectedUpdatedAt: version, cards: payload.cards, lines: payload.lines })
    setBusy(false)
    if ('error' in r) { fail(r.error); return }
    setVersion(r.updatedAt)
    setDirty(false)
    setRestorable(null)
    void clearDraft(draftKey)
    setMsg({ ok: true, text: 'Saved. The Load tab uses the new hierarchy at the next rebuild.' })
  }, [history.present, projectId, view.schematic.id, version, draftKey, fail])

  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (!busy) void save(); return }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod) return
      if (e.key === 'v' || e.key === 'V') setTool('select')
      else if (e.key === 'p' || e.key === 'P') setTool('place')
      else if (e.key === 'c' || e.key === 'C') { setTool('connect'); setConnectFrom(null); setDraftPts([]) }
      else if (e.key === 'Escape') { setConnectFrom(null); setDraftPts([]); setPlaceAt(null) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEdit, busy, save, undo, redo, del])

  const placedIds = doc.cards.map((c) => c.meterId)
  const unplaced = meters.filter((m) => !placedIds.includes(m.id))
  const tb = (label: string, active: boolean, onClick: () => void, disabled = false) => (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick}
      style={{ background: active ? 'var(--c-amber-mid)' : undefined, fontSize: 12 }}>{label}</button>
  )

  async function exportPdf() {
    const shot = canvasRef.current?.exportJpeg()
    if (!shot) { fail('The sheet is still loading — try again in a moment.'); return }
    setBusy(true); setMsg(null)
    const r = await exportSchematicSheetAction({ projectId, schematicId: view.schematic.id, jpegBase64: shot.base64, crop: { w: shot.w, h: shot.h }, note: null })
    setBusy(false)
    if ('error' in r) { fail(r.error); return }
    setMsg({ ok: true, text: `Sheet version ${r.version} saved to Exported sheets of this schematic.${dirty ? ' It shows the canvas as drawn, including unsaved changes.' : ''}` })
    setReloadKey((k) => k + 1)
  }
  function exportSvg() {
    const size = canvasRef.current?.size() ?? { w: view.schematic.canvasW, h: view.schematic.canvasH }
    const svg = buildSchematicSvg({
      width: size.w, height: size.h, backgroundDataUrl: canvasRef.current?.backgroundDataUrl() ?? null, layers,
      cards: doc.cards.map((c) => {
        const m = meterMap.get(c.meterId)
        return { ...c, label: m?.label ?? 'Meter', sublabel: `${m?.kind ?? ''}${m?.tenantLabel ? ` · ${m.tenantLabel}` : ''}`, included: m?.included ?? null }
      }),
      lines: doc.lines.map((l) => ({ points: linePoints(l, doc) ?? [], lineType: l.lineType })),
    })
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${view.schematic.name.replace(/[^A-Za-z0-9._ -]+/g, '_')}.svg`)
  }

  async function toggleInclude(meterId: string) {
    if (!canEdit) return
    const m = meterMap.get(meterId)
    if (!m) return
    if (!m.nodeId) { fail('Link this meter to a tenant first (Load → Meters → Details).'); return }
    const include = m.included !== true
    setMsg(null)
    const r = await setIncludeInLoadAction({ projectId, meterId, include })
    if ('error' in r) { fail(r.error); return }
    // Excluding one meter excludes its tenant: every card of that tenant takes the returned state.
    setMeters((ms) => ms.map((x) => (x.id in r.included ? { ...x, included: r.included[x.id] ?? null } : x.id === meterId ? { ...x, included: include } : x)))
    setMsg({ ok: true, text: `${m.label} ${include ? 'included in' : 'excluded from'} the site load — rebuild the site profile to apply.` })
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{view.schematic.name}</h2>
        {view.sheet && <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{view.sheet.name} · page {pageInfo?.page ?? view.schematic.pageIndex}{pageInfo ? ` of ${pageInfo.count}` : ''}</span>}
        {canEdit && (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, marginLeft: 12 }}>
            {tb('Select (V)', tool === 'select', () => setTool('select'))}
            {tb('Place meter (P)', tool === 'place', () => setTool('place'))}
            {tb('Connect (C)', tool === 'connect', () => { setTool('connect'); setConnectFrom(null); setDraftPts([]) })}
            {tb('Undo (⌘Z)', false, undo, history.past.length === 0)}
            {tb('Redo (⇧⌘Z)', false, redo, history.future.length === 0)}
            {tb('Delete (Del)', false, del, !selectedCard && !selectedLine)}
            {tb(busy ? 'Saving…' : 'Save (⌘S)', false, () => void save(), busy)}
            {view.schematic.kind === 'drawing' && tb(dirty ? 'Replace drawing (save first)' : 'Replace drawing', false, () => setReplacing(true), dirty)}
          </span>
        )}
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, marginLeft: 'auto', fontSize: 12 }}>
          {(['meters', 'lines', 'background'] as const).map((k) => (
            <label key={k}><input type="checkbox" aria-label={`${k[0]!.toUpperCase()}${k.slice(1)} layer`} checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {k}</label>
          ))}
          {canEdit && <button type="button" disabled={busy} onClick={() => void exportPdf()}>Export PDF sheet</button>}
          <button type="button" onClick={exportSvg}>Download SVG</button>
        </span>
      </header>
      {view.schematic.anchorChanged && <p role="status" style={{ background: 'var(--c-amber-dim)', padding: '6px 10px', borderRadius: 6, fontSize: 13, margin: 0 }}>The drawing has a newer file than the one this schematic was drawn on — positions may need adjusting.</p>}
      {restorable && canEdit && (
        <p role="status" style={{ fontSize: 13, margin: 0 }}>Unsaved changes from an earlier session were found.{' '}
          <button type="button" onClick={() => { commit(restorable); setRestorable(null) }}>Restore</button>{' '}
          <button type="button" onClick={() => { void clearDraft(draftKey); setRestorable(null) }}>Discard</button>
        </p>
      )}
      {tool === 'connect' && canEdit && <p style={{ fontSize: 12, margin: 0, color: 'var(--c-text-mid)' }}>{connectFrom ? `From ${meterMap.get(connectFrom)?.label ?? 'meter'}: click empty space to add waypoints, then the child meter. Esc cancels.` : 'Click the parent (supply) meter.'}</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--c-text-mid)' : '#dc2626', fontSize: 13, margin: 0 }}>{msg.text}</p>}
      <SchematicCanvas
        ref={canvasRef}
        sheet={view.sheet}
        pageIndex={view.schematic.pageIndex}
        blank={{ w: view.schematic.canvasW, h: view.schematic.canvasH }}
        doc={doc}
        meters={meterMap}
        tool={canEdit ? tool : 'select'}
        layers={layers}
        editable={canEdit}
        selectedCard={selectedCard}
        selectedLine={selectedLine}
        connectFrom={connectFrom}
        draftWaypoints={draft}
        guides={guides}
        onPress={onPress}
        onPageInfo={(page, count) => setPageInfo((p) => (p && p.page === page && p.count === count ? p : { page, count }))}
        onCardDrag={(id, x, y, shift, end) => {
          if (!canEdit) return
          const card = history.present.cards.find((c) => c.meterId === id)
          if (!card) return
          const snapped = shift ? snapCard({ ...card, x, y }, history.present.cards, SNAP_TOL) : { x, y, guides: [] }
          setGuides(end ? [] : snapped.guides)
          const next = moveCard(history.present, id, snapped.x, snapped.y)
          if (end) commit(next); else setLive(next)
        }}
        onResize={(id, w, h, end) => {
          if (!canEdit) return
          const next = resizeCard(history.present, id, w, h)
          if (end) commit(next); else setLive(next)
        }}
        onWaypointDrag={(key, i, x, y, end) => {
          if (!canEdit || !Number.isFinite(x) || !Number.isFinite(y)) return
          const l = history.present.lines.find((z) => z.key === key)
          if (!l) return
          const wp = [...l.waypoints]; wp[2 * i] = x; wp[2 * i + 1] = y
          const next = setWaypoints(history.present, key, wp)
          if (end) commit(next); else setLive(next)
        }}
        onToggleInclude={(meterId) => void toggleInclude(meterId)}
      />
      <ConnectionsManager lines={doc.lines} placed={placedIds} meters={meterMap} canEdit={canEdit}
        onDelete={(key) => { commit(removeLine(doc, key)); if (selectedLine === key) setSelectedLine(null) }}
        onAdd={(from, to, lineType) => {
          setMsg(null)
          const r = addLine(doc, { fromMeterId: from, toMeterId: to, waypoints: [], lineType }, view.externalLines)
          if (!r.ok) fail(r.reason); else commit(r.doc)
        }} />
      <SavedReportsPanel projectId={projectId} kind="solar_schematic_sheet" source={{ table: 'solar.schematics', id: view.schematic.id }} canManage={canEdit} title="Exported sheets of this schematic" reloadKey={reloadKey} />
      {placeAt && canEdit && (
        <PlaceMeterDialog projectId={projectId} unplaced={unplaced} onClose={() => setPlaceAt(null)}
          onPick={(meterId) => { const r = placeCard(doc, meterId, placeAt); setPlaceAt(null); if (r.ok) commit(r.doc); else fail(r.reason) }}
          onCreated={(m) => { setMeters((ms) => [...ms, m]); const r = placeCard(doc, m.id, placeAt); setPlaceAt(null); if (r.ok) commit(r.doc); else fail(r.reason) }} />
      )}
      {replacing && canEdit && (
        <ReplaceDrawingDialog projectId={projectId} schematicId={view.schematic.id} expectedUpdatedAt={version} drawings={view.drawings}
          onClose={() => setReplacing(false)} onDone={() => { setReplacing(false); router.refresh() }} />
      )}
    </div>
  )
}
