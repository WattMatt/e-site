import { baseTemplate, escape } from './base.ts'

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
        <p style="margin:0 0 12px">It takes 30 seconds. Add their cell number, they get an SMS, they install the mobile app.</p>
        <p style="margin:0 0 12px">The mobile app works offline — site photos and snags queue up and sync when they get back to signal.</p>
      `,
      ctaLabel: 'Invite a field worker',
      ctaHref: `${vars.siteUrl}/settings/team`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
