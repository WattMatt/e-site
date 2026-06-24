/**
 * On-device PDF rasteriser — renders a PDF page to an image file so the
 * (image-only) Skia annotator can mark up PDF floor plans. Mobile mirror of
 * apps/web/src/lib/pdf-raster.ts (browser/pdfjs); here we use
 * react-native-pdf-page-image (iOS PDFKit / Android PdfRenderer).
 *
 * Native deps are imported lazily inside loadPdfForRaster so the pure helpers
 * below stay importable under plain-node vitest.
 */
import type { AnnotationData } from '../components/attachments/types'

export interface RasterisedPage {
  uri: string
  width: number
  height: number
}

export interface LoadedPdf {
  numPages: number
  /** Rasterise a 1-based page to an image file URI at the given scale (default 2×). */
  renderPage: (pageNum: number, scale?: number) => Promise<RasterisedPage>
  /** Best-effort cleanup of the downloaded PDF + any temp page images. */
  close: () => Promise<void>
}

/** True if a floor-plan file path / name points at a PDF. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/** True if a floor-plan file path is an image the Skia annotator can load directly. */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|heic|svg)$/i.test(path)
}

/**
 * For a PDF-rasterised markup: stamp the 1-based source page and drop the
 * transient rasterised image from the scene graph (re-edit re-rasterises from
 * the source PDF — we don't persist the large rasterised image). Mirrors the
 * web dialog's save logic.
 */
export function withPdfSource(data: AnnotationData, pageIndex: number): AnnotationData {
  return {
    ...data,
    sourcePageIndex: pageIndex,
    baseImage: { ...data.baseImage, signedUrl: undefined },
  }
}

/** Download a (signed) PDF URL and prepare it for page rasterisation. */
export async function loadPdfForRaster(signedUrl: string): Promise<LoadedPdf> {
  const FileSystem = await import('expo-file-system')
  const { default: PdfPageImage } = await import('react-native-pdf-page-image')

  // Native renderers want a local file path, not a tokenised remote URL.
  const localPath = `${FileSystem.cacheDirectory}floorplan-${Date.now()}.pdf`
  const { uri: localUri } = await FileSystem.downloadAsync(signedUrl, localPath)

  const { pageCount } = await PdfPageImage.open(localUri)

  return {
    numPages: pageCount,
    async renderPage(pageNum, scale = 2) {
      const { uri, width, height } = await PdfPageImage.generate(localUri, pageNum, scale)
      return { uri, width, height }
    },
    async close() {
      try { await PdfPageImage.close(localUri) } catch { /* best effort */ }
      try { await FileSystem.deleteAsync(localUri, { idempotent: true }) } catch { /* best effort */ }
    },
  }
}
