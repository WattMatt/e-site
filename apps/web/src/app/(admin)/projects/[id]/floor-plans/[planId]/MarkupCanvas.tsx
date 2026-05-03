'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Line,
  Rect,
  Arrow,
  Text as KonvaText,
  Group,
  Circle,
} from 'react-konva'
import type Konva from 'konva'
import { createClient } from '@/lib/supabase/client'
import {
  createRfiAnnotationAction,
  updateRfiAnnotationAction,
} from '@/actions/rfi-annotation.actions'

// ─────────────────────────────────────────────────────────────────────────
// Types — scene graph format matches migration 00033 docstring:
//   { version, canvas: {w,h}, shapes: [{type, points, color, strokeWidth, ...}] }
// ─────────────────────────────────────────────────────────────────────────
type ToolMode =
  | 'select'
  | 'pen'
  | 'arrow'
  | 'rect'
  | 'text'
  | 'pin'
  | 'measure'
  | 'calibrate'

type ShapeBase = { id: string; color: string }
type PenShape = ShapeBase & { type: 'pen'; points: number[]; strokeWidth: number }
type ArrowShape = ShapeBase & { type: 'arrow'; points: [number, number, number, number]; strokeWidth: number }
type RectShape = ShapeBase & { type: 'rect'; x: number; y: number; width: number; height: number; strokeWidth: number }
type TextShape = ShapeBase & { type: 'text'; x: number; y: number; text: string; fontSize: number }
type PinShape = ShapeBase & { type: 'pin'; x: number; y: number; label: string }
type MeasureShape = ShapeBase & { type: 'measure'; points: [number, number, number, number]; strokeWidth: number }

type AnyShape = PenShape | ArrowShape | RectShape | TextShape | PinShape | MeasureShape

export type SceneGraph = {
  version: 1
  canvas: { w: number; h: number }
  shapes: AnyShape[]
}

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────
const COLORS = [
  { value: '#dc2626', label: 'Red' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#1f2937', label: 'Charcoal' },
] as const

const STROKE_WIDTHS = [
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Medium' },
  { value: 8, label: 'Thick' },
] as const

const TOOLS: Array<{ value: ToolMode; label: string; needsCalibration?: boolean; title: string }> = [
  { value: 'select', label: '↖', title: 'Select / pan' },
  { value: 'pen', label: '✎', title: 'Pen — freehand' },
  { value: 'arrow', label: '→', title: 'Arrow' },
  { value: 'rect', label: '▭', title: 'Rectangle' },
  { value: 'text', label: 'T', title: 'Text' },
  { value: 'pin', label: '◉', title: 'Pin (numbered)' },
  { value: 'measure', label: '⤢', needsCalibration: true, title: 'Measure (requires calibration)' },
]

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
function makeId() {
  return Math.random().toString(36).slice(2, 11)
}

function pxDist(a: [number, number], b: [number, number]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

// ─────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────
export type RfiOption = { id: string; subject: string; status: string }

export type EditingAnnotation = {
  id: string
  rfiId: string
  scene: SceneGraph
}

type Props = {
  plan: {
    id: string
    signedUrl: string | null
    width_px: number | null
    height_px: number | null
    pixels_per_meter: number | null
    isPdf: boolean
  }
  snagPins: Array<{ id: string; floor_plan_pin: { x: number; y: number } }>
  projectId: string
  rfis: RfiOption[]
  editing: EditingAnnotation | null
}

type Backing = HTMLImageElement | HTMLCanvasElement

function backingSize(b: Backing | null): [number, number] {
  if (!b) return [0, 0]
  return b instanceof HTMLImageElement ? [b.naturalWidth, b.naturalHeight] : [b.width, b.height]
}

export function MarkupCanvas({ plan, snagPins, projectId, rfis, editing }: Props) {
  const router = useRouter()
  const [tool, setTool] = useState<ToolMode>('select')
  const [color, setColor] = useState<string>(COLORS[0].value)
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_WIDTHS[1].value)
  const [shapes, setShapes] = useState<AnyShape[]>(editing?.scene.shapes ?? [])
  const [current, setCurrent] = useState<AnyShape | null>(null)
  const [undoStack, setUndoStack] = useState<AnyShape[][]>([])
  const [redoStack, setRedoStack] = useState<AnyShape[][]>([])
  const [pixelsPerMeter, setPixelsPerMeter] = useState<number | null>(plan.pixels_per_meter)
  const [calibPoints, setCalibPoints] = useState<Array<[number, number]>>([])
  const [calibDistance, setCalibDistance] = useState('')
  const [calibSaving, setCalibSaving] = useState(false)
  const [calibError, setCalibError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerRfiId, setPickerRfiId] = useState<string>('')

  // Load image (or PDF rasterised page 1 to a canvas via pdfjs-dist).
  const [img, setImg] = useState<Backing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    if (!plan.signedUrl) return
    let cancelled = false
    setLoadError(null)

    if (plan.isPdf) {
      ;(async () => {
        try {
          const pdfjsLib = await import('pdfjs-dist')
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
          }
          const loadingTask = pdfjsLib.getDocument(plan.signedUrl!)
          const pdf = await loadingTask.promise
          if (cancelled) return
          const page = await pdf.getPage(1)
          // scale=2 → ~2x raster vs PDF point grid; readable for A1/A3 drawings.
          const viewport = page.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('2d context unavailable')
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          } as Parameters<typeof page.render>[0]).promise
          if (cancelled) return
          setImg(canvas)
        } catch (err) {
          if (cancelled) return
          setLoadError(err instanceof Error ? err.message : 'PDF render failed')
        }
      })()
    } else {
      const i = new window.Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => {
        if (!cancelled) setImg(i)
      }
      i.onerror = () => {
        if (!cancelled) setLoadError('Image failed to load')
      }
      i.src = plan.signedUrl
    }

    return () => {
      cancelled = true
    }
  }, [plan.signedUrl, plan.isPdf])

  const [imgW, imgH] = backingSize(img)
  const naturalW = plan.width_px || imgW || 800
  const naturalH = plan.height_px || imgH || 600
  const stageRef = useRef<Konva.Stage | null>(null)

  // ── Viewport / zoom / pan ─────────────────────────────────────────────
  // Container is fixed-size; Stage is the same dimensions and we scale +
  // translate the inner image. Initial fit-to-view runs once per drawing.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ w: 800, h: 560 })
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const initFitDone = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setViewport({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset auto-fit when source changes.
  useEffect(() => {
    initFitDone.current = false
  }, [plan.signedUrl, plan.isPdf])

  const fitToView = useCallback(() => {
    if (!img) return
    const [iw, ih] = backingSize(img)
    if (iw === 0 || ih === 0 || viewport.w < 50 || viewport.h < 50) return
    const s = Math.min(viewport.w / iw, viewport.h / ih) * 0.95
    setScale(s)
    setOffset({ x: (viewport.w - iw * s) / 2, y: (viewport.h - ih * s) / 2 })
  }, [img, viewport.w, viewport.h])

  // First-load auto-fit
  useEffect(() => {
    if (!img || initFitDone.current) return
    if (viewport.w < 50) return
    fitToView()
    initFitDone.current = true
  }, [img, viewport.w, viewport.h, fitToView])

  function zoomIn() {
    setScale((s) => Math.min(s * 1.25, 8))
  }
  function zoomOut() {
    setScale((s) => Math.max(s / 1.25, 0.05))
  }

  // Keyboard: F or 0 → fit-to-view, +/= zoom in, - zoom out.
  // Skip when typing in an input/textarea so calibration entry isn't hijacked.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'f' || e.key === 'F' || e.key === '0') {
        e.preventDefault()
        fitToView()
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomOut()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitToView])

  // ── History ───────────────────────────────────────────────────────────
  function pushHistory(prev: AnyShape[]) {
    setUndoStack((s) => [...s, prev])
    setRedoStack([])
  }

  function commit(next: AnyShape) {
    pushHistory(shapes)
    setShapes((s) => [...s, next])
    setCurrent(null)
  }

  function undo() {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack((r) => [...r, shapes])
    setShapes(prev)
    setUndoStack((u) => u.slice(0, -1))
  }

  function redo() {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack((u) => [...u, shapes])
    setShapes(next)
    setRedoStack((r) => r.slice(0, -1))
  }

  function clearAll() {
    if (shapes.length === 0) return
    pushHistory(shapes)
    setShapes([])
  }

  // ── Pointer handlers ──────────────────────────────────────────────────
  function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getRelativePointerPosition()
    if (!pos) return
    const { x, y } = pos

    if (tool === 'calibrate') {
      setCalibPoints((p) => {
        if (p.length === 0) return [[x, y]]
        if (p.length === 1) return [...p, [x, y]]
        return [[x, y]]
      })
      return
    }

    if (tool === 'select') return

    if (tool === 'text') {
      const text = window.prompt('Text:')?.trim()
      if (!text) return
      commit({ id: makeId(), type: 'text', x, y, text, fontSize: 14 + strokeWidth * 2, color })
      return
    }

    if (tool === 'pin') {
      const existing = shapes.filter((s) => s.type === 'pin').length
      commit({ id: makeId(), type: 'pin', x, y, label: String(existing + 1), color })
      return
    }

    if (tool === 'pen') {
      setCurrent({ id: makeId(), type: 'pen', points: [x, y], color, strokeWidth })
      return
    }

    if (tool === 'arrow') {
      setCurrent({ id: makeId(), type: 'arrow', points: [x, y, x, y], color, strokeWidth })
      return
    }

    if (tool === 'rect') {
      setCurrent({ id: makeId(), type: 'rect', x, y, width: 0, height: 0, color, strokeWidth })
      return
    }

    if (tool === 'measure') {
      if (!pixelsPerMeter) return
      setCurrent({ id: makeId(), type: 'measure', points: [x, y, x, y], color, strokeWidth })
      return
    }
  }

  function onPointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!current) return
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getRelativePointerPosition()
    if (!pos) return
    const { x, y } = pos

    setCurrent((c) => {
      if (!c) return c
      switch (c.type) {
        case 'pen':
          return { ...c, points: [...c.points, x, y] }
        case 'arrow':
        case 'measure':
          return { ...c, points: [c.points[0], c.points[1], x, y] }
        case 'rect':
          return { ...c, width: x - c.x, height: y - c.y }
        default:
          return c
      }
    })
  }

  function onPointerUp() {
    if (!current) return
    const c = current

    // Discard zero-size shapes
    if (c.type === 'pen' && c.points.length < 4) {
      setCurrent(null)
      return
    }
    if (c.type === 'rect' && (Math.abs(c.width) < 4 || Math.abs(c.height) < 4)) {
      setCurrent(null)
      return
    }
    if ((c.type === 'arrow' || c.type === 'measure') && Math.abs(c.points[0] - c.points[2]) < 4 && Math.abs(c.points[1] - c.points[3]) < 4) {
      setCurrent(null)
      return
    }

    // Normalise rect to positive width/height
    if (c.type === 'rect') {
      const x = Math.min(c.x, c.x + c.width)
      const y = Math.min(c.y, c.y + c.height)
      commit({ ...c, x, y, width: Math.abs(c.width), height: Math.abs(c.height) })
      return
    }
    commit(c)
  }

  // ── Calibration ───────────────────────────────────────────────────────
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
    setTool('select')
  }

  async function saveCalibration() {
    if (calibPoints.length !== 2) {
      setCalibError('Pick two points first')
      return
    }
    const metres = parseFloat(calibDistance)
    if (!metres || metres <= 0) {
      setCalibError('Enter a positive distance in metres')
      return
    }
    const px = pxDist(calibPoints[0], calibPoints[1])
    if (px < 4) {
      setCalibError('Points are too close together')
      return
    }
    const ppm = px / metres

    setCalibSaving(true)
    setCalibError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      // Calibration columns added in migration 00035 — generated types will
      // widen once regenerated. Cast the update payload until then.
      const { error } = await (supabase as any)
        .schema('tenants')
        .from('floor_plans')
        .update({
          pixels_per_meter: ppm,
          calibrated_at: new Date().toISOString(),
          calibrated_by: user?.id ?? null,
        })
        .eq('id', plan.id)
      if (error) throw error
      setPixelsPerMeter(ppm)
      setCalibPoints([])
      setCalibDistance('')
      setTool('select')
    } catch (err) {
      setCalibError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setCalibSaving(false)
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────
  function snapshotScene(): { scene: SceneGraph; pngBase64: string } | null {
    if (!stageRef.current) return null
    const scene: SceneGraph = {
      version: 1,
      canvas: { w: naturalW, h: naturalH },
      shapes,
    }
    // Capture the full drawing at native resolution regardless of zoom/pan.
    // Temporarily neutralise the Stage transform so the rasterised area is
    // (0,0,naturalW,naturalH) in image coordinates.
    const stage = stageRef.current
    const savedScale = stage.scaleX()
    const savedPos = stage.position()
    stage.scale({ x: 1, y: 1 })
    stage.position({ x: 0, y: 0 })
    stage.draw()
    // PDF backing canvas is already rasterised at scale=2 in the load
    // effect, so pixelRatio=1 here keeps the saved PNG at source density.
    // pixelRatio=2 would 4× the pixel count and push base64 past the 10 MB
    // server-action body limit (see next.config.ts bodySizeLimit).
    const dataUrl = stage.toDataURL({
      pixelRatio: 1,
      mimeType: 'image/png',
      x: 0,
      y: 0,
      width: naturalW,
      height: naturalH,
    })
    stage.scale({ x: savedScale, y: savedScale })
    stage.position(savedPos)
    stage.draw()
    const pngBase64 = dataUrl.split(',')[1] ?? ''
    return { scene, pngBase64 }
  }

  async function handleSaveClick() {
    if (shapes.length === 0) return
    setSaveError(null)
    if (editing) {
      // Edit mode — overwrite existing annotation in place.
      const snap = snapshotScene()
      if (!snap) return
      setSaving(true)
      try {
        const res = await updateRfiAnnotationAction({
          annotationId: editing.id,
          sceneJson: snap.scene as unknown,
          pngBase64: snap.pngBase64,
        })
        if (res.error) {
          setSaveError(res.error)
          return
        }
        router.push(`/rfis/${editing.rfiId}?projectId=${projectId}`)
      } finally {
        setSaving(false)
      }
      return
    }
    // Create mode — open the RFI picker.
    setPickerRfiId(rfis[0]?.id ?? '')
    setPickerOpen(true)
  }

  async function submitNewAnnotation() {
    if (!pickerRfiId) {
      setSaveError('Pick an RFI to attach the markup to')
      return
    }
    const snap = snapshotScene()
    if (!snap) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await createRfiAnnotationAction({
        rfiId: pickerRfiId,
        sourceFloorPlanId: plan.id,
        sceneJson: snap.scene as unknown,
        pngBase64: snap.pngBase64,
      })
      if (res.error) {
        setSaveError(res.error)
        return
      }
      setPickerOpen(false)
      router.push(`/rfis/${pickerRfiId}?projectId=${projectId}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Render shape ─────────────────────────────────────────────────────
  const renderShape = (s: AnyShape) => {
    switch (s.type) {
      case 'pen':
        return (
          <Line
            key={s.id}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            tension={0.3}
            lineCap="round"
            lineJoin="round"
          />
        )
      case 'arrow':
        return (
          <Arrow
            key={s.id}
            points={s.points}
            stroke={s.color}
            fill={s.color}
            strokeWidth={s.strokeWidth}
            pointerLength={8 + s.strokeWidth}
            pointerWidth={8 + s.strokeWidth}
          />
        )
      case 'rect':
        return (
          <Rect
            key={s.id}
            x={s.x}
            y={s.y}
            width={s.width}
            height={s.height}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
          />
        )
      case 'text':
        return <KonvaText key={s.id} x={s.x} y={s.y} text={s.text} fontSize={s.fontSize} fill={s.color} />
      case 'pin':
        return (
          <Group key={s.id} x={s.x} y={s.y}>
            <Circle radius={14} fill={s.color} stroke="white" strokeWidth={2} />
            <KonvaText x={-14} y={-7} width={28} align="center" text={s.label} fill="white" fontStyle="bold" fontSize={14} />
          </Group>
        )
      case 'measure': {
        const [x1, y1, x2, y2] = s.points
        const px = Math.hypot(x2 - x1, y2 - y1)
        const m = pixelsPerMeter ? px / pixelsPerMeter : null
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2
        return (
          <Group key={s.id}>
            <Line points={s.points} stroke={s.color} strokeWidth={s.strokeWidth} dash={[8, 4]} />
            {m !== null && (
              <KonvaText x={midX + 6} y={midY - 6} text={`${m.toFixed(2)} m`} fill={s.color} fontStyle="bold" fontSize={14} />
            )}
          </Group>
        )
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Toolbar */}
      <div className="data-panel" style={{ padding: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToolbarGroup>
          {TOOLS.map((t) => {
            const disabled = t.needsCalibration && !pixelsPerMeter
            return (
              <ToolbarButton
                key={t.value}
                active={tool === t.value}
                disabled={disabled}
                onClick={() => setTool(t.value)}
                title={disabled ? `${t.title} — calibrate first` : t.title}
              >
                {t.label}
              </ToolbarButton>
            )
          })}
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColor(c.value)}
              aria-label={c.label}
              title={c.label}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c.value,
                border: color === c.value ? '2px solid var(--c-amber)' : '2px solid var(--c-border)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          {STROKE_WIDTHS.map((w) => (
            <ToolbarButton key={w.value} active={strokeWidth === w.value} onClick={() => setStrokeWidth(w.value)} title={w.label}>
              <span
                style={{
                  display: 'inline-block',
                  width: 18,
                  height: w.value,
                  background: 'currentColor',
                  borderRadius: w.value / 2,
                  verticalAlign: 'middle',
                }}
              />
            </ToolbarButton>
          ))}
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToolbarButton onClick={zoomOut} title="Zoom out (−)">−</ToolbarButton>
          <ToolbarButton onClick={fitToView} disabled={!img} title="Fit to view — recenter drawing (F or 0)">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>FIT</span>
          </ToolbarButton>
          <ToolbarButton onClick={zoomIn} title="Zoom in (+)">+</ToolbarButton>
          <span
            style={{
              minWidth: 44,
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--c-text-dim)',
              letterSpacing: '0.04em',
            }}
            aria-live="polite"
          >
            {Math.round(scale * 100)}%
          </span>
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToolbarButton onClick={undo} disabled={undoStack.length === 0} title="Undo">↶</ToolbarButton>
          <ToolbarButton onClick={redo} disabled={redoStack.length === 0} title="Redo">↷</ToolbarButton>
          <ToolbarButton onClick={clearAll} disabled={shapes.length === 0} title="Clear all">⌫</ToolbarButton>
        </ToolbarGroup>
        <div style={{ flex: 1 }} />
        <ToolbarGroup>
          <ToolbarButton onClick={startCalibration} title="Calibrate this drawing for the measure tool">Calibrate</ToolbarButton>
          <button
            type="button"
            className="btn-primary-amber"
            onClick={handleSaveClick}
            disabled={saving || shapes.length === 0}
          >
            {saving ? 'Saving…' : editing ? 'Update markup' : 'Save markup'}
          </button>
        </ToolbarGroup>
      </div>
      {saveError && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 12, padding: '0 4px' }}>
          {saveError}
        </div>
      )}

      {/* Calibration overlay */}
      {tool === 'calibrate' && (
        <div className="data-panel" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {calibPoints.length < 2 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text)', margin: 0 }}>
              Click two points on the drawing whose real-world distance you know
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
              <button type="button" className="btn-primary-amber" onClick={saveCalibration} disabled={calibSaving}>
                {calibSaving ? 'Saving…' : 'Save calibration'}
              </button>
            </>
          )}
          {calibError && (
            <span role="alert" style={{ color: '#dc2626', fontSize: 12 }}>
              {calibError}
            </span>
          )}
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

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '70vh',
          background: 'var(--c-base)',
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {!plan.signedUrl ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>
            This file format isn't supported by the markup canvas yet. Supported: PNG, JPG, WebP, SVG, PDF.
          </div>
        ) : loadError ? (
          <div role="alert" style={{ padding: 48, textAlign: 'center', color: '#dc2626' }}>
            {loadError}
          </div>
        ) : !img ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>
            {plan.isPdf ? 'Rendering PDF…' : 'Loading drawing…'}
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
            draggable={tool === 'select'}
            onDragEnd={(e) => {
              const t = e.target as Konva.Stage
              setOffset({ x: t.x(), y: t.y() })
            }}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
            onDblClick={tool === 'select' ? fitToView : undefined}
            onDblTap={tool === 'select' ? fitToView : undefined}
            style={{
              cursor: tool === 'select' ? 'grab' : 'crosshair',
              background: 'white',
            }}
          >
            <Layer listening={false}>
              <KonvaImage image={img} width={naturalW} height={naturalH} />
              {snagPins.map((s) => (
                <Group key={s.id} x={s.floor_plan_pin.x} y={s.floor_plan_pin.y} listening={false}>
                  <Circle radius={10} fill="#dc2626" stroke="white" strokeWidth={2} opacity={0.7} />
                </Group>
              ))}
            </Layer>
            <Layer>
              {shapes.map(renderShape)}
              {current && renderShape(current)}
              {tool === 'calibrate' &&
                calibPoints.map((p, i) => (
                  <Circle key={i} x={p[0]} y={p[1]} radius={6} fill="#f59e0b" stroke="white" strokeWidth={2} />
                ))}
              {tool === 'calibrate' && calibPoints.length === 2 && (
                <Line
                  points={[calibPoints[0][0], calibPoints[0][1], calibPoints[1][0], calibPoints[1][1]]}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dash={[6, 4]}
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>

      {pickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Attach markup to RFI"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false)
          }}
        >
          <div
            className="data-panel"
            style={{
              background: 'var(--c-panel)',
              padding: 18,
              maxWidth: 440,
              width: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>
              Attach markup to RFI
            </h3>
            {rfis.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--c-text-mid)', margin: 0 }}>
                No RFIs in this project yet. Create an RFI first, then come back to attach this markup.
              </p>
            ) : (
              <div>
                <label className="ob-label" htmlFor="rfi-picker">
                  Choose an RFI
                </label>
                <select
                  id="rfi-picker"
                  value={pickerRfiId}
                  onChange={(e) => setPickerRfiId(e.target.value)}
                  className="ob-input"
                >
                  {rfis.map((r) => (
                    <option key={r.id} value={r.id}>
                      [{r.status}] {r.subject}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {saveError && (
              <p role="alert" style={{ color: '#dc2626', fontSize: 12, margin: 0 }}>
                {saveError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="btn-primary-amber"
                style={{
                  background: 'var(--c-panel)',
                  border: '1px solid var(--c-border)',
                  color: 'var(--c-text-mid)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitNewAnnotation}
                className="btn-primary-amber"
                disabled={saving || rfis.length === 0}
              >
                {saving ? 'Saving…' : 'Attach to RFI'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Toolbar primitives
// ─────────────────────────────────────────────────────────────────────────
function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{children}</div>
}

function ToolbarSeparator() {
  return <div style={{ width: 1, height: 22, background: 'var(--c-border)' }} />
}

function ToolbarButton({
  children,
  active,
  disabled,
  onClick,
  title,
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
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
        fontSize: 13,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
