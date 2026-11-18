/**
 * The programme screen's data: the person's programmes on the project, the one
 * selected (project programme by default), its state via P2's `loadProgramme`,
 * and its baselines with the active baseline's dates (for the baseline bars).
 * Everything is read as the person, so RLS decides what they see.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadProgramme, PROGRAMME_GONE, programmeSchema } from './load'
import type { ActiveBaselineView, BaselineSummary, ProgrammeSelector, ProgrammeSummary, ProgrammeViewData } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const READ_FAILED = 'The programme could not be read. Reload and try again.'
const PAGE = 1000

export type LoadProgrammeViewResult =
  | { ok: true; view: ProgrammeViewData | null; programmes: ProgrammeSummary[] }
  | { ok: false; error: string }

async function baselineDates(supabase: AnyClient, baselineId: string): Promise<ActiveBaselineView['activities']> {
  const out: ActiveBaselineView['activities'] = {}
  // PostgREST caps every read at 1000 rows, so page with a stable order.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await programmeSchema(supabase)
      .from('baseline_activities').select('id, activity_id, early_start, early_finish')
      .eq('baseline_id', baselineId).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Array<{ activity_id: string; early_start: string | null; early_finish: string | null }>
    for (const r of rows) out[r.activity_id] = { early_start: r.early_start ?? null, early_finish: r.early_finish ?? null }
    if (rows.length < PAGE) return out
  }
}

export async function loadProgrammeView(
  supabase: AnyClient, projectId: string, selector: ProgrammeSelector,
): Promise<LoadProgrammeViewResult> {
  try {
    const { data, error } = await programmeSchema(supabase)
      .from('programmes').select('id, kind, name, module_key, contractor_label, created_at')
      .eq('project_id', projectId).order('created_at', { ascending: true }).order('id', { ascending: true })
    if (error) return { ok: false, error: READ_FAILED }
    const programmes: ProgrammeSummary[] = ((data ?? []) as Array<ProgrammeSummary & { created_at?: string }>).map((p) => ({
      id: p.id, kind: p.kind, name: p.name, module_key: p.module_key ?? null, contractor_label: p.contractor_label ?? null,
    }))

    let chosen: ProgrammeSummary | undefined
    if (selector.programmeId) {
      chosen = programmes.find((p) => p.id === selector.programmeId)
      if (!chosen) return { ok: false, error: PROGRAMME_GONE }
    } else if (selector.module === 'solar') {
      chosen = programmes.find((p) => p.kind === 'module' && p.module_key === 'solar')
    } else {
      // The project programme; without one, the first contractor programme (a module programme
      // opens only through its own selector).
      chosen = programmes.find((p) => p.kind === 'project') ?? programmes.find((p) => p.kind === 'contractor')
    }
    if (!chosen) return { ok: true, view: null, programmes }

    const loaded = await loadProgramme(supabase, chosen.id)
    if (!loaded.ok) return { ok: false, error: loaded.error }

    const { data: bl, error: blErr } = await programmeSchema(supabase)
      .from('baselines').select('id, name, is_active, created_at')
      .eq('programme_id', chosen.id).order('created_at', { ascending: true }).order('id', { ascending: true })
    if (blErr) return { ok: false, error: READ_FAILED }
    const baselines: BaselineSummary[] = ((bl ?? []) as BaselineSummary[]).map((b) => ({
      id: b.id, name: b.name, is_active: Boolean(b.is_active), created_at: b.created_at,
    }))
    const active = baselines.find((b) => b.is_active)
    const activeBaseline: ActiveBaselineView | null = active
      ? { id: active.id, name: active.name, activities: await baselineDates(supabase, active.id) }
      : null

    return {
      ok: true,
      programmes,
      view: { state: loaded.state, version: loaded.state.programme.updated_at ?? '', activeBaseline, baselines },
    }
  } catch {
    return { ok: false, error: READ_FAILED }
  }
}
