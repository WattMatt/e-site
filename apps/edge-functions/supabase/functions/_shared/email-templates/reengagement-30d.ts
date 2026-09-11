import { baseTemplate, escape } from './base.ts'

/**
 * 30 days inactive — the founder asks for 15 minutes.
 *
 * ⚠ The CTA used to be `${siteUrl}/feedback/call`, which has NEVER existed —
 * not deleted, never built. There is no booking route in the app and no
 * scheduling tool configured anywhere in the platform, so there is nothing to
 * point a URL at. Rather than invent a third-party booking link that nobody
 * owns and nobody will notice going stale, this uses the same mailto: pattern
 * onboarding-d14.ts already ships: it reaches the one person the email says it
 * reaches, and it cannot rot when a route is renamed.
 */
export function reengagement30d(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: '15 minutes with the founder?',
    html: baseTemplate({
      preheader: 'No pitch — a short call to understand what’s not working.',
      heading: `Can we grab 15 minutes, ${firstName}?`,
      bodyHtml: `
        <p style="margin:0 0 12px">A month without logging in usually means one of two things: it's not useful enough, or the timing is wrong.</p>
        <p style="margin:0 0 12px">Either is fine — I just want to learn. No demo, no pitch. 15 minutes on the phone (or WhatsApp voice note if that's easier) so I can understand what would need to change to make E-Site worth your time.</p>
        <p style="margin:0 0 12px">Reply with a couple of times that suit you and I'll call — it comes straight to me (Arno, founder), not a support desk.</p>
      `,
      ctaLabel: 'Send me a time',
      ctaHref: `mailto:arno@watsonmattheus.com?subject=15%20minutes%20-%20E-Site`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
