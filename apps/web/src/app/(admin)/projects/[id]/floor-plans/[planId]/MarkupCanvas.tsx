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
  Path,
  Transformer,
} from 'react-konva'
import type Konva from 'konva'
import { createClient } from '@/lib/supabase/client'
import {
  createRfiAnnotationAction,
  updateRfiAnnotationAction,
} from '@/actions/rfi-annotation.actions'
import { createRfiAction } from '@/actions/rfi.actions'
import {
  type StrokeStyle,
  STROKE_STYLES,
  dashFor,
  snapAngle,
  gridSpacingPx,
  snapToGrid,
  gridLineOffsets,
  distToPolyline,
  pointInPolygon,
  rectContains,
  ellipseContains,
  rotatePointsAbout,
  translatePoints,
  bakePointTransform,
  symbolSizeFromScale,
  contrastText,
  tableAddRow,
  tableAddCol,
  tableRemoveRow,
  tableRemoveCol,
  tableSetCell,
} from './markup-geometry'
import { Tooltip } from './markup-tooltip'
import { SYMBOLS, SYMBOL_KINDS, SymbolSvg, type SymbolKind } from './markup-symbols'
import { pngBase64ToBlob } from './markup-export'

// ─────────────────────────────────────────────────────────────────────────
// Types — scene graph format matches migration 00033 docstring:
//   { version, canvas: {w,h}, shapes: [{type, points, color, strokeWidth, ...}] }
// ─────────────────────────────────────────────────────────────────────────
type ToolMode =
  | 'select'
  | 'pen'
  | 'highlight'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'polyline'
  | 'polygon'
  | 'note'
  | 'text'
  | 'pin'
  | 'symbol'
  | 'table'
  | 'eraser'
  | 'measure'
  | 'calibrate'

// pageIndex is 1-based (matches pdfjs page numbering). Defaults to 1 for
// backward compat with v1 scene graphs that didn't carry pageIndex.
// `dash` (optional) is the Konva stroke dash array — absent = solid; carried
// on every geometric shape so a dashed/dotted style round-trips through the
// scene graph. Freehand pen/highlight ignore it.
// `rotation` (degrees, optional) is carried by the position/size shapes
// (rect/ellipse/text/note); the point-based shapes bake rotation into their
// points instead. Set by the Transformer on transform-end.
type ShapeBase = { id: string; color: string; pageIndex?: number; dash?: number[]; rotation?: number }
type PenShape = ShapeBase & { type: 'pen'; points: number[]; strokeWidth: number }
type HighlightShape = ShapeBase & { type: 'highlight'; points: number[]; strokeWidth: number }
type LineShape = ShapeBase & { type: 'line'; points: [number, number, number, number]; strokeWidth: number }
type ArrowShape = ShapeBase & { type: 'arrow'; points: [number, number, number, number]; strokeWidth: number }
type RectShape = ShapeBase & { type: 'rect'; x: number; y: number; width: number; height: number; strokeWidth: number }
type EllipseShape = ShapeBase & { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; strokeWidth: number }
type PolylineShape = ShapeBase & { type: 'polyline'; points: number[]; strokeWidth: number }
type PolygonShape = ShapeBase & { type: 'polygon'; points: number[]; strokeWidth: number; closed: true }
type TextShape = ShapeBase & { type: 'text'; x: number; y: number; text: string; fontSize: number }
type PinShape = ShapeBase & { type: 'pin'; x: number; y: number; label: string }
type NoteShape = ShapeBase & {
  type: 'note'
  x: number
  y: number
  width: number
  height: number
  text: string
  fontSize: number
}
type MeasureShape = ShapeBase & { type: 'measure'; points: [number, number, number, number]; strokeWidth: number }
// Electrical symbol: a library glyph (0..100 box) placed at x,y, drawn `size`
// wide, uniformly scaled. rotation via the Transformer.
type SymbolShape = ShapeBase & { type: 'symbol'; kind: SymbolKind; x: number; y: number; size: number }
// Free legend/table: rows[][] grid (row 0 = header) rendered at x,y with fixed
// cell size; resize scales the cells; rows/cols edited via the toolbar.
type TableShape = ShapeBase & {
  type: 'table'
  x: number
  y: number
  cellW: number
  cellH: number
  rows: string[][]
}

type AnyShape =
  | PenShape
  | HighlightShape
  | LineShape
  | ArrowShape
  | RectShape
  | EllipseShape
  | PolylineShape
  | PolygonShape
  | TextShape
  | PinShape
  | SymbolShape
  | TableShape
  | NoteShape
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
  { value: '#16a34a', label: 'Green' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#1f2937', label: 'Charcoal' },
  { value: '#000000', label: 'Black' },
  { value: '#ffffff', label: 'White' },
] as const

const STROKE_WIDTHS = [
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Medium' },
  { value: 8, label: 'Thick' },
] as const

// Sticky-note defaults. Fill is stored on the shape's `color` so re-styling can
// recolour a note; text colour auto-contrasts. Eraser radius is in image px.
const NOTE = { w: 170, h: 120, fill: '#fde68a', fontSize: 15 } as const
const ERASER_RADIUS = 14
// Symbols draw in a 0..100 box scaled to `size`; SYMBOL_STROKE is the line
// weight in that box (scales with the symbol). Tables start as a 2-col header
// + one empty row.
const SYMBOL_SIZE = 46
const SYMBOL_STROKE = 6
const TABLE = {
  cellW: 96,
  cellH: 26,
  header: '#eef2ff',
  initialRows: [
    ['Item', 'Description'],
    ['', ''],
  ] as string[][],
} as const

// Stroke line-style presets + pure geometry helpers (dashFor / snapAngle) live
// in ./markup-geometry so they stay unit-testable without Konva/canvas.

const TOOLS: Array<{ value: ToolMode; label: string; needsCalibration?: boolean; title: string }> = [
  { value: 'select', label: '↖', title: 'Select — click a mark to select, drag to move, handles to resize/rotate, Del to delete' },
  { value: 'pen', label: '✎', title: 'Pen — freehand' },
  { value: 'highlight', label: '▰', title: 'Highlighter (semi-transparent)' },
  { value: 'line', label: '╱', title: 'Line — straight (hold Shift to snap to 0°/45°/90°)' },
  { value: 'arrow', label: '→', title: 'Arrow (hold Shift to snap to 0°/45°/90°)' },
  { value: 'rect', label: '▭', title: 'Rectangle' },
  { value: 'ellipse', label: '◯', title: 'Ellipse' },
  { value: 'polyline', label: '⌇', title: 'Segmented line / polyline (click vertices, double-click to finish)' },
  { value: 'polygon', label: '⬠', title: 'Polygon (click vertices, double-click to close)' },
  { value: 'note', label: '▤', title: 'Sticky note — click to place, double-click to edit text' },
  { value: 'text', label: 'T', title: 'Text' },
  { value: 'pin', label: '◉', title: 'Pin (numbered)' },
  { value: 'symbol', label: '⌁', title: 'Electrical symbol — pick one below, click to place' },
  { value: 'table', label: '⊞', title: 'Legend / table — click to place, double-click a cell to edit' },
  { value: 'eraser', label: '⌦', title: 'Eraser — drag over marks to rub them out' },
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

export type ViewerMode = 'view' | 'markup' | 'rfi'

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
  /** RFI options for the attach/create picker. Optional — defaults to `[]`
   *  (the QC external-save flow has no RFIs and hides the picker entirely). */
  rfis?: RfiOption[]
  /** RFI re-edit target. When set (and `onSaveMarkup` absent), Save overwrites
   *  this existing RFI annotation in place. */
  editing?: EditingAnnotation | null
  /**
   * Tri-state viewer mode. Defaults to 'markup' for back-compat.
   * - 'view'   — read-only: tool palette + save controls hidden, pan/zoom + overlays only.
   * - 'markup' — full tool palette, save defaults to "attach to existing RFI".
   * - 'rfi'   — full tool palette, save defaults to "create new RFI with this markup".
   * Switching modes at runtime preserves canvas state (shapes, zoom, page).
   */
  mode?: ViewerMode
  /**
   * External-save mode (QC markup). When provided, MarkupCanvas hands the
   * flattened PNG + editable scene graph to the caller and does NOT create or
   * update an RFI annotation, open the RFI picker, or navigate to `/rfis`. The
   * toolbar collapses to a single Save/Update button. When ABSENT, every RFI
   * code path runs exactly as before.
   */
  onSaveMarkup?: (out: { pngBlob: Blob; scene: SceneGraph }) => Promise<void>
  /**
   * Scene to hydrate initial shapes from in external-save mode (QC re-edit).
   * RFI re-edit continues to hydrate from `editing.scene`. Ignored on the RFI
   * path (undefined there), so its behaviour is unchanged.
   */
  initialScene?: SceneGraph
}

type Backing = HTMLImageElement | HTMLCanvasElement

function backingSize(b: Backing | null): [number, number] {
  if (!b) return [0, 0]
  return b instanceof HTMLImageElement ? [b.naturalWidth, b.naturalHeight] : [b.width, b.height]
}

export function MarkupCanvas({
  plan,
  snagPins,
  projectId,
  rfis = [],
  editing = null,
  mode = 'markup',
  onSaveMarkup,
  initialScene,
}: Props) {
  const router = useRouter()
  // QC re-edit hydrates shapes from `initialScene`; a markup made on a
  // multi-page PDF carries its page on every shape (pageIndex). Open on that
  // page so the hydrated shapes are actually visible (the render filter and
  // the flatten-on-save both key off currentPage) instead of a blank page 1
  // that an innocent "Update markup" would then overwrite the report image
  // with. RFI re-edit never passes `initialScene`, so this is 1 and the page
  // behaviour is unchanged.
  const initialPageIndex = initialScene?.shapes.find((s) => s.pageIndex)?.pageIndex ?? 1
  const [tool, setTool] = useState<ToolMode>('select')
  const [color, setColor] = useState<string>(COLORS[0].value)
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_WIDTHS[1].value)
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>('solid')
  // Metric grid + snap-to-scale. Grid spacing is real-world metres when the
  // drawing is calibrated, else a plain pixel grid (see gridSpacingPx).
  const [gridOn, setGridOn] = useState(false)
  const [snapOn, setSnapOn] = useState(false)
  const [gridSpacingM, setGridSpacingM] = useState(1)
  // Direct-manipulation: currently-selected shape (Select tool) + Transformer.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [symbolKind, setSymbolKind] = useState<SymbolKind>('db')
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null)
  // Fullscreen: overlay the whole viewport for maximum working space. The
  // wrapper both CSS-covers (fixed inset:0) and requests OS fullscreen.
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const trRef = useRef<Konva.Transformer | null>(null)
  const eraserCursorRef = useRef<Konva.Circle | null>(null)
  const eraseTouchedRef = useRef(false)
  // Hydrate from the RFI re-edit scene (`editing`) or, on the QC external-save
  // path, from `initialScene`. On the RFI path `initialScene` is undefined so
  // this is identical to `editing?.scene.shapes ?? []`.
  const [shapes, setShapes] = useState<AnyShape[]>(editing?.scene.shapes ?? initialScene?.shapes ?? [])
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

  // On mount: only check drafts for NEW markups; re-edit comes in via prop
  // (RFI: `editing`, QC external-save: `initialScene`).
  useEffect(() => {
    if (editing || initialScene) return
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

  // Reset multi-vertex progress when leaving the polygon/polyline tools.
  useEffect(() => {
    if (tool !== 'polygon' && tool !== 'polyline' && polyPoints.length > 0) setPolyPoints([])
    if (tool !== 'select' && selectedId) setSelectedId(null)
    if (tool !== 'eraser' && eraserPos) setEraserPos(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  // Finish the in-progress multi-vertex shape: a closed polygon (≥3 vertices)
  // or an open polyline / segmented line (≥2 vertices). Called on double-click
  // or Enter. Shared by both tools so the vertex-collection UI stays single-source.
  function finishPoly() {
    const wantClosed = tool === 'polygon'
    const minEntries = wantClosed ? 6 : 4 // 3 vs 2 vertices
    if (polyPoints.length < minEntries) {
      setPolyPoints([])
      return
    }
    const dash = dashFor(strokeStyle, strokeWidth)
    commit(
      wantClosed
        ? { id: makeId(), type: 'polygon', points: polyPoints, color, strokeWidth, closed: true, dash }
        : { id: makeId(), type: 'polyline', points: polyPoints, color, strokeWidth, dash },
    )
    setPolyPoints([])
  }

  // Load image (or PDF page rasterised to a canvas via pdfjs-dist).
  // Multi-page PDFs: hold the pdfjs document ref + page count, rasterise
  // pages on demand. Per-page bitmaps are cached in pageImagesRef so
  // navigating back doesn't re-render.
  const [img, setImg] = useState<Backing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Starts on the page the hydrated markup lives on (QC re-edit); 1 otherwise.
  const [currentPage, setCurrentPage] = useState(initialPageIndex)
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
    // Reset to the hydrated markup's page (1 for new markups / RFI). Without
    // this the async load would clobber the initial page back to 1, hiding a
    // re-edited page-≥2 markup.
    setCurrentPage(initialPageIndex)
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
  }, [plan.signedUrl, plan.isPdf, renderPdfPage, initialPageIndex])

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

  // Fullscreen — max working space. Request OS fullscreen synchronously in the
  // click (gesture requirement); the CSS overlay (fixed inset:0) applies either
  // way, so it still works if OS fullscreen is denied.
  const toggleFullscreen = () => {
    const next = !isFullscreen
    const el = wrapperRef.current
    try {
      if (next && !document.fullscreenElement) void el?.requestFullscreen?.().catch(() => {})
      else if (!next && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    } catch {
      /* OS fullscreen unavailable — the CSS overlay still applies. */
    }
    setIsFullscreen(next)
  }

  // Sync our state when the user leaves OS fullscreen (Esc / F11).
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setIsFullscreen(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Esc also exits the CSS overlay (covers OS-fullscreen-denied contexts).
  useEffect(() => {
    if (!isFullscreen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [isFullscreen])

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

  // Delete / Escape for the selected shape. Separate effect so it always sees
  // the current selection + shapes (re-subscribes on change).
  useEffect(() => {
    function onEdit(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (mode === 'view') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteSelected()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onEdit)
    return () => window.removeEventListener('keydown', onEdit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, shapes, mode])

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

  // ── Grid + snap-to-scale ──────────────────────────────────────────────
  // Grid line spacing in image px (real metres when calibrated, else px).
  // The grid is a drawing AID: rendered in its own layer and hidden during
  // the PNG snapshot so it never bakes into the saved markup.
  const gridLayerRef = useRef<Konva.Layer | null>(null)
  const gridPx = gridSpacingPx(gridSpacingM, pixelsPerMeter)
  const snapXY = (x: number, y: number): [number, number] =>
    snapOn ? [snapToGrid(x, gridPx), snapToGrid(y, gridPx)] : [x, y]

  // ── Selection / move / transform / eraser ─────────────────────────────
  const POINT_TYPES = ['pen', 'highlight', 'line', 'arrow', 'polyline', 'polygon', 'measure']
  const selectedType = selectedId ? shapes.find((s) => s.id === selectedId)?.type : undefined
  // Marks on the page currently shown. The PNG snapshot flattens only the
  // current page, so this — not the total shape count — gates the QC
  // Save/Update button: saving a page that holds none of the markup's shapes
  // would overwrite the stored report image with a blank page.
  const marksOnCurrentPage = shapes.filter((s) => (s.pageIndex ?? 1) === currentPage).length

  // Interaction props spread onto every committed shape node in Select mode:
  // click/tap selects (cancelBubble so the stage doesn't deselect), drag moves,
  // Transformer handles resize/rotate.
  function shapeProps(s: AnyShape) {
    return {
      id: s.id,
      draggable: tool === 'select',
      onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (tool === 'select') {
          e.cancelBubble = true
          setSelectedId(s.id)
        }
      },
      onTap: (e: Konva.KonvaEventObject<Event>) => {
        if (tool === 'select') {
          e.cancelBubble = true
          setSelectedId(s.id)
        }
      },
      onDragStart: () => {
        if (tool === 'select') setSelectedId(s.id)
      },
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => bakeMove(s, e.target as Konva.Node),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => bakeTransform(s, e.target as Konva.Node),
    }
  }

  // Bake a drag into geometry. Position/size shapes take the node's x/y;
  // point-based shapes translate their points and the node resets to origin.
  function bakeMove(s: AnyShape, node: Konva.Node) {
    const nx = node.x()
    const ny = node.y()
    if (nx === 0 && ny === 0 && POINT_TYPES.includes(s.type)) return
    pushHistory(shapes)
    setShapes((cur) =>
      cur.map((sh) => {
        if (sh.id !== s.id) return sh
        if (sh.type === 'ellipse') return { ...sh, cx: nx, cy: ny }
        if (
          sh.type === 'rect' ||
          sh.type === 'text' ||
          sh.type === 'note' ||
          sh.type === 'pin' ||
          sh.type === 'symbol' ||
          sh.type === 'table'
        ) {
          return { ...sh, x: nx, y: ny }
        }
        return { ...sh, points: translatePoints((sh as { points: number[] }).points, nx, ny) } as AnyShape
      }),
    )
    if (POINT_TYPES.includes(s.type)) node.position({ x: 0, y: 0 })
  }

  // Bake a Transformer resize/rotate. Position/size shapes fold scale into
  // their dimensions + carry rotation; point-based shapes bake the full
  // scale→rotate→translate into their point list (see markup-geometry).
  function bakeTransform(s: AnyShape, node: Konva.Node) {
    const sx = node.scaleX()
    const sy = node.scaleY()
    const rot = node.rotation()
    const nx = node.x()
    const ny = node.y()
    pushHistory(shapes)
    node.scaleX(1)
    node.scaleY(1)
    setShapes((cur) =>
      cur.map((sh) => {
        if (sh.id !== s.id) return sh
        switch (sh.type) {
          case 'rect':
            return { ...sh, x: nx, y: ny, width: sh.width * sx, height: sh.height * sy, rotation: rot }
          case 'ellipse':
            return { ...sh, cx: nx, cy: ny, rx: sh.rx * sx, ry: sh.ry * sy, rotation: rot }
          case 'text':
            return { ...sh, x: nx, y: ny, fontSize: Math.max(6, sh.fontSize * ((sx + sy) / 2)), rotation: rot }
          case 'note':
            return {
              ...sh,
              x: nx,
              y: ny,
              width: Math.max(40, sh.width * sx),
              height: Math.max(30, sh.height * sy),
              fontSize: Math.max(8, sh.fontSize * ((sx + sy) / 2)),
              rotation: rot,
            }
          case 'symbol':
            // Node is pre-scaled by size/100, so bake the ABSOLUTE scale
            // (size = 100×scale), not oldSize×scale (see symbolSizeFromScale).
            return { ...sh, x: nx, y: ny, size: symbolSizeFromScale(sx, sy), rotation: rot }
          case 'table':
            return {
              ...sh,
              x: nx,
              y: ny,
              cellW: Math.max(30, sh.cellW * sx),
              cellH: Math.max(16, sh.cellH * sy),
              rotation: rot,
            }
          case 'pin':
            return sh
          default: {
            node.rotation(0)
            node.position({ x: 0, y: 0 })
            const np = bakePointTransform((sh as { points: number[] }).points, sx, sy, rot, nx, ny)
            return { ...sh, points: np } as AnyShape
          }
        }
      }),
    )
  }

  function deleteSelected() {
    if (!selectedId) return
    pushHistory(shapes)
    setShapes((cur) => cur.filter((sh) => sh.id !== selectedId))
    setSelectedId(null)
  }

  // Change the current colour/width/style; if a shape is selected, apply it.
  function restyleSelected(patch: Partial<{ color: string; strokeWidth: number; dash: number[] | undefined }>) {
    if (!selectedId) return
    pushHistory(shapes)
    setShapes((cur) => cur.map((sh) => (sh.id === selectedId ? { ...sh, ...patch } : sh)))
  }

  function editNoteText(id: string) {
    const note = shapes.find((sh) => sh.id === id)
    if (!note || note.type !== 'note') return
    const next = window.prompt('Edit note:', note.text)
    if (next == null) return
    pushHistory(shapes)
    setShapes((cur) => cur.map((sh) => (sh.id === id ? { ...sh, text: next } : sh)))
  }

  function editTableCell(id: string, r: number, c: number) {
    const tbl = shapes.find((sh) => sh.id === id)
    if (!tbl || tbl.type !== 'table') return
    const next = window.prompt('Cell text:', tbl.rows[r]?.[c] ?? '')
    if (next == null) return
    pushHistory(shapes)
    setShapes((cur) =>
      cur.map((sh) => (sh.id === id && sh.type === 'table' ? { ...sh, rows: tableSetCell(sh.rows, r, c, next) } : sh)),
    )
  }

  // Row/column controls for the selected table (toolbar buttons).
  function mutateSelectedTable(fn: (rows: string[][]) => string[][]) {
    if (!selectedId) return
    const tbl = shapes.find((sh) => sh.id === selectedId)
    if (!tbl || tbl.type !== 'table') return
    pushHistory(shapes)
    setShapes((cur) =>
      cur.map((sh) => (sh.id === selectedId && sh.type === 'table' ? { ...sh, rows: fn(sh.rows) } : sh)),
    )
  }

  // Eraser: remove any shape on the current page whose ink the cursor touches.
  function shapeErased(s: AnyShape, ex: number, ey: number, r: number): boolean {
    // Map the eraser point into the shape's local (unrotated) frame so the
    // axis-aligned tests below also work for a rotated rect/ellipse/text/note.
    const invRot = (ax: number, ay: number, rot?: number): [number, number] =>
      rot ? (rotatePointsAbout([ex, ey], (-rot * Math.PI) / 180, ax, ay) as [number, number]) : [ex, ey]
    switch (s.type) {
      case 'pen':
      case 'highlight':
      case 'line':
      case 'arrow':
      case 'measure':
      case 'polyline':
        return distToPolyline(ex, ey, s.points, false) <= r + s.strokeWidth / 2
      case 'polygon':
        return pointInPolygon(ex, ey, s.points) || distToPolyline(ex, ey, s.points, true) <= r + s.strokeWidth / 2
      case 'rect': {
        const [px, py] = invRot(s.x, s.y, s.rotation)
        const pts = [s.x, s.y, s.x + s.width, s.y, s.x + s.width, s.y + s.height, s.x, s.y + s.height]
        return distToPolyline(px, py, pts, true) <= r + s.strokeWidth / 2
      }
      case 'ellipse': {
        const [px, py] = invRot(s.cx, s.cy, s.rotation)
        return (
          ellipseContains(px, py, s.cx, s.cy, s.rx, s.ry, r) &&
          !ellipseContains(px, py, s.cx, s.cy, s.rx - r - s.strokeWidth, s.ry - r - s.strokeWidth, 0)
        )
      }
      case 'text': {
        const [px, py] = invRot(s.x, s.y, s.rotation)
        return rectContains(px, py, s.x, s.y, Math.max(20, s.text.length * s.fontSize * 0.6), s.fontSize * 1.3, r)
      }
      case 'note': {
        const [px, py] = invRot(s.x, s.y, s.rotation)
        return rectContains(px, py, s.x, s.y, s.width, s.height, r)
      }
      case 'symbol': {
        const [px, py] = invRot(s.x, s.y, s.rotation)
        return rectContains(px, py, s.x, s.y, s.size, s.size, r)
      }
      case 'table': {
        const [px, py] = invRot(s.x, s.y, s.rotation)
        const cols = s.rows[0]?.length ?? 1
        return rectContains(px, py, s.x, s.y, cols * s.cellW, s.rows.length * s.cellH, r)
      }
      case 'pin':
        return Math.hypot(ex - s.x, ey - s.y) <= 14 + r
      default:
        return false
    }
  }
  function eraseAt(x: number, y: number) {
    setShapes((cur) => {
      const keep = cur.filter((s) => (s.pageIndex ?? 1) !== currentPage || !shapeErased(s, x, y, ERASER_RADIUS))
      if (keep.length !== cur.length && !eraseTouchedRef.current) {
        eraseTouchedRef.current = true
        setUndoStack((u) => [...u, cur])
        setRedoStack([])
      }
      return keep
    })
  }

  // Keep the Transformer attached to the selected node (Select mode only).
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr) return
    if (!stage || tool !== 'select' || !selectedId) {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
      return
    }
    const node = stage.findOne('#' + selectedId)
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, tool, shapes, currentPage])

  // ── Pointer handlers ──────────────────────────────────────────────────
  // Mouse + touch handlers (Konva 10's onPointerDown isn't reliable across
  // synthesized inputs — observed in Chrome MCP automation tests). The
  // wrapped native event is sometimes a PointerEvent (browser-coalesced),
  // so when available we read `evt.pressure` for stylus pressure
  // modulation on the pen tool. Fallback 0.5 for plain MouseEvent keeps
  // mouse strokes at their user-chosen width.
  function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (mode === 'view') return // read-only: no placement/drawing on the canvas
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

    if (tool === 'select') {
      // Shapes cancelBubble on their own mousedown, so reaching here means the
      // click landed on empty canvas → deselect (and the stage pans).
      setSelectedId(null)
      return
    }

    if (tool === 'eraser') {
      eraseTouchedRef.current = false
      setEraserPos({ x, y })
      eraseAt(x, y)
      return
    }

    if (tool === 'text') {
      const text = window.prompt('Text:')?.trim()
      if (!text) return
      commit({ id: makeId(), type: 'text', x, y, text, fontSize: 14 + strokeWidth * 2, color })
      return
    }

    if (tool === 'pin') {
      const existing = shapes.filter((s) => s.type === 'pin').length
      const [px, py] = snapXY(x, y)
      commit({ id: makeId(), type: 'pin', x: px, y: py, label: String(existing + 1), color })
      return
    }

    if (tool === 'symbol') {
      const [cx, cy] = snapXY(x, y)
      commit({
        id: makeId(),
        type: 'symbol',
        kind: symbolKind,
        x: cx - SYMBOL_SIZE / 2, // centre the glyph on the click
        y: cy - SYMBOL_SIZE / 2,
        size: SYMBOL_SIZE,
        color,
      })
      return
    }

    if (tool === 'table') {
      const [tx, ty] = snapXY(x, y)
      commit({
        id: makeId(),
        type: 'table',
        x: tx,
        y: ty,
        cellW: TABLE.cellW,
        cellH: TABLE.cellH,
        rows: TABLE.initialRows.map((row) => [...row]),
        color: '#111827',
      })
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

    if (tool === 'note') {
      const raw = window.prompt('Note text:')
      if (raw == null) return // Cancel → don't place a note
      const [nx, ny] = snapXY(x, y)
      commit({
        id: makeId(),
        type: 'note',
        x: nx,
        y: ny,
        width: NOTE.w,
        height: NOTE.h,
        text: raw.trim(),
        fontSize: NOTE.fontSize,
        color: NOTE.fill,
      })
      return
    }

    const dash = dashFor(strokeStyle, strokeWidth)
    const [sx, sy] = snapXY(x, y)

    if (tool === 'line') {
      setCurrent({ id: makeId(), type: 'line', points: [sx, sy, sx, sy], color, strokeWidth, dash })
      return
    }

    if (tool === 'arrow') {
      setCurrent({ id: makeId(), type: 'arrow', points: [sx, sy, sx, sy], color, strokeWidth, dash })
      return
    }

    if (tool === 'rect') {
      setCurrent({ id: makeId(), type: 'rect', x: sx, y: sy, width: 0, height: 0, color, strokeWidth, dash })
      return
    }

    if (tool === 'ellipse') {
      // Anchor centre at first click; radii grow with drag.
      setCurrent({ id: makeId(), type: 'ellipse', cx: sx, cy: sy, rx: 0, ry: 0, color, strokeWidth, dash })
      return
    }

    if (tool === 'polygon' || tool === 'polyline') {
      // Click adds a vertex. Double-click (handled separately) finishes:
      // polygon closes, polyline stays open.
      setPolyPoints((pts) => [...pts, sx, sy])
      return
    }

    if (tool === 'measure') {
      if (!pixelsPerMeter) return
      setCurrent({ id: makeId(), type: 'measure', points: [x, y, x, y], color, strokeWidth })
      return
    }
  }

  function onPointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool === 'eraser') {
      const st = e.target.getStage()
      const p = st?.getRelativePointerPosition()
      if (!p) return
      setEraserPos({ x: p.x, y: p.y })
      const isTouch = e.evt.type.startsWith('touch')
      const down = isTouch || (e.evt as MouseEvent).buttons === 1
      if (down) eraseAt(p.x, p.y)
      return
    }
    if (!current) return
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getRelativePointerPosition()
    if (!pos) return
    const { x, y } = pos
    const shift = (e.evt as { shiftKey?: boolean }).shiftKey ?? false
    // Grid-snapped endpoint for the geometric tools (no-op when snap is off).
    const [gx, gy] = snapXY(x, y)

    setCurrent((c) => {
      if (!c) return c
      switch (c.type) {
        case 'pen':
        case 'highlight':
          return { ...c, points: [...c.points, x, y] }
        case 'line':
        case 'arrow': {
          // Shift constrains to 0°/45°/90°; otherwise honour grid snap.
          const [ex, ey] = shift ? snapAngle(c.points[0], c.points[1], x, y) : [gx, gy]
          return { ...c, points: [c.points[0], c.points[1], ex, ey] }
        }
        case 'measure':
          return { ...c, points: [c.points[0], c.points[1], x, y] }
        case 'rect':
          return { ...c, width: gx - c.x, height: gy - c.y }
        case 'ellipse':
          return { ...c, rx: Math.abs(gx - c.cx), ry: Math.abs(gy - c.cy) }
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
    if (
      (c.type === 'line' || c.type === 'arrow' || c.type === 'measure') &&
      Math.abs(c.points[0] - c.points[2]) < 4 &&
      Math.abs(c.points[1] - c.points[3]) < 4
    ) {
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
    // The grid is a drawing aid, not markup content — hide it for the capture
    // so it never bakes into the saved/exported PNG.
    const gridVisible = gridLayerRef.current?.visible() ?? false
    gridLayerRef.current?.visible(false)
    // Detach the Transformer + hide the eraser cursor so neither overlay bakes
    // into the export.
    const trNodes = trRef.current?.nodes() ?? []
    trRef.current?.nodes([])
    eraserCursorRef.current?.visible(false)
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
    gridLayerRef.current?.visible(gridVisible)
    if (trNodes.length) trRef.current?.nodes(trNodes as Konva.Node[])
    eraserCursorRef.current?.visible(true)
    stage.scale({ x: savedScale, y: savedScale })
    stage.position(savedPos)
    stage.draw()
    const pngBase64 = dataUrl.split(',')[1] ?? ''
    return { scene, pngBase64 }
  }

  async function handleSaveClick() {
    if (shapes.length === 0) return
    setSaveError(null)
    // External-save mode (QC): hand the flattened PNG + scene to the caller.
    // NEVER touches the RFI actions, the picker, or router navigation. The RFI
    // branches below run only when `onSaveMarkup` is undefined.
    if (onSaveMarkup) {
      // The snapshot flattens the current page only — refuse to save a page
      // that holds none of this markup's shapes (it would replace the report
      // image with a blank drawing). The button is already disabled in this
      // state; this is the defensive backstop.
      if (marksOnCurrentPage === 0) {
        setSaveError('No marks on this page — switch to the page with your markup before saving.')
        return
      }
      const snap = snapshotScene()
      if (!snap) return
      setSaving(true)
      try {
        await onSaveMarkup({ pngBlob: pngBase64ToBlob(snap.pngBase64), scene: snap.scene })
        // Save committed by the caller — drop the local draft.
        void clearDraftRecord(draftKey)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Save failed')
      } finally {
        setSaving(false)
      }
      return
    }
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
    // Default to 'create' when no RFIs exist yet OR when the viewer was
    // entered in 'rfi' mode (the user explicitly chose "Raise RFI" from
    // the preview). Otherwise default to attaching to an existing one.
    setPickerMode(rfis.length === 0 || mode === 'rfi' ? 'create' : 'attach')
    setPickerOpen(true)
  }

  function openSaveDialog(mode: 'attach' | 'create') {
    if (shapes.length === 0) return
    setSaveError(null)
    if (editing) {
      // In re-edit mode the dialog isn't used at all — the button is the
      // single-action "Update markup" path that targets the existing
      // annotation row. Defer to handleSaveClick which handles that branch.
      void handleSaveClick()
      return
    }
    setPickerRfiId(rfis[0]?.id ?? '')
    setPickerMode(mode)
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
  const renderShape = (s: AnyShape, interactive = false) => {
    // In Select mode (and never in read-only view), committed shapes carry
    // select/drag/transform handlers and notes become editable.
    const editable = interactive && mode !== 'view'
    const ip = editable ? shapeProps(s) : {}
    switch (s.type) {
      case 'pen':
        return (
          <Line
            key={s.id}
            {...ip}
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
            {...ip}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            opacity={0.35}
            tension={0.2}
            lineCap="round"
            lineJoin="round"
          />
        )
      case 'line':
        return (
          <Line
            key={s.id}
            {...ip}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            dash={s.dash}
            lineCap="round"
            hitStrokeWidth={Math.max(12, s.strokeWidth)}
          />
        )
      case 'arrow':
        return (
          <Arrow
            key={s.id}
            {...ip}
            points={s.points}
            stroke={s.color}
            fill={s.color}
            strokeWidth={s.strokeWidth}
            dash={s.dash}
            pointerLength={8 + s.strokeWidth}
            pointerWidth={8 + s.strokeWidth}
            hitStrokeWidth={Math.max(12, s.strokeWidth)}
          />
        )
      case 'rect':
        return (
          <Rect
            key={s.id}
            {...ip}
            x={s.x}
            y={s.y}
            rotation={s.rotation}
            width={s.width}
            height={s.height}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            dash={s.dash}
          />
        )
      case 'ellipse':
        return (
          <KonvaEllipse
            key={s.id}
            {...ip}
            x={s.cx}
            y={s.cy}
            rotation={s.rotation}
            radiusX={s.rx}
            radiusY={s.ry}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            dash={s.dash}
          />
        )
      case 'polyline':
        return (
          <Line
            key={s.id}
            {...ip}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            dash={s.dash}
            lineCap="round"
            lineJoin="round"
            hitStrokeWidth={Math.max(12, s.strokeWidth)}
          />
        )
      case 'polygon':
        return (
          <Line
            key={s.id}
            {...ip}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            dash={s.dash}
            closed
            lineJoin="round"
          />
        )
      case 'text':
        return (
          <KonvaText
            key={s.id}
            {...ip}
            x={s.x}
            y={s.y}
            rotation={s.rotation}
            text={s.text}
            fontSize={s.fontSize}
            fill={s.color}
          />
        )
      case 'note': {
        const txtColor = contrastText(s.color)
        return (
          <Group
            key={s.id}
            {...ip}
            x={s.x}
            y={s.y}
            rotation={s.rotation}
            onDblClick={
              editable
                ? (e: Konva.KonvaEventObject<MouseEvent>) => {
                    e.cancelBubble = true
                    editNoteText(s.id)
                  }
                : undefined
            }
            onDblTap={
              editable
                ? (e: Konva.KonvaEventObject<Event>) => {
                    e.cancelBubble = true
                    editNoteText(s.id)
                  }
                : undefined
            }
          >
            <Rect
              width={s.width}
              height={s.height}
              fill={s.color}
              cornerRadius={4}
              stroke="rgba(0,0,0,0.28)"
              strokeWidth={1}
              shadowColor="#000000"
              shadowBlur={6}
              shadowOffsetY={2}
              shadowOpacity={0.3}
            />
            <KonvaText
              x={9}
              y={9}
              width={s.width - 18}
              height={s.height - 18}
              text={s.text || 'Double-click to edit'}
              fontSize={s.fontSize}
              fill={s.text ? txtColor : 'rgba(0,0,0,0.4)'}
              wrap="word"
              ellipsis
            />
          </Group>
        )
      }
      case 'symbol': {
        const scale = s.size / 100
        const els = SYMBOLS[s.kind]?.els ?? []
        return (
          <Group key={s.id} {...ip} x={s.x} y={s.y} scaleX={scale} scaleY={scale} rotation={s.rotation}>
            {/* transparent hit box so the whole glyph area is selectable */}
            <Rect width={100} height={100} fill="rgba(0,0,0,0.001)" />
            {els.map((el, i) => {
              if (el.t === 'line') {
                return (
                  <Line key={i} points={el.pts} stroke={s.color} strokeWidth={SYMBOL_STROKE} lineCap="round" lineJoin="round" listening={false} />
                )
              }
              if (el.t === 'circle') {
                return (
                  <Circle key={i} x={el.cx} y={el.cy} radius={el.r} stroke={s.color} strokeWidth={SYMBOL_STROKE} fill={el.fill ? s.color : undefined} listening={false} />
                )
              }
              if (el.t === 'path') {
                return (
                  <Path key={i} data={el.d} stroke={s.color} strokeWidth={SYMBOL_STROKE} fill={el.fill ? s.color : undefined} lineCap="round" lineJoin="round" listening={false} />
                )
              }
              return (
                <KonvaText key={i} x={el.x} y={el.y} width={el.w} height={el.h} text={el.s} fontSize={el.size} fill={s.color} align="center" verticalAlign="middle" fontStyle="bold" listening={false} />
              )
            })}
          </Group>
        )
      }
      case 'table': {
        const cols = s.rows[0]?.length ?? 1
        const w = cols * s.cellW
        const h = s.rows.length * s.cellH
        return (
          <Group key={s.id} {...ip} x={s.x} y={s.y} rotation={s.rotation}>
            <Rect width={w} height={h} fill="#ffffff" stroke={s.color} strokeWidth={1.5} />
            <Rect width={w} height={s.cellH} fill={TABLE.header} listening={false} />
            {s.rows.map((row, r) =>
              row.map((cell, c) => (
                <Group key={`${r}-${c}`}>
                  <Rect
                    x={c * s.cellW}
                    y={r * s.cellH}
                    width={s.cellW}
                    height={s.cellH}
                    stroke={s.color}
                    strokeWidth={1}
                    fill="rgba(0,0,0,0.001)"
                    onDblClick={
                      editable
                        ? (e: Konva.KonvaEventObject<MouseEvent>) => {
                            e.cancelBubble = true
                            editTableCell(s.id, r, c)
                          }
                        : undefined
                    }
                    onDblTap={
                      editable
                        ? (e: Konva.KonvaEventObject<Event>) => {
                            e.cancelBubble = true
                            editTableCell(s.id, r, c)
                          }
                        : undefined
                    }
                  />
                  <KonvaText
                    x={c * s.cellW + 5}
                    y={r * s.cellH}
                    width={s.cellW - 10}
                    height={s.cellH}
                    text={cell}
                    fontSize={r === 0 ? 13 : 12}
                    fontStyle={r === 0 ? 'bold' : 'normal'}
                    fill={s.color}
                    align="left"
                    verticalAlign="middle"
                    ellipsis
                    wrap="none"
                    listening={false}
                  />
                </Group>
              )),
            )}
          </Group>
        )
      }
      case 'pin':
        return (
          <Group key={s.id} {...ip} x={s.x} y={s.y}>
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
          <Group key={s.id} {...ip}>
            <Line points={s.points} stroke={s.color} strokeWidth={s.strokeWidth} dash={[8, 4]} hitStrokeWidth={Math.max(12, s.strokeWidth)} />
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
    <div
      ref={wrapperRef}
      style={
        isFullscreen
          ? {
              // Overlay the whole viewport for maximum working space.
              position: 'fixed',
              inset: 0,
              zIndex: 2000,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 8,
              background: 'var(--c-base)',
            }
          : { display: 'flex', flexDirection: 'column', gap: 10 }
      }
    >
      {/* Toolbar — tool palette / colour / stroke / undo groups are hidden
          in view mode; zoom + page-nav stay visible so the viewer can pan,
          zoom and step through multi-page PDFs while read-only. */}
      <div className="data-panel" style={{ padding: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {mode !== 'view' && (
          <>
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
                <Tooltip key={c.value} label={c.label}>
                  <button
                    type="button"
                    onClick={() => {
                      setColor(c.value)
                      restyleSelected({ color: c.value })
                    }}
                    aria-label={c.label}
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
                </Tooltip>
              ))}
              <Tooltip label="Custom colour (any hex)">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000'}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="Custom colour"
                  style={{
                    width: 24,
                    height: 24,
                    padding: 0,
                    border: '2px solid var(--c-border)',
                    borderRadius: 6,
                    background: 'none',
                    cursor: 'pointer',
                  }}
                />
              </Tooltip>
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              {STROKE_WIDTHS.map((w) => (
                <ToolbarButton
                  key={w.value}
                  active={strokeWidth === w.value}
                  onClick={() => {
                    setStrokeWidth(w.value)
                    restyleSelected({ strokeWidth: w.value })
                  }}
                  title={w.label}
                >
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
              {STROKE_STYLES.map((st) => (
                <ToolbarButton
                  key={st.value}
                  active={strokeStyle === st.value}
                  onClick={() => {
                    setStrokeStyle(st.value)
                    restyleSelected({ dash: dashFor(st.value, strokeWidth) })
                  }}
                  title={`${st.label} line`}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 20,
                      height: 0,
                      borderTop:
                        st.value === 'solid'
                          ? '2px solid currentColor'
                          : st.value === 'dashed'
                            ? '2px dashed currentColor'
                            : '2px dotted currentColor',
                      verticalAlign: 'middle',
                    }}
                  />
                </ToolbarButton>
              ))}
            </ToolbarGroup>
            <ToolbarSeparator />
            <ToolbarGroup>
              <ToolbarButton active={gridOn} onClick={() => setGridOn((v) => !v)} title="Toggle grid overlay">
                ▦
              </ToolbarButton>
              <ToolbarButton active={snapOn} onClick={() => setSnapOn((v) => !v)} title="Snap drawing to grid intersections">
                ⌖
              </ToolbarButton>
              {pixelsPerMeter ? (
                <select
                  value={gridSpacingM}
                  onChange={(e) => setGridSpacingM(Number(e.target.value))}
                  title="Grid spacing (metres) — uses this drawing's calibration"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    padding: '4px 6px',
                    background: 'var(--c-panel)',
                    color: 'var(--c-text)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  {[0.25, 0.5, 1, 2, 5, 10].map((m) => (
                    <option key={m} value={m}>
                      {m} m
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  title="Calibrate this drawing for a metric grid; a pixel grid is used until then"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}
                >
                  px grid
                </span>
              )}
            </ToolbarGroup>
            <ToolbarSeparator />
          </>
        )}
        <ToolbarGroup>
          <ToolbarButton onClick={zoomOut} title="Zoom out (−, scroll wheel, or pinch)">−</ToolbarButton>
          <ToolbarButton onClick={fitToView} disabled={!img} title="Fit to view (F or 0) — scroll wheel or pinch to zoom, two-finger drag to pan">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>FIT</span>
          </ToolbarButton>
          <ToolbarButton onClick={zoomIn} title="Zoom in (+, scroll wheel, or pinch)">+</ToolbarButton>
          <ToolbarButton
            onClick={toggleFullscreen}
            active={isFullscreen}
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen — use the whole screen to work'}
          >
            {isFullscreen ? '⤡' : '⛶'}
          </ToolbarButton>
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
        {mode !== 'view' && (
          <ToolbarGroup>
            <ToolbarButton onClick={undo} disabled={undoStack.length === 0} title="Undo">↶</ToolbarButton>
            <ToolbarButton onClick={redo} disabled={redoStack.length === 0} title="Redo">↷</ToolbarButton>
            <ToolbarButton onClick={clearAll} disabled={shapes.length === 0} title="Clear all">⌫</ToolbarButton>
            {selectedId && (
              <ToolbarButton onClick={deleteSelected} title="Delete selected mark (or press Delete)">✕</ToolbarButton>
            )}
          </ToolbarGroup>
        )}
        {pageCount > 1 && (
          <>
            <ToolbarSeparator />
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => {
                  setSelectedId(null)
                  setCurrentPage((p) => Math.max(1, p - 1))
                }}
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
                onClick={() => {
                  setSelectedId(null)
                  setCurrentPage((p) => Math.min(pageCount, p + 1))
                }}
                disabled={currentPage >= pageCount}
                title="Next page"
              >
                ▸
              </ToolbarButton>
            </ToolbarGroup>
          </>
        )}
        <div style={{ flex: 1 }} />
        {mode !== 'view' && (
        <ToolbarGroup>
          <ToolbarButton onClick={startCalibration} title="Calibrate this drawing for the measure tool">Calibrate</ToolbarButton>
          {onSaveMarkup ? (
            // External-save mode (QC): a single Save/Update button that hands
            // the markup to the caller. No RFI picker / create / attach.
            <button
              type="button"
              className="btn-primary-amber"
              onClick={handleSaveClick}
              // Gate on marks *on this page* — the snapshot flattens the
              // current page, so an empty page must not overwrite the saved
              // image with a blank drawing.
              disabled={saving || marksOnCurrentPage === 0}
              title={
                marksOnCurrentPage === 0
                  ? 'Nothing to save on this page'
                  : initialScene
                    ? 'Update this markup'
                    : 'Save this markup'
              }
            >
              {saving ? 'Saving…' : initialScene ? 'Update markup' : 'Save markup'}
            </button>
          ) : editing ? (
            <button
              type="button"
              className="btn-primary-amber"
              onClick={handleSaveClick}
              disabled={saving || shapes.length === 0}
              title="Save changes back to the existing RFI annotation"
            >
              {saving ? 'Saving…' : 'Update markup'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-primary-amber"
                onClick={() => openSaveDialog('create')}
                disabled={saving || shapes.length === 0}
                title="Create a new RFI with this markup attached"
                style={{
                  background: 'var(--c-panel)',
                  border: '1px solid var(--c-amber)',
                  color: 'var(--c-amber)',
                }}
              >
                {saving ? 'Saving…' : '+ Create RFI'}
              </button>
              <button
                type="button"
                className="btn-primary-amber"
                onClick={() => openSaveDialog('attach')}
                disabled={saving || shapes.length === 0 || rfis.length === 0}
                title={
                  rfis.length === 0
                    ? 'No RFIs in this project yet — use "+ Create RFI" instead'
                    : 'Attach this markup to an existing RFI'
                }
              >
                {saving ? 'Saving…' : 'Attach to RFI'}
              </button>
            </>
          )}
        </ToolbarGroup>
        )}
      </div>

      {/* Symbol picker — shown while the Symbol tool is active. */}
      {mode !== 'view' && tool === 'symbol' && (
        <div className="data-panel" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginRight: 4, letterSpacing: '0.08em' }}>
            SYMBOL
          </span>
          {SYMBOL_KINDS.map((k) => (
            <Tooltip key={k} label={SYMBOLS[k].label}>
              <button
                type="button"
                aria-label={SYMBOLS[k].label}
                onClick={() => setSymbolKind(k)}
                style={{
                  width: 34,
                  height: 34,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 2,
                  background: symbolKind === k ? 'var(--c-amber-mid)' : 'var(--c-panel)',
                  border: symbolKind === k ? '2px solid var(--c-amber)' : '1px solid var(--c-border)',
                  borderRadius: 6,
                  color: symbolKind === k ? 'var(--c-amber)' : 'var(--c-text-mid)',
                  cursor: 'pointer',
                }}
              >
                <SymbolSvg kind={k} size={26} />
              </button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Table row/column controls — shown while a table is selected. */}
      {mode !== 'view' && selectedType === 'table' && (
        <div className="data-panel" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginRight: 4, letterSpacing: '0.08em' }}>
            TABLE
          </span>
          <ToolbarButton onClick={() => mutateSelectedTable(tableAddRow)} title="Add a row">+ Row</ToolbarButton>
          <ToolbarButton onClick={() => mutateSelectedTable(tableRemoveRow)} title="Remove the last row">− Row</ToolbarButton>
          <ToolbarButton onClick={() => mutateSelectedTable(tableAddCol)} title="Add a column">+ Col</ToolbarButton>
          <ToolbarButton onClick={() => mutateSelectedTable(tableRemoveCol)} title="Remove the last column">− Col</ToolbarButton>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
            double-click a cell to edit
          </span>
        </div>
      )}
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
          // Fill the remaining space in fullscreen (root is a flex column);
          // otherwise a fixed 70vh box in the normal page layout.
          height: isFullscreen ? 'auto' : '70vh',
          flex: isFullscreen ? 1 : undefined,
          minHeight: isFullscreen ? 0 : undefined,
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
              tool === 'select'
                ? fitToView
                : tool === 'polygon' || tool === 'polyline'
                  ? finishPoly
                  : undefined
            }
            onDblTap={
              tool === 'select'
                ? fitToView
                : tool === 'polygon' || tool === 'polyline'
                  ? finishPoly
                  : undefined
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
            {/* Metric grid aid — own layer + ref so snapshotScene() can hide
                it during the PNG capture. Hairline (1/scale) so it stays ~1px
                at any zoom; capped line count via gridLineOffsets. */}
            <Layer ref={gridLayerRef} listening={false} visible={gridOn}>
              {gridOn &&
                gridLineOffsets(naturalW, gridPx).map((gx) => (
                  <Line
                    key={`grid-v-${gx}`}
                    points={[gx, 0, gx, naturalH]}
                    stroke="#2563eb"
                    strokeWidth={1 / scale}
                    opacity={0.28}
                  />
                ))}
              {gridOn &&
                gridLineOffsets(naturalH, gridPx).map((gy) => (
                  <Line
                    key={`grid-h-${gy}`}
                    points={[0, gy, naturalW, gy]}
                    stroke="#2563eb"
                    strokeWidth={1 / scale}
                    opacity={0.28}
                  />
                ))}
            </Layer>
            <Layer>
              {/* Filter shapes to the current page; pageIndex defaults to 1
                  for shapes from v1 scene graphs that didn't carry it. */}
              {shapes.filter((s) => (s.pageIndex ?? 1) === currentPage).map((s) => renderShape(s, true))}
              {current && renderShape(current)}
              {tool === 'select' && (
                <Transformer
                  ref={trRef}
                  rotateEnabled={selectedType !== 'pin'}
                  resizeEnabled={selectedType !== 'pin'}
                  {...(selectedType === 'symbol'
                    ? { keepRatio: true, enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] }
                    : {})}
                  ignoreStroke
                  anchorSize={9}
                  anchorCornerRadius={2}
                  borderStroke="#2563eb"
                  borderStrokeWidth={1.5}
                  anchorStroke="#2563eb"
                  anchorFill="#ffffff"
                  rotateAnchorOffset={22}
                  boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
                />
              )}
              {tool === 'eraser' && eraserPos && (
                <Circle
                  ref={eraserCursorRef}
                  x={eraserPos.x}
                  y={eraserPos.y}
                  radius={ERASER_RADIUS}
                  stroke="#dc2626"
                  strokeWidth={1.5 / scale}
                  dash={[4 / scale, 3 / scale]}
                  fill="rgba(220,38,38,0.08)"
                  listening={false}
                />
              )}
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
              {/* Polygon/polyline in-progress: vertices + connecting line.
                  Double-click (or Enter) finishes. */}
              {(tool === 'polygon' || tool === 'polyline') && polyPoints.length >= 2 && (
                <Line
                  points={polyPoints}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  dash={[6, 4]}
                  closed={tool === 'polygon' && polyPoints.length >= 6}
                />
              )}
              {(tool === 'polygon' || tool === 'polyline') &&
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

      {!onSaveMarkup && pickerOpen && (
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
  // aria-label carries the accessible name (native `title` dropped so desktop
  // doesn't show a double tooltip); the styled Tooltip adds hover/focus/touch.
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
          fontSize: 13,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}
