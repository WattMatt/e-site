/**
 * Invitation + site-assignment emails — pure rendering only.
 *
 * Runtime-agnostic (no Deno / Node globals) so it can be unit-tested in the
 * shared package and called from the web `sendInviteEmail` helper, which
 * forwards { to, subject, html } to the `send-email` Edge Function's `invite`
 * passthrough branch.
 *
 * Anti-spam / anti-phishing design (task success criterion A):
 *   - The E-Site wordmark + product one-liner establish sender identity.
 *   - The email NAMES the person and company who added them, and WHY they are
 *     receiving it — so a contractor who never signed up does not read it as
 *     a bare, contextless "reset your password" mail (the previous behaviour).
 *   - It states exactly which site(s) they were given access to and that they
 *     will only see those site(s) (task success criterion B — assignment
 *     transparency + single-site scoping).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Human-readable label for an org/project role slug. */
export function roleLabel(role: string): string {
  const map: Record<string, string> = {
    owner: 'Owner',
    admin: 'Administrator',
    project_manager: 'Project Manager',
    contractor: 'Contractor',
    inspector: 'Inspector',
    supplier: 'Supplier',
    client_viewer: 'Client Viewer (read-only)',
  }
  return map[role] ?? role.replace(/_/g, ' ')
}

/**
 * Branded transactional wrapper. Includes the E-Site wordmark header and a
 * product one-liner in the footer so the message reads as a legitimate
 * account email rather than spam. `preheader` is the hidden inbox-preview text.
 */
function inviteBaseTemplate(opts: {
  preheader: string
  content: string
  siteUrl: string
}): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px 16px}
.wrap{max-width:480px;margin:0 auto}
.brand{font-size:12px;font-weight:700;letter-spacing:0.18em;color:#3B82F6;text-transform:uppercase;padding-bottom:16px}
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px}
h2{margin:0 0 16px;font-size:19px;color:#F1F5F9;line-height:1.35}
p{margin:0 0 12px;font-size:14px;line-height:1.65;color:#CBD5E1}
.chip{display:inline-block;background:#0F172A;border:1px solid #334155;border-radius:6px;padding:4px 10px;font-size:13px;color:#E2E8F0;margin:2px 4px 2px 0}
.btn{display:inline-block;margin:8px 0 4px;background:#3B82F6;color:#fff !important;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px}
.otp{display:inline-block;margin:4px 0 8px;background:#0F172A;border:1px solid #334155;border-radius:8px;padding:12px 20px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:0.35em;color:#F1F5F9}
.note{font-size:12px;color:#94A3B8;line-height:1.6}
.footer{margin-top:22px;font-size:11px;color:#64748B;line-height:1.5}
a{color:#93C5FD}</style></head>
<body><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>
<div class="wrap">
<div class="brand">E-Site</div>
<div class="card">${opts.content}</div>
<div class="footer">E-Site · Construction management for South African electrical contractors.<br>
You received this because your email address was added to a company account on E-Site.
If you weren't expecting it, you can safely ignore this message — no account is active until you set a password.<br>
<a href="${opts.siteUrl}" style="color:#93C5FD">${escapeHtml(opts.siteUrl.replace(/^https?:\/\//, ""))}</a></div>
</div></body></html>`
}

export interface InviteEmailVars {
  /** The email address that was invited (echoed back for anti-phishing clarity). */
  recipientEmail: string
  /** Who added them (full name; falls back to a generic label upstream). */
  inviterName: string
  /** The company / organisation they were added to (e.g. "Bob's Building"). */
  orgName: string
  /** Their role slug within that org (e.g. "contractor"). */
  role: string
  /** Site(s) they were given access to at invite time. Empty/omitted = none yet. */
  siteNames?: string[]
  /** The set-password action link (from admin.generateLink recovery). */
  actionLink: string
  /** App origin, e.g. https://www.e-site.live (no trailing slash). */
  siteUrl: string
  /** For contractor sub-orgs: the managing company, shown for extra context. */
  managingCompanyName?: string | null
  /** Human expiry window for the link, e.g. "1 hour". */
  linkExpiry?: string
  /** 6-digit recovery code (generateLink `email_otp`). Rendered as a fallback
   *  the invitee can type at /reset-password — usable even after an email
   *  scanner has pre-fetched (burnt) the single-use action link. */
  otpCode?: string | null
}

/**
 * Render the "you've been added — set your password" invitation email for a
 * brand-new user. Names the inviter + company + role + assigned site(s) and
 * explains why the recipient is receiving it.
 */
export function renderInviteEmail(v: InviteEmailVars): { subject: string; html: string } {
  const inviter = v.inviterName?.trim() || 'A team member'
  const org = v.orgName?.trim() || 'a company'
  const sites = (v.siteNames ?? []).filter((s) => s && s.trim())
  const expiry = v.linkExpiry ?? '1 hour'

  const subject = `${inviter} added you to ${org} on E-Site — set your password`

  const managingLine = v.managingCompanyName
    ? `<p class="note">${escapeHtml(org)} is managed on E-Site by ${escapeHtml(v.managingCompanyName)}.</p>`
    : ''

  const siteBlock = sites.length
    ? `<p>You've been given access to ${sites.length === 1 ? 'this site' : 'these sites'}:</p>
       <p>${sites.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join('')}</p>
       <p class="note">You'll only see the site(s) you've been added to — not the rest of ${escapeHtml(org)}'s work.</p>`
    : `<p class="note">Your team will add you to specific site(s) — you'll only see the site(s) you're added to.</p>`

  const otpBlock = v.otpCode?.trim()
    ? `<p style="margin-top:16px">If the button doesn't work (some email scanners break these links), enter this code with your email address at
        <a href="${v.siteUrl}/reset-password?step=code&amp;email=${encodeURIComponent(v.recipientEmail)}">${escapeHtml(v.siteUrl.replace(/^https?:\/\//, ''))}/reset-password</a>:</p>
      <div class="otp">${escapeHtml(v.otpCode.trim())}</div>`
    : ''

  const content = `
    <h2>You've been added to E-Site</h2>
    <p><strong>${escapeHtml(inviter)}</strong> added you to <strong>${escapeHtml(org)}</strong> on E-Site as a <strong>${escapeHtml(roleLabel(v.role))}</strong>.</p>
    ${managingLine}
    ${siteBlock}
    <p>To get started, set your password and sign in:</p>
    <a class="btn" href="${v.actionLink}">Set your password &amp; sign in</a>
    ${otpBlock}
    <p class="note">This secure link expires in about ${escapeHtml(expiry)}. If it expires, open
      <a href="${v.siteUrl}/login">${escapeHtml(v.siteUrl.replace(/^https?:\/\//, ''))}/login</a>
      and choose “Forgot password” to get a fresh one for <strong>${escapeHtml(v.recipientEmail)}</strong>.</p>`

  return {
    subject,
    html: inviteBaseTemplate({
      preheader: `${inviter} added you to ${org} on E-Site. Set your password to get started.`,
      content,
      siteUrl: v.siteUrl,
    }),
  }
}

export interface SiteAssignmentEmailVars {
  /** Who granted access. */
  inviterName: string
  /** The site/project name. */
  siteName: string
  /** For the deep link. */
  projectId: string
  /** The role they were assigned on this site. */
  role: string
  /** App origin, e.g. https://www.e-site.live (no trailing slash). */
  siteUrl: string
}

/**
 * Render the "you've been given access to <site>" email for a user who ALREADY
 * has an E-Site account (e.g. an existing contractor added to a new site).
 * No password step — just the assignment + scope + a deep link.
 */
export function renderSiteAssignmentEmail(v: SiteAssignmentEmailVars): { subject: string; html: string } {
  const inviter = v.inviterName?.trim() || 'A team member'
  const site = v.siteName?.trim() || 'a site'
  const subject = `${inviter} gave you access to ${site} on E-Site`
  // Clients live in the viewing-only portal; the admin /projects deep link
  // would bounce them and drop the project. Everyone else gets the admin app.
  const isClient = v.role === 'client_viewer'
  const link = isClient
    ? `${v.siteUrl}/portal/${v.projectId}`
    : `${v.siteUrl}/projects/${v.projectId}`
  const whereItAppears = isClient
    ? `It now appears under <strong>Your sites</strong> when you sign in to the client portal.`
    : `It now appears in your <strong>Projects</strong> list when you sign in.`

  const content = `
    <h2>You've been added to a site</h2>
    <p><strong>${escapeHtml(inviter)}</strong> gave you access to the site <strong>${escapeHtml(site)}</strong> on E-Site as a <strong>${escapeHtml(roleLabel(v.role))}</strong>.</p>
    <p>${whereItAppears}</p>
    <p class="note">You only have access to the site(s) you've been added to.</p>
    <a class="btn" href="${link}">Open ${escapeHtml(site)}</a>`

  return {
    subject,
    html: inviteBaseTemplate({
      preheader: `${inviter} gave you access to ${site} on E-Site.`,
      content,
      siteUrl: v.siteUrl,
    }),
  }
}
