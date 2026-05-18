'use client'

import type { RendererProps } from '../FieldRenderer'

export default function ComputedField({ field }: RendererProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-dim)' }}>
        {field.label}
      </label>
      <div
        style={{
          fontSize: 11,
          fontStyle: 'italic',
          color: 'var(--c-text-dim)',
          fontFamily: 'var(--font-mono)',
        }}
        title={field.formula}
      >
        (computed: {field.formula ?? 'n/a'})
      </div>
    </div>
  )
}
