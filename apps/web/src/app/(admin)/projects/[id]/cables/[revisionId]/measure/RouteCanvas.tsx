'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Circle } from 'react-konva'
import type Konva from 'konva'
import { edgeLengthsM, moveVertex, insertVertexAfter, removeVertex, dedupeConsecutivePoints } from '@esite/shared'
import { calibrateFloorPlanAction } from '@/actions/cable-route.actions'
import { RouteLayer, type RouteLayerLeg, type OtherLeg, type CalibrationLine } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/RouteLayer'
import { isPrimaryDrawPress, isTouchEvent, rollbackPinchVertex } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { Tooltip } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/markup-tooltip'
import { snapRouteVertex } from '@/lib/cable-route/snap'
import {
  emptyHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  snapshotsEqual,
  type RouteHistory,
  type RouteSnapshot,
  type SnapshotLeg,
} from '@/lib/cable-route/route-history'
import { useSheetImage, backingSize } from '@/lib/sheet/use-sheet-image'
import { useSheetViewport } from '@/lib/sheet/use-sheet-viewport'
import { getDraft, setDraft, clearDraft } from '@/lib/sheet/draft-store'
import { sheetEndpoints, nextStatusStep, runAssigned, pageScaleFor } from './route-canvas-logic'
import type { ActiveSheet } from './types'

/**
 * THE ROUTE CANVAS — the cable schedule's own drawing surface.
 *
 * It shows one sheet and one run, and does exactly one job: trace legs of
 * that run on that sheet and keep them. No markup tools, colours, shapes,
 * RFIs, saved layers or snag pins — those are the drawing viewer's, and this
 * canvas replaced the route mode that used to be borrowed from it. What the
 * two still share is the sheet itself: image loading, zoom, pan and drafts
 * come from `lib/sheet`, so the two canvases cannot drift.
 *
 * A committed leg never touches a scene graph. It goes to the caller, who
 * writes `cable_schedule.route_segments`; the server re-measures from the
 * sheet's scale and its figure is the one stored. The browser never sends
 * metres.
 */

type Tool = 'trace' | 'select' | 'calibrate'

export type RouteCanvasRun = {
  supplyId: string
  /** "MB 3.1 → DB-07", for the banner. */
  label: string
  riseM: number
  dropM: number
  scheduleLengthM: number | null
  /** This run's saved legs across every sheet, in path order. */
  savedLegs: Array<RouteLayerLeg & { floorPlanName: string }>
  /** Other runs' legs on THIS sheet, drawn faint for context. */
  otherLegsOnSheet: OtherLeg[]
}

export type RouteCanvasProps = {
  sheet: ActiveSheet
  run: RouteCanvasRun
  /** 1-based PDF page to open on. */
  initialPage: number
  onPageChange: (page: number) => void
  /** The parent is persisting: editing is paused until it answers. */
  busy: boolean
  /** Pixels only. The server reads the sheet's scale and decides the length. */
  onCommitLeg: (leg: { points: number[]; pageIndex: number }) => Promise<{ error?: string }>
  onUpdateLeg: (legId: string, points: number[]) => Promise<{ error?: string }>
  onDeleteLeg: (legId: string) => Promise<{ error?: string }>
  /** Replace the WHOLE leg list — how undo/redo re-persists a prior state. */
  onReplaceLegs: (legs: SnapshotLeg[]) => Promise<{ error?: string }>
  /** Keep this sheet as a versioned PDF; receives the native-resolution JPEG. */
  onExportSheet: (jpegBase64: string, pageIndex: number) => Promise<{ error?: string; version?: number }>
  /** A scale was saved through the role-gated action; the parent updates the sheet. */
  onCalibrated: (c: { pageIndex: number; pixelsPerMeter: number; points: number[]; metres: number }) => void
  /** CSS height of the drawing area. */
  height?: string
}

type RouteDraft = { draft: number[]; pending: number[] | null; savedAt: string }

function pxDist(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function RouteCanvas({
  sheet, run, initialPage, onPageChange, busy,
  onCommitLeg, onUpdateLeg, onDeleteLeg, onReplaceLegs, onExportSheet, onCalibrated,
  height = '70vh',
}: RouteCanvasProps) {
  const [tool, setTool] = useState<Tool>('trace')
  /** Vertices being clicked out, in image space. */
  const [polyPoints, setPolyPoints] = useState<number[]>([])
  /** A finished leg the measurer has not yet pressed Save on. */
  const [pendingLeg, setPendingLeg] = useState<number[] | null>(null)
  const [legSaving, setLegSaving] = useState(false)
  const [legError, setLegError] = useState<string | null>(null)
  // Selection is by POSITION in the route, not by row id: every save replaces
  // the segment list wholesale and every row gets a new id. Order survives a
  // replace; ids do not.
  const [selectedLegIndex, setSelectedLegIndex] = useState<number | null>(null)
  const selectedLegId = selectedLegIndex != null ? (run.savedLegs[selectedLegIndex]?.id ?? null) : null
  const setSelectedLegId = (id: string | null) => {
    if (id == null) { setSelectedLegIndex(null); return }
    const i = run.savedLegs.findIndex((l) => l.id === id)
    setSelectedLegIndex(i >= 0 ? i : null)
  }
  /** Delete leg is armed by a first press and committed by a second within 4 s — never window.confirm (Safari suppresses it). */
  const [armedDeleteLegId, setArmedDeleteLegId] = useState<string | null>(null)
  useEffect(() => {
    if (!armedDeleteLegId) return
    const t = setTimeout(() => setArmedDeleteLegId(null), 4000)
    return () => clearTimeout(t)
  }, [armedDeleteLegId])
  /** While true the route layer draws only what should be on paper. */
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [snapHint, setSnapHint] = useState<string | null>(null)
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(null)
  // Calibration
  const [calibPoints, setCalibPoints] = useState<Array<[number, number]>>([])
  const [calibDistance, setCalibDistance] = useState('')
  const [calibSaving, setCalibSaving] = useState(false)
  const [calibError, setCalibError] = useState<string | null>(null)

  // ── The sheet ─────────────────────────────────────────────────────────────
  // The page to open on is read ONCE. The parent mirrors the current page into
  // the URL, which comes back as `initialPage`; feeding that into the loader
  // would reload the PDF on every page turn. The workspace keys this canvas on
  // the sheet id, so a different sheet mounts fresh and reads it again.
  const [openPage] = useState(initialPage)
  const { img, loadError, currentPage, setCurrentPage, pageCount } = useSheetImage({
    planId: sheet.id,
    signedUrl: sheet.signedUrl,
    isPdf: sheet.isPdf,
    initialPage: openPage,
  })
  useEffect(() => { onPageChange(currentPage) }, [currentPage, onPageChange])
  const [imgW, imgH] = backingSize(img)
  const naturalW = sheet.width_px || imgW || 800
  const naturalH = sheet.height_px || imgH || 600
  const image = useMemo(() => (img ? { w: imgW, h: imgH } : null), [img, imgW, imgH])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  /** The vertex list as it stood the instant a finger landed — see `rollbackPinchVertex`. */
  const polyLenBeforeTouchRef = useRef<number | null>(null)
  const onPinchStart = useCallback(() => {
    setPolyPoints((pts) => rollbackPinchVertex(pts, polyLenBeforeTouchRef.current))
    polyLenBeforeTouchRef.current = null
  }, [])
  const vp = useSheetViewport({ containerRef, image, resetKey: `${sheet.id}:${currentPage}`, onPinchStart })
  const { scale, offset, viewport } = vp

  // Vertices belong to the page they were clicked on. Abandon anything in
  // progress on a page change; a leg is cheap to retrace and a wrong length
  // is not.
  useEffect(() => {
    setPolyPoints([])
    setCalibPoints([])
    setPendingLeg(null)
    setSelectedLegIndex(null)
    setLegError(null)
  }, [currentPage])

  // A new run: the polyline is in hand and nothing carries over.
  useEffect(() => {
    setTool('trace')
    setPendingLeg(null)
    setSelectedLegIndex(null)
    setLegError(null)
    setExportMsg(null)
  }, [run.supplyId])

  /** The scale in force on this page (00199): the page's own, or the drawing's on page 1. */
  const pixelsPerMeter = pageScaleFor(sheet, currentPage)
  /** The stored calibration line for this page, so the scale is visible. */
  const calibLine: CalibrationLine | null = useMemo(() => {
    const own = sheet.page_scales.find((s) => s.pageIndex === currentPage)
    if (own && own.points && own.points.length === 4 && own.metres) {
      return { points: own.points, metres: own.metres, pageIndex: own.pageIndex }
    }
    const drawingPage = sheet.calibration_page_index ?? 1
    if (drawingPage === currentPage && sheet.calibration_points?.length === 4 && sheet.calibration_metres) {
      return { points: sheet.calibration_points, metres: sheet.calibration_metres, pageIndex: drawingPage }
    }
    return null
  }, [sheet, currentPage])

  // ── History: every visible change is a snapshot ───────────────────────────
  const [history, setHistory] = useState<RouteHistory>(() => emptyHistory({ legs: [], pending: null, draft: [] }))
  const applyingHistoryRef = useRef(false)
  const currentSnapshot = (): RouteSnapshot => ({
    legs: run.savedLegs.map((l) => ({ floorPlanId: l.floorPlanId ?? '', pageIndex: l.pageIndex, points: l.points })),
    pending: pendingLeg,
    draft: polyPoints,
  })
  useEffect(() => {
    const now = currentSnapshot()
    if (applyingHistoryRef.current) {
      if (snapshotsEqual(now, history.present)) applyingHistoryRef.current = false
      return
    }
    setHistory((h) => pushHistory(h, now))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.savedLegs, pendingLeg, polyPoints])
  useEffect(() => {
    setHistory(emptyHistory(currentSnapshot()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.supplyId])

  async function applySnapshot(next: RouteSnapshot) {
    applyingHistoryRef.current = true
    setPolyPoints(next.draft)
    setPendingLeg(next.pending)
    setSelectedLegIndex(null)
    setLegError(null)
    const legsNow = currentSnapshot().legs
    const same =
      legsNow.length === next.legs.length &&
      legsNow.every((l, i) => l.floorPlanId === next.legs[i].floorPlanId && l.pageIndex === next.legs[i].pageIndex && l.points.join(',') === next.legs[i].points.join(','))
    if (!same) {
      const res = await onReplaceLegs(next.legs)
      if (res.error) {
        applyingHistoryRef.current = false
        setLegError(res.error)
      }
    }
  }
  function undoRoute() {
    if (!history.canUndo) return
    const h = undoHistory(history)
    setHistory(h)
    void applySnapshot(h.present)
  }
  function redoRoute() {
    if (!history.canRedo) return
    const h = redoHistory(history)
    setHistory(h)
    void applySnapshot(h.present)
  }

  // ── Draft autosave: an unsaved trace survives a reload ────────────────────
  const draftKey = `route-draft:${sheet.id}:${run.supplyId}:${currentPage}`
  useEffect(() => {
    let live = true
    ;(async () => {
      const rec = await getDraft<RouteDraft>(draftKey)
      if (!live || !rec) return
      if ((rec.draft && rec.draft.length >= 2) || (rec.pending && rec.pending.length >= 4)) {
        setPolyPoints(rec.draft ?? [])
        setPendingLeg(rec.pending ?? null)
        setRestoredDraftAt(rec.savedAt ?? null)
      }
    })()
    return () => { live = false }
  }, [draftKey])
  useEffect(() => {
    const t = setTimeout(() => {
      if (polyPoints.length === 0 && !pendingLeg) void clearDraft(draftKey)
      else void setDraft<RouteDraft>(draftKey, { draft: polyPoints, pending: pendingLeg, savedAt: new Date().toISOString() })
    }, 400)
    return () => clearTimeout(t)
  }, [draftKey, polyPoints, pendingLeg])

  // ── Tracing ───────────────────────────────────────────────────────────────
  function finishPoly() {
    // The double-click that got us here stamped one or two extra vertices on
    // the last real one. Collapse them (3 px in image space) so a measured leg
    // has no zero-length edge.
    const pts = dedupeConsecutivePoints(polyPoints, 3 / scale)
    if (pts.length < 4) { setPolyPoints([]); return }
    // The leg becomes PENDING — drawn solid and labelled, still the measurer's —
    // until they press Save. A double-click writes nothing.
    setPendingLeg(pts)
    setPolyPoints([])
    setLegError(null)
  }

  async function saveLeg() {
    if (!pendingLeg) return
    setLegSaving(true)
    setLegError(null)
    try {
      const res = await onCommitLeg({ points: pendingLeg, pageIndex: currentPage })
      if (res.error) { setLegError(res.error); return }
      setPendingLeg(null)
      setRestoredDraftAt(null)
      void clearDraft(draftKey)
    } finally {
      setLegSaving(false)
    }
  }

  async function persistLeg(legId: string, points: number[]) {
    setLegSaving(true)
    setLegError(null)
    try {
      const res = await onUpdateLeg(legId, points)
      if (res.error) setLegError(res.error)
    } finally {
      setLegSaving(false)
    }
  }
  const legPoints = (legId: string) => run.savedLegs.find((l) => l.id === legId)?.points ?? null
  function onMoveLegVertex(legId: string, index: number, x: number, y: number) {
    const pts = legPoints(legId)
    if (pts) void persistLeg(legId, moveVertex(pts, index, x, y))
  }
  function onInsertLegVertex(legId: string, afterIndex: number, x: number, y: number) {
    const pts = legPoints(legId)
    if (pts) void persistLeg(legId, insertVertexAfter(pts, afterIndex, x, y))
  }
  function onRemoveLegVertex(legId: string, index: number) {
    const pts = legPoints(legId)
    if (!pts) return
    try {
      void persistLeg(legId, removeVertex(pts, index))
    } catch (e) {
      setLegError(e instanceof Error ? e.message : 'Could not remove that point')
    }
  }
  async function deleteLeg(legId: string) {
    if (armedDeleteLegId !== legId) { setArmedDeleteLegId(legId); return }
    setArmedDeleteLegId(null)
    setLegSaving(true)
    setLegError(null)
    try {
      const res = await onDeleteLeg(legId)
      if (res.error) setLegError(res.error)
      else setSelectedLegIndex(null)
    } finally {
      setLegSaving(false)
    }
  }

  /**
   * Rasterise the sheet at native resolution with the routes drawn, as JPEG
   * (a PNG of an A1 at source density brushes the 10 MB action body limit),
   * with handles, the pending leg and the draft left off the page.
   */
  async function exportSheet() {
    if (!stageRef.current || !img) return
    setExporting(true)
    setExportMsg(null)
    await new Promise((r) => setTimeout(r, 60)) // let the route layer redraw without handles
    const stage = stageRef.current
    const savedScale = stage.scaleX()
    const savedPos = stage.position()
    const restore = () => {
      stage.scale({ x: savedScale, y: savedScale })
      stage.position(savedPos)
      stage.draw()
    }
    try {
      stage.scale({ x: 1, y: 1 })
      stage.position({ x: 0, y: 0 })
      stage.draw()
      const dataUrl = stage.toDataURL({ pixelRatio: 1, mimeType: 'image/jpeg', quality: 0.85, x: 0, y: 0, width: naturalW, height: naturalH })
      restore()
      const res = await onExportSheet(dataUrl.split(',')[1] ?? '', currentPage)
      setExportMsg(res.error ? res.error : `Saved as version ${res.version} — listed under Exported sheets below.`)
    } catch (e) {
      restore()
      setExportMsg(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  // ── Calibration (through the role-gated action, per page) ─────────────────
  function startCalibration() {
    setCalibPoints([])
    setCalibDistance('')
    setCalibError(null)
    setTool('calibrate')
  }
  function cancelCalibration() {
    setCalibPoints([])
    setCalibDistance('')
    setCalibError(null)
    setTool('trace')
  }
  async function saveCalibration() {
    if (calibPoints.length !== 2) { setCalibError('Pick two points first'); return }
    const metres = parseFloat(calibDistance)
    if (!metres || metres <= 0) { setCalibError('Enter a positive distance in metres'); return }
    const px = pxDist(calibPoints[0], calibPoints[1])
    if (px < 4) { setCalibError('Points are too close together'); return }
    const points = [calibPoints[0][0], calibPoints[0][1], calibPoints[1][0], calibPoints[1][1]]
    setCalibSaving(true)
    setCalibError(null)
    try {
      const res = await calibrateFloorPlanAction({ floorPlanId: sheet.id, points, realMetres: metres, pageIndex: currentPage })
      if (res.error) throw new Error(res.error)
      onCalibrated({ pageIndex: currentPage, pixelsPerMeter: res.pixelsPerMeter ?? px / metres, points, metres })
      setCalibPoints([])
      setCalibDistance('')
      // Back to tracing — the scale was set in order to trace.
      setTool('trace')
    } catch (err) {
      setCalibError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setCalibSaving(false)
    }
  }

  // ── Pointer handlers ──────────────────────────────────────────────────────
  // Mouse + touch (Konva's onPointerDown is unreliable under synthesised input).
  function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    // Only the primary button draws; a TouchEvent has no `button`, hence the helper.
    if (!isPrimaryDrawPress(e.evt)) return
    // A pan is under way: the sheet is moving, so nothing is drawn on it.
    if (vp.panningRef.current) return
    // Only the FIRST finger may act — a second one is the start of a pinch.
    if (isTouchEvent(e.evt) && vp.touchCountRef.current > 1) return
    polyLenBeforeTouchRef.current = isTouchEvent(e.evt) ? polyPoints.length : null
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getRelativePointerPosition()
    if (!pos) return
    const { x, y } = pos

    if (tool === 'calibrate') {
      setCalibPoints((p) => (p.length === 0 ? [[x, y]] : p.length === 1 ? [...p, [x, y]] : [[x, y]]))
      return
    }
    if (tool === 'select') {
      // Legs cancelBubble on their own press, so reaching here means empty canvas.
      setSelectedLegIndex(null)
      return
    }
    if (tool === 'trace') {
      if (!pixelsPerMeter || busy) return
      // Snap the first vertex to the end of a leg already saved on this sheet,
      // and with Shift any later vertex to 0/45/90° from the previous one.
      const endpoints = sheetEndpoints(run.savedLegs, sheet.id, currentPage)
      const prev: [number, number] | null = polyPoints.length >= 2 ? [polyPoints[polyPoints.length - 2], polyPoints[polyPoints.length - 1]] : null
      const snapped = snapRouteVertex([x, y], prev, endpoints, 12 / scale, !!(e.evt as MouseEvent).shiftKey)
      setPolyPoints((pts) => [...pts, snapped.point[0], snapped.point[1]])
      setSnapHint(snapped.snappedTo === 'endpoint' ? 'joined to the previous leg' : snapped.snappedTo === 'angle' ? 'snapped to 45°' : null)
    }
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoRoute(); else undoRoute()
        return
      }
      if (e.key === 'Enter' && polyPoints.length >= 4) { e.preventDefault(); finishPoly(); return }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (tool === 'calibrate') cancelCalibration()
        else if (polyPoints.length) setPolyPoints([])
        else if (pendingLeg) setPendingLeg(null)
        else setSelectedLegIndex(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLegId) {
        e.preventDefault()
        void deleteLeg(selectedLegId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, polyPoints, pendingLeg, selectedLegId, history, armedDeleteLegId, scale])

  // ── Status ────────────────────────────────────────────────────────────────
  const legs = run.savedLegs.length
  const savedM = run.savedLegs.reduce((n, l) => n + l.lengthM, 0)
  const totalM = savedM + run.riseM + run.dropM
  const drafting = polyPoints.length > 0
  const assigned = runAssigned(run.scheduleLengthM, totalM, legs)
  const step = nextStatusStep({ pending: !!pendingLeg, drafting, legs, assigned })
  const canExport = !exporting && !!img && run.savedLegs.some((l) => l.floorPlanId === sheet.id)
  const editing = legSaving || busy

  const cell = (n: number, title: string, body: string) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', opacity: step === n ? 1 : 0.62 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: step === n ? 'var(--c-amber)' : 'var(--c-text-dim)', border: `1px solid ${step === n ? 'var(--c-amber)' : 'var(--c-border)'}`, borderRadius: 10, padding: '1px 7px' }}>{n}</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{body}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Toolbar */}
      <div className="data-panel" style={{ padding: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Group>
          <TbButton active={tool === 'trace'} disabled={!pixelsPerMeter} onClick={() => setTool('trace')} title={pixelsPerMeter ? 'Trace a leg: click each corner, double-click or Enter to finish' : 'Trace — set this page’s scale first'}>✎ Trace</TbButton>
          <TbButton active={tool === 'select'} onClick={() => setTool('select')} title="Select a leg to move, add or remove its points; drag the sheet">↖ Select</TbButton>
          <TbButton active={tool === 'calibrate'} onClick={startCalibration} title={pixelsPerMeter ? 'Recalibrate this page’s scale' : 'Set this page’s scale'}>{pixelsPerMeter ? '⟷ Recalibrate' : '⟷ Set scale'}</TbButton>
        </Group>
        <Sep />
        <Group>
          <TbButton onClick={undoRoute} disabled={!history.canUndo || editing} title="Undo (⌘Z) — the last point, leg, edit or save">↶</TbButton>
          <TbButton onClick={redoRoute} disabled={!history.canRedo || editing} title="Redo (⇧⌘Z)">↷</TbButton>
        </Group>
        <Sep />
        <Group>
          <TbButton onClick={vp.zoomOut} title="Zoom out (-)">−</TbButton>
          <TbButton onClick={vp.fitToView} title="Fit to view (F)">⤢</TbButton>
          <TbButton onClick={vp.zoomIn} title="Zoom in (+)">+</TbButton>
          <span style={{ minWidth: 44, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }} aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
        </Group>
        {pageCount > 1 && (
          <>
            <Sep />
            <Group>
              <TbButton onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} title="Previous page">◂</TbButton>
              <span style={{ minWidth: 70, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-mid)' }} aria-live="polite">
                Page {currentPage} / {pageCount}
              </span>
              <TbButton onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))} disabled={currentPage >= pageCount} title="Next page">▸</TbButton>
            </Group>
          </>
        )}
        <div style={{ flex: 1 }} />
        <TbButton onClick={() => void exportSheet()} disabled={!canExport} title="Keep this sheet — routes, lengths and scale as drawn — as a versioned PDF report">
          {exporting ? 'Exporting…' : 'Export sheet'}
        </TbButton>
      </div>

      {/* Status strip — which of the three steps this run is on, always. */}
      <div className="data-panel" style={{ padding: '8px 12px', display: 'flex', gap: 22, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{run.label}</span>
          <span style={{ fontWeight: 400, color: 'var(--c-text-dim)' }}> on {sheet.name}</span>
        </span>
        {restoredDraftAt && (
          <span style={{ fontSize: 11, color: 'var(--c-amber)' }}>restored an unsaved trace from {new Date(restoredDraftAt).toLocaleTimeString()}</span>
        )}
        {snapHint && drafting && <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{snapHint}</span>}
        {cell(1, 'Trace', pendingLeg
          ? 'leg finished — press Save leg, or Discard'
          : drafting
            ? `${polyPoints.length / 2} point${polyPoints.length === 2 ? '' : 's'} placed — double-click or Enter to finish the leg`
            : !pixelsPerMeter
              ? 'this page has no scale yet — set it once and every later run on it is ready'
              : legs === 0
                ? 'click each corner of the route, then double-click to finish the leg'
                : `${legs} leg${legs === 1 ? '' : 's'} saved · ${savedM.toFixed(2)} m`)}
        {cell(2, 'Rise & drop', legs === 0 ? '—' : `${run.riseM} m + ${run.dropM} m → run total ${totalM.toFixed(2)} m`)}
        {cell(3, 'Schedule', assigned
          ? `assigned ${run.scheduleLengthM!.toFixed(2)} m`
          : run.scheduleLengthM != null
            ? `holds ${run.scheduleLengthM.toFixed(2)} m — assign to replace`
            : 'not assigned yet — use the panel on the right')}
      </div>

      {/* Action bar for whatever is in hand. */}
      {!exporting && (pendingLeg || drafting || selectedLegId || legError) && (
        <div className="data-panel" style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {drafting && (
            <>
              <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                {polyPoints.length / 2} point{polyPoints.length === 2 ? '' : 's'} — double-click or Enter to finish the leg
              </span>
              <TbButton onClick={() => setPolyPoints((p) => p.slice(0, -2))} title="Undo last point">↶ point</TbButton>
              <TbButton onClick={() => setPolyPoints([])} title="Discard this trace (Esc)">Discard</TbButton>
            </>
          )}
          {pendingLeg && !drafting && (
            <>
              <button type="button" className="btn-primary-amber" onClick={() => void saveLeg()} disabled={editing || !pixelsPerMeter}>
                {legSaving ? 'Saving…' : `Save leg${pixelsPerMeter ? ` · ${edgeLengthsM(pendingLeg, pixelsPerMeter).reduce((a, b) => a + b, 0).toFixed(2)} m` : ''}`}
              </button>
              <TbButton onClick={() => setPendingLeg(null)} title="Discard this leg (Esc)">Discard</TbButton>
              <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>The server re-measures from the sheet's scale; its figure is the one stored.</span>
            </>
          )}
          {selectedLegId && !pendingLeg && !drafting && (
            <>
              <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                Leg selected — drag a point to move it, click a midpoint to add one, right-click a point to remove it.
              </span>
              <TbButton
                active={armedDeleteLegId === selectedLegId}
                onClick={() => void deleteLeg(selectedLegId)}
                title={armedDeleteLegId === selectedLegId ? 'Press again to delete this leg' : 'Delete this leg (Del) — press twice'}
              >
                {armedDeleteLegId === selectedLegId ? 'Confirm delete' : 'Delete leg'}
              </TbButton>
              <TbButton onClick={() => setSelectedLegIndex(null)} title="Deselect (Esc)">Done editing</TbButton>
            </>
          )}
          {legError && <span role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{legError}</span>}
        </div>
      )}

      {tool === 'calibrate' && (
        <div className="data-panel" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {calibPoints.length < 2 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text)', margin: 0 }}>
              Click two points on page {currentPage} whose real-world distance you know
              {calibPoints.length === 1 ? ' (one more)' : ''}.
            </p>
          ) : (
            <>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-mid)' }}>
                {pxDist(calibPoints[0], calibPoints[1]).toFixed(0)} px =
              </span>
              <input
                type="number"
                step="0.01"
                value={calibDistance}
                onChange={(e) => setCalibDistance(e.target.value)}
                placeholder="metres"
                className="ob-input"
                style={{ width: 120 }}
                aria-label="Real-world distance in metres"
              />
              <button type="button" className="btn-primary-amber" onClick={() => void saveCalibration()} disabled={calibSaving}>
                {calibSaving ? 'Saving…' : 'Save scale'}
              </button>
            </>
          )}
          {calibError && <span role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{calibError}</span>}
          <button
            type="button"
            onClick={cancelCalibration}
            className="btn-primary-amber"
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {exportMsg && (
        <div className="data-panel" role="status" style={{ padding: '8px 12px', fontSize: 12 }}>{exportMsg}</div>
      )}

      {/* The sheet */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height,
          background: 'var(--c-base)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          overflow: 'hidden',
          // Our wheel + pointer handlers own the gesture.
          touchAction: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {!sheet.signedUrl ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>
            This sheet cannot be shown here. Tracing needs a PDF, PNG, JPG, WebP or SVG drawing.
          </div>
        ) : loadError ? (
          <div role="alert" style={{ padding: 48, textAlign: 'center', color: '#dc2626' }}>{loadError}</div>
        ) : !img ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>
            {sheet.isPdf ? 'Rendering PDF…' : 'Loading drawing…'}
          </div>
        ) : (
          <Stage
            ref={stageRef}
            width={viewport.w}
            height={viewport.h}
            scaleX={scale}
            scaleY={scale}
            x={offset.x}
            y={offset.y}
            draggable={tool === 'select' && !vp.gestureActive}
            onDragEnd={(e) => {
              // Konva drag events BUBBLE: a dragged vertex would otherwise
              // write its image coordinates into the pan offset.
              if (e.target !== e.target.getStage()) return
              const t = e.target as Konva.Stage
              vp.setOffsetFromStage({ x: t.x(), y: t.y() })
            }}
            onMouseDown={onPointerDown}
            onTouchStart={onPointerDown}
            onDblClick={tool === 'trace' ? finishPoly : tool === 'select' ? vp.fitToView : undefined}
            onDblTap={tool === 'trace' ? finishPoly : tool === 'select' ? vp.fitToView : undefined}
            style={{
              cursor: vp.panning || vp.gestureActive ? 'grabbing' : vp.spaceHeld || tool === 'select' ? 'grab' : 'crosshair',
              background: 'white',
            }}
          >
            <Layer listening={false}>
              <KonvaImage image={img} width={naturalW} height={naturalH} />
            </Layer>
            {tool === 'calibrate' && (
              <Layer listening={false}>
                {calibPoints.map((p, i) => (
                  <Circle key={i} x={p[0]} y={p[1]} radius={6 / scale} fill="#f59e0b" stroke="white" strokeWidth={2 / scale} />
                ))}
                {calibPoints.length === 2 && (
                  <Line
                    points={[calibPoints[0][0], calibPoints[0][1], calibPoints[1][0], calibPoints[1][1]]}
                    stroke="#f59e0b"
                    strokeWidth={2 / scale}
                    dash={[6 / scale, 4 / scale]}
                  />
                )}
              </Layer>
            )}
            <RouteLayer
              planId={sheet.id}
              currentPage={currentPage}
              scale={scale}
              pixelsPerMeter={pixelsPerMeter}
              legs={run.savedLegs}
              otherLegs={run.otherLegsOnSheet}
              pendingLeg={exporting ? null : pendingLeg}
              draftPoints={!exporting && tool === 'trace' ? polyPoints : []}
              selectedLegId={exporting ? null : selectedLegId}
              editable={!exporting && tool === 'select' && !editing}
              calibration={calibLine}
              showCalibration
              onSelectLeg={setSelectedLegId}
              onMoveVertex={onMoveLegVertex}
              onInsertVertex={onInsertLegVertex}
              onRemoveVertex={onRemoveLegVertex}
            />
          </Stage>
        )}
      </div>
    </div>
  )
}

function Group({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{children}</div>
}

function Sep() {
  return <div style={{ width: 1, height: 22, background: 'var(--c-border)' }} />
}

function TbButton({
  children, active, disabled, onClick, title,
}: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void; title?: string }) {
  return (
    <Tooltip label={title ?? ''}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        style={{
          minWidth: 30,
          height: 30,
          padding: '0 8px',
          background: active ? 'var(--c-amber-mid)' : 'var(--c-panel)',
          color: active ? 'var(--c-amber)' : disabled ? 'var(--c-text-dim)' : 'var(--c-text-mid)',
          border: '1px solid var(--c-border)',
          borderRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          opacity: disabled ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}
