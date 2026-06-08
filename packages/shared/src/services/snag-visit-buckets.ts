export interface BucketVisit { id: string; visit_no: number }
export interface BucketSnag {
  id: string
  raised_on_visit_id: string | null
  closed_on_visit_id: string | null
  status: string
}
export interface VisitBuckets<T> { newSnags: T[]; stillOpen: T[]; closedThisVisit: T[] }

// CLOSED_STATUSES is exported for the actions + report layers, which maintain the
// invariant that whenever a snag reaches a closed status it is stamped with
// closed_on_visit_id (and vice-versa).
// It is intentionally NOT consulted inside computeVisitBuckets — see the comment
// on that function for why.
export const CLOSED_STATUSES = ['signed_off', 'closed'] as const

// Closedness classification uses BOTH the snag's current status AND its
// temporal attribution (closed_on_visit_id) to handle two edge cases that a
// purely temporal approach misses:
//   (a) A snag closed via the legacy status form (status='signed_off' but
//       closed_on_visit_id=null) would show as "still open" forever.
//   (b) A snag re-opened after a visit-close (status='open' but a stale
//       closed_on_visit_id) would show as closed despite being active again.
// Rules:
//   • Closed THIS visit  = currently closed AND attributed to this visit.
//   • New this visit     = raised on this visit (and not closed-this-visit).
//   • Carried forward:  "closed as of now" = currently closed AND
//     (unattributed OR attributed to this-or-earlier visit).  A re-opened
//     snag (status no longer closed) is open regardless of any stale stamp.
//     A future-attributed close means the snag was still open as of this visit.
export function computeVisitBuckets<T extends BucketSnag>(
  visit: BucketVisit,
  allVisits: BucketVisit[],
  snags: T[],
): VisitBuckets<T> {
  const noById = new Map(allVisits.map(v => [v.id, v.visit_no]))
  const raisedNo = (s: T) => (s.raised_on_visit_id != null ? noById.get(s.raised_on_visit_id) : undefined)
  const closedNo = (s: T) => (s.closed_on_visit_id != null ? noById.get(s.closed_on_visit_id) : undefined)
  const isClosed = (s: T) => (CLOSED_STATUSES as readonly string[]).includes(s.status)

  const newSnags: T[] = [], stillOpen: T[] = [], closedThisVisit: T[] = []
  for (const s of snags) {
    const rn = raisedNo(s)
    // A snag with a null/unknown raised_on_visit_id is invisible to all buckets.
    // The migration backfills every existing snag; create paths always set it.
    if (rn === undefined || rn > visit.visit_no) continue
    const cn = closedNo(s)
    const closed = isClosed(s)
    // Closed THIS visit: currently closed AND attributed to this visit.
    if (closed && cn === visit.visit_no) { closedThisVisit.push(s); continue }
    // New this visit: raised on this visit (and not closed-this-visit, handled above).
    if (rn === visit.visit_no) { newSnags.push(s); continue }
    // Carried forward from an earlier visit. "Closed as of now" = currently closed AND
    // (unattributed OR attributed to this-or-earlier visit). A snag closed at a LATER
    // visit was still open as of this visit; a re-opened snag (status no longer closed)
    // is open regardless of any stale closed_on_visit_id stamp.
    const closedAsOfNow = closed && (cn === undefined || cn <= visit.visit_no)
    if (!closedAsOfNow) stillOpen.push(s)
  }
  return { newSnags, stillOpen, closedThisVisit }
}
