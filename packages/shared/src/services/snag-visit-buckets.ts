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

// Closedness *as of a visit* is determined by closed_on_visit_id (temporal
// attribution), NOT by the snag's current status field.  This lets historical
// visit reports render correctly: a snag that was closed at visit N must still
// appear as "open" in the report for visit N-1, even though its current status
// is now 'closed'.  Consulting status here would break that invariant.
// The actions layer maintains the invariant that closed_on_visit_id is always
// set (and cleared) in sync with the snag reaching/leaving a closed status.
export function computeVisitBuckets<T extends BucketSnag>(
  visit: BucketVisit,
  allVisits: BucketVisit[],
  snags: T[],
): VisitBuckets<T> {
  const noById = new Map(allVisits.map(v => [v.id, v.visit_no]))
  const raisedNo = (s: T) => (s.raised_on_visit_id != null ? noById.get(s.raised_on_visit_id) : undefined)
  const closedNo = (s: T) => (s.closed_on_visit_id != null ? noById.get(s.closed_on_visit_id) : undefined)
  const newSnags: T[] = [], stillOpen: T[] = [], closedThisVisit: T[] = []
  for (const s of snags) {
    const rn = raisedNo(s)
    // A snag with a null/unknown raised_on_visit_id is invisible to all buckets.
    // The migration backfills every existing snag; create paths always set it.
    if (rn === undefined || rn > visit.visit_no) continue
    const cn = closedNo(s)
    if (cn === visit.visit_no) { closedThisVisit.push(s); continue }
    if (s.raised_on_visit_id === visit.id) { newSnags.push(s); continue }
    const closedAsOfNow = cn !== undefined && cn <= visit.visit_no
    if (!closedAsOfNow) stillOpen.push(s)
  }
  return { newSnags, stillOpen, closedThisVisit }
}
