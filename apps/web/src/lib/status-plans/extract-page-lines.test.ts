// @vitest-environment node
// pdf.js legacy build + pdf-lib bytes: jsdom's Uint8Array is a different realm.
import { describe, it, expect } from 'vitest'
import {
  PDFDocument,
  concatTransformationMatrix,
  degrees,
  drawObject,
  endPath,
  clip,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  stroke,
} from 'pdf-lib'
import type { LineSegment } from '@esite/shared/status-plans'
import { extractPageLines, MIN_SEGMENT_PX } from './extract-page-lines'
import { IMAGE_SPACE_SCALE, extractPageText, type PdfjsModule } from './extract-page-text'

const legacy = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule

async function linesOf(bytes: Uint8Array, opts?: { maxSegments?: number }): Promise<LineSegment[]> {
  const pdfjs = (await legacy()) as unknown as {
    getDocument: (s: Record<string, unknown>) => { promise: Promise<{ getPage: (n: number) => Promise<never>; destroy: () => Promise<void> }> }
    OPS: Record<string, number>
  }
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise
  try {
    const page = (await doc.getPage(1)) as unknown as { getViewport: (o: { scale: number }) => { transform: number[] } } & Parameters<typeof extractPageLines>[0]
    const t = page.getViewport({ scale: IMAGE_SPACE_SCALE }).transform
    return await extractPageLines(page, [t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!], pdfjs.OPS, opts)
  } finally {
    await doc.destroy()
  }
}

const sortLines = (ls: LineSegment[]) =>
  ls.map((l) => ({ ...l, at: Math.round(l.at * 100) / 100, from: Math.round(l.from * 100) / 100, to: Math.round(l.to * 100) / 100 }))
    .sort((a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.from - b.from)

describe('extractPageLines', () => {
  it('reads a stroked rectangle on an upright page as its four sides in image space', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.drawRectangle({ x: 50, y: 100, width: 100, height: 60, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    const lines = sortLines(await linesOf(await doc.save()))
    // raster x = 2·userX; raster y = (400 − userY)·2
    expect(lines).toEqual([
      { axis: 'h', at: 480, from: 100, to: 300 },
      { axis: 'h', at: 600, from: 100, to: 300 },
      { axis: 'v', at: 100, from: 480, to: 600 },
      { axis: 'v', at: 300, from: 480, to: 600 },
    ])
  })

  it('/Rotate 90: a horizontal user-space line is a vertical image line', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.setRotation(degrees(90))
    page.drawLine({ start: { x: 50, y: 60 }, end: { x: 150, y: 60 }, thickness: 1, color: rgb(0, 0, 0) })
    // On the rotated raster: x = 2·userY, y = 2·userX.
    expect(sortLines(await linesOf(await doc.save()))).toEqual([{ axis: 'v', at: 120, from: 100, to: 300 }])
  })

  it('follows q / cm / Q: a line drawn inside a scaled, shifted state lands where it is drawn; the state ends at Q', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(2, 0, 0, 2, 10, 20),
      moveTo(10, 10), lineTo(60, 10), stroke(), // user (30,40)–(130,40)
      popGraphicsState(),
      moveTo(10, 10), lineTo(10, 60), stroke(), // untransformed
    )
    expect(sortLines(await linesOf(await doc.save()))).toEqual([
      { axis: 'h', at: 720, from: 60, to: 260 },
      { axis: 'v', at: 20, from: 680, to: 780 },
    ])
  })

  it('follows a form XObject’s matrix (an embedded block placed and scaled on the sheet)', async () => {
    const src = await PDFDocument.create()
    const p = src.addPage([200, 100])
    p.drawLine({ start: { x: 0, y: 50 }, end: { x: 100, y: 50 }, thickness: 1, color: rgb(0, 0, 0) })
    const doc = await PDFDocument.create()
    const [form] = await doc.embedPdf(await src.save())
    const page = doc.addPage([600, 400])
    page.drawPage(form!, { x: 100, y: 100, xScale: 0.5, yScale: 0.5 })
    // user: x 100..150 at y 100 + 25 = 125 → raster y = (400 − 125)·2 = 550
    expect(sortLines(await linesOf(await doc.save()))).toEqual([{ axis: 'h', at: 550, from: 200, to: 300 }])
  })

  it('applies the form’s own /Matrix as well as the placement', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    // Form content draws (0,0)–(50,0); its /Matrix scales ×2 and shifts to (100, 200).
    const form = doc.context.formXObject([moveTo(0, 0), lineTo(50, 0), stroke()], {
      BBox: [-10, -10, 100, 100],
      Matrix: [2, 0, 0, 2, 100, 200],
    })
    const name = page.node.newXObject('Fm', doc.context.register(form))
    page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState())
    // user (100,200)–(200,200) → raster x 200..400, y (400 − 200)·2 = 400
    expect(sortLines(await linesOf(await doc.save()))).toEqual([{ axis: 'h', at: 400, from: 200, to: 400 }])
  })

  it('leaves out clipping paths, diagonals and specks', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.pushOperators(
      rectangle(0, 0, 300, 300), clip(), endPath(),
      moveTo(10, 10), lineTo(200, 120), stroke(),
      moveTo(300, 300), lineTo(300 + MIN_SEGMENT_PX / 2 / 2, 300), stroke(),
    )
    expect(await linesOf(await doc.save())).toEqual([])
  })

  it('stops collecting at the cap instead of running away on a huge sheet', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    for (let i = 0; i < 20; i++) page.drawLine({ start: { x: 10, y: 10 + i * 10 }, end: { x: 300, y: 10 + i * 10 }, thickness: 1, color: rgb(0, 0, 0) })
    expect(await linesOf(await doc.save(), { maxSegments: 5 })).toHaveLength(5)
  })

  it('never throws: a page whose operator list fails yields no lines', async () => {
    const broken = { getOperatorList: () => Promise.reject(new Error('worker died')) }
    await expect(extractPageLines(broken, [2, 0, 0, -2, 0, 800], { constructPath: 91 })).resolves.toEqual([])
    const garbage = { getOperatorList: () => Promise.resolve({ fnArray: [91, 91], argsArray: [null, [20, ['nope'], null]] as unknown[] }) }
    await expect(extractPageLines(garbage, [2, 0, 0, -2, 0, 800], { constructPath: 91 })).resolves.toEqual([])
  })

  it('without the pdf.js operator table there is nothing to read', async () => {
    const page = { getOperatorList: () => Promise.resolve({ fnArray: [], argsArray: [] }) }
    await expect(extractPageLines(page, [1, 0, 0, 1, 0, 0], undefined)).resolves.toEqual([])
  })
})

describe('extractPageText carries the page lines', () => {
  it('returns the table lines beside the text, in the same image space', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.drawRectangle({ x: 50, y: 100, width: 100, height: 60, borderColor: rgb(0, 0, 0), borderWidth: 1 })
    const res = await extractPageText({ data: await doc.save() }, 1, legacy)
    if (!res.ok) throw new Error(res.error)
    expect(sortLines(res.lines)).toHaveLength(4)
    expect(sortLines(res.lines)[0]).toEqual({ axis: 'h', at: 480, from: 100, to: 300 })
  })
})
