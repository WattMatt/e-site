/**
 * Test helper: where every image in a rendered PDF is ACTUALLY drawn.
 *
 * Text-layer tests cannot see a layout fault: a photo drawn under the footer or
 * below the paper edge is still "in the PDF" (QC Report 1, Steyns house,
 * 2026-11-05: 40 of 40 photos were in the file, three were invisible on paper,
 * and every text assertion passed). This walks each page's operator list,
 * tracks the transform matrix, and returns each image's box in points, top-down.
 *
 * Node + tests only (pdfjs legacy build).
 */

export interface DrawnImage {
  page: number
  /** Top-left x/y and size in pt, y measured from the TOP of the page. */
  x: number
  y: number
  w: number
  h: number
  /** Pixel size of the embedded image. */
  pxW: number
  pxH: number
}

export interface PageBox {
  page: number
  width: number
  height: number
}

type M = [number, number, number, number, number, number]
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
]

export async function auditPdfImages(buf: Uint8Array): Promise<{ pages: PageBox[]; images: DrawnImage[] }> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(buf), disableFontFace: true, verbosity: 0 }).promise
  const pages: PageBox[] = []
  const images: DrawnImage[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const [, , pw, ph] = page.view
      pages.push({ page: n, width: pw, height: ph })
      const ops = await page.getOperatorList()
      let ctm: M = [1, 0, 0, 1, 0, 0]
      const stack: M[] = []
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        const args = ops.argsArray[i] as unknown[]
        if (fn === OPS.save) stack.push(ctm)
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
        else if (fn === OPS.transform) ctm = mul(args as M, ctm)
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm)
          if (Array.isArray(args[0])) ctm = mul(args[0] as M, ctm)
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          // The image fills the unit square under the current matrix.
          const pts = [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]])
          const xs = pts.map((p) => p[0])
          const ys = pts.map((p) => p[1])
          const x0 = Math.min(...xs)
          const x1 = Math.max(...xs)
          const y0 = Math.min(...ys)
          const y1 = Math.max(...ys)
          const pxW = fn === OPS.paintImageXObject ? Number(args[1]) : Number((args[0] as { width?: number })?.width)
          const pxH = fn === OPS.paintImageXObject ? Number(args[2]) : Number((args[0] as { height?: number })?.height)
          images.push({ page: n, x: x0, y: ph - y1, w: x1 - x0, h: y1 - y0, pxW, pxH })
        }
      }
    }
  } finally {
    await doc.destroy()
  }
  return { pages, images }
}

/**
 * The layout faults the rules forbid, as sentences (empty = clean):
 *  - an image drawn outside [top, height - bottom] (under the footer or off the page),
 *  - two images on one page overlapping,
 *  - an image drawn at a different aspect ratio from its pixels (stretched),
 *  - with `frame`, a photo that does not fill its frame in either direction
 *    (react-pdf squeezed it into the space left at a page foot).
 * `minArea` skips logos and other small marks from the overlap check.
 */
export function layoutFaults(
  audit: { pages: PageBox[]; images: DrawnImage[] },
  opts: { top: number; bottom: number; minArea?: number; frame?: { height: number; minWidth: number } },
): string[] {
  const faults: string[] = []
  const eps = 0.5
  for (const img of audit.images) {
    if (opts.frame && img.h < opts.frame.height - 1 && img.w < opts.frame.minWidth - 1) {
      faults.push(`page ${img.page}: photo drawn ${img.w.toFixed(0)}×${img.h.toFixed(0)} pt, smaller than its ${opts.frame.height} pt frame (squeezed)`)
    }
    const page = audit.pages[img.page - 1]
    if (img.y < opts.top - eps || img.y + img.h > page.height - opts.bottom + eps || img.x < -eps || img.x + img.w > page.width + eps) {
      faults.push(`page ${img.page}: image at y ${img.y.toFixed(1)}–${(img.y + img.h).toFixed(1)} pt is outside the printable area`)
    }
    if (img.pxW > 0 && img.pxH > 0) {
      const drawn = img.w / img.h
      const source = img.pxW / img.pxH
      if (Math.abs(drawn - source) / source > 0.02) {
        faults.push(`page ${img.page}: image drawn at ${drawn.toFixed(2)}:1 from a ${source.toFixed(2)}:1 source (stretched)`)
      }
    }
  }
  const big = audit.images.filter((i) => i.w * i.h >= (opts.minArea ?? 2500))
  for (let a = 0; a < big.length; a++) {
    for (let b = a + 1; b < big.length; b++) {
      const p = big[a]
      const q = big[b]
      if (p.page !== q.page) continue
      const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)
      const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y)
      if (ox > eps && oy > eps) faults.push(`page ${p.page}: two images overlap`)
    }
  }
  return faults
}
