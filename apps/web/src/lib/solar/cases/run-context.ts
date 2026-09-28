import 'server-only'
/**
 * Everything a run needs, loaded with the SERVICE client — callers must have passed the Solar gate for
 * this project first. The same function feeds the Stale banner (currentHash) and the run itself, so the
 * two can never disagree about what "current inputs" means.
 *
 * The stored site series becomes the engine load through the integration adapter
 * `caseLoadFromSiteSeries` (refuses NaN / ±∞ / negative hours / wrong length with a LoadModelError,
 * surfaced here as a named build reason — never a 500). Its `referenceYear` is THE year of this
 * context: the tariff is priced, and TOU periods are typed, on that year's weekdays and holidays.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_REFERENCE_YEAR } from '@esite/shared'
import { inputsHash, type TouPeriod } from '@esite/shared/solar-engine'
import { caseLoadFromSiteSeries, LoadModelError } from '@esite/shared/solar-load'
import { BUILD_REASONS, buildCaseInput, engineTouPeriods, parseCaseConfig, type BuildResult, type CaseConfig, type StudyExportMode } from '@esite/shared/solar-cases'
import { resolveStudyTariff, type StudyTariff } from './tariff'
import type { WeatherDatasetRow } from './weather'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface StudyRow {
  id: string; project_id: string; organisation_id: string; latitude: number | null; longitude: number | null
  export_mode: StudyExportMode | null; export_limit_kw: number | null; nmd_kva: number | null
  load_basis: string | null; reference_year: number | null; selected_case_id: string | null; updated_at: string
}
export interface CaseRow { id: string; study_id: string; project_id: string; name: string; pv_source: string; config: unknown; updated_at: string }

export interface StudyInputs {
  study: StudyRow
  /** The engine load (caseLoadFromSiteSeries), or null when there is none or it was refused (see loadError). */
  siteLoad: { series: Float64Array; basis: string; referenceYear: number } | null
  /** A named reason when the stored series exists but cannot be simulated. */
  loadError: string | null
  /** The one year of this context: the load's, else the study's, else the tariff default. */
  referenceYear: number
  tariff: StudyTariff
  touPeriods: TouPeriod[] | null
}
export interface RunContext extends StudyInputs {
  caseRow: CaseRow
  config: CaseConfig
  weather: WeatherDatasetRow | null
  build: BuildResult
  currentHash: string | null
}
export type RunContextResult = { ok: true; ctx: RunContext } | { ok: false; status: 404 | 422; error: string }

export const loadRefusedReason = (e: LoadModelError) => `The stored site load cannot be simulated: ${e.message} Rebuild it on the Load tab.`

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function loadStudyInputs(svc: AnyClient, projectId: string): Promise<StudyInputs | null> {
  const { data: s } = await svc.schema('solar').from('studies')
    .select('id, project_id, organisation_id, latitude, longitude, export_mode, export_limit_kw, nmd_kva, load_basis, reference_year, selected_case_id, updated_at')
    .eq('project_id', projectId).maybeSingle()
  if (!s) return null
  const raw = s as StudyRow
  const study: StudyRow = { ...raw, latitude: n(raw.latitude), longitude: n(raw.longitude), export_limit_kw: n(raw.export_limit_kw), nmd_kva: n(raw.nmd_kva), reference_year: n(raw.reference_year) }
  let siteLoad: StudyInputs['siteLoad'] = null
  let loadError: string | null = null
  if (study.load_basis && study.reference_year) {
    const { data: sl } = await svc.schema('solar').from('site_load').select('series, basis, reference_year')
      .eq('study_id', study.id).eq('basis', study.load_basis).eq('reference_year', study.reference_year).maybeSingle()
    if (sl) {
      const row = sl as { series: unknown[] | null; basis: unknown; reference_year: unknown }
      try {
        const c = caseLoadFromSiteSeries({ series: (row.series ?? []).map(Number), referenceYear: Number(row.reference_year) })
        siteLoad = { series: c.load, basis: String(row.basis), referenceYear: c.referenceYear }
      } catch (e) {
        if (!(e instanceof LoadModelError)) throw e
        console.error('[solar-run-context] site load refused', { projectId, code: e.code })
        loadError = loadRefusedReason(e)
      }
    }
  }
  const referenceYear = siteLoad?.referenceYear ?? study.reference_year ?? DEFAULT_REFERENCE_YEAR
  const tariff = await resolveStudyTariff(svc, projectId, { year: referenceYear })
  const touPeriods = tariff.ok ? engineTouPeriods(tariff.calendar, tariff.holidays, referenceYear) : null
  return { study, siteLoad, loadError, referenceYear, tariff, touPeriods }
}

export async function contextForCase(svc: AnyClient, shared: StudyInputs, caseRow: CaseRow): Promise<RunContextResult> {
  const parsed = parseCaseConfig(caseRow.config)
  if (!parsed.ok) return { ok: false, status: 422, error: 'This case’s saved configuration is invalid — open it, check each section and save it again.' }
  let config = parsed.config
  let weather: WeatherDatasetRow | null = null
  if (config.weather.datasetId) {
    const { data } = await svc.schema('solar').from('weather_datasets').select('*')
      .eq('id', config.weather.datasetId).eq('organisation_id', shared.study.organisation_id).maybeSingle()
    weather = (data as WeatherDatasetRow | null) ?? null
    if (!weather) config = { ...config, weather: { ...config.weather, datasetId: null } }
  }
  let build = buildCaseInput({
    config,
    study: { exportMode: shared.study.export_mode, exportLimitKw: shared.study.export_limit_kw },
    siteLoad: shared.siteLoad,
    touPeriods: shared.touPeriods,
  })
  // A refused series is not "no load": name what is wrong with it instead.
  if (!build.ok && shared.loadError) {
    build = { ok: false, reasons: build.reasons.map((r) => (r === BUILD_REASONS.noLoad ? shared.loadError! : r)) }
  }
  return { ok: true, ctx: { ...shared, caseRow, config: parsed.config, weather, build, currentHash: build.ok ? inputsHash(build.input) : null } }
}

export async function loadRunContext(svc: AnyClient, projectId: string, caseId: string): Promise<RunContextResult> {
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return { ok: false, status: 404, error: 'Save Site & Supply first.' }
  const { data: c } = await svc.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at')
    .eq('id', caseId).eq('project_id', projectId).maybeSingle()
  if (!c) return { ok: false, status: 404, error: 'Case not found.' }
  return contextForCase(svc, shared, c as CaseRow)
}
