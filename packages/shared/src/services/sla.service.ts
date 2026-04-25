/**
 * SLA service — answers operational questions on overdue / pending /
 * stale work that the audit flagged as DB-only-not-UI gaps:
 *
 *   - Aging snags  : open snags older than N days
 *   - Pending COCs : subsections in submitted/under_review state
 *   - Stale RFIs   : RFIs past due_date or open longer than N days
 *
 * Reusable from web (server components) + mobile (react-query). The
 * SupabaseClient is passed in so each app can use its own auth context.
 *
 * IMPORTANT: SQL filtering only on already-RLS-scoped tables. The caller
 * must already be authenticated; RLS handles per-role visibility (incl.
 * the client_viewer scoping from migration 00034).
 */

import type { TypedSupabaseClient } from '@esite/db'

export const SLA_DEFAULTS = {
  /** Snags considered "aging" if open this many days. */
  AGING_SNAG_DAYS: 14,
  /** RFIs considered "stale" if open this many days (or past due_date). */
  STALE_RFI_DAYS: 7,
  /** How many top items each card shows. */
  TOP_N: 3,
} as const

// ─── Types ──────────────────────────────────────────────────────────────

export interface AgingSnag {
  id: string
  title: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: string
  project_id: string
  project_name: string | null
  created_at: string
  days_open: number
}

export interface PendingCoc {
  id: string                  // subsection id
  name: string
  coc_status: 'submitted' | 'under_review'
  site_id: string
  site_name: string | null
  uploaded_at: string | null  // most recent coc_uploads.created_at
}

export interface StaleRfi {
  id: string
  subject: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: string
  project_id: string
  project_name: string | null
  due_date: string | null
  created_at: string
  days_open: number
  is_overdue: boolean         // true if due_date < today
}

export interface SlaSummary {
  agingSnags: { count: number; top: AgingSnag[] }
  pendingCocs: { count: number; top: PendingCoc[] }
  staleRfis: { count: number; top: StaleRfi[] }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function daysBetween(iso: string, now = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

// ─── Aging snags ────────────────────────────────────────────────────────

export async function getAgingSnags(
  supabase: TypedSupabaseClient,
  orgId: string,
  daysOld: number = SLA_DEFAULTS.AGING_SNAG_DAYS,
  limit: number = SLA_DEFAULTS.TOP_N,
): Promise<{ count: number; top: AgingSnag[] }> {
  // 1) total count of aging snags
  const cutoff = daysAgoIso(daysOld)
  const { count } = await (supabase as any)
    .schema('field')
    .from('snags')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .in('status', ['open', 'in_progress'])
    .lt('created_at', cutoff)

  // 2) top N for the inline list, sorted by oldest first
  const { data: rows } = await (supabase as any)
    .schema('field')
    .from('snags')
    .select('id, title, priority, status, project_id, created_at')
    .eq('organisation_id', orgId)
    .in('status', ['open', 'in_progress'])
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit)

  const list: any[] = rows ?? []
  if (list.length === 0) return { count: count ?? 0, top: [] }

  // 3) hydrate project names (cross-schema; one extra round-trip)
  const projectIds = [...new Set(list.map(r => r.project_id).filter(Boolean))]
  const { data: projects } = projectIds.length
    ? await (supabase as any)
        .schema('projects')
        .from('projects')
        .select('id, name')
        .in('id', projectIds)
    : { data: [] }
  const projMap = new Map<string, string>((projects ?? []).map((p: any) => [p.id, p.name]))

  const top: AgingSnag[] = list.map(r => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    status: r.status,
    project_id: r.project_id,
    project_name: projMap.get(r.project_id) ?? null,
    created_at: r.created_at,
    days_open: daysBetween(r.created_at),
  }))

  return { count: count ?? top.length, top }
}

// ─── Pending COCs (subsections awaiting review) ─────────────────────────

export async function getPendingCocs(
  supabase: TypedSupabaseClient,
  orgId: string,
  limit: number = SLA_DEFAULTS.TOP_N,
): Promise<{ count: number; top: PendingCoc[] }> {
  // count: subsections with coc_status in (submitted, under_review)
  const { count } = await (supabase as any)
    .schema('compliance')
    .from('subsections')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .in('coc_status', ['submitted', 'under_review'])

  const { data: rows } = await (supabase as any)
    .schema('compliance')
    .from('subsections')
    .select('id, name, coc_status, site_id, updated_at')
    .eq('organisation_id', orgId)
    .in('coc_status', ['submitted', 'under_review'])
    .order('updated_at', { ascending: true }) // longest-pending first
    .limit(limit)

  const list: any[] = rows ?? []
  if (list.length === 0) return { count: count ?? 0, top: [] }

  const siteIds = [...new Set(list.map(r => r.site_id).filter(Boolean))]
  const { data: sites } = siteIds.length
    ? await (supabase as any)
        .schema('compliance')
        .from('sites')
        .select('id, name')
        .in('id', siteIds)
    : { data: [] }
  const siteMap = new Map<string, string>((sites ?? []).map((s: any) => [s.id, s.name]))

  const top: PendingCoc[] = list.map(r => ({
    id: r.id,
    name: r.name,
    coc_status: r.coc_status,
    site_id: r.site_id,
    site_name: siteMap.get(r.site_id) ?? null,
    uploaded_at: r.updated_at, // proxy — most recent state change
  }))

  return { count: count ?? top.length, top }
}

// ─── Stale RFIs ─────────────────────────────────────────────────────────

export async function getStaleRfis(
  supabase: TypedSupabaseClient,
  orgId: string,
  daysOld: number = SLA_DEFAULTS.STALE_RFI_DAYS,
  limit: number = SLA_DEFAULTS.TOP_N,
): Promise<{ count: number; top: StaleRfi[] }> {
  // RFI is "stale" when:
  //   status in ('draft','open') AND
  //     (due_date < today OR created_at older than daysOld days ago)
  //
  // PostgREST `or` syntax: `or=(due_date.lt.<today>,created_at.lt.<cutoff>)`
  const cutoffIso = daysAgoIso(daysOld)
  const today = todayIso()

  const { count } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .in('status', ['draft', 'open'])
    .or(`due_date.lt.${today},created_at.lt.${cutoffIso}`)

  const { data: rows } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .select('id, subject, priority, status, project_id, due_date, created_at')
    .eq('organisation_id', orgId)
    .in('status', ['draft', 'open'])
    .or(`due_date.lt.${today},created_at.lt.${cutoffIso}`)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(limit)

  const list: any[] = rows ?? []
  if (list.length === 0) return { count: count ?? 0, top: [] }

  const projectIds = [...new Set(list.map(r => r.project_id).filter(Boolean))]
  const { data: projects } = projectIds.length
    ? await (supabase as any)
        .schema('projects')
        .from('projects')
        .select('id, name')
        .in('id', projectIds)
    : { data: [] }
  const projMap = new Map<string, string>((projects ?? []).map((p: any) => [p.id, p.name]))

  const top: StaleRfi[] = list.map(r => ({
    id: r.id,
    subject: r.subject,
    priority: r.priority,
    status: r.status,
    project_id: r.project_id,
    project_name: projMap.get(r.project_id) ?? null,
    due_date: r.due_date,
    created_at: r.created_at,
    days_open: daysBetween(r.created_at),
    is_overdue: r.due_date != null && r.due_date < today,
  }))

  return { count: count ?? top.length, top }
}

// ─── Combined summary (single round of awaits, used by dashboard) ───────

export async function getSlaSummary(
  supabase: TypedSupabaseClient,
  orgId: string,
): Promise<SlaSummary> {
  const [agingSnags, pendingCocs, staleRfis] = await Promise.all([
    getAgingSnags(supabase, orgId),
    getPendingCocs(supabase, orgId),
    getStaleRfis(supabase, orgId),
  ])
  return { agingSnags, pendingCocs, staleRfis }
}
