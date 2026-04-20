import { baseTemplate, escape } from './base.ts'

export function paymentDay7FinalWarning(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Final warning — E-Site projects pause in 7 days',
    html: baseTemplate({
      preheader: 'Read-only in 7 days. 30 seconds to fix.',
      heading: `Final warning, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Your payment has been failing for a week. Unless we can charge your card in the next 7 days, your E-Site projects go into read-only mode:</p>
        <ul style="margin:0 0 12px;padding-left:20px">
          <li style="margin-bottom:4px">Existing photos / COCs / snags remain visible</li>
          <li style="margin-bottom:4px">No new uploads or new projects</li>
          <li>Restored instantly once payment goes through</li>
        </ul>
        <p style="margin:0 0 12px">Takes under a minute.</p>
      `,
      ctaLabel: 'Update my card now',
      ctaHref: `${vars.siteUrl}/settings/billing`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
