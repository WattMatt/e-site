import { baseTemplate, escape } from './base.ts'

export function paymentDay3RetryFailed(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'E-Site payment retry also failed — please update your card',
    html: baseTemplate({
      preheader: 'A few seconds to update your card keeps everything running.',
      heading: `Retry also declined, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Our automatic retry also came back declined. Nothing is switched off yet — but we need you to update your card to keep things running.</p>
        <p style="margin:0 0 12px">What happens if nothing changes:</p>
        <ul style="margin:0 0 12px;padding-left:20px">
          <li style="margin-bottom:4px">In 4 days — another retry + a final warning</li>
          <li style="margin-bottom:4px">In 11 days — your projects go into read-only</li>
          <li>In 27 days — subscription cancelled (your data is kept for 90 days regardless)</li>
        </ul>
      `,
      ctaLabel: 'Update my card',
      ctaHref: `${vars.siteUrl}/settings/billing`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
