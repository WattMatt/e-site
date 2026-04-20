import Link from 'next/link'

// Compact legal-links strip for the authenticated shell. The full ECTA /
// POPIA footer lives on the public (legal) pages — for logged-in users a
// one-line link row is enough to satisfy "accessible from every page".

export function MinimalLegalNav() {
  return (
    <div
      style={{
        borderTop: '1px solid var(--c-border)',
        padding: '12px 24px',
        fontSize: 11,
        color: 'var(--c-text-dim)',
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        marginTop: 32,
      }}
    >
      <Link href="/privacy"         style={{ color: 'var(--c-text-dim)' }}>Privacy</Link>
      <Link href="/terms"           style={{ color: 'var(--c-text-dim)' }}>Terms</Link>
      <Link href="/acceptable-use"  style={{ color: 'var(--c-text-dim)' }}>Acceptable use</Link>
      <Link href="/cookies"         style={{ color: 'var(--c-text-dim)' }}>Cookies</Link>
      <Link href="/privacy/request" style={{ color: 'var(--c-text-dim)' }}>Data request</Link>
    </div>
  )
}
