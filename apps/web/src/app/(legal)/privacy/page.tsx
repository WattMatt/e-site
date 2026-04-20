import type { Metadata } from 'next'
import { H1, H2, P, Ul, LastUpdated, LegalPlaceholderBanner } from '@/components/layout/LegalPlaceholder'

export const metadata: Metadata = {
  title: 'Privacy Policy — E-Site',
  description: 'How E-Site collects, stores and processes personal information under POPIA.',
}

// Phase 1 placeholder. Spec: spec-v2.md §19. Covers POPIA §18 disclosure
// requirements + ECTA §43. Lawyer to draft final copy before launch.

export default function PrivacyPage() {
  return (
    <div>
      <H1>Privacy Policy</H1>
      <LastUpdated iso="2026-04-19" />
      <LegalPlaceholderBanner />

      <H2>1. Who we are</H2>
      <P>
        E-Site is a site management platform operated by Watson Mattheus (Pty) Ltd, a South African
        company. The responsible party under the Protection of Personal Information Act, 2013 (POPIA)
        is Watson Mattheus (Pty) Ltd, and the Information Officer is Arno Mattheus
        (<a href="mailto:arno@watsonmattheus.com" style={{ color: 'var(--c-text-mid)' }}>arno@watsonmattheus.com</a>).
      </P>

      <H2>2. What we collect</H2>
      <P>
        Final section to be drafted by legal counsel. Required disclosures include: profile data
        (name, email, phone), authentication data, organisation membership, uploaded compliance
        documents, site photographs, project metadata, and billing information (card tokens and
        transaction references held by our payment processor Paystack — we never store full card
        numbers).
      </P>

      <H2>3. How we use it</H2>
      <P>
        To provide the service, to process payments, to communicate about your account, and for
        anonymised product analytics. Detailed purpose list to follow from legal counsel.
      </P>

      <H2>4. Legal basis for processing</H2>
      <P>
        POPIA §11 lawful basis grounds: performance of contract, legitimate interest (product
        improvement), and explicit consent (marketing communications — see{' '}
        <a href="/unsubscribe" style={{ color: 'var(--c-text-mid)' }}>opt-out</a>).
      </P>

      <H2>5. Who we share it with</H2>
      <Ul>
        <li>Supabase (EU — Frankfurt) — database, auth, storage.</li>
        <li>Paystack (South Africa) — card tokenisation and payment processing.</li>
        <li>Resend (EU) — transactional email delivery.</li>
        <li>Sentry (US / EU) — error monitoring (IP + stack traces only).</li>
        <li>PostHog (EU) — product analytics (aggregated, no personal identifiers).</li>
        <li>PowerSync (AU) — offline sync infrastructure for the mobile app.</li>
      </Ul>

      <H2>6. Cross-border transfer</H2>
      <P>
        Personal information is stored in the EU (Frankfurt) by default. See the processor list
        above for the jurisdictions involved. We rely on Data Processing Addenda with each
        processor and, where applicable, Standard Contractual Clauses.
      </P>

      <H2>7. How long we keep it</H2>
      <P>
        For the duration of your subscription, plus 90 days after cancellation. Compliance records
        may be retained longer where required by statute (e.g. records required by the
        Occupational Health and Safety Act or the National Building Regulations).
      </P>

      <H2>8. Your rights</H2>
      <P>
        Under POPIA you may request access to, correction of, or deletion of your personal
        information. Use our <a href="/privacy/request" style={{ color: 'var(--c-text-mid)' }}>data subject request form</a>{' '}
        or email the Information Officer directly.
      </P>

      <H2>9. Security</H2>
      <P>
        TLS in transit, encryption at rest (Supabase managed), role-based access via row-level
        security policies, and dedicated per-organisation data isolation.
      </P>

      <H2>10. Breach notification</H2>
      <P>
        We will notify affected users and the Information Regulator as required by POPIA §22 in the
        event of a security compromise.
      </P>

      <H2>11. Contact and complaints</H2>
      <P>
        Information Officer: Arno Mattheus (arno@watsonmattheus.com). If you are not satisfied with
        our handling of your complaint you may lodge a complaint with the Information Regulator of
        South Africa.
      </P>
    </div>
  )
}
