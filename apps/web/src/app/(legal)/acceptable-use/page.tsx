import type { Metadata } from 'next'
import { H1, H2, P, Ul, LastUpdated, LegalPlaceholderBanner } from '@/components/layout/LegalPlaceholder'

export const metadata: Metadata = {
  title: 'Acceptable Use Policy — E-Site',
}

// Phase 1 placeholder. Spec: spec-v2.md §19. Platform protection — prohibited
// uses + termination conditions. Lawyer to draft final copy.

export default function AcceptableUsePage() {
  return (
    <div>
      <H1>Acceptable Use Policy</H1>
      <LastUpdated iso="2026-04-19" />
      <LegalPlaceholderBanner />

      <H2>1. The short version</H2>
      <P>
        E-Site is a tool for legitimate South African construction work. Don&apos;t use it to break the
        law, harm other users, or abuse the platform. If in doubt, ask first.
      </P>

      <H2>2. What is prohibited</H2>
      <Ul>
        <li>Uploading content that is illegal, defamatory, hateful or infringes anyone&apos;s rights.</li>
        <li>Uploading malware, viruses or any code intended to disrupt the platform or other users&apos; systems.</li>
        <li>Attempting to access data belonging to other organisations — including via automated means.</li>
        <li>Reverse-engineering, scraping or bulk-downloading the service beyond your own organisation&apos;s data.</li>
        <li>Creating multiple accounts to evade billing, bans or usage limits.</li>
        <li>Using the platform to send spam, unsolicited marketing, or to impersonate another party.</li>
        <li>Uploading client or site data you do not have authority to upload.</li>
      </Ul>

      <H2>3. Data you upload</H2>
      <P>
        You confirm that you have the right to upload every file and data point to E-Site. If a
        third party (e.g. a client, or a subcontractor) objects to their data being on the
        platform, we will cooperate with reasonable removal or correction requests.
      </P>

      <H2>4. Enforcement</H2>
      <P>
        Violations may result in warnings, temporary restriction of features, or termination of
        your account. Gross violations (illegal content, targeted abuse) result in immediate
        termination and may be reported to SAPS or other authorities.
      </P>

      <H2>5. Reporting abuse</H2>
      <P>
        If you see something on E-Site that violates this policy, email
        {' '}<a href="mailto:abuse@e-site.co.za" style={{ color: 'var(--c-text-mid)' }}>abuse@e-site.co.za</a>.
      </P>
    </div>
  )
}
