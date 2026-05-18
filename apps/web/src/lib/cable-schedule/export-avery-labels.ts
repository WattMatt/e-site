/**
 * Standalone Avery L7173 label-sheet PDF document builder. Mirrors
 * renderTagListPdf shape — creates a fresh PDFDocument, embeds
 * Helvetica fonts, calls drawAveryL7173Pages, returns bytes.
 *
 * Empty-state: single-page "no cable tags generated yet" placeholder.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { drawAveryL7173Pages } from './export-pdf'
import type { ExportPayload } from './export-payload'

export async function renderAveryLabelsPdf(payload: ExportPayload): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold)

  if (payload.cableTags.length === 0) {
    const page = pdf.addPage([595.28, 841.89])
    page.drawText('CABLE TAG LABELS (AVERY L7173)', {
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
  } else {
    await drawAveryL7173Pages(pdf, payload, helv, helvB)
  }

  pdf.setTitle(`Cable Tag Labels (Avery L7173) — ${payload.project.name} — ${payload.revision.code}`)
  pdf.setProducer('E-Site v2')
  pdf.setCreationDate(new Date())
  return await pdf.save()
}
