import { baseTemplate, escape } from './base.ts'

export function paymentDay14Paused(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Your E-Site projects are now read-only',
    html: baseTemplate({
      preheader: 'Data is safe. Update your card to restore uploads.',
      heading: `Projects paused, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Your E-Site projects are now in read-only mode because payment has been failing for two weeks.</p>
        <p style="margin:0 0 12px"><strong style="color:#EDE8DF">Your data is safe</strong> — everything you've uploaded is still there, visible to you and your team.</p>
        <p style="margin:0 0 12px">Read-only means:</p>
        <ul style="margin:0 0 12px;padding-left:20px">
          <li style="margin-bottom:4px">No new snags, photos, COCs, or diary entries</li>
          <li style="margin-bottom:4px">No new projects</li>
          <li>Everything returns to normal the moment payment succeeds</li>
        </ul>
        <p style="margin:0 0 12px">You have 16 days before cancellation. Update your card to restore access today.</p>
      `,
      ctaLabel: 'Restore my account',
      ctaHref: `${vars.siteUrl}/settings/billing`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
