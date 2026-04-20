import { baseTemplate, escape } from './base.ts'

export function onboardingD7(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Share your compliance dashboard with your client',
    html: baseTemplate({
      preheader: 'The client portal is the single biggest thing contractors say wins them their next job.',
      heading: `Share the good news with your client, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">A week in — chances are you've got a stack of signed-off COCs, handover photos, and a tidy snag list.</p>
        <p style="margin:0 0 12px">The contractors getting the most out of E-Site share that view directly with their client. It takes 30 seconds and turns your compliance record into a sales tool.</p>
        <p style="margin:0 0 12px">Send your client a one-click portal link. No password for them, no admin on you — they just see exactly where the project stands, 24/7.</p>
      `,
      ctaLabel: 'Invite my client',
      ctaHref: `${vars.siteUrl}/settings/team`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
