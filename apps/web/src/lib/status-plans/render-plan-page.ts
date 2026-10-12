/**
 * One status plan as a vector PDF page (spec 2026-10-09 §8).
 *
 * The source drawing page is EMBEDDED (pdf-lib embedPage → form XObject), never rasterised, and
 * every shape is drawn in vector on top from the single palette (palette.ts) with the shared hatch
 * (geometry.ts hatchSegments), so the canvas, the legend and this page cannot disagree.
 *
 * Two layouts:
 *   'a3'     — fitted to A3 landscape with a legend column and a title strip (report appendix, portal)
 *   'source' — the drawing at 1:1, a band below for title and legend (schematic "Export sheet")
 *
 * Every string drawn goes through winAnsiSafe: pdf-lib's standard fonts THROW on anything outside
 * WinAnsi (PR #154). `m²` is safe; `→ ✓ Ω` are not.
 *
 * Size (2026-10-09): within one output document each (drawing file, page) is embedded ONCE and the
 * form XObject reused by every plan page that shows it — keyed by PlanSource.key (the storage path),
 * with one object copier per drawing file so resources shared by its pages are copied once too. The
 * donor page pdf-lib copies in order to embed it is left unreferenced, and pruneUnreachableObjects
 * drops it before save (without that, every sheet carried its drawing twice). Callers that build a
 * document with drawStatusPlanPage must prune before save — renderStatusPlanPdf and the appendix do.
 *
 * Failure model: the source is resolved (loaded, page checked, embedded) BEFORE a page is added, and
 * the embed is forced with `.embed()` — pdf-lib otherwise embeds lazily inside `save()`, where one bad
 * drawing would fail the whole report. A failure is a StatusPlanSourceError carrying a sentence the
 * appendix divider and the Export sheet route show as-is.
 *
 * What a shape LOOKS like (style, legend key, label lines, counts, Measured GLA) is decided by
 * shape-view.ts — the same resolveShapeView / legendSummary the canvas uses — and arrives here
 * already resolved, so the screen and this page cannot drift. An outline that fails today's checks
 * (slice 2's invalidReason) is drawn as an outline only when it still has readable points, and is
 * never hatched, filled or labelled; an outline with no readable points is skipped. Never throws.
 */
import {
  PDFDocument, PDFObjectCopier, PDFPage, StandardFonts, EncryptedPDFError, rgb,
  pushGraphicsState, popGraphicsState, setGraphicsState, concatTransformationMatrix, drawObject,
  rectangle, clip, endPath, moveTo, lineTo, closePath, fill, stroke,
  setFillingRgbColor, setStrokingRgbColor, setLineWidth, setDashPattern,
  type PDFFont, type PDFName, type PDFOperator,
} from 'pdf-lib'
import {
  PURPOSE_LABEL, boundingBox, hatchSegments, hexToRgb01, visualCentre,
  type HatchSpec, type LegendEntry, type Segment, type ShapeStyle, type StatusPlanPurpose,
} from '@esite/shared/status-plans'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import { pruneUnreachableObjects } from '@/lib/pdf/prune-unreachable'
import { measuredGlaText } from './shape-view'
import {
  IMAGE_PX_PER_PT, PDF_PX_PER_PT, imageToOutput, normaliseRotation, placementFor, viewedSize,
  type Frame, type PageBox, type Placement, type QuarterTurn,
} from './pdf-geometry'

/**
 * `key` identifies the file (its storage path). Sources sharing a key within one output document are
 * embedded once; without a key every page embeds its own copy.
 */
export type PlanSource =
  | { kind: 'pdf'; bytes: Uint8Array; /** 1-based */ pageIndex: number; key?: string }
  | { kind: 'png' | 'jpg'; bytes: Uint8Array; key?: string }

export interface RenderShape {
  /** Image space, flat [x0, y0, …] — exactly as stored (may be [] for an unreadable outline). */
  points: readonly number[]
  /** ShapeView.style. */
  style: ShapeStyle
  /** ShapeView.labelLines: the first is drawn bold, the rest smaller. Empty = no label. */
  labelLines: readonly string[]
  /** ShapeView.invalid: the outline fails today's checks — outline only, no fill, hatch or label. */
  invalid: boolean
}

export interface StatusPlanRenderInput {
  planId: string
  planName: string
  purpose: StatusPlanPurpose
  drawingName: string
  pageIndex: number
  /** yyyy-mm-dd — colours are computed for this day (spec §8: a saved report is a snapshot). */
  generatedOn: string
  source: PlanSource
  shapes: readonly RenderShape[]
  legend: readonly LegendEntry[]
  /** legendSummary(...).counts: legend key → count (a missing key draws 0). */
  counts: Readonly<Record<string, number>>
  /** Tenant layout with a page scale only: legendSummary's Measured GLA (linked shop shapes only). */
  measured: { totalM2: number; unmeasured: number } | null
  warnings: readonly string[]
}

export type PlanLayout = 'a3' | 'source'
export interface PlanFonts { regular: PDFFont; bold: PDFFont }

export class StatusPlanSourceError extends Error {
  constructor(message: string) { super(message); this.name = 'StatusPlanSourceError' }
}

export const A3_LANDSCAPE: readonly [number, number] = [1190.55, 841.89]
const MARGIN = 24
const STRIP_H = 40
const LEGEND_W = 200
const LEGEND_ROW = 13
const LABEL_MAX = 8
const LABEL_MIN = 3.5
const MIN_LINE = 0.25
const INK = rgb(0.08, 0.08, 0.08)
const MUTED = rgb(0.38, 0.38, 0.38)
const AMBER = rgb(0.71, 0.45, 0.04)

const T = (s: string) => winAnsiSafe(s)

/** "Ground floor (Tenant layout, page 2)" — how a plan is named in not-included lines and dividers. */
export function planTitle(name: string, purpose: StatusPlanPurpose, pageIndex: number): string {
  return `${name} (${PURPOSE_LABEL[purpose]}, page ${pageIndex})`
}

/** Enough finite points to draw a polygon. Anything else is skipped rather than thrown on. */
export function isDrawable(points: readonly number[]): boolean {
  return points.length >= 6 && points.length % 2 === 0 && points.every((v) => Number.isFinite(v))
}

interface ResolvedSource {
  box: PageBox
  rotate: QuarterTurn
  pxPerPt: number
  draw: (page: PDFPage, placement: Placement) => void
}

interface DocCaches {
  /** key → the parsed drawing and ONE copier into this document (shared resources copied once). */
  files: Map<string, Promise<{ src: PDFDocument; copier: PDFObjectCopier }>>
  /** `${key}#${page}` (or key for an image) → the embedded source. */
  sources: Map<string, Promise<ResolvedSource>>
}
const docCaches = new WeakMap<PDFDocument, DocCaches>()
function cachesFor(doc: PDFDocument): DocCaches {
  let c = docCaches.get(doc)
  if (!c) { c = { files: new Map(), sources: new Map() }; docCaches.set(doc, c) }
  return c
}

async function loadSourcePdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    // pdf-lib's errors are ES5 classes: `instanceof EncryptedPDFError` is false at runtime, so read the message too.
    const encrypted = e instanceof EncryptedPDFError || (e instanceof Error && /is encrypted/i.test(e.message))
    throw new StatusPlanSourceError(encrypted ? 'the drawing PDF is password-protected' : 'the drawing PDF could not be read')
  }
}

function sourceFile(doc: PDFDocument, source: Extract<PlanSource, { kind: 'pdf' }>): Promise<{ src: PDFDocument; copier: PDFObjectCopier }> {
  const make = async () => {
    const src = await loadSourcePdf(source.bytes)
    return { src, copier: PDFObjectCopier.for(src.context, doc.context) }
  }
  if (source.key === undefined) return make()
  const files = cachesFor(doc).files
  let p = files.get(source.key)
  if (!p) { p = make(); files.set(source.key, p) }
  return p
}

/** Embedded once per (document, key, page); a failure is cached too (the same file fails the same way). */
function resolveSource(doc: PDFDocument, source: PlanSource): Promise<ResolvedSource> {
  if (source.key === undefined) return resolveSourceUncached(doc, source)
  const k = source.kind === 'pdf' ? `${source.key}#${source.pageIndex}` : source.key
  const sources = cachesFor(doc).sources
  let p = sources.get(k)
  if (!p) { p = resolveSourceUncached(doc, source); sources.set(k, p) }
  return p
}

async function resolveSourceUncached(doc: PDFDocument, source: PlanSource): Promise<ResolvedSource> {
  if (source.kind === 'pdf') {
    const { src, copier } = await sourceFile(doc, source)
    const count = src.getPageCount()
    if (source.pageIndex < 1 || source.pageIndex > count) {
      throw new StatusPlanSourceError(`page ${source.pageIndex} is not in the drawing (it has ${count})`)
    }
    const srcPage = src.getPage(source.pageIndex - 1)
    const box = srcPage.getCropBox()
    const rotate = normaliseRotation(srcPage.getRotation().angle)
    let embedded: Awaited<ReturnType<PDFDocument['embedPage']>>
    try {
      // Copy the page with this file's shared copier, then embed it from inside `doc` (no second copy).
      const leaf = copier.copy(srcPage.node)
      const local = PDFPage.of(leaf, doc.context.register(leaf), doc)
      embedded = await doc.embedPage(local, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height })
      await embedded.embed()
    } catch {
      throw new StatusPlanSourceError(`page ${source.pageIndex} of the drawing could not be embedded`)
    }
    return {
      box, rotate, pxPerPt: PDF_PX_PER_PT,
      draw: (page, p) => {
        const name = page.node.newXObject('SP', embedded.ref)
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...p.matrix), drawObject(name), popGraphicsState())
      },
    }
  }
  let img: Awaited<ReturnType<PDFDocument['embedPng']>>
  try {
    img = source.kind === 'png' ? await doc.embedPng(source.bytes) : await doc.embedJpg(source.bytes)
    await img.embed()
  } catch {
    throw new StatusPlanSourceError('the drawing image could not be read')
  }
  return {
    box: { x: 0, y: 0, width: img.width, height: img.height }, rotate: 0, pxPerPt: IMAGE_PX_PER_PT,
    draw: (page, p) => {
      const name = page.node.newXObject('SI', img.ref)
      // An image XObject fills the unit square: scale it to the drawn rectangle.
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(p.drawn.width, 0, 0, p.drawn.height, p.drawn.x, p.drawn.y),
        drawObject(name),
        popGraphicsState(),
      )
    },
  }
}

interface Layout {
  pageSize: [number, number]
  frame: Frame
  strip: Frame
  legend: { x: number; yTop: number; width: number; cols: number }
}

export function layoutFor(kind: PlanLayout, viewed: { width: number; height: number }, legendCount: number): Layout {
  if (kind === 'a3') {
    const [W, H] = A3_LANDSCAPE
    const left = W - 2 * MARGIN - LEGEND_W - 12
    return {
      pageSize: [W, H],
      frame: { x: MARGIN, y: MARGIN + STRIP_H + 8, width: left, height: H - 2 * MARGIN - STRIP_H - 8 },
      strip: { x: MARGIN, y: MARGIN, width: left, height: STRIP_H },
      legend: { x: W - MARGIN - LEGEND_W, yTop: H - MARGIN, width: LEGEND_W, cols: 1 },
    }
  }
  // 'source': the drawing 1:1 at the top; a band below holds the title (left) and the legend grid.
  const titleW = Math.min(320, viewed.width * 0.4)
  const legendW = Math.max(160, viewed.width - titleW - 48)
  const cols = Math.max(1, Math.floor(legendW / 170))
  const rows = Math.ceil(legendCount / cols)
  const band = Math.max(STRIP_H + 16, 30 + rows * LEGEND_ROW + 24)
  return {
    pageSize: [viewed.width, viewed.height + band],
    frame: { x: 0, y: band, width: viewed.width, height: viewed.height },
    strip: { x: 16, y: 8, width: titleW, height: band - 16 },
    legend: { x: 16 + titleW + 16, yTop: band - 8, width: legendW, cols },
  }
}

type OpacityState = (alpha: number) => PDFName

function opacityStates(doc: PDFDocument, page: PDFPage): OpacityState {
  const cache = new Map<number, PDFName>()
  return (alpha) => {
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000
    let name = cache.get(a)
    if (!name) {
      const ref = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: a, CA: 1 }))
      name = page.node.newExtGState('GS', ref)
      cache.set(a, name)
    }
    return name
  }
}

function polygonPath(pts: readonly number[]): PDFOperator[] {
  const ops: PDFOperator[] = [moveTo(pts[0]!, pts[1]!)]
  for (let i = 2; i < pts.length; i += 2) ops.push(lineTo(pts[i]!, pts[i + 1]!))
  ops.push(closePath())
  return ops
}

/** Fill (with opacity) → hatches → outline, in output space. `unit` = output pt per style px. */
function drawStyledPolygon(
  page: PDFPage, gs: OpacityState, outPts: readonly number[], style: ShapeStyle, unit: number,
  hatchesFor: (h: HatchSpec) => Segment[],
): void {
  if (style.fill && style.fillOpacity > 0) {
    const c = hexToRgb01(style.fill)
    page.pushOperators(
      pushGraphicsState(), setGraphicsState(gs(style.fillOpacity)), setFillingRgbColor(c.r, c.g, c.b),
      ...polygonPath(outPts), fill(), popGraphicsState(),
    )
  }
  for (const h of style.hatches) {
    const segs = hatchesFor(h)
    if (segs.length === 0) continue
    const c = hexToRgb01(h.color)
    const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(c.r, c.g, c.b), setLineWidth(Math.max(MIN_LINE, h.width * unit))]
    for (const [x0, y0, x1, y1] of segs) ops.push(moveTo(x0, y0), lineTo(x1, y1))
    ops.push(stroke(), popGraphicsState())
    page.pushOperators(...ops)
  }
  const c = hexToRgb01(style.stroke)
  const ops: PDFOperator[] = [pushGraphicsState(), setStrokingRgbColor(c.r, c.g, c.b), setLineWidth(Math.max(MIN_LINE, style.strokeWidth * unit))]
  if (style.dash && style.dash.length > 0) ops.push(setDashPattern(style.dash.map((d) => d * unit), 0))
  ops.push(...polygonPath(outPts), stroke(), popGraphicsState())
  page.pushOperators(...ops)
}

function drawLabel(page: PDFPage, fonts: PlanFonts, s: RenderShape, centre: { x: number; y: number }, maxWidth: number): void {
  if (s.labelLines.length === 0) return
  const lines: Array<{ text: string; font: PDFFont; rel: number }> = s.labelLines.map((l, i) =>
    i === 0 ? { text: T(l), font: fonts.bold, rel: 1 } : { text: T(l), font: fonts.regular, rel: 0.85 })
  const widest = (size: number, ls = lines) => Math.max(...ls.map((l) => l.font.widthOfTextAtSize(l.text, size * l.rel)))
  let size = LABEL_MAX
  while (size > LABEL_MIN && widest(size) > maxWidth) size -= 0.5
  // Still too wide at the minimum: the first line alone (never drop the label entirely).
  const shown = widest(size) > maxWidth ? lines.slice(0, 1) : lines
  const lh = size * 1.15
  let y = centre.y + ((shown.length - 1) * lh) / 2 - size * 0.35
  shown.forEach((l, i) => {
    const sz = size * l.rel
    const w = l.font.widthOfTextAtSize(l.text, sz)
    page.drawText(l.text, { x: centre.x - w / 2, y, size: sz, font: l.font, color: INK })
    if (i === 0 && s.style.strikeLabel) {
      page.drawLine({ start: { x: centre.x - w / 2, y: y + sz * 0.33 }, end: { x: centre.x + w / 2, y: y + sz * 0.33 }, thickness: 0.6, color: INK })
    }
    y -= lh
  })
}

function drawTitleStrip(page: PDFPage, input: StatusPlanRenderInput, r: Frame, fonts: PlanFonts): void {
  let y = r.y + r.height - 12
  page.drawText(T(input.planName), { x: r.x, y, size: 11, font: fonts.bold, color: INK, maxWidth: r.width })
  y -= 12
  page.drawText(
    T(`${PURPOSE_LABEL[input.purpose]} · ${input.drawingName} · page ${input.pageIndex} · generated ${input.generatedOn}`),
    { x: r.x, y, size: 7.5, font: fonts.regular, color: MUTED, maxWidth: r.width },
  )
  for (const w of input.warnings.slice(0, 2)) {
    y -= 10
    page.drawText(T(w), { x: r.x, y, size: 7, font: fonts.regular, color: AMBER, maxWidth: r.width })
  }
}

function drawLegend(page: PDFPage, gs: OpacityState, input: StatusPlanRenderInput, area: Layout['legend'], fonts: PlanFonts): void {
  page.drawText(T('Legend'), { x: area.x, y: area.yTop - 10, size: 9, font: fonts.bold, color: INK })
  const colW = area.width / area.cols
  input.legend.forEach((e, i) => {
    const x = area.x + (i % area.cols) * colW
    const y = area.yTop - 26 - Math.floor(i / area.cols) * LEGEND_ROW
    // The swatch is hatched in a y-DOWN local space, then flipped, so its hatch leans the same way
    // as the drawing's (image space is y-down too).
    const local = [0, 0, 18, 0, 18, 9, 0, 9]
    const toPage = (lx: number, ly: number): [number, number] => [x + lx, y + 9 - ly]
    const swatch = [...toPage(0, 0), ...toPage(18, 0), ...toPage(18, 9), ...toPage(0, 9)]
    drawStyledPolygon(page, gs, swatch, e.style, 0.35, (h) =>
      hatchSegments(local, { angleDeg: h.angleDeg, spacing: 3.5 }).map(([a, b, c, d]) => [...toPage(a, b), ...toPage(c, d)] as Segment))
    page.drawText(T(e.label), { x: x + 24, y: y + 1, size: 7.5, font: fonts.regular, color: INK })
    const n = String(input.counts[e.key] ?? 0)
    page.drawText(n, { x: x + colW - 10 - fonts.bold.widthOfTextAtSize(n, 7.5), y: y + 1, size: 7.5, font: fonts.bold, color: INK })
  })
  let y = area.yTop - 26 - Math.ceil(input.legend.length / area.cols) * LEGEND_ROW - 4
  page.drawText(T(`${input.shapes.length} shapes on this plan`), { x: area.x, y, size: 7, font: fonts.regular, color: MUTED })
  if (input.measured) {
    y -= 10
    page.drawText(T(measuredGlaText(input.measured.totalM2, input.measured.unmeasured)), { x: area.x, y, size: 7, font: fonts.regular, color: MUTED })
  }
}

/** Add one plan page to `doc`. Throws StatusPlanSourceError (no page added) when the drawing cannot be used. */
export async function drawStatusPlanPage(doc: PDFDocument, input: StatusPlanRenderInput, layoutKind: PlanLayout, fonts: PlanFonts): Promise<PDFPage> {
  const src = await resolveSource(doc, input.source)
  const layout = layoutFor(layoutKind, viewedSize(src.box, src.rotate), input.legend.length)
  const page = doc.addPage(layout.pageSize)
  const placement = placementFor(src.box, src.rotate, layout.frame)
  src.draw(page, placement)

  const unit = placement.scale / src.pxPerPt
  const gs = opacityStates(doc, page)
  const pt = (x: number, y: number) => imageToOutput({ x, y }, src.box, src.rotate, placement, src.pxPerPt)
  const toOut = (pts: readonly number[]) => {
    const out: number[] = []
    for (let i = 0; i < pts.length; i += 2) { const p = pt(pts[i]!, pts[i + 1]!); out.push(p.x, p.y) }
    return out
  }

  // Shapes are clipped to the drawing so a hatch never runs into the legend or the strip.
  const d = placement.drawn
  page.pushOperators(pushGraphicsState(), rectangle(d.x, d.y, d.width, d.height), clip(), endPath())
  const drawable = input.shapes.filter((s) => isDrawable(s.points))
  for (const s of drawable) {
    if (s.invalid) {
      drawStyledPolygon(page, gs, toOut(s.points), { ...s.style, fill: null, hatches: [] }, unit, () => [])
      continue
    }
    drawStyledPolygon(page, gs, toOut(s.points), s.style, unit, (h) =>
      hatchSegments(s.points, { angleDeg: h.angleDeg, spacing: h.spacing }).map(([x0, y0, x1, y1]) => {
        const a = pt(x0, y0)
        const b = pt(x1, y1)
        return [a.x, a.y, b.x, b.y] as Segment
      }))
  }
  page.pushOperators(popGraphicsState())

  for (const s of drawable) {
    if (s.invalid || s.labelLines.length === 0) continue
    const c = visualCentre(s.points)
    const bb = boundingBox(s.points)
    drawLabel(page, fonts, s, pt(c.x, c.y), (bb.maxX - bb.minX) * unit * 0.92)
  }
  drawTitleStrip(page, input, layout.strip, fonts)
  drawLegend(page, gs, input, layout.legend, fonts)
  return page
}

/** A standalone one-page PDF (Export sheet, portal). */
export async function renderStatusPlanPdf(input: StatusPlanRenderInput, layout: PlanLayout): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(T(input.planName))
  doc.setProducer('E-Site')
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  await drawStatusPlanPage(doc, input, layout, fonts)
  await pruneUnreachableObjects(doc)
  return doc.save()
}
