// Static half of the report layout rules (docs/reports/pdf-layout-rules.md). The drawn-geometry
// half is pdf-layout.render.test.ts. Each rule names the defect it stops.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : walk(p)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

const files = walk(SRC).map((p) => ({ rel: path.relative(SRC, p), text: readFileSync(p, 'utf8') }))
const pdfFiles = files.filter((f) => f.text.includes("from '@react-pdf/renderer'"))

/**
 * Files allowed to draw <Image> directly, and why. Photos go through ReportPhotoGrid; these are
 * logos, signatures and annexure thumbnails, each in a bounded box with objectFit 'contain'.
 */
const IMAGE_ALLOWED: Record<string, string> = {
  'lib/reports/photo-grid.tsx': 'the photo grid itself',
  'lib/reports/components.tsx': 'cover issuer + party logos',
  'lib/reports/interior.tsx': 'running header/footer logos, signature image, annexure thumbnails',
  'lib/reports/site-form-report.tsx': 'signature images',
}

describe('PDF report layout rules', () => {
  it('finds the react-pdf report files (guards the scanner itself)', () => {
    const rels = pdfFiles.map((f) => f.rel)
    expect(rels).toContain('lib/reports/qc-report.tsx')
    expect(rels).toContain('lib/reports/snag-visit-report.tsx')
    expect(rels).toContain('lib/reports/photo-grid.tsx')
  })

  it("never uses objectFit 'cover' — it crops away most of a portrait photo", () => {
    const offenders = pdfFiles.filter((f) => /objectFit:\s*['"]cover['"]/.test(f.text)).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('draws photos only through ReportPhotoGrid', () => {
    const offenders = pdfFiles
      .filter((f) => /<Image\b/.test(f.text) && !(f.rel in IMAGE_ALLOWED))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('the photo grid never uses flexWrap — a wrapped row is drawn past the page bottom', () => {
    const grid = pdfFiles.find((f) => f.rel === 'lib/reports/photo-grid.tsx')!
    const code = grid.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/flexWrap/)
  })

  it('embeds photos downscaled (photoToReportDataUri / toReportJpeg), never as raw camera bytes', () => {
    // A photo bucket handed to a raw base64 helper embeds the camera original: QC Report 1 was
    // 12 MB for 40 photos.
    const offenders = files
      .filter((f) => /fileToDataUri\([^)]*PHOTO/i.test(f.text))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})
