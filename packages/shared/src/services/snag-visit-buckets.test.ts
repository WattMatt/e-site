import { describe, it, expect } from 'vitest'
import { computeVisitBuckets, type BucketSnag, type BucketVisit } from './snag-visit-buckets'

const V = (id: string, visit_no: number): BucketVisit => ({ id, visit_no })
const S = (id: string, raised: string, closed: string | null, status: string): BucketSnag =>
  ({ id, raised_on_visit_id: raised, closed_on_visit_id: closed, status })

describe('computeVisitBuckets', () => {
  const visits = [V('v0', 0), V('v1', 1), V('v2', 2)]

  it('new = raised on this visit', () => {
    const snags = [S('a', 'v1', null, 'open'), S('b', 'v0', null, 'open')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.newSnags.map(s => s.id)).toEqual(['a'])
  })
  it('closed = closed on this visit', () => {
    const snags = [S('a', 'v0', 'v1', 'closed')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.closedThisVisit.map(s => s.id)).toEqual(['a'])
    expect(r.stillOpen).toHaveLength(0)
  })
  it('still-open = raised on-or-before, not closed as of this visit', () => {
    const snags = [S('a', 'v0', 'v2', 'closed')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.stillOpen.map(s => s.id)).toEqual(['a'])
    expect(r.closedThisVisit).toHaveLength(0)
  })
  it('a snag raised on a later visit is invisible to an earlier visit', () => {
    const snags = [S('a', 'v2', null, 'open')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.newSnags).toHaveLength(0)
    expect(r.stillOpen).toHaveLength(0)
  })

  // Edge: backlog snag (v0) still open at latest visit v2
  it('backlog snag with no close is still-open at every later visit', () => {
    const snags = [S('a', 'v0', null, 'open')]
    const r2 = computeVisitBuckets(V('v2', 2), visits, snags)
    expect(r2.stillOpen.map(s => s.id)).toEqual(['a'])
    expect(r2.newSnags).toHaveLength(0)
  })

  // Edge: snag raised and closed on the same visit
  it('snag raised and closed on the same visit appears in closedThisVisit only', () => {
    const snags = [S('a', 'v1', 'v1', 'closed')]
    const r = computeVisitBuckets(V('v1', 1), visits, snags)
    expect(r.closedThisVisit.map(s => s.id)).toEqual(['a'])
    expect(r.newSnags).toHaveLength(0)
    expect(r.stillOpen).toHaveLength(0)
  })

  // Off-process close: status='signed_off' but closed_on_visit_id=null (legacy form close).
  // Must NOT appear in stillOpen — the status gate catches it.
  it('off-process close (signed_off, no closed_on_visit_id) is not in stillOpen', () => {
    const snags = [S('a', 'v0', null, 'signed_off')]
    const r = computeVisitBuckets(V('v2', 2), visits, snags)
    expect(r.stillOpen).toHaveLength(0)
    expect(r.closedThisVisit).toHaveLength(0)
  })

  // Re-open: status='open' but stale closed_on_visit_id='v1' (re-opened after visit close).
  // Must appear in stillOpen at v2 — stale stamp is ignored when status is not closed.
  it('re-opened snag (status=open, stale closed_on_visit_id) is in stillOpen', () => {
    const snags = [S('a', 'v0', 'v1', 'open')]
    const r = computeVisitBuckets(V('v2', 2), visits, snags)
    expect(r.stillOpen.map(s => s.id)).toEqual(['a'])
  })
})
