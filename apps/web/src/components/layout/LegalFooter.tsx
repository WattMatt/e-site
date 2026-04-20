import Link from 'next/link'

// ECTA (Electronic Communications and Transactions Act) §43 business
// disclosure + POPIA Information Officer contact. Shown on every legal page
// and linked into the admin footer.
//
// Placeholder values marked TODO — replace once CIPC registration and
// physical address are finalised. All legal copy is currently placeholder
// content and must be replaced before launch (see spec-v2.md §19 and the
// lawyer-deliverable line items in build-action-plan Session 7.2).

const BUSINESS = {
  tradingName:       'E-Site',
  registeredName:    'Watson Mattheus (Pty) Ltd',          // TODO confirm at CIPC
  registrationNo:    '2026/XXXXXX/07',                      // TODO pull from CIPC certificate
  vatNo:             'Not yet VAT-registered',              // TODO update when VAT-registered
  physicalAddress:   'Somerset West, Western Cape, South Africa',  // TODO full street address
  contactEmail:      'hello@e-site.co.za',
  infoOfficer:       'Arno Mattheus',
  infoOfficerEmail:  'arno@watsonmattheus.com',
}

export function LegalFooter() {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--c-border)',
        padding: '28px 24px',
        fontSize: 12,
        color: 'var(--c-text-dim)',
        lineHeight: 1.7,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <strong style={{ color: 'var(--c-text-mid)' }}>{BUSINESS.tradingName}</strong> is operated by
          {' '}{BUSINESS.registeredName}, registration no. {BUSINESS.registrationNo}.
          {' '}{BUSINESS.vatNo}.
          {' '}Registered address: {BUSINESS.physicalAddress}.
          {' '}General enquiries: <a href={`mailto:${BUSINESS.contactEmail}`} style={{ color: 'var(--c-text-mid)' }}>{BUSINESS.contactEmail}</a>.
        </div>
        <div style={{ marginBottom: 16 }}>
          <strong style={{ color: 'var(--c-text-mid)' }}>POPIA Information Officer:</strong>
          {' '}{BUSINESS.infoOfficer} · <a href={`mailto:${BUSINESS.infoOfficerEmail}`} style={{ color: 'var(--c-text-mid)' }}>{BUSINESS.infoOfficerEmail}</a>
        </div>
        <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Link href="/privacy"         style={{ color: 'var(--c-text-mid)' }}>Privacy</Link>
          <Link href="/terms"           style={{ color: 'var(--c-text-mid)' }}>Terms</Link>
          <Link href="/acceptable-use"  style={{ color: 'var(--c-text-mid)' }}>Acceptable use</Link>
          <Link href="/cookies"         style={{ color: 'var(--c-text-mid)' }}>Cookies</Link>
          <Link href="/privacy/request" style={{ color: 'var(--c-text-mid)' }}>Data request</Link>
        </nav>
      </div>
    </footer>
  )
}
