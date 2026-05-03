import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Account deleted · E-Site' }

export default function AccountDeletedPage() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 24,
        background: 'var(--c-bg)',
      }}
    >
      <div className="data-panel" style={{ maxWidth: 480, width: '100%' }}>
        <div className="data-panel-header">
          <span className="data-panel-title">Account deleted</span>
        </div>
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 14, color: 'var(--c-text)', margin: 0 }}>
            Your account and personal data have been removed from E-Site.
          </p>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.6 }}>
            We retain a minimal audit log entry for POPIA §16 accountability — it
            contains no personal data. If you change your mind you are welcome to
            sign up again with the same email.
          </p>
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.6 }}>
            Questions about your erasure request? Email{' '}
            <a href="mailto:arno@watsonmattheus.com" style={{ color: 'var(--c-amber)' }}>
              arno@watsonmattheus.com
            </a>
            .
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Link
              href="/login"
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                padding: '7px 14px',
                border: '1px solid var(--c-border)',
                borderRadius: 6,
                color: 'var(--c-text)',
                textDecoration: 'none',
              }}
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
