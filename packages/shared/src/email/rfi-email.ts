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

export interface DiaryCreatedEmailVars {
  authorName: string
  projectName: string
  entryDate: string
  /** Short excerpt of the entry's progress notes. */
  summary: string
  projectId: string
  siteUrl: string
}

/** Render the "new site diary entry" email (excerpt + deep link to the diary). */
export function renderDiaryCreatedEmail(v: DiaryCreatedEmailVars): { subject: string; html: string } {
  const link = `${v.siteUrl}/projects/${v.projectId}/diary`
  const subject = `Site diary — ${v.projectName} (${v.entryDate})`
  const html = baseEmailTemplate(
    `<h2>New site diary entry</h2>
    <p><strong>${escapeHtml(v.authorName)}</strong> logged a diary entry on <strong>${escapeHtml(v.projectName)}</strong> for <strong>${escapeHtml(v.entryDate)}</strong>.</p>
    <p style="white-space:pre-wrap">${escapeHtml(v.summary)}</p>
    <a class="btn" href="${link}">View diary</a>`,
    v.siteUrl,
  )
  return { subject, html }
}
