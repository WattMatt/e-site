'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState } from 'react'
import SignatureModal from '../SignatureModal'

export default function SignatureField({ field, inspectionId, readOnly }: RendererProps) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      {!readOnly && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            background: 'var(--c-panel)',
            color: 'var(--c-text-mid)',
            fontSize: 13,
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          ✍ Sign
        </button>
      )}
      {open && (
        <SignatureModal
          inspectionId={inspectionId}
          role="inspector"
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
