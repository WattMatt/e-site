import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { getOrgContext } from '@/lib/auth-org'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { getSubOrganisation, setSubOrgActive } from '@/actions/sub-organisations.actions'
import { listSubOrgMembers } from '@/actions/sub-org-members.actions'

import { ContactDetailsPanel } from './ContactDetailsPanel'
import { RosterSection } from './RosterSection'
import { DeactivateSubOrgButton } from './DeactivateSubOrgButton'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!subOrg.is_active && (
            <span className="badge badge-muted">inactive</span>
          )}
          {subOrg.is_shadow
            ? <span className="badge badge-amber">shadow</span>
            : <span className="badge badge-green">claimed</span>
          }
        </div>
      </div>

      {/* Deactivation banner (spec §6.2) */}
      {!subOrg.is_active && (
        <div style={{
          padding: '12px 16px',
          marginBottom: 16,
          background: 'var(--c-elevated)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--c-text-mid)',
        }}>
          This sub-organisation is deactivated. Roster and project memberships are unchanged.
        </div>
      )}

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
          <RosterSection subOrgId={id} parentOrgId={ctx.organisationId} initialMembers={initialMembers} />
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Attached projects</span>
          </div>
          <div className="data-panel-empty" style={{ padding: '24px 18px' }}>
            Project attachment ships in PR-C.
          </div>
        </div>

        {/* Transfer ownership placeholder (spec §6.4) */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Transfer ownership</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-mid)', margin: 0 }}>
              When {subOrg.name}&apos;s owner signs up for their own ESITE account, you&apos;ll be able to transfer
              ownership here. Their account becomes the org owner, your management rights drop automatically,
              and existing members + project memberships stay intact.
            </p>
            <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>
              Coming in a future release. Reach out if you need this now.
            </p>
          </div>
        </div>

        {/* Deactivate / Reactivate footer (spec §6.2) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 32 }}>
          <DeactivateSubOrgButton
            subOrgId={id}
            isActive={subOrg.is_active}
            orgName={subOrg.name}
            setSubOrgActive={setSubOrgActive}
          />
        </div>
      </div>
    </div>
  )
}
