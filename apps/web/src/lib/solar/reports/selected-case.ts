import 'server-only'
/**
 * The selected case (spec §2.2) and its latest SUCCEEDED run — the only thing reports and proposals
 * are generated from (never recomputed). Refuses when the case is Stale by the 4b rule (the current
 * inputs' hash differs from the run's), running, or failed. The same builder that computes the
 * Stale banner's hash (contextForCase) is used here, so the two can never disagree.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { caseStatus, type CaseRunOutputs } from '@esite/shared/solar-cases'
import { contextForCase, loadStudyInputs, type StudyInputs } from '@/lib/solar/cases/run-context'
import { runsByCase } from '@/lib/solar/cases/page-data'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const SELECTED_CASE_REASONS = {
  noStudy: 'Save Site & Supply first.',
  noSelection: 'Choose a selected case on the Overview first.',
  noRun: 'Run the selected case on Yield & Scenarios first.',
  stale: 'The selected case is stale — re-run it first.',
  running: 'The selected case is running — wait for it to finish.',
  failed: 'The selected case’s last run failed — fix it and re-run.',
} as const

export interface SelectedCaseRow { id: string; study_id: string; project_id: string; name: string; pv_source: string; layout_id: string | null; config: unknown; updated_at: string }
export interface SelectedCaseOk {
  ok: true
  shared: StudyInputs
  caseRow: SelectedCaseRow
  run: { id: string; finishedAt: string; inputsHash: string; outputs: CaseRunOutputs; configSnapshot: unknown; hourlyPath: string; exportSettings?: unknown }
}
export type SelectedCaseResult = SelectedCaseOk | { ok: false; stale: boolean; reason: string }

const no = (reason: string, stale = false): SelectedCaseResult => ({ ok: false, stale, reason })

export async function loadSelectedCase(user: AnyClient, svc: AnyClient, projectId: string): Promise<SelectedCaseResult> {
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return no(SELECTED_CASE_REASONS.noStudy)
  const selId = shared.study.selected_case_id
  if (!selId) return no(SELECTED_CASE_REASONS.noSelection)
  const { data: c } = await user.schema('solar').from('cases')
    .select('id, study_id, project_id, name, pv_source, layout_id, config, updated_at').eq('id', selId).eq('project_id', projectId).maybeSingle()
  if (!c) return no(SELECTED_CASE_REASONS.noSelection)
  const caseRow = c as SelectedCaseRow
  const { latest, ok } = await runsByCase(user, projectId)
  const last = latest.get(selId) as Row | undefined
  const lastOk = ok.get(selId) as Row | undefined
  if (!lastOk) return no(SELECTED_CASE_REASONS.noRun)
  const ctx = await contextForCase(svc, shared, caseRow)
  const st = caseStatus(
    last ? { status: last.status as never, inputsHash: String(last.inputs_hash), startedAt: String(last.started_at) } : null,
    { inputsHash: String(lastOk.inputs_hash) },
    ctx.ok ? ctx.ctx.currentHash : null,
    Date.now(),
  )
  if (st.status === 'stale') return no(SELECTED_CASE_REASONS.stale, true)
  if (st.status === 'running') return no(SELECTED_CASE_REASONS.running)
  if (st.status === 'failed') return no(SELECTED_CASE_REASONS.failed)
  const { data: r } = await user.schema('solar').from('case_runs')
    .select('id, finished_at, inputs_hash, outputs, config_snapshot, hourly_path, export_settings').eq('id', lastOk.id as string).maybeSingle()
  const run = r as Row | null
  if (!run?.outputs || !run.hourly_path) return no(SELECTED_CASE_REASONS.noRun)
  return {
    ok: true, shared, caseRow,
    run: {
      id: String(run.id), finishedAt: String(run.finished_at), inputsHash: String(run.inputs_hash),
      outputs: run.outputs as CaseRunOutputs, configSnapshot: run.config_snapshot, hourlyPath: String(run.hourly_path),
      exportSettings: run.export_settings ?? null,
    },
  }
}
