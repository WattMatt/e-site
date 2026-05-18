'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  certifyInspectionAction,
  sendBackForReinspectionAction,
} from '@/actions/inspections-certify.actions'

type Mode = 'certify' | 'send_back'

export default function CertifyModal({
  inspectionId,
  projectId,
  deliverableType,
  onClose,
}: {
  inspectionId: string
  projectId: string
  deliverableType: string
  onClose: () => void
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('certify')
  const [cocNumber, setCocNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onConfirm = async () => {
    setError(null)
    setBusy(true)
    try {
      if (mode === 'certify') {
        await certifyInspectionAction({
          inspectionId,
          projectId,
          cocNumber: deliverableType === 'coc' ? cocNumber : undefined,
        })
      } else {
        await sendBackForReinspectionAction({ inspectionId, projectId, notes })
      }
      onClose()
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const tabButton = (target: Mode, label: string, activeBg: string, activeBorder: string) => (
    <button
      type="button"
      onClick={() => setMode(target)}
      style={{
        flex: 1,
        padding: '8px 12px',
        borderRadius: 6,
        border: mode === target ? `1px solid ${activeBorder}` : '1px solid var(--c-border)',
        background: mode === target ? activeBg : 'var(--c-panel)',
        color: mode === target ? 'var(--c-text)' : 'var(--c-text-mid)',
        fontWeight: mode === target ? 600 : 400,
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

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
          maxWidth: 520,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>
          Verifier action
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabButton(
            'certify',
            'Certify',
            'var(--c-green-dim, rgba(69,160,73,0.12))',
            'var(--c-green, #45a049)',
          )}
          {tabButton(
            'send_back',
            'Send back',
            'var(--c-amber-dim, rgba(225,150,30,0.12))',
            'var(--c-amber)',
          )}
        </div>

        {mode === 'certify' && deliverableType === 'coc' && (
          <input
            style={{
              width: '100%',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              padding: 8,
              fontSize: 13,
              background: 'var(--c-panel)',
              color: 'var(--c-text)',
              fontFamily: 'inherit',
            }}
            placeholder="COC number from your ECB pad *"
            value={cocNumber}
            onChange={(e) => setCocNumber(e.target.value)}
          />
        )}
        {mode === 'certify' && deliverableType !== 'coc' && (
          <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>
            A {deliverableType === 'inspection_only' ? 'INS' : 'FAT'} number will be
            auto-allocated for this inspection.
          </p>
        )}
        {mode === 'send_back' && (
          <textarea
            rows={4}
            style={{
              width: '100%',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              padding: 8,
              fontSize: 13,
              background: 'var(--c-panel)',
              color: 'var(--c-text)',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
            placeholder="Notes for the inspector (required) *"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}

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
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : mode === 'certify' ? 'Certify' : 'Send back'}
          </Button>
        </div>
      </div>
    </div>
  )
}
