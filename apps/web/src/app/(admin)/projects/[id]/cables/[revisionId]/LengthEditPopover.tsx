'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateMeasuredLengthAction,
  updateConfirmedLengthAction,
} from '@/actions/cable-length.actions'

interface BaseProps {
  cableId: string
  initialValue: number | null
  initialMethod: string | null
  onClose: () => void
}

export function MeasuredLengthEditor({ cableId, initialValue, initialMethod, onClose }: BaseProps) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue == null ? '' : String(initialValue))
  const [method, setMethod] = useState((initialMethod as any) ?? 'CAD')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    const num = value.trim() === '' ? null : Number(value)
    if (num != null && (!Number.isFinite(num) || num < 0)) {
      setError('Length must be ≥ 0')
      return
    }
    startTransition(async () => {
      const res = await updateMeasuredLengthAction({
        cableId,
        measuredLengthM: num,
        method: num != null ? method : null,
      })
      if (res.error) { setError(res.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <Popover onClose={onClose} title="Edit measured length (Designer)">
      <Row>
        <Label>Length (m)</Label>
        <input className="ob-input" type="number" step="0.1" min="0" value={value}
          onChange={(e) => setValue(e.target.value)} autoFocus
          style={{ width: 120 }}
        />
      </Row>
      <Row>
        <Label>Method</Label>
        <select className="ob-input" value={method} onChange={(e) => setMethod(e.target.value as any)}
          style={{ width: 150 }}>
          <option value="CAD">CAD scaled</option>
          <option value="SCALE_RULE">Scale rule</option>
          <option value="MANUAL">Manual</option>
        </select>
      </Row>
      {error && <div role="alert" style={{ color: '#dc2626', fontSize: 11 }}>{error}</div>}
      <Actions>
        <CancelButton onClick={onClose} />
        <SaveButton onClick={save} pending={pending} />
      </Actions>
    </Popover>
  )
}

export function ConfirmedLengthEditor({
  cableId, initialValue, initialMethod, onClose, measuredM,
}: BaseProps & { measuredM: number | null }) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue == null ? '' : String(initialValue))
  const [method, setMethod] = useState((initialMethod as any) ?? 'PULL_TAPE')
  const [notes, setNotes] = useState('')
  const [signOff, setSignOff] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const num = value.trim() === '' ? null : Number(value)
  const delta = num != null && measuredM != null ? num - measuredM : null
  const deltaPct = delta != null && measuredM && measuredM > 0 ? (delta / measuredM) * 100 : null
  const flagDelta = delta != null && (Math.abs(delta) > 5 || (deltaPct != null && Math.abs(deltaPct) > 10))

  function save() {
    setError(null)
    if (num != null && (!Number.isFinite(num) || num < 0)) {
      setError('Length must be ≥ 0')
      return
    }
    startTransition(async () => {
      const res = await updateConfirmedLengthAction({
        cableId,
        confirmedLengthM: num,
        method: num != null ? method : null,
        notes: notes.trim() || null,
        signOff,
      })
      if (res.error) { setError(res.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <Popover onClose={onClose} title="Confirmed length (Site / Verifier)">
      <Row>
        <Label>Confirmed (m)</Label>
        <input className="ob-input" type="number" step="0.1" min="0" value={value}
          onChange={(e) => setValue(e.target.value)} autoFocus
          style={{ width: 120 }}
        />
      </Row>
      {measuredM != null && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)' }}>
          Measured: {measuredM.toFixed(1)} m
          {delta != null && (
            <span style={{ color: flagDelta ? '#dc2626' : 'var(--c-text-mid)', marginLeft: 8 }}>
              · Δ {delta > 0 ? '+' : ''}{delta.toFixed(1)} m
              {deltaPct != null && <> ({deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%)</>}
            </span>
          )}
        </div>
      )}
      <Row>
        <Label>Method</Label>
        <select className="ob-input" value={method} onChange={(e) => setMethod(e.target.value as any)}
          style={{ width: 150 }}>
          <option value="PULL_TAPE">Pull tape</option>
          <option value="LASER">Laser DM</option>
          <option value="DRUM_MARKING">Drum marking</option>
          <option value="REEL_LABEL">Reel label</option>
        </select>
      </Row>
      <Row>
        <Label>Notes</Label>
        <textarea className="ob-input" rows={2} value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ width: 230 }}
          maxLength={2000}
        />
      </Row>
      <Row>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--c-text)' }}>
          <input type="checkbox" checked={signOff} onChange={(e) => setSignOff(e.target.checked)} />
          Sign off (Verifier)
        </label>
      </Row>
      {flagDelta && signOff && (
        <div style={{ fontSize: 11, color: 'var(--c-amber)', padding: '4px 8px', background: 'var(--c-amber-dim)', borderRadius: 4 }}>
          ⚠ Δ over threshold — will set status DISCREPANCY
        </div>
      )}
      {error && <div role="alert" style={{ color: '#dc2626', fontSize: 11 }}>{error}</div>}
      <Actions>
        <CancelButton onClick={onClose} />
        <SaveButton onClick={save} pending={pending} />
      </Actions>
    </Popover>
  )
}

// ─── primitives ─────────────────────────────────────────────────────

function Popover({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        className="data-panel"
        style={{
          padding: 16, minWidth: 320, maxWidth: 420,
          display: 'flex', flexDirection: 'column', gap: 10,
          background: 'var(--c-panel)',
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--c-text)' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--c-text-dim)',
    }}>{children}</span>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>{children}</div>
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="btn-primary-amber"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
      Cancel
    </button>
  )
}

function SaveButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={pending} className="btn-primary-amber">
      {pending ? 'Saving…' : 'Save'}
    </button>
  )
}
