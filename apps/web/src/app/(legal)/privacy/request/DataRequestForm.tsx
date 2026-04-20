'use client'

import { useState, useTransition } from 'react'
import { submitDataRequestAction } from '@/actions/data-request.actions'
import { FormField, TextInput, Select, Textarea } from '@/components/ui/FormField'

const REQUEST_TYPES = [
  { value: 'access',     label: 'Access — what personal data do you have about me?' },
  { value: 'correction', label: 'Correction — please correct / update my data' },
  { value: 'deletion',   label: 'Deletion — please delete my data' },
  { value: 'complaint',  label: 'Complaint about how my data is being handled' },
  { value: 'other',      label: 'Other (explain below)' },
] as const

export function DataRequestForm() {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)

  function onSubmit(formData: FormData) {
    setResult(null)
    startTransition(async () => {
      const r = await submitDataRequestAction(formData)
      setResult(r)
    })
  }

  if (result?.ok) {
    return (
      <div
        role="status"
        style={{
          background: 'var(--c-green-dim)',
          color: 'var(--c-green)',
          border: '1px solid rgba(61,184,130,0.3)',
          borderRadius: 6,
          padding: '16px 18px',
          marginTop: 24,
        }}
      >
        <strong style={{ display: 'block', marginBottom: 4 }}>Request received.</strong>
        <span style={{ color: 'var(--c-text-mid)', fontSize: 13 }}>
          Our Information Officer has been notified. We&apos;ll respond within 30 days — usually much
          sooner. Keep an eye on the inbox of the email address you provided.
        </span>
      </div>
    )
  }

  return (
    <form
      action={onSubmit}
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 24,
        marginTop: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <FormField label="Full name" required htmlFor="dsr-name">
        <TextInput id="dsr-name" name="name" required minLength={2} placeholder="Jane Doe" />
      </FormField>

      <FormField label="Email we can reach you on" required htmlFor="dsr-email">
        <TextInput id="dsr-email" name="email" type="email" required placeholder="jane@example.co.za" />
      </FormField>

      <FormField label="What kind of request is this?" required htmlFor="dsr-type">
        <Select id="dsr-type" name="requestType" required defaultValue="access">
          {REQUEST_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Tell us more"
        required
        htmlFor="dsr-description"
        hint="A few sentences is fine — the more detail, the faster we can help."
      >
        <Textarea
          id="dsr-description"
          name="description"
          required
          minLength={10}
          rows={6}
          style={{ minHeight: 120 }}
          placeholder="Describe what you'd like us to do."
        />
      </FormField>

      {result?.error && (
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
          {result.error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary-amber"
        style={{ alignSelf: 'flex-start', opacity: isPending ? 0.6 : 1 }}
      >
        {isPending ? 'Sending…' : 'Submit request'}
      </button>
    </form>
  )
}
