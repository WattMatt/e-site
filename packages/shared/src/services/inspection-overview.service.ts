/**
 * Inspections at a glance, for the dashboard and the project overview.
 *
 * The dashboard used to show only inspections awaiting verification or sent back (org-wide, with
 * no sign of whose they were) plus drafts older than 14 days, and the project overview showed no
 * inspections at all. So a new or in-progress inspection appeared nowhere, and nobody could see
 * which of them were waiting on them (ZZ status-guard test, 2026-10-12).
 *
 * Reads through the caller's client, so RLS (site scope, 00238) decides which inspections count.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface InspectionOverviewRow {
  id: string
  target_label: string
  project_id: string
  status: string
  assigned_to_id: string | null
  verifier_id: string | null
  updated_at: string
}

export interface InspectionOverviewItem extends InspectionOverviewRow {
  project_name: string | null
  /** Why it is on the caller's plate, when it is. */
  yours: 'verify' | 'fix' | 'inspect' | null
}

export interface InspectionOverview {
  counts: { open: number; awaiting: number; sentBack: number; certified: number }
  /** How many are waiting on the caller to verify (uncapped, unlike waitingOnYou). */
  toVerify: number
  /** Waiting on the caller: to verify, to fix after a send-back, or to inspect. Most urgent first. */
  waitingOnYou: InspectionOverviewItem[]
  /** Open inspections (not certified or abandoned), most recently active first. */
  recent: InspectionOverviewItem[]
  /** The rows read hit the cap, so counts are a lower bound. */
  truncated: boolean
}

export const INSPECTION_OVERVIEW_LIMIT = 1000

const OPEN = new Set(['assigned', 'in_progress'])
const URGENCY: Record<NonNullable<InspectionOverviewItem['yours']>, number> = { verify: 0, fix: 1, inspect: 2 }

function yoursFor(r: InspectionOverviewRow, userId: string | null): InspectionOverviewItem['yours'] {
  if (!userId) return null
  if (r.status === 'awaiting_verification' && r.verifier_id === userId) return 'verify'
  if (r.status === 're-inspect_required' && r.assigned_to_id === userId) return 'fix'
  if (OPEN.has(r.status) && r.assigned_to_id === userId) return 'inspect'
  return null
}

/** Pure: counts and lists from rows already read. */
export function summariseInspections(
  rows: InspectionOverviewRow[],
  userId: string | null,
  projectNames: Map<string, string> = new Map(),
  topN = 5,
): Omit<InspectionOverview, 'truncated'> {
  const counts = { open: 0, awaiting: 0, sentBack: 0, certified: 0 }
  const items: InspectionOverviewItem[] = []
  for (const r of rows) {
    if (OPEN.has(r.status)) counts.open++
    else if (r.status === 'awaiting_verification') counts.awaiting++
    else if (r.status === 're-inspect_required') counts.sentBack++
    else if (r.status === 'certified') counts.certified++
    if (r.status === 'certified' || r.status === 'abandoned') continue
    items.push({ ...r, project_name: projectNames.get(r.project_id) ?? null, yours: yoursFor(r, userId) })
  }
  const byRecent = (a: InspectionOverviewItem, b: InspectionOverviewItem) => b.updated_at.localeCompare(a.updated_at)
  const waitingOnYou = items
    .filter((i) => i.yours)
    .sort((a, b) => URGENCY[a.yours!] - URGENCY[b.yours!] || byRecent(a, b))
    .slice(0, topN)
  const recent = [...items].sort(byRecent).slice(0, topN)
  const toVerify = items.filter((i) => i.yours === 'verify').length
  return { counts, toVerify, waitingOnYou, recent }
}

/**
 * Reads inspections for the given orgs (or one project) and summarises them for the caller.
 * Errors read as an empty overview, like the other dashboard cards.
 */
export async function getInspectionOverview(
  client: SupabaseClient,
  scope: { orgIds: string[] } | { projectId: string },
  userId: string | null,
  topN = 5,
): Promise<InspectionOverview> {
  const empty: InspectionOverview = { counts: { open: 0, awaiting: 0, sentBack: 0, certified: 0 }, toVerify: 0, waitingOnYou: [], recent: [], truncated: false }
  if ('orgIds' in scope && scope.orgIds.length === 0) return empty

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (client as any)
    .schema('inspections')
    .from('inspections')
    .select('id, target_label, project_id, status, assigned_to_id, verifier_id, updated_at')
    .neq('status', 'abandoned')
    .order('updated_at', { ascending: false })
    .limit(INSPECTION_OVERVIEW_LIMIT)
  q = 'orgIds' in scope ? q.in('organisation_id', scope.orgIds) : q.eq('project_id', scope.projectId)
  const { data, error } = await q
  if (error || !data) return empty
  const rows = data as InspectionOverviewRow[]

  const projectNames = new Map<string, string>()
  if ('orgIds' in scope) {
    const ids = [...new Set(rows.map((r) => r.project_id))]
    if (ids.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: projects } = await (client as any).schema('projects').from('projects').select('id, name').in('id', ids)
      for (const p of (projects ?? []) as Array<{ id: string; name: string }>) projectNames.set(p.id, p.name)
    }
  }
  return { ...summariseInspections(rows, userId, projectNames, topN), truncated: rows.length >= INSPECTION_OVERVIEW_LIMIT }
}
