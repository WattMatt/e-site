'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type Konva from 'konva'
import {
  Pencil, MousePointer2, ArrowUpRight, Square, Circle as CircleIcon,
  Type, MapPin, Undo2, Redo2, X, Check, Trash2,
} from 'lucide-react'
import type {
  AnnotationData, AnnotationShape, AnnotationTool, AnnotationColor,
} from './types'

// react-konva imports must be client-only. Next 15 RSC can't bundle them.
const Stage   = dynamic(() => import('react-konva').then(m => m.Stage),   { ssr: false })
const Layer   = dynamic(() => import('react-konva').then(m => m.Layer),   { ssr: false })
const Image   = dynamic(() => import('react-konva').then(m => m.Image),   { ssr: false })
const Line    = dynamic(() => import('react-konva').then(m => m.Line),    { ssr: false })
const Arrow   = dynamic(() => import('react-konva').then(m => m.Arrow),   { ssr: false })
const Rect    = dynamic(() => import('react-konva').then(m => m.Rect),    { ssr: false })
const Circle  = dynamic(() => import('react-konva').then(m => m.Circle),  { ssr: false })
const KText   = dynamic(() => import('react-konva').then(m => m.Text),    { ssr: false })
const Group   = dynamic(() => import('react-konva').then(m => m.Group),   { ssr: false })

const COLORS: AnnotationColor[] = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#000000']
const MAX_CANVAS_WIDTH = 1280
const STROKE_WIDTH = 3

interface Props {
  floorPlanName: string
  sourceImageUrl: string
  sourceFloorPlanId: string | null
  initialAnnotation?: AnnotationData | null
  onCancel: () => void
  onSave: (result: { blob: Blob; annotationData: AnnotationData; previewUrl: string }) => void
}

export function FloorPlanAnnotator({
  floorPlanName, sourceImageUrl, sourceFloorPlanId, initialAnnotation, onCancel, onSave,
}: Props) {
  const stageRef = useRef<Konva.Stage>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [canvas, setCanvas] = useState({ width: 800, height: 600 })
  const [baseSize, setBaseSize] = useState({ naturalWidth: 0, naturalHeight: 0 })
  const [tool, setTool] = useState<AnnotationTool>('pen')
  const [color, setColor] = useState<AnnotationColor>('#ef4444')
  const [shapes, setShapes] = useState<AnnotationShape[]>(initialAnnotation?.shapes ?? [])
  const [history, setHistory] = useState<AnnotationShape[][]>([])
  const [future, setFuture]   = useState<AnnotationShape[][]>([])
  const [drawing, setDrawing] = useState<AnnotationShape | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Load the source image, scale to fit.
  useEffect(() => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const ratio = img.naturalHeight / img.naturalWidth
      const width = Math.min(MAX_CANVAS_WIDTH, img.naturalWidth)
      const height = width * ratio
      setCanvas({ width, height })
      setBaseSize({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      setImage(img)
    }
    img.onerror = () => {
      setCanvas({ width: 800, height: 600 })
    }
    img.src = sourceImageUrl
  }, [sourceImageUrl])

  const pushHistory = useCallback((next: AnnotationShape[]) => {
    setHistory(prev => [...prev.slice(-49), shapes])
    setFuture([])
    setShapes(next)
  }, [shapes])

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]!
      setFuture(fprev => [shapes, ...fprev])
      setShapes(last)
      return prev.slice(0, -1)
    })
  }, [shapes])

  const redo = useCallback(() => {
    setFuture(prev => {
      if (prev.length === 0) return prev
      const [next, ...rest] = prev
      setHistory(hprev => [...hprev, shapes])
      setShapes(next!)
      return rest
    })
  }, [shapes])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) ||
               ((e.metaKey || e.ctrlKey) && e.key === 'y')) { e.preventDefault(); redo() }
      else if (e.key === 'Escape') onCancel()
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        pushHistory(shapes.filter(s => s.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, onCancel, selectedId, shapes, pushHistory])

  function mkId() { return Math.random().toString(36).slice(2, 10) }

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return

    if (tool === 'select') {
      // Click background clears selection
      if (e.target === e.target.getStage() || e.target.attrs?.name === 'bg') setSelectedId(null)
      return
    }

    if (tool === 'text') {
      const value = window.prompt('Text label:')
      if (value?.trim()) {
        pushHistory([...shapes, {
          id: mkId(), type: 'text', x: pos.x, y: pos.y, text: value.trim(), color, fontSize: 18,
        }])
      }
      return
    }

    if (tool === 'pin') {
      const label = window.prompt('Pin label (optional):')
      pushHistory([...shapes, {
        id: mkId(), type: 'pin', x: pos.x, y: pos.y, color, label: label?.trim() || undefined,
      }])
      return
    }

    if (tool === 'pen') {
      setDrawing({ id: mkId(), type: 'pen', points: [pos.x, pos.y], color, strokeWidth: STROKE_WIDTH })
    } else if (tool === 'arrow') {
      setDrawing({ id: mkId(), type: 'arrow', points: [pos.x, pos.y, pos.x, pos.y], color, strokeWidth: STROKE_WIDTH })
    } else if (tool === 'rect') {
      setDrawing({ id: mkId(), type: 'rect', x: pos.x, y: pos.y, width: 0, height: 0, color, strokeWidth: STROKE_WIDTH })
    } else if (tool === 'circle') {
      setDrawing({ id: mkId(), type: 'circle', x: pos.x, y: pos.y, radius: 0, color, strokeWidth: STROKE_WIDTH })
    }
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!drawing) return
    const pos = e.target.getStage()?.getPointerPosition()
    if (!pos) return
    if (drawing.type === 'pen') {
      setDrawing({ ...drawing, points: [...drawing.points, pos.x, pos.y] })
    } else if (drawing.type === 'arrow') {
      setDrawing({ ...drawing, points: [drawing.points[0], drawing.points[1], pos.x, pos.y] })
    } else if (drawing.type === 'rect') {
      setDrawing({ ...drawing, width: pos.x - drawing.x, height: pos.y - drawing.y })
    } else if (drawing.type === 'circle') {
      const dx = pos.x - drawing.x, dy = pos.y - drawing.y
      setDrawing({ ...drawing, radius: Math.sqrt(dx * dx + dy * dy) })
    }
  }

  function handleMouseUp() {
    if (!drawing) return
    const trivial =
      (drawing.type === 'rect'   && Math.abs(drawing.width) < 3 && Math.abs(drawing.height) < 3) ||
      (drawing.type === 'circle' && drawing.radius < 3) ||
      (drawing.type === 'pen'    && drawing.points.length < 4)
    if (!trivial) pushHistory([...shapes, drawing])
    setDrawing(null)
  }

  async function handleSave() {
    if (!stageRef.current) return
    setSaving(true)
    try {
      const dataUrl = stageRef.current.toDataURL({ mimeType: 'image/png', pixelRatio: 2 })
      const blob = await (await fetch(dataUrl)).blob()
      const annotationData: AnnotationData = {
        version: 1,
        canvas,
        baseImage: { ...baseSize, signedUrl: sourceImageUrl },
        shapes,
      }
      onSave({ blob, annotationData, previewUrl: dataUrl })
    } finally {
      setSaving(false)
    }
  }

  const current = drawing ? [...shapes, drawing] : shapes

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 80,
      background: 'rgba(11,11,18,0.92)', backdropFilter: 'blur(6px)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid var(--c-border)',
        background: 'var(--c-panel)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)', letterSpacing: '-0.01em' }}>
            Mark up: {floorPlanName}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.04em', marginTop: 2 }}>
            {shapes.length} annotation{shapes.length !== 1 ? 's' : ''} · ⌘Z undo · ESC cancel
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            type="button"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 6,
              background: 'transparent', border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)', fontSize: 12, cursor: 'pointer',
            }}
          >
            <X size={14} /> Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            type="button"
            className="btn-primary-amber"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}
          >
            <Check size={14} /> {saving ? 'Saving…' : 'Save annotation'}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', borderBottom: '1px solid var(--c-border)',
        background: 'var(--c-surface, #13131E)',
      }}>
        <ToolBtn active={tool === 'select'} onClick={() => setTool('select')} icon={<MousePointer2 size={15} />} label="Select" />
        <ToolBtn active={tool === 'pen'}    onClick={() => setTool('pen')}    icon={<Pencil size={15} />}        label="Pen" />
        <ToolBtn active={tool === 'arrow'}  onClick={() => setTool('arrow')}  icon={<ArrowUpRight size={15} />}  label="Arrow" />
        <ToolBtn active={tool === 'rect'}   onClick={() => setTool('rect')}   icon={<Square size={15} />}        label="Rect" />
        <ToolBtn active={tool === 'circle'} onClick={() => setTool('circle')} icon={<CircleIcon size={15} />}    label="Circle" />
        <ToolBtn active={tool === 'text'}   onClick={() => setTool('text')}   icon={<Type size={15} />}          label="Text" />
        <ToolBtn active={tool === 'pin'}    onClick={() => setTool('pin')}    icon={<MapPin size={15} />}        label="Pin" />

        <div style={{ width: 1, height: 22, background: 'var(--c-border)', margin: '0 4px' }} />

        {/* Colours */}
        <div style={{ display: 'flex', gap: 5 }}>
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              style={{
                width: 22, height: 22, borderRadius: 4, background: c,
                border: color === c ? '2px solid var(--c-amber)' : '1px solid var(--c-border)',
                cursor: 'pointer', padding: 0,
              }}
            />
          ))}
        </div>

        <div style={{ width: 1, height: 22, background: 'var(--c-border)', margin: '0 4px' }} />

        <ToolBtn active={false} onClick={undo} disabled={history.length === 0} icon={<Undo2 size={15} />} label="Undo" />
        <ToolBtn active={false} onClick={redo} disabled={future.length === 0} icon={<Redo2 size={15} />} label="Redo" />

        {selectedId && (
          <>
            <div style={{ width: 1, height: 22, background: 'var(--c-border)', margin: '0 4px' }} />
            <ToolBtn
              active={false}
              onClick={() => { pushHistory(shapes.filter(s => s.id !== selectedId)); setSelectedId(null) }}
              icon={<Trash2 size={15} />}
              label="Delete"
              danger
            />
          </>
        )}
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24 }}>
        <div style={{ border: '1px solid var(--c-border)', background: 'var(--c-base)' }}>
          <Stage
            ref={stageRef as any}
            width={canvas.width}
            height={canvas.height}
            onMouseDown={handleMouseDown}
            onMousemove={handleMouseMove}
            onMouseup={handleMouseUp}
            onTouchstart={handleMouseDown as any}
            onTouchmove={handleMouseMove as any}
            onTouchend={handleMouseUp}
          >
            <Layer>
              {image && <Image image={image} width={canvas.width} height={canvas.height} name="bg" listening={true} />}
            </Layer>
            <Layer>
              {current.map(s => renderShape(s, tool === 'select', selectedId === s.id, () => setSelectedId(s.id)))}
            </Layer>
          </Stage>
        </div>
      </div>
    </div>
  )
}

function renderShape(
  s: AnnotationShape,
  selectable: boolean,
  isSelected: boolean,
  onSelect: () => void,
) {
  const sel = isSelected ? { shadowColor: '#f59e0b', shadowBlur: 6 } : {}
  const common = {
    key: s.id,
    onClick: selectable ? onSelect : undefined,
    onTap:   selectable ? onSelect : undefined,
    listening: selectable,
    ...sel,
  }
  if (s.type === 'pen') {
    return <Line {...common} points={s.points} stroke={s.color} strokeWidth={s.strokeWidth} tension={0.4} lineCap="round" lineJoin="round" />
  }
  if (s.type === 'arrow') {
    return <Arrow {...common} points={s.points} stroke={s.color} fill={s.color} strokeWidth={s.strokeWidth} pointerLength={10} pointerWidth={10} />
  }
  if (s.type === 'rect') {
    return <Rect {...common} x={s.x} y={s.y} width={s.width} height={s.height} stroke={s.color} strokeWidth={s.strokeWidth} />
  }
  if (s.type === 'circle') {
    return <Circle {...common} x={s.x} y={s.y} radius={s.radius} stroke={s.color} strokeWidth={s.strokeWidth} />
  }
  if (s.type === 'text') {
    return <KText {...common} x={s.x} y={s.y} text={s.text} fill={s.color} fontSize={s.fontSize} fontStyle="bold" />
  }
  if (s.type === 'pin') {
    return (
      <Group {...common} x={s.x} y={s.y}>
        <Circle x={0} y={0} radius={10} fill={s.color} stroke="#0B0B12" strokeWidth={2} />
        <Circle x={0} y={0} radius={3} fill="#0B0B12" />
        {s.label && <KText x={14} y={-8} text={s.label} fontSize={13} fill={s.color} fontStyle="bold" />}
      </Group>
    )
  }
  return null
}

function ToolBtn({
  active, onClick, icon, label, disabled, danger,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
  disabled?: boolean; danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 10px', borderRadius: 5,
        background: active ? 'var(--c-amber-dim)' : 'transparent',
        border: `1px solid ${active ? 'var(--c-amber)' : 'var(--c-border)'}`,
        color: danger ? '#fca5a5' : active ? 'var(--c-amber)' : 'var(--c-text-mid)',
        fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon} {label}
    </button>
  )
}
