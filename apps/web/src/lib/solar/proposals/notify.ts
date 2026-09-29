import 'server-only'
/**
 * Proposal notifications. Never throws. The client email is sent ONLY when the issuer ticked it AND
 * the project's notify_solar_email is on (checked by the caller); the issuer's bell always fires on
 * a response, the email only with the toggle on. Uses send-email's `rfi-created` passthrough.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { escapeHtml, filterSuppressed, renderBrandedEmail } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { notifySolarUsers } from '@/lib/solar/notify'
import { NEUTRAL_ACCENT } from '@/lib/solar/reports/branding'
import { solarEmailEnabled } from './email-toggle'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')

export async function sendProposalToClients(a: {
  emails: string[]; projectName: string; orgName: string; link: string; validUntil: string; accent: string | null
}): Promise<number> {
  if (a.emails.length === 0) return 0
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return 0
    const { allowed } = await filterSuppressed(createServiceClient() as never, a.emails)
    if (allowed.length === 0) return 0
    const title = `${a.orgName}: solar proposal for ${a.projectName}`
    const html = renderBrandedEmail({
      accentColor: a.accent && /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent : NEUTRAL_ACCENT,
      logoUrl: null,
      projectName: a.projectName,
      title,
      contentHtml:
        `<p>${escapeHtml(a.orgName)} has sent you a solar PV proposal for ${escapeHtml(a.projectName)}.</p>` +
        `<p><a href="${escapeHtml(a.link)}">Open the proposal</a> to read it, download the PDF, and accept or decline.</p>` +
        `<p>The offer is valid until ${escapeHtml(a.validUntil.slice(0, 10))}. The link is personal to you — please do not forward it.</p>`,
      siteUrl: siteUrl(),
    })
    const res = await fetch(`${url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ type: 'rfi-created', payload: { to: allowed, subject: title, html } }),
    })
    if (!res.ok) { console.error('[solar-proposal] client email failed', { status: res.status }); return 0 }
    return allowed.length
  } catch (e) {
    console.error('[solar-proposal] client email threw', { err: String(e) })
    return 0
  }
}

export async function notifyProposalResponse(a: {
  projectId: string; issuedBy: string | null; version: number; decision: 'accepted' | 'declined'; actorName: string
}): Promise<void> {
  if (!a.issuedBy) return
  try {
    const svc = createServiceClient() as unknown as AnyClient
    const [{ data: prof }, { data: proj }] = await Promise.all([
      svc.from('profiles').select('email').eq('id', a.issuedBy).maybeSingle(),
      svc.schema('projects').from('projects').select('name').eq('id', a.projectId).maybeSingle(),
    ])
    const email = (prof as { email?: string | null } | null)?.email ?? null
    const projectName = (proj as { name?: string } | null)?.name ?? 'the project'
    const verb = a.decision === 'accepted' ? 'accepted' : 'declined'
    await notifySolarUsers([a.issuedBy], email ? [email] : [], {
      type: a.decision === 'accepted' ? 'solar_proposal_accepted' : 'solar_proposal_declined',
      projectId: a.projectId, projectName,
      title: `Proposal v${a.version} ${verb}`,
      body: `${a.actorName} ${verb} proposal v${a.version} for ${projectName}.`,
      route: `/projects/${a.projectId}/solar/reports`,
      email: await solarEmailEnabled(a.projectId),
    })
  } catch (e) {
    console.error('[solar-proposal] response notification failed', { err: String(e) })
  }
}
