'use client'
/**
 * The Gantt timeline (Konva). Draws ONLY what layoutGantt() returns; every
 * interaction is reported through callbacks in whole days, and the caller
 * turns it into one undoable entry (one drag = one undo step, spec §14.2).
 *
 * No component test: Konva does not render under jsdom (the known gap shared
 * with RouteCanvas / MarkupCanvas). Geometry is tested in @esite/shared
 * (layoutGantt); behaviour through ScheduleClient's test with a stub of this
 * component. Konva lessons from #190: select on MOUSEDOWN, not click; the PNG
 * is `toDataURL` of the stage. Load it with next/dynamic `{ ssr: false }` —
 * Konva cannot render on the server.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Circle, Group, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { GANTT_HEADER_HEIGHT, type GanttBar, type GanttLayout } from '@esite/shared'

export interface GanttCanvasHandle {
  /** A PNG data URL of the whole timeline, or null before the stage exists. */
  exportPng: () => string | null
  /** Scroll so x (a layout coordinate) is near the left edge. */
  scrollToX: (x: number) => void
  scrollBy: (dx: number) => void
}

export type BarDragKind = 'move' | 'start' | 'end' | 'segment'

export interface GanttCanvasProps {
  layout: GanttLayout
  canEdit: boolean
  selected: ReadonlySet<string>
  /** A finished drag, in whole days (never 0). `segmentIndex` is set for kind 'segment'. */
  onBarDrag: (taskId: string, kind: BarDragKind, deltaDays: number, segmentIndex: number | null) => void
  /** A dependency drawn from one bar's end handle to another bar. */
  onLinkDraw: (predecessorId: string, successorId: string) => void
  onSelect: (taskId: string, additive: boolean) => void
  onOpenTask: (taskId: string) => void
  /** `linkKey` from @esite/shared (`pred>succ`). */
  onOpenLink: (linkKey: string) => void
}

const HANDLE = 6
const SHADE = { weekend: '#f3f4f6', holiday: '#fde68a' } as const

type Drag = { bar: GanttBar; kind: BarDragKind; x0: number; dx: number }
type Draft = { from: GanttBar; x1: number; y1: number; x2: number; y2: number }

function barAt(bars: readonly GanttBar[], x: number, y: number): GanttBar | null {
  return bars.find((b) => y >= b.y && y <= b.y + b.h && (b.kind === 'milestone' ? Math.abs(x - b.x) <= 7 : x >= b.x && x <= b.x + b.w)) ?? null
}

export const GanttCanvas = forwardRef<GanttCanvasHandle, GanttCanvasProps>(function GanttCanvas(p, ref) {
  const stageRef = useRef<Konva.Stage>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const l = p.layout

  useImperativeHandle(ref, () => ({
    exportPng: () => stageRef.current?.toDataURL({ pixelRatio: l.width > 8000 ? 1 : 2, mimeType: 'image/png' }) ?? null,
    scrollToX: (x: number) => { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x - 200) },
    scrollBy: (dx: number) => { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, scrollRef.current.scrollLeft + dx) },
  }), [l.width])

  const pointer = () => stageRef.current?.getPointerPosition() ?? { x: 0, y: 0 }
  const startDrag = (bar: GanttBar, kind: BarDragKind) => { if (p.canEdit) setDrag({ bar, kind, x0: pointer().x, dx: 0 }) }

  /** Where the dragged bar draws right now, snapped to whole days. */
  const offsetFor = (b: GanttBar) => {
    if (!drag || drag.bar.taskId !== b.taskId) return { x: 0, w: 0 }
    const d = Math.round(drag.dx / l.dayWidth) * l.dayWidth
    if (drag.kind === 'segment') return drag.bar.segmentIndex === b.segmentIndex ? { x: d, w: 0 } : { x: 0, w: 0 }
    if (drag.kind === 'move') return { x: d, w: 0 }
    if (drag.kind === 'start') { const s = Math.min(d, b.w - l.dayWidth); return { x: s, w: -s } }
    return { x: 0, w: Math.max(d, -(b.w - l.dayWidth)) }
  }

  function finish() {
    const pt = pointer()
    if (drag) {
      const delta = Math.round(drag.dx / l.dayWidth)
      if (delta !== 0) p.onBarDrag(drag.bar.taskId, drag.kind, delta, drag.bar.segmentIndex)
      setDrag(null)
    }
    if (draft) {
      const target = barAt(l.bars, pt.x, pt.y)
      if (target && target.taskId !== draft.from.taskId) p.onLinkDraw(draft.from.taskId, target.taskId)
      setDraft(null)
    }
  }

  return (
    <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', flex: 1, minWidth: 0 }}>
      <Stage
        ref={stageRef}
        width={l.width}
        height={l.height}
        onMouseMove={() => {
          const pt = pointer()
          if (drag) setDrag({ ...drag, dx: pt.x - drag.x0 })
          if (draft) setDraft({ ...draft, x2: pt.x, y2: pt.y })
        }}
        onMouseUp={finish}
        // Leaving the chart mid-gesture cancels it: nothing is saved.
        onMouseLeave={() => { setDrag(null); setDraft(null) }}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={l.width} height={l.height} fill="#ffffff" />
          {l.shades.map((s) => <Rect key={`${s.kind}${s.x}`} x={s.x} y={0} width={s.w} height={l.height} fill={SHADE[s.kind]} opacity={0.6} />)}
          <Rect x={0} y={0} width={l.width} height={GANTT_HEADER_HEIGHT} fill="#fafafa" />
          {l.ticks.map((t) => (
            <Group key={`t${t.x}`}>
              <Line points={[t.x, GANTT_HEADER_HEIGHT - 10, t.x, l.height]} stroke={t.major ? '#d1d5db' : '#eeeeee'} strokeWidth={1} />
              <Text x={t.x + 3} y={GANTT_HEADER_HEIGHT - 22} text={t.label} fontSize={10} fill="#374151" />
            </Group>
          ))}
          {l.todayX !== null && <Line points={[l.todayX, 0, l.todayX, l.height]} stroke="#ef4444" strokeWidth={1.5} dash={[4, 3]} />}
          {l.baselineBars.map((b) => <Rect key={`bl${b.taskId}`} x={b.x} y={b.y} width={b.w} height={3} fill="#9ca3af" />)}
        </Layer>
        <Layer>
          {l.links.map((k) => (
            <Line key={k.key} points={k.points} stroke={k.critical ? '#dc2626' : '#6b7280'} strokeWidth={k.critical ? 2 : 1.25}
              hitStrokeWidth={8} onMouseDown={() => p.onOpenLink(k.key)} />
          ))}
          {l.bars.map((b) => {
            const off = offsetFor(b)
            const sel = p.selected.has(b.taskId)
            const stroke = b.critical ? '#dc2626' : sel ? '#111827' : undefined
            if (b.kind === 'milestone') {
              return (
                <RegularPolygon key={`m${b.taskId}`} x={b.x + off.x} y={b.y + b.h / 2} sides={4} radius={7} fill={b.critical ? '#dc2626' : '#111827'}
                  stroke={sel ? '#f59e0b' : undefined} strokeWidth={2}
                  onMouseDown={(e) => { p.onSelect(b.taskId, e.evt.shiftKey); startDrag(b, 'move') }}
                  onDblClick={() => p.onOpenTask(b.taskId)} />
              )
            }
            const kind: BarDragKind = b.kind === 'segment' ? 'segment' : 'move'
            const w = Math.max(2, b.w + off.w)
            return (
              <Group key={`b${b.taskId}${b.segmentIndex ?? ''}`}>
                <Rect x={b.x + off.x} y={b.y} width={w} height={b.h} fill={b.colour} cornerRadius={3}
                  stroke={stroke} strokeWidth={stroke ? 2 : 0}
                  onMouseDown={(e) => { p.onSelect(b.taskId, e.evt.shiftKey); startDrag(b, kind) }}
                  onDblClick={() => p.onOpenTask(b.taskId)} />
                <Rect x={b.x + off.x} y={b.y + b.h - 3} width={Math.max(0, w * (b.progress / 100))} height={3} fill="#00000055" listening={false} />
                {p.canEdit && b.kind === 'task' && (
                  <>
                    <Rect x={b.x + off.x} y={b.y} width={HANDLE} height={b.h} fill="#00000000"
                      onMouseDown={(e) => { e.cancelBubble = true; startDrag(b, 'start') }} />
                    <Rect x={b.x + off.x + w - HANDLE} y={b.y} width={HANDLE} height={b.h} fill="#00000000"
                      onMouseDown={(e) => { e.cancelBubble = true; startDrag(b, 'end') }} />
                    <Circle x={b.x + off.x + w + 6} y={b.y + b.h / 2} radius={4} fill="#ffffff" stroke="#6b7280"
                      onMouseDown={(e) => { e.cancelBubble = true; const pt = pointer(); setDraft({ from: b, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }) }} />
                  </>
                )}
              </Group>
            )
          })}
          {draft && <Line points={[draft.x1, draft.y1, draft.x2, draft.y2]} stroke="#2563eb" dash={[4, 4]} listening={false} />}
        </Layer>
      </Stage>
    </div>
  )
})
