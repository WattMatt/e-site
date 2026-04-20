import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/portal/compliance')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-base)', color: 'var(--c-text)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-panel)',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-amber)', letterSpacing: '0.02em' }}>
            E-Site
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--c-amber)',
              background: 'var(--c-amber-dim)',
              border: '1px solid var(--c-amber-mid)',
              padding: '3px 8px',
              borderRadius: 4,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            Client Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
            {user.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--c-text-mid)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.04em',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main style={{ flex: 1, maxWidth: 1080, width: '100%', margin: '0 auto', padding: '32px 24px' }}>
        {children}
      </main>
    </div>
  )
}
