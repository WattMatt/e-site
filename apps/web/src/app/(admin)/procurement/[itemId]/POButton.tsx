'use client'

import { useState, useTransition } from 'react'
import { generatePOPDFAction } from '@/actions/po.actions'

export function POButton({
  procurementItemId,
  disabled,
  disabledReason,
}: {
  procurementItemId: string
  disabled?: boolean
  disabledReason?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await generatePOPDFAction(procurementItemId)
      if (res.error || !res.pdfBase64) {
        setError(res.error ?? 'Failed to generate PO')
        return
      }
      // Decode base64 → Blob → trigger download.
      const bin = atob(res.pdfBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename ?? 'PurchaseOrder.pdf'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending || disabled}
        title={disabled ? disabledReason : 'Generate Purchase Order PDF'}
        className="btn-primary-amber"
        style={{ width: '100%' }}
      >
        {pending ? 'Generating…' : '↓ Generate PO PDF'}
      </button>
      {error && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 11 }}>{error}</div>
      )}
      {disabled && disabledReason && (
        <div style={{ fontSize: 11, color: 'var(--c-text-dim)', fontStyle: 'italic' }}>
          {disabledReason}
        </div>
      )}
    </div>
  )
}
