import Link from 'next/link'
import type { ReactNode } from 'react'
import { LEGAL_ENTITY, formatAddressOneLine } from '@/lib/legal/entity'

// Public-site chrome — wraps the landing page, pricing, and the three legal
// pages built for the Paystack KYC review. Dark surface + 32 px drafting-grid
// backdrop + Procedural typography, matching the JBCC tab so the public
// surface looks like the same product as the authenticated app.
//
// No auth check happens here — these routes must render for anonymous
// visitors. `/` redirects to `/dashboard` for authed users from the page
// itself, not the layout (page-level redirect avoids running auth on the
// other public routes).

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--c-base)',
        color: 'var(--c-text)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* 32 px drafting-grid backdrop — same .blueprint-grid-subtle the
          authenticated shell uses. Fixed-position so it doesn't scroll. */}
      <div
        aria-hidden
        className="blueprint-grid-subtle"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <PublicHeader />

      <main
        id="main-content"
        style={{
          flex: 1,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {children}
      </main>

      <PublicFooter />
    </div>
  )
}

function PublicHeader() {
  return (
    <header
      style={{
        position: 'relative',
        zIndex: 2,
        padding: '20px 32px',
        borderBottom: '1px solid var(--c-border)',
        background: 'rgba(11, 11, 18, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <Link
        href="/"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}
      >
        <div className="sidebar-logo-mark">
          <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden>
            <path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill="var(--c-base)" />
          </svg>
        </div>
        <span
          style={{
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'var(--c-text)',
            fontSize: 16,
          }}
        >
          E-Site
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--c-text-dim)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginLeft: 4,
          }}
        >
          The Procedural
        </span>
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Link href="/pricing" className="filter-tab">
          Pricing
        </Link>
        <Link href="/legal/terms" className="filter-tab">
          Legal
        </Link>
        <Link
          href="/login"
          className="filter-tab"
          style={{ marginLeft: 4 }}
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="btn-primary-amber"
          style={{ marginLeft: 4 }}
        >
          Get started
        </Link>
      </nav>
    </header>
  )
}

function PublicFooter() {
  return (
    <footer
      style={{
        position: 'relative',
        zIndex: 2,
        borderTop: '1px solid var(--c-border)',
        background: 'var(--c-surface)',
        padding: '36px 32px 28px',
        fontSize: 12,
        color: 'var(--c-text-dim)',
        lineHeight: 1.7,
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 32,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 12,
            }}
          >
            Operator
          </div>
          <div style={{ color: 'var(--c-text-mid)', marginBottom: 4 }}>
            <strong>{LEGAL_ENTITY.registeredName}</strong>
          </div>
          <div>Reg. {LEGAL_ENTITY.registrationNo}</div>
          <div>VAT {LEGAL_ENTITY.vatNo}</div>
          <div style={{ marginTop: 8 }}>{formatAddressOneLine()}</div>
        </div>

        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 12,
            }}
          >
            Contact
          </div>
          <div>
            General:{' '}
            <a
              href={`mailto:${LEGAL_ENTITY.contactEmail}`}
              style={{ color: 'var(--c-text-mid)' }}
            >
              {LEGAL_ENTITY.contactEmail}
            </a>
          </div>
          <div style={{ marginTop: 4 }}>
            POPIA Information Officer:
          </div>
          <div>
            {LEGAL_ENTITY.infoOfficer} ·{' '}
            <a
              href={`mailto:${LEGAL_ENTITY.infoOfficerEmail}`}
              style={{ color: 'var(--c-text-mid)' }}
            >
              {LEGAL_ENTITY.infoOfficerEmail}
            </a>
          </div>
        </div>

        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 12,
            }}
          >
            Legal
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/legal/acceptable-use-policy" style={{ color: 'var(--c-text-mid)' }}>
              Acceptable Use Policy
            </Link>
            <Link href="/legal/privacy" style={{ color: 'var(--c-text-mid)' }}>
              Privacy Policy
            </Link>
            <Link href="/legal/terms" style={{ color: 'var(--c-text-mid)' }}>
              Terms of Service
            </Link>
            <Link href="/cookies" style={{ color: 'var(--c-text-mid)' }}>
              Cookie Policy
            </Link>
            <Link href="/privacy/request" style={{ color: 'var(--c-text-mid)' }}>
              Data subject request
            </Link>
          </div>
        </div>

        <div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
              marginBottom: 12,
            }}
          >
            Product
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link href="/" style={{ color: 'var(--c-text-mid)' }}>Overview</Link>
            <Link href="/pricing" style={{ color: 'var(--c-text-mid)' }}>Pricing</Link>
            <Link href="/login" style={{ color: 'var(--c-text-mid)' }}>Sign in</Link>
            <Link href="/signup" style={{ color: 'var(--c-text-mid)' }}>Get started</Link>
          </div>
        </div>
      </div>

      <div
        style={{
          maxWidth: 1100,
          margin: '24px auto 0',
          paddingTop: 16,
          borderTop: '1px solid var(--c-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--c-text-dim)',
          textTransform: 'uppercase',
        }}
      >
        © {new Date().getUTCFullYear()} {LEGAL_ENTITY.registeredName}. All rights reserved.
      </div>
    </footer>
  )
}
