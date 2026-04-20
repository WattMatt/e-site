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
import { FormField, TextInput, Select } from '@/components/ui/FormField'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Email" error={errors.email?.message} htmlFor="invite-email">
            <TextInput
              id="invite-email"
              {...register('email')}
              type="email"
              placeholder="colleague@company.co.za"
              invalid={Boolean(errors.email)}
            />
          </FormField>
        </div>
        <div style={{ width: 180 }}>
          <FormField label="Role" htmlFor="invite-role">
            <Select id="invite-role" {...register('role')}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <Button type="submit" isLoading={isPending} size="sm">Send Invite</Button>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--c-red-dim)',
            color: 'var(--c-red)',
            border: '1px solid rgba(232,85,85,0.3)',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          style={{
            background: 'var(--c-green-dim)',
            color: 'var(--c-green)',
            border: '1px solid rgba(61,184,130,0.3)',
            borderRadius: 6,
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            Invite email sent to {success}
          </p>
          <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 4, marginBottom: 0 }}>
            They&apos;ll receive an email with a link to set their password and join your organisation.
          </p>
        </div>
      )}
    </div>
  )
}
