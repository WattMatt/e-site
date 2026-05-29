import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { getOrgContext } from '@/lib/auth-org'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { getSubOrganisation } from '@/actions/sub-organisations.actions'
import { listSubOrgMembers } from '@/actions/sub-org-members.actions'

import { ContactDetailsPanel } from './ContactDetailsPanel'
import { RosterSection } from './RosterSection'

export const metadata: Metadata = { title: 'Sub-organisation' }
export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11,
  color: 'var(--c-text-dim)', letterSpacing: '0.06em',
}

export default async function SubOrgDetailPage({ params }: Props) {
  const { id } = await params
  const ctx = await getOrgContext()
  if (!ctx) redirect(`/login?next=/settings/sub-organizations/${id}`)
  if (!(ORG_WRITE_ROLES as readonly string[]).includes(ctx.role)) redirect('/dashboard')

  const result = await getSubOrganisation(id)
  if (!result.ok) notFound()
  const subOrg = result.subOrganisation

  const membersResult = await listSubOrgMembers(id)
  const initialMembers = membersResult.ok ? membersResult.members : []

  return (
    <div className="animate-fadeup" style={{ maxWidth: 920 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings/sub-organizations" style={{ ...monoDim, textDecoration: 'none' }}>
          ← Sub-organisations
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{subOrg.name}</h1>
          <p className="page-subtitle">
            {subOrg.is_shadow ? 'Shadow (managed by you until claimed)' : 'Claimed organisation'}
          </p>
        </div>
        {subOrg.is_shadow
          ? <span className="badge badge-amber">shadow</span>
          : <span className="badge badge-green">claimed</span>
        }
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Contact details</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <ContactDetailsPanel subOrg={subOrg} />
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Roster</span>
          </div>
          <RosterSection subOrgId={id} initialMembers={initialMembers} />
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Attached projects</span>
          </div>
          <div className="data-panel-empty" style={{ padding: '24px 18px' }}>
            Project attachment ships in PR-C.
          </div>
        </div>
      </div>
    </div>
  )
}
