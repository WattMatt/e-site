/**
 * Invite + site-assignment email dispatch (web side).
 *
 * `sendInviteEmail` replaces the bare Supabase `resetPasswordForEmail()` call
 * that every user-provisioning action previously used. Instead it:
 *   1. Generates a recovery ACTION LINK via the admin API (this does NOT send
 *      an email — we control the message).
 *   2. Renders the branded, context-rich invite via `@esite/shared`.
 *   3. Sends it through the `send-email` Edge Function (`invite` passthrough).
 *
 * It NEVER throws — a mail failure must not roll back a created user — and on
 * ANY failure it falls back to the plain Supabase recovery email so an invited
 * user always has a way to set their password. This makes the change safe to
 * ship even if the branded path has a bug: the worst case is the old behaviour.
 *
 * `sendSiteAssignmentEmail` notifies an EXISTING user that they've been given
 * access to a specific site (no password step).
 */

import { renderInviteEmail, renderSiteAssignmentEmail } from '@esite/shared'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  'https://app.e-site.live'
).replace(/\/$/, '')

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? APP_URL).replace(/\/$/, '')

const RECOVERY_REDIRECT = `${APP_URL}/auth/callback?next=/reset-password/confirm`

/** Fetch an organisation's display name (service-role read). Never throws — an
 *  email-context lookup failure must not break the surrounding provisioning. */
export async function getOrgName(service: ServiceClient, orgId: string): Promise<string> {
  try {
    const { data } = await (service as unknown as {
      from: (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { name?: string | null } | null }> } }
      }
    })
      .from('organisations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle()
    return data?.name?.trim() || 'your company'
  } catch {
    return 'your company'
  }
}

/**
 * Resolve the human context for an invite email: the inviter's full name and
 * the target org's name. Service-role reads (the inviter may not be able to
 * read a sub-org profile under RLS). Never throws — returns safe fallbacks.
 */
export async function resolveInviteContext(
  service: ServiceClient,
  opts: { inviterId: string; orgId: string },
): Promise<{ inviterName: string; orgName: string }> {
  try {
    const [profRes, orgName] = await Promise.all([
      (service as unknown as {
        from: (t: string) => {
          select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { full_name?: string | null } | null }> } }
        }
      })
        .from('profiles')
        .select('full_name')
        .eq('id', opts.inviterId)
        .maybeSingle(),
      getOrgName(service, opts.orgId),
    ])
    return {
      inviterName: profRes.data?.full_name?.trim() || 'A team member',
      orgName,
    }
  } catch {
    return { inviterName: 'A team member', orgName: 'your company' }
  }
}

export interface SendInviteEmailArgs {
  /** Service-role client (admin API + edge invoke). */
  service: ServiceClient
  /** Invited email address. */
  email: string
  /** Full name of the person who added them. */
  inviterName: string
  /** Company/organisation they were added to (e.g. "Bob's Building"). */
  orgName: string
  /** Their role slug within that org. */
  role: string
  /** Site(s) assigned at invite time, if any. */
  siteNames?: string[]
  /** For contractor sub-orgs, the managing company (adds trust/context). */
  managingCompanyName?: string | null
}

export interface InviteEmailResult {
  ok: boolean
  /** Non-fatal message to surface to the admin (e.g. fallback used). */
  warning?: string
}

/**
 * Send the branded "you've been added — set your password" invite to a new
 * user. Falls back to the plain recovery email on any failure. Never throws.
 */
export async function sendInviteEmail(args: SendInviteEmailArgs): Promise<InviteEmailResult> {
  try {
    // 1. Recovery action link (no email sent by this call).
    const { data: linkData, error: linkErr } = await args.service.auth.admin.generateLink({
      type: 'recovery',
      email: args.email,
      options: { redirectTo: RECOVERY_REDIRECT },
    })
    const actionLink = (linkData as { properties?: { action_link?: string } } | null)?.properties
      ?.action_link
    if (linkErr || !actionLink) throw linkErr ?? new Error('generateLink returned no action_link')

    // 2. Render branded email.
    const { subject, html } = renderInviteEmail({
      recipientEmail: args.email,
      inviterName: args.inviterName,
      orgName: args.orgName,
      role: args.role,
      siteNames: args.siteNames,
      actionLink,
      siteUrl: SITE_URL,
      managingCompanyName: args.managingCompanyName ?? null,
    })

    // 3. Deliver via the send-email Edge Function (invite passthrough).
    const { error: sendErr } = await args.service.functions.invoke('send-email', {
      body: { type: 'invite', payload: { to: args.email, subject, html } },
    })
    if (sendErr) throw sendErr

    return { ok: true }
  } catch (e) {
    console.error('[invite-email] branded invite failed; falling back to recovery email', {
      email: args.email,
      err: String(e),
    })
    return await sendRecoveryFallback(args.service, args.email)
  }
}

/** Plain Supabase recovery email — the pre-existing behaviour, used as a safety net. */
async function sendRecoveryFallback(
  service: ServiceClient,
  email: string,
): Promise<InviteEmailResult> {
  const { error } = await service.auth.resetPasswordForEmail(email, {
    redirectTo: RECOVERY_REDIRECT,
  })
  if (error) {
    console.error('[invite-email] recovery fallback also failed', { email, err: String(error) })
    return {
      ok: false,
      warning:
        'User created, but the invite email could not be sent. They can use “Forgot password” on the sign-in page.',
    }
  }
  return {
    ok: true,
    warning:
      'User created and a basic set-password email was sent (the branded invite could not be generated).',
  }
}

export interface SendSiteAssignmentEmailArgs {
  service: ServiceClient
  email: string
  inviterName: string
  siteName: string
  projectId: string
  role: string
}

/**
 * Notify an EXISTING user that they were given access to a specific site.
 * Best-effort — never throws; a mail failure must not block the assignment.
 */
export async function sendSiteAssignmentEmail(args: SendSiteAssignmentEmailArgs): Promise<void> {
  try {
    const { subject, html } = renderSiteAssignmentEmail({
      inviterName: args.inviterName,
      siteName: args.siteName,
      projectId: args.projectId,
      role: args.role,
      siteUrl: SITE_URL,
    })
    const { error } = await args.service.functions.invoke('send-email', {
      body: { type: 'invite', payload: { to: args.email, subject, html } },
    })
    if (error) throw error
  } catch (e) {
    console.error('[invite-email] site-assignment email failed', {
      email: args.email,
      projectId: args.projectId,
      err: String(e),
    })
  }
}
