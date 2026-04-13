import { createClient } from '@/lib/supabase/server'
import { orgService } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatRelative } from '@esite/shared'
import { InviteForm } from './InviteForm'
import { RevokeInviteButton } from './RevokeInviteButton'

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

  if (!membership) return null

  const orgId = membership.organisation_id
  const isAdmin = ['owner', 'admin'].includes(membership.role)

  const [members, pendingInvites] = await Promise.all([
    orgService.getMembers(supabase as any, orgId),
    isAdmin ? orgService.getPendingInvites(supabase as any, orgId) : Promise.resolve([]),
  ])

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Team"
        subtitle={(membership.organisation as any)?.name}
      />

      {/* Members */}
      <Card className="mb-6">
        <div className="px-6 py-4 border-b border-slate-700">
          <h3 className="font-semibold text-white">Members ({members.length})</h3>
        </div>
        <div className="divide-y divide-slate-700/50">
          {members.map((m) => {
            const profile = m.profile as any
            return (
              <div key={m.id} className="px-6 py-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-full bg-blue-600/30 border border-blue-600/50 flex items-center justify-center text-sm font-bold text-blue-400 flex-shrink-0">
                  {profile?.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white">{profile?.full_name}</p>
                  <p className="text-xs text-slate-400">{profile?.email}</p>
                </div>
                <Badge variant={m.role === 'owner' ? 'info' : 'ghost'}>
                  {m.role.replace(/_/g, ' ')}
                </Badge>
                <span className="text-xs text-slate-500">{formatRelative(m.created_at)}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Pending invites */}
      {isAdmin && (
        <Card className="mb-6">
          <div className="px-6 py-4 border-b border-slate-700">
            <h3 className="font-semibold text-white">Pending Invites ({pendingInvites.length})</h3>
          </div>
          {pendingInvites.length === 0 ? (
            <CardBody>
              <p className="text-slate-400 text-sm">No pending invites.</p>
            </CardBody>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="px-6 py-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-white text-sm">{inv.email}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Invited {formatRelative(inv.created_at)} · expires {formatDate(inv.expires_at)}
                    </p>
                  </div>
                  <Badge variant="ghost">{inv.role.replace(/_/g, ' ')}</Badge>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/onboarding/join?token=${inv.token}`
                        )
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Copy link
                    </button>
                    <RevokeInviteButton inviteId={inv.id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Invite form */}
      {isAdmin && (
        <Card>
          <div className="px-6 py-4 border-b border-slate-700">
            <h3 className="font-semibold text-white">Invite team member</h3>
          </div>
          <CardBody>
            <InviteForm orgId={orgId} />
          </CardBody>
        </Card>
      )}
    </div>
  )
}
