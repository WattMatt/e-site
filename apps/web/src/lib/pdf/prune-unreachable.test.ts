// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'
import { pruneUnreachableObjects } from './prune-unreachable'

/** Line work that does not compress away: ~`segments` random line-tos. */
async function heavyDrawing(segments: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([2000, 1400])
  let seed = 11
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let k = 0; k < segments / 500; k++) {
    let path = `M ${(rnd() * 2000).toFixed(1)} ${(rnd() * 1400).toFixed(1)}`
    for (let i = 0; i < 500; i++) path += ` L ${(rnd() * 2000).toFixed(1)} ${(rnd() * 1400).toFixed(1)}`
    p.drawSvgPath(path, { x: 0, y: 1400, borderColor: rgb(0, 0, 0), borderWidth: 0.3 })
  }
  return d.save()
}

describe('pruneUnreachableObjects', () => {
  it('drops the page copy pdf-lib leaves behind after embedPage — the output is ~1x the drawing, not 2x', async () => {
    const src = await heavyDrawing(10_000)
    const embedOnce = async (prune: boolean) => {
      const doc = await PDFDocument.create()
      const [emb] = await doc.embedPdf(src, [0])
      doc.addPage([2000, 1400]).drawPage(emb!)
      if (prune) await pruneUnreachableObjects(doc)
      return doc.save()
    }
    const before = await embedOnce(false)
    const after = await embedOnce(true)
    // The defect being fixed: without the prune the copied content stream rides along unreferenced.
    expect(before.byteLength).toBeGreaterThan(src.byteLength * 1.8)
    expect(after.byteLength).toBeLessThan(src.byteLength * 1.15 + 4_000)
  })

  it('keeps everything the page tree, fonts and info dictionary reach', async () => {
    const doc = await PDFDocument.create()
    doc.setTitle('Kept title')
    const font = await doc.embedFont(StandardFonts.HelveticaBold)
    doc.addPage([300, 200]).drawText('PAGE ONE', { x: 10, y: 10, size: 12, font })
    doc.addPage([300, 200]).drawText('PAGE TWO', { x: 10, y: 10, size: 12, font })
    const orphan = doc.context.register(doc.context.stream(new Uint8Array(5000).fill(65)))
    const removed = await pruneUnreachableObjects(doc)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(doc.context.lookup(orphan)).toBeUndefined()
    const back = await PDFDocument.load(await doc.save())
    expect(back.getPageCount()).toBe(2)
    expect(back.getTitle()).toBe('Kept title')
    const fonts = back.getPage(1).node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
    const font0 = fonts.lookup(fonts.keys()[0]!, PDFDict)
    expect(font0.get(PDFName.of('BaseFont'))?.toString()).toBe('/Helvetica-Bold')
  })
})
