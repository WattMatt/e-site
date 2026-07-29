'use client'

import { useId, useState } from 'react'
import {
  QC_CONFORMANCE,
  QC_SEVERITY,
  QC_CONFORMANCE_LABELS,
  QC_SEVERITY_LABELS,
  type QcConformance,
  type QcSeverity,
} from '@esite/shared'

// Controlled conformance/severity inputs shared by the add-entry and
// edit-entry forms so both derive their value domains + labels from
// QC_CONFORMANCE / QC_SEVERITY (single source of truth, migration 00176).

// Visually-hidden but focusable: the native radios drive selection + keyboard,
// while the labels render the segmented control. A React-tracked focus ring
// keeps keyboard focus visible (inline styles can't express :focus-visible).
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const ACTIVE_BG: Record<QcConformance, string> = {
  pass: 'var(--c-green)',
  fail: 'var(--c-red)',
  na: 'var(--c-text-dim)',
}

interface ConformanceRadioGroupProps {
  value: QcConformance | null
  onChange: (v: QcConformance) => void
  /** Stable radio-group name + id prefix (defaults to a useId). */
  name?: string
  disabled?: boolean
}

/**
 * Pass / Fail / N-A segmented control backed by real radio inputs (each with a
 * htmlFor/id label) inside a fieldset+legend + role="radiogroup" — required,
 * keyboard-navigable, and announced. `value` starts null on the add form so the
 * user must make an explicit choice (the DB default 'na' only keeps legacy rows
 * valid).
 */
export function ConformanceRadioGroup({ value, onChange, name, disabled }: ConformanceRadioGroupProps) {
  const autoName = useId()
  const groupName = name ?? autoName
  const [focused, setFocused] = useState<QcConformance | null>(null)

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="ob-label" style={{ padding: 0, float: 'none' }}>
        Conformance *
      </legend>
      <div
        role="radiogroup"
        aria-label="Conformance"
        style={{
          display: 'inline-flex',
          marginTop: 6,
          border: '1px solid var(--c-border)',
          borderRadius: 8,
          overflow: 'hidden',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {QC_CONFORMANCE.map((v, i) => {
          const id = `${groupName}-${v}`
          const active = value === v
          const isFocused = focused === v
          return (
            <span key={v} style={{ display: 'inline-flex' }}>
              <input
                type="radio"
                id={id}
                name={groupName}
                value={v}
                checked={active}
                disabled={disabled}
                onChange={() => onChange(v)}
                onFocus={() => setFocused(v)}
                onBlur={() => setFocused(null)}
                style={VISUALLY_HIDDEN}
              />
              <label
                htmlFor={id}
                style={{
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  padding: '7px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  userSelect: 'none',
                  borderLeft: i === 0 ? 'none' : '1px solid var(--c-border)',
                  background: active ? ACTIVE_BG[v] : 'var(--c-panel)',
                  color: active ? '#fff' : 'var(--c-text-mid)',
                  outline: isFocused ? '2px solid var(--c-amber)' : 'none',
                  outlineOffset: -2,
                }}
              >
                {QC_CONFORMANCE_LABELS[v]}
              </label>
            </span>
          )
        })}
      </div>
    </fieldset>
  )
}

interface SeveritySelectProps {
  value: QcSeverity | ''
  onChange: (v: QcSeverity | '') => void
  id: string
  disabled?: boolean
}

/**
 * Native severity <select>, rendered by the parent only when conformance is
 * 'fail'. Required in that case (the shared superRefine enforces severity ⇔
 * fail server-side; the empty placeholder lets the client catch it first).
 */
export function SeveritySelect({ value, onChange, id, disabled }: SeveritySelectProps) {
  return (
    <div>
      <label className="ob-label" htmlFor={id}>
        Severity *
      </label>
      <select
        id={id}
        className="ob-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as QcSeverity | '')}
        style={{ marginTop: 4 }}
      >
        <option value="">Select severity…</option>
        {QC_SEVERITY.map((s) => (
          <option key={s} value={s}>
            {QC_SEVERITY_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  )
}
