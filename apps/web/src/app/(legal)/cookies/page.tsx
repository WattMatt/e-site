import type { Metadata } from 'next'
import { H1, H2, P, Ul, LastUpdated, LegalPlaceholderBanner } from '@/components/layout/LegalPlaceholder'

export const metadata: Metadata = {
  title: 'Cookie Policy — E-Site',
}

// Phase 1 placeholder. Spec: spec-v2.md §19. E-Site uses functional cookies
// only in Phase 1 — no tracking cookies, no ad cookies. Short doc by design.

export default function CookiesPage() {
  return (
    <div>
      <H1>Cookie Policy</H1>
      <LastUpdated iso="2026-04-19" />
      <LegalPlaceholderBanner>
        Short content; minor drafting review needed. Reflects actual Phase 1 behaviour.
      </LegalPlaceholderBanner>

      <H2>1. What we use cookies for</H2>
      <P>
        E-Site uses <strong>functional cookies only</strong> — the ones without which the product
        cannot work. No advertising cookies, no third-party tracking cookies, no analytics cookies
        that identify individuals.
      </P>

      <H2>2. The specific cookies</H2>
      <Ul>
        <li>
          <strong>Authentication cookies</strong> (Supabase): keep you logged in between page loads.
          Expire when you log out.
        </li>
        <li>
          <strong>CSRF protection tokens</strong>: stop a malicious site from submitting forms on
          your behalf. Session-scoped.
        </li>
        <li>
          <strong>Viewport / interface preferences</strong> (localStorage): remember sidebar state,
          table sort order. Never sent to our servers.
        </li>
      </Ul>

      <H2>3. Analytics</H2>
      <P>
        We use PostHog for product analytics. It is configured to run in aggregate-only mode — no
        auto-capture of clicks, no session recordings with form inputs, no cross-site tracking. You
        can opt out entirely by emailing the Information Officer.
      </P>

      <H2>4. Managing cookies</H2>
      <P>
        Because we use only functional cookies, there is no cookie banner — there is nothing for
        you to opt out of. If you clear your browser cookies you will be logged out; that is the
        full extent of the impact.
      </P>
    </div>
  )
}
