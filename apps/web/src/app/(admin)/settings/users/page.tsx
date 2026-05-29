import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { OWNER_ADMIN, formatDate } from '@esite/shared'
import { AddUserForm } from './AddUserForm'
import { UserRowActions } from './UserRowActions'

export const dynamic = 'force-dynamic'

const ROLE_BADGE: Record<string, string> = {
  owner:           'badge badge-amber',
  admin:           'badge badge-amber',
  project_manager: 'badge badge-blue',
  contractor:      'badge badge-muted',
  inspector:       'badge badge-muted',
  supplier:        'badge badge-muted',
  client_viewer:   'badge badge-muted',
}

interface MemberRow {
  id:         string
  user_id:    string
  role:       string
  is_active:  boolean
  created_at: string
  profile:    { full_name: string | null; email: string | null } | null
}

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em',
}

export default async function UsersPage() {
  const ctx = await getOrgContext()
  if (!ctx) {
    return (
      <div className="animate-fadeup">
        <div className="page-header"><h1 className="page-title">Users</h1></div>
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <p style={monoDim}>No organisation found. Complete onboarding first.</p>
            <Link href="/onboarding" className="btn-primary-amber" style={{ padding: '9px 16px', textDecoration: 'none' }}>
              Go to Onboarding
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!OWNER_ADMIN.includes(ctx.role)) redirect('/dashboard')

  const service = createServiceClient()

  const [{ data: membersRaw }, { data: org }, usersList] = await Promise.all([
    service
      .from('user_organisations')
      .select('id, user_id, role, is_active, created_at, profile:profiles!user_organisations_user_id_fkey(full_name, email)')
      .eq('organisation_id', ctx.organisationId)
      .order('created_at'),
    service
      .from('organisations')
      .select('name')
      .eq('id', ctx.organisationId)
      .maybeSingle(),
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  const members = (membersRaw ?? []) as unknown as MemberRow[]
  const activeCount = members.filter((m) => m.is_active).length

  const lastSeen = new Map<string, string>()
  for (const u of usersList.data?.users ?? []) {
    if (u.last_sign_in_at) lastSeen.set(u.id, u.last_sign_in_at)
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings" style={{ ...monoDim, textDecoration: 'none' }}>← Settings</Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{org?.name ?? 'Your organisation'}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Add user</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <AddUserForm />
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              Members ({activeCount} active · {members.length} total)
            </span>
          </div>
          {members.length === 0 ? (
            <div className="data-panel-empty" style={{ padding: '24px 18px' }}>No users yet.</div>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px', borderTop: '1px solid var(--c-border)',
                  flexWrap: 'wrap', opacity: m.is_active ? 1 : 0.55,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-amber)',
                  flexShrink: 0,
                }}>
                  {m.profile?.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                    {m.profile?.full_name ?? '—'}
                    {m.user_id === ctx.userId && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginLeft: 8 }}>you</span>
                    )}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {m.profile?.email ?? '—'}
                  </p>
                </div>
                <span className={ROLE_BADGE[m.role] ?? 'badge badge-muted'}>{m.role.replace(/_/g, ' ')}</span>
                {!m.is_active && <span className="badge badge-muted">inactive</span>}
                <div style={{ textAlign: 'right', minWidth: 96 }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {lastSeen.has(m.user_id)
                      ? `seen ${formatDate(lastSeen.get(m.user_id)!)}`
                      : 'never signed in'}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)', opacity: 0.6 }}>
                    joined {formatDate(m.created_at)}
                  </p>
                </div>
                <UserRowActions
                  userId={m.user_id}
                  role={m.role}
                  isActive={m.is_active}
                  isSelf={m.user_id === ctx.userId}
                  callerRole={ctx.role}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
