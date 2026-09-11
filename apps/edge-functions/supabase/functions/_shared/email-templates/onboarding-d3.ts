import { baseTemplate, escape } from './base.ts'

/**
 * Day 3 — get the team on.
 *
 * ⚠ TWO corrections here, both of which were describing a product that does
 * not exist.
 *
 * 1. `${siteUrl}/settings/team` was renamed to `/settings/users` in commit
 *    1237649 (2026-05-20). This one was worse than a dead link: `safe-next`
 *    allows the `/settings` prefix, so signing in from this email actively
 *    forwarded the recipient into a "Page not found".
 *
 * 2. The body said "Add their cell number, they get an SMS". There is no SMS
 *    provider anywhere in the platform — hook_send_sms_enabled is false, every
 *    Twilio credential is null, and the invite form has no phone field. The
 *    invite is an email with a set-password link. Copy now says that.
 *
 * ⚠ KNOWN, ACCEPTED BOUNCE: /settings/users redirects anyone who is not org
 * owner or admin to /dashboard (settings/users/page.tsx:52, OWNER_ADMIN). Of
 * the recipients this step has reached, 13 hold `contractor` and 4
 * `client_viewer`, and they will land on the dashboard rather than the invite
 * screen. That is accepted rather than fixed, for one reason: restricting the
 * step to owner/admin recipients means changing which users
 * onboarding-d3/index.ts selects, and inviting a colleague genuinely IS an
 * owner/admin action — there is no non-admin screen to send them to instead.
 * A /dashboard bounce is a strictly better outcome than the 404 this shipped
 * with, and the body now tells a non-admin what to do rather than leaving them
 * to work out why the button did nothing.
 */
export function onboardingD3(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Invite your first field worker',
    html: baseTemplate({
      preheader: 'E-Site pays back fastest when your guys on site are logging data themselves.',
      heading: `Get your team onto E-Site, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">E-Site's real value shows up when the guys on site are logging snags and photos on their phones — not when you're re-typing their WhatsApp messages into a PDF at 9pm.</p>
        <p style="margin:0 0 12px">It takes 30 seconds. Add their email address, they get an invite with a link to set a password, and they're in.</p>
        <p style="margin:0 0 12px">The mobile app works offline — site photos and snags queue up and sync when they get back to signal.</p>
        <p style="margin:0 0 12px">Adding people is an account-owner job. If that isn't you, forward this to whoever set up your E-Site account.</p>
      `,
      ctaLabel: 'Invite a field worker',
      ctaHref: `${vars.siteUrl}/settings/users`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
