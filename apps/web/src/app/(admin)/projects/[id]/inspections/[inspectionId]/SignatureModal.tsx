'use client'

import { useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { Button } from '@/components/ui/Button'

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: 8,
  fontSize: 13,
  background: 'var(--c-panel)',
  color: 'var(--c-text)',
  fontFamily: 'inherit',
}

export default function SignatureModal({
  inspectionId,
  role,
  fieldId,
  sectionId,
  onClose,
}: {
  inspectionId: string
  role: 'inspector' | 'verifier' | 'client' | 'witness'
  fieldId?: string
  sectionId?: string
  onClose: () => void
}) {
  const ref = useRef<SignatureCanvas>(null)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [regNo, setRegNo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSave = async () => {
    setError(null)
    if (ref.current?.isEmpty()) {
      setError('Please sign before saving.')
      return
    }
    if (!name.trim()) {
      setError('Full name is required.')
      return
    }
    setSaving(true)
    try {
      const dataUrl = ref.current!.toDataURL('image/png')
      const blob = await (await fetch(dataUrl)).blob()
      const fd = new FormData()
      fd.append('file', blob, 'signature.png')
      fd.append('inspectionId', inspectionId)
      fd.append('role', role)
      if (fieldId) fd.append('fieldId', fieldId)
      if (sectionId) fd.append('sectionId', sectionId)
      fd.append('signatoryName', name.trim())
      fd.append('signatoryTitle', title.trim())
      fd.append('registrationNumber', regNo.trim())
      const res = await fetch('/api/inspections/upload-signature', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Save failed (HTTP ${res.status}): ${t}`)
      }
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: 'var(--c-panel)',
          padding: 20,
          borderRadius: 8,
          border: '1px solid var(--c-border)',
          maxWidth: 560,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>
          Sign as {role}
        </h2>
        <input
          style={FIELD_STYLE}
          placeholder="Full name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          style={FIELD_STYLE}
          placeholder="Title (e.g. Master Installation Electrician)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          style={FIELD_STYLE}
          placeholder="Registration number (ECB reg#)"
          value={regNo}
          onChange={(e) => setRegNo(e.target.value)}
        />
        <div
          style={{
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            background: '#fff',
          }}
        >
          <SignatureCanvas
            ref={ref}
            canvasProps={{
              width: 520,
              height: 200,
              style: { width: '100%', height: 200, display: 'block' },
            }}
          />
        </div>
        {error && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--c-red)',
              background: 'var(--c-red-dim, rgba(192,57,43,0.12))',
              border: '1px solid var(--c-red-dim, rgba(192,57,43,0.3))',
              borderRadius: 6,
              padding: 8,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => ref.current?.clear()}>
            Clear
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save signature'}
          </Button>
        </div>
      </div>
    </div>
  )
}
