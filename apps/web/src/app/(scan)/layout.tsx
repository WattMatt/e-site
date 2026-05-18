/**
 * Minimal chrome-free layout for the QR-scan landing path. No sidebar,
 * no header — just a centred container so a field worker scanning a
 * printed cable tag with a phone camera lands on something mobile-
 * friendly.
 *
 * Auth check intentionally lives on each page (not here): the layout
 * doesn't know which specific path was requested, so it can't preserve
 * it in ?next=. Moving the auth check down to the page means the
 * scanned /site/tag/<text> URL survives the sign-in round-trip.
 */
export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--c-bg, #fff)',
      color: 'var(--c-text, #111)',
      padding: '24px 16px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  )
}
