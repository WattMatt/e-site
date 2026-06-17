'use client'

import type { RendererProps } from '../FieldRenderer'

export default function DateField({ field, response, readOnly, onChange }: RendererProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      <input
        type="date"
        disabled={readOnly}
        style={{
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          padding: 8,
          fontSize: 13,
          background: 'var(--c-panel)',
          color: 'var(--c-text)',
          fontFamily: 'inherit',
          maxWidth: 220,
        }}
        value={response?.value_text ?? (field.default_value != null ? String(field.default_value) : '')}
        onChange={(e) => onChange({ value_text: e.target.value })}
      />
    </div>
  )
}
