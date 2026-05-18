'use client'

import type { RendererProps } from '../FieldRenderer'

export default function TextField({ field, response, readOnly, onChange }: RendererProps) {
  const isTextarea = field.type === 'textarea'
  const sharedStyle: React.CSSProperties = {
    width: '100%',
    border: '1px solid var(--c-border)',
    borderRadius: 6,
    padding: 8,
    fontSize: 13,
    background: 'var(--c-panel)',
    color: 'var(--c-text)',
    fontFamily: 'inherit',
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      {isTextarea ? (
        <textarea
          disabled={readOnly}
          style={sharedStyle}
          rows={3}
          value={response?.value_text ?? ''}
          onChange={(e) => onChange({ value_text: e.target.value })}
        />
      ) : (
        <input
          disabled={readOnly}
          style={sharedStyle}
          value={response?.value_text ?? ''}
          onChange={(e) => onChange({ value_text: e.target.value })}
        />
      )}
    </div>
  )
}
