// @vitest-environment node
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib'
import { TENANT_LEGEND, hatchSegments, type ShapeStyle } from '@esite/shared/status-plans'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'
import { squash } from '@/test/pdf-text'
import { pdfStreams, pdfAllText, paintedPaths, cmBeforeDo, samePoints, near, drawnText } from '@/test/pdf-ops'
import {
  renderStatusPlanPdf, drawStatusPlanPage, StatusPlanSourceError, A3_LANDSCAPE,
  type StatusPlanRenderInput, type RenderShape,
} from './render-plan-page'

/** A source drawing: MediaBox at `origin`, /Rotate r, and a 10 pt marker square whose corner is at `marker`. */
async function sourcePdf(o: { r?: number; origin?: [number, number]; marker?: [number, number]; pages?: number } = {}) {
  const d = await PDFDocument.create()
  for (let i = 0; i < (o.pages ?? 1); i++) {
    const p = d.addPage([600, 400])
    const [ox, oy] = o.origin ?? [0, 0]
    p.setMediaBox(ox, oy, 600, 400)
    p.setRotation(degrees(o.r ?? 0))
    const [mx, my] = o.marker ?? [500, 300]
    p.drawRectangle({ x: mx, y: my, width: 10, height: 10, color: rgb(0, 0, 1) })
  }
  return d.save()
}

const PLAIN: ShapeStyle = { fill: null, fillOpacity: 0, stroke: '#112233', strokeWidth: 3, dash: null, hatches: [], strikeLabel: false }
const SQUARE = [100, 100, 300, 100, 300, 300, 100, 300] // image px

function shape(over: Partial<RenderShape> = {}): RenderShape {
  return { points: SQUARE, style: PLAIN, labelLines: [], invalid: false, ...over }
}

function input(bytes: Uint8Array, over: Partial<StatusPlanRenderInput> = {}): StatusPlanRenderInput {
  return {
    planId: 'p1', planName: 'Ground floor tenants', purpose: 'tenant_layout', drawingName: 'Tenant layout',
    pageIndex: 1, generatedOn: '2026-10-09', source: { kind: 'pdf', bytes, pageIndex: 1 },
    shapes: [shape()], legend: TENANT_LEGEND, counts: {}, measured: null, warnings: [], ...over,
  }
}

async function pageInfo(bytes: Uint8Array) {
  const p = (await PDFDocument.load(bytes)).getPage(0)
  return { width: p.getWidth(), height: p.getHeight() }
}

/** The page content stream: the one that draws the embedded sheet. */
function pageStream(bytes: Uint8Array): string {
  const s = pdfStreams(bytes).find((t) => /\/S[PI][^\s/]*\s+Do/.test(t))
  if (!s) throw new Error('no page content stream drawing the sheet')
  return s
}

const apply = (m: number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!]

describe('renderStatusPlanPdf — source layout (Export sheet)', () => {
  it.each([0, 90, 180, 270])('/Rotate %i: the shape lands where it sits on the viewed sheet', async (r) => {
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r })), 'source')
    const { width, height } = await pageInfo(out)
    expect(width).toBeCloseTo(r === 90 || r === 270 ? 400 : 600, 2)
    // Image px (100,100)…(300,300) ÷ 2 → viewed pt (50,50)…(150,150), y measured down from the page top.
    const want: Array<[number, number]> = [[50, height - 50], [150, height - 50], [150, height - 150], [50, height - 150]]
    const outline = paintedPaths(pageStream(out)).find((p) => p.paint === 'S' && p.closed && samePoints(p.points, want))
    expect(outline, JSON.stringify(paintedPaths(pageStream(out)).slice(0, 6))).toBeDefined()
  })

  // Hand-derived from "/Rotate turns the page clockwise": the marker corner at source (500, 300) on a
  // 600×400 page is viewed at r0 (500,100) · r90 (300,500) · r180 (100,300) · r270 (100,100), y down.
  it.each([
    [0, [500, 100]], [90, [300, 500]], [180, [100, 300]], [270, [100, 100]],
  ] as const)('/Rotate %i: the embedded drawing is placed where pdf.js shows it', async (r, [u, v]) => {
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r })), 'source')
    const { height } = await pageInfo(out)
    const [m] = cmBeforeDo(pageStream(out), 'SP')
    expect(m).toBeDefined()
    const [x, y] = apply(m!, 500, 300)
    expect(near(x, u)).toBe(true)
    expect(near(y, height - v)).toBe(true)
  })

  it('honours a MediaBox that does not start at 0,0', async () => {
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r: 90, origin: [50, 20], marker: [550, 320] })), 'source')
    const all = pdfAllText(out)
    expect(all).toMatch(/\/BBox\s*\[\s*50\s+20\s+650\s+420\s*\]/)
    expect(all).toMatch(/\/Matrix\s*\[\s*1\s+0\s+0\s+1\s+-50\s+-20\s*\]/)
    const { height } = await pageInfo(out)
    const [m] = cmBeforeDo(pageStream(out), 'SP')
    const [x, y] = apply(m!, 550 - 50, 320 - 20) // form space = source − origin (asserted above)
    expect(near(x, 300)).toBe(true)
    expect(near(y, height - 500)).toBe(true)
  })

  it('embeds the drawing as vector (a form XObject), never as an image', async () => {
    const all = pdfAllText(await renderStatusPlanPdf(input(await sourcePdf()), 'source'))
    expect(all).toMatch(/\/Subtype\s*\/Form/)
    expect(all).not.toMatch(/\/Subtype\s*\/Image/)
  })
})

describe('renderStatusPlanPdf — A3 layout (report appendix, portal)', () => {
  it('fits the turned sheet into A3 landscape and keeps shapes on the drawing', async () => {
    const full = shape({ points: [0, 0, 800, 0, 800, 1200, 0, 1200] }) // the whole viewed sheet of a /Rotate 90 page
    const out = await renderStatusPlanPdf(input(await sourcePdf({ r: 90 }), { shapes: [full] }), 'a3')
    const { width, height } = await pageInfo(out)
    expect(width).toBeCloseTo(A3_LANDSCAPE[0], 1)
    expect(height).toBeCloseTo(A3_LANDSCAPE[1], 1)
    const [m] = cmBeforeDo(pageStream(out), 'SP')
    const box: Array<[number, number]> = [apply(m!, 0, 0), apply(m!, 600, 0), apply(m!, 600, 400), apply(m!, 0, 400)]
    const outline = paintedPaths(pageStream(out)).find((p) => p.paint === 'S' && p.closed && samePoints(p.points, box))
    expect(outline).toBeDefined()
    for (const [x] of box) expect(x).toBeLessThan(A3_LANDSCAPE[0] - 24 - 200)
  })
})

describe('styles', () => {
  it('draws the shared hatch — one subpath per hatchSegments segment, all inside the shape', async () => {
    const hatched: ShapeStyle = { ...PLAIN, hatches: [{ angleDeg: 45, spacing: 14, color: '#D64545', width: 2 }] }
    const out = await renderStatusPlanPdf(input(await sourcePdf(), { shapes: [shape({ style: hatched })] }), 'source')
    const { height } = await pageInfo(out)
    const n = hatchSegments(SQUARE, { angleDeg: 45, spacing: 14 }).length
    expect(n).toBeGreaterThan(5)
    const hatch = paintedPaths(pageStream(out)).find((p) => p.paint === 'S' && !p.closed && p.moves === n)
    expect(hatch).toBeDefined()
    for (const [x, y] of hatch!.points) {
      expect(x).toBeGreaterThanOrEqual(50 - 0.02); expect(x).toBeLessThanOrEqual(150 + 0.02)
      expect(y).toBeGreaterThanOrEqual(height - 150 - 0.02); expect(y).toBeLessThanOrEqual(height - 50 + 0.02)
    }
  })

  it('fills through an ExtGState carrying the palette opacity', async () => {
    const filled: ShapeStyle = { ...PLAIN, fill: '#2E9E4F', fillOpacity: 0.45 }
    const out = await renderStatusPlanPdf(input(await sourcePdf(), { shapes: [shape({ style: filled })] }), 'source')
    expect(pdfAllText(out)).toMatch(/\/ca\s+0\.45/)
    expect(paintedPaths(pageStream(out)).some((p) => p.paint === 'f' && p.closed)).toBe(true)
  })
})

describe('invalid outlines (slice 2 keeps them with invalidReason) never throw', () => {
  it('an unreadable outline (no points) is skipped; a self-intersecting one is outlined only, never hatched or labelled', async () => {
    const hatched: ShapeStyle = { ...PLAIN, hatches: [{ angleDeg: 45, spacing: 14, color: '#D64545', width: 2 }] }
    const bow = [100, 100, 300, 300, 300, 100, 100, 300] // self-intersecting
    const out = await renderStatusPlanPdf(input(await sourcePdf(), {
      shapes: [
        shape({ points: [], invalid: true, labelLines: ['GONE'] }),
        shape({ points: [1, Number.NaN, 3, 4, 5, 6], invalid: true }),
        shape({ points: bow, invalid: true, style: hatched, labelLines: ['BOWTIE'] }),
      ],
    }), 'source')
    const { height } = await pageInfo(out)
    const paths = paintedPaths(pageStream(out))
    const want: Array<[number, number]> = [[50, height - 50], [150, height - 150], [150, height - 50], [50, height - 150]]
    expect(paths.some((p) => p.paint === 'S' && p.closed && samePoints(p.points, want))).toBe(true)
    // No hatch inside the shape (the legend's own swatch hatches sit in the band below the drawing).
    const inShape = ([x, y]: [number, number]) => x >= 49 && x <= 151 && y >= height - 151 && y <= height - 49
    expect(paths.some((p) => p.paint === 'S' && !p.closed && p.moves > 1 && p.points.every(inShape))).toBe(false)
    const text = squash(drawnText(out))
    expect(text).not.toContain('BOWTIE')
    expect(text).not.toContain('GONE')
  })
})

describe('text', () => {
  it('every label, title and warning is WinAnsi-safe, with hostile input', async () => {
    const out = await renderStatusPlanPdf(input(await sourcePdf(), {
      planName: 'Plan → “east” ✓',
      shapes: [shape({ labelLines: ['Shop → 12 ✓', 'Ω ≤ 中文 Café', '123.5 m²'] })],
      warnings: ['The drawing file has changed since this plan was drawn'],
    }), 'source')
    const text = drawnText(out)
    expect(isWinAnsiSafe(text)).toBe(true)
    expect(text).not.toContain('→')
    expect(squash(text)).toContain('Shop->12')
    expect(squash(text)).toContain('123.5m²')
    expect(squash(text)).toContain('Thedrawingfilehaschanged')
  })

  it('the legend shows the counts it is given, zero for a missing key, and Measured GLA in the screen wording', async () => {
    const out = await renderStatusPlanPdf(input(await sourcePdf(), {
      counts: { complete: 2, in_progress: 1 },
      measured: { totalM2: 100, unmeasured: 1 },
    }), 'source')
    const text = squash(drawnText(out))
    const label = (k: string) => squash(TENANT_LEGEND.find((e) => e.key === k)!.label)
    expect(text).toContain(`${label('complete')}2`)
    expect(text).toContain(`${label('in_progress')}1`)
    expect(text).toContain(`${label('vacant')}0`)
    expect(text).toContain('MeasuredGLA:100.0m²(1shapeunmeasured)')
  })
})

/** Line work that does not compress away, so a duplicated copy shows in the byte count. */
async function heavyDrawing(segments: number, r = 0): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([2000, 1400])
  p.setRotation(degrees(r))
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let k = 0; k < segments / 500; k++) {
    let path = `M ${(rnd() * 2000).toFixed(1)} ${(rnd() * 1400).toFixed(1)}`
    for (let i = 0; i < 500; i++) path += ` L ${(rnd() * 2000).toFixed(1)} ${(rnd() * 1400).toFixed(1)}`
    p.drawSvgPath(path, { x: 0, y: 1400, borderColor: rgb(0, 0, 0), borderWidth: 0.3 })
  }
  return d.save()
}

describe('output size', () => {
  it.each(['source', 'a3'] as const)('%s layout: one sheet is ~1x its drawing, not 2x (the copied donor page is pruned)', async (layout) => {
    const src = await heavyDrawing(10_000, 90)
    const out = await renderStatusPlanPdf(input(src), layout)
    expect(out.byteLength).toBeLessThan(src.byteLength * 1.15 + 20_000)
  })

  it('the same (file, page) drawn twice in one document is embedded once and reused', async () => {
    const src = await heavyDrawing(10_000)
    const doc = await PDFDocument.create()
    const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
    const source = { kind: 'pdf' as const, bytes: src, pageIndex: 1, key: 'org/project/drawing.pdf' }
    await drawStatusPlanPage(doc, input(src, { source }), 'a3', fonts)
    await drawStatusPlanPage(doc, input(src, { source, planName: 'Second plan' }), 'a3', fonts)
    const xobj = (i: number) => {
      const xo = doc.getPage(i).node.Resources()!.lookup(PDFName.of('XObject')) as unknown as { values(): unknown[] }
      return xo.values().map(String)
    }
    expect(xobj(0)).toEqual(xobj(1))
  })
})

describe('unreadable sources fail with a sentence and add no page', () => {
  async function attempt(source: StatusPlanRenderInput['source']) {
    const doc = await PDFDocument.create()
    const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
    const err = await drawStatusPlanPage(doc, input(new Uint8Array(), { source }), 'a3', fonts).then(() => null, (e: unknown) => e)
    return { err, pages: doc.getPageCount() }
  }
  it('not a PDF', async () => {
    const { err, pages } = await attempt({ kind: 'pdf', bytes: new TextEncoder().encode('not a pdf'), pageIndex: 1 })
    expect(err).toBeInstanceOf(StatusPlanSourceError)
    expect((err as Error).message).toBe('the drawing PDF could not be read')
    expect(pages).toBe(0)
  })
  it('page out of range', async () => {
    const { err } = await attempt({ kind: 'pdf', bytes: await sourcePdf(), pageIndex: 3 })
    expect((err as Error).message).toBe('page 3 is not in the drawing (it has 1)')
  })
  it('a corrupt page content stream fails HERE, not later inside the report save()', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([600, 400])
    p.drawRectangle({ x: 1, y: 1, width: 5, height: 5, color: rgb(0, 0, 1) })
    p.node.set(PDFName.of('Contents'), d.context.register(d.context.stream(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), { Filter: 'FlateDecode' })))
    const { err, pages } = await attempt({ kind: 'pdf', bytes: await d.save(), pageIndex: 1 })
    expect((err as Error).message).toBe('page 1 of the drawing could not be embedded')
    expect(pages).toBe(0)
  })
  it('password-protected', async () => {
    const d = await PDFDocument.create()
    d.addPage([200, 200])
    d.context.trailerInfo.Encrypt = d.context.obj({ Filter: 'Standard' })
    const { err } = await attempt({ kind: 'pdf', bytes: await d.save({ useObjectStreams: false }), pageIndex: 1 })
    expect((err as Error).message).toBe('the drawing PDF is password-protected')
  })
})

describe('raster drawings', () => {
  function crc32(buf: Buffer): number {
    let crc = 0xffffffff
    for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1 }
    return (crc ^ 0xffffffff) >>> 0
  }
  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  /** A real w×h RGB PNG — NOT 1×1: a square fixture could not catch a swapped width/height. */
  function png(w: number, h: number): Uint8Array {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
    const raw = Buffer.alloc((w * 3 + 1) * h, 0xff)
    for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0
    return new Uint8Array(Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]))
  }
  it('draws a PNG at 1 px per unit and maps shapes without the ÷2', async () => {
    const shapes = [shape({ points: [100, 50, 300, 50, 300, 150, 100, 150] })]
    const out = await renderStatusPlanPdf(input(new Uint8Array(), { source: { kind: 'png', bytes: png(400, 200) }, shapes }), 'source')
    const { width, height } = await pageInfo(out)
    expect(width).toBeCloseTo(400, 2)
    const [m] = cmBeforeDo(pageStream(out), 'SI')
    expect(m!.slice(0, 4)).toEqual([400, 0, 0, 200])
    const want: Array<[number, number]> = [[100, height - 50], [300, height - 50], [300, height - 150], [100, height - 150]]
    expect(paintedPaths(pageStream(out)).some((p) => p.paint === 'S' && p.closed && samePoints(p.points, want))).toBe(true)
  })
})
