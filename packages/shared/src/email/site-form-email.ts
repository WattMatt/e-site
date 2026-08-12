/**
 * Site form (termination / making-safe) DISTRIBUTED email — pure rendering, no I/O.
 *
 * Sent when a completed site form is distributed. The audience is whoever walks
 * onto site next, so the layout leads with the two facts that keep them safe:
 * which board was worked on, and what state it was LEFT in — plus how many
 * circuits are sitting in a temporary state, and any C1 (immediate danger)
 * defects found.
 *
 * Runtime-agnostic (no Node / Deno globals) so it unit-tests in the shared
 * package; the caller forwards { to, subject, html } to the `send-email` Edge
 * Function passthrough.
 *
 * Photo thumbnails are 7-day SIGNED URLs, never `data:` URIs — Gmail and most
 * webmail clients strip `data:` in <img src>. The deep link points at the FORM
 * PAGE, never at a signed file URL: signed URLs expire and cannot be re-shared.
 */

import { renderBrandedEmail, escapeHtml, safeAccentColor, EMAIL_PALETTE } from './layout'

/**
 * Machine token → human label for the "as left" state of the board.
 * Exported so the UI renders exactly the same wording the email does.
 */
export const AS_LEFT_STATUS_LABELS: Record<string, string> = {
  made_safe_de_energised: 'Made safe — de-energised',
  energised_returned_to_service: 'Energised — returned to service',
  left_isolated_lock_wm: 'Left isolated — locked off (WM lock)',
  left_isolated_lock_client: 'Left isolated — locked off (client lock)',
  partially_energised: 'Partially energised',
  decommissioned_removed: 'Decommissioned — removed',
}

/** Human label for an as-left token, falling back to the raw token. */
export function asLeftStatusLabel(token: string): string {
  return AS_LEFT_STATUS_LABELS[token] ?? token
}

/**
 * Defect grades. C1 = immediate danger present — it is the one grade that must
 * be visually unmissable in a mail read on a phone at a site gate.
 */
export const DEFECT_CLASSIFICATION_COLOUR: Record<string, string> = {
  C1: '#F87171',
  C2: '#FB923C',
  C3: '#60A5FA',
  FI: '#94A3B8',
}

/** Amber, deliberately NOT the C1 red — the temporary-state callout is a warning, not a danger grade. */
const WARNING_COLOUR = '#FB923C'

export interface SiteFormDefectLine {
  /** C1 | C2 | C3 | FI. */
  classification: string
  description: string
}

export interface SiteFormEmailPhoto {
  /** 7-day SIGNED URL. Never a `data:` URI. */
  url: string
  caption?: string
}

export interface SiteFormDistributedVars {
  projectId: string
  formId: string
  formNo: string
  projectName: string
  /** As-found board name. */
  boardLabel: string
  boardRef: string | null
  templateName: string
  /** Machine token, e.g. 'made_safe_de_energised'. */
  asLeftStatus: string
  circuitsLeftTemporary: number
  topDefects?: SiteFormDefectLine[]
  /** Defects beyond `topDefects` — summarised, not listed. */
  moreDefectCount?: number
  /** Inline thumbnails (7-day signed URLs). */
  photos?: SiteFormEmailPhoto[]
  /** Photos beyond the inline set — summarised. */
  morePhotoCount?: number
  electricianName: string
  /** Who pressed Distribute (null → omit the line). */
  distributedByName: string | null
  workDate: string
  /** Already resolved: project → organisation → default. */
  accentColor: string
  /** SIGNED URL, or null. */
  logoUrl: string | null
  /** App origin, e.g. https://www.e-site.live (no trailing slash). */
  siteUrl: string
}

/** The regulatory disclaimer this email must always carry. */
export const NOT_A_COC_DISCLAIMER =
  'This is a record of termination and making-safe work. It is not a Certificate of Compliance. ' +
  'A Certificate of Compliance in the form of Annexure 1 to the Electrical Installation Regulations, 2009, ' +
  'accompanied by the SANS 10142-1 test report, must be issued by a registered person for the altered part of the installation.'

/** One label/value row in the identification block. */
function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:3px 12px 3px 0;font-size:12px;color:${EMAIL_PALETTE.dim};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:3px 0;font-size:13px;color:${EMAIL_PALETTE.text};vertical-align:top"><strong>${escapeHtml(value)}</strong></td>
  </tr>`
}

/**
 * Render the "site form distributed" email — board identification, the as-left
 * state front and centre, temporary-circuit warning, graded defects, inline
 * signed-URL thumbnails, and a deep link to the form page.
 */
export function renderSiteFormDistributedEmail(
  v: SiteFormDistributedVars,
): { subject: string; html: string } {
  const p = EMAIL_PALETTE
  const accent = safeAccentColor(v.accentColor)
  const humanAsLeft = asLeftStatusLabel(v.asLeftStatus)
  const subject = `${v.formNo} — ${v.boardLabel} — ${humanAsLeft} — ${v.projectName}`
  // The FORM PAGE, never a signed file URL — signed URLs expire and cannot be re-shared.
  const link = `${v.siteUrl}/projects/${v.projectId}/forms/${v.formId}`

  const asLeftBlock = `<div style="background:${p.bg};border:1px solid ${p.border};border-left:4px solid ${accent};border-radius:8px;padding:14px 16px;margin:0 0 18px">
    <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:${p.dim};margin-bottom:4px">Board left as</div>
    <div style="font-size:17px;font-weight:700;line-height:1.3;color:${p.text}">${escapeHtml(humanAsLeft)}</div>
  </div>`

  const tempBlock =
    v.circuitsLeftTemporary > 0
      ? `<div style="background:${p.bg};border:1px solid ${WARNING_COLOUR};border-radius:8px;padding:12px 16px;margin:0 0 18px">
        <div style="font-size:14px;font-weight:700;color:${WARNING_COLOUR}">${v.circuitsLeftTemporary} circuit${v.circuitsLeftTemporary === 1 ? '' : 's'} left in a temporary state</div>
        <div style="font-size:12px;color:${p.dim};margin-top:4px">Do not assume these are permanent connections. Check the form before energising or working further.</div>
      </div>`
      : ''

  const details = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px">
    ${detailRow('Board', v.boardLabel)}
    ${v.boardRef ? detailRow('Board ref', v.boardRef) : ''}
    ${detailRow('Form', `${v.formNo} · ${v.templateName}`)}
    ${detailRow('Work date', v.workDate)}
    ${detailRow('Electrician', v.electricianName)}
    ${v.distributedByName ? detailRow('Distributed by', v.distributedByName) : ''}
  </table>`

  const defects = v.topDefects ?? []
  const defectHtml = defects.length
    ? `<p style="margin:0 0 6px;font-size:13px;color:${p.text}"><strong>Defects recorded</strong></p>
       ${defects
         .map((d) => {
           const grade = (d.classification ?? '').trim().toUpperCase()
           const colour = DEFECT_CLASSIFICATION_COLOUR[grade] ?? DEFECT_CLASSIFICATION_COLOUR.FI
           const isC1 = grade === 'C1'
           return `<div style="border-left:3px solid ${colour};padding:5px 0 5px 10px;margin-bottom:6px">
             <span style="display:inline-block;font-size:11px;font-weight:700;color:${colour};border:1px solid ${colour};border-radius:4px;padding:1px 6px;margin-right:6px">${escapeHtml(d.classification)}</span>
             <span style="font-size:13px;color:${p.text}${isC1 ? `;font-weight:700` : ''}">${escapeHtml(d.description)}</span>
             ${isC1 ? `<div style="font-size:11px;font-weight:700;color:${colour};margin-top:3px">Immediate danger present</div>` : ''}
           </div>`
         })
         .join('')}`
    : ''

  const moreDefects =
    v.moreDefectCount && v.moreDefectCount > 0
      ? `<p style="font-size:12px;color:${p.dim};margin:4px 0 0">+ ${v.moreDefectCount} more defect${v.moreDefectCount === 1 ? '' : 's'} — see the form.</p>`
      : ''

  // Defensive: a `data:` URI thumbnail renders as a broken image in webmail, so drop it.
  const photos = (v.photos ?? []).filter((ph) => !/^\s*data:/i.test(ph.url ?? ''))
  const photoHtml = photos.length
    ? `<div style="margin-top:18px">${photos
        .map(
          (ph) =>
            `<img src="${escapeHtml(ph.url)}" alt="${escapeHtml(ph.caption ?? 'Site photo')}" width="120" height="120" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid ${p.border};margin:0 6px 6px 0" />`,
        )
        .join('')}</div>`
    : ''

  const morePhotos =
    v.morePhotoCount && v.morePhotoCount > 0
      ? `<p style="font-size:12px;color:${p.dim};margin:4px 0 0">+ ${v.morePhotoCount} more photo${v.morePhotoCount === 1 ? '' : 's'} on the form.</p>`
      : ''

  const contentHtml = `${asLeftBlock}
    ${tempBlock}
    ${details}
    ${defectHtml}
    ${moreDefects}
    ${photoHtml}
    ${morePhotos}
    <div style="margin-top:22px"><a class="btn" href="${escapeHtml(link)}" style="display:inline-block;background:${accent};color:#0F172A;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700;font-size:14px">View the site form</a></div>`

  const html = renderBrandedEmail({
    accentColor: v.accentColor,
    logoUrl: v.logoUrl,
    projectName: v.projectName,
    title: `${v.formNo} — ${v.boardLabel}`,
    contentHtml,
    siteUrl: v.siteUrl,
    footerNote: NOT_A_COC_DISCLAIMER,
  })

  return { subject, html }
}
