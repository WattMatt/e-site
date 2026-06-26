'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { updateProjectAction } from '@/actions/project.actions'
import { useDirtyForm } from '../_components/UnsavedChangesGuard'
import { StickySaveBar } from '../_components/StickySaveBar'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { FormField, TextInput, Textarea } from '@/components/ui/FormField'

// ─── Schema ───────────────────────────────────────────────────────────────────

const clientFormSchema = z.object({
  clientName: z.string().max(200).optional(),
  clientContact: z.string().max(500).optional(),
})

type ClientFormValues = z.infer<typeof clientFormSchema>

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ProjectLike {
  clientName?: string | null
  client_name?: string | null
  clientContact?: string | null
  client_contact?: string | null
}

function buildDefaultValues(initial: ProjectLike | null): ClientFormValues {
  return {
    clientName: initial?.clientName ?? initial?.client_name ?? '',
    clientContact: initial?.clientContact ?? initial?.client_contact ?? '',
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ClientFormProps {
  projectId: string
  initial: ProjectLike | null
}

export function ClientForm({ projectId, initial }: ClientFormProps) {
  const { markDirty, markClean } = useDirtyForm()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: buildDefaultValues(initial),
  })

  useEffect(() => {
    if (isDirty) {
      markDirty('client')
    } else {
      markClean()
    }
  }, [isDirty, markDirty, markClean])

  async function onSubmit(values: ClientFormValues) {
    setServerError(null)
    const result = await updateProjectAction(projectId, {
      clientName: values.clientName || null,
      clientContact: values.clientContact || null,
    })
    if ('error' in result) {
      setServerError(result.error)
      throw new Error(result.error)
    }
    reset(values)
    markClean()
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      {serverError && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
            color: 'var(--c-red)',
            fontSize: 13,
          }}
        >
          {serverError}
        </div>
      )}

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Client Details
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Client name and contact information for this project
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            <FormField label="Client Name" error={errors.clientName?.message}>
              <TextInput
                {...register('clientName')}
                invalid={!!errors.clientName}
                placeholder="e.g. Acme Property Developers"
              />
            </FormField>

            <FormField
              label="Client Contact"
              error={errors.clientContact?.message}
              hint="Phone, email, and/or postal address — one per line"
            >
              <Textarea
                {...register('clientContact')}
                invalid={!!errors.clientContact}
                placeholder={`Jane Smith\n+27 82 000 0000\njane@acme.co.za`}
                rows={4}
              />
            </FormField>

          </div>
        </CardBody>
      </Card>

      <button type="submit" style={{ display: 'none' }} aria-hidden="true" data-testid="submit-hidden" />

      <StickySaveBar
        isDirty={isDirty}
        onSave={handleSubmit(onSubmit)}
        onDiscard={() => reset(buildDefaultValues(initial))}
      />
    </form>
  )
}
