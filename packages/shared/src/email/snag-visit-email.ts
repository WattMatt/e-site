/**
 * Snag site-visit completion email — pure rendering, no I/O.
 *
 * This is the message the snag module was missing entirely: one email per
 * COMPLETED site visit, rather than one per snag raised. A 40-snag inspection
 * walk previously sent 40 separate "new snag" emails and never told anyone the
 * walk was finished or what the outcome was.
 *
 * Runtime-agnostic (no Deno / Node globals) so it unit-tests in the shared
 * package and is called from the web `notifySnagVisitCompleted` helper, which
 * forwards { to, subject, html } to the `send-email` Edge Function passthrough.
 *
 * Thumbnails are SIGNED URLs, never `data:` URIs — Gmail and most webmail
 * clients strip `data:` in <img src>, so inlined bytes would render as broken
 * images. Same choice as renderDiaryCreatedEmail.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Dark-card transactional wrapper matching the other send-email templates. */
function baseEmailTemplate(content: string, siteUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:520px;margin:0 auto}
h2{margin:0 0 16px;font-size:18px}
.btn{display:inline-block;margin-top:16px;background:#3B82F6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px}
.footer{margin-top:24px;font-size:11px;color:#64748B}</style></head>
<body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${siteUrl}" style="color:#3B82F6">app.e-site.live</a></div></div></body></html>`
}

/** An inline image thumbnail (a signed, time-limited URL + its caption). */
export interface SnagVisitEmailPhoto {
  url: string
  label: string
}

/** One line in the "top defects" digest. */
export interface SnagVisitDefectLine {
  /** Display reference, e.g. "S-004". */
  number: string
  title: string
  priority: string
  location?: string | null
}

export interface SnagVisitCompletedEmailVars {
  projectId: string
  visitId: string
  projectName: string
  /** "Site Visit 3" or "Initial Backlog". */
  visitLabel: string
  visitDate: string
  conductedByName: string
  /** Who pressed Complete (null → omit the line). */
  completedByName: string | null
  attendees?: string[]
  counts: {
    newSnags: number
    stillOpen: number
    closedThisVisit: number
    totalOutstanding: number
  }
  /** First few defects, rendered inline. */
  topDefects?: SnagVisitDefectLine[]
  /** Defects beyond `topDefects` — summarised, not listed. */
  moreDefectCount?: number
  /** Inline thumbnails (signed URLs). */
  photos?: SnagVisitEmailPhoto[]
  /** Photos beyond the inline set — summarised. */
  morePhotoCount?: number
  notes?: string | null
  /** App origin, e.g. https://www.e-site.live (no trailing slash). */
  siteUrl: string
}

const PRIORITY_COLOUR: Record<string, string> = {
  critical: '#F87171',
  high: '#FB923C',
  medium: '#60A5FA',
  low: '#94A3B8',
}

/** One count tile in the summary strip. */
function statTile(label: string, value: number, colour: string): string {
  return `<td style="padding:0 6px 0 0" width="25%">
    <div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:10px 8px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:${colour};line-height:1.1">${value}</div>
      <div style="font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px">${escapeHtml(label)}</div>
    </div>
  </td>`
}

/**
 * Render the "site visit completed" email — visit header, count summary,
 * top defects, inline before/after thumbnails, and a deep link to the visit
 * (where the issued report is downloadable).
 */
export function renderSnagVisitCompletedEmail(
  v: SnagVisitCompletedEmailVars,
): { subject: string; html: string } {
  const link = `${v.siteUrl}/projects/${v.projectId}/snags/visits/${v.visitId}`
  const subject = `${v.visitLabel} complete — ${v.projectName} (${v.counts.newSnags} new, ${v.counts.closedThisVisit} closed)`

  const summary = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px"><tr>
    ${statTile('New', v.counts.newSnags, '#FB923C')}
    ${statTile('Still open', v.counts.stillOpen, '#E2E8F0')}
    ${statTile('Closed', v.counts.closedThisVisit, '#34D399')}
    ${statTile('Outstanding', v.counts.totalOutstanding, '#E2E8F0')}
  </tr></table>`

  const attendeeLine =
    v.attendees && v.attendees.length > 0
      ? `<br><strong>Attendees:</strong> ${v.attendees.map(escapeHtml).join(', ')}`
      : ''

  const completedLine = v.completedByName
    ? `<br><strong>Completed by:</strong> ${escapeHtml(v.completedByName)}`
    : ''

  const defects = v.topDefects ?? []
  const defectHtml = defects.length
    ? `<p style="margin-top:18px;margin-bottom:6px"><strong>Defects raised</strong></p>
       ${defects
         .map((d) => {
           const colour = PRIORITY_COLOUR[d.priority] ?? PRIORITY_COLOUR.low
           const loc = d.location ? ` &nbsp;·&nbsp; ${escapeHtml(d.location)}` : ''
           return `<div style="border-left:3px solid ${colour};padding:4px 0 4px 10px;margin-bottom:6px">
             <span style="font-size:13px;color:#E2E8F0">${escapeHtml(d.number)} — ${escapeHtml(d.title)}</span>
             <div style="font-size:11px;color:#94A3B8;margin-top:2px">${escapeHtml(d.priority)}${loc}</div>
           </div>`
         })
         .join('')}`
    : ''

  const moreDefects =
    v.moreDefectCount && v.moreDefectCount > 0
      ? `<p style="font-size:12px;color:#94A3B8;margin-top:4px">+ ${v.moreDefectCount} more defect${v.moreDefectCount === 1 ? '' : 's'} — see the report.</p>`
      : ''

  const photos = v.photos ?? []
  const photoHtml = photos.length
    ? `<div style="margin-top:16px">${photos
        .map(
          (p) =>
            `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.label)}" width="120" height="120" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #334155;margin:0 6px 6px 0" />`,
        )
        .join('')}</div>`
    : ''

  const morePhotos =
    v.morePhotoCount && v.morePhotoCount > 0
      ? `<p style="font-size:12px;color:#94A3B8;margin-top:4px">+ ${v.morePhotoCount} more photo${v.morePhotoCount === 1 ? '' : 's'} in the report.</p>`
      : ''

  const notes =
    v.notes && v.notes.trim()
      ? `<p style="margin-top:16px"><strong>Visit notes</strong><br><span style="white-space:pre-wrap">${escapeHtml(v.notes)}</span></p>`
      : ''

  const html = baseEmailTemplate(
    `<h2>Site visit complete</h2>
    <p><strong>${escapeHtml(v.visitLabel)}</strong> on <strong>${escapeHtml(v.projectName)}</strong> was completed on <strong>${escapeHtml(v.visitDate)}</strong>.</p>
    <p><strong>Conducted by:</strong> ${escapeHtml(v.conductedByName)}${completedLine}${attendeeLine}</p>
    ${summary}
    ${defectHtml}
    ${moreDefects}
    ${photoHtml}
    ${morePhotos}
    ${notes}
    <a class="btn" href="${link}">View visit &amp; download report</a>`,
    v.siteUrl,
  )

  return { subject, html }
}
