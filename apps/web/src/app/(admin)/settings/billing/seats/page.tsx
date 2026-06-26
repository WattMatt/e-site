import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getOrgContext } from '@/lib/auth-org'
import { OWNER_ADMIN } from '@esite/shared'
import { listSeatsAction } from '@/actions/seats.actions'
import { SeatsPanel } from './SeatsPanel'

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
}

export default async function SeatsPage() {
  const ctx = await getOrgContext()

  // Non-authenticated: soft state.
  if (!ctx) {
    return (
      <div className="animate-fadeup" style={{ maxWidth: 820 }}>
        <div className="page-header"><h1 className="page-title">Manage seats</h1></div>
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 24px' }}>
            <p style={monoDim}>Please sign in to manage seats.</p>
          </div>
        </div>
      </div>
    )
  }

  // Non-admin: hard redirect.
  if (!OWNER_ADMIN.includes(ctx.role)) {
    redirect('/dashboard')
  }

  const result = await listSeatsAction()

  if (!result.ok) {
    return (
      <div className="animate-fadeup" style={{ maxWidth: 820 }}>
        <div style={{ marginBottom: 16 }}>
          <Link href="/settings/billing" style={{ ...monoDim, textDecoration: 'none' }}>
            ← Billing
          </Link>
        </div>
        <div className="page-header">
          <h1 className="page-title">Manage seats</h1>
        </div>
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '24px 18px', color: 'var(--c-red)' }}>
            {result.error}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings/billing" style={{ ...monoDim, textDecoration: 'none' }}>
          ← Billing
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Generator Cost Recovery — Seats</h1>
          <p className="page-subtitle">
            Buy, assign, reassign, or free per-user seats for the Generator Cost Recovery module.
          </p>
        </div>
      </div>

      <SeatsPanel
        members={result.members}
        totalSeats={result.totalSeats}
        assignedSeats={result.assignedSeats}
      />
    </div>
  )
}
