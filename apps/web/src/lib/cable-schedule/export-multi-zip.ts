/**
 * Multi-revision ZIP — bundles every ISSUED revision on a project into
 * one handover pack. Each revision lives in its own folder containing
 * the same files renderRevisionZip would emit (xlsx + pdf + 3 CSVs).
 *
 * Use case: handover deliverables to clients / consulting engineers /
 * facilities teams typically need the full revision history of the
 * cable schedule, not just the latest. Pre-T11 this required
 * downloading + organising each revision manually.
 *
 * Layout:
 *   {project}-{revA}-issued-{date}/
 *     {stem}.xlsx
 *     {stem}.pdf
 *     schedule.csv
 *     cost.csv (omitted when redacted)
 *     change_log.csv
 *   {project}-{revB}-issued-{date}/
 *     ...
 *   README.txt
 *
 * Defence-in-depth:
 *   - `policy.redactCost` is applied per-revision before rendering so
 *     client_viewer multi-packs never leak cost figures.
 *   - Per-revision size cap via `checkExportSize(payload, 'zip')`. An
 *     individual oversized revision is SKIPPED (with a README note) so
 *     one outlier doesn't sink the whole pack.
 *   - Aggregate caps live in the route handler — see route.ts.
 */

import JSZip from 'jszip'
import { renderScheduleWorkbook } from './export-excel'
import { renderRevisionPdf } from './export-pdf'
import { renderCsv } from './export-csv'
import { exportFilenameStem } from './export-filename'
import { getRevisionExportPayload } from './export-payload'
import {
  redactPayloadCost,
  checkExportSize,
  type ExportPolicy,
} from './export-role'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MultiZipResult {
  bytes: Uint8Array
  filename: string
  included: Array<{ code: string; status: string }>
  skipped: Array<{ code: string; status: string; reason: string }>
}

export type MultiZipOutcome = MultiZipResult | { error: string }

export async function renderProjectAllRevisionsZip(
  supabase: SupabaseClient,
  projectId: string,
  policy: ExportPolicy,
  options: { onlyIssued?: boolean } = { onlyIssued: true },
): Promise<MultiZipOutcome> {
  const { data: revs } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, issued_at')
    .eq('project_id', projectId)
    .order('issued_at', { ascending: true })

  const candidates = ((revs ?? []) as Array<{
    id: string
    code: string
    status: string
    issued_at: string | null
  }>).filter((r) => !options.onlyIssued || r.status === 'ISSUED')

  if (candidates.length === 0) {
    return { error: 'No issued revisions found for this project' }
  }

  const zip = new JSZip()
  const included: Array<{ code: string; status: string }> = []
  const skipped: Array<{ code: string; status: string; reason: string }> = []
  let projectName = ''

  for (const rev of candidates) {
    const raw = await getRevisionExportPayload(supabase, projectId, rev.id)
    if (!raw) {
      skipped.push({
        code: rev.code,
        status: rev.status,
        reason: 'Revision payload could not be loaded',
      })
      continue
    }

    const payload = policy.redactCost ? redactPayloadCost(raw) : raw

    const sizeCheck = checkExportSize(payload, 'zip')
    if (!sizeCheck.ok) {
      skipped.push({
        code: rev.code,
        status: rev.status,
        reason: sizeCheck.reason,
      })
      continue
    }

    projectName = projectName || payload.project.name
    const stem = exportFilenameStem(payload)
    const folder = zip.folder(stem)
    if (!folder) {
      skipped.push({
        code: rev.code,
        status: rev.status,
        reason: 'Could not create folder in ZIP',
      })
      continue
    }

    const [xlsx, pdf] = await Promise.all([
      renderScheduleWorkbook(payload),
      renderRevisionPdf(payload),
    ])
    folder.file(`${stem}.xlsx`, xlsx)
    folder.file(`${stem}.pdf`, pdf)
    folder.file('schedule.csv', renderCsv('schedule', payload))
    if (!payload.costRedacted) {
      folder.file('cost.csv', renderCsv('cost', payload))
    }
    folder.file('change_log.csv', renderCsv('change_log', payload))

    included.push({ code: rev.code, status: rev.status })
  }

  if (included.length === 0) {
    return {
      error:
        'No revisions could be packaged. ' +
        (skipped[0]?.reason ?? 'Unknown reason.'),
    }
  }

  // Fall back to projectId if (somehow) every payload lacked a project name.
  const safeProjectName = projectName || projectId

  zip.file(
    'README.txt',
    buildMultiReadme(safeProjectName, included, skipped, policy.redactCost),
  )

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
  })
  const filename = `${safeProjectName
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()}-all-revisions.zip`

  return { bytes, filename, included, skipped }
}

function buildMultiReadme(
  projectName: string,
  included: Array<{ code: string; status: string }>,
  skipped: Array<{ code: string; status: string; reason: string }>,
  redacted: boolean,
): string {
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const lines: string[] = [
    `CABLE SCHEDULE — ALL REVISIONS HANDOVER PACK`,
    ``,
    `Project:    ${projectName}`,
    `Revisions:  ${included.length} included${
      skipped.length ? `, ${skipped.length} skipped` : ''
    }`,
    `Generated:  ${generated}`,
    ``,
    `Included`,
    `--------`,
    ...included.map((r) => `  • ${r.code} (${r.status})`),
    ``,
    `Each folder contains the full export pack for that revision:`,
    `  • {stem}.xlsx     — ${redacted ? '3' : '4'}-sheet workbook`,
    `  • {stem}.pdf      — Revision pack (cover + schedule${
      redacted ? '' : ' + cost'
    } + tags)`,
    `  • schedule.csv    — One row per RUN (= supply)`,
    ...(redacted ? [] : [`  • cost.csv        — Cost rows per (size, conductor)`]),
    `  • change_log.csv  — Per-entity audit trail`,
    ``,
  ]
  if (redacted) {
    lines.push(
      `Note: cost data omitted — your role does not permit cost export.`,
      ``,
    )
  }
  if (skipped.length) {
    lines.push(
      `Skipped`,
      `-------`,
      ...skipped.map((r) => `  • ${r.code} (${r.status}): ${r.reason}`),
      ``,
    )
  }
  return lines.join('\r\n')
}
