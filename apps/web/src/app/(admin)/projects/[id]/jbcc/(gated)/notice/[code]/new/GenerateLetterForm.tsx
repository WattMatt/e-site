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
      <div
        className="jbcc-page-fade"
        style={{ padding: '48px 40px', maxWidth: 640, margin: '0 auto' }}
      >
        <div
          style={{
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            letterSpacing: '0.24em',
            color: 'var(--c-amber)',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}
        >
          {notice.code}
        </div>
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontWeight: 350,
            fontSize: 32,
            lineHeight: 1.1,
            color: 'var(--c-text)',
            marginBottom: 16,
            margin: '0 0 16px',
          }}
        >
          No parties registered
        </h2>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)', marginBottom: 32, lineHeight: 1.6 }}>
          You need to add at least one party before you can generate this notice.
        </p>
        <a
          href={`/projects/${projectId}/jbcc/parties`}
          className="jbcc-btn-cta"
          style={{
            display: 'inline-block',
            textDecoration: 'none',
            background: 'var(--c-amber)',
            color: 'var(--c-base)',
            borderColor: 'var(--c-amber)',
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '10px 20px',
            border: '1px solid',
            borderRadius: 1,
          }}
        >
          Add a Party →
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
    <div
      className="jbcc-page-fade"
      style={{ padding: '48px 40px 96px', maxWidth: 720, margin: '0 auto' }}
    >
      {/* Eyebrow — notice code */}
      <div
        style={{
          fontFamily: 'var(--f-mono-display)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.24em',
          color: 'var(--c-amber)',
          textTransform: 'uppercase',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {notice.code}
        <span
          style={{
            height: 1,
            flex: 1,
            background: 'linear-gradient(90deg, var(--c-amber-mid-rgb, rgba(232,146,58,.32)), transparent)',
            maxWidth: 80,
          }}
        />
      </div>

      {/* Fraunces italic heading */}
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontWeight: 350,
          fontSize: 'clamp(24px, 3.5vw, 44px)',
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          color: 'var(--c-text)',
          fontVariationSettings: "'opsz' 72, 'SOFT' 30",
          marginBottom: 32,
          margin: '0 0 32px',
        }}
      >
        Generate Letter
      </h1>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 24 }}>
        {/* Recipient picker */}
        <div>
          <label htmlFor="recipient" className="jbcc-label">
            Recipient party <span style={{ color: 'var(--c-red-bright)' }}>*</span>
          </label>
          <select
            id="recipient"
            value={recipientId}
            onChange={e => setRecipientId(e.target.value)}
            required
            className="jbcc-input"
            style={{ appearance: 'none' }}
          >
            {parties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.company ? ` — ${p.company}` : ''} ({p.party_role.replace(/_/g, ' ')})
              </option>
            ))}
          </select>
        </div>

        {/* Trigger date */}
        {needsTrigger && (
          <div>
            <label htmlFor="trigger_date" className="jbcc-label">
              Trigger date · {notice.time_bar_days}{' '}
              {notice.time_bar_unit === 'WD' ? 'working' : 'calendar'} days from this date{' '}
              <span style={{ color: 'var(--c-red-bright)' }}>*</span>
            </label>
            <input
              id="trigger_date"
              type="date"
              value={triggerDate}
              onChange={e => setTriggerDate(e.target.value)}
              required={needsTrigger}
              className="jbcc-input"
            />
          </div>
        )}

        {/* Manual fields */}
        {manualFields.map(field => {
          const value = manualValues[field.placeholder] ?? ''
          return (
            <div key={field.id}>
              <label htmlFor={`field-${field.id}`} className="jbcc-label">
                {field.label}
                {field.required && (
                  <span style={{ color: 'var(--c-red-bright)' }}> *</span>
                )}
              </label>
              {field.field_type === 'textarea' ? (
                <textarea
                  id={`field-${field.id}`}
                  value={value}
                  onChange={e => handleManualChange(field.placeholder, e.target.value)}
                  required={field.required}
                  rows={3}
                  className="jbcc-input"
                  style={{ resize: 'vertical' }}
                />
              ) : (
                <input
                  id={`field-${field.id}`}
                  type={field.field_type === 'date' ? 'date' : 'text'}
                  value={value}
                  onChange={e => handleManualChange(field.placeholder, e.target.value)}
                  required={field.required}
                  className="jbcc-input"
                />
              )}
            </div>
          )
        })}

        {error && (
          <div
            role="alert"
            style={{
              padding: '12px 16px',
              background: 'var(--c-red-dim-rgb, rgba(255,107,107,.10))',
              border: '1px solid rgba(255,107,107,.25)',
              fontFamily: 'var(--f-mono-display)',
              fontSize: 12,
              color: 'var(--c-red-bright)',
              letterSpacing: '0.02em',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="submit"
            disabled={busy}
            className="jbcc-btn-cta"
            style={{
              background: busy ? 'transparent' : 'var(--c-amber)',
              color: busy ? 'var(--c-text-muted)' : 'var(--c-base)',
              borderColor: busy ? 'var(--c-border)' : 'var(--c-amber)',
            }}
          >
            {busy ? 'Generating…' : 'Generate Letter →'}
          </button>
        </div>
      </form>
    </div>
  )
}
