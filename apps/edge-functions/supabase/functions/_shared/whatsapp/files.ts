// apps/edge-functions/supabase/functions/_shared/whatsapp/files.ts
//
// Drawings, documents and reports on request (spec 2026-10-06, sub-projects 3 + 4).
// Every lookup goes through a wa_* function acting as the person (RLS + site_scope +
// report-kind gate); the file itself is fetched from storage with the service key only
// after that function answered ok. The cable schedule PDF is built by the web app.
import { FILE_SEARCH_TTL_MS, encodePayload, isMenuWord, isWithin, type Payload } from './core.ts'
import type { InboundMessage } from './parse.ts'
import type { InboundRow, LinkRow, ProcessResult, ProcessorDeps } from './processor.ts'

/** The web app's report service (POST /api/internal/whatsapp/reports). Absent: no on-demand reports. */
export interface ReportsClient {
  cableSchedule(userId: string, projectId: string): Promise<
    { code: 'ok'; filename: string; bytes: Uint8Array } | { code: 'no_access' | 'none' | 'too_large'; message?: string }>
}

interface FileRow { kind: 'p' | 'd'; id: string; name: string; sub: string | null }
interface ReportRow { id: string; kind: string; title: string; version: number }
interface ProjectRow { id: string; name: string; role: string }

export const FILES = {
  filesRow: 'Drawings & documents',
  reportsRow: 'Reports & schedules',
  filesButton: 'Files',
  reportsButton: 'Reports',
  recent: (name: string) => `${name} — latest drawings & documents. Not here? Type part of the name or number (e.g. E-101).`,
  matches: (q: string) => `Matches for "${q}":`,
  noFiles: (name: string) => `No drawings or documents on ${name} yet.`,
  noMatch: (q: string) => `Nothing matches "${q}". Try a shorter part of the name or number, or type *menu*.`,
  noReports: (name: string) => `No reports available on ${name} yet.`,
  reportsBody: (name: string) => `${name} — reports & schedules:`,
  cableRow: 'Cable schedule (PDF)',
  cableDesc: 'Current revision, built now',
  gone: "That file isn't available to you.",
  sending: (name: string) => `Sending ${name}…`,
  tooBig: 'That file is too large to send on WhatsApp — open it in E-Site.',
  cableNone: 'This project has no cable schedule yet.',
  cableNoAccess: "You don't have access to this project's cable schedule.",
  reportsOff: 'On-demand reports are not available right now.',
} as const

/** WhatsApp's document limit is 100 MB; stay clear of it. */
export const MAX_SEND_BYTES = 95 * 1024 * 1024

const res = (outcome: ProcessResult['outcome'], reason: string, userId: string | null): ProcessResult =>
  ({ outcome, reason, userId, itemId: null })

async function currentProject(deps: ProcessorDeps, link: LinkRow): Promise<ProjectRow | null> {
  const r = await deps.store.call('wa_my_projects', { p_user: link.user_id })
  const list = Array.isArray(r) ? (r as ProjectRow[]) : []
  return list.find((p) => p.id === link.current_project_id) ?? null
}

export function filesMenuRows(): Array<{ id: string; title: string }> {
  return [
    { id: encodePayload({ kind: 'menu', row: 'files' }), title: FILES.filesRow },
    { id: encodePayload({ kind: 'menu', row: 'reports' }), title: FILES.reportsRow },
  ]
}

function fileRows(files: FileRow[]) {
  return files.map((f) => ({
    id: encodePayload({ kind: 'file', fileKind: f.kind, id: f.id }),
    title: f.name.slice(0, 24),
    description: [f.kind === 'p' ? 'Drawing' : 'Document', f.sub, f.name.length > 24 ? f.name : null].filter(Boolean).join(' · ').slice(0, 72),
  }))
}

async function listFiles(deps: ProcessorDeps, link: LinkRow, query: string): Promise<ProcessResult> {
  const project = await currentProject(deps, link)
  if (!project) return res('refused', 'no_current_project', link.user_id)
  const r = await deps.store.call('wa_project_files', { p_user: link.user_id, p_project: project.id, p_query: query })
  const files = Array.isArray(r) ? (r as FileRow[]) : []
  // Arm the search for the next free text (also after a search, so the person can refine).
  await deps.store.updateLink(link.id, { pending_search_at: deps.now().toISOString() })
  link.pending_search_at = deps.now().toISOString()
  if (files.length === 0) {
    await deps.meta.sendText(link.phone_e164, query ? FILES.noMatch(query) : FILES.noFiles(project.name))
    return res('applied', query ? 'files_no_match' : 'files_none', link.user_id)
  }
  await deps.meta.sendList(link.phone_e164, query ? FILES.matches(query) : FILES.recent(project.name), FILES.filesButton, fileRows(files))
  return res('applied', query ? 'files_search' : 'files_recent', link.user_id)
}

async function listReports(deps: ProcessorDeps, link: LinkRow): Promise<ProcessResult> {
  const project = await currentProject(deps, link)
  if (!project) return res('refused', 'no_current_project', link.user_id)
  const r = await deps.store.call('wa_project_reports', { p_user: link.user_id, p_project: project.id })
  const reports = Array.isArray(r?.reports) ? (r.reports as ReportRow[]) : []
  const rows = [
    ...(r?.cable_schedule && deps.reports
      ? [{ id: encodePayload({ kind: 'cab', projectId: project.id }), title: FILES.cableRow, description: FILES.cableDesc }] : []),
    ...reports.slice(0, 9).map((x) => ({
      id: encodePayload({ kind: 'rep', reportId: x.id }), title: x.title.slice(0, 24),
      description: `${x.kind.replace(/_/g, ' ')} · v${x.version}`.slice(0, 72),
    })),
  ]
  if (rows.length === 0) {
    await deps.meta.sendText(link.phone_e164, FILES.noReports(project.name))
    return res('applied', 'reports_none', link.user_id)
  }
  await deps.meta.sendList(link.phone_e164, FILES.reportsBody(project.name), FILES.reportsButton, rows)
  return res('applied', 'reports_list', link.user_id)
}

function safeFilename(name: string, mime: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file'
  const ext = mime === 'application/pdf' ? 'pdf' : null
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base
}

async function sendStored(deps: ProcessorDeps, link: LinkRow, r: Record<string, unknown> | null, reason: string): Promise<ProcessResult> {
  if (r?.code !== 'ok') {
    await deps.meta.sendText(link.phone_e164, FILES.gone)
    return res('refused', `${reason}_gone`, link.user_id)
  }
  const bytes = await deps.store.download(String(r.bucket), String(r.path))
  if (bytes.length > MAX_SEND_BYTES) {
    await deps.meta.sendText(link.phone_e164, FILES.tooBig)
    return res('refused', `${reason}_too_large`, link.user_id)
  }
  const mime = String(r.mime)
  const filename = safeFilename(String(r.name), mime)
  const mediaId = await deps.meta.uploadMedia(bytes, mime, filename)
  await deps.meta.sendDocument(link.phone_e164, mediaId, filename)
  await deps.store.updateLink(link.id, { pending_search_at: null })
  link.pending_search_at = null
  return res('applied', `${reason}_sent`, link.user_id)
}

/** Menu rows files/reports and the file/rep/cab payloads. Returns null for payloads this module does not own. */
export async function handleFilesPayload(p: Payload, link: LinkRow, _inbound: InboundRow, deps: ProcessorDeps): Promise<ProcessResult | null> {
  switch (p.kind) {
    case 'menu':
      if (p.row === 'files') return listFiles(deps, link, '')
      if (p.row === 'reports') return listReports(deps, link)
      return null
    case 'file':
      return sendStored(deps, link, await deps.store.call('wa_file', { p_user: link.user_id, p_kind: p.fileKind, p_id: p.id }), 'file')
    case 'rep':
      return sendStored(deps, link, await deps.store.call('wa_report', { p_user: link.user_id, p_report: p.reportId }), 'report')
    case 'cab': {
      if (!deps.reports) {
        await deps.meta.sendText(link.phone_e164, FILES.reportsOff)
        return res('refused', 'cable_off', link.user_id)
      }
      const out = await deps.reports.cableSchedule(link.user_id, p.projectId)
      if (out.code !== 'ok') {
        const text = out.code === 'none' ? FILES.cableNone : out.code === 'too_large' ? FILES.tooBig : FILES.cableNoAccess
        await deps.meta.sendText(link.phone_e164, text)
        return res('refused', `cable_${out.code}`, link.user_id)
      }
      const mediaId = await deps.meta.uploadMedia(out.bytes, 'application/pdf', out.filename)
      await deps.meta.sendDocument(link.phone_e164, mediaId, out.filename)
      return res('applied', 'cable_sent', link.user_id)
    }
    default:
      return null
  }
}

/** Free text right after "Drawings & documents": a search. Returns null to fall through. */
export async function handleFilesContent(msg: InboundMessage, link: LinkRow, _inbound: InboundRow, deps: ProcessorDeps): Promise<ProcessResult | null> {
  if (msg.type !== 'text' || !msg.text || msg.contextId || isMenuWord(msg.text)) return null
  if (!link.pending_search_at || !isWithin(link.pending_search_at, deps.now(), FILE_SEARCH_TTL_MS)) return null
  const q = msg.text.trim()
  if (q.length < 2 || q.length > 60) return null
  return listFiles(deps, link, q)
}
