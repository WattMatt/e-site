import 'server-only'
import { DEFAULT_ACCENT_COLOR, escapeHtml, renderBrandedEmail } from '@esite/shared'
import type { AnyClient } from './gate'

/**
 * How a tenderer gets in (E5, redesigned 2026-10-07). A contractor has no
 * account and no password; the invitation email IS the way in.
 *
 *  - mintTenderAccess: a single-use sign-in for ONE email address, made on the
 *    server with the auth admin API. For an address with no account it creates
 *    the account (confirmed on first use). It yields a link token and a 6-digit
 *    code; both prove the person holds that mailbox, so the session satisfies
 *    projects.session_proves_email.
 *  - The link points at OUR page (the invitation, or /tender/login) with the
 *    token in the query. The page shows a button; only pressing it uses the
 *    token. Mail scanners that open every link (Microsoft Safe Links and the
 *    like) therefore cannot burn it.
 *  - WM never sees the link: it only ever exists inside the email.
 *  - Our own tender-branded emails. GoTrue's generic emails are never used for
 *    tenders (their buttons go to /dashboard, which a tenderer cannot use).
 */
export interface TenderAccess {
  tokenHash: string
  /** GoTrue verification type for the token hash ('magiclink' or 'signup'). */
  type: string
  /** The 6-digit code, for a different device or a failed link. */
  code: string
}

export async function mintTenderAccess(svc: AnyClient, email: string): Promise<TenderAccess | { error: string }> {
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  const p = data?.properties as { hashed_token?: string; verification_type?: string; email_otp?: string } | undefined
  if (error || !p?.hashed_token || !p.verification_type || !p.email_otp) {
    console.error('mintTenderAccess failed', error?.message)
    return { error: 'Could not prepare the sign-in link. Try again.' }
  }
  return { tokenHash: p.hashed_token, type: p.verification_type, code: p.email_otp }
}

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')

/** The invitation page, carrying the single-use sign-in in its query. */
export function invitationAccessLink(invitationToken: string, a: TenderAccess): string {
  return `${siteUrl()}/tender/invite/${invitationToken}?k=${encodeURIComponent(a.tokenHash)}&t=${encodeURIComponent(a.type)}`
}

/** The return-visit page, carrying the single-use sign-in in its query. */
export function returnAccessLink(a: TenderAccess, email: string): string {
  return `${siteUrl()}/tender/login?k=${encodeURIComponent(a.tokenHash)}&t=${encodeURIComponent(a.type)}&e=${encodeURIComponent(email)}`
}

const OTP_TYPES = new Set(['magiclink', 'signup', 'invite', 'email'])
/** Only these verification types are ever accepted back from a query string. */
export function isTenderOtpType(t: string): t is 'magiclink' | 'signup' | 'invite' | 'email' {
  return OTP_TYPES.has(t)
}

function stepsHtml(email: string): string {
  const e = escapeHtml
  const steps = [
    `Press <strong>Open my invitation</strong> above. On the page that opens, press <strong>Continue</strong>. That's your account: no password, nothing to register first.`,
    `Press <strong>Accept the invitation</strong>, then complete your company details: registration number, VAT number, CIDB grade and B-BBEE level.`,
    `Price the bill of quantities: type rates on screen and press <strong>Save rates</strong>, or press <strong>Download BOQ (Excel)</strong>, fill in the rates and upload the workbook back.`,
    `Upload the documents asked for, accept the declarations, then press <strong>Submit tender</strong> before the closing time. You can withdraw, change and re-submit until it closes. Nobody at the engineer's office can see your prices before then.`,
    `To come back later, go to <a href="${e(siteUrl())}/tender/login">${e(siteUrl().replace(/^https?:\/\//, ''))}/tender/login</a> and enter ${e(email)}: we email you a new link and code.`,
  ]
  return `<p><strong>How it works</strong></p><ol>${steps.map((s) => `<li style="margin-bottom:6px">${s}</li>`).join('')}</ol>`
}

function codeHtml(link: string, code: string): string {
  const e = escapeHtml
  return (
    `<p style="font-size:13px;color:#555">If the button does not work, copy this address into your browser:<br>` +
    `<span style="word-break:break-all">${e(link)}</span><br>` +
    `If the page asks for a code, enter <strong style="font-size:16px;letter-spacing:2px">${e(code)}</strong>. ` +
    `The link and the code work once and expire after 24 hours. Only the newest email we sent you works; the page offers a fresh one.</p>`
  )
}

export function renderInvitationEmail(v: {
  orgName: string
  projectName: string
  companyName: string
  contactName: string | null
  email: string
  pkg: string
  title: string
  closingAt: string | null
  link: string
  code: string
}): { subject: string; html: string } {
  const e = escapeHtml
  const closes = v.closingAt
    ? new Date(v.closingAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' })
    : ''
  const html = renderBrandedEmail({
    accentColor: DEFAULT_ACCENT_COLOR,
    logoUrl: null,
    projectName: v.projectName,
    title: `Invitation to tender: ${v.pkg}`,
    contentHtml:
      `<p>${e(v.contactName ? `Dear ${v.contactName},` : 'Good day,')}</p>` +
      `<p>${e(v.orgName)} invites ${e(v.companyName)} to tender for <strong>${e(v.pkg)} — ${e(v.title)}</strong>.</p>` +
      (closes ? `<p>Tenders close <strong>${e(closes)}</strong>.</p>` : '') +
      `<a class="btn" href="${e(v.link)}">Open my invitation</a>` +
      stepsHtml(v.email) +
      codeHtml(v.link, v.code) +
      `<p style="font-size:12px;color:#666">This invitation is personal to ${e(v.email)}. Please do not forward it.</p>`,
    siteUrl: siteUrl(),
  })
  return { subject: `Invitation to tender: ${v.pkg} — ${v.title}`, html }
}

/** A fresh link and code: from the invitation page, or for a return visit. */
export function renderAccessEmail(v: { email: string; link: string; code: string; what: string }): { subject: string; html: string } {
  const e = escapeHtml
  const html = renderBrandedEmail({
    accentColor: DEFAULT_ACCENT_COLOR,
    logoUrl: null,
    projectName: '',
    title: 'Your link to the tender',
    contentHtml:
      `<p>Here is your link to ${e(v.what)}. Press the button, then press <strong>Continue</strong> on the page that opens.</p>` +
      `<a class="btn" href="${e(v.link)}">Continue to the tender</a>` +
      `<p>Or enter this code on the page: <strong style="font-size:16px;letter-spacing:2px">${e(v.code)}</strong></p>` +
      `<p style="font-size:12px;color:#666">The link and code are for ${e(v.email)} only, work once and expire after 24 hours. Only the newest email we sent you works. If you did not ask for this, ignore this email.</p>`,
    siteUrl: siteUrl(),
  })
  return { subject: 'Your link to the tender', html }
}

/** Send through the platform's send-email function. Never swallows a failure. */
export async function sendTenderEmail(to: string, subject: string, html: string): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: 'rfi-created', payload: { to: [to], subject, html } }),
    })
    const body = (await res.json().catch(() => null)) as { sent?: number; failed?: number } | null
    if (!res.ok || !body || (body.sent ?? 0) < 1) {
      console.error('sendTenderEmail failed', res.status, JSON.stringify(body)?.slice(0, 200))
      return { error: 'The email could not be sent. Try again in a minute.' }
    }
    return { ok: true }
  } catch (err) {
    console.error('sendTenderEmail threw', err)
    return { error: 'The email could not be sent. Try again in a minute.' }
  }
}
