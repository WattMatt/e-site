'use client'
// Stub — real renderer lands in Task 25.
import type { RendererProps } from '../FieldRenderer'
export default function SignatureField({ field }: RendererProps) {
  return <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{field.label}</div>
}
