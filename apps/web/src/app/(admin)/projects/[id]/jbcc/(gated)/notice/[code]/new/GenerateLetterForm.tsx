'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { JbccNotice, JbccNoticeField, JbccParty } from '@esite/shared'
import { generateLetterAction } from '@/actions/jbcc.actions'

interface Props {
  projectId: string
  notice:    JbccNotice
  fields:    JbccNoticeField[]
  parties:   JbccParty[]
}

export function GenerateLetterForm({ projectId, notice, fields, parties }: Props) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const manualFields = fields.filter(f => f.source === 'manual')
  const needsTrigger = notice.time_bar_days !== null

  const [recipientId,   setRecipientId]   = useState<string>(parties[0]?.id ?? '')
  const [triggerDate,   setTriggerDate]   = useState<string>('')
  const [manualValues,  setManualValues]  = useState<Record<string, string>>(
    Object.fromEntries(manualFields.map(f => [f.placeholder, ''])),
  )

  // No parties — can't generate a letter without a recipient.
  if (parties.length === 0) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600 }}>
        <h2 style={{ marginBottom: '0.75rem', fontSize: '1.25rem', fontWeight: 600 }}>
          {notice.code} — {notice.title}
        </h2>
        <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
          You need to add at least one party before you can generate this notice.
        </p>
        <a
          href={`/projects/${projectId}/jbcc/parties`}
          style={{
            display: 'inline-block',
            padding: '0.5rem 1rem',
            background: 'var(--c-primary, #2563eb)',
            color: '#fff',
            borderRadius: '0.375rem',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Add a party
        </a>
      </div>
    )
  }

  function handleManualChange(placeholder: string, value: string) {
    setManualValues(prev => ({ ...prev, [placeholder]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const payload = {
      notice_code:        notice.code,
      recipient_party_id: recipientId,
      trigger_date:       needsTrigger && triggerDate ? triggerDate : null,
      manual_values:      manualValues,
    }

    startTransition(async () => {
      const result = await generateLetterAction(projectId, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }

      const { letterId, documentPath } = result.data

      // Fetch a signed URL and trigger the browser download.
      try {
        const res = await fetch(`/api/jbcc/sign?path=${encodeURIComponent(documentPath)}`)
        if (res.ok) {
          const { url } = await res.json() as { url: string }
          const a = document.createElement('a')
          a.href = url
          a.download = `${notice.code}.docx`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
      } catch {
        // Download failure is non-fatal; the letter row was still created.
      }

      // Navigate to the letter's tracking page (Phase 7 creates the route;
      // 404 is acceptable for now — the letter was saved).
      router.push(`/projects/${projectId}/jbcc/tracking/${letterId}`)
    })
  }

  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--c-border, #d1d5db)',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
    background: 'var(--c-surface, #fff)',
    color: 'inherit',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.25rem',
    fontSize: '0.875rem',
    fontWeight: 500,
  }

  const fieldGroupStyle: React.CSSProperties = {
    marginBottom: '1rem',
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 640 }}>
      <h2 style={{ marginBottom: '0.25rem', fontSize: '1.25rem', fontWeight: 600 }}>
        {notice.code} — {notice.title}
      </h2>
      <p style={{ opacity: 0.6, marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        {notice.purpose}
      </p>

      <form onSubmit={handleSubmit}>
        {/* Recipient picker */}
        <div style={fieldGroupStyle}>
          <label htmlFor="recipient" style={labelStyle}>
            Recipient party <span style={{ color: 'var(--c-danger, #dc2626)' }}>*</span>
          </label>
          <select
            id="recipient"
            value={recipientId}
            onChange={e => setRecipientId(e.target.value)}
            required
            style={inputStyle}
          >
            {parties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.company ? ` — ${p.company}` : ''} ({p.party_role.replace(/_/g, ' ')})
              </option>
            ))}
          </select>
        </div>

        {/* Trigger date — only shown when the notice has a numeric time-bar */}
        {needsTrigger && (
          <div style={fieldGroupStyle}>
            <label htmlFor="trigger_date" style={labelStyle}>
              Trigger date{' '}
              <span style={{ fontWeight: 400, opacity: 0.6 }}>
                ({notice.time_bar_days} {notice.time_bar_unit === 'WD' ? 'working' : 'calendar'} days
                from this date)
              </span>{' '}
              <span style={{ color: 'var(--c-danger, #dc2626)' }}>*</span>
            </label>
            <input
              id="trigger_date"
              type="date"
              value={triggerDate}
              onChange={e => setTriggerDate(e.target.value)}
              required={needsTrigger}
              style={inputStyle}
            />
          </div>
        )}

        {/* Manual fields */}
        {manualFields.map(field => {
          const value = manualValues[field.placeholder] ?? ''
          return (
            <div key={field.id} style={fieldGroupStyle}>
              <label htmlFor={`field-${field.id}`} style={labelStyle}>
                {field.label}
                {field.required && (
                  <span style={{ color: 'var(--c-danger, #dc2626)' }}> *</span>
                )}
              </label>
              {field.field_type === 'textarea' ? (
                <textarea
                  id={`field-${field.id}`}
                  value={value}
                  onChange={e => handleManualChange(field.placeholder, e.target.value)}
                  required={field.required}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              ) : (
                <input
                  id={`field-${field.id}`}
                  type={field.field_type === 'date' ? 'date' : 'text'}
                  value={value}
                  onChange={e => handleManualChange(field.placeholder, e.target.value)}
                  required={field.required}
                  style={inputStyle}
                />
              )}
            </div>
          )
        })}

        {error && (
          <p
            role="alert"
            style={{
              marginBottom: '1rem',
              padding: '0.5rem 0.75rem',
              background: 'var(--c-danger-subtle, #fef2f2)',
              color: 'var(--c-danger, #dc2626)',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '0.625rem 1.25rem',
            background: busy ? 'var(--c-muted, #9ca3af)' : 'var(--c-primary, #2563eb)',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Generating…' : 'Generate letter'}
        </button>
      </form>
    </div>
  )
}
