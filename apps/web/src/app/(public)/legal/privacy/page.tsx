import type { Metadata } from 'next'
import { LegalPage } from '../_components/LegalPage'
import { LEGAL_ENTITY, formatAddressOneLine } from '@/lib/legal/entity'

export const metadata: Metadata = {
  title: 'Privacy Policy — E-Site',
  description: 'How E-Site collects, stores and processes personal information under the Protection of Personal Information Act, 2013.',
}

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      effective="25 May 2026"
      version="Version 1.0"
    >
      <p>
        This Privacy Policy describes how {LEGAL_ENTITY.registeredName} (<strong>&quot;E-Site&quot;</strong>,{' '}
        <strong>&quot;we&quot;</strong>, <strong>&quot;us&quot;</strong>, <strong>&quot;our&quot;</strong>)
        collects, uses, stores, and shares personal information in the operation of the E-Site
        construction project- and contract-management platform (the <strong>&quot;Service&quot;</strong>).
        We process personal information in accordance with the Protection of Personal Information
        Act 4 of 2013 (<strong>&quot;POPIA&quot;</strong>) and the Electronic Communications and
        Transactions Act 25 of 2002 (<strong>&quot;ECTA&quot;</strong>).
      </p>

      <h2>1. Who we are and how to contact us</h2>
      <p>
        The responsible party for purposes of POPIA is {LEGAL_ENTITY.registeredName}, registration
        number {LEGAL_ENTITY.registrationNo}, VAT number {LEGAL_ENTITY.vatNo}, with its registered
        office at {formatAddressOneLine()}.
      </p>
      <p>
        Our designated Information Officer is {LEGAL_ENTITY.infoOfficer}. All privacy-related
        enquiries, access requests, and complaints may be addressed to{' '}
        <a href={`mailto:${LEGAL_ENTITY.infoOfficerEmail}`}>{LEGAL_ENTITY.infoOfficerEmail}</a>.
        General product enquiries should go to{' '}
        <a href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>.
      </p>

      <h2>2. The personal information we collect</h2>
      <p>
        We collect and process personal information in two main categories: information you provide
        when you register and use the Service, and information automatically generated through your
        use of the Service.
      </p>

      <h3>2.1 Account and identity information</h3>
      <ul>
        <li><strong>Full name</strong> (first and last) — collected at sign-up; self-attested.</li>
        <li><strong>Business email address</strong> — collected at sign-up; verified via confirmation link issued by our authentication provider.</li>
        <li><strong>Mobile telephone number</strong> — collected at first organisation creation; verified via SMS one-time password.</li>
        <li><strong>Password</strong> — hashed using bcrypt by our authentication provider; we do not have access to your plaintext password at any time.</li>
        <li><strong>Organisation name and role</strong> — self-attested; the role within an organisation is assigned by an organisation owner.</li>
      </ul>

      <h3>2.2 Billing information (collected on paid subscription, paid module unlock, or marketplace activity)</h3>
      <ul>
        <li><strong>Organisation legal name</strong> — self-attested and cross-checked against the CIPC public registry on first paid purchase.</li>
        <li><strong>CIPC company registration number</strong> — validated against the CIPC public registry.</li>
        <li><strong>VAT number</strong> (if applicable) — validated via SARS VAT vendor search.</li>
        <li><strong>Billing address and tax category</strong> — self-attested.</li>
        <li><strong>Card token and transaction references</strong> — held by Paystack, our payment processor; we never store full card numbers. Paystack tokenises the card at point of sale and returns a reference that we associate with your account.</li>
      </ul>

      <h3>2.3 Enhanced Due Diligence information (suppliers only)</h3>
      <p>
        Suppliers who receive payouts through the E-Site marketplace are subject to additional
        verification, including:
      </p>
      <ul>
        <li>South African ID document or passport of the responsible director or sole proprietor;</li>
        <li>Paystack subaccount details (bank, account number, account holder name) — verified by Paystack for name-match against the CIPC-registered company;</li>
        <li>BBBEE certificate (if available);</li>
        <li>Sanctions / PEP screening against the publicly available OFAC SDN list and the UN Consolidated Sanctions List.</li>
      </ul>

      <h3>2.4 Operational information generated through use of the Service</h3>
      <ul>
        <li>Project, snag, inspection, JBCC notice, and marketplace order records you create or that members of your organisation create;</li>
        <li>Photographs and documents you upload (including site photos, compliance documents, drawings, and proof of identity for supplier onboarding);</li>
        <li>Session data — IP address, device fingerprint, browser user-agent — logged in our authentication system&apos;s metadata for security monitoring;</li>
        <li>Anonymised product-analytics events (e.g. page views, feature usage), collected in aggregate by PostHog without auto-capture of clicks or form values, and without session recordings.</li>
      </ul>

      <h2>3. Why we process your personal information</h2>
      <p>
        We process personal information for the following defined purposes:
      </p>
      <ul>
        <li><strong>To provide the Service</strong> — authenticate you, give you access to your organisation&apos;s data, store the records you create, and process payments;</li>
        <li><strong>To communicate with you about your account</strong> — verification, security notifications, billing receipts, dispute updates, and material changes to the Service or to this Policy;</li>
        <li><strong>To verify the identity of paying organisations and suppliers</strong> — for fraud prevention, KYC compliance with our payment processor&apos;s rules, and to satisfy our obligations under the Financial Intelligence Centre Act where applicable;</li>
        <li><strong>To detect, investigate, and prevent fraud or abuse of the Service</strong> — including monitoring for suspicious sign-ups, dispute patterns, and chargeback patterns;</li>
        <li><strong>To improve the Service</strong> — through aggregate, anonymised analytics that do not identify individual users;</li>
        <li><strong>To comply with legal and regulatory obligations</strong> — including record-retention periods imposed by tax, VAT, and construction-related legislation.</li>
      </ul>

      <h2>4. Lawful basis for processing</h2>
      <p>
        We rely on the following lawful grounds under section 11 of POPIA:
      </p>
      <ul>
        <li><strong>Performance of a contract</strong> — to deliver the Service you have signed up for;</li>
        <li><strong>Compliance with a legal obligation</strong> — including KYC checks, tax record-keeping, and statutory record-retention;</li>
        <li><strong>Pursuit of a legitimate interest</strong> — including fraud prevention, security monitoring, and aggregate product analytics, in each case balanced against the rights and freedoms of data subjects;</li>
        <li><strong>Consent</strong> — for any marketing or non-essential communications, which you may withdraw at any time.</li>
      </ul>

      <h2>5. Who we share your personal information with</h2>
      <p>
        We share personal information only with the third-party operators required to deliver the
        Service. Each operator processes data on our behalf under a data-processing addendum
        compatible with POPIA section 19 (security safeguards) and, where data crosses borders,
        compatible with POPIA section 72 (cross-border transfers).
      </p>

      <table>
        <thead>
          <tr>
            <th>Operator</th>
            <th>Purpose</th>
            <th>Jurisdiction</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Paystack</strong></td>
            <td>Card tokenisation, payment processing, subscription billing, marketplace splits, payouts to supplier subaccounts.</td>
            <td>South Africa</td>
          </tr>
          <tr>
            <td><strong>Supabase</strong></td>
            <td>Authentication, database, file storage, real-time sync. Hosts the bulk of the platform&apos;s data.</td>
            <td>European Union (Frankfurt)</td>
          </tr>
          <tr>
            <td><strong>Vercel</strong></td>
            <td>Hosting and content-delivery network for the web application.</td>
            <td>European Union / United States (edge network)</td>
          </tr>
          <tr>
            <td><strong>Resend</strong></td>
            <td>Transactional email delivery (account verification, billing receipts, invitations).</td>
            <td>European Union</td>
          </tr>
          <tr>
            <td><strong>Sentry</strong></td>
            <td>Application error monitoring — IP address, stack traces, and limited request metadata only.</td>
            <td>European Union / United States</td>
          </tr>
          <tr>
            <td><strong>PostHog</strong></td>
            <td>Aggregate product analytics — configured to disable auto-capture and session recording of personal data.</td>
            <td>European Union</td>
          </tr>
        </tbody>
      </table>

      <p>
        We do not sell personal information, and we do not share it with advertising networks or
        data brokers. We may disclose personal information to law-enforcement or regulatory bodies
        where compelled by law (for example, a properly issued subpoena under section 205 of the
        Criminal Procedure Act).
      </p>

      <h2>6. Cross-border transfers</h2>
      <p>
        Some of our operators are based outside South Africa, principally in the European Union and
        the United States. Where personal information is transferred outside South Africa, we rely
        on one or more of the lawful grounds in POPIA section 72:
      </p>
      <ul>
        <li>The receiving party is subject to a law or contractual scheme that upholds principles for reasonable processing substantially similar to POPIA (notably the EU General Data Protection Regulation);</li>
        <li>The data subject has consented to the transfer;</li>
        <li>The transfer is necessary for the performance of the contract between the data subject and the responsible party.</li>
      </ul>
      <p>
        Each operator listed in section 5 has signed a data-processing addendum with us that
        binds them to substantially equivalent standards.
      </p>

      <h2>7. How long we keep your personal information</h2>
      <p>
        We retain personal information for as long as your account is active. After cancellation:
      </p>
      <ul>
        <li><strong>Account and project data</strong> — preserved for 90 days after cancellation so the organisation can reactivate without data loss; permanently deleted thereafter, unless a statutory retention obligation requires longer.</li>
        <li><strong>Billing records</strong> — retained for the statutory period required by the South African Revenue Service (currently five years).</li>
        <li><strong>Compliance records and signed-off inspection records</strong> — retained for the period required by the Occupational Health and Safety Act and the National Building Regulations; you may export these from the platform at any time before deletion.</li>
        <li><strong>Marketplace transaction records and chargeback evidence</strong> — retained for the statutory period required by financial-services legislation and our payment processor&apos;s recordkeeping rules.</li>
      </ul>

      <h2>8. Your rights under POPIA</h2>
      <p>
        Under POPIA you have the right to:
      </p>
      <ul>
        <li><strong>Be notified</strong> that your personal information is being collected, and notified when it has been accessed or acquired by an unauthorised person;</li>
        <li><strong>Access</strong> the personal information we hold about you, and the identities of any third parties to whom we have disclosed it;</li>
        <li><strong>Request the correction</strong> of personal information that is inaccurate, irrelevant, excessive, misleading, or obtained unlawfully;</li>
        <li><strong>Request the deletion</strong> of personal information that we no longer need to retain;</li>
        <li><strong>Object to processing</strong> on reasonable grounds, including processing for direct-marketing purposes;</li>
        <li><strong>Submit a complaint</strong> to the Information Regulator of South Africa if you believe we have processed your personal information unlawfully.</li>
      </ul>
      <p>
        To exercise any of these rights, email the Information Officer at{' '}
        <a href={`mailto:${LEGAL_ENTITY.infoOfficerEmail}`}>{LEGAL_ENTITY.infoOfficerEmail}</a> or
        use the data-subject request form at <a href="/privacy/request">/privacy/request</a>. We
        respond within the timeframes set by POPIA — typically no later than 30 days from receipt
        of a verified request.
      </p>

      <h2>9. Security of your personal information</h2>
      <p>
        We protect personal information through a combination of organisational and technical
        measures:
      </p>
      <ul>
        <li>TLS encryption in transit between your browser and our servers, and between us and each of our operators;</li>
        <li>Encryption at rest for the underlying database and file storage, managed by our hosting provider;</li>
        <li>Row-level security policies in the database that enforce per-organisation isolation — users see only the records of the organisations they belong to;</li>
        <li>Role-based access control within each organisation (owner, admin, contractor, supplier, inspector, project manager, client viewer), restricting what each user can read or write;</li>
        <li>Logging of authentication events and an immutable audit trail for changes to material records (inspections, JBCC notices, billing events);</li>
        <li>Regular review of who can access production data within our team — strictly limited to staff whose role requires it.</li>
      </ul>

      <h2>10. Breach notification</h2>
      <p>
        Where we have reasonable grounds to believe that personal information has been accessed or
        acquired by an unauthorised person, we will notify both the affected data subjects and the
        Information Regulator of South Africa as soon as reasonably possible, in compliance with
        POPIA section 22. The notification will describe the nature of the compromise, the
        personal information involved, the measures we are taking, and the steps the affected
        data subject may take to protect themselves.
      </p>

      <h2>11. Cookies and tracking technologies</h2>
      <p>
        E-Site uses only functional cookies — the ones necessary for authentication, session
        management, and CSRF protection. We do not use advertising cookies or third-party
        tracking pixels. A separate Cookie Policy is available at{' '}
        <a href="/cookies">/cookies</a>.
      </p>

      <h2>12. Children</h2>
      <p>
        The Service is intended for use by adults working in the South African construction
        industry. We do not knowingly collect personal information from children under 18 years
        of age. If you believe a child has provided us with personal information without parental
        consent, email the Information Officer and we will take prompt steps to delete it.
      </p>

      <h2>13. Changes to this Privacy Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be notified by
        email to organisation owners at least 14 days before they take effect, except where the
        change is required by law or to address a pressing security issue, in which case the
        change may take effect immediately. The &quot;Effective&quot; date at the top of this
        page reflects the most recent material update.
      </p>

      <h2>14. Complaints to the Information Regulator</h2>
      <p>
        If we have not resolved a privacy concern to your satisfaction, you may lodge a complaint
        with the Information Regulator of South Africa:
      </p>
      <p>
        <strong>Information Regulator (South Africa)</strong><br />
        JD House, 27 Stiemens Street, Braamfontein, Johannesburg, 2001<br />
        Email: <a href="mailto:complaints.IR@justice.gov.za">complaints.IR@justice.gov.za</a><br />
        Website: <a href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer">https://inforegulator.org.za</a>
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
