import type { Metadata } from 'next'
import { H1, H2, P, Ul, LastUpdated, LegalPlaceholderBanner } from '@/components/layout/LegalPlaceholder'

export const metadata: Metadata = {
  title: 'Terms of Service — E-Site',
  description: 'The terms under which you may use the E-Site platform.',
}

// Phase 1 placeholder. Spec: spec-v2.md §19. Covers Consumer Protection Act
// "plain language" requirement + ECTA §11. Lawyer to draft final copy.

export default function TermsPage() {
  return (
    <div>
      <H1>Terms of Service</H1>
      <LastUpdated iso="2026-04-19" />
      <LegalPlaceholderBanner />

      <H2>1. About these terms</H2>
      <P>
        These terms govern your use of the E-Site platform, operated by Watson Mattheus (Pty) Ltd
        (&quot;we&quot;, &quot;us&quot;). By creating an account you agree to these terms. Written in plain English
        per the Consumer Protection Act, 2008.
      </P>

      <H2>2. The service</H2>
      <P>
        E-Site provides a web and mobile platform for South African contractors to manage projects,
        compliance records, site diary entries, snag lists, and related workflows. We may add,
        change or remove features from time to time with reasonable notice.
      </P>

      <H2>3. Pricing and billing</H2>
      <Ul>
        <li>Your first project on E-Site is free, for as long as you use it.</li>
        <li>Each additional active project: R500 per project per month, VAT inclusive.</li>
        <li>No annual lock-in. Cancel any project at any time.</li>
        <li>Payments processed by Paystack. Card details are tokenised — we never see them.</li>
        <li>Failed payments follow a 30-day recovery process before cancellation (see Payment Recovery on your billing page).</li>
      </Ul>

      <H2>4. Your content</H2>
      <P>
        You keep full ownership of everything you upload — photos, documents, notes, anything. We
        get a limited licence to store, process and display that content for the sole purpose of
        operating the service for you.
      </P>

      <H2>5. Acceptable use</H2>
      <P>
        See our <a href="/acceptable-use" style={{ color: 'var(--c-text-mid)' }}>Acceptable Use Policy</a>.
      </P>

      <H2>6. Cancellation and data retention</H2>
      <P>
        You can cancel any project any time from your billing page. Cancelled projects enter a
        90-day preservation window during which you can reactivate instantly. After 90 days without
        reactivation the project data is permanently deleted.
      </P>

      <H2>7. Liability</H2>
      <P>
        Final clauses to be drafted by legal counsel. In the interim: we limit our liability to the
        fees paid in the 12 months preceding the event giving rise to the claim. We are not liable
        for indirect, incidental or consequential losses.
      </P>

      <H2>8. Governing law and dispute resolution</H2>
      <P>
        South African law. Disputes are to be resolved by arbitration in Cape Town per the rules
        of the Arbitration Foundation of Southern Africa, save for small claims which may be heard
        in the magistrate&apos;s court of the consumer&apos;s choice per the Consumer Protection Act.
      </P>

      <H2>9. Changes to these terms</H2>
      <P>
        We may update these terms from time to time. Material changes require 30 days&apos; notice by
        email before taking effect.
      </P>

      <H2>10. Contact</H2>
      <P>
        General enquiries: <a href="mailto:hello@e-site.co.za" style={{ color: 'var(--c-text-mid)' }}>hello@e-site.co.za</a>.
      </P>
    </div>
  )
}
