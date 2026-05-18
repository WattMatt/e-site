/**
 * Filename stem for cable-schedule downloads.
 *
 * Status + date suffix prevents repeated downloads from overwriting each
 * other and lets recipients tell which version of a draft they have at a
 * glance.
 *
 *   ISSUED      → {project}-{rev}-issued-{YYYY-MM-DD}
 *   DRAFT       → {project}-{rev}-draft-{YYYY-MM-DD-HH-MM}
 *   SUPERSEDED  → {project}-{rev}-superseded-{YYYY-MM-DD-HH-MM}
 *
 * SUPERSEDED falls through to the generation-timestamp branch on purpose:
 * a superseded revision is no longer current, so re-downloading it should
 * NOT look like an authoritative issued doc.
 */

import type { ExportPayload } from './export-payload'

export function exportFilenameStem(payload: ExportPayload): string {
  const proj = payload.project.name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  const rev = payload.revision.code.replace(/\s+/g, '').toLowerCase()
  if (payload.revision.status === 'ISSUED' && payload.revision.issued_at) {
    return `${proj}-${rev}-issued-${payload.revision.issued_at.slice(0, 10)}`
  }
  const now = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 16)
  return `${proj}-${rev}-${payload.revision.status.toLowerCase()}-${now}`
}
