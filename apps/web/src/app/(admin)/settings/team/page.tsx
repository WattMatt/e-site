import { createClient } from '@/lib/supabase/server'
import { orgService, formatDate, formatRelative } from '@esite/shared'
import Link from 'next/link'
import { InviteForm } from './InviteForm'
import { RevokeInviteButton } from './RevokeInviteButton'
import { CopyInviteLinkButton } from './CopyInviteLinkButton'

const ROLE_BADGE: Record<string, string> = {
  owner: 'badge badge-amber',
  admin: 'badge badge-amber',
  project_manager: 'badge badge-blue',
  contractor: 'badge badge-muted',
  field_worker: 'badge badge-muted',
  inspector: 'badge badge-muted',
  supervisor: 'badge badge-muted',
  client_viewer: 'badge badge-muted',
}

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role, organisation:organisations(name)')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!membership) {
    return (
      <div className="animate-fadeup">
        <div className="page-header">
          <h1 className="page-title">Team</h1>
        </div>
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
              No organisation found. Complete onboarding to manage your team.
            </p>
            <Link href="/onboarding" className="btn-primary-amber" style={{ padding: '9px 16px', textDecoration: 'none' }}>
              Go to Onboarding
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const orgId = membership.organisation_id
  const isAdmin = ['owner', 'admin'].includes(membership.role)

  const [members, pendingInvites] = await Promise.all([
    orgService.getMembers(supabase as any, orgId),
    isAdmin ? orgService.getPendingInvites(supabase as any, orgId) : Promise.resolve([]),
  ])

  return (
    <div className="animate-fadeup" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/settings"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Settings
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">{(membership.organisation as any)?.name}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Members */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Members ({members.length})</span>
          </div>
          {members.map((m) => {
            const profile = m.profile as any
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 18px',
                  borderTop: '1px solid var(--c-border)',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-amber)',
                  flexShrink: 0,
                }}>
                  {profile?.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{profile?.full_name}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>{profile?.email}</p>
                </div>
                <span className={ROLE_BADGE[m.role] ?? 'badge badge-muted'}>{m.role.replace(/_/g, ' ')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                  {formatRelative(m.created_at)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Pending invites */}
        {isAdmin && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Pending Invites ({pendingInvites.length})</span>
            </div>
            {pendingInvites.length === 0 ? (
              <div className="data-panel-empty" style={{ padding: '24px 18px' }}>
                No pending invites.
              </div>
            ) : (
              pendingInvites.map((inv) => (
                <div
                  key={inv.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 18px',
                    borderTop: '1px solid var(--c-border)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <p style={{ fontSize: 13, color: 'var(--c-text)' }}>{inv.email}</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      Invited {formatRelative(inv.created_at)} · expires {formatDate(inv.expires_at)}
                    </p>
                  </div>
                  <span className={ROLE_BADGE[inv.role] ?? 'badge badge-muted'}>{inv.role.replace(/_/g, ' ')}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CopyInviteLinkButton token={inv.token} />
                    <RevokeInviteButton inviteId={inv.id} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Invite form */}
        {isAdmin && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Invite team member</span>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <InviteForm orgId={orgId} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
