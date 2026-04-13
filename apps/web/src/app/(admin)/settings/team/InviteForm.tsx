'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { inviteMemberSchema, type InviteMemberInput, orgService } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'inspector', label: 'Inspector' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'client_viewer', label: 'Client (read-only)' },
]

interface Props { orgId: string }

export function InviteForm({ orgId }: Props) {
  const [invite, setInvite] = useState<{ token: string; email: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteMemberInput>({ resolver: zodResolver(inviteMemberSchema) })

  async function onSubmit(input: InviteMemberInput) {
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    try {
      const inv = await orgService.invite(supabase as any, orgId, user.id, input)
      setInvite({ token: inv.token, email: inv.email })
      reset()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create invite')
    }
  }

  const inviteUrl = invite
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/onboarding/join?token=${invite.token}`
    : null

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit(onSubmit)} className="flex gap-3">
        <div className="flex-1">
          <input
            {...register('email')}
            type="email"
            placeholder="colleague@company.co.za"
            className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
        </div>
        <div>
          <select
            {...register('role')}
            className="bg-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <Button type="submit" isLoading={isSubmitting} size="sm">Send Invite</Button>
      </form>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm">{error}</div>
      )}

      {invite && inviteUrl && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-4">
          <p className="text-emerald-400 text-sm font-medium mb-2">
            Invite created for {invite.email}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-slate-300 bg-slate-900 rounded px-3 py-2 truncate">
              {inviteUrl}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(inviteUrl)}
              className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">Expires in 7 days. Share this link with {invite.email}.</p>
        </div>
      )}
    </div>
  )
}
