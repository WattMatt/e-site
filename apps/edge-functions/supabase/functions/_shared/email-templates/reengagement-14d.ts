import { baseTemplate, escape } from './base.ts'

export function reengagement14d(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'A feature you probably haven\u2019t tried yet',
    html: baseTemplate({
      preheader: 'Offline site diary + voice notes — the thing SA contractors love most.',
      heading: `Try this, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Two weeks in and not much activity — before you decide E-Site isn't for you, one feature worth a look:</p>
        <p style="margin:0 0 12px"><strong style="color:#EDE8DF">Offline site diary with voice-to-text.</strong> On site, tap the mic, speak your daily note, done. It syncs when signal's back. No typing on a phone mid-pour.</p>
        <p style="margin:0 0 12px">Your foreman can do the whole day's handover notes in the time it takes to roll up a cable.</p>
      `,
      ctaLabel: 'Open the site diary',
      ctaHref: `${vars.siteUrl}/diary`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
