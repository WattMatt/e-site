import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { renderLegendCardPdf, type LegendCardPayload } from './render-legend-card'

function payload(circuitCount: number): LegendCardPayload {
  return {
    projectName: 'KINGSWALK',
    shopNumber: '12A',
    shopName: 'Test Tenant',
    dbCode: 'DB-12A',
    mainBreaker: '63 A TP',
    header: { location: 'Back of shop', fedFrom: 'MAIN BOARD 1.1', earthLeakageMa: 30 },
    circuits: Array.from({ length: circuitCount }, (_, i) => ({
      circuit_no: String(i + 1),
      description: i % 3 === 0 ? null : `Circuit ${i + 1}`,
      phase: 'L1' as const,
      breaker_rating_a: 20,
      poles: 1 as const,
      curve: 'C' as const,
      cable_size: '2.5mm²',
      is_spare: i % 3 === 0,
    })),
    generatedAt: '2026-07-08',
  }
}

describe('renderLegendCardPdf', () => {
  it('renders a single A4 portrait page for a small board', async () => {
    const bytes = await renderLegendCardPdf(payload(12), 'A4')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(595.28, 1)
    expect(height).toBeCloseTo(841.89, 1)
  })

  it('renders A5 portrait when size is A5', async () => {
    const bytes = await renderLegendCardPdf(payload(12), 'A5')
    const doc = await PDFDocument.load(bytes)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(419.53, 1)
    expect(height).toBeCloseTo(595.28, 1)
  })

  it('paginates when circuits exceed one page', async () => {
    const bytes = await renderLegendCardPdf(payload(120), 'A5')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })

  it('renders an empty board without throwing', async () => {
    const bytes = await renderLegendCardPdf(payload(0), 'A4')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('clips a very long header value without throwing and stays single-page on A5', async () => {
    const p = payload(5)
    p.header.location = 'A'.repeat(90)
    const bytes = await renderLegendCardPdf(p, 'A5')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('accepts a branding accent override and stays monochrome (accent plumbed per C1, not yet drawn)', async () => {
    // The card is deliberately monochrome (greys only — it prints on a DB-door
    // sticker), so today the accent is carried by the payload but consumed by
    // no element. This pins both halves of that contract: the override is
    // accepted, and it changes nothing until accent furniture is added.
    const p = payload(5)
    p.accent = '#336699' // → rgb(0.2, 0.4, 0.6) via lib/reports/pdf-accent
    const bytes = await renderLegendCardPdf(p, 'A4')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    let text = ''
    for (const page of doc.getPages()) {
      const contents = page.node.Contents()
      if (!contents) continue
      const items = contents instanceof PDFArray ? contents.asArray() : [contents]
      for (const item of items) {
        const stream = page.node.context.lookup(item)
        if (stream instanceof PDFRawStream) {
          text += new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
        }
      }
    }
    expect(text).not.toContain('0.2 0.4 0.6 rg')
  })
})
