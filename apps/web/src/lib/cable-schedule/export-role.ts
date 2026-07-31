/**
 * Role-gating + cost-redaction policy for cable-schedule export routes.
 *
 * Policy (2026-07-31, user-confirmed — replaces the org-role gate that
 * blocked contractor/inspector/supplier outright with `Unknown role`):
 *
 * Resolution runs through `public.user_effective_project_role` (migration
 * 00107 — the same RPC `requireEffectiveRole` uses): org owner/admin/PM win
 * regardless of project_members, else the projects.project_members.role
 * applies (per-project promotion), else null.
 *
 *   - owner / admin / project_manager → full export, cost included.
 *   - contractor / inspector / supplier / client_viewer → all formats,
 *     cost redacted (redactCost derives from COST_VIEW_ROLES so the "who
 *     sees money" decision stays in one shared constant).
 *   - No effective role (unassigned org member of any role, or outsider)
 *     → blocked. This preserves the original client_viewer project-scoping
 *     and extends it to the site roles.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { COST_VIEW_ROLES, ORG_ROLES } from '@esite/shared'
import type { OrgRole } from './roles'
import type { ExportPayload } from './export-payload'

export type ExportPolicy = {
  canExport: boolean
  redactCost: boolean
  /** The caller's resolved effective role on the project (set when canExport). */
  role?: OrgRole
  reason?: string
}

/**
 * Decide whether a user may export this revision and whether cost data
 * must be redacted. `projectId` scopes the effective-role resolution;
 * RLS has already gated payload visibility by the time this runs.
 */
export async function getExportPolicy(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<ExportPolicy> {
  const { data, error } = await (supabase as any).rpc(
    'user_effective_project_role',
    { p_project_id: projectId, p_user_id: userId },
  )
  if (error) {
    // Fail closed with a generic message — the raw PostgREST error would
    // leak schema/function internals into the 403 body.
    console.error('[cable-export] effective-role lookup failed', {
      projectId,
      error: error.message,
    })
    return { canExport: false, redactCost: false, reason: 'Role check failed' }
  }
  const role = (data ?? null) as OrgRole | null
  if (!role) {
    return { canExport: false, redactCost: false, reason: 'No access to this project' }
  }
  // Fail closed on any value outside the canonical role vocabulary — a
  // future role added to project_members must be reviewed here before it
  // starts exporting, not silently granted (unknown ⇒ deny).
  if (!ORG_ROLES.includes(role)) {
    return { canExport: false, redactCost: false, reason: `Unknown role: ${role}` }
  }
  return { canExport: true, redactCost: !COST_VIEW_ROLES.includes(role), role }
}

/**
 * Strip cost data from an ExportPayload for cost-redacted exports
 * (contractor / inspector / supplier / client_viewer).
 *
 * Sets `costRedacted: true` so each renderer's cost section can short-
 * circuit entirely (otherwise the renderers derive the BoM — sizes ×
 * lengths × terminations — from `cables` and emit a fully-itemised
 * bill with R0 rates, leaking contract scale through quantities).
 *
 * Also empties `costLines` and nulls `revision.vat_pct` as a defence-
 * in-depth measure for any future renderer that forgets the flag check.
 *
 * Schedule / tag / change_log content is unaffected — redacted roles can
 * still see what cables exist, just not what they cost.
 */
export function redactPayloadCost<T extends ExportPayload>(payload: T): T {
  return {
    ...payload,
    costRedacted: true,
    costLines: [],
    revision: { ...payload.revision, vat_pct: null },
  }
}

/**
 * Vercel serverless functions have hard memory + execution-time budgets.
 * Rendering a multi-MB PDF or workbook for a revision with thousands of
 * cables can OOM the function or trip the timeout, leaving the client with
 * an opaque 500. Pre-check the cable count up-front so we can return a
 * clean 413 with actionable guidance.
 *
 * Limits are deliberately conservative for v1 — tune up once we have real
 * profiling data on the prod renderer. PDF/ZIP get a tighter cap because
 * PDF rendering (per-cable rows + per-cable QR tags) dominates memory.
 */
export const MAX_CABLES_PER_EXPORT = 500
export const MAX_CABLES_PER_PDF = 300

export type SizeCheck = { ok: true } | { ok: false; reason: string; status: number }

export function checkExportSize(
  payload: { cables: unknown[] },
  format: 'excel' | 'pdf' | 'csv' | 'zip',
): SizeCheck {
  const count = payload.cables.length
  if (format === 'pdf' || format === 'zip') {
    if (count > MAX_CABLES_PER_PDF) {
      return {
        ok: false,
        status: 413,
        reason: `Revision has ${count} cables. PDF/ZIP export is capped at ${MAX_CABLES_PER_PDF}. Use Excel or CSV for large revisions, or contact support.`,
      }
    }
  }
  if (count > MAX_CABLES_PER_EXPORT) {
    return {
      ok: false,
      status: 413,
      reason: `Revision has ${count} cables. Export is capped at ${MAX_CABLES_PER_EXPORT}.`,
    }
  }
  return { ok: true }
}
