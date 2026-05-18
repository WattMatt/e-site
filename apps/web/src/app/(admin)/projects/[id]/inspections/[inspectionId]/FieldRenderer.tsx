'use client'

// Stub — real dispatcher lands in Task 24.
import type { Field, Response as InspectionResponse } from '@esite/shared'

export interface RendererProps {
  field: Field
  response?: InspectionResponse
  inspectionId: string
  sectionId: string
  readOnly: boolean
  verifierFlipMode: boolean
  onChange: (patch: Partial<InspectionResponse>) => void
}

export default function FieldRenderer({ field }: RendererProps) {
  return (
    <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
      {field.label} <span style={{ fontFamily: 'var(--font-mono)' }}>({field.type})</span>
    </div>
  )
}
