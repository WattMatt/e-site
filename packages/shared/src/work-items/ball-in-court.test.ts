import { describe, it, expect } from 'vitest'
import {
  ballInCourt, refPrefix, stateLabel,
  WORK_ITEM_STATUSES, WORK_ITEM_TYPE_KEYS, REF_PREFIXES, STATE_LABELS,
} from './types'

const ASSIGNEE = '11111111-1111-1111-1111-111111111111'
const GATEKEEPER = '22222222-2222-2222-2222-222222222222'

describe('ballInCourt — the TypeScript mirror of work_items.ball_in_court_id', () => {
  it('points at the assignee while triage or open', () => {
    expect(ballInCourt('triage', ASSIGNEE, GATEKEEPER)).toBe(ASSIGNEE)
    expect(ballInCourt('open', ASSIGNEE, GATEKEEPER)).toBe(ASSIGNEE)
  })

  it('points at the gatekeeper once answered', () => {
    expect(ballInCourt('answered', ASSIGNEE, GATEKEEPER)).toBe(GATEKEEPER)
  })

  it('is null exactly for closed and void, and for nothing else', () => {
    const nulls = WORK_ITEM_STATUSES.filter(
      (s) => ballInCourt(s, ASSIGNEE, GATEKEEPER) === null,
    )
    expect(nulls).toEqual(['closed', 'void'])
  })

  it('covers every status in the vocabulary — no unmapped arm', () => {
    for (const s of WORK_ITEM_STATUSES) {
      expect(() => ballInCourt(s, ASSIGNEE, GATEKEEPER)).not.toThrow()
    }
    expect(WORK_ITEM_STATUSES).toHaveLength(5)
  })
})

describe('REF_PREFIXES — the permanent human half of every work-item reference', () => {
  it('covers every registered type, with no unregistered key', () => {
    expect(Object.keys(REF_PREFIXES).sort()).toEqual([...WORK_ITEM_TYPE_KEYS].sort())
  })

  it('is short, upper-case and free of underscores — it is read on a phone', () => {
    for (const [key, prefix] of Object.entries(REF_PREFIXES)) {
      expect(prefix, `${key}`).toMatch(/^[A-Z]{2,5}$/)
    }
  })

  it('gives the spec examples', () => {
    expect(refPrefix('rfi')).toBe('RFI')
    expect(refPrefix('qc_defect')).toBe('QC')
    expect(refPrefix('order_followup')).toBe('ORD')
    expect(refPrefix('diary_action')).toBe('DIARY')
  })
})

describe('STATE_LABELS — the reader-facing word for a universal status', () => {
  it('covers every type × every status', () => {
    expect(Object.keys(STATE_LABELS).sort()).toEqual([...WORK_ITEM_TYPE_KEYS].sort())
    for (const key of WORK_ITEM_TYPE_KEYS) {
      for (const s of WORK_ITEM_STATUSES) {
        expect(stateLabel(key, s), `${key}/${s}`).toBeTruthy()
      }
    }
  })

  it('does not say "Answered" on a snag, an inspection, a task or a form', () => {
    expect(stateLabel('snag', 'answered')).toBe('Fixed — awaiting sign-off')
    expect(stateLabel('inspection', 'answered')).toBe('Awaiting verification')
    expect(stateLabel('task', 'answered')).toBe('Done — awaiting the creator')
    expect(stateLabel('form_action', 'answered')).toBe('Submitted')
    expect(stateLabel('rfi', 'answered')).toBe('Answered')
  })
})
