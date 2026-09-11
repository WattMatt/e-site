import { baseTemplate, escape } from './base.ts'

/**
 * Day 1 — one concrete win.
 *
 * ⚠ REWRITTEN, not re-pointed. This template used to send people to
 * `${siteUrl}/compliance` and describe "opening a subsection on your project"
 * to upload a COC. Commit debd883 (2026-05-18) deleted `(admin)/compliance/**`
 * wholesale; there are no subsections and no COC upload anywhere in the product
 * any more, so swapping the URL would have left a body describing a screen that
 * does not exist. The nearest live compliance surfaces (/projects/[id]/inspections,
 * /projects/[id]/handover) are all project-scoped and this template is rendered
 * with no project context — see onboarding-d1/index.ts, which passes firstName
 * and nothing else — so there is no honest project-scoped link to send.
 *
 * The site diary is what replaced it as the two-minute first win: /diary is a
 * real top-level route, it is open to every org member rather than owner/admin
 * (see apps/web/src/app/(admin)/diary/page.tsx — membership only, no role gate),
 * and it is by a wide margin the most-used module in production. It also keeps
 * the original promise of the email, which was speed rather than compliance
 * specifically.
 */
export function onboardingD1(vars: {
  firstName: string
  siteUrl: string
  unsubscribeUrl: string
}) {
  const firstName = escape(vars.firstName || 'there')
  return {
    subject: 'Log your first site diary entry — 2 minutes',
    html: baseTemplate({
      preheader: 'The fastest path to value on E-Site is the first diary entry.',
      heading: `One quick win for today, ${firstName}`,
      bodyHtml: `
        <p style="margin:0 0 12px">If you logged something on site yesterday — skip this email, you're already rolling.</p>
        <p style="margin:0 0 12px">If not: try it now. Open the site diary, pick the project, write what happened today and attach a photo. It takes about two minutes.</p>
        <p style="margin:0 0 12px">Every entry is timestamped against the project and the person who wrote it, and it stops being a WhatsApp message you have to find again in four months when someone asks who was on site that day.</p>
      `,
      ctaLabel: 'Log a diary entry',
      ctaHref: `${vars.siteUrl}/diary`,
      siteUrl: vars.siteUrl,
      unsubscribeUrl: vars.unsubscribeUrl,
    }),
  }
}
