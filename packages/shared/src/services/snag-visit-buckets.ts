export interface BucketVisit { id: string; visit_no: number }
export interface BucketSnag {
  id: string
  raised_on_visit_id: string | null
  closed_on_visit_id: string | null
  status: string
}
export interface VisitBuckets<T> { newSnags: T[]; stillOpen: T[]; closedThisVisit: T[] }

export const CLOSED_STATUSES = ['signed_off', 'closed'] as const

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
    if (rn === undefined || rn > visit.visit_no) continue
    const cn = closedNo(s)
    if (cn === visit.visit_no) { closedThisVisit.push(s); continue }
    if (s.raised_on_visit_id === visit.id) { newSnags.push(s); continue }
    const closedAsOfNow = cn !== undefined && cn <= visit.visit_no
    if (!closedAsOfNow) stillOpen.push(s)
  }
  return { newSnags, stillOpen, closedThisVisit }
}
