import { describe, expect, it } from 'vitest'
import { captureAccess, VERIFIER_READ_ONLY_MESSAGE } from '../capture-access'

const base = {
  userId: 'u-v',
  status: 'in_progress',
  verifierId: 'u-v',
  deliverableType: 'coc' as string | null,
  schemaJson: { sections: [] } as unknown,
}

describe('captureAccess', () => {
  it('locks the form for the assigned verifier of a CoC template (00248 refuses their writes)', () => {
    expect(captureAccess(base)).toEqual({ readOnly: true, verifierLocked: true, canSubmit: false })
  })

  it('locks the form for the verifier of a factory test', () => {
    expect(captureAccess({ ...base, deliverableType: 'factory_test' }).verifierLocked).toBe(true)
  })

  it('follows the template flag over the deliverable type, both ways', () => {
    expect(captureAccess({ ...base, deliverableType: 'coc', schemaJson: { requires_separate_verifier: false } }).verifierLocked).toBe(false)
    expect(captureAccess({ ...base, deliverableType: 'inspection_only', schemaJson: { requires_separate_verifier: true } }).verifierLocked).toBe(true)
  })

  it('reads the flag from a schema stored as a JSON string', () => {
    expect(captureAccess({ ...base, deliverableType: 'inspection_only', schemaJson: '{"requires_separate_verifier":true}' }).verifierLocked).toBe(true)
  })

  it('leaves the form open for the verifier when the template needs no separate verifier', () => {
    expect(captureAccess({ ...base, deliverableType: 'inspection_only' })).toEqual({ readOnly: false, verifierLocked: false, canSubmit: true })
  })

  it('leaves the form open for anyone who is not the verifier', () => {
    expect(captureAccess({ ...base, userId: 'u-other' })).toEqual({ readOnly: false, verifierLocked: false, canSubmit: true })
  })

  it('does not treat a signed-out user as the verifier of an inspection with no verifier', () => {
    expect(captureAccess({ ...base, userId: '', verifierId: null }).verifierLocked).toBe(false)
  })

  it('is read-only, without the verifier explanation, once the inspection can no longer be answered', () => {
    expect(captureAccess({ ...base, userId: 'u-other', status: 'awaiting_verification' })).toEqual({
      readOnly: true,
      verifierLocked: false,
      canSubmit: false,
    })
  })

  it('explains the lock in one sentence', () => {
    expect(VERIFIER_READ_ONLY_MESSAGE).toBe(
      'You are the verifier of this inspection, so you check it once it is submitted rather than fill it in.',
    )
  })
})
