'use client'

import type { RendererProps } from '../FieldRenderer'

// Stored lowercase in value_text. 'poor' fails the inspection (engine verdictFailure).
const CHOICES = [
  { value: 'good', label: 'Good', color: 'var(--c-green, #45a049)', dim: 'var(--c-green-dim, rgba(69,160,73,0.12))' },
  { value: 'fair', label: 'Fair', color: 'var(--c-amber, #b7791f)', dim: 'var(--c-amber-dim, rgba(183,121,31,0.12))' },
  { value: 'poor', label: 'Poor', color: 'var(--c-red, #c0392b)', dim: 'var(--c-red-dim, rgba(192,57,43,0.12))' },
] as const

export default function RatingField({ field, response, readOnly, onChange }: RendererProps) {
  const v = response?.value_text?.toLowerCase() ?? null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
          {field.label}
          {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
        </label>
        {field.sans_ref && (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)' }}>
            {field.sans_ref}
          </span>
        )}
      </div>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      <div role="radiogroup" aria-label={field.label} style={{ display: 'flex', gap: 8 }}>
        {CHOICES.map((c) => {
          const on = v === c.value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={readOnly}
              onClick={() => onChange({ value_text: c.value, pass_state: c.value === 'poor' ? 'fail' : 'pass' })}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 6,
                border: on ? `1px solid ${c.color}` : '1px solid var(--c-border)',
                background: on ? c.dim : 'var(--c-panel)',
                color: on ? c.color : 'var(--c-text-mid)',
                fontWeight: on ? 600 : 400,
                fontSize: 13,
                cursor: readOnly ? 'not-allowed' : 'pointer',
                opacity: readOnly ? 0.6 : 1,
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>
      {v === 'poor' && (
        <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>Poor fails the inspection.</p>
      )}
    </div>
  )
}
