import { redirect } from 'next/navigation'
import { getOrgContext } from '@/lib/auth-org'
import { listMyOrganisations } from '@/actions/active-organisation.actions'
import { OrgSwitcher } from '@/components/layout/OrgSwitcher'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { MinimalLegalNav } from '@/components/layout/MinimalLegalNav'

/**
 * Client portal shell — the viewing-only surface for client_viewer users.
 *
 * Mirror-gate of (admin)/layout.tsx: ONLY client_viewer (in the active org)
 * may render here; staff roles are bounced to the admin shell. Together the
 * two gates make the shell boundary fail-closed in both directions — a client
 * can never reach an admin route, and this portal never has to re-check.
 *
 * Everything under this layout is read-only by construction: pages are server
 * components with curated reads and no write actions.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login?next=/portal')
  if (ctx.role !== 'client_viewer') redirect('/dashboard')

  const orgsResult = await listMyOrganisations()
  const orgMemberships = orgsResult.ok ? orgsResult.memberships : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-base)', color: 'var(--c-text)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-panel)',
          padding: '14px 24px',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <OrgSwitcher memberships={orgMemberships} />
          <ThemeToggle />
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
      <main style={{ flex: 1, maxWidth: 1120, width: '100%', margin: '0 auto', padding: '28px 24px' }}>
        {children}
        <MinimalLegalNav />
      </main>
    </div>
  )
}
