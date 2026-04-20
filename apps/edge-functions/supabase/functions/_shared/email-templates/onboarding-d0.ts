import { baseTemplate, escape } from './base.ts'

export function onboardingD0(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Welcome to E-Site — 3 steps to get started',
    html: baseTemplate({
      preheader: 'Complete your first project setup in under 3 minutes.',
      heading: `Welcome to E-Site, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Thanks for signing up. E-Site is built for one job — giving SA electrical contractors a way to run compliance, snags, site diary and handover without the paperwork chaos.</p>
        <p style="margin:0 0 12px"><strong style="color:#EDE8DF">Three things for today:</strong></p>
        <ol style="margin:0 0 12px;padding-left:20px">
          <li style="margin-bottom:6px">Create your first project</li>
          <li style="margin-bottom:6px">Add a site + subsection</li>
          <li>Upload your first COC PDF</li>
        </ol>
        <p style="margin:0 0 12px">Your first project is free. When you add your second, it's R500/month — no annual lock-in.</p>
      `,
      ctaLabel: 'Start my first project',
      ctaHref: `${vars.siteUrl}/projects/new`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
