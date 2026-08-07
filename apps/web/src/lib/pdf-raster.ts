/**
 * Client-side PDF rasteriser — renders a PDF page to a PNG data URL so the
 * (image-only) Konva annotator can mark up PDF floor plans.
 *
 * Extracted from the proven path in floor-plans/[planId]/MarkupCanvas.tsx so
 * the attach-markup flow and the detail-page markup share one implementation.
 * Browser-only (uses document/canvas + pdfjs worker). Call from 'use client'.
 */

export interface RasterisedPage {
  dataUrl: string
  width: number
  height: number
}

export interface LoadedPdf {
  numPages: number
  /** Rasterise a 1-based page to a PNG data URL at the given scale (default 2×). */
  renderPage: (pageNum: number, scale?: number) => Promise<RasterisedPage>
}

type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number }
  render: (opts: unknown) => { promise: Promise<void> }
}

/** Load a PDF (by URL) ready for page rasterisation. */
export async function loadPdfForRaster(url: string): Promise<LoadedPdf> {
  const pdfjsLib = await import('pdfjs-dist')
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  }
  const pdf = await pdfjsLib.getDocument(url).promise

  return {
    numPages: pdf.numPages,
    async renderPage(pageNum, scale = 2) {
      const page = (await pdf.getPage(pageNum)) as unknown as PdfPage
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d context unavailable')
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
    },
  }
}

/** True if a floor-plan file path / name points at a PDF. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/** True if a floor-plan file path is a raster/vector image the annotator can load directly. */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|heic|svg)$/i.test(path)
}
