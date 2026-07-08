import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
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
})
