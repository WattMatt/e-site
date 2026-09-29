// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { JPEG_1PX } from '@/test/fixtures/jpeg-1px'
import { renderSchematicSheetPdf } from './sheet-pdf'

describe('renderSchematicSheetPdf', () => {
  it('renders an A3 landscape sheet and survives non-WinAnsi text (Ω, ≤, →)', async () => {
    const bytes = await renderSchematicSheetPdf({
      jpegBase64: JPEG_1PX, imageWidthPx: 1000, imageHeightPx: 700, projectName: 'Mall Ω', schematicName: 'MV → LV ≤ 11 kV',
      sourceLabel: 'SLD · page 2', version: 3, dateIso: '2026-09-28',
      legend: Array.from({ length: 50 }, (_, k) => ({ label: `Meter ${k}`, kind: 'tenant', tenant: `Shop ${k}`, included: k % 2 === 0 })),
      connections: 12, warnings: ['The drawing changed since this schematic was drawn.'],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]
    expect(Math.round(w)).toBe(1191)
    expect(Math.round(h)).toBe(842)
  })
  it('puts every drawn string through winAnsiSafe (pdf-lib throws on the first unmapped glyph)', async () => {
    // A hostile string in EVERY text field: if any one draw site skips the sanitiser, pdf-lib throws.
    const X = 'MΩ ≤ → ✓\nnext'
    await expect(renderSchematicSheetPdf({
      jpegBase64: JPEG_1PX, imageWidthPx: 10, imageHeightPx: 10, projectName: X, schematicName: X,
      sourceLabel: X, version: 1, dateIso: X,
      legend: [{ label: X, kind: X, tenant: X, included: true }, { label: X, kind: X, tenant: null, included: null }],
      connections: 0, warnings: [X],
    })).resolves.toBeInstanceOf(Uint8Array)
  })
})
