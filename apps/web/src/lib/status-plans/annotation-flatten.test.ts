// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  PDFDocument, PDFName, degrees, fill, rectangle, rgb, setFillingRgbColor,
} from 'pdf-lib'
import { TENANT_LEGEND } from '@esite/shared/status-plans'
import { pdfStreams, pdfAllText, cmBeforeDo, near } from '@/test/pdf-ops'
import { renderStatusPlanPdf, type StatusPlanRenderInput } from './render-plan-page'

type RGB = [number, number, number]
interface AnnotSpec {
  subtype?: string
  flags?: number
  rect: [number, number, number, number]
  bbox?: [number, number, number, number]
  matrix?: [number, number, number, number, number, number]
  colour?: RGB
  states?: { as: string; on: RGB; off: RGB }
  noAp?: boolean
}

const MARK: RGB = [0.11, 0.22, 0.33]
const ON: RGB = [0.44, 0.55, 0.66]
const OFF: RGB = [0.77, 0.88, 0.99]
const op = (c: RGB) => `${c[0]} ${c[1]} ${c[2]} rg`

/** A 600×400 drawing at /Rotate r with annotations whose appearance fills its BBox in a marker colour. */
async function annotatedPdf(r: number, specs: AnnotSpec[]): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([600, 400])
  p.setRotation(degrees(r))
  p.drawRectangle({ x: 500, y: 300, width: 10, height: 10, color: rgb(0, 0, 1) })
  const ctx = d.context
  const ap = (c: RGB, bbox: number[], matrix: number[]) => ctx.register(ctx.formXObject(
    [setFillingRgbColor(c[0], c[1], c[2]), rectangle(bbox[0]!, bbox[1]!, bbox[2]! - bbox[0]!, bbox[3]! - bbox[1]!), fill()],
    { BBox: bbox, Matrix: matrix },
  ))
  const refs = specs.map((s) => {
    const bbox = s.bbox ?? [0, 0, 50, 20]
    const matrix = s.matrix ?? [1, 0, 0, 1, 0, 0]
    const dict: Record<string, unknown> = { Type: 'Annot', Subtype: s.subtype ?? 'Square', Rect: s.rect, F: s.flags ?? 4 }
    if (s.states) {
      dict.AP = { N: { On: ap(s.states.on, bbox, matrix), Off: ap(s.states.off, bbox, matrix) } }
      dict.AS = s.states.as
    } else if (!s.noAp) {
      dict.AP = { N: ap(s.colour ?? MARK, bbox, matrix) }
    }
    return ctx.register(ctx.obj(dict as never))
  })
  p.node.set(PDFName.of('Annots'), ctx.obj(refs))
  return d.save()
}

function input(bytes: Uint8Array): StatusPlanRenderInput {
  return {
    planId: 'p1', sheetId: 'sh1', planName: 'Annotated', sheetLabel: 'Sheet 1', purpose: 'tenant_layout', drawingName: 'a.pdf',
    pageIndex: 1, generatedOn: '2026-10-13', source: { kind: 'pdf', bytes, pageIndex: 1 },
    shapes: [], legend: TENANT_LEGEND, counts: {}, measured: null, warnings: [],
  }
}

function pageStream(bytes: Uint8Array): string {
  const s = pdfStreams(bytes).find((t) => /\/SP[^\s/]*\s+Do/.test(t))
  if (!s) throw new Error('no page content stream drawing the sheet')
  return s
}

/** The `cm` operands between the `q` that opens each annotation group and its `/SA… Do`, in order. */
function annotationGroups(stream: string): number[][][] {
  const lines = stream.split('\n').map((l) => l.trim())
  const out: number[][][] = []
  lines.forEach((l, i) => {
    if (!/^\/SA[^\s/]*\s+Do$/.test(l)) return
    let j = i
    while (j >= 0 && lines[j] !== 'q') j--
    out.push(lines.slice(j, i).filter((x) => /\scm$/.test(x)).map((x) => x.split(/\s+/).slice(0, 6).map(Number)))
  })
  return out
}

const apply = (m: readonly number[], x: number, y: number): [number, number] => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!]
/** Innermost cm first (PDF: the last `cm` applies first), as Do would see it after the form's own Matrix. */
const through = (cms: number[][], x: number, y: number) => cms.slice().reverse().reduce<[number, number]>(([px, py], m) => apply(m, px, py), [x, y])
const has = (bytes: Uint8Array, c: RGB) => pdfStreams(bytes).some((s) => s.includes(op(c)))

describe('annotation appearances are flattened into the plan PDF', () => {
  it.each([0, 90, 180, 270])('/Rotate %i: an identity-Matrix appearance lands on its Rect, through the page placement', async (r) => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(r, [{ rect: [100, 200, 200, 240] }])), 'source')
    const stream = pageStream(out)
    const [page] = cmBeforeDo(stream, 'SP')
    const groups = annotationGroups(stream)
    expect(groups).toHaveLength(1)
    // Corners of the BBox (0,0)…(50,20) must land where the Rect corners (100,200)…(200,240) do on the page.
    const [a0, a1] = through(groups[0]!, 0, 0)
    const [b0, b1] = through(groups[0]!, 50, 20)
    const [e0, e1] = apply(page!, 100, 200)
    const [f0, f1] = apply(page!, 200, 240)
    expect([near(a0, e0), near(a1, e1), near(b0, f0), near(b1, f1)]).toEqual([true, true, true, true])
    expect(has(out, MARK)).toBe(true)
  })

  it.each([0, 90, 180, 270])('/Rotate %i: a rotated appearance Matrix is honoured', async (r) => {
    const M = [0, 1, -1, 0, 20, 0] as [number, number, number, number, number, number]
    const out = await renderStatusPlanPdf(input(await annotatedPdf(r, [{ rect: [100, 200, 140, 300], matrix: M }])), 'source')
    const stream = pageStream(out)
    const [page] = cmBeforeDo(stream, 'SP')
    const [g] = annotationGroups(stream)
    // BBox (0,20) → Matrix → (0,0) = transformed min → Rect min (100,200); BBox (50,0) → (20,50) → Rect max (140,300).
    const [a0, a1] = through(g!, ...apply(M, 0, 20))
    const [b0, b1] = through(g!, ...apply(M, 50, 0))
    const [e0, e1] = apply(page!, 100, 200)
    const [f0, f1] = apply(page!, 140, 300)
    expect([near(a0, e0), near(a1, e1), near(b0, f0), near(b1, f1)]).toEqual([true, true, true, true])
  })

  it('a CropBox that does not start at the origin: the appearance follows the page form\'s own shift and is clipped to the CropBox', async () => {
    const src = await PDFDocument.load(await annotatedPdf(0, [{ rect: [100, 200, 200, 240] }]))
    src.getPage(0).setCropBox(50, 30, 500, 350)
    const out = await renderStatusPlanPdf(input(await src.save()), 'source')
    const stream = pageStream(out)
    const [page] = cmBeforeDo(stream, 'SP')
    const [g] = annotationGroups(stream)
    // The embedded page form carries Matrix [1 0 0 1 -50 -30]: source (x, y) is drawn at page(x − 50, y − 30).
    const [a0, a1] = through(g!, 0, 0)
    const [b0, b1] = through(g!, 50, 20)
    const [e0, e1] = apply(page!, 100 - 50, 200 - 30)
    const [f0, f1] = apply(page!, 200 - 50, 240 - 30)
    expect([near(a0, e0), near(a1, e1), near(b0, f0), near(b1, f1)]).toEqual([true, true, true, true])
    expect(stream).toMatch(/50 30 500 350 re\s+W\s+n/)
  })

  it('the appearance is clipped to the page box', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ rect: [100, 200, 200, 240] }])), 'source')
    expect(pageStream(out)).toMatch(/0 0 600 400 re\s+W\s+n/)
  })

  it('/AS picks the state; an unknown state draws nothing', async () => {
    const off = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ subtype: 'Widget', rect: [10, 10, 60, 30], states: { as: 'Off', on: ON, off: OFF } }])), 'source')
    expect(has(off, OFF)).toBe(true)
    expect(has(off, ON)).toBe(false)
    const unknown = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ subtype: 'Widget', rect: [10, 10, 60, 30], states: { as: 'Maybe', on: ON, off: OFF } }])), 'source')
    expect(annotationGroups(pageStream(unknown))).toHaveLength(0)
  })

  it('Hidden, NoView, Invisible markups, Popup, Link and annotations without an appearance are not drawn', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [
      { rect: [10, 10, 60, 30], flags: 2 },
      { rect: [10, 10, 60, 30], flags: 32 },
      { rect: [10, 10, 60, 30], flags: 1 },
      { rect: [10, 10, 60, 30], subtype: 'Popup' },
      { rect: [10, 10, 60, 30], subtype: 'Link' },
      { rect: [10, 10, 60, 30], noAp: true },
    ])), 'source')
    expect(annotationGroups(pageStream(out))).toHaveLength(0)
    expect(has(out, MARK)).toBe(false) // unreferenced, so pruned
  })

  it('a Widget is drawn (pdf.js paints form fields on the canvas in its default mode), even when Invisible', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ subtype: 'Widget', flags: 1, rect: [10, 10, 60, 30] }])), 'source')
    expect(annotationGroups(pageStream(out))).toHaveLength(1)
  })

  it('flattens, never copies: the output carries no interactive annotation', async () => {
    const out = await renderStatusPlanPdf(input(await annotatedPdf(0, [{ rect: [100, 200, 200, 240] }])), 'a3')
    expect(pdfAllText(out)).not.toMatch(/\/Type\s*\/Annot\b/)
    // pdf-lib gives every page it creates an empty `/Annots [ ]` (pre-existing, pinned by the
    // baseline): what must never appear is a NON-empty one.
    expect(pdfAllText(out)).not.toMatch(/\/Annots\s*\[\s*[^\]\s]/)
    expect(pdfAllText(out)).not.toMatch(/\/Annots\s+\d+\s+\d+\s+R/)
  })
})
