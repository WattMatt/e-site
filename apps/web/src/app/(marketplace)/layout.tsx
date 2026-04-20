import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-base)', color: 'var(--c-text)' }}>
      {/* Scoped hover rule for nav links (globals.css is intentionally not edited here). */}
      <style>{`.marketplace-nav-link:hover { color: var(--c-text) !important; }`}</style>
      <header
        style={{
          borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-base)',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/"
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--c-text)',
              textDecoration: 'none',
              letterSpacing: '-0.01em',
            }}
          >
            E-Site
          </Link>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '3px 8px',
              borderRadius: 2,
              background: 'var(--c-amber-dim)',
              border: '1px solid var(--c-amber-mid)',
              color: 'var(--c-amber)',
            }}
          >
            Supplier Portal
          </span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {user ? (
            <>
              <Link
                href="/supplier/profile"
                className="marketplace-nav-link"
                style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none', transition: 'color 0.15s' }}
              >
                Profile
              </Link>
              <Link
                href="/supplier/catalogue"
                className="marketplace-nav-link"
                style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none', transition: 'color 0.15s' }}
              >
                Catalogue
              </Link>
              <Link
                href="/supplier/orders"
                className="marketplace-nav-link"
                style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none', transition: 'color 0.15s' }}
              >
                Orders
              </Link>
              <span style={{ color: 'var(--c-border-mid)' }}>|</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
                {user.email}
              </span>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="marketplace-nav-link"
                  style={{
                    fontSize: 13,
                    color: 'var(--c-text-dim)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'color 0.15s',
                  }}
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="marketplace-nav-link"
                style={{ fontSize: 13, color: 'var(--c-text-dim)', textDecoration: 'none', transition: 'color 0.15s' }}
              >
                Log in
              </Link>
              <Link href="/register" className="btn-primary-amber" style={{ fontSize: 13, padding: '7px 14px' }}>
                Register
              </Link>
            </>
          )}
        </nav>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>
    </div>
  )
}
