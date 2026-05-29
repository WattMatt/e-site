import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { getOrgContext } from '@/lib/auth-org'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { listSubOrganisations } from '@/actions/sub-organisations.actions'

import { SubOrgsList } from './SubOrgsList'
import { AddSubOrgForm } from './AddSubOrgForm'

export const metadata: Metadata = { title: 'Sub-organisations' }
export const dynamic = 'force-dynamic'

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11,
  color: 'var(--c-text-dim)', letterSpacing: '0.06em',
}

export default async function SubOrganisationsPage() {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login?next=/settings/sub-organizations')
  if (!(ORG_WRITE_ROLES as readonly string[]).includes(ctx.role)) {
    redirect('/dashboard')
  }

  const result = await listSubOrganisations()
  const subOrgs = result.ok ? result.subOrganisations : []
  const loadError = result.ok ? null : result.error
  const activeCount = subOrgs.filter((s) => s.is_shadow).length

  return (
    <div className="animate-fadeup" style={{ maxWidth: 920 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings" style={{ ...monoDim, textDecoration: 'none' }}>← Settings</Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Sub-organisations</h1>
          <p className="page-subtitle">
            External contracting parties (contractors, suppliers, sub-contractors)
            with their own people rosters.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Add sub-organisation</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <AddSubOrgForm />
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              All sub-organisations ({activeCount} active · {subOrgs.length} total)
            </span>
          </div>
          {loadError && (
            <div style={{ padding: '12px 18px', color: 'var(--c-danger)', fontSize: 13 }}>
              {loadError}
            </div>
          )}
          <SubOrgsList initialSubOrgs={subOrgs} />
        </div>
      </div>
    </div>
  )
}
