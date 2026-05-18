'use client'

import type { RendererProps } from '../FieldRenderer'
import { evaluateField } from '@esite/shared'

export default function NumberField({ field, response, readOnly, onChange }: RendererProps) {
  const ev = evaluateField(field, response ?? { section_id: '', field_id: field.field_id })
  const passColor =
    ev.passState === 'pass'
      ? 'var(--c-green, #45a049)'
      : ev.passState === 'fail'
        ? 'var(--c-red, #c0392b)'
        : 'var(--c-text-dim)'
  const passBg =
    ev.passState === 'pass'
      ? 'var(--c-green-dim, rgba(69,160,73,0.12))'
      : ev.passState === 'fail'
        ? 'var(--c-red-dim, rgba(192,57,43,0.12))'
        : 'var(--c-panel)'
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          step="any"
          disabled={readOnly}
          style={{
            flex: 1,
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: 8,
            fontSize: 13,
            background: 'var(--c-panel)',
            color: 'var(--c-text)',
          }}
          value={response?.value_number ?? ''}
          onChange={(e) =>
            onChange({
              value_number: e.target.value === '' ? null : parseFloat(e.target.value),
              pass_state: undefined,
            })
          }
        />
        {field.unit && (
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--c-text-mid)' }}>
            {field.unit}
          </span>
        )}
        {field.pass_when && (
          <span
            style={{
              fontSize: 10,
              padding: '4px 8px',
              borderRadius: 4,
              fontFamily: 'var(--font-mono)',
              background: passBg,
              color: passColor,
            }}
          >
            {field.pass_when} · {ev.passState}
          </span>
        )}
      </div>
    </div>
  )
}
