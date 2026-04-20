import { baseTemplate, escape } from './base.ts'

export function onboardingD1(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Upload your first COC — 2 minutes',
    html: baseTemplate({
      preheader: 'The fastest path to value on E-Site is the first COC.',
      heading: `One quick win for today, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">If you uploaded a COC yesterday — skip this email, you're already rolling.</p>
        <p style="margin:0 0 12px">If not: try it now. Open a subsection on your project, tap upload, pick the PDF. It takes about two minutes.</p>
        <p style="margin:0 0 12px">Every uploaded COC is tagged with the SANS reference, timestamped, and visible to your client the moment you share the portal with them.</p>
      `,
      ctaLabel: 'Upload a COC',
      ctaHref: `${vars.siteUrl}/compliance`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
