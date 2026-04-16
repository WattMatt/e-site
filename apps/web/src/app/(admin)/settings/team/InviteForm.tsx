'use client'

/**
 * InviteForm — sends a Supabase auth invite email.
 *
 * Uses `inviteTeamMemberAction` (server action) which calls
 * `auth.admin.inviteUserByEmail` with redirectTo = APP_URL/invite/{token}.
 * Supabase sends the email and the invitee clicks the link to land on
 * /invite/[token] where they set their name and password.
 *
 * Fix per SPEC_FEEDBACK.md [2026-04-16]: previous implementation generated
 * manual tokens pointing to /onboarding/join?token=... which didn't match
 * the /invite/[token] page that uses verifyOtp.
 */

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { inviteTeamMemberAction } from '@/actions/onboarding.actions'

const schema = z.object({
  email: z.string().email('Valid email required'),
  role: z.string().min(1, 'Role required'),
})
type FormValues = z.infer<typeof schema>

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'field_worker', label: 'Field Worker' },
  { value: 'inspector', label: 'Inspector' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'client_viewer', label: 'Client (read-only)' },
]

interface Props { orgId: string }

export function InviteForm({ orgId }: Props) {
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  function onSubmit(values: FormValues) {
    setError(null)
    setSuccess(null)

    const fd = new FormData()
    fd.append('email', values.email)
    fd.append('role', values.role)

    startTransition(async () => {
      const result = await inviteTeamMemberAction(orgId, fd)
      if (result?.error) {
        setError(result.error)
      } else {
        setSuccess(values.email)
        reset()
      }
    })
  }

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
        <Button type="submit" isLoading={isPending} size="sm">Send Invite</Button>
      </form>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm">{error}</div>
      )}

      {success && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-4">
          <p className="text-emerald-400 text-sm font-medium">
            Invite email sent to {success}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            They&apos;ll receive an email with a link to set their password and join your organisation.
          </p>
        </div>
      )}
    </div>
  )
}
