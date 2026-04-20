import { baseTemplate, escape } from './base.ts'

export function conversionPrompt(vars: {
  firstName: string
  projectName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  const projectName = escape(vars.projectName || 'your new project')
  return {
    subject: `Add ${projectName} to your paid plan`,
    html: baseTemplate({
      preheader: 'R500 per project per month. No annual lock-in. Cancel anytime.',
      heading: `Adding ${projectName}, ${firstName}?`,
      bodyHtml: `
        <p style="margin:0 0 12px">Looks like you're about to run a second project on E-Site — great to see.</p>
        <p style="margin:0 0 12px">Here's how the pricing works:</p>
        <ul style="margin:0 0 12px;padding-left:20px">
          <li style="margin-bottom:6px">Your first project is always free</li>
          <li style="margin-bottom:6px">Each additional project: <strong style="color:#EDE8DF">R500/month</strong></li>
          <li style="margin-bottom:6px">No annual lock-in — cancel any project any time</li>
          <li>Cancel a project, your data is retained for 90 days</li>
        </ul>
        <p style="margin:0 0 12px">One click to activate ${projectName}:</p>
      `,
      ctaLabel: `Activate ${projectName}`,
      ctaHref: `${vars.siteUrl}/settings/billing`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
