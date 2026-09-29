'use client'
/**
 * One page of a stored tariff PDF, rendered in the browser with pdfjs from a
 * short-lived signed URL, with the cited text outlined (findTextBox) and
 * scrolled into view. Minimal local pdfjs types, as lib/sheet/use-sheet-image.
 */
import { useEffect, useRef, useState } from 'react'
import { findTextBox, type PdfTextItem } from '@esite/shared'

type Viewport = { width: number; height: number; convertToViewportRectangle: (r: number[]) => number[] }
type PdfPage = {
  getViewport: (o: { scale: number }) => Viewport
  render: (o: unknown) => { promise: Promise<void> }
  getTextContent: () => Promise<{ items: unknown[] }>
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> }

export function PdfPageCrop({ url, page, highlight }: { url: string; page: number; highlight: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMessage(null)
    ;(async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const pdf = (await pdfjsLib.getDocument(url).promise) as unknown as PdfDoc
        if (cancelled) return
        if (page > pdf.numPages) {
          setMessage(`The document has ${pdf.numPages} pages; the cited page ${page} does not exist.`)
          return
        }
        const p = await pdf.getPage(page)
        const viewport = p.getViewport({ scale: 1.5 })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        await p.render({ canvasContext: ctx, viewport, canvas }).promise
        if (highlight) {
          const text = await p.getTextContent()
          const box = findTextBox(text.items as PdfTextItem[], highlight)
          if (box) {
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([box.x, box.y, box.x + box.width, box.y + box.height])
            const top = Math.min(y1, y2)
            ctx.save()
            ctx.strokeStyle = '#f59e0b'
            ctx.lineWidth = 3
            ctx.strokeRect(Math.min(x1, x2) - 4, top - 4, Math.abs(x2 - x1) + 8, Math.abs(y2 - y1) + 8)
            ctx.restore()
            boxRef.current?.scrollTo({ top: Math.max(0, top - 120) })
          } else {
            setMessage('The cited text was not found on this page: check the page by eye.')
          }
        }
      } catch {
        if (!cancelled) setMessage('The source document could not be displayed.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [url, page, highlight])

  return (
    <div>
      {loading && <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>Rendering page {page}…</p>}
      {message && <p role="status" style={{ fontSize: 13, color: 'var(--c-amber)' }}>{message}</p>}
      <div ref={boxRef} style={{ maxHeight: '65vh', overflow: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
        <canvas ref={canvasRef} aria-label={`Page ${page} of the source document`} />
      </div>
    </div>
  )
}
