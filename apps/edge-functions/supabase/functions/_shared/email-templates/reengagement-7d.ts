import { baseTemplate, escape } from './base.ts'

export function reengagement7d(vars: {
  firstName: string
  projectName?: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  const project = vars.projectName ? escape(vars.projectName) : null
  return {
    subject: project ? `Your ${project} project misses you` : 'Haven\u2019t seen you on E-Site this week',
    html: baseTemplate({
      preheader: 'A week without logging in — anything we can help with?',
      heading: `Still there, ${firstName}?`,
      bodyHtml: `
        <p style="margin:0 0 12px">You haven't logged into E-Site for about a week.${project ? ` Your <strong style="color:#EDE8DF">${project}</strong> project is sitting here waiting.` : ''}</p>
        <p style="margin:0 0 12px">If something is blocking you — a feature that's missing, a bug, or just the cost — I want to know. Hit reply; it comes to me directly.</p>
        <p style="margin:0 0 12px">Or if life just got in the way, here's a one-click back in:</p>
      `,
      ctaLabel: 'Open my dashboard',
      ctaHref: `${vars.siteUrl}/dashboard`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
