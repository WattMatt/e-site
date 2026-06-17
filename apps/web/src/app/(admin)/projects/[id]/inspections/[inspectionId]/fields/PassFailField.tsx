'use client'

import type { RendererProps } from '../FieldRenderer'

export default function PassFailField({ field, response, readOnly, onChange }: RendererProps) {
  const v = response?.value_bool
  const isNa = response?.pass_state === 'na'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
          {field.label}
          {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
        </label>
        {field.sans_ref && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: 'var(--c-text-dim)',
            }}
          >
            {field.sans_ref}
          </span>
        )}
      </div>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange({ value_bool: true, pass_state: 'pass', fail_reason: null })}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: v === true ? '1px solid var(--c-green, #45a049)' : '1px solid var(--c-border)',
            background: v === true ? 'var(--c-green-dim, rgba(69,160,73,0.12))' : 'var(--c-panel)',
            color: v === true ? 'var(--c-green, #45a049)' : 'var(--c-text-mid)',
            fontWeight: v === true ? 600 : 400,
            fontSize: 13,
            cursor: readOnly ? 'not-allowed' : 'pointer',
            opacity: readOnly ? 0.6 : 1,
          }}
        >
          ✓ Pass
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange({ value_bool: false, pass_state: 'fail' })}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: v === false ? '1px solid var(--c-red, #c0392b)' : '1px solid var(--c-border)',
            background: v === false ? 'var(--c-red-dim, rgba(192,57,43,0.12))' : 'var(--c-panel)',
            color: v === false ? 'var(--c-red, #c0392b)' : 'var(--c-text-mid)',
            fontWeight: v === false ? 600 : 400,
            fontSize: 13,
            cursor: readOnly ? 'not-allowed' : 'pointer',
            opacity: readOnly ? 0.6 : 1,
          }}
        >
          ✗ Fail
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange({ value_bool: null, pass_state: 'na', fail_reason: null })}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: isNa ? '1px solid var(--c-text-mid)' : '1px solid var(--c-border)',
            background: isNa ? 'var(--c-panel-dim, rgba(0,0,0,0.06))' : 'var(--c-panel)',
            color: isNa ? 'var(--c-text)' : 'var(--c-text-dim)',
            fontWeight: isNa ? 600 : 400,
            fontSize: 13,
            cursor: readOnly ? 'not-allowed' : 'pointer',
            opacity: readOnly ? 0.6 : 1,
          }}
        >
          N/A
        </button>
      </div>
      {v === false && (
        <input
          disabled={readOnly}
          style={{
            width: '100%',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: 8,
            fontSize: 12,
            marginTop: 4,
            background: 'var(--c-panel)',
            color: 'var(--c-text)',
          }}
          placeholder="Reason for fail (required)"
          value={response?.fail_reason ?? ''}
          onChange={(e) =>
            onChange({ value_bool: false, pass_state: 'fail', fail_reason: e.target.value })
          }
        />
      )}
    </div>
  )
}
