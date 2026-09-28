'use client'
/**
 * THE SOLAR CANVAS — sibling of RouteCanvas (PR #201). It draws one sheet and
 * one layout and emits INTENTS; the workspace owns the object list, history and
 * saving. Sheet loading, zoom/pan and the image space are lib/sheet's, so this
 * canvas cannot drift from the markup and route canvases. F is Auto-fill here,
 * so the viewport's fit key is 0 only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Circle, Rect, Group, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import {
  flatToPts, isArrayObject, isCircleGeometry, stringColour, vertexMean, type LayoutObject, type ModuleRef, type Pt,
} from '@esite/shared'
import { isPrimaryDrawPress, isTouchEvent, rollbackPinchVertex } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { useSheetImage, backingSize } from '@/lib/sheet/use-sheet-image'
import { useSheetViewport } from '@/lib/sheet/use-sheet-viewport'

export type LayoutTool =
  | 'select' | 'north' | 'roof' | 'obstruction' | 'block' | 'inverter' | 'string' | 'equipment' | 'measure' | 'fall' | 'calibrate'

export interface Selection { ids: string[]; modules: ModuleRef[] }
export const EMPTY_SELECTION: Selection = { ids: [], modules: [] }

/**
 * JPEG (base64, no prefix) of the objects' bounding box + margin at native
 * resolution, capped at 4000 px. Handed to the parent through `onExporter`, not
 * a ref: the canvas is loaded with next/dynamic, and a callback survives that
 * wrapper where a forwarded ref is not guaranteed to.
 */
export type ExportJpeg = () => Promise<{ jpegBase64: string; crop: { x: number; y: number; w: number; h: number } } | null>

export interface SolarCanvasProps {
  sheet: { key: string; signedUrl: string | null; isPdf: boolean; pageIndex: number }
  objects: LayoutObject[]
  preview: number[][] | null
  selection: Selection
  tool: LayoutTool
  readOnly: boolean
  circleMode: boolean
  sheetPixelsPerMeter: number | null
  onSelect(sel: Selection): void
  onPolygon(kind: 'roof' | 'obstruction', points: number[]): void
  onCircle(cx: number, cy: number, r: number): void
  onPoint(kind: 'inverter' | 'equipment', x: number, y: number): void
  onBlock(a: Pt, b: Pt): void
  onTwoPoints(purpose: 'north' | 'fall' | 'calibrate', points: number[]): void
  onModuleClick(ref: ModuleRef): void
  onTranslate(ids: string[], dx: number, dy: number): void
  /** The transformer's result, applied to image coords as p' = rotate(p, deg about 0,0) + (dx, dy). */
  onTransform(ids: string[], deg: number, dx: number, dy: number): void
  onExporter?(fn: ExportJpeg | null): void
  height?: string
}

const ROOF = '#f59e0b'
const OBST = '#dc2626'
const MODULE = '#1d4ed8'
const SEL = '#10b981'

function centroidOf(q: number[]): Pt { return vertexMean(flatToPts(q)) }

export function SolarCanvas(p: SolarCanvasProps) {
  const { img, loadError } = useSheetImage({ planId: p.sheet.key, signedUrl: p.sheet.signedUrl, isPdf: p.sheet.isPdf, initialPage: p.sheet.pageIndex })
  const [imgW, imgH] = backingSize(img)
  const image = useMemo(() => (img ? { w: imgW, h: imgH } : null), [img, imgW, imgH])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const groupRef = useRef<Konva.Group | null>(null)
  const trRef = useRef<Konva.Transformer | null>(null)

  const [draft, setDraft] = useState<number[]>([])
  const [dragStart, setDragStart] = useState<Pt | null>(null)
  const [dragNow, setDragNow] = useState<Pt | null>(null)
  const [exporting, setExporting] = useState(false)
  const lenBeforeTouch = useRef<number | null>(null)
  // A two-point pick (north / fall / calibrate) completed by a TOUCH press is
  // only committed on lift: the first finger of a pinch must not fire it.
  const pendingPair = useRef<number[] | null>(null)
  const onPinchStart = useCallback(() => {
    setDraft((pts) => rollbackPinchVertex(pts, lenBeforeTouch.current))
    lenBeforeTouch.current = null
    pendingPair.current = null
  }, [])
  const vp = useSheetViewport({ containerRef, image, resetKey: `${p.sheet.key}:${p.sheet.pageIndex}`, onPinchStart, fitKeys: ['0'] })

  const selected = useMemo(() => new Set(p.selection.ids), [p.selection.ids])
  const moduleSel = useMemo(() => new Set(p.selection.modules.map((m) => `${m.arrayId}#${m.index}`)), [p.selection.modules])
  const stringOf = useMemo(() => {
    const m = new Map<string, number>()
    let i = 0
    for (const o of p.objects) if (o.kind === 'string') { for (const r of o.props.modules) m.set(`${r.arrayId}#${r.index}`, i); i++ }
    return m
  }, [p.objects])

  // Transformer (rotate only) follows the selection group — re-bound whenever the
  // selection, tool or edit right changes, and detached when nothing is selected
  // so it never draws an empty box at the origin.
  const selectionKey = p.selection.ids.join(',')
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const on = !p.readOnly && p.tool === 'select' && p.selection.ids.length > 0 && groupRef.current
    tr.nodes(on ? [groupRef.current as Konva.Group] : [])
    tr.getLayer()?.batchDraw()
    // `exporting` unmounts the Transformer; re-bind when it comes back.
  }, [selectionKey, p.readOnly, p.tool, p.selection.ids.length, exporting])

  function pointer(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): Pt | null {
    const stage = e.target.getStage()
    const pos = stage?.getRelativePointerPosition()
    return pos ? { x: pos.x, y: pos.y } : null
  }

  function finishPolygon() {
    if (draft.length >= 6 && (p.tool === 'roof' || (p.tool === 'obstruction' && !p.circleMode))) p.onPolygon(p.tool, draft)
    setDraft([])
  }
  const closable = draft.length >= 6 && (p.tool === 'roof' || (p.tool === 'obstruction' && !p.circleMode))

  // §6.3: double-click OR Enter closes a roof/obstruction outline; Escape drops it.
  const finishRef = useRef(finishPolygon)
  finishRef.current = finishPolygon
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'Enter' && (p.tool === 'roof' || p.tool === 'obstruction')) { e.preventDefault(); finishRef.current() }
      else if (e.key === 'Escape') setDraft([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p.tool])

  function onDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!isPrimaryDrawPress(e.evt) || vp.panningRef.current) return
    if (isTouchEvent(e.evt) && vp.touchCountRef.current > 1) return
    const pt = pointer(e)
    if (!pt) return
    lenBeforeTouch.current = isTouchEvent(e.evt) ? draft.length : null
    if (p.readOnly && p.tool !== 'measure' && p.tool !== 'select') return
    switch (p.tool) {
      case 'select':
        if (e.target === e.target.getStage() || e.target.getClassName() === 'Image') {
          setDragStart(pt); setDragNow(pt)
          if (!(e.evt as MouseEvent).shiftKey) p.onSelect({ ids: [], modules: [] })
        }
        return
      case 'roof':
      case 'obstruction':
        if (p.tool === 'obstruction' && p.circleMode) { setDragStart(pt); setDragNow(pt); return }
        setDraft((d) => [...d, pt.x, pt.y])
        return
      case 'block':
        setDragStart(pt); setDragNow(pt)
        return
      case 'inverter':
      case 'equipment':
        p.onPoint(p.tool, pt.x, pt.y)
        return
      case 'north':
      case 'fall':
      case 'calibrate':
      case 'measure': {
        const next = draft.length >= 4 ? [pt.x, pt.y] : [...draft, pt.x, pt.y]
        setDraft(next)
        if (next.length === 4 && p.tool !== 'measure') {
          if (isTouchEvent(e.evt)) { pendingPair.current = next; return }
          p.onTwoPoints(p.tool, next); setDraft([])
        }
        return
      }
      default:
        return
    }
  }

  function onMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!dragStart) return
    const pt = pointer(e)
    if (pt) setDragNow(pt)
  }

  function onUp() {
    const pair = pendingPair.current
    pendingPair.current = null
    if (pair && (p.tool === 'north' || p.tool === 'fall' || p.tool === 'calibrate')) { p.onTwoPoints(p.tool, pair); setDraft([]); return }
    if (!dragStart || !dragNow) { setDragStart(null); return }
    const a = dragStart
    const b = dragNow
    setDragStart(null); setDragNow(null)
    if (p.tool === 'block' && Math.hypot(b.x - a.x, b.y - a.y) > 4) p.onBlock(a, b)
    if (p.tool === 'obstruction' && p.circleMode) {
      const r = Math.hypot(b.x - a.x, b.y - a.y)
      if (r > 2) p.onCircle(a.x, a.y, r)
    }
    if (p.tool === 'select' && Math.abs(b.x - a.x) > 4 && Math.abs(b.y - a.y) > 4) {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
      const inBox = (q: Pt) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1
      const ids = p.objects.filter((o) => {
        if (o.kind === 'string') return false
        if (isArrayObject(o)) return o.geometry.modules.length > 0 && inBox(centroidOf(o.geometry.modules.flat()))
        if (o.kind === 'roof') return inBox(vertexMean(flatToPts(o.geometry.points)))
        if (o.kind === 'obstruction') return inBox(isCircleGeometry(o.geometry) ? { x: o.geometry.cx, y: o.geometry.cy } : vertexMean(flatToPts(o.geometry.points)))
        return inBox({ x: o.geometry.x, y: o.geometry.y })
      }).map((o) => o.id)
      p.onSelect({ ids: [...new Set([...p.selection.ids, ...ids])], modules: [] })
    }
  }

  function pressObject(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, id: string) {
    if (p.tool !== 'select' && p.tool !== 'string') return
    e.cancelBubble = true
    const shift = (e.evt as MouseEvent).shiftKey
    p.onSelect({ ids: shift ? [...new Set([...p.selection.ids, id])] : [id], modules: [] })
  }

  function pressModule(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, ref: ModuleRef) {
    e.cancelBubble = true
    if (p.tool === 'string') { p.onModuleClick(ref); return }
    if (p.tool !== 'select') return
    const shift = (e.evt as MouseEvent).shiftKey
    p.onSelect({ ids: [], modules: shift ? [...p.selection.modules, ref] : [ref] })
  }

  const exportJpeg = useCallback<ExportJpeg>(async () => {
      const stage = stageRef.current
      if (!stage || !img) return null
      const pts = p.objects.flatMap((o) => {
        if (o.kind === 'roof') return flatToPts(o.geometry.points)
        if (o.kind === 'obstruction') return isCircleGeometry(o.geometry) ? [{ x: o.geometry.cx - o.geometry.r, y: o.geometry.cy - o.geometry.r }, { x: o.geometry.cx + o.geometry.r, y: o.geometry.cy + o.geometry.r }] : flatToPts(o.geometry.points)
        if (isArrayObject(o)) return o.geometry.modules.flatMap((q) => flatToPts(q))
        if (o.kind === 'inverter' || o.kind === 'equipment') return [{ x: o.geometry.x, y: o.geometry.y }]
        return []
      })
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y)
      const [x0, x1, y0, y1] = pts.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, imgW, 0, imgH]
      const mx = (x1 - x0) * 0.05 + 20, my = (y1 - y0) * 0.05 + 20
      const crop = { x: Math.max(0, x0 - mx), y: Math.max(0, y0 - my), w: 0, h: 0 }
      crop.w = Math.min(imgW, x1 + mx) - crop.x
      crop.h = Math.min(imgH, y1 + my) - crop.y
      setExporting(true)
      await new Promise((r) => setTimeout(r, 60)) // redraw without selection chrome
      const savedScale = stage.scaleX()
      const savedPos = stage.position()
      try {
        stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 }); stage.draw()
        const pixelRatio = Math.min(1, 4000 / Math.max(crop.w, crop.h))
        const url = stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.85, x: crop.x, y: crop.y, width: crop.w, height: crop.h, pixelRatio })
        return { jpegBase64: url.split(',')[1] ?? '', crop }
      } finally {
        stage.scale({ x: savedScale, y: savedScale }); stage.position(savedPos); stage.draw()
        setExporting(false)
      }
  }, [img, imgW, imgH, p.objects])
  const { onExporter } = p
  useEffect(() => {
    onExporter?.(exportJpeg)
    return () => onExporter?.(null)
  }, [exportJpeg, onExporter])

  const strokeW = 2 / vp.scale
  const renderObject = (o: LayoutObject) => {
    const sel = !exporting && selected.has(o.id)
    switch (o.kind) {
      case 'roof':
        return <Line key={o.id} points={o.geometry.points} closed stroke={sel ? SEL : ROOF} strokeWidth={strokeW} fill="rgba(245,158,11,0.08)"
          onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)} />
      case 'obstruction':
        return isCircleGeometry(o.geometry)
          ? <Circle key={o.id} x={o.geometry.cx} y={o.geometry.cy} radius={o.geometry.r} stroke={sel ? SEL : OBST} strokeWidth={strokeW} fill="rgba(220,38,38,0.15)"
              onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)} />
          : <Line key={o.id} points={o.geometry.points} closed stroke={sel ? SEL : OBST} strokeWidth={strokeW} fill="rgba(220,38,38,0.15)"
              onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)} />
      case 'array':
      case 'module_block':
        return (
          <Group key={o.id} onDblClick={() => p.onSelect({ ids: [o.id], modules: [] })} onDblTap={() => p.onSelect({ ids: [o.id], modules: [] })}>
            {o.geometry.modules.map((q, i) => {
              const k = `${o.id}#${i}`
              const s = stringOf.get(k)
              const hot = !exporting && (sel || moduleSel.has(k))
              return <Line key={k} points={q} closed stroke={hot ? SEL : MODULE} strokeWidth={strokeW / 2}
                fill={s === undefined ? 'rgba(29,78,216,0.35)' : stringColour(s)} opacity={s === undefined ? 1 : 0.8}
                onMouseDown={(e) => pressModule(e, { arrayId: o.id, index: i })} onTouchStart={(e) => pressModule(e, { arrayId: o.id, index: i })} />
            })}
          </Group>
        )
      case 'inverter':
      case 'equipment': {
        const label = o.kind === 'inverter' ? 'INV' : o.props.equipmentKind === 'db' ? 'DB' : o.props.equipmentKind === 'battery' ? 'BAT' : 'CB'
        const size = 24 / vp.scale
        return (
          <Group key={o.id} x={o.geometry.x} y={o.geometry.y} onMouseDown={(e) => pressObject(e, o.id)} onTouchStart={(e) => pressObject(e, o.id)}>
            <Rect x={-size / 2} y={-size / 2} width={size} height={size} fill="white" stroke={sel ? SEL : '#111'} strokeWidth={strokeW} />
            <Text x={-size / 2} y={-size / 4} width={size} align="center" text={label} fontSize={size / 3} />
          </Group>
        )
      }
      default:
        return null
    }
  }

  const arraysById = useMemo(() => new Map(p.objects.filter(isArrayObject).map((a) => [a.id, a])), [p.objects])
  const stringLines = p.objects.filter((o) => o.kind === 'string').map((s, i) => {
    if (s.kind !== 'string') return null
    const pts = s.props.modules.flatMap((m) => {
      const q = arraysById.get(m.arrayId)?.geometry.modules[m.index]
      if (!q) return []
      const c = centroidOf(q)
      return [c.x, c.y]
    })
    return <Line key={s.id} points={pts} stroke={stringColour(i)} strokeWidth={strokeW * 1.5} listening={false} />
  })

  const measureLabel = p.tool === 'measure' && draft.length === 4 && p.sheetPixelsPerMeter
    ? `${(Math.hypot(draft[2]! - draft[0]!, draft[3]! - draft[1]!) / p.sheetPixelsPerMeter).toFixed(2)} m` : null
  const movable = p.objects.filter((o) => selected.has(o.id))
  const still = p.objects.filter((o) => !selected.has(o.id))

  return (
    <div ref={containerRef} style={{ position: 'relative', height: p.height ?? '70vh', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden', touchAction: 'none' }}>
      {loadError ? (
        <div role="alert" style={{ padding: 48, textAlign: 'center', color: '#dc2626' }}>{loadError}</div>
      ) : !img ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>{p.sheet.isPdf ? 'Rendering PDF…' : 'Loading sheet…'}</div>
      ) : (
        <Stage ref={stageRef} width={vp.viewport.w} height={vp.viewport.h} scaleX={vp.scale} scaleY={vp.scale} x={vp.offset.x} y={vp.offset.y}
          onMouseDown={onDown} onTouchStart={onDown} onMouseMove={onMove} onTouchMove={onMove} onMouseUp={onUp} onTouchEnd={onUp}
          onDblClick={finishPolygon} onDblTap={finishPolygon}
          style={{ cursor: vp.panning || vp.gestureActive ? 'grabbing' : p.tool === 'select' ? 'default' : 'crosshair', background: 'white' }}>
          <Layer>
            <KonvaImage image={img} listening={p.tool === 'select'} />
            {still.map(renderObject)}
            <Group ref={groupRef} draggable={!p.readOnly && p.tool === 'select' && movable.length > 0}
              onDragEnd={(e) => {
                const g = e.target as Konva.Group
                const dx = g.x(), dy = g.y()
                g.position({ x: 0, y: 0 })
                if (dx !== 0 || dy !== 0) p.onTranslate(p.selection.ids, dx, dy)
              }}
              onTransformEnd={() => {
                // The group's transform is translate(x, y) · rotate(θ) about the
                // group origin (0,0) = image origin, so the geometry maps exactly
                // as p' = rotate(p, θ) + (x, y). Hand that over and reset.
                const g = groupRef.current
                if (!g) return
                const deg = g.rotation()
                const dx = g.x(), dy = g.y()
                g.rotation(0); g.position({ x: 0, y: 0 }); g.scale({ x: 1, y: 1 })
                if (deg !== 0 || dx !== 0 || dy !== 0) p.onTransform(p.selection.ids, deg, dx, dy)
              }}>
              {movable.map(renderObject)}
            </Group>
            {stringLines}
            {p.preview && p.preview.map((q, i) => <Line key={`pv${i}`} points={q} closed stroke={SEL} dash={[4 / vp.scale, 4 / vp.scale]} strokeWidth={strokeW / 2} listening={false} />)}
            {draft.length >= 2 && <Line points={draft} stroke={SEL} strokeWidth={strokeW} dash={[6 / vp.scale, 4 / vp.scale]} listening={false} />}
            {measureLabel && <Text x={draft[2]!} y={draft[3]!} text={measureLabel} fontSize={14 / vp.scale} fill="#111" listening={false} />}
            {dragStart && dragNow && (p.tool === 'block' || p.tool === 'select') && (
              <Rect x={Math.min(dragStart.x, dragNow.x)} y={Math.min(dragStart.y, dragNow.y)} width={Math.abs(dragNow.x - dragStart.x)} height={Math.abs(dragNow.y - dragStart.y)}
                stroke={SEL} dash={[4 / vp.scale, 4 / vp.scale]} strokeWidth={strokeW / 2} listening={false} />
            )}
            {dragStart && dragNow && p.tool === 'obstruction' && p.circleMode && (
              <Circle x={dragStart.x} y={dragStart.y} radius={Math.hypot(dragNow.x - dragStart.x, dragNow.y - dragStart.y)} stroke={OBST} dash={[4 / vp.scale, 4 / vp.scale]} strokeWidth={strokeW} listening={false} />
            )}
            {!exporting && <Transformer ref={trRef} resizeEnabled={false} rotateEnabled flipEnabled={false} />}
          </Layer>
        </Stage>
      )}
      {img && (
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
          {closable && <button type="button" onClick={finishPolygon} title="Close the outline (Enter)">Close shape</button>}
          <button type="button" onClick={vp.fitToView} title="Fit to view (0)" aria-label="Fit to view">⤢</button>
          <button type="button" onClick={vp.zoomIn} title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button type="button" onClick={vp.zoomOut} title="Zoom out (−)" aria-label="Zoom out">−</button>
        </div>
      )}
    </div>
  )
}
