'use client'

/**
 * THE STATUS PLAN CANVAS — draws a drawing page with its shapes, coloured
 * from live facts, and turns pointer/keyboard input into CanvasEvents.
 *
 * It holds no rules. Styles, labels and areas arrive as ShapeViews
 * (lib/status-plans/shape-view); what a press, drag, double-click or key
 * means is canvas-reducer's. Writes go to the parent, which calls the
 * server actions and hands back the stored shapes.
 *
 * Sheet loading, zoom, pan and pinch come from lib/sheet, like the cable
 * measure page, so image space (PDF at scale 2) is the same everywhere.
 * Shapes are selected on MOUSEDOWN (Konva's click is not synthesised
 * reliably) and cancelBubble so a stage press always means empty canvas.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Shape } from 'react-konva'
import type Konva from 'konva'
import { hatchSegments, pointsError, rectToPoints, visualCentre, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { calibrateFloorPlanAction } from '@/actions/cable-route.actions'
import { isPrimaryDrawPress, isTouchEvent } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { Tooltip } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/markup-tooltip'
import { useSheetImage, backingSize } from '@/lib/sheet/use-sheet-image'
import { useSheetViewport } from '@/lib/sheet/use-sheet-viewport'
import {
  canvasReducer,
  dragVertex,
  initialCanvasState,
  isIdle,
  type CanvasEvent,
  type CanvasState,
  type CanvasTool,
  type ShapeCommit,
} from '@/lib/status-plans/canvas-reducer'
import { roundPoints } from '@/lib/status-plans/canvas-shape'
import { fillRgba, type ShapeView } from '@/lib/status-plans/shape-view'
import type { CanvasShape, PlanSheet } from '@/lib/status-plans/types'

export interface StatusPlanCanvasProps {
  sheet: PlanSheet
  pageIndex: number
  purpose: StatusPlanPurpose
  shapes: CanvasShape[]
  views: Record<string, ShapeView>
  selectedId: string | null
  canEdit: boolean
  /** A write is in flight: editing pauses until it answers. */
  busy: boolean
  /** The workspace asks for a tool (e.g. "Set scale" from the no-scale banner). */
  requestedTool: { tool: CanvasTool; nonce: number } | null
  onSelect: (id: string | null) => void
  onCreate: (c: ShapeCommit) => Promise<{ error?: string }>
  onReshape: (shapeId: string, points: number[]) => Promise<{ error?: string }>
  /** Delete/Backspace on a selection: the workspace's two-step delete. */
  onDeleteRequest: () => void
  onCalibrated: (c: { pageIndex: number; pixelsPerMeter: number }) => void
  height?: string
}

/** Screen pixels within which a press counts as "on" a corner. */
const HIT_PX = 8
const SELECT_COLOUR = '#2563EB'

export function StatusPlanCanvas(p: StatusPlanCanvasProps) {
  const { sheet, pageIndex, purpose, shapes, views, selectedId, canEdit, busy } = p
  const drawTools: CanvasTool[] = purpose === 'tenant_layout' ? ['polygon', 'rect'] : ['rect']

  const [cs, setCs] = useState<CanvasState>(() => initialCanvasState('select'))
  const csRef = useRef(cs)
  csRef.current = cs
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<{ id: string; points: number[] } | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [calibMetres, setCalibMetres] = useState('')
  const [calibSaving, setCalibSaving] = useState(false)

  // ── The sheet (fixed page: a plan is one page of one drawing) ──────────────
  const { img, loadError, pageCount } = useSheetImage({
    planId: sheet.floorPlanId,
    signedUrl: sheet.signedUrl,
    isPdf: sheet.isPdf,
    initialPage: pageIndex,
  })
  const [imgW, imgH] = backingSize(img)
  const naturalW = sheet.widthPx || imgW || 800
  const naturalH = sheet.heightPx || imgH || 600
  const image = useMemo(() => (img ? { w: imgW, h: imgH } : null), [img, imgW, imgH])
  const containerRef = useRef<HTMLDivElement | null>(null)
  /**
   * The draft as it stood the instant a finger landed. When a second finger
   * lands, the first one's press was half a pinch, not a corner: take it back
   * (RouteCanvas's rollbackPinchVertex, through the reducer here).
   */
  const draftLenBeforeTouchRef = useRef<number | null>(null)
  const onPinchStart = () => {
    const before = draftLenBeforeTouchRef.current
    draftLenBeforeTouchRef.current = null
    const s = csRef.current
    if (s.rect) send({ type: 'escape' })
    else if (before !== null && s.draft.length > before) send({ type: 'undoPoint' })
  }
  const vp = useSheetViewport({ containerRef, image, resetKey: `${sheet.floorPlanId}:${pageIndex}`, onPinchStart })
  const { scale, offset, viewport } = vp
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // ── Events into the reducer ────────────────────────────────────────────────
  function send(e: CanvasEvent) {
    const step = canvasReducer(csRef.current, e)
    if (step.state !== csRef.current) {
      csRef.current = step.state
      setCs(step.state)
    }
    if (step.error) setLocalError(step.error)
    if (step.commit) void commit(step.commit)
  }
  async function commit(c: ShapeCommit) {
    setLocalError(null)
    const res = await p.onCreate(c)
    if (res.error) setLocalError(res.error)
  }
  const tol = () => HIT_PX / scaleRef.current

  useEffect(() => {
    if (p.requestedTool) send({ type: 'tool', tool: p.requestedTool.tool })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.requestedTool?.nonce])

  function imagePos(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    return e.target.getStage()?.getRelativePointerPosition() ?? null
  }
  function onDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isPrimaryDrawPress(e.evt)) return
    if (vp.panningRef.current) return
    if (isTouchEvent(e.evt) && vp.touchCountRef.current > 1) return
    const pos = imagePos(e)
    if (!pos) return
    const tool = csRef.current.tool
    if (tool === 'select') { p.onSelect(null); return } // shapes cancelBubble their own press
    if (!canEdit || busy || tool === 'pan') return
    if (isTouchEvent(e.evt)) draftLenBeforeTouchRef.current = csRef.current.draft.length
    send({ type: 'press', x: pos.x, y: pos.y, tolPx: tol() })
  }
  function onMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const s = csRef.current
    if (!s.rect && !(s.tool === 'polygon' && s.draft.length > 0)) return
    const pos = imagePos(e)
    if (!pos) return
    if (s.rect) send({ type: 'move', x: pos.x, y: pos.y })
    else setHover(pos)
  }
  function onUp(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!csRef.current.rect) return
    const pos = imagePos(e)
    if (pos) send({ type: 'release', x: pos.x, y: pos.y, tolPx: tol() })
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const s = csRef.current
      if (e.key === 'Escape') {
        e.preventDefault()
        if (isIdle(s)) p.onSelect(null)
        else send({ type: 'escape' })
        return
      }
      if (e.key === 'Enter' && s.draft.length >= 6) { e.preventDefault(); send({ type: 'finish', tolPx: tol() }); return }
      if (e.key === 'Backspace' && s.draft.length > 0) { e.preventDefault(); send({ type: 'undoPoint' }); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && canEdit && !busy) {
        e.preventDefault()
        p.onDeleteRequest()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, canEdit, busy, p.onSelect, p.onDeleteRequest])

  // ── Derived drawing data (memoised: hatching 150 blocks is not free) ───────
  const drawn = useMemo(
    () => shapes.filter((s) => s.points.length >= 6).map((s) => (preview && preview.id === s.id ? { ...s, points: preview.points } : s)),
    [shapes, preview],
  )
  const hatchById = useMemo(() => {
    const m = new Map<string, Array<{ color: string; width: number; segs: number[][] }>>()
    for (const s of drawn) {
      const v = views[s.id]
      if (!v || v.style.hatches.length === 0) continue
      m.set(s.id, v.style.hatches.map((h) => ({
        color: h.color,
        width: h.width,
        segs: hatchSegments(s.points, { angleDeg: h.angleDeg, spacing: h.spacing }),
      })))
    }
    return m
  }, [drawn, views])
  const centreById = useMemo(() => new Map(drawn.map((s) => [s.id, visualCentre(s.points)])), [drawn])

  // ── Vertex drag (selected shape, Select tool, writers only) ────────────────
  const selected = drawn.find((s) => s.id === selectedId) ?? null
  const handlesEditable = canEdit && !busy && cs.tool === 'select'
  async function endDrag(index: number, e: Konva.KonvaEventObject<DragEvent>) {
    e.cancelBubble = true
    if (!selected) return
    const shape = shapes.find((s) => s.id === selected.id)
    if (!shape) return
    const pts = dragVertex(shape, index, e.target.x(), e.target.y())
    // Put the handle back where the props say it is; the preview (then the
    // stored shape) decides where it is drawn.
    e.target.position({ x: shape.points[index * 2]!, y: shape.points[index * 2 + 1]! })
    const refused = pointsError(shape.shape, roundPoints(pts))
    if (refused) { setLocalError(refused); return }
    setPreview({ id: shape.id, points: pts })
    setLocalError(null)
    const res = await p.onReshape(shape.id, pts)
    if (res.error) setLocalError(res.error)
    setPreview(null)
  }

  // ── Calibration (through the role-gated action, this page only) ────────────
  async function saveCalibration() {
    const c = cs.calib
    if (c.length !== 4) { setLocalError('Pick two points first.'); return }
    const metres = Number.parseFloat(calibMetres)
    if (!(metres > 0)) { setLocalError('Enter a positive distance in metres.'); return }
    const px = Math.hypot(c[2]! - c[0]!, c[3]! - c[1]!)
    if (px < 4) { setLocalError('The two points are too close together.'); return }
    setCalibSaving(true)
    setLocalError(null)
    try {
      const res = await calibrateFloorPlanAction({ floorPlanId: sheet.floorPlanId, points: c, realMetres: metres, pageIndex })
      if (res.error) { setLocalError(res.error); return }
      p.onCalibrated({ pageIndex, pixelsPerMeter: res.pixelsPerMeter ?? px / metres })
      setCalibMetres('')
      send({ type: 'tool', tool: 'select' })
    } catch {
      setLocalError('The server did not answer. Check your connection and try again.')
    } finally {
      setCalibSaving(false)
    }
  }

  const hint =
    cs.tool === 'polygon' ? (cs.draft.length ? `${cs.draft.length / 2} corners — click the first corner, double-click or Enter to finish; Backspace removes the last` : 'Click each corner of the shop')
    : cs.tool === 'rect' ? 'Drag a rectangle over the shop or DB block'
    : cs.tool === 'pan' ? 'Drag to move the drawing'
    : cs.tool === 'calibrate' ? 'Click two points whose real distance you know'
    : canEdit ? 'Press a shape to select it; drag its corners to reshape' : 'Press a shape to see its shop'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="data-panel" style={{ padding: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <TbButton active={cs.tool === 'select'} onClick={() => send({ type: 'tool', tool: 'select' })} title="Select (Esc deselects)">↖ Select</TbButton>
          {canEdit && drawTools.includes('polygon') && (
            <TbButton active={cs.tool === 'polygon'} disabled={busy} onClick={() => send({ type: 'tool', tool: 'polygon' })} title="Polygon: click corners, double-click or Enter to finish">⬠ Polygon</TbButton>
          )}
          {canEdit && (
            <TbButton active={cs.tool === 'rect'} disabled={busy} onClick={() => send({ type: 'tool', tool: 'rect' })} title="Rectangle: drag">▭ Rectangle</TbButton>
          )}
          <TbButton active={cs.tool === 'pan'} onClick={() => send({ type: 'tool', tool: 'pan' })} title="Pan (or hold Space, or middle-drag)">✋ Pan</TbButton>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <TbButton onClick={vp.zoomOut} title="Zoom out (-)">−</TbButton>
          <TbButton onClick={vp.fitToView} title="Fit to view (F)">⤢</TbButton>
          <TbButton onClick={vp.zoomIn} title="Zoom in (+)">+</TbButton>
          <span style={{ minWidth: 44, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }} aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-mid)' }}>Page {pageIndex}</span>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{hint}</span>
      </div>

      {cs.tool === 'calibrate' && (
        <div className="data-panel" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {cs.calib.length < 4 ? (
            <span style={{ fontSize: 13 }}>Click two points on page {pageIndex} whose real distance you know{cs.calib.length === 2 ? ' (one more)' : ''}.</span>
          ) : (
            <>
              <input type="number" step="0.01" className="ob-input" value={calibMetres} onChange={(e) => setCalibMetres(e.target.value)} placeholder="metres" aria-label="Real distance in metres" style={{ width: 120 }} />
              <button type="button" className="btn-primary-amber" disabled={calibSaving} onClick={() => void saveCalibration()}>
                {calibSaving ? 'Saving…' : 'Save scale'}
              </button>
            </>
          )}
          <button type="button" onClick={() => send({ type: 'tool', tool: 'select' })}>Cancel</button>
        </div>
      )}

      {localError && <div role="alert" className="data-panel" style={{ padding: '8px 12px', color: '#dc2626', fontSize: 12 }}>{localError}</div>}
      {img && pageCount < pageIndex && (
        <div role="alert" className="data-panel" style={{ padding: '8px 12px', fontSize: 12 }}>
          This drawing has {pageCount} page{pageCount === 1 ? '' : 's'}; the plan is on page {pageIndex}. The drawing may have been replaced with a shorter file.
        </div>
      )}

      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: p.height ?? '70vh', background: 'var(--c-base)', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden', touchAction: 'none', WebkitUserSelect: 'none' }}
      >
        {!sheet.signedUrl ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>This drawing cannot be shown here. Status plans need a PDF or image drawing.</div>
        ) : loadError ? (
          <div role="alert" style={{ padding: 48, textAlign: 'center', color: '#dc2626' }}>{loadError}</div>
        ) : !img ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>{sheet.isPdf ? 'Rendering PDF…' : 'Loading drawing…'}</div>
        ) : (
          <Stage
            width={viewport.w}
            height={viewport.h}
            scaleX={scale}
            scaleY={scale}
            x={offset.x}
            y={offset.y}
            draggable={(cs.tool === 'select' || cs.tool === 'pan') && !vp.gestureActive}
            onDragEnd={(e) => {
              // Drag events BUBBLE: a dragged handle would otherwise write its
              // image coordinates into the pan offset.
              if (e.target !== e.target.getStage()) return
              vp.setOffsetFromStage({ x: e.target.x(), y: e.target.y() })
            }}
            onMouseDown={onDown}
            onTouchStart={onDown}
            onMouseMove={onMove}
            onTouchMove={onMove}
            onMouseUp={onUp}
            onTouchEnd={onUp}
            onDblClick={cs.tool === 'polygon' ? () => send({ type: 'finish', tolPx: tol() }) : cs.tool === 'select' ? vp.fitToView : undefined}
            onDblTap={cs.tool === 'polygon' ? () => send({ type: 'finish', tolPx: tol() }) : undefined}
            style={{ cursor: vp.panning || vp.gestureActive ? 'grabbing' : cs.tool === 'pan' || vp.spaceHeld ? 'grab' : cs.tool === 'select' ? 'default' : 'crosshair', background: 'white' }}
          >
            <Layer listening={false}>
              <KonvaImage image={img} width={naturalW} height={naturalH} />
            </Layer>

            {/* Shapes: listening only in Select, so a drawing tool's press reaches the stage. */}
            <Layer listening={cs.tool === 'select'}>
              {drawn.map((s) => {
                const v = views[s.id]
                if (!v) return null
                const select = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
                  if (!isPrimaryDrawPress(e.evt)) return
                  e.cancelBubble = true
                  p.onSelect(s.id)
                }
                return (
                  <Line
                    key={s.id}
                    points={s.points}
                    closed
                    fill={fillRgba(v.style)}
                    stroke={v.style.stroke}
                    strokeWidth={v.style.strokeWidth / scale}
                    dash={v.style.dash ? v.style.dash.map((d) => d / scale) : undefined}
                    onMouseDown={select}
                    onTouchStart={select}
                  />
                )
              })}
            </Layer>

            <Layer listening={false}>
              {drawn.map((s) => {
                const groups = hatchById.get(s.id)
                return groups?.map((g, i) => (
                  <Shape
                    key={`${s.id}:h${i}`}
                    stroke={g.color}
                    strokeWidth={g.width / scale}
                    sceneFunc={(ctx, shape) => {
                      ctx.beginPath()
                      for (const seg of g.segs) {
                        ctx.moveTo(seg[0]!, seg[1]!)
                        ctx.lineTo(seg[2]!, seg[3]!)
                      }
                      ctx.strokeShape(shape)
                    }}
                  />
                ))
              })}
              {drawn.map((s) => {
                const v = views[s.id]
                const c = centreById.get(s.id)
                if (!v || !c) return null
                const fontSize = 12 / scale
                const width = 180 / scale
                return (
                  <Text
                    key={`${s.id}:label`}
                    x={c.x - width / 2}
                    y={c.y - (v.labelLines.length * fontSize * 1.2) / 2}
                    width={width}
                    align="center"
                    text={v.labelLines.join('\n')}
                    fontSize={fontSize}
                    lineHeight={1.2}
                    fill="#111827"
                    stroke="white"
                    strokeWidth={3 / scale}
                    fillAfterStrokeEnabled
                    textDecoration={v.style.strikeLabel ? 'line-through' : ''}
                  />
                )
              })}
              {selected && (
                <Line points={selected.points} closed stroke={SELECT_COLOUR} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
              )}
              {/* Drafts */}
              {cs.draft.length > 0 && (
                <>
                  <Line points={hover ? [...cs.draft, hover.x, hover.y] : cs.draft} stroke={SELECT_COLOUR} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
                  {Array.from({ length: cs.draft.length / 2 }, (_, i) => (
                    <Circle key={i} x={cs.draft[i * 2]} y={cs.draft[i * 2 + 1]} radius={(i === 0 && cs.draft.length >= 6 ? 7 : 4) / scale} fill={i === 0 ? SELECT_COLOUR : 'white'} stroke={SELECT_COLOUR} strokeWidth={1.5 / scale} />
                  ))}
                </>
              )}
              {cs.rect && (
                <Line points={rectToPoints(cs.rect.x0, cs.rect.y0, cs.rect.x1, cs.rect.y1)} closed stroke={SELECT_COLOUR} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
              )}
              {cs.tool === 'calibrate' && cs.calib.length >= 2 && (
                <>
                  <Circle x={cs.calib[0]} y={cs.calib[1]} radius={6 / scale} fill="#f59e0b" stroke="white" strokeWidth={2 / scale} />
                  {cs.calib.length === 4 && (
                    <>
                      <Circle x={cs.calib[2]} y={cs.calib[3]} radius={6 / scale} fill="#f59e0b" stroke="white" strokeWidth={2 / scale} />
                      <Line points={cs.calib} stroke="#f59e0b" strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
                    </>
                  )}
                </>
              )}
            </Layer>

            {/* Corner handles: their own listening layer, above everything. */}
            {selected && handlesEditable && (
              <Layer>
                {Array.from({ length: selected.points.length / 2 }, (_, i) => (
                  <Circle
                    key={i}
                    x={shapes.find((s) => s.id === selected.id)!.points[i * 2]}
                    y={shapes.find((s) => s.id === selected.id)!.points[i * 2 + 1]}
                    radius={6 / scale}
                    fill="white"
                    stroke={SELECT_COLOUR}
                    strokeWidth={2 / scale}
                    draggable
                    onMouseDown={(e) => { e.cancelBubble = true }}
                    onTouchStart={(e) => { e.cancelBubble = true }}
                    onDragMove={(e) => {
                      const shape = shapes.find((s) => s.id === selected.id)
                      if (shape) setPreview({ id: shape.id, points: dragVertex(shape, i, e.target.x(), e.target.y()) })
                    }}
                    onDragEnd={(e) => void endDrag(i, e)}
                  />
                ))}
              </Layer>
            )}
          </Stage>
        )}
      </div>
    </div>
  )
}

function TbButton({ children, active, disabled, onClick, title }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void; title?: string }) {
  return (
    <Tooltip label={title ?? ''}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        aria-pressed={active}
        style={{
          minWidth: 30, height: 30, padding: '0 8px',
          background: active ? 'var(--c-amber-mid)' : 'var(--c-panel)',
          color: active ? 'var(--c-amber)' : disabled ? 'var(--c-text-dim)' : 'var(--c-text-mid)',
          border: '1px solid var(--c-border)', borderRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12, opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}
