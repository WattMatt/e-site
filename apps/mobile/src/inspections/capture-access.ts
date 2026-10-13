// apps/mobile/src/inspections/capture-access.ts
//
// What the signed-in user may do on the capture screen. Mirrors the database:
//   * answers are accepted only while the inspection is in an answerable status
//     (inspections.user_can_write_responses);
//   * on a template that needs a separate verifier, the assigned verifier may not
//     write answers, photos or files at all (00248). Their answers would be
//     captured offline and then refused by RLS, so the screen locks the form and
//     says why instead.

import { requiresSeparateVerifier } from '@esite/shared'

// Statuses in which a contributor may still answer.
export const ANSWERABLE_STATUSES = ['assigned', 'in_progress', 're-inspect_required']

export const VERIFIER_READ_ONLY_MESSAGE =
  'You are the verifier of this inspection, so you check it once it is submitted rather than fill it in.'

export interface CaptureAccessInput {
  userId: string
  status: string
  verifierId: string | null | undefined
  deliverableType: string | null | undefined
  // The template's schema_json, as an object or as the JSON string some reads return.
  schemaJson: unknown
}

export interface CaptureAccess {
  readOnly: boolean
  verifierLocked: boolean
  canSubmit: boolean
}

function separateVerifierFlag(schemaJson: unknown): unknown {
  let schema = schemaJson
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema)
    } catch {
      return undefined
    }
  }
  return schema && typeof schema === 'object'
    ? (schema as { requires_separate_verifier?: unknown }).requires_separate_verifier
    : undefined
}

export function captureAccess(i: CaptureAccessInput): CaptureAccess {
  const isVerifier = !!i.userId && i.verifierId === i.userId
  const verifierLocked =
    isVerifier && requiresSeparateVerifier(i.deliverableType, separateVerifierFlag(i.schemaJson))
  const answerable = ANSWERABLE_STATUSES.includes(i.status)
  return {
    readOnly: verifierLocked || !answerable,
    verifierLocked,
    canSubmit: answerable && !verifierLocked,
  }
}
