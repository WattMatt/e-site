'use client'

/**
 * EquipmentForm — shared "new equipment" form.
 *
 * Reused by both:
 *   - Task 3.2: Equipment Schedule page (full-page create flow)
 *   - Task 3.3: Inline create from the Cable Schedule grid
 *
 * This component is deliberately free of page-specific routing or server
 * actions. Callers supply:
 *   - existingCodes: all codes already used on the project (for the suggester)
 *   - defaultKind:   optional pre-selection (e.g. cable schedule supplies 'rmu')
 *   - onSubmit:      async callback receiving the validated form values
 *   - onCancel:      optional cancel handler (renders Cancel button when provided)
 *   - isLoading:     optional external pending state (e.g. during server action)
 *
 * The component handles its own local pending state via useTransition and
 * defers to the caller's isLoading prop when both are present.
 */

import { useState, useTransition, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import {
  suggestEquipmentCode,
  EQUIPMENT_KINDS,
  type EquipmentKind,
} from '@esite/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EquipmentFormValues {
  kind: EquipmentKind
  code: string
  name: string
  coc_required: boolean
}

interface Props {
  /** All codes currently in use on the project (across all kinds). */
  existingCodes: string[]
  /** Pre-select a kind — e.g. when launching from the Cable Schedule. */
  defaultKind?: EquipmentKind
  /** Called with validated values when the user submits. Should throw on error. */
  onSubmit: (values: EquipmentFormValues) => Promise<void>
  /** If provided, a Cancel button is rendered that calls this. */
  onCancel?: () => void
  /** External loading flag — disables the form while a server action is in-flight. */
  isLoading?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<EquipmentKind, string> = {
  main_board: 'Main Board',
  common_area_board: 'Common Area Board',
  rmu: 'Ring Main Unit (RMU)',
  mini_sub: 'Mini-Substation',
  generator: 'Generator',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--c-text-dim)',
  marginBottom: 4,
}

const INPUT_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  background: 'var(--c-bg)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  fontSize: 13,
  color: 'var(--c-text)',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
  boxSizing: 'border-box',
}

const FIELD_GAP: React.CSSProperties = { marginBottom: 14 }

// ---------------------------------------------------------------------------
// EquipmentForm
// ---------------------------------------------------------------------------

export function EquipmentForm({
  existingCodes,
  defaultKind,
  onSubmit,
  onCancel,
  isLoading: externalLoading,
}: Props) {
  const firstKind: EquipmentKind = defaultKind ?? EQUIPMENT_KINDS[0]

  const [kind, setKind] = useState<EquipmentKind>(firstKind)
  const [code, setCode] = useState(() => suggestEquipmentCode(firstKind, existingCodes))
  const [name, setName] = useState('')
  const [cocRequired, setCocRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const busy = isPending || (externalLoading ?? false)

  // Re-suggest code whenever kind changes (only if the user hasn't edited it).
  // We track whether the code field is "suggestion-driven" by comparing it
  // to what the suggester would have produced for the previous kind.
  const [codeTouched, setCodeTouched] = useState(false)

  useEffect(() => {
    if (!codeTouched) {
      setCode(suggestEquipmentCode(kind, existingCodes))
    }
  }, [kind, existingCodes, codeTouched])

  function handleKindChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setKind(e.target.value as EquipmentKind)
    // Reset touched flag so the next kind-change re-suggests.
    setCodeTouched(false)
    setError(null)
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCode(e.target.value)
    setCodeTouched(true)
    setError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedCode = code.trim()
    const trimmedName = name.trim()

    if (!trimmedCode) {
      setError('Code is required.')
      return
    }

    startTransition(async () => {
      try {
        await onSubmit({
          kind,
          code: trimmedCode,
          name: trimmedName,
          coc_required: cocRequired,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Kind */}
      <div style={FIELD_GAP}>
        <label style={LABEL_STYLE}>Equipment Type</label>
        <select
          value={kind}
          onChange={handleKindChange}
          disabled={busy}
          style={{ ...INPUT_STYLE, cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          {EQUIPMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {/* Code */}
      <div style={FIELD_GAP}>
        <label style={LABEL_STYLE}>Code</label>
        <input
          type="text"
          value={code}
          onChange={handleCodeChange}
          placeholder="e.g. RMU-1"
          maxLength={50}
          disabled={busy}
          style={INPUT_STYLE}
          autoCapitalize="characters"
          spellCheck={false}
        />
        <div
          style={{
            fontSize: 11,
            color: 'var(--c-text-dim)',
            fontFamily: 'var(--font-mono)',
            marginTop: 3,
          }}
        >
          Must be unique per project
        </div>
      </div>

      {/* Name */}
      <div style={FIELD_GAP}>
        <label style={LABEL_STYLE}>Name (optional)</label>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null) }}
          placeholder="e.g. Main Substation"
          maxLength={120}
          disabled={busy}
          style={INPUT_STYLE}
        />
      </div>

      {/* COC Required */}
      <div style={{ ...FIELD_GAP, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="coc_required"
          type="checkbox"
          checked={cocRequired}
          onChange={(e) => setCocRequired(e.target.checked)}
          disabled={busy}
          style={{ width: 15, height: 15, cursor: busy ? 'not-allowed' : 'pointer', accentColor: 'var(--c-amber)' }}
        />
        <label
          htmlFor="coc_required"
          style={{
            fontSize: 13,
            color: 'var(--c-text-mid)',
            fontFamily: 'var(--font-sans)',
            cursor: busy ? 'not-allowed' : 'pointer',
            userSelect: 'none',
          }}
        >
          COC required
        </label>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '7px 10px',
            marginBottom: 12,
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 5,
            fontSize: 12,
            color: 'var(--c-red)',
            fontFamily: 'var(--font-sans)',
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" isLoading={isPending} disabled={busy}>
          Add equipment
        </Button>
      </div>
    </form>
  )
}
