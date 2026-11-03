import { describe, expect, it } from 'vitest'
import { captureAccess, savedPhotosLabel, SEPARATE_VERIFIER_NOTICE } from '../capture-access'

const base = {
  status: 'in_progress',
  verifierId: 'verifier-1',
  userId: 'worker-1',
  deliverableType: 'coc',
}

describe('captureAccess', () => {
  it('the assigned verifier of a CoC inspection gets a read-only form with no Submit (00250)', () => {
    const a = captureAccess({ ...base, userId: 'verifier-1' })
    expect(a).toEqual({
      readOnly: true,
      canSubmit: false,
      separateVerifierLock: true,
      notice: SEPARATE_VERIFIER_NOTICE,
    })
  })

  it('locks the verifier of a factory test too (default separate-verifier deliverable)', () => {
    expect(captureAccess({ ...base, userId: 'verifier-1', deliverableType: 'factory_test' }).readOnly).toBe(true)
  })

  it('the template flag overrides the deliverable type, both ways', () => {
    expect(
      captureAccess({ ...base, userId: 'verifier-1', deliverableType: 'checklist', requiresSeparateVerifierFlag: true })
        .separateVerifierLock,
    ).toBe(true)
    expect(
      captureAccess({ ...base, userId: 'verifier-1', deliverableType: 'coc', requiresSeparateVerifierFlag: false })
        .readOnly,
    ).toBe(false)
  })

  it('a contributor who is not the verifier may fill in and submit', () => {
    expect(captureAccess(base)).toEqual({ readOnly: false, canSubmit: true, separateVerifierLock: false, notice: null })
  })

  it('the verifier of a template that does not need a separate verifier may fill it in', () => {
    const a = captureAccess({ ...base, userId: 'verifier-1', deliverableType: 'checklist' })
    expect(a.readOnly).toBe(false)
    expect(a.canSubmit).toBe(true)
  })

  it('no verifier assigned, or no signed-in user, never matches as the verifier', () => {
    expect(captureAccess({ ...base, verifierId: null, userId: null }).separateVerifierLock).toBe(false)
    expect(captureAccess({ ...base, verifierId: null }).separateVerifierLock).toBe(false)
    expect(captureAccess({ ...base, userId: '' , verifierId: '' }).separateVerifierLock).toBe(false)
  })

  it('a status that no longer takes answers is read-only for everyone, with the status sentence', () => {
    for (const status of ['awaiting_verification', 'certified', 'abandoned']) {
      const a = captureAccess({ ...base, status })
      expect(a.readOnly).toBe(true)
      expect(a.canSubmit).toBe(false)
      expect(a.notice).toBe(`This inspection is ${status.replace(/_/g, ' ')}; answers can no longer be changed.`)
    }
  })

  it('assigned and re-inspect_required still take answers', () => {
    expect(captureAccess({ ...base, status: 'assigned' }).readOnly).toBe(false)
    expect(captureAccess({ ...base, status: 're-inspect_required' }).readOnly).toBe(false)
  })
})

describe('savedPhotosLabel', () => {
  it('an empty slot keeps the web wording; a taken photo is reported, not hidden', () => {
    expect(savedPhotosLabel(0, 'No photo yet')).toBe('No photo yet')
    expect(savedPhotosLabel(0, 'No photo')).toBe('No photo')
    expect(savedPhotosLabel(1, 'No photo')).toBe('1 photo saved')
    expect(savedPhotosLabel(3, 'No photo yet')).toBe('3 photos saved')
  })
})
