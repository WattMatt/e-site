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
import { FormField, TextInput, Select } from '@/components/ui/FormField'
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
        <FormField label="Equipment Type" htmlFor="eq-kind">
          <Select
            id="eq-kind"
            value={kind}
            onChange={handleKindChange}
            disabled={busy}
          >
            {EQUIPMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {/* Code */}
      <div style={FIELD_GAP}>
        <FormField label="Code" htmlFor="eq-code" required hint="Must be unique per project">
          <TextInput
            id="eq-code"
            type="text"
            value={code}
            onChange={handleCodeChange}
            placeholder="e.g. RMU-1"
            maxLength={50}
            disabled={busy}
            autoCapitalize="characters"
            spellCheck={false}
          />
        </FormField>
      </div>

      {/* Name */}
      <div style={FIELD_GAP}>
        <FormField label="Name (optional)" htmlFor="eq-name">
          <TextInput
            id="eq-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            placeholder="e.g. Main Substation"
            maxLength={120}
            disabled={busy}
          />
        </FormField>
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
        <Button type="submit" variant="primary" size="sm" isLoading={busy} disabled={busy}>
          Add equipment
        </Button>
      </div>
    </form>
  )
}
