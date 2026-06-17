'use client'

import type { RendererProps } from '../FieldRenderer'

export default function DropdownField({ field, response, readOnly, onChange }: RendererProps) {
  const isMulti = field.type === 'multi_select'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      <select
        disabled={readOnly}
        multiple={isMulti}
        style={{
          width: '100%',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          padding: 8,
          fontSize: 13,
          background: 'var(--c-panel)',
          color: 'var(--c-text)',
          fontFamily: 'inherit',
        }}
        value={isMulti ? (response?.value_array ?? []) : (response?.value_text ?? (field.default_value != null ? String(field.default_value) : ''))}
        onChange={(e) => {
          if (isMulti) {
            const arr = Array.from(e.target.selectedOptions).map((o) => o.value)
            onChange({ value_array: arr })
          } else {
            onChange({ value_text: e.target.value })
          }
        }}
      >
        {!isMulti && <option value="">— select —</option>}
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}
