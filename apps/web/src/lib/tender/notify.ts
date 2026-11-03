import 'server-only'
import { DEFAULT_ACCENT_COLOR, escapeHtml, renderBrandedEmail } from '@esite/shared'
import type { AnyClient } from './gate'
import { tenderInvitesEnabled } from './gate'
import { sendTenderEmail, siteUrl } from './access'

/**
 * Tender lifecycle emails (00252). Every one deep-links to the portal: the
 * send-email transport carries no attachments, and tender files must only ever
 * reach a bidder through the receipted portal download.
 *
 * All tender mail rides the one switch, TENDER_INVITES_ENABLED. A failed email
 * never fails the action that triggered it: publishing an addendum must not
 * roll back because a mailbox is down — the count is reported instead.
 */

const za = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' }) : ''
const money = (n: number) => `R ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`

export interface TenderRef {
  package: string
  title: string
  reference?: string | null
  closing_at?: string | null
}

const tag = (t: TenderRef) => `${t.package} — ${t.title}${t.reference ? ` (${t.reference})` : ''}`

function portalButton(label = 'Open the tender portal'): string {
  return `<a class="btn" href="${escapeHtml(siteUrl())}/tender/login">${escapeHtml(label)}</a>` +
    `<p style="font-size:12px;color:#666">Sign in with your email address: the page sends you a fresh one-time link.</p>`
}

function wrap(title: string, contentHtml: string, projectName = ''): string {
  return renderBrandedEmail({ accentColor: DEFAULT_ACCENT_COLOR, logoUrl: null, projectName, title, contentHtml, siteUrl: siteUrl() })
}

export function renderAddendumEmail(v: { projectName: string; tender: TenderRef; addendumTitle: string }): { subject: string; html: string } {
  const e = escapeHtml
  const closes = za(v.tender.closing_at ?? null)
  return {
    subject: `Addendum — ${tag(v.tender)}`,
    html: wrap(
      'Addendum published',
      `<p>An addendum has been published on <strong>${e(tag(v.tender))}</strong>:</p>` +
        `<p style="font-size:16px"><strong>${e(v.addendumTitle)}</strong></p>` +
        `<p>Read it on the portal and press <strong>Acknowledge</strong>. ` +
        `<strong>If you had already submitted, your bid has returned to draft:</strong> review it against the addendum, acknowledge, and submit again` +
        (closes ? ` before the closing time, <strong>${e(closes)}</strong>.` : ' before the closing time.') + `</p>` +
        portalButton(),
      v.projectName,
    ),
  }
}

export function renderAnswerEmail(v: { projectName: string; tender: TenderRef; questionTitle: string }): { subject: string; html: string } {
  const e = escapeHtml
  return {
    subject: `Question answered — ${tag(v.tender)}`,
    html: wrap(
      'Question answered',
      `<p>The engineer has published an answer on <strong>${e(tag(v.tender))}</strong>:</p>` +
        `<p style="font-size:16px"><strong>${e(v.questionTitle)}</strong></p>` +
        `<p>The question and its answer are visible to every tenderer (the asker is never named).</p>` +
        portalButton(),
      v.projectName,
    ),
  }
}

export function renderQuestionReceivedEmail(v: {
  projectName: string
  tender: TenderRef
  company: string
  questionTitle: string
  questionBody: string
  adminLink: string
}): { subject: string; html: string } {
  const e = escapeHtml
  return {
    subject: `Tender question from ${v.company} — ${tag(v.tender)}`,
    html: wrap(
      'Tender question received',
      `<p><strong>${e(v.company)}</strong> asked on <strong>${e(tag(v.tender))}</strong>:</p>` +
        `<p style="font-size:15px"><strong>${e(v.questionTitle)}</strong></p>` +
        `<p style="white-space:pre-wrap">${e(v.questionBody)}</p>` +
        `<a class="btn" href="${e(v.adminLink)}">Answer it</a>` +
        `<p style="font-size:12px;color:#666">Answer privately, or publish the answer to every tenderer.</p>`,
      v.projectName,
    ),
  }
}

export function renderReceiptEmail(v: {
  projectName: string
  tender: TenderRef
  companyName: string
  submittedAt: string
  total: number
  validityDays: number | null
}): { subject: string; html: string } {
  const e = escapeHtml
  return {
    subject: `Tender submitted — ${tag(v.tender)}`,
    html: wrap(
      'Your tender was submitted',
      `<p>This confirms that <strong>${e(v.companyName)}</strong> submitted a tender for <strong>${e(tag(v.tender))}</strong>.</p>` +
        `<ul>` +
        `<li>Submitted: <strong>${e(za(v.submittedAt))}</strong></li>` +
        `<li>Tender total: <strong>${e(money(v.total))}</strong> excl. VAT</li>` +
        (v.tender.closing_at ? `<li>Closing time: ${e(za(v.tender.closing_at))}</li>` : '') +
        (v.validityDays ? `<li>Your offer stays open for acceptance for ${v.validityDays} days after closing.</li>` : '') +
        `</ul>` +
        `<p>Your prices and documents stay sealed until the closing time. You can withdraw, change and re-submit until then.</p>` +
        portalButton(),
      v.projectName,
    ),
  }
}

export function renderClosingExtendedEmail(v: { projectName: string; tender: TenderRef; newClosing: string }): { subject: string; html: string } {
  const e = escapeHtml
  return {
    subject: `Closing time extended — ${tag(v.tender)}`,
    html: wrap(
      'Closing time extended',
      `<p>The closing time for <strong>${e(tag(v.tender))}</strong> has been extended to ` +
        `<strong>${e(za(v.newClosing))}</strong>.</p>` +
        portalButton(),
      v.projectName,
    ),
  }
}

export function renderCancelledEmail(v: { projectName: string; tender: TenderRef }): { subject: string; html: string } {
  const e = escapeHtml
  return {
    subject: `Tender cancelled — ${tag(v.tender)}`,
    html: wrap(
      'Tender cancelled',
      `<p><strong>${e(tag(v.tender))}</strong> has been cancelled. No bids will be opened: anything you submitted stays sealed, permanently.</p>` +
        `<p>We apologise for the time you have spent. Any re-invitation will come as a fresh invitation email.</p>`,
      v.projectName,
    ),
  }
}

/**
 * Everyone the tender has been issued to: every live invitation's address
 * (prepared, sent or accepted — a participant's account address equals their
 * invitation's by construction), deduped. Read through the CALLER's session,
 * so only a tender manager can build the list.
 */
export async function tenderAudience(supabase: AnyClient, tenderId: string): Promise<string[]> {
  const { data } = await supabase
    .schema('projects')
    .from('tender_invitations')
    .select('email, status')
    .eq('tender_id', tenderId)
    .in('status', ['prepared', 'sent', 'accepted'])
  const seen = new Set<string>()
  for (const r of (data ?? []) as { email: string }[]) seen.add(r.email.trim().toLowerCase())
  return Array.from(seen)
}

/** Fan an email out; report counts and never throw. Does nothing while the switch is off. */
export async function sendToMany(addresses: string[], subject: string, html: string): Promise<{ sent: number; failed: number; off: boolean }> {
  if (!tenderInvitesEnabled()) return { sent: 0, failed: 0, off: true }
  let sent = 0
  let failed = 0
  for (const to of addresses) {
    const r = await sendTenderEmail(to, subject, html)
    if ('ok' in r) sent += 1
    else failed += 1
  }
  return { sent, failed, off: false }
}
