import { describe, it, expect } from 'vitest'
import { statusMessage, type StatusBannerProps } from './StatusBanner'

const base: StatusBannerProps = {
  status: 'awaiting_verification',
  assigneeName: 'Ronli',
  verifierName: 'Ernst',
  isVerifier: false,
  canReassign: false,
  separateVerifier: false,
  verifierHasAnswered: false,
  completedAt: '2026-10-12T11:04:03Z',
  certifiedAt: null,
  cocNumber: null,
  reinspectionNotes: null,
  abandonedReason: null,
}

describe('statusMessage', () => {
  it('names who an awaiting inspection is waiting on', () => {
    expect(statusMessage(base).text).toBe('Submitted 12 Oct 2026. Waiting on Ernst to verify: only they can certify it or send it back.')
  })

  it('tells the verifier it is waiting on them and where to act', () => {
    expect(statusMessage({ ...base, isVerifier: true }).text).toMatch(/^This inspection is waiting on you .*Certify \/ Send back/)
  })

  it('warns when a separate-verifier inspection can never be certified by its verifier (Shoprite)', () => {
    const m = statusMessage({ ...base, isVerifier: true, separateVerifier: true, verifierHasAnswered: true })
    expect(m.tone).toBe('warn')
    expect(m.text).toBe(
      'You entered answers on this inspection, so you cannot certify it: this template needs a separate verifier. A project manager must choose a different verifier.',
    )
  })

  it('warns before submit too (Boxer), and points a PM at the fix', () => {
    const m = statusMessage({ ...base, status: 'in_progress', separateVerifier: true, verifierHasAnswered: true, canReassign: true })
    expect(m.text).toMatch(/^Ernst has entered answers .* Choose a different verifier above\.$/)
  })

  it('does not warn on a template that allows self-verification', () => {
    expect(statusMessage({ ...base, status: 'in_progress', verifierHasAnswered: true }).text).toBe(
      'Ronli is the inspector. When it is complete, Submit sends it to Ernst to verify.',
    )
  })

  it('carries the verifier notes on a sent-back inspection', () => {
    expect(statusMessage({ ...base, status: 're-inspect_required', reinspectionNotes: 'Relabel the CT' }).text).toBe(
      'Sent back by Ernst: “Relabel the CT”. Ronli should fix this and submit again.',
    )
  })
})
