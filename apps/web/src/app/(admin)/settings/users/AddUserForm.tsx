'use client'

/**
 * AddUserForm — creates an organisation member directly (no invite).
 * Calls createUserAction, which provisions the auth user and emails them a
 * set-password link. The role dropdown reads the canonical ORG_ROLES enum.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput, Select } from '@/components/ui/FormField'
import { ORG_ROLES, ORG_ROLE_LABELS } from '@esite/shared'
import { createUserAction } from '@/actions/users.actions'

// The owner role is never assigned at creation — it is transferred separately.
const ASSIGNABLE_ROLES = ORG_ROLES.filter((r) => r !== 'owner')

const schema = z.object({
  email:    z.string().email('Valid email required'),
  fullName: z.string().min(2, 'Full name required'),
  role:     z.string().min(1, 'Role required'),
})
type FormValues = z.infer<typeof schema>

export function AddUserForm() {
  const router = useRouter()
  const [success, setSuccess] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'contractor' },
  })

  function onSubmit(values: FormValues) {
    setError(null)
    setSuccess(null)
    setWarning(null)
    startTransition(async () => {
      const result = await createUserAction({
        email: values.email,
        fullName: values.fullName,
        role: values.role,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSuccess(values.email)
      if (result.warning) setWarning(result.warning)
      reset({ email: '', fullName: '', role: 'contractor' })
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <FormField label="Full name" error={errors.fullName?.message} htmlFor="user-name">
            <TextInput
              id="user-name"
              {...register('fullName')}
              placeholder="Thandi Mokoena"
              invalid={Boolean(errors.fullName)}
              style={{ width: '100%' }}
            />
          </FormField>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <FormField label="Email" error={errors.email?.message} htmlFor="user-email">
            <TextInput
              id="user-email"
              {...register('email')}
              type="email"
              placeholder="colleague@company.co.za"
              invalid={Boolean(errors.email)}
              style={{ width: '100%' }}
            />
          </FormField>
        </div>
        <div style={{ width: 180 }}>
          <FormField label="Role" htmlFor="user-role">
            <Select id="user-role" {...register('role')} style={{ width: '100%' }}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ORG_ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <Button type="submit" isLoading={isPending} size="sm">Add user</Button>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--c-red-dim)', color: 'var(--c-red)',
            border: '1px solid rgba(232,85,85,0.3)', borderRadius: 6,
            padding: '10px 14px', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          style={{
            background: 'var(--c-green-dim)', color: 'var(--c-green)',
            border: '1px solid rgba(61,184,130,0.3)', borderRadius: 6,
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>User created — {success}</p>
          <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 4, marginBottom: 0 }}>
            {warning ?? 'They’ve been emailed a link to set their password and sign in.'}
          </p>
        </div>
      )}
    </div>
  )
}
