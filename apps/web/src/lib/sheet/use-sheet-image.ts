'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** What a sheet is drawn from: a decoded raster, or a PDF page rasterised to a canvas. */
export type SheetBacking = HTMLImageElement | HTMLCanvasElement

export function backingSize(b: SheetBacking | null): [number, number] {
  if (!b) return [0, 0]
  return b instanceof HTMLImageElement ? [b.naturalWidth, b.naturalHeight] : [b.width, b.height]
}

type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number }
  render: (opts: unknown) => { promise: Promise<void> }
}
type PdfDoc = { getPage: (n: number) => Promise<unknown>; numPages: number }

/**
 * Load a sheet: a raster image, or a PDF rasterised page by page via
 * pdfjs-dist. Shared by the markup canvas and the cable-route canvas.
 *
 * Image space is what every stored coordinate is in — markup shapes, route
 * legs, calibration points. It is defined here and only here: a PDF page is
 * rasterised at `getViewport({ scale: 2 })` (fixed, not DPR-dependent) and a
 * raster at its natural size, so image space is identical across devices and
 * sessions. Changing that scale would silently move every saved coordinate.
 *
 * The signed URL is read through a ref: every server render re-mints it, and
 * only a DIFFERENT drawing (a new `planId`) may reload the sheet. Rasterising
 * an A1 takes 20-60 s; a reload after each save would blank the sheet.
 */
export function useSheetImage({
  planId,
  signedUrl,
  isPdf,
  initialPage = 1,
}: {
  planId: string
  signedUrl: string | null
  isPdf: boolean
  /** The page to open on (1-based). Changing it reloads, like a new drawing. */
  initialPage?: number
}) {
  const [img, setImg] = useState<SheetBacking | null>(null)
  const signedUrlRef = useRef<string | null>(signedUrl)
  signedUrlRef.current = signedUrl
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [pageCount, setPageCount] = useState(1)
  const pdfDocRef = useRef<PdfDoc | null>(null)
  const pageImagesRef = useRef<Map<number, HTMLCanvasElement>>(new Map())

  // Rasterise a 1-based PDF page to a backing canvas, memoise it, and show it.
  const renderPdfPage = useCallback(async (pageNum: number, signal: { cancelled: boolean }) => {
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
  }, [])

  // 1) Initial load: raster vs PDF; page 1 (or `initialPage`) rendered inline
  //    so a single-page PDF does not wait on an effect keyed on pageCount.
  useEffect(() => {
    const url = signedUrlRef.current
    if (!url) return
    const signal = { cancelled: false }
    setLoadError(null)
    setImg(null)
    setCurrentPage(initialPage)
    pdfDocRef.current = null
    pageImagesRef.current = new Map()

    if (isPdf) {
      ;(async () => {
        try {
          const pdfjsLib = await import('pdfjs-dist')
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
          }
          const pdf = await pdfjsLib.getDocument(url).promise
          if (signal.cancelled) return
          pdfDocRef.current = pdf as unknown as PdfDoc
          setPageCount(pdf.numPages)
          await renderPdfPage(Math.min(Math.max(1, initialPage), pdf.numPages), signal)
        } catch (err) {
          if (signal.cancelled) return
          setLoadError(err instanceof Error ? err.message : 'PDF load failed')
        }
      })()
    } else {
      setPageCount(1)
      const i = new window.Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => { if (!signal.cancelled) setImg(i) }
      i.onerror = () => { if (!signal.cancelled) setLoadError('Image failed to load') }
      i.src = url
    }
    return () => { signal.cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, isPdf, renderPdfPage, initialPage])

  // 2) Re-render when the user moves to another PDF page. The null-check skips
  //    this until the document is ready; going back hits the page cache.
  useEffect(() => {
    if (!isPdf) return
    if (!pdfDocRef.current) return
    const signal = { cancelled: false }
    renderPdfPage(currentPage, signal).catch((err) => {
      if (signal.cancelled) return
      setLoadError(err instanceof Error ? err.message : 'PDF page render failed')
    })
    return () => { signal.cancelled = true }
  }, [isPdf, currentPage, renderPdfPage])

  return { img, loadError, currentPage, setCurrentPage, pageCount }
}
