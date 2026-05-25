import Link from 'next/link'
import { LEGAL_ENTITY, formatAddressOneLine } from '@/lib/legal/entity'

// Legacy admin-shell legal footer. ECTA (Electronic Communications and
// Transactions Act) §43 business disclosure + POPIA Information Officer
// contact. Shown on legacy /(legal) pages and linked into the admin footer.
//
// Entity strings sourced from @/lib/legal/entity — single source of truth.

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
          <strong style={{ color: 'var(--c-text-mid)' }}>{LEGAL_ENTITY.tradingName}</strong> is operated by
          {' '}{LEGAL_ENTITY.registeredName}, registration no. {LEGAL_ENTITY.registrationNo}.
          {' '}VAT {LEGAL_ENTITY.vatNo}.
          {' '}Registered address: {formatAddressOneLine()}.
          {' '}General enquiries:{' '}
          <a href={`mailto:${LEGAL_ENTITY.contactEmail}`} style={{ color: 'var(--c-text-mid)' }}>
            {LEGAL_ENTITY.contactEmail}
          </a>.
        </div>
        <div style={{ marginBottom: 16 }}>
          <strong style={{ color: 'var(--c-text-mid)' }}>POPIA Information Officer:</strong>
          {' '}{LEGAL_ENTITY.infoOfficer} ·{' '}
          <a href={`mailto:${LEGAL_ENTITY.infoOfficerEmail}`} style={{ color: 'var(--c-text-mid)' }}>
            {LEGAL_ENTITY.infoOfficerEmail}
          </a>
        </div>
        <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Link href="/legal/privacy"                style={{ color: 'var(--c-text-mid)' }}>Privacy</Link>
          <Link href="/legal/terms"                  style={{ color: 'var(--c-text-mid)' }}>Terms</Link>
          <Link href="/legal/acceptable-use-policy"  style={{ color: 'var(--c-text-mid)' }}>Acceptable use</Link>
          <Link href="/cookies"                      style={{ color: 'var(--c-text-mid)' }}>Cookies</Link>
          <Link href="/privacy/request"              style={{ color: 'var(--c-text-mid)' }}>Data request</Link>
        </nav>
      </div>
    </footer>
  )
}
