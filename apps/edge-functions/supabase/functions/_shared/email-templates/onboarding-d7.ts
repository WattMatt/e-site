import { baseTemplate, escape } from './base.ts'

/**
 * Day 7 — share the record with the client.
 *
 * ⚠ `${siteUrl}/settings/team` was renamed to `/settings/users` in commit
 * 1237649 (2026-05-20), and because `safe-next` allows the `/settings` prefix,
 * signing in from this email forwarded the recipient into a "Page not found"
 * rather than merely dropping them somewhere unhelpful.
 *
 * ⚠ KNOWN, ACCEPTED BOUNCE — same as onboarding-d3.ts, and for the same reason:
 * /settings/users is OWNER_ADMIN-gated (settings/users/page.tsx:52) and
 * redirects contractors and client_viewers to /dashboard. Adding a client to
 * the account is an owner/admin action and has no non-admin equivalent screen,
 * and narrowing the recipient set belongs in onboarding-d7/index.ts, not here.
 * The body now names that so a non-admin is not left guessing.
 */
export function onboardingD7(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Share your project record with your client',
    html: baseTemplate({
      preheader: 'The client portal is the single biggest thing contractors say wins them their next job.',
      heading: `Share the good news with your client, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">A week in — chances are you've got diary entries, site photos, and a tidy snag list.</p>
        <p style="margin:0 0 12px">The contractors getting the most out of E-Site share that view directly with their client. It takes 30 seconds and turns your project record into a sales tool.</p>
        <p style="margin:0 0 12px">Add your client as a viewer and they get their own portal link — they see exactly where the project stands, 24/7, and can't change anything.</p>
        <p style="margin:0 0 12px">Adding people is an account-owner job. If that isn't you, forward this to whoever set up your E-Site account.</p>
      `,
      ctaLabel: 'Invite my client',
      ctaHref: `${vars.siteUrl}/settings/users`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
