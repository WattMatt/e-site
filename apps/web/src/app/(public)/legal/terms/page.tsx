import type { Metadata } from 'next'
import { LegalPage } from '../_components/LegalPage'
import { LEGAL_ENTITY, formatAddressOneLine } from '@/lib/legal/entity'

export const metadata: Metadata = {
  title: 'Terms of Service — E-Site',
  description: 'The terms under which you may use the E-Site construction project- and contract-management platform.',
}

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      effective="25 May 2026"
      version="Version 1.0"
    >
      <p>
        These Terms of Service (<strong>&quot;Terms&quot;</strong>) govern your access to and use
        of the E-Site construction project- and contract-management platform (the{' '}
        <strong>&quot;Service&quot;</strong>), operated by {LEGAL_ENTITY.registeredName}{' '}
        (<strong>&quot;E-Site&quot;</strong>, <strong>&quot;we&quot;</strong>,{' '}
        <strong>&quot;us&quot;</strong>, <strong>&quot;our&quot;</strong>). By creating an account
        or otherwise using the Service, you agree to these Terms. They are written in plain
        English to meet the requirements of the Consumer Protection Act 68 of 2008.
      </p>

      <h2>1. The Service</h2>
      <p>
        E-Site is a web and mobile platform for South African construction industry professionals
        to manage projects, compliance records, site diaries, inspections, JBCC procedural
        correspondence, and marketplace transactions with vetted suppliers. The Service is offered
        on a subscription basis with optional one-time module unlocks, and is available at{' '}
        <a href="https://e-site.live">e-site.live</a>.
      </p>
      <p>
        We may add, change, or remove features from time to time. Material changes that
        materially reduce a paid feature&apos;s functionality will be communicated to organisation
        owners at least 14 days in advance.
      </p>

      <h2>2. Account, eligibility, and organisations</h2>
      <p>
        To use the Service you must be at least 18 years of age and have the legal capacity to
        enter into a binding contract. By signing up you confirm that the information you provide
        is accurate and that you are authorised to act on behalf of any organisation you register.
      </p>
      <p>
        E-Site uses an <strong>organisation</strong> as the unit of access and billing. An
        organisation owner can invite other users into roles (admin, contractor, supplier,
        inspector, project manager, client viewer); each role has defined permissions on the
        platform. You are responsible for all activity that occurs under your user account and
        under the organisations you own.
      </p>

      <h2>3. Subscription tiers, fees, and billing</h2>

      <h3>3.1 Tiers</h3>
      <p>
        We offer the following tiers, each priced per organisation and inclusive of VAT:
      </p>
      <ul>
        <li><strong>Free</strong> — R 0 per month. One active project, basic site diary and snag tracking, no marketplace access.</li>
        <li><strong>Starter</strong> — R 499 per month. Up to three active projects, inspections-ready, basic reporting.</li>
        <li><strong>Pro</strong> — R 999 per month. Unlimited projects, marketplace access, all reports, RFI module, cable schedule.</li>
        <li><strong>Enterprise</strong> — priced per organisation. Multi-organisation tenancy, white-label, dedicated onboarding, SLA-backed support.</li>
      </ul>

      <h3>3.2 Paid module unlocks (one-time)</h3>
      <ul>
        <li><strong>Inspections module</strong> — R 250, one-time charge. Unlocks the inspections module for the lifetime of the organisation, on any subscription tier.</li>
        <li><strong>JBCC Procedural Toolkit</strong> — R 1 999, one-time charge. Unlocks the JBCC Procedural Toolkit (clause reference, notice-letter generation, time-bar tracking) for the lifetime of the organisation, on any subscription tier.</li>
      </ul>

      <h3>3.3 Auto-renewal and cancellation</h3>
      <p>
        Subscriptions are billed monthly from the date of first payment. They automatically renew
        on each anniversary date unless cancelled. You may cancel a subscription at any time from
        the billing page in your organisation&apos;s settings. Cancellation takes effect at the
        end of the current paid period — you retain access until then.
      </p>
      <p>
        Module unlocks are one-time charges. They are not auto-renewing. Once paid, the module
        remains active for the lifetime of the organisation unless the organisation is closed.
      </p>

      <h3>3.4 Refund policy</h3>
      <ul>
        <li><strong>Subscriptions</strong> — pro-rata refund of the unused portion if cancelled within 14 days of the most recent payment. Beyond 14 days, no refund of the current billing period; cancellation takes effect at the end of the period.</li>
        <li><strong>Module unlocks</strong> — full refund within 14 days if the module has been used only minimally (for example, fewer than 5 JBCC notice letters generated, or fewer than 5 inspections completed). Beyond that, refunds are at our discretion based on the nature of the dispute.</li>
        <li><strong>Marketplace orders</strong> — refunds are handled per the marketplace dispute workflow described in section 5.</li>
      </ul>

      <h3>3.5 Tier changes</h3>
      <p>
        You can upgrade your subscription tier at any time. Upgrades take effect immediately and
        are charged pro-rata for the remainder of the current period. Downgrades take effect at
        the next renewal so that you retain the higher tier for the period you have paid for.
      </p>

      <h3>3.6 Failed payments</h3>
      <p>
        If a renewal payment fails, we will retry the charge in line with our payment processor&apos;s
        retry schedule and notify you. If payment is not recovered within 30 days, the subscription
        is cancelled. The organisation reverts to the Free tier; data is preserved per section 8.
      </p>

      <h3>3.7 Payment processor</h3>
      <p>
        All payments are processed by Paystack Payments South Africa Pty Ltd. We do not store
        full card numbers; Paystack tokenises your card and shares only a reference back to us.
        By making a payment you accept Paystack&apos;s terms.
      </p>

      <h2>4. Marketplace terms</h2>

      <h3>4.1 What the marketplace is</h3>
      <p>
        The E-Site marketplace lets contractors place orders with suppliers that we have onboarded
        and verified. Suppliers receive payouts to a Paystack subaccount that they activate during
        onboarding. Contractors pay through the platform; the platform settles funds to the
        supplier subaccount at settlement time.
      </p>

      <h3>4.2 Platform commission and Paystack fee</h3>
      <p>
        E-Site retains a flat <strong>5%</strong> commission on each settled marketplace order.
        The Paystack transaction-processing fee on each order is borne by the supplier subaccount
        — that is, the supplier absorbs the Paystack fee and we do not absorb any part of it. As
        a worked example, on a R 10 000 order:
      </p>
      <ul>
        <li>The supplier subaccount receives R 9 500, less the applicable Paystack processing fee;</li>
        <li>E-Site receives R 500 (the 5% commission) in full.</li>
      </ul>

      <h3>4.3 Settlement timing</h3>
      <p>
        Payouts to supplier subaccounts and to the E-Site main account follow Paystack&apos;s
        standard settlement cycle. E-Site does not hold or warehouse funds outside Paystack.
      </p>

      <h3>4.4 Supplier obligations</h3>
      <p>
        By accepting payment for a marketplace order, the supplier agrees to deliver the goods or
        services described in the order, on the terms agreed with the contractor. Suppliers must
        cooperate with E-Site in the resolution of disputes, including providing evidence within
        reasonable timeframes, and may not initiate card-issuer chargebacks against settled
        marketplace orders.
      </p>

      <h3>4.5 Contractor obligations</h3>
      <p>
        Contractors agree to pay for goods or services they have ordered and to use the platform&apos;s
        dispute workflow before approaching a card issuer with a chargeback. Initiating a
        chargeback for goods or services delivered as agreed is a breach of these Terms and of
        the Acceptable Use Policy.
      </p>

      <h2>5. Dispute resolution (marketplace)</h2>
      <p>
        We operate a two-tier dispute resolution workflow for marketplace transactions, plus a
        defined process for card-issuer chargebacks.
      </p>

      <h3>5.1 Tier 1 — direct counterparty resolution</h3>
      <p>
        When a contractor and supplier disagree on the goods or services delivered, the affected
        party opens a dispute from the order page. The platform captures both parties&apos;
        positions and uploaded evidence (photographs, delivery notes, inspection records, signed
        delivery confirmations), notifies the counterparty, and holds the order in a{' '}
        <em>disputed</em> status. The parties have <strong>seven working days</strong> to resolve
        the matter directly. Outcomes are recorded on the platform and either release funds to
        the supplier or initiate a Paystack refund.
      </p>

      <h3>5.2 Tier 2 — E-Site mediation</h3>
      <p>
        If the parties cannot resolve the matter within seven working days, an E-Site dispute
        officer takes the case. The officer reviews the on-platform evidence, the order
        specification, and platform records of delivery, and may request additional evidence from
        either party (with a five working-day response window). The officer issues a determination
        within five working days of receiving the case. Possible outcomes are: full refund to the
        contractor, partial refund, release of funds to the supplier, or required remediation by
        the supplier as a condition of payment release. The determination is binding on the
        platform users.
      </p>

      <h3>5.3 Chargebacks</h3>
      <p>
        Where a contractor initiates a chargeback through their card issuer rather than through
        the platform&apos;s dispute workflow, the transaction is flagged in our payment-event log.
        We assemble the evidence pack — order specification, delivery records, dispute-workflow
        history, and platform communications — and submit it to the payment processor within the
        chargeback response window. The contractor&apos;s subscription is suspended pending
        chargeback resolution. The supplier subaccount is not suspended unless the chargeback
        pattern indicates supplier misconduct. If the chargeback is upheld against us, the
        supplier subaccount may be debited to recover the supplier&apos;s share; the supplier is
        notified and may dispute internally.
      </p>

      <h3>5.4 Where to send a dispute</h3>
      <p>
        Marketplace and chargeback disputes should be submitted through the in-product order
        page. General questions may be sent to{' '}
        <a href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>.
      </p>

      <h2>6. Your content and licence to us</h2>
      <p>
        You retain ownership of all content you upload to the Service — photographs, documents,
        notes, records, drawings, anything. You grant us a worldwide, non-exclusive, royalty-free
        licence to host, store, transmit, display, reproduce, and otherwise process that content
        solely for the purpose of providing the Service to you and the members of your
        organisation. The licence ends when you remove the content from the Service, save where
        we are required to retain it under section 8.
      </p>
      <p>
        You confirm that you have the right to upload all content that you place on the Service
        and that the content does not infringe any third party&apos;s rights. We may remove
        content that we reasonably believe is unlawful, infringes someone&apos;s rights, or
        violates the Acceptable Use Policy.
      </p>

      <h2>7. Acceptable use</h2>
      <p>
        Your use of the Service is governed by the Acceptable Use Policy, available at{' '}
        <a href="/legal/acceptable-use-policy">/legal/acceptable-use-policy</a>. The AUP is
        incorporated into these Terms by reference. Breach of the AUP is a breach of these
        Terms and may result in suspension or termination of your account.
      </p>

      <h2>8. Data retention on cancellation</h2>
      <p>
        On cancellation of a subscription, the organisation enters a 90-day preservation window
        during which it can be reactivated without data loss. After 90 days, organisation data is
        permanently deleted, except records that we are required to retain by law (see the
        Privacy Policy section 7 for the full schedule). You may export your data at any time
        before deletion.
      </p>

      <h2>9. Suspension and termination</h2>
      <p>
        We may suspend or terminate your access to the Service, with or without notice, if you
        breach these Terms or the Acceptable Use Policy, if your conduct presents risk to the
        platform, to other users, or to our payment-processor relationships, or if a third
        party (for example, a card issuer or regulatory body) requires us to do so. Where
        reasonably possible we will provide notice and a reasonable opportunity to remedy the
        breach. Termination does not relieve you of obligations accrued before termination,
        including outstanding payments and commissions owed.
      </p>
      <p>
        You may terminate your account at any time by cancelling all subscriptions and closing
        each organisation you own.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        Save for liability that cannot be excluded under South African law (including death,
        personal injury caused by negligence, and fraud), our total aggregate liability to you
        arising out of or in connection with the Service in any 12-month period is limited to
        the fees actually paid by your organisation to us in the 12 months preceding the event
        giving rise to the claim. We are not liable for indirect, incidental, special, or
        consequential losses, or for loss of profit, revenue, goodwill, or data.
      </p>
      <p>
        The Service is provided &quot;as is&quot;. We do not warrant that the Service will be
        uninterrupted or error-free, or that defects will be corrected immediately.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        You agree to indemnify us against any claim, loss, or expense arising from your breach
        of these Terms or the Acceptable Use Policy, from your unauthorised use of the Service,
        from content you upload, or from a third-party claim that your content infringes that
        party&apos;s rights.
      </p>

      <h2>12. Governing law and dispute resolution</h2>
      <p>
        These Terms are governed by South African law. Disputes arising out of or in connection
        with these Terms or your use of the Service will be referred to arbitration in Pretoria
        in accordance with the rules of the Arbitration Foundation of Southern Africa, save that
        small claims may be heard in the magistrate&apos;s court of the consumer&apos;s choice
        as contemplated by the Consumer Protection Act, and save that either party may approach
        a competent court for urgent interdictory relief.
      </p>

      <h2>13. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be communicated by
        email to organisation owners at least 30 days before they take effect, except where the
        change is required by law or to address a pressing security issue, in which case the
        change may take effect immediately. The &quot;Effective&quot; date at the top of this
        page reflects the most recent material update.
      </p>

      <h2>14. Contact</h2>
      <p>
        General enquiries:{' '}
        <a href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>.
        POPIA Information Officer: {LEGAL_ENTITY.infoOfficer}{' '}
        (<a href={`mailto:${LEGAL_ENTITY.infoOfficerEmail}`}>{LEGAL_ENTITY.infoOfficerEmail}</a>).
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
