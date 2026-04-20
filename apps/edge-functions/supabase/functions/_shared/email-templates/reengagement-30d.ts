import { baseTemplate, escape } from './base.ts'

export function reengagement30d(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: '15 minutes with the founder?',
    html: baseTemplate({
      preheader: 'No pitch — a short call to understand what\u2019s not working.',
      heading: `Can we grab 15 minutes, ${firstName}?`,
      bodyHtml: `
        <p style="margin:0 0 12px">A month without logging in usually means one of two things: it's not useful enough, or the timing is wrong.</p>
        <p style="margin:0 0 12px">Either is fine — I just want to learn. No demo, no pitch. 15 minutes on the phone (or WhatsApp voice note if that's easier) so I can understand what would need to change to make E-Site worth your time.</p>
        <p style="margin:0 0 12px">Book a slot, or reply with a time that suits you.</p>
      `,
      ctaLabel: 'Book 15 minutes',
      ctaHref: `${vars.siteUrl}/feedback/call`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
