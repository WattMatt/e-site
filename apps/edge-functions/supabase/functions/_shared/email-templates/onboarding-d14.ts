import { baseTemplate, escape } from './base.ts'

export function onboardingD14(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Two weeks in — how is E-Site working for you?',
    html: baseTemplate({
      preheader: 'One founder, one inbox. Replies come straight to Arno.',
      heading: `Quick check-in, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">Two weeks in. You've seen what E-Site can do. The question I care about:</p>
        <p style="margin:0 0 12px;color:#EDE8DF;font-style:italic">"What's the one thing that would make E-Site a no-brainer for you?"</p>
        <p style="margin:0 0 12px">Hit reply — it comes straight to me (Arno, founder). No support desk, no form, no AI. If something is broken, I want to hear it. If something's missing, I want to build it.</p>
        <p style="margin:0 0 12px">If E-Site is working well — a short line is enough. It means a lot.</p>
      `,
      ctaLabel: 'Reply to this email',
      ctaHref: `mailto:arno@watsonmattheus.com?subject=E-Site%20feedback`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
