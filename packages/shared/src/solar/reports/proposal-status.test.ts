import { describe, it, expect } from 'vitest'
import { effectiveProposalStatus, proposalControls, PROPOSAL_STATUS_LABELS, PROPOSAL_FAMILY_ACCEPTED } from './proposal-status'

const NOW = Date.parse('2026-09-29T12:00:00Z')

describe('effectiveProposalStatus (mirrors solar.proposal_effective_status)', () => {
  it('derives expired only for a live proposal past its expiry', () => {
    expect(effectiveProposalStatus('issued', '2026-09-29T11:59:59Z', NOW)).toBe('expired')
    expect(effectiveProposalStatus('viewed', '2026-09-29T12:00:00Z', NOW)).toBe('expired')
    expect(effectiveProposalStatus('viewed', '2026-10-01T00:00:00Z', NOW)).toBe('viewed')
    expect(effectiveProposalStatus('accepted', '2026-01-01T00:00:00Z', NOW)).toBe('accepted')
    expect(effectiveProposalStatus('draft', null, NOW)).toBe('draft')
  })
  it('has a label for every status', () => {
    expect(Object.keys(PROPOSAL_STATUS_LABELS).sort()).toEqual(['accepted', 'declined', 'draft', 'expired', 'issued', 'viewed', 'withdrawn'])
  })
})

describe('proposalControls', () => {
  const base = { status: 'issued' as const, expiresAt: '2026-10-29T00:00:00Z', isLatest: true, familyHasDraft: false, familyHasAccepted: false }
  it('draft: edit, preview, issue, delete', () => {
    expect(proposalControls({ ...base, status: 'draft', expiresAt: null }, NOW)).toEqual({ canEdit: true, canIssue: true, issueBlockedReason: null, canDelete: true, canWithdraw: false, canRotate: false, canRevise: false })
  })
  it('issued: withdraw, new link, revise', () => {
    expect(proposalControls(base, NOW)).toEqual({ canEdit: false, canIssue: false, issueBlockedReason: null, canDelete: false, canWithdraw: true, canRotate: true, canRevise: true })
  })
  it('expired: withdraw and revise, but no new link', () => {
    expect(proposalControls({ ...base, expiresAt: '2026-09-01T00:00:00Z' }, NOW)).toMatchObject({ canWithdraw: true, canRotate: false, canRevise: true })
  })
  it('no revise when a draft exists, an accepted version exists, or this is not the latest version', () => {
    expect(proposalControls({ ...base, familyHasDraft: true }, NOW).canRevise).toBe(false)
    expect(proposalControls({ ...base, familyHasAccepted: true }, NOW).canRevise).toBe(false)
    expect(proposalControls({ ...base, isLatest: false }, NOW).canRevise).toBe(false)
  })
  it('a draft cannot be issued once another version of its family was accepted (00217 family_accepted)', () => {
    const c = proposalControls({ ...base, status: 'draft', expiresAt: null, familyHasAccepted: true }, NOW)
    expect(c.canIssue).toBe(false)
    expect(c.issueBlockedReason).toBe(PROPOSAL_FAMILY_ACCEPTED)
    expect(c.canEdit).toBe(true)
    expect(c.canDelete).toBe(true)
  })
  it('accepted / declined / withdrawn: read only (revise allowed after decline or withdraw)', () => {
    expect(proposalControls({ ...base, status: 'accepted', familyHasAccepted: true }, NOW)).toEqual({ canEdit: false, canIssue: false, issueBlockedReason: null, canDelete: false, canWithdraw: false, canRotate: false, canRevise: false })
    expect(proposalControls({ ...base, status: 'declined' }, NOW).canRevise).toBe(true)
    expect(proposalControls({ ...base, status: 'withdrawn' }, NOW).canWithdraw).toBe(false)
  })
})
