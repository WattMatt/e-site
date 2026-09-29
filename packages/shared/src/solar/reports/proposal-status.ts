/** Proposal status chip (functional spec §9.3) — server-set; `expired` is derived (00217 mirrors this). */
export type ProposalStatus = 'draft' | 'issued' | 'viewed' | 'accepted' | 'declined' | 'withdrawn'
export type EffectiveProposalStatus = ProposalStatus | 'expired'

export const PROPOSAL_STATUS_LABELS: Record<EffectiveProposalStatus, string> = {
  draft: 'Draft', issued: 'Issued', viewed: 'Viewed', accepted: 'Accepted',
  declined: 'Declined', expired: 'Expired', withdrawn: 'Withdrawn',
}

export function effectiveProposalStatus(status: ProposalStatus, expiresAt: string | null, now: number): EffectiveProposalStatus {
  if ((status === 'issued' || status === 'viewed') && expiresAt !== null && Date.parse(expiresAt) <= now) return 'expired'
  return status
}

export interface ProposalControlInput {
  status: ProposalStatus
  expiresAt: string | null
  /** This row is the highest version of its family. */
  isLatest: boolean
  familyHasDraft: boolean
  familyHasAccepted: boolean
}
/** Why a draft cannot be issued: another version of its family was accepted (00217 'family_accepted'). */
export const PROPOSAL_FAMILY_ACCEPTED =
  'Another version of this proposal was accepted — it cannot be issued. Start a new proposal instead.'

export interface ProposalControls {
  canEdit: boolean; canIssue: boolean
  /** The sentence shown on a disabled Issue control; null when issue is not blocked by the family. */
  issueBlockedReason: string | null
  canDelete: boolean
  canWithdraw: boolean; canRotate: boolean; canRevise: boolean
}

export function proposalControls(p: ProposalControlInput, now: number): ProposalControls {
  const eff = effectiveProposalStatus(p.status, p.expiresAt, now)
  const draft = p.status === 'draft'
  return {
    canEdit: draft, canIssue: draft && !p.familyHasAccepted,
    issueBlockedReason: draft && p.familyHasAccepted ? PROPOSAL_FAMILY_ACCEPTED : null,
    canDelete: draft,
    canWithdraw: p.status === 'issued' || p.status === 'viewed',
    canRotate: eff === 'issued' || eff === 'viewed',
    canRevise: !draft && p.status !== 'accepted' && p.isLatest && !p.familyHasDraft && !p.familyHasAccepted,
  }
}
