// apps/mobile/src/inspections/capture-access.ts
//
// Whether the signed-in user may fill in (and submit) an inspection on this
// device. Mirrors the web capture page and the database:
//
//   * answers are accepted only while the inspection is assigned, in progress
//     or sent back for re-inspection (inspections.user_can_write_responses);
//   * on a template that needs a separate verifier (CoC and factory tests by
//     default, or the template's own `requires_separate_verifier` flag), the
//     assigned verifier checks the work and must not fill it in. Migration
//     00250 makes user_can_write_responses refuse them, so the form must not
//     offer them inputs that the server will reject after the fact. Web:
//     apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx
//     passes readOnly={isVerifier && separateVerifier} to CaptureForm.
//
// Read-only keeps the same layout: fields stay on screen, disabled, and empty
// photo / signature / file slots say so instead of disappearing.

import { requiresSeparateVerifier } from '@esite/shared'

// Statuses in which a contributor may still answer (mirrors
// inspections.user_can_write_responses).
export const ANSWERABLE_STATUSES = ['assigned', 'in_progress', 're-inspect_required'] as const

export const SEPARATE_VERIFIER_NOTICE =
  'You are the verifier, so you check it once submitted rather than fill it in.'

export interface CaptureAccessInput {
  status: string
  verifierId: string | null | undefined
  userId: string | null | undefined
  deliverableType: string | null | undefined
  /** The template's `schema_json.requires_separate_verifier`, when present. */
  requiresSeparateVerifierFlag?: unknown
}

export interface CaptureAccess {
  /** Fields are shown disabled; nothing is written. */
  readOnly: boolean
  /** The Submit control is offered. */
  canSubmit: boolean
  /** True when the lock is because the user is this inspection's separate verifier. */
  separateVerifierLock: boolean
  /** One sentence explaining a read-only form, or null when the form is editable. */
  notice: string | null
}

export function captureAccess(input: CaptureAccessInput): CaptureAccess {
  const answerable = (ANSWERABLE_STATUSES as readonly string[]).includes(input.status)
  const separateVerifier = requiresSeparateVerifier(
    input.deliverableType,
    input.requiresSeparateVerifierFlag,
  )
  const isVerifier = !!input.userId && !!input.verifierId && input.verifierId === input.userId
  const separateVerifierLock = isVerifier && separateVerifier

  let notice: string | null = null
  if (!answerable) {
    notice = `This inspection is ${input.status.replace(/_/g, ' ')}; answers can no longer be changed.`
  } else if (separateVerifierLock) {
    notice = SEPARATE_VERIFIER_NOTICE
  }

  return {
    readOnly: !answerable || separateVerifierLock,
    canSubmit: answerable && !separateVerifierLock,
    separateVerifierLock,
    notice,
  }
}

// What a photo slot says on a read-only form. Mobile shows only this device's
// thumbnails, so a photo already saved (or queued) is reported by count rather
// than claiming the slot is empty. Web's wording for an empty slot is "No photo
// yet" (photo field) and "No photo" (the strip under an answer).
export function savedPhotosLabel(count: number, emptyText: string): string {
  if (count <= 0) return emptyText
  return count === 1 ? '1 photo saved' : `${count} photos saved`
}
