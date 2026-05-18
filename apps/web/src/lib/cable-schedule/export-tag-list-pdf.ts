/**
 * Standalone tag-list PDF document builder. Wraps the drawTagListPages
 * renderer from export-pdf.ts into a self-contained PDFDocument that the
 * tag-list API route can stream directly without pulling in the full
 * revision-pack rendering pipeline (cover + schedule + cost + tag cards).
 *
 * Empty-state behaviour: when the revision has zero cable_tags, returns
 * a single-page PDF with a "No cable tags have been generated yet" notice
 * rather than a zero-page document (pdf-lib's save() rejects zero-page
 * documents and we want callers to always get a valid PDF).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { drawTagListPages } from './export-pdf'
import type { ExportPayload } from './export-payload'

export async function renderTagListPdf(payload: ExportPayload): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold)

  if (payload.cableTags.length === 0) {
    // Single-page placeholder so the caller always gets a non-empty PDF.
    // pdf-lib's save() requires at least one page.
    const page = pdf.addPage([595.28, 841.89])
    page.drawText('CABLE TAG SCHEDULE', {
      x: 42.5,
      y: 841.89 - 42.5 - 16,
      size: 12,
      font: helvB,
      color: rgb(0.11, 0.11, 0.11),
    })
    page.drawText(`${payload.project.name}  ·  Rev ${payload.revision.code} (${payload.revision.status})`, {
      x: 42.5,
      y: 841.89 - 42.5 - 32,
      size: 8,
      font: helv,
      color: rgb(0.3, 0.3, 0.3),
    })
    page.drawText('No cable tags have been generated for this revision yet.', {
      x: 42.5,
      y: 841.89 / 2,
      size: 10,
      font: helv,
      color: rgb(0.4, 0.4, 0.4),
    })
    page.drawText('Generate tags from the cable-tag-schedule page, then re-download.', {
      x: 42.5,
      y: 841.89 / 2 - 16,
      size: 9,
      font: helv,
      color: rgb(0.5, 0.5, 0.5),
    })
  } else {
    await drawTagListPages(pdf, payload, helv, helvB)
  }

  pdf.setTitle(`Cable Tag Schedule — ${payload.project.name} — ${payload.revision.code}`)
  pdf.setProducer('E-Site v2')
  pdf.setCreationDate(new Date())
  return await pdf.save()
}
