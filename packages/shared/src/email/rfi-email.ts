/**
 * RFI notification email — pure rendering + recipient resolution.
 *
 * Runtime-agnostic (no Deno / Node globals) so it can be unit-tested in the
 * shared package and called from the web `dispatchRfiEmail` helper. The web
 * helper renders here and forwards { to, subject, html } to the `send-email`
 * Edge Function's `rfi-created` passthrough branch.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface RfiEmailRecipientInput {
  /** Project `notifyRfiEmail` toggle — when false, no RFI emails at all. */
  notifyRfiEmail: boolean
  /** Candidate recipient emails (e.g. active project members + assignee/raiser). */
  emails: (string | null | undefined)[]
}

/**
 * Resolve the deduped recipient list for an RFI-created email.
 * Gated entirely by `notifyRfiEmail`. Dedupes by lowercased email; drops
 * null/blank/non-email entries; preserves the original casing of the first
 * occurrence.
 */
export function buildRfiEmailRecipients(input: RfiEmailRecipientInput): string[] {
  if (!input.notifyRfiEmail) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.emails) {
    if (!raw) continue
    const trimmed = raw.trim()
    const norm = trimmed.toLowerCase()
    if (!norm || !norm.includes('@')) continue
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(trimmed)
  }
  return out
}

export interface RfiCreatedEmailVars {
  raisedByName: string
  assigneeName: string | null
  rfiSubject: string
  projectName: string
  priority: string
  dueDate?: string | null
  rfiId: string
  /** App origin, e.g. https://app.e-site.live (no trailing slash). */
  siteUrl: string
}

/** Dark-card transactional wrapper matching the other send-email templates. */
function baseEmailTemplate(content: string, siteUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
h2{margin:0 0 16px;font-size:18px}
.btn{display:inline-block;margin-top:16px;background:#3B82F6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px}
.footer{margin-top:24px;font-size:11px;color:#64748B}</style></head>
<body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${siteUrl}" style="color:#3B82F6">app.e-site.live</a></div></div></body></html>`
}

/** Render the recipient-neutral "new RFI" email (description + deep link). */
export function renderRfiCreatedEmail(v: RfiCreatedEmailVars): { subject: string; html: string } {
  const link = `${v.siteUrl}/rfis/${v.rfiId}`
  const assignee = v.assigneeName ?? 'Unassigned'
  const subject = `New RFI: ${v.rfiSubject}`
  const html = baseEmailTemplate(
    `<h2>New RFI raised</h2>
    <p><strong>${escapeHtml(v.raisedByName)}</strong> raised an RFI on project <strong>${escapeHtml(v.projectName)}</strong>.</p>
    <p><strong>Subject:</strong> ${escapeHtml(v.rfiSubject)}<br>
    <strong>Assigned to:</strong> ${escapeHtml(assignee)}<br>
    <strong>Priority:</strong> ${escapeHtml(v.priority)}${v.dueDate ? `<br><strong>Due:</strong> ${escapeHtml(v.dueDate)}` : ''}</p>
    <a class="btn" href="${link}">View RFI</a>`,
    v.siteUrl,
  )
  return { subject, html }
}

export interface SnagCreatedEmailVars {
  raisedByName: string
  assigneeName: string | null
  snagTitle: string
  projectName: string
  priority: string
  dueDate?: string | null
  snagId: string
  siteUrl: string
}

/** Render the "new snag" email (description + deep link). */
export function renderSnagCreatedEmail(v: SnagCreatedEmailVars): { subject: string; html: string } {
  const link = `${v.siteUrl}/snags/${v.snagId}`
  const assignee = v.assigneeName ?? 'Unassigned'
  const subject = `New snag: ${v.snagTitle}`
  const html = baseEmailTemplate(
    `<h2>New snag raised</h2>
    <p><strong>${escapeHtml(v.raisedByName)}</strong> raised a snag on project <strong>${escapeHtml(v.projectName)}</strong>.</p>
    <p><strong>Defect:</strong> ${escapeHtml(v.snagTitle)}<br>
    <strong>Assigned to:</strong> ${escapeHtml(assignee)}<br>
    <strong>Priority:</strong> ${escapeHtml(v.priority)}${v.dueDate ? `<br><strong>Due:</strong> ${escapeHtml(v.dueDate)}` : ''}</p>
    <a class="btn" href="${link}">View snag</a>`,
    v.siteUrl,
  )
  return { subject, html }
}

export interface SnagStatusEmailVars {
  snagTitle: string
  projectName: string
  /** Human-readable new status, e.g. "Signed Off". */
  statusLabel: string
  /** Who changed the status (null → omit the actor line). */
  changedByName: string | null
  snagId: string
  siteUrl: string
}

/** Render the "snag status changed / signed off" email (status + deep link). */
export function renderSnagStatusEmail(v: SnagStatusEmailVars): { subject: string; html: string } {
  const link = `${v.siteUrl}/snags/${v.snagId}`
  const subject = `Snag ${v.statusLabel}: ${v.snagTitle}`
  const actorLine = v.changedByName
    ? `<p>Updated by <strong>${escapeHtml(v.changedByName)}</strong>.</p>`
    : ''
  const html = baseEmailTemplate(
    `<h2>Snag status updated</h2>
    <p><strong>${escapeHtml(v.snagTitle)}</strong> on project <strong>${escapeHtml(v.projectName)}</strong> is now <strong>${escapeHtml(v.statusLabel)}</strong>.</p>
    ${actorLine}
    <a class="btn" href="${link}">View snag</a>`,
    v.siteUrl,
  )
  return { subject, html }
}

/** An inline image thumbnail (a signed, time-limited URL + its file name). */
export interface DiaryEmailPhoto {
  url: string
  fileName: string
}

export interface DiaryCreatedEmailVars {
  authorName: string
  projectName: string
  entryDate: string
  /** Human-readable entry-type label, e.g. "Progress". */
  entryTypeLabel: string
  /** For the per-entry deep link anchor. */
  entryId: string
  projectId: string
  /** Full entry fields — rendered in-email so recipients see the whole entry. */
  progressNotes: string
  safetyNotes?: string | null
  qualityNotes?: string | null
  delayNotes?: string | null
  delays?: string | null
  weather?: string | null
  workersOnSite?: number | null
  /** Inline image thumbnails (signed URLs). Non-image attachments are summarised. */
  photos?: DiaryEmailPhoto[]
  /** Count of attachments not shown inline (videos/documents, or overflow images). */
  otherAttachmentCount?: number
  siteUrl: string
}

/** Render the "new site diary entry" email — full entry + inline photo thumbnails
 *  + a deep link to the specific entry. */
export function renderDiaryCreatedEmail(v: DiaryCreatedEmailVars): { subject: string; html: string } {
  const link = `${v.siteUrl}/projects/${v.projectId}/diary#entry-${v.entryId}`
  const subject = `Site diary — ${v.projectName} (${v.entryDate})`

  const meta: string[] = []
  if (v.weather) meta.push(`<strong>Weather:</strong> ${escapeHtml(v.weather)}`)
  if (v.workersOnSite != null) meta.push(`<strong>Workers:</strong> ${v.workersOnSite}`)
  const metaLine = meta.length ? `<p>${meta.join(' &nbsp;·&nbsp; ')}</p>` : ''

  const section = (label: string, text?: string | null) =>
    text && text.trim()
      ? `<p style="margin-top:14px"><strong>${escapeHtml(label)}</strong><br><span style="white-space:pre-wrap">${escapeHtml(text)}</span></p>`
      : ''

  const photos = v.photos ?? []
  const photoHtml = photos.length
    ? `<div style="margin-top:16px">${photos
        .map(
          (p) =>
            `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.fileName)}" width="120" height="120" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #334155;margin:0 6px 6px 0" />`,
        )
        .join('')}</div>`
    : ''

  const other =
    v.otherAttachmentCount && v.otherAttachmentCount > 0
      ? `<p style="font-size:12px;color:#94A3B8;margin-top:8px">+ ${v.otherAttachmentCount} more attachment${v.otherAttachmentCount === 1 ? '' : 's'} — open the entry to view.</p>`
      : ''

  const html = baseEmailTemplate(
    `<h2>New site diary entry</h2>
    <p><strong>${escapeHtml(v.authorName)}</strong> logged a <strong>${escapeHtml(v.entryTypeLabel)}</strong> entry on <strong>${escapeHtml(v.projectName)}</strong> for <strong>${escapeHtml(v.entryDate)}</strong>.</p>
    ${metaLine}
    ${section('Progress notes', v.progressNotes)}
    ${section('Safety notes', v.safetyNotes)}
    ${section('Quality notes', v.qualityNotes)}
    ${section('Delay notes', v.delayNotes)}
    ${section('Delays / issues', v.delays)}
    ${photoHtml}
    ${other}
    <a class="btn" href="${link}">View this entry</a>`,
    v.siteUrl,
  )
  return { subject, html }
}
