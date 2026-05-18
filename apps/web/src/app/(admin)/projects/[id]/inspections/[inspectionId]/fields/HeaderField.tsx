'use client'

import type { RendererProps } from '../FieldRenderer'

export default function HeaderField({ field }: RendererProps) {
  return (
    <h3
      style={{
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--c-text)',
        marginTop: 16,
        marginBottom: 4,
        paddingBottom: 6,
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {field.label}
    </h3>
  )
}
