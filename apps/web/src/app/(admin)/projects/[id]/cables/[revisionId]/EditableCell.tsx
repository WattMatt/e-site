'use client'

import { useEffect, useRef, useState } from 'react'

type CellType = 'number' | 'text' | 'select'

interface BaseProps {
  /** Current committed value (string|number|null). */
  value: string | number | null
  type: CellType
  /** Fires on commit. Resolves to { error } on failure → cell reverts + shows error. */
  onSave: (next: string | number | null) => Promise<{ error?: string }>
  /** Options for type='select' — value/label pairs. */
  options?: Array<{ value: string; label: string }>
  /** Display formatter for the idle state (e.g. fixed decimals). */
  format?: (v: string | number | null) => string
  align?: 'left' | 'right' | 'center'
  /** Read-only (e.g. revision ISSUED, or role lacks editDesignFields). */
  disabled?: boolean
  /** Optional placeholder shown when value is null in idle state. */
  placeholder?: string
}

type State = 'idle' | 'editing' | 'saving' | 'saved' | 'error'

export function EditableCell({
  value, type, onSave, options, format, align = 'left', disabled, placeholder,
}: BaseProps) {
  const [state, setState] = useState<State>('idle')
  const [draft, setDraft] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  // Reset draft whenever we enter editing (or the upstream value changed).
  useEffect(() => {
    if (state === 'editing') {
      setDraft(value == null ? '' : String(value))
      inputRef.current?.focus()
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select()
    }
  }, [state, value])

  // Briefly show the ✓ then return to idle.
  useEffect(() => {
    if (state !== 'saved') return
    const t = setTimeout(() => setState('idle'), 900)
    return () => clearTimeout(t)
  }, [state])

  const display = format ? format(value) : value == null ? (placeholder ?? '—') : String(value)

  if (disabled) {
    return <span style={{ color: 'var(--c-text)' }}>{display}</span>
  }

  function commit() {
    const raw = draft.trim()
    let nextValue: string | number | null
    if (type === 'number') {
      nextValue = raw === '' ? null : Number(raw)
      if (nextValue != null && !Number.isFinite(nextValue)) {
        setError('Not a number'); setState('error'); return
      }
    } else {
      nextValue = raw === '' ? null : raw
    }
    // No-op if unchanged.
    if (String(nextValue ?? '') === String(value ?? '')) { setState('idle'); return }
    setState('saving')
    onSave(nextValue).then((res) => {
      if (res.error) { setError(res.error); setState('error'); return }
      setError(null); setState('saved')
    })
  }

  if (state === 'editing' || state === 'saving') {
    const common = {
      ref: inputRef as never,
      value: draft,
      disabled: state === 'saving',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); setState('idle') }
      },
      className: 'ob-input',
      style: { width: '100%', font: 'inherit', padding: '1px 4px' },
    }
    return type === 'select'
      ? (
        <select {...common}>
          <option value="">—</option>
          {(options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
      : <input {...common} type={type === 'number' ? 'number' : 'text'} step="any" />
  }

  return (
    <button
      type="button"
      onClick={() => setState('editing')}
      title={error ?? 'Click to edit'}
      style={{
        background: 'none',
        border: '1px dashed transparent',
        borderRadius: 3,
        color: state === 'error' ? '#dc2626' : 'inherit',
        font: 'inherit',
        width: '100%',
        textAlign: align,
        padding: '0 4px',
        margin: '-1px 0',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--c-border)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent' }}
    >
      {display}
      {state === 'saved' && <span style={{ color: '#16a34a', marginLeft: 4 }}>✓</span>}
      {state === 'error' && <span style={{ color: '#dc2626', marginLeft: 4 }}>↩</span>}
    </button>
  )
}
