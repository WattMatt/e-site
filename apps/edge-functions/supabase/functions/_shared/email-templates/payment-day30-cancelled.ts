import { baseTemplate, escape } from './base.ts'

export function paymentDay30Cancelled(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'E-Site subscription cancelled — data kept for 90 days',
    html: baseTemplate({
      preheader: 'We\u2019ll keep your compliance records safe for 90 days.',
      heading: `Subscription cancelled, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Your E-Site subscription has been cancelled after 30 days of failed payments.</p>
        <p style="margin:0 0 12px"><strong style="color:#EDE8DF">Your data is preserved for 90 days.</strong> If you come back within that window — same login, everything's there. Reactivating is a single click once your card works.</p>
        <p style="margin:0 0 12px">If E-Site isn't the right fit any more, reply to this email and let me know what happened. I read every reply personally, and the feedback helps us build a better product.</p>
        <p style="margin:0 0 12px">— Arno</p>
      `,
      ctaLabel: 'Reactivate my account',
      ctaHref: `${vars.siteUrl}/settings/billing`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
