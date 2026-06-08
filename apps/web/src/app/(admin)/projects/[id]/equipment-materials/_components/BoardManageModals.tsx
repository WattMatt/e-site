'use client'

/**
 * BoardManageModals — inline equipment-board management for the unified
 * Equipment & Materials tab.
 *
 * Three modal components, adapted from the Equipment Schedule's EquipmentTable
 * (AddEquipmentModal / EditForm / DecommissionModal), wired to the same
 * equipment.actions server actions. On success each calls router.refresh() so
 * the server-rendered board list re-fetches.
 *
 *   AddBoardModal         → createEquipmentNodeAction       (wraps EquipmentForm)
 *   EditBoardModal        → editEquipmentNodeAction         (prefilled from a board)
 *   DecommissionBoardModal→ decommissionEquipmentNodeAction
 *
 * Reactivate is a one-shot action (no form) and lives inline in BoardRow.
 *
 * All hooks are unconditional / above any early return (React #310 history).
 */

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput, Select } from '@/components/ui/FormField'
import { EquipmentForm, KIND_LABEL } from '@/app/(admin)/projects/[id]/equipment-schedule/_components/EquipmentForm'
import type { EquipmentFormValues } from '@/app/(admin)/projects/[id]/equipment-schedule/_components/EquipmentForm'
import { EQUIPMENT_KINDS } from '@esite/shared'
import type { EquipmentKind } from '@esite/shared'
import {
  createEquipmentNodeAction,
  editEquipmentNodeAction,
  decommissionEquipmentNodeAction,
} from '@/actions/equipment.actions'
import type { UnifiedBoard } from '../_lib/gather-unified-boards'

// ---------------------------------------------------------------------------
// Shared dialog shell — fixed overlay + centred card (mirrors EquipmentTable)
// ---------------------------------------------------------------------------

function ModalShell({
  ariaLabel,
  maxWidth,
  onBackdrop,
  children,
}: {
  ariaLabel: string
  maxWidth: number
  onBackdrop: () => void
  children: React.ReactNode
}) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onBackdrop() }}
    >
      <div style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 24,
        width: '100%',
        maxWidth,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// AddBoardModal — wraps EquipmentForm → createEquipmentNodeAction
// ---------------------------------------------------------------------------

export function AddBoardModal({
  projectId,
  existingCodes,
  existingCustomTypes,
  onClose,
}: {
  projectId: string
  existingCodes: string[]
  existingCustomTypes: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(values: EquipmentFormValues) {
    setError(null)
    return new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        const result = await createEquipmentNodeAction(
          projectId,
          values.kind,
          values.code,
          values.name,
          values.coc_required,
          values.customKindLabel,
        )
        if ('error' in result) {
          reject(new Error(result.error))
        } else {
          onClose()
          router.refresh()
          resolve()
        }
      })
    })
  }

  return (
    <ModalShell ariaLabel="Add board" maxWidth={460} onBackdrop={() => { if (!isPending) onClose() }}>
      <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>
        Add board
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
        Pick the equipment type — a type with no items yet starts its own group.
      </p>
      <EquipmentForm
        existingCodes={existingCodes}
        existingCustomTypes={existingCustomTypes}
        onSubmit={handleSubmit}
        onCancel={onClose}
        isLoading={isPending}
      />
      {error && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
          {error}
        </div>
      )}
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// EditBoardModal — prefilled from a board → editEquipmentNodeAction
// ---------------------------------------------------------------------------

/** A board's kind is a string; equipment boards are never tenant_db but a
 *  catch-all kind (e.g. sub_board) is not in EQUIPMENT_KINDS. Coerce to a valid
 *  editable kind so the Select always has a matching option. */
function toEquipmentKind(kind: string): EquipmentKind {
  return (EQUIPMENT_KINDS as readonly string[]).includes(kind)
    ? (kind as EquipmentKind)
    : EQUIPMENT_KINDS[0]
}

export function EditBoardModal({
  board,
  projectId,
  existingCodes,
  onClose,
}: {
  board: UnifiedBoard
  projectId: string
  /** All node codes EXCEPT this board's own, for the uniqueness check. */
  existingCodes: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [kind, setKind] = useState<EquipmentKind>(toEquipmentKind(board.kind))
  const [customKindLabel, setCustomKindLabel] = useState(board.customKindLabel ?? '')
  const [code, setCode] = useState(board.code)
  const [name, setName] = useState(board.name ?? '')
  const [cocRequired, setCocRequired] = useState(board.cocRequired)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (kind === 'custom' && !customKindLabel.trim()) { setError('Custom type is required.'); return }
    if (!code.trim()) { setError('Code is required.'); return }
    // existingCodes is the caller's responsibility (already excludes this board);
    // the action also enforces uniqueness server-side.
    if (existingCodes.includes(code.trim())) { setError(`Code "${code.trim()}" is already in use on this project.`); return }

    startTransition(async () => {
      const result = await editEquipmentNodeAction(
        projectId, board.nodeId, kind, code.trim(), name.trim(), cocRequired, customKindLabel.trim(),
      )
      if ('error' in result) { setError(result.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <ModalShell ariaLabel="Edit board" maxWidth={460} onBackdrop={() => { if (!isPending) onClose() }}>
      <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>
        Edit {board.code}
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
        Update the board’s type, code, name and COC requirement.
      </p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 14 }}>
          <FormField label="Type" htmlFor={`edit-kind-${board.nodeId}`}>
            <Select
              id={`edit-kind-${board.nodeId}`}
              value={kind}
              onChange={(e) => { setKind(e.target.value as EquipmentKind); setError(null) }}
              disabled={isPending}
            >
              {EQUIPMENT_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
          </FormField>
        </div>
        {kind === 'custom' && (
          <div style={{ marginBottom: 14 }}>
            <FormField label="Custom Type" htmlFor={`edit-custom-${board.nodeId}`} required>
              <TextInput
                id={`edit-custom-${board.nodeId}`}
                value={customKindLabel}
                onChange={(e) => { setCustomKindLabel(e.target.value); setError(null) }}
                placeholder="e.g. UPS"
                maxLength={60}
                disabled={isPending}
              />
            </FormField>
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <FormField label="Code" htmlFor={`edit-code-${board.nodeId}`} required hint="Must be unique per project">
            <TextInput
              id={`edit-code-${board.nodeId}`}
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(null) }}
              maxLength={50}
              disabled={isPending}
              autoCapitalize="characters"
              spellCheck={false}
            />
          </FormField>
        </div>
        <div style={{ marginBottom: 14 }}>
          <FormField label="Name (optional)" htmlFor={`edit-name-${board.nodeId}`}>
            <TextInput
              id={`edit-name-${board.nodeId}`}
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              maxLength={120}
              disabled={isPending}
            />
          </FormField>
        </div>
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id={`edit-coc-${board.nodeId}`}
            type="checkbox"
            checked={cocRequired}
            onChange={(e) => setCocRequired(e.target.checked)}
            disabled={isPending}
            style={{ width: 15, height: 15, accentColor: 'var(--c-amber)', cursor: isPending ? 'not-allowed' : 'pointer' }}
          />
          <label htmlFor={`edit-coc-${board.nodeId}`} style={{ fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)', cursor: isPending ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
            COC required
          </label>
        </div>
        {error && (
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" isLoading={isPending} disabled={isPending}>
            Save
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// DecommissionBoardModal → decommissionEquipmentNodeAction
// ---------------------------------------------------------------------------

export function DecommissionBoardModal({
  board,
  projectId,
  onClose,
}: {
  board: UnifiedBoard
  projectId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await decommissionEquipmentNodeAction(projectId, board.nodeId, reason.trim() || undefined)
      if ('error' in result) { setError(result.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <ModalShell ariaLabel="Decommission board" maxWidth={420} onBackdrop={() => { if (!isPending) onClose() }}>
      <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>
        Decommission {board.code}
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)' }}>
        The board will be marked decommissioned and hidden from active views. It is never deleted.
      </p>
      <form onSubmit={handleSubmit}>
        <FormField label="Reason (optional)" htmlFor={`decommission-reason-${board.nodeId}`}>
          <TextInput
            id={`decommission-reason-${board.nodeId}`}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null) }}
            placeholder="e.g. Replaced by new switchgear"
            maxLength={500}
            disabled={isPending}
          />
        </FormField>
        {error && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }} role="alert">
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" size="sm" isLoading={isPending} disabled={isPending}>
            Decommission
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}
