import Link from 'next/link'
import type { ReactNode } from 'react'
import { LegalFooter } from '@/components/layout/LegalFooter'

// Shared chrome for the /privacy, /terms, /acceptable-use, /cookies,
// /privacy/request and /unsubscribe pages. No authentication required — these
// pages must be accessible to anonymous visitors (ECTA, POPIA).
//
// Spec: spec-v2.md §19.

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-base)', color: 'var(--c-text)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--c-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <div className="sidebar-logo-mark">
            <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
              <path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill="var(--c-base)" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, letterSpacing: '0.01em', color: 'var(--c-text)' }}>E-Site</span>
        </Link>
      </header>
      <main
        style={{
          flex: 1,
          maxWidth: 720,
          margin: '0 auto',
          padding: '48px 24px',
          width: '100%',
          lineHeight: 1.65,
        }}
      >
        {children}
      </main>
      <LegalFooter />
    </div>
  )
}
