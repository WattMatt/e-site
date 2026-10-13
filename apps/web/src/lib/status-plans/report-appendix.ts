/**
 * The one place both tenant-report routes (preview + save) decide the status-plan appendix, so the
 * preview and the saved version cannot differ. Gate first (requireProjectAccess runs AS the caller,
 * site-scoped), then the service client for facts and drawing bytes. Never throws: a load failure is
 * a single "not included" line on the divider — the report itself still renders.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { requireProjectAccess } from '@/lib/auth/require-project-access'
import { appendixPurposes, statusPlanAppendixOptions } from './appendix-options'
import { loadStatusPlanRenderInputs, type PlanRenderLoadResult, type StorageLike } from './plan-render-data'

export interface ReportAppendix { load: PlanRenderLoadResult; generatedOn: string }
export type ReportAppendixResult =
  | { ok: true; appendix: ReportAppendix | null }
  | { ok: false; status: 404; error: string }

export async function loadReportAppendix(a: {
  url: string
  sessionClient: SupabaseClient
  projectId: string
  /** yyyy-mm-dd (johannesburgDate) — overdue is decided against it, as on the plan page. */
  today: string
}): Promise<ReportAppendixResult> {
  const opts = statusPlanAppendixOptions(a.url)
  const purposes = appendixPurposes(opts)
  if (purposes.length === 0 && !opts.byBoard) return { ok: true, appendix: null }
  const access = await requireProjectAccess(a.sessionClient, a.projectId)
  if (!access.ok) return access
  try {
    const service = createServiceClient()
    const clients = { db: a.sessionClient, facts: service, storage: service.storage as unknown as StorageLike }
    const parts: PlanRenderLoadResult[] = []
    if (purposes.length > 0) {
      parts.push(await loadStatusPlanRenderInputs(clients, { projectId: a.projectId, today: a.today, purposes }))
    }
    // Board pages follow the status pages; same files, so they embed once in the output (keyed by path).
    if (opts.byBoard) {
      parts.push(await loadStatusPlanRenderInputs(clients, { projectId: a.projectId, today: a.today, purposes: ['tenant_layout'], colourBy: 'board' }))
    }
    const load: PlanRenderLoadResult = {
      inputs: parts.flatMap((p) => p.inputs),
      omitted: parts.flatMap((p) => p.omitted),
    }
    const organisationId = parts.find((p) => p.organisationId)?.organisationId
    if (organisationId) load.organisationId = organisationId
    return { ok: true, appendix: { load, generatedOn: a.today } }
  } catch (err) {
    console.error('[status-plans] report appendix could not be loaded', err)
    return {
      ok: true,
      appendix: {
        load: { inputs: [], omitted: [{ title: 'Tenant plans', reason: 'the plans could not be loaded — generate the report again' }] },
        generatedOn: a.today,
      },
    }
  }
}
