/**
 * SLA service — answers operational questions on overdue / pending /
 * stale work that the audit flagged as DB-only-not-UI gaps:
 *
 *   - Aging snags             : open snags older than N days
 *   - Stale RFIs              : RFIs past due_date or open longer than N days
 *   - Awaiting verification   : inspections completed by inspector, waiting on verifier
 *   - Re-inspect required     : inspections sent back to inspector
 *   - Stale draft inspections : inspections in assigned/in_progress for >N days
 *
 * Reusable from web (server components) + mobile (react-query). The
 * SupabaseClient is passed in so each app can use its own auth context.
 *
 * IMPORTANT: SQL filtering only on already-RLS-scoped tables. The caller
 * must already be authenticated; RLS handles per-role visibility (incl.
 * the client_viewer scoping from migration 00034).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
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

// ─── Inspections SLA (replaces pending-COCs) ────────────────────────────
//
// These three functions surface the operational queue for the inspections
// module: completed inspections awaiting verifier sign-off, inspections
// kicked back for re-work, and drafts that have stalled.

export async function getAwaitingVerification(
  client: SupabaseClient,
  orgIds: string[],
): Promise<any[]> {
  if (!orgIds.length) return []
  const { data } = await (client as any)
    .schema('inspections')
    .from('inspections')
    .select('id, target_label, project_id, template_id, completed_at')
    .in('organisation_id', orgIds)
    .eq('status', 'awaiting_verification')
    .order('completed_at', { ascending: true })
    .limit(50)
  return data ?? []
}

export async function getReInspectRequired(
  client: SupabaseClient,
  orgIds: string[],
): Promise<any[]> {
  if (!orgIds.length) return []
  const { data } = await (client as any)
    .schema('inspections')
    .from('inspections')
    .select('id, target_label, project_id, template_id, updated_at')
    .in('organisation_id', orgIds)
    .eq('status', 're-inspect_required')
    .order('updated_at', { ascending: true })
    .limit(50)
  return data ?? []
}

export async function getStaleDraftInspections(
  client: SupabaseClient,
  orgIds: string[],
  staleAfterDays = 14,
): Promise<any[]> {
  if (!orgIds.length) return []
  const cutoff = new Date(Date.now() - staleAfterDays * 86_400_000).toISOString()
  const { data } = await (client as any)
    .schema('inspections')
    .from('inspections')
    .select('id, target_label, project_id, template_id, created_at')
    .in('organisation_id', orgIds)
    .in('status', ['assigned', 'in_progress'])
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50)
  return data ?? []
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
  const [agingSnags, staleRfis] = await Promise.all([
    getAgingSnags(supabase, orgId),
    getStaleRfis(supabase, orgId),
  ])
  return { agingSnags, staleRfis }
}
