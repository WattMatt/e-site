'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Line,
  Rect,
  Ellipse as KonvaEllipse,
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
import { createRfiAction } from '@/actions/rfi.actions'

// ─────────────────────────────────────────────────────────────────────────
// Types — scene graph format matches migration 00033 docstring:
//   { version, canvas: {w,h}, shapes: [{type, points, color, strokeWidth, ...}] }
// ─────────────────────────────────────────────────────────────────────────
type ToolMode =
  | 'select'
  | 'pen'
  | 'highlight'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'text'
  | 'pin'
  | 'measure'
  | 'calibrate'

// pageIndex is 1-based (matches pdfjs page numbering). Defaults to 1 for
// backward compat with v1 scene graphs that didn't carry pageIndex.
type ShapeBase = { id: string; color: string; pageIndex?: number }
type PenShape = ShapeBase & { type: 'pen'; points: number[]; strokeWidth: number }
type HighlightShape = ShapeBase & { type: 'highlight'; points: number[]; strokeWidth: number }
type ArrowShape = ShapeBase & { type: 'arrow'; points: [number, number, number, number]; strokeWidth: number }
type RectShape = ShapeBase & { type: 'rect'; x: number; y: number; width: number; height: number; strokeWidth: number }
type EllipseShape = ShapeBase & { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; strokeWidth: number }
type PolygonShape = ShapeBase & { type: 'polygon'; points: number[]; strokeWidth: number; closed: true }
type TextShape = ShapeBase & { type: 'text'; x: number; y: number; text: string; fontSize: number }
type PinShape = ShapeBase & { type: 'pin'; x: number; y: number; label: string }
type MeasureShape = ShapeBase & { type: 'measure'; points: [number, number, number, number]; strokeWidth: number }

type AnyShape =
  | PenShape
  | HighlightShape
  | ArrowShape
  | RectShape
  | EllipseShape
  | PolygonShape
  | TextShape
  | PinShape
  | MeasureShape

export type SceneGraph = {
  version: 1
  canvas: { w: number; h: number }   // current-page dimensions (kept for back-compat)
  shapes: AnyShape[]
  pageCount?: number                  // total pages of the source PDF (1 for non-PDF rasters)
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
  { value: 'highlight', label: '▰', title: 'Highlighter (semi-transparent)' },
  { value: 'arrow', label: '→', title: 'Arrow' },
  { value: 'rect', label: '▭', title: 'Rectangle' },
  { value: 'ellipse', label: '◯', title: 'Ellipse' },
  { value: 'polygon', label: '⬠', title: 'Polygon (click vertices, double-click to close)' },
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

// ─── IndexedDB draft persistence ──────────────────────────────────────────
// Auto-save every 5s of inactivity to a tiny local store so a crash, a tab
// close, or temporary offline state doesn't lose markup-in-progress. Drafts
// are scoped per (planId, annotationId-or-'new'). Cleared on successful Save.
const DRAFT_DB = 'esite-markup-drafts'
const DRAFT_STORE = 'drafts'

function openDraftDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(DRAFT_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

type DraftRecord = { shapes: AnyShape[]; savedAt: string }

async function getDraft(key: string): Promise<DraftRecord | null> {
  try {
    const db = await openDraftDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readonly')
      const req = tx.objectStore(DRAFT_STORE).get(key)
      req.onsuccess = () => resolve((req.result as DraftRecord | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

async function setDraftRecord(key: string, value: DraftRecord): Promise<void> {
  try {
    const db = await openDraftDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* IDB unavailable (private mode, quota): degrade silently. */
  }
}

async function clearDraftRecord(key: string): Promise<void> {
  try {
    const db = await openDraftDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* swallow */
  }
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
  // Picker has two modes: 'attach' (default when there are existing RFIs) and
  // 'create' (inline form that creates a new RFI then attaches the markup).
  const [pickerMode, setPickerMode] = useState<'attach' | 'create'>('attach')
  const [newRfiSubject, setNewRfiSubject] = useState('')
  const [newRfiDescription, setNewRfiDescription] = useState('')
  const [newRfiPriority, setNewRfiPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  // Polygon in-progress vertices (image-space). Cleared on commit / cancel.
  const [polyPoints, setPolyPoints] = useState<number[]>([])

  // ── IndexedDB draft auto-save ────────────────────────────────────────
  // Key by plan + (annotation id when re-editing | 'new'). 5s-debounced.
  const draftKey = `${plan.id}|${editing?.id ?? 'new'}`
  const [draftPrompt, setDraftPrompt] = useState<DraftRecord | null>(null)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mount: only check drafts for NEW markups; re-edit comes in via prop.
  useEffect(() => {
    if (editing) return
    let cancelled = false
    getDraft(draftKey).then((d) => {
      if (cancelled) return
      if (d && d.shapes.length > 0) setDraftPrompt(d)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced auto-save when shapes change. Skipped while a restore prompt
  // is showing (so the user's choice isn't pre-empted by an empty save).
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    if (draftPrompt) return
    if (shapes.length === 0) return // don't overwrite an existing draft with nothing
    draftTimerRef.current = setTimeout(() => {
      void setDraftRecord(draftKey, { shapes, savedAt: new Date().toISOString() })
    }, 5000)
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    }
  }, [shapes, draftKey, draftPrompt])

  function restoreDraft() {
    if (!draftPrompt) return
    pushHistory(shapes)
    setShapes(draftPrompt.shapes)
    setDraftPrompt(null)
  }

  function discardDraft() {
    void clearDraftRecord(draftKey)
    setDraftPrompt(null)
  }

  // Reset polygon-in-progress when leaving the polygon tool.
  useEffect(() => {
    if (tool !== 'polygon' && polyPoints.length > 0) setPolyPoints([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  function closePolygon() {
    // Need at least 3 vertices (6 array entries) to form a polygon.
    if (polyPoints.length < 6) {
      setPolyPoints([])
      return
    }
    commit({
      id: makeId(),
      type: 'polygon',
      points: polyPoints,
      color,
      strokeWidth,
      closed: true,
    })
    setPolyPoints([])
  }

  // Load image (or PDF page rasterised to a canvas via pdfjs-dist).
  // Multi-page PDFs: hold the pdfjs document ref + page count, rasterise
  // pages on demand. Per-page bitmaps are cached in pageImagesRef so
  // navigating back doesn't re-render.
  const [img, setImg] = useState<Backing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  // PDFDocumentProxy from pdfjs — kept as ref to avoid re-render on assignment.
  const pdfDocRef = useRef<{ getPage: (n: number) => Promise<unknown>; numPages: number } | null>(null)
  const pageImagesRef = useRef<Map<number, HTMLCanvasElement>>(new Map())

  // Page-render helper: rasterise a 1-based PDF page to a backing canvas,
  // memoise in pageImagesRef, and setImg. Called from both the initial
  // load (page 1) and explicit page changes.
  type PdfPage = {
    getViewport: (opts: { scale: number }) => { width: number; height: number }
    render: (opts: unknown) => { promise: Promise<void> }
  }
  const renderPdfPage = useCallback(
    async (pageNum: number, signal: { cancelled: boolean }) => {
      const cached = pageImagesRef.current.get(pageNum)
      if (cached) {
        if (!signal.cancelled) setImg(cached)
        return
      }
      const doc = pdfDocRef.current
      if (!doc) return
      const page = (await doc.getPage(pageNum)) as PdfPage
      if (signal.cancelled) return
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d context unavailable')
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      if (signal.cancelled) return
      pageImagesRef.current.set(pageNum, canvas)
      setImg(canvas)
    },
    [],
  )

  // 1) Initial load: detect raster vs PDF, load pdfjs doc, render page 1
  //    inline (so single-page PDFs don't hang waiting for an effect that
  //    only re-fires when pageCount changes from 1).
  useEffect(() => {
    if (!plan.signedUrl) return
    const signal = { cancelled: false }
    setLoadError(null)
    setImg(null)
    setCurrentPage(1)
    pdfDocRef.current = null
    pageImagesRef.current = new Map()

    if (plan.isPdf) {
      ;(async () => {
        try {
          const pdfjsLib = await import('pdfjs-dist')
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
          }
          const loadingTask = pdfjsLib.getDocument(plan.signedUrl!)
          const pdf = await loadingTask.promise
          if (signal.cancelled) return
          pdfDocRef.current = pdf as unknown as {
            getPage: (n: number) => Promise<unknown>
            numPages: number
          }
          setPageCount(pdf.numPages)
          // Inline page-1 render — avoids the dep-trigger gap.
          await renderPdfPage(1, signal)
        } catch (err) {
          if (signal.cancelled) return
          setLoadError(err instanceof Error ? err.message : 'PDF load failed')
        }
      })()
    } else {
      setPageCount(1)
      const i = new window.Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => {
        if (!signal.cancelled) setImg(i)
      }
      i.onerror = () => {
        if (!signal.cancelled) setLoadError('Image failed to load')
      }
      i.src = plan.signedUrl
    }

    return () => {
      signal.cancelled = true
    }
  }, [plan.signedUrl, plan.isPdf, renderPdfPage])

  // 2) Re-render when the user navigates to a different PDF page.
  //    Page 1 on initial mount is handled by the load effect above; the
  //    pdfDocRef.current null-check skips this run until the doc is ready.
  //    Once loaded, navigating BACK to page 1 hits the cache via renderPdfPage.
  useEffect(() => {
    if (!plan.isPdf) return
    if (!pdfDocRef.current) return
    const signal = { cancelled: false }
    renderPdfPage(currentPage, signal).catch((err) => {
      if (signal.cancelled) return
      setLoadError(err instanceof Error ? err.message : 'PDF page render failed')
    })
    return () => {
      signal.cancelled = true
    }
  }, [plan.isPdf, currentPage, renderPdfPage])

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
  // Always-fresh refs so wheel/pinch handlers can read the current viewport
  // synchronously between React commits (rapid input outpaces useState).
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])
  useEffect(() => {
    offsetRef.current = offset
  }, [offset])
  const [gestureActive, setGestureActive] = useState(false)

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

  // Reset auto-fit when source OR current page changes.
  useEffect(() => {
    initFitDone.current = false
  }, [plan.signedUrl, plan.isPdf, currentPage])

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

  // Zoom by `factor`, keeping the point (anchorX, anchorY) — in container-
  // local CSS pixels — stationary on screen. Used by wheel, pinch, and the
  // toolbar buttons (which anchor on the viewport centre).
  const zoomBy = useCallback((factor: number, anchorX: number, anchorY: number) => {
    const prev = scaleRef.current
    const next = Math.min(8, Math.max(0.05, prev * factor))
    if (next === prev) return
    const ratio = next / prev
    const o = offsetRef.current
    const newOffset = {
      x: anchorX - (anchorX - o.x) * ratio,
      y: anchorY - (anchorY - o.y) * ratio,
    }
    scaleRef.current = next
    offsetRef.current = newOffset
    setScale(next)
    setOffset(newOffset)
  }, [])

  function zoomIn() {
    zoomBy(1.25, viewport.w / 2, viewport.h / 2)
  }
  function zoomOut() {
    zoomBy(1 / 1.25, viewport.w / 2, viewport.h / 2)
  }

  // Native wheel + multi-touch gestures. Konva doesn't expose pointerId for
  // reliable 2-finger tracking and wheel needs preventDefault (which Konva's
  // event wrapper doesn't cleanly support), so we bind directly to the
  // container in capture phase.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const pointers = new Map<number, { x: number; y: number }>()
    let gesture: { dist: number; cx: number; cy: number } | null = null

    const localPt = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { x, y } = localPt(e)
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      zoomBy(factor, x, y)
    }
    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, localPt(e))
      if (pointers.size === 2) {
        const pts = [...pointers.values()]
        const dx = pts[1]!.x - pts[0]!.x
        const dy = pts[1]!.y - pts[0]!.y
        gesture = {
          dist: Math.hypot(dx, dy),
          cx: (pts[0]!.x + pts[1]!.x) / 2,
          cy: (pts[0]!.y + pts[1]!.y) / 2,
        }
        setCurrent(null)
        setGestureActive(true)
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, localPt(e))
      if (pointers.size === 2 && gesture) {
        e.preventDefault()
        const pts = [...pointers.values()]
        const dx = pts[1]!.x - pts[0]!.x
        const dy = pts[1]!.y - pts[0]!.y
        const dist = Math.hypot(dx, dy)
        const cx = (pts[0]!.x + pts[1]!.x) / 2
        const cy = (pts[0]!.y + pts[1]!.y) / 2
        if (dist > 0 && gesture.dist > 0) {
          zoomBy(dist / gesture.dist, cx, cy)
        }
        const panDx = cx - gesture.cx
        const panDy = cy - gesture.cy
        if (panDx !== 0 || panDy !== 0) {
          const newOffset = {
            x: offsetRef.current.x + panDx,
            y: offsetRef.current.y + panDy,
          }
          offsetRef.current = newOffset
          setOffset(newOffset)
        }
        gesture = { dist, cx, cy }
      }
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) {
        gesture = null
        setGestureActive(false)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onUp)
    }
  }, [zoomBy])

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
    // Tag the shape with the current page so multi-page PDFs preserve which
    // page each shape belongs to.
    const tagged = next.pageIndex == null ? { ...next, pageIndex: currentPage } : next
    setShapes((s) => [...s, tagged])
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
  // Mouse + touch handlers (Konva 10's onPointerDown isn't reliable across
  // synthesized inputs — observed in Chrome MCP automation tests). The
  // wrapped native event is sometimes a PointerEvent (browser-coalesced),
  // so when available we read `evt.pressure` for stylus pressure
  // modulation on the pen tool. Fallback 0.5 for plain MouseEvent keeps
  // mouse strokes at their user-chosen width.
  function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getRelativePointerPosition()
    if (!pos) return
    const { x, y } = pos
    const pressure = (e.evt as PointerEvent).pressure ?? 0.5

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
      // Pressure scales linearly: 0 → 0.5×, 0.5 (mouse default) → 1.0×, 1 → 1.5×.
      const sw = Math.max(0.5, strokeWidth * (0.5 + pressure))
      setCurrent({ id: makeId(), type: 'pen', points: [x, y], color, strokeWidth: sw })
      return
    }

    if (tool === 'highlight') {
      // Thicker than the user-chosen width; renders semi-transparent.
      setCurrent({ id: makeId(), type: 'highlight', points: [x, y], color, strokeWidth: strokeWidth * 4 })
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

    if (tool === 'ellipse') {
      // Anchor centre at first click; radii grow with drag.
      setCurrent({ id: makeId(), type: 'ellipse', cx: x, cy: y, rx: 0, ry: 0, color, strokeWidth })
      return
    }

    if (tool === 'polygon') {
      // Click adds a vertex. Double-click (handled separately) closes.
      setPolyPoints((pts) => [...pts, x, y])
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
        case 'highlight':
          return { ...c, points: [...c.points, x, y] }
        case 'arrow':
        case 'measure':
          return { ...c, points: [c.points[0], c.points[1], x, y] }
        case 'rect':
          return { ...c, width: x - c.x, height: y - c.y }
        case 'ellipse':
          return { ...c, rx: Math.abs(x - c.cx), ry: Math.abs(y - c.cy) }
        default:
          return c
      }
    })
  }

  function onPointerUp() {
    if (!current) return
    const c = current

    // Discard zero-size shapes
    if ((c.type === 'pen' || c.type === 'highlight') && c.points.length < 4) {
      setCurrent(null)
      return
    }
    if (c.type === 'rect' && (Math.abs(c.width) < 4 || Math.abs(c.height) < 4)) {
      setCurrent(null)
      return
    }
    if (c.type === 'ellipse' && (c.rx < 4 || c.ry < 4)) {
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
      pageCount,
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
        // Server save committed — drop the local draft.
        void clearDraftRecord(draftKey)
        router.push(`/rfis/${editing.rfiId}?projectId=${projectId}`)
      } finally {
        setSaving(false)
      }
      return
    }
    // Create mode — open the RFI picker.
    setPickerRfiId(rfis[0]?.id ?? '')
    // Default to 'create' when no RFIs exist yet so the user lands straight
    // on the form; otherwise default to attaching to an existing one.
    setPickerMode(rfis.length === 0 ? 'create' : 'attach')
    setPickerOpen(true)
  }

  async function submitNewRfiWithAnnotation() {
    const snap = snapshotScene()
    if (!snap) return
    setSaving(true)
    setSaveError(null)
    try {
      const rfiRes = await createRfiAction({
        projectId,
        subject: newRfiSubject.trim(),
        description: newRfiDescription.trim(),
        priority: newRfiPriority,
      })
      if (rfiRes.error || !rfiRes.rfiId) {
        setSaveError(rfiRes.error ?? 'Failed to create RFI')
        return
      }
      const annoRes = await createRfiAnnotationAction({
        rfiId: rfiRes.rfiId,
        sourceFloorPlanId: plan.id,
        sceneJson: snap.scene as unknown,
        pngBase64: snap.pngBase64,
      })
      if (annoRes.error) {
        // RFI exists but annotation save failed. Surface the error; the user
        // can navigate to the new RFI manually if they want to keep it.
        setSaveError(`RFI created but markup save failed: ${annoRes.error}`)
        return
      }
      void clearDraftRecord(draftKey)
      setPickerOpen(false)
      router.push(`/rfis/${rfiRes.rfiId}?projectId=${projectId}`)
    } finally {
      setSaving(false)
    }
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
      // Server save committed — drop the local draft.
      void clearDraftRecord(draftKey)
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
      case 'highlight':
        return (
          <Line
            key={s.id}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            opacity={0.35}
            tension={0.2}
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
      case 'ellipse':
        return (
          <KonvaEllipse
            key={s.id}
            x={s.cx}
            y={s.cy}
            radiusX={s.rx}
            radiusY={s.ry}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
          />
        )
      case 'polygon':
        return (
          <Line
            key={s.id}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            closed
            lineJoin="round"
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
          <ToolbarButton onClick={zoomOut} title="Zoom out (−, scroll wheel, or pinch)">−</ToolbarButton>
          <ToolbarButton onClick={fitToView} disabled={!img} title="Fit to view (F or 0) — scroll wheel or pinch to zoom, two-finger drag to pan">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>FIT</span>
          </ToolbarButton>
          <ToolbarButton onClick={zoomIn} title="Zoom in (+, scroll wheel, or pinch)">+</ToolbarButton>
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
        {pageCount > 1 && (
          <>
            <ToolbarSeparator />
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                title="Previous page"
              >
                ◂
              </ToolbarButton>
              <span
                style={{
                  minWidth: 70,
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--c-text-mid)',
                  letterSpacing: '0.04em',
                }}
                aria-live="polite"
              >
                Page {currentPage} / {pageCount}
              </span>
              <ToolbarButton
                onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                disabled={currentPage >= pageCount}
                title="Next page"
              >
                ▸
              </ToolbarButton>
            </ToolbarGroup>
          </>
        )}
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

      {/* Restore-draft prompt (only on NEW markups; auto-saved every 5s) */}
      {draftPrompt && (
        <div
          className="data-panel"
          role="alert"
          style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <span style={{ fontSize: 13, color: 'var(--c-text)' }}>
            🗂 Unsaved markup from {new Date(draftPrompt.savedAt).toLocaleString()} ({draftPrompt.shapes.length} shape{draftPrompt.shapes.length !== 1 ? 's' : ''})
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={restoreDraft} className="btn-primary-amber">
            Restore
          </button>
          <button
            type="button"
            onClick={discardDraft}
            className="btn-primary-amber"
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}
          >
            Discard
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
          // Suppress the browser's native pinch-to-zoom + scroll-pan so our
          // wheel+pointer handlers own the gesture.
          touchAction: 'none',
          // Disable iOS Safari's text-selection callout on long-press.
          WebkitUserSelect: 'none',
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
            draggable={tool === 'select' && !gestureActive}
            onDragEnd={(e) => {
              const t = e.target as Konva.Stage
              const next = { x: t.x(), y: t.y() }
              offsetRef.current = next
              setOffset(next)
            }}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
            onDblClick={
              tool === 'select' ? fitToView : tool === 'polygon' ? closePolygon : undefined
            }
            onDblTap={
              tool === 'select' ? fitToView : tool === 'polygon' ? closePolygon : undefined
            }
            style={{
              cursor: gestureActive
                ? 'grabbing'
                : tool === 'select'
                  ? 'grab'
                  : 'crosshair',
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
              {/* Filter shapes to the current page; pageIndex defaults to 1
                  for shapes from v1 scene graphs that didn't carry it. */}
              {shapes.filter((s) => (s.pageIndex ?? 1) === currentPage).map(renderShape)}
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
              {/* Polygon in-progress: vertices + connecting line. Double-click to close. */}
              {tool === 'polygon' && polyPoints.length >= 2 && (
                <Line points={polyPoints} stroke={color} strokeWidth={strokeWidth} dash={[6, 4]} />
              )}
              {tool === 'polygon' &&
                Array.from({ length: polyPoints.length / 2 }).map((_, i) => (
                  <Circle
                    key={`poly-vtx-${i}`}
                    x={polyPoints[i * 2]}
                    y={polyPoints[i * 2 + 1]}
                    radius={4}
                    fill={color}
                    stroke="white"
                    strokeWidth={1}
                  />
                ))}
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
              {pickerMode === 'create' ? 'New RFI from markup' : 'Attach markup to RFI'}
            </h3>

            {/* Mode tabs — hidden when no RFIs exist (only 'create' is valid). */}
            {rfis.length > 0 && (
              <div
                role="tablist"
                aria-label="RFI mode"
                style={{
                  display: 'flex',
                  border: '1px solid var(--c-border)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                {(['attach', 'create'] as const).map((m) => {
                  const active = pickerMode === m
                  return (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setPickerMode(m)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        background: active ? 'var(--c-amber-mid)' : 'var(--c-panel)',
                        color: active ? 'var(--c-amber)' : 'var(--c-text-mid)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {m === 'attach' ? 'Attach to existing' : 'Create new'}
                    </button>
                  )
                })}
              </div>
            )}

            {pickerMode === 'attach' ? (
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
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label className="ob-label" htmlFor="rfi-new-subject">
                    Subject
                  </label>
                  <input
                    id="rfi-new-subject"
                    type="text"
                    value={newRfiSubject}
                    onChange={(e) => setNewRfiSubject(e.target.value)}
                    className="ob-input"
                    maxLength={300}
                    placeholder="e.g. Cashbuild shop 93 — power layout clearance"
                  />
                </div>
                <div>
                  <label className="ob-label" htmlFor="rfi-new-description">
                    Description
                  </label>
                  <textarea
                    id="rfi-new-description"
                    value={newRfiDescription}
                    onChange={(e) => setNewRfiDescription(e.target.value)}
                    className="ob-input"
                    rows={3}
                    maxLength={10000}
                    placeholder="What clarification do you need? Reference the markup pins/circles."
                  />
                </div>
                <div>
                  <label className="ob-label" htmlFor="rfi-new-priority">
                    Priority
                  </label>
                  <select
                    id="rfi-new-priority"
                    value={newRfiPriority}
                    onChange={(e) =>
                      setNewRfiPriority(e.target.value as typeof newRfiPriority)
                    }
                    className="ob-input"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
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
              {pickerMode === 'attach' ? (
                <button
                  type="button"
                  onClick={submitNewAnnotation}
                  className="btn-primary-amber"
                  disabled={saving || rfis.length === 0}
                >
                  {saving ? 'Saving…' : 'Attach to RFI'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submitNewRfiWithAnnotation}
                  className="btn-primary-amber"
                  disabled={
                    saving ||
                    newRfiSubject.trim().length < 2 ||
                    newRfiDescription.trim().length < 10
                  }
                  title={
                    newRfiSubject.trim().length < 2
                      ? 'Subject must be at least 2 characters'
                      : newRfiDescription.trim().length < 10
                        ? 'Description must be at least 10 characters'
                        : undefined
                  }
                >
                  {saving ? 'Creating…' : 'Create RFI & attach'}
                </button>
              )}
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
