import { baseTemplate, escape } from './base.ts'

export function paymentDay0Failed(vars: {
  firstName: string
  amountZAR: string          // formatted "R499.00"
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  const amount = escape(vars.amountZAR)
  return {
    subject: 'Payment didn\u2019t go through',
    html: baseTemplate({
      preheader: 'We\u2019ll retry automatically over the next few days.',
      heading: `Payment didn\u2019t go through, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Your ${amount} E-Site payment was declined. No action needed right now — we'll automatically retry over the next few days.</p>
        <p style="margin:0 0 12px">If it was a temporary issue (offline machine, daily limit, etc.) the retry will pick it up. If the card is bad, you can update it early and we'll stop bothering you.</p>
      `,
      ctaLabel: 'Update my card',
      ctaHref: `${vars.siteUrl}/settings/billing`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
