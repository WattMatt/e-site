'use client'
/**
 * Schematic canvas (spec §13.2) on the shared sheet primitives: useSheetImage (image space = the
 * drawing page rasterised at scale 2, or the image's natural size) and useSheetViewport (wheel,
 * pinch, space-drag, middle-drag, F/0 fit, +/- zoom). Presses are handled on mousedown/touchstart
 * (Konva `click` is not synthesised reliably). Everything drawn comes from props; state lives in the
 * workspace. Not component-tested (Konva does not run under jsdom) — the workspace test stubs it.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react'
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { isPrimaryDrawPress, isTouchEvent } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { backingSize, useSheetImage } from '@/lib/sheet/use-sheet-image'
import { useSheetViewport } from '@/lib/sheet/use-sheet-viewport'
import { linePoints, type SchematicDoc } from '@/lib/solar/schematics/editor'
import type { EditorMeter, EditorView } from '@/lib/solar/schematics/view-types'

export type Tool = 'select' | 'place' | 'connect'
export interface Layers { background: boolean; meters: boolean; lines: boolean }
export interface CanvasHandle {
  exportJpeg: () => { base64: string; w: number; h: number } | null
  backgroundDataUrl: () => string | null
  size: () => { w: number; h: number }
}
export interface PressEvent { kind: 'empty' | 'card' | 'line'; id?: string; x: number; y: number; shift: boolean }
export interface SchematicCanvasProps {
  sheet: EditorView['sheet']
  pageIndex: number
  blank: { w: number; h: number }
  doc: SchematicDoc
  meters: Map<string, EditorMeter>
  tool: Tool
  layers: Layers
  editable: boolean
  selectedCard: string | null
  selectedLine: string | null
  connectFrom: string | null
  draftWaypoints: number[]
  guides: Array<{ axis: 'x' | 'y'; at: number }>
  onPress: (e: PressEvent) => void
  onCardDrag: (meterId: string, x: number, y: number, shift: boolean, end: boolean) => void
  onResize: (meterId: string, w: number, h: number, end: boolean) => void
  onWaypointDrag: (key: string, index: number, x: number, y: number, end: boolean) => void
  onToggleInclude: (meterId: string) => void
  onPageInfo?: (page: number, count: number) => void
}

const CARD_COLOUR = '#2563eb'

export const SchematicCanvas = forwardRef<CanvasHandle, SchematicCanvasProps>(function SchematicCanvas(p, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const { img, loadError, currentPage, pageCount } = useSheetImage({
    planId: p.sheet?.planId ?? 'blank', signedUrl: p.sheet?.signedUrl ?? null, isPdf: p.sheet?.isPdf ?? false, initialPage: p.pageIndex,
  })
  const [iw, ih] = backingSize(img)
  const w = p.sheet ? iw || p.sheet.widthPx || p.blank.w : p.blank.w
  const h = p.sheet ? ih || p.sheet.heightPx || p.blank.h : p.blank.h
  const image = useMemo(() => (p.sheet ? (img ? { w: iw, h: ih } : null) : { w: p.blank.w, h: p.blank.h }), [p.sheet, img, iw, ih, p.blank.w, p.blank.h])
  const vp = useSheetViewport({ containerRef, image, resetKey: `${p.sheet?.planId ?? 'blank'}:${currentPage}` })
  const onPageInfo = p.onPageInfo
  useEffect(() => { if (p.sheet) onPageInfo?.(currentPage, pageCount) }, [p.sheet, onPageInfo, currentPage, pageCount])

  useImperativeHandle(ref, () => ({
    size: () => ({ w, h }),
    backgroundDataUrl: () => {
      if (!img) return null
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img as CanvasImageSource, 0, 0, w, h)
      return c.toDataURL('image/jpeg', 0.85)
    },
    exportJpeg: () => {
      const stage = stageRef.current
      if (!stage) return null
      // Render the whole sheet at its own pixel size, independent of the current zoom/pan.
      const prev = { x: stage.x(), y: stage.y(), sx: stage.scaleX(), sy: stage.scaleY(), w: stage.width(), h: stage.height() }
      stage.position({ x: 0, y: 0 }); stage.scale({ x: 1, y: 1 }); stage.size({ width: w, height: h })
      try {
        const url = stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.85, pixelRatio: Math.min(1, 6000 / Math.max(w, h)) })
        return { base64: url.slice(url.indexOf(',') + 1), w, h }
      } finally {
        stage.position({ x: prev.x, y: prev.y }); stage.scale({ x: prev.sx, y: prev.sy }); stage.size({ width: prev.w, height: prev.h })
      }
    },
  }), [img, w, h])

  const press = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, kind: PressEvent['kind'], id?: string) => {
    if (!isPrimaryDrawPress(e.evt) || vp.panningRef.current) return
    if (isTouchEvent(e.evt) && vp.touchCountRef.current > 1) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    e.cancelBubble = true
    p.onPress({ kind, id, x: pos.x, y: pos.y, shift: 'shiftKey' in e.evt ? Boolean((e.evt as MouseEvent).shiftKey) : false })
  }
  const s = vp.scale
  const px = (n: number) => n / Math.max(s, 0.2)

  let body: ReactNode
  if (p.sheet && !p.sheet.signedUrl) body = <div style={{ padding: 32 }}>This drawing cannot be shown here (PDF, PNG, JPG, WebP or SVG only).</div>
  else if (loadError) body = <div role="alert" style={{ padding: 32, color: '#dc2626' }}>{loadError}</div>
  else if (p.sheet && !img) body = <div style={{ padding: 32 }}>{p.sheet.isPdf ? 'Rendering PDF…' : 'Loading drawing…'}</div>
  else body = (
    <Stage ref={stageRef} width={vp.viewport.w} height={vp.viewport.h} scaleX={s} scaleY={s} x={vp.offset.x} y={vp.offset.y}
      draggable={p.tool === 'select' && !p.selectedCard && !vp.gestureActive}
      onDragEnd={(e) => {
        // Konva drag events BUBBLE: a dragged card or waypoint would otherwise write its image coordinates into the pan offset.
        if (e.target !== e.target.getStage()) return
        const t = e.target as Konva.Stage
        vp.setOffsetFromStage({ x: t.x(), y: t.y() })
      }}
      onMouseDown={(e) => { if (e.target === e.target.getStage()) press(e, 'empty') }}
      onTouchStart={(e) => { if (e.target === e.target.getStage()) press(e, 'empty') }}
      onDblClick={p.tool === 'select' ? vp.fitToView : undefined}
      style={{ cursor: vp.panning || vp.gestureActive ? 'grabbing' : p.tool === 'select' ? 'default' : 'crosshair' }}>
      <Layer listening={false}>
        <Rect x={0} y={0} width={w} height={h} fill="#ffffff" />
        {p.layers.background && img && <KonvaImage image={img} width={w} height={h} />}
      </Layer>
      {p.layers.lines && (
        <Layer>
          {p.doc.lines.map((l) => {
            const pts = linePoints(l, p.doc)
            if (!pts) return null
            const sel = p.selectedLine === l.key
            return (
              <Group key={l.key}>
                <Line points={pts} stroke={l.lineType === 'check' ? '#64748b' : '#d97706'} strokeWidth={px(sel ? 5 : 3)} dash={l.lineType === 'check' ? [8, 6] : undefined} hitStrokeWidth={px(14)}
                  onMouseDown={(e) => press(e, 'line', l.key)} onTouchStart={(e) => press(e, 'line', l.key)} />
                {sel && p.editable && Array.from({ length: l.waypoints.length / 2 }, (_, i) => (
                  <Circle key={i} x={l.waypoints[2 * i]} y={l.waypoints[2 * i + 1]} radius={px(6)} fill="#ffffff" stroke="#d97706" draggable
                    onMouseDown={(e) => { e.cancelBubble = true }}
                    onDragMove={(e) => p.onWaypointDrag(l.key, i, e.target.x(), e.target.y(), false)}
                    onDragEnd={(e) => { e.cancelBubble = true; p.onWaypointDrag(l.key, i, e.target.x(), e.target.y(), true) }} />
                ))}
              </Group>
            )
          })}
          {p.connectFrom && p.draftWaypoints.length >= 2 && (() => {
            const c = p.doc.cards.find((x) => x.meterId === p.connectFrom)
            return c ? <Line points={[c.x + c.w / 2, c.y + c.h / 2, ...p.draftWaypoints]} stroke="#d97706" dash={[4, 4]} strokeWidth={px(2)} listening={false} /> : null
          })()}
        </Layer>
      )}
      {p.layers.meters && (
        <Layer>
          {p.doc.cards.map((c) => {
            const m = p.meters.get(c.meterId)
            const colour = c.colour ?? CARD_COLOUR
            const sel = p.selectedCard === c.meterId || p.connectFrom === c.meterId
            return (
              <Group key={c.meterId} x={c.x} y={c.y} draggable={p.editable && p.tool === 'select'}
                onMouseDown={(e) => press(e, 'card', c.meterId)} onTouchStart={(e) => press(e, 'card', c.meterId)}
                onDragMove={(e) => { if (e.target !== e.currentTarget) return; p.onCardDrag(c.meterId, e.target.x(), e.target.y(), Boolean((e.evt as MouseEvent)?.shiftKey), false) }}
                onDragEnd={(e) => { e.cancelBubble = true; if (e.target !== e.currentTarget) return; p.onCardDrag(c.meterId, e.target.x(), e.target.y(), Boolean((e.evt as MouseEvent)?.shiftKey), true) }}>
                <Rect width={c.w} height={c.h} cornerRadius={6} fill="#ffffff" stroke={sel ? '#d97706' : colour} strokeWidth={px(sel ? 3 : 2)} dash={m?.included === false ? [6, 4] : undefined} />
                <Rect width={8} height={c.h} fill={colour} />
                <Text x={14} y={8} width={Math.max(10, c.w - 40)} text={m?.label ?? 'Meter'} fontSize={16} fill="#0f172a" ellipsis wrap="none" />
                <Text x={14} y={30} width={Math.max(10, c.w - 20)} text={`${m?.kind ?? ''}${m?.tenantLabel ? ` · ${m.tenantLabel}` : ''}`} fontSize={12} fill="#475569" ellipsis wrap="none" />
                <Circle x={c.w - 14} y={14} radius={8} fill={m?.included === true ? '#16a34a' : m?.included === false ? '#e2e8f0' : '#f8fafc'} stroke="#64748b" strokeWidth={1}
                  onMouseDown={(e) => { e.cancelBubble = true; if (p.editable) p.onToggleInclude(c.meterId) }}
                  onTouchStart={(e) => { e.cancelBubble = true; if (p.editable) p.onToggleInclude(c.meterId) }} />
                {p.editable && p.selectedCard === c.meterId && (
                  <Rect x={c.w - 6} y={c.h - 6} width={12} height={12} fill="#d97706" draggable
                    onMouseDown={(e) => { e.cancelBubble = true }}
                    onDragMove={(e) => { e.cancelBubble = true; p.onResize(c.meterId, e.target.x() + 6, e.target.y() + 6, false) }}
                    onDragEnd={(e) => { e.cancelBubble = true; p.onResize(c.meterId, e.target.x() + 6, e.target.y() + 6, true) }} />
                )}
              </Group>
            )
          })}
          {p.guides.map((g, i) => g.axis === 'x'
            ? <Line key={i} points={[g.at, 0, g.at, h]} stroke="#7c3aed" dash={[4, 4]} strokeWidth={px(1)} listening={false} />
            : <Line key={i} points={[0, g.at, w, g.at]} stroke="#7c3aed" dash={[4, 4]} strokeWidth={px(1)} listening={false} />)}
        </Layer>
      )}
    </Stage>
  )

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '70vh', border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden', touchAction: 'none', WebkitUserSelect: 'none', background: '#f8fafc' }}>
        {body}
      </div>
      <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 4 }}>
        <button type="button" aria-label="Zoom out" onClick={() => vp.zoomOut()}>−</button>
        <button type="button" aria-label="Fit to view" onClick={() => vp.fitToView()}>Fit</button>
        <button type="button" aria-label="Zoom in" onClick={() => vp.zoomIn()}>+</button>
      </div>
    </div>
  )
})
