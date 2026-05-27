import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService } from '@esite/shared'
import type { OrgRole } from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

const VIEW_ROLES: ReadonlyArray<OrgRole> = ['owner', 'admin']

const ROLE_BADGE: Record<string, string> = {
  owner:           'badge badge-amber',
  admin:           'badge badge-blue',
  project_manager: 'badge badge-blue',
  contractor:      'badge badge-muted',
  inspector:       'badge badge-muted',
  supplier:        'badge badge-muted',
  client_viewer:   'badge badge-muted',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) redirect(`/projects/${id}`)

  const orgId = (project as any).organisation_id ?? (project as any).organisationId
  const guard = await requireRole(supabase, orgId, VIEW_ROLES)
  if (!guard.ok) redirect(`/projects/${id}/settings/general`)

  // Projects inherit org-wide membership — fetch active org members + profiles.
  const { data: members } = await (supabase as any)
    .from('user_organisations')
    .select('id, user_id, role, is_active, profiles!user_organisations_user_id_fkey(full_name, email)')
    .eq('organisation_id', orgId)
    .eq('is_active', true)
    .order('created_at')

  const rows = (members ?? []) as Array<{
    id: string
    user_id: string
    role: string
    is_active: boolean
    profiles: { full_name: string | null; email: string | null } | null
  }>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Info banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 14px',
          background: 'var(--c-elevated)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--c-text-mid)',
        }}
      >
        <Users size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--c-text-dim)' }} />
        <span>
          Project-level membership is inherited from your organisation. To add or remove
          members, use the{' '}
          <Link
            href="/settings/users"
            style={{ color: 'var(--c-amber)', textDecoration: 'none' }}
          >
            organisation members page
          </Link>
          .
        </span>
      </div>

      {/* Members list */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Members</h2>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>
                {rows.length} active member{rows.length !== 1 ? 's' : ''} in this organisation
              </p>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No members found"
              description="No active members in this organisation."
              dense
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--c-border)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--c-text-dim)',
                  }}
                >
                  <th style={{ textAlign: 'left', padding: '0 0 8px' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '0 0 8px' }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '0 0 8px' }}>Role</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr
                    key={m.id}
                    style={{
                      borderTop: i === 0 ? undefined : '1px solid var(--c-border)',
                    }}
                  >
                    <td style={{ padding: '10px 0', fontSize: 13, color: 'var(--c-text)', fontWeight: 500 }}>
                      {m.profiles?.full_name ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 0', fontSize: 12, color: 'var(--c-text-mid)', fontFamily: 'var(--font-mono)' }}>
                      {m.profiles?.email ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 0' }}>
                      <span className={ROLE_BADGE[m.role] ?? 'badge badge-muted'}>
                        {m.role.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
