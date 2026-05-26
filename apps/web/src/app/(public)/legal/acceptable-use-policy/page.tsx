import type { Metadata } from 'next'
import { LegalPage } from '../_components/LegalPage'
import { LEGAL_ENTITY, formatAddressOneLine } from '@/lib/legal/entity'

export const metadata: Metadata = {
  title: 'Acceptable Use Policy — E-Site',
  description: 'How users may and may not use E-Site, the construction project- and contract-management platform.',
}

// Renders SPEC DOCS/paystack/drafts/acceptable-use-policy.md verbatim.
// The Markdown source is final per Arno's approval (master-spec §3 A3 closed
// 2026-05-25); the content here mirrors that source word-for-word with only
// the HTML/JSX rendering and the dynamic entity-footer added.
// When the source AUP changes, update both the Markdown and this page.

export default function AcceptableUsePolicyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Acceptable Use Policy"
      effective="25 May 2026"
      version="Version 1.0"
    >
      <p>
        <strong>Operator:</strong> {LEGAL_ENTITY.registeredName}<br />
        <strong>Service:</strong> {LEGAL_ENTITY.tradingName}
      </p>

      <p>
        This Acceptable Use Policy (the <strong>&quot;AUP&quot;</strong>) governs your use of{' '}
        <strong>{LEGAL_ENTITY.tradingName}</strong>, the construction project- and contract-management
        platform (the <strong>&quot;Service&quot;</strong>) operated by {LEGAL_ENTITY.registeredName}{' '}
        (<strong>&quot;E-Site&quot;</strong>, <strong>&quot;we&quot;</strong>,{' '}
        <strong>&quot;us&quot;</strong>, <strong>&quot;our&quot;</strong>). By accessing or using the
        Service, you agree to be bound by this AUP.
      </p>

      <h2>1. Permitted use</h2>
      <p>
        The Service is provided for the operation of legitimate construction project- and
        contract-management activities by South African construction industry professionals —
        including contractors, principal agents, quantity surveyors, employers, subcontractors,
        and suppliers — and parties dealing with them.
      </p>

      <h2>2. Prohibited activities</h2>
      <p>
        You may not, and you may not permit any person using your account to:
      </p>
      <p>
        <strong>(a)</strong> violate any law, regulation, or industry code applicable to construction
        in South Africa, including (without limitation) the Construction Industry Development Board
        Act, the Occupational Health and Safety Act, the National Building Regulations and Building
        Standards Act, the Consumer Protection Act, the Protection of Personal Information Act, and
        any applicable JBCC contractual framework;
      </p>
      <p>
        <strong>(b)</strong> engage in fraudulent, deceptive, or misleading conduct, including but
        not limited to misrepresentation of work performed, falsification of inspection records,
        creation of fictitious projects or transactions, or generation of contractual notices for
        which no factual or legal basis exists;
      </p>
      <p>
        <strong>(c)</strong> facilitate, through the platform, transactions or communications
        unrelated to construction goods or services;
      </p>
      <p>
        <strong>(d)</strong> attempt to defraud the platform, other users, suppliers, or payment
        processors — including through false chargebacks, fraudulent payment disputes, manipulation
        of dispute evidence, or any activity that could be characterised as money laundering or
        sanctions evasion;
      </p>
      <p>
        <strong>(e)</strong> circumvent the platform&apos;s role-based access controls, organisational
        boundaries, or paid-feature gating;
      </p>
      <p>
        <strong>(f)</strong> upload, store, or transmit content that infringes third-party
        intellectual property rights, contains malicious code, is unlawful, defamatory, harassing,
        or violates any individual&apos;s right to privacy;
      </p>
      <p>
        <strong>(g)</strong> use the platform to send unsolicited commercial communications, harvest
        contact details, or scrape data not belonging to your organisation;
      </p>
      <p>
        <strong>(h)</strong> reverse-engineer, decompile, or attempt to derive the source code of
        the Service except to the extent expressly permitted by law;
      </p>
      <p>
        <strong>(i)</strong> resell, sublicense, or provide access to the Service to any third party
        not authorised under your organisation&apos;s subscription, or share account credentials in
        a manner inconsistent with our seat-based or organisation-based pricing.
      </p>

      <h2>3. Marketplace conduct</h2>
      <p>
        Users transacting through the <strong>Marketplace</strong> flow undertake to:
      </p>
      <p>
        <strong>(a)</strong> deal in good faith with the counterparty (contractor or supplier);
      </p>
      <p>
        <strong>(b)</strong> deliver the goods or services for which payment is received, within
        the terms agreed between the parties on or off the platform;
      </p>
      <p>
        <strong>(c)</strong> honour the platform&apos;s commission and payout schedule;
      </p>
      <p>
        <strong>(d)</strong> cooperate with E-Site in the resolution of disputes, including
        provision of evidence within reasonable timeframes;
      </p>
      <p>
        <strong>(e)</strong> not initiate card-issuer chargebacks or payment-processor disputes for
        goods or services that have been rendered to the specification agreed between the parties.
      </p>

      <h2>4. Suspension and termination</h2>
      <p>
        We may suspend or terminate your access to the Service, with or without notice, if you
        breach this AUP or if your conduct presents risk to the platform, to other users, or to
        our payment-processor relationships. Where reasonably possible, we will provide notice and
        a reasonable opportunity to remedy the breach. Termination does not relieve you of
        obligations accrued before termination, including outstanding payments and commissions
        owed.
      </p>

      <h2>5. Reporting violations</h2>
      <p>
        To report a suspected violation of this AUP, email{' '}
        <a href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>. We treat
        all reports confidentially.
      </p>

      <h2>6. Changes</h2>
      <p>
        We may update this AUP from time to time. Material changes will be communicated by email
        to organisation owners at least 14 days before they take effect, except where the change
        is required by law or to address a pressing security issue, in which case the change may
        take effect immediately.
      </p>

      <p
        style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: '1px solid var(--c-border)',
          fontStyle: 'italic',
          fontSize: 13,
          color: 'var(--c-text-dim)',
        }}
      >
        {LEGAL_ENTITY.registeredName} · Registration number {LEGAL_ENTITY.registrationNo} · VAT{' '}
        {LEGAL_ENTITY.vatNo} · {formatAddressOneLine()}
      </p>
    </LegalPage>
  )
}
