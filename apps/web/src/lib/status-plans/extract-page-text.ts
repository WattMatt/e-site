/**
 * Read one drawing page's text layer into image space (spec §5, slice 3).
 *
 * Browser: pdfjs-dist with the worker at /pdf.worker.min.mjs, exactly as
 * lib/sheet/use-sheet-image.ts loads it. Tests inject the Node legacy build.
 * The viewport is built at IMAGE_SPACE_SCALE, the scale use-sheet-image
 * rasterises at (pinned by a contract test), and its transform carries the
 * page's /Rotate — so rotation is matrix maths, never a special case.
 */
import { textItemsToImageSpace, type ImageTextItem, type Matrix } from '@esite/shared/status-plans'

/** Must equal the scale in lib/sheet/use-sheet-image.ts (pinned by a test). */
export const IMAGE_SPACE_SCALE = 2

type PdfViewport = { width: number; height: number; transform: number[] }
type PdfPage = {
  getViewport: (o: { scale: number }) => PdfViewport
  getTextContent: () => Promise<{ items: unknown[] }>
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> }
export type PdfjsModule = {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> }
  GlobalWorkerOptions?: { workerSrc: string }
}

async function browserPdfjs(): Promise<PdfjsModule> {
  const lib = await import('pdfjs-dist')
  if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  return lib as unknown as PdfjsModule
}

export type PageTextResult =
  | { ok: true; items: ImageTextItem[]; rawItemCount: number; width: number; height: number }
  | { ok: false; error: string }

export async function extractPageText(
  source: { url: string } | { data: Uint8Array },
  pageIndex: number,
  loadPdfjs: () => Promise<PdfjsModule> = browserPdfjs,
): Promise<PageTextResult> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({
    ...('url' in source ? { url: source.url } : { data: source.data }),
    disableFontFace: true,
    verbosity: 0,
  }).promise
  try {
    if (!Number.isInteger(pageIndex) || pageIndex < 1 || pageIndex > doc.numPages) {
      const pages = doc.numPages === 1 ? '1 page' : `${doc.numPages} pages`
      return { ok: false, error: `This drawing has ${pages}; page ${pageIndex} does not exist.` }
    }
    const page = await doc.getPage(pageIndex)
    const viewport = page.getViewport({ scale: IMAGE_SPACE_SCALE })
    const content = await page.getTextContent()
    const t = viewport.transform
    const matrix: Matrix = [t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!]
    const items = textItemsToImageSpace(content.items, matrix)
    return { ok: true, items, rawItemCount: content.items.length, width: viewport.width, height: viewport.height }
  } finally {
    await doc.destroy()
  }
}
