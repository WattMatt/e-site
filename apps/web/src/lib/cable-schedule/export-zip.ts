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
import { exportFilenameStem } from './export-filename'
import type { ExportPayload } from './export-payload'

export async function renderRevisionZip(
  payload: ExportPayload,
): Promise<Uint8Array> {
  const zip = new JSZip()

  const stem = exportFilenameStem(payload)

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
    // Cost CSV omitted entirely for redacted (client_viewer) exports —
    // README explains the omission. See redactPayloadCost in export-role.ts.
    if (!payload.costRedacted) csv.file('cost.csv', renderCsv('cost', payload))
    csv.file('change_log.csv', renderCsv('change_log', payload))
  }

  zip.file('README.txt', buildReadme(payload, stem))

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

function buildReadme(payload: ExportPayload, stem: string): string {
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const issued = payload.revision.issued_at
    ? payload.revision.issued_at.slice(0, 10)
    : 'not issued (DRAFT)'
  const vatPct = payload.revision.vat_pct ?? 15
  let statusLine: string
  if (payload.revision.status === 'DRAFT') {
    statusLine = '⚠ DRAFT revision — not yet issued. Values may change.'
  } else if (payload.revision.status === 'SUPERSEDED') {
    statusLine = 'SUPERSEDED — historical revision, see latest issued.'
  } else {
    statusLine = 'ISSUED revision — frozen snapshot.'
  }
  const redacted = !!payload.costRedacted
  return [
    `CABLE SCHEDULE — REVISION PACK`,
    ``,
    `Project:         ${payload.project.name}`,
    `Revision:        ${payload.revision.code} (${payload.revision.status})`,
    `Issued:          ${issued}`,
    `Generated:       ${generated}`,
    `Sources:         ${payload.sources.length}`,
    `Boards:          ${payload.boards.length}`,
    `Supplies (runs): ${payload.supplies.length}`,
    `Cables (strands): ${payload.cables.length}`,
    `Tags:            ${payload.cableTags.length}`,
    ``,
    `Contents`,
    `--------`,
    `${stem}.xlsx     — Excel workbook (${redacted ? '3' : '4'} sheets):`,
    `                    • CABLE SCHEDULE — one row per run; Parallel column for strand count`,
    ...(redacted
      ? []
      : [`                    • COST SUMMARY — supply + install + termination rates per (size, conductor)`]),
    `                    • FACTS AND FIGURES — calc audit reference`,
    `                    • REVISION HISTORY — change_log entries`,
    `${stem}.pdf      — Revision pack: cover + landscape schedule (Cu/Al sections)`,
    redacted
      ? `                    + tag pages with QR codes (10-up)`
      : `                    + cost page + tag pages with QR codes (10-up)`,
    `csv/schedule.csv — One row per RUN (= supply). Parallel strands under parallel_count column.`,
    `csv/tags.csv     — One row per (cable, end). 2 per cable.`,
    ...(redacted
      ? []
      : [`csv/cost.csv     — Cost rows per (size, conductor) + materials/VAT/grand-total trailer.`]),
    `csv/change_log.csv — Per-entity audit trail.`,
    ``,
    `Notes`,
    `-----`,
    `• "Parallel ×N" = number of parallel cable strands on the same logical run.`,
    `• Cu = copper, Al = aluminium. Mixed-metal projects price each conductor`,
    `  separately (Al is typically ~30% the price of Cu at the same size).`,
    `• ${statusLine}`,
    ...(redacted
      ? [`• Cost data omitted — your role does not permit cost export.`]
      : []),
    ``,
    ...(redacted
      ? []
      : [
          `Cost calc:`,
          `  Materials = Σ ((supply_rate + install_rate) × total_length) per (size, conductor)`,
          `              + Σ (terminations × termination_rate)`,
          `  Grand total = Materials × (1 + VAT/100)`,
          `  VAT for this revision: ${vatPct}%`,
          ``,
        ]),
  ].join('\r\n')
}
