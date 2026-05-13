/**
 * Revision pack ZIP — bundles every export format into a single
 * download so the recipient gets everything in one click.
 *
 * Layout:
 *   {project}-{rev}.xlsx
 *   {project}-{rev}.pdf
 *   csv/schedule.csv
 *   csv/tags.csv
 *   csv/cost.csv
 *   csv/change_log.csv
 *   README.txt          — what the pack contains + when it was generated
 */

import JSZip from 'jszip'
import { renderScheduleWorkbook } from './export-excel'
import { renderRevisionPdf } from './export-pdf'
import { renderCsv } from './export-csv'
import type { ExportPayload } from './export-payload'

export async function renderRevisionZip(
  payload: ExportPayload,
): Promise<Uint8Array> {
  const zip = new JSZip()

  const stem = stemFor(payload)

  // Run xlsx + pdf in parallel — they share no state.
  const [xlsxBuf, pdfBytes] = await Promise.all([
    renderScheduleWorkbook(payload),
    renderRevisionPdf(payload),
  ])

  zip.file(`${stem}.xlsx`, xlsxBuf)
  zip.file(`${stem}.pdf`, pdfBytes)

  const csv = zip.folder('csv')
  if (csv) {
    csv.file('schedule.csv', renderCsv('schedule', payload))
    csv.file('tags.csv', renderCsv('tags', payload))
    csv.file('cost.csv', renderCsv('cost', payload))
    csv.file('change_log.csv', renderCsv('change_log', payload))
  }

  zip.file('README.txt', buildReadme(payload, stem))

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

function stemFor(payload: ExportPayload): string {
  const proj = payload.project.name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  const rev = payload.revision.code.replace(/\s+/g, '').toLowerCase()
  return `${proj}-${rev}`
}

function buildReadme(payload: ExportPayload, stem: string): string {
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const issued = payload.revision.issued_at
    ? payload.revision.issued_at.slice(0, 10)
    : 'not issued (DRAFT)'
  return [
    `CABLE SCHEDULE — REVISION PACK`,
    ``,
    `Project:        ${payload.project.name}`,
    `Revision:       ${payload.revision.code} (${payload.revision.status})`,
    `Issued:         ${issued}`,
    `Generated:      ${generated}`,
    `Sources:        ${payload.sources.length}`,
    `Boards:         ${payload.boards.length}`,
    `Supplies:       ${payload.supplies.length}`,
    `Cables:         ${payload.cables.length}`,
    `Tags:           ${payload.cableTags.length}`,
    ``,
    `Contents`,
    `--------`,
    `${stem}.xlsx     — Schedule grid + cost summary + facts & figures + revision history (4 sheets)`,
    `${stem}.pdf      — Revision pack: cover + schedule grid + cost summary + tag schedule with QR codes`,
    `csv/schedule.csv — One row per cable`,
    `csv/tags.csv     — One row per cable tag (each cable has FROM + TO)`,
    `csv/cost.csv     — Cost breakdown with totals`,
    `csv/change_log.csv — Audit trail`,
    ``,
    `The .xlsx is round-trip safe — it can be re-imported via the E-Site cable`,
    `schedule "Import workbook" flow if you need to fork this revision into a`,
    `new DRAFT in another project.`,
    ``,
  ].join('\r\n')
}
