'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState } from 'react'
import SignatureModal from '../SignatureModal'
import { usePhotoTally } from './photo-tally'

export default function SignatureField({ field, sectionId, inspectionId, readOnly }: RendererProps) {
  const [open, setOpen] = useState(false)
  const { signatures, signed } = usePhotoTally()
  const existing = signatures.find((x) => x.section_id === sectionId && x.field_id === field.field_id)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      {existing && (
        <p style={{ fontSize: 12, color: 'var(--c-green, #16a34a)', margin: 0 }}>
          Signed by {existing.signatory_name ?? 'unknown'}
          {existing.signed_at ? ` on ${new Date(existing.signed_at).toLocaleDateString('en-ZA')}` : ''}
        </p>
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
          {existing ? '✍ Sign again' : '✍ Sign'}
        </button>
      )}
      {open && (
        <SignatureModal
          inspectionId={inspectionId}
          role="inspector"
          fieldId={field.field_id}
          sectionId={sectionId}
          onClose={() => setOpen(false)}
          onSaved={(signatoryName) =>
            signed({ section_id: sectionId, field_id: field.field_id, signatory_name: signatoryName, signed_at: new Date().toISOString() })
          }
        />
      )}
    </div>
  )
}
