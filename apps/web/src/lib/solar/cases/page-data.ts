import 'server-only'
/**
 * View models for the Yield & Scenarios page, the tab readiness and the Overview KPIs. JSON only
 * (a page.tsx hands these to client components — no functions, typed arrays or Dates). Every figure
 * is read from a stored run or stored financial result; the only arithmetic here is summarising the
 * stored INPUT load for display and year-1 saving = stored bill before − stored bill after.
 * Callers must have passed requireSolarLevel(project, 'view') first — `svc` reads the study inputs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings, type SolarAccessLevel, type SolarReadinessExtra, type FinancialsReadinessInput } from '@esite/shared'
import {
  caseStatus, capexTotals, parseCaseConfig, parseFinanceConfig, resetLossesToDefaults,
  type CaseConfig, type CaseLosses, type CaseRunOutputs, type CaseStatus, type RunKpis,
} from '@esite/shared/solar-cases'
import { loadOperationsReadiness } from '@/lib/solar/operations/data'
import { contextForCase, loadStudyInputs, type CaseRow } from './run-context'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CaseCardView {
  id: string; name: string; pvSource: string; dcKwp: number; acKw: number; batteryKwh: number | null; updatedAt: string
  status: CaseStatus; statusLabel: string; lastRunAt: string | null; annualPvKwh: number | null
  /** Stored year-1 bill before − after; null below edit_financials or before Run financials. */
  year1SavingZar: number | null
  selected: boolean; canSelect: boolean
}
export interface RunView { id: string; startedAt: string; finishedAt: string | null; runByName: string; outputs: CaseRunOutputs }
export interface EquipmentOption { id: string; make: string; model: string; retired: boolean; specs: Record<string, number | boolean> }
export interface EquipmentOptions { modules: EquipmentOption[]; inverters: EquipmentOption[]; batteries: EquipmentOption[] }
export interface WeatherView { id: string; latRound: number; lngRound: number; fetchedAt: string; radiationDb: string | null; gsaPvoutKwhPerKwp: number | null }
export interface CaseEditorData {
  caseId: string; name: string; updatedAt: string; config: CaseConfig; buildReasons: string[]
  status: CaseStatus; statusLabel: string; running: boolean
  weather: WeatherView | null
  studyExport: { mode: string | null; limitKw: number | null }
  siteLoad: { basis: string; referenceYear: number; annualKwh: number; peakKw: number } | null
  tariffNote: string | null
  defaultLosses: { racked: CaseLosses; flush: CaseLosses }
  lastRun: RunView | null
}
export interface CompareMoney { year1SavingZar: number; irr: number | null; npvZar: number; simplePaybackYears: number | null }
export interface CompareColumn { caseId: string; name: string; kpis: RunKpis; monthlyPvKwh: number[]; money: CompareMoney | null }
export interface YieldPageData {
  hasStudy: boolean; studyUpdatedAt: string | null; selectedCaseId: string | null
  cases: CaseCardView[]; editor: CaseEditorData | null; compare: CompareColumn[] | null
  equipment: EquipmentOptions
}

const emptyEquipment = (): EquipmentOptions => ({ modules: [], inverters: [], batteries: [] })

/** Latest run and latest SUCCEEDED run per case (rows ordered newest first). */
export async function runsByCase(user: AnyClient, projectId: string) {
  const { data } = await user.schema('solar').from('case_runs')
    .select('id, case_id, status, inputs_hash, started_at, finished_at, run_by').eq('project_id', projectId).order('started_at', { ascending: false })
  const latest = new Map<string, Row>(), ok = new Map<string, Row>()
  for (const r of (data ?? []) as Row[]) {
    if (!latest.has(r.case_id)) latest.set(r.case_id, r)
    if (r.status === 'succeeded' && !ok.has(r.case_id)) ok.set(r.case_id, r)
  }
  return { latest, ok }
}

export async function outputsOf(user: AnyClient, runId: string): Promise<CaseRunOutputs | null> {
  const { data } = await user.schema('solar').from('case_runs').select('outputs').eq('id', runId).maybeSingle()
  return ((data as Row | null)?.outputs as CaseRunOutputs | undefined) ?? null
}

/** Latest stored financial result per case. Money RLS gates this too; callers only ask at edit_financials. */
export async function latestMoney(user: AnyClient, caseIds: string[]): Promise<Map<string, Row>> {
  if (caseIds.length === 0) return new Map()
  const { data } = await user.schema('solar').from('case_run_financials').select('case_id, case_run_id, created_at, results').in('case_id', caseIds).order('created_at', { ascending: false })
  const m = new Map<string, Row>()
  for (const r of (data ?? []) as Row[]) if (!m.has(r.case_id)) m.set(r.case_id, r)
  return m
}

/**
 * The ONE view a headline figure is read from (Overview KPIs, case card, Compare): the cash purchase's
 * owner view when cash is modelled; otherwise the first model's owner (debt) or client (PPA/lease) view —
 * the site owner's side. Never an investor view: its IRR/NPV is the funder's return, not the client's.
 */
export function headlineView(models: Row[] | undefined): Row | undefined {
  const all = models ?? []
  const cash = all.find((m) => m.model === 'cash')
  const pick = (m: Row | undefined) => ((m?.views ?? []) as Row[]).find((v) => v.view === 'owner' || v.view === 'client')
  return pick(cash) ?? all.map(pick).find(Boolean)
}

/** Money for a case card / Compare column — only when the stored result priced the case's LATEST succeeded run. */
const moneyOf = (fin: Row | undefined, latestOkRunId: string | undefined): CompareMoney | null => {
  if (!fin || !latestOkRunId || fin.case_run_id !== latestOkRunId) return null
  const v = headlineView(fin.results?.finance?.models)
  const b = fin.results?.year1Bills
  if (!v || !b) return null
  return { year1SavingZar: b.beforeZar - b.afterZar, irr: v.irr ?? null, npvZar: v.npvZar, simplePaybackYears: v.simplePaybackYears ?? null }
}

/** Sum + peak of the stored input load (Float64Array or plain array) — display of an INPUT, not a result. */
function loadSummary(series: ArrayLike<number>): { annualKwh: number; peakKw: number } {
  let annualKwh = 0, peakKw = 0
  for (let i = 0; i < series.length; i++) { const v = series[i]!; annualKwh += v; if (v > peakKw) peakKw = v }
  return { annualKwh, peakKw }
}

function statusOf(latest: Row | undefined, lastOk: Row | undefined, currentHash: string | null) {
  return caseStatus(
    latest ? { status: latest.status, inputsHash: latest.inputs_hash, startedAt: latest.started_at } : null,
    lastOk ? { inputsHash: lastOk.inputs_hash } : null, currentHash, Date.now())
}

export async function loadYieldPageData(user: AnyClient, svc: AnyClient, projectId: string, level: SolarAccessLevel, q: { caseId?: string; compare?: string }): Promise<YieldPageData> {
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return { hasStudy: false, studyUpdatedAt: null, selectedCaseId: null, cases: [], editor: null, compare: null, equipment: emptyEquipment() }
  const { data: caseData } = await user.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at, created_at')
    .eq('project_id', projectId).order('created_at', { ascending: true })
  const rows = (caseData ?? []) as CaseRow[]
  const { latest, ok } = await runsByCase(user, projectId)
  const money = level === 'edit_financials' ? await latestMoney(user, rows.map((r) => r.id)) : new Map<string, Row>()

  const ctxs = new Map<string, Awaited<ReturnType<typeof contextForCase>>>()
  for (const r of rows) ctxs.set(r.id, await contextForCase(svc, shared, r))
  const outputsCache = new Map<string, CaseRunOutputs | null>()
  const outputsFor = async (runId: string) => {
    if (!outputsCache.has(runId)) outputsCache.set(runId, await outputsOf(user, runId))
    return outputsCache.get(runId)!
  }

  const cases: CaseCardView[] = []
  for (const r of rows) {
    const c = ctxs.get(r.id)!
    const lastOk = ok.get(r.id)
    const st = statusOf(latest.get(r.id), lastOk, c.ok ? c.ctx.currentHash : null)
    const cfg = parseCaseConfig(r.config)
    const out = lastOk ? await outputsFor(lastOk.id) : null
    const m = moneyOf(money.get(r.id), lastOk?.id)
    cases.push({
      id: r.id, name: r.name, pvSource: r.pv_source, updatedAt: r.updated_at,
      dcKwp: cfg.ok ? cfg.config.pv.dcKwp : 0, acKw: cfg.ok ? cfg.config.pv.acKw : 0,
      batteryKwh: cfg.ok && cfg.config.battery.enabled ? cfg.config.battery.usableKwh : null,
      status: st.status, statusLabel: st.label, lastRunAt: lastOk?.finished_at ?? null,
      annualPvKwh: out?.kpis.annualAcKwh ?? null, year1SavingZar: m ? m.year1SavingZar : null,
      selected: shared.study.selected_case_id === r.id, canSelect: Boolean(lastOk),
    })
  }

  const editorId = [q.caseId, shared.study.selected_case_id, rows[0]?.id].find((id) => id && rows.some((r) => r.id === id)) ?? null
  let editor: CaseEditorData | null = null
  if (editorId) {
    const r = rows.find((x) => x.id === editorId)!
    const c = ctxs.get(editorId)!
    const card = cases.find((x) => x.id === editorId)!
    const lastOk = ok.get(editorId)
    const parsed = parseCaseConfig(r.config)
    if (c.ok && parsed.ok) {
      const { data: os } = await svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', shared.study.organisation_id).maybeSingle()
      const settings = readSolarOrgSettings((os as Row | null)?.settings ?? null)
      const config = parsed.config
      let lastRun: RunView | null = null
      if (lastOk) {
        const outputs = await outputsFor(lastOk.id)
        const { data: prof } = await svc.from('profiles').select('id, full_name').eq('id', lastOk.run_by).maybeSingle()
        if (outputs) {
          lastRun = { id: lastOk.id, startedAt: lastOk.started_at, finishedAt: lastOk.finished_at ?? null, runByName: ((prof as Row | null)?.full_name as string | undefined)?.trim() || 'Someone', outputs }
        }
      }
      const w = c.ctx.weather
      editor = {
        caseId: r.id, name: r.name, updatedAt: r.updated_at, config,
        buildReasons: c.ctx.build.ok ? [] : c.ctx.build.reasons,
        status: card.status, statusLabel: card.statusLabel, running: card.status === 'running',
        weather: w ? {
          id: w.id, latRound: Number(w.lat_round), lngRound: Number(w.lng_round), fetchedAt: String(w.fetched_at ?? ''), radiationDb: w.radiation_db ?? null,
          gsaPvoutKwhPerKwp: w.gsa_pvout_kwh_per_kwp === null || w.gsa_pvout_kwh_per_kwp === undefined ? null : Number(w.gsa_pvout_kwh_per_kwp),
        } : null,
        studyExport: { mode: shared.study.export_mode, limitKw: shared.study.export_limit_kw },
        siteLoad: shared.siteLoad ? { basis: shared.siteLoad.basis, referenceYear: shared.siteLoad.referenceYear, ...loadSummary(shared.siteLoad.series) } : null,
        tariffNote: shared.tariff.ok ? null : shared.tariff.reason,
        defaultLosses: {
          racked: resetLossesToDefaults({ ...config, pv: { ...config.pv, mounting: 'racked' } }, settings).losses,
          flush: resetLossesToDefaults({ ...config, pv: { ...config.pv, mounting: 'flush' } }, settings).losses,
        },
        lastRun,
      }
    }
  }

  const ids = [...new Set((q.compare ?? '').split(','))].filter((id) => rows.some((r) => r.id === id))
  let compare: CompareColumn[] | null = null
  if (ids.length >= 2 && ids.length <= 4) {
    compare = []
    for (const id of ids) {
      const lastOk = ok.get(id)
      const out = lastOk ? await outputsFor(lastOk.id) : null
      if (!out) continue
      compare.push({ caseId: id, name: rows.find((r) => r.id === id)!.name, kpis: out.kpis, monthlyPvKwh: out.monthly.map((m) => m.pvKwh), money: moneyOf(money.get(id), lastOk?.id) })
    }
  }

  let equipment = emptyEquipment()
  if (level !== 'view') {
    const { data: eq } = await user.schema('solar').from('equipment').select('id, organisation_id, kind, make, model, specs, retired_at')
    const all = (eq ?? []) as Row[]
    const pick = (k: string): EquipmentOption[] => all.filter((e) => e.kind === k)
      .map((e) => ({ id: e.id, make: e.make, model: e.model, retired: e.retired_at !== null && e.retired_at !== undefined, specs: e.specs ?? {} }))
    equipment = { modules: pick('module'), inverters: pick('inverter'), batteries: pick('battery') }
  }

  return { hasStudy: true, studyUpdatedAt: shared.study.updated_at, selectedCaseId: shared.study.selected_case_id, cases, editor, compare, equipment }
}

export interface ReadinessState extends SolarReadinessExtra { stale: { caseId: string; caseName: string } | null }

/** Tab readiness inputs + the Stale banner decision (current hash vs the latest succeeded run's inputs_hash). */
export async function loadSolarReadinessExtra(user: AnyClient, svc: AnyClient, projectId: string, level: SolarAccessLevel): Promise<ReadinessState> {
  const shared = await loadStudyInputs(svc, projectId)
  // A cost-view caller with nothing to report on yet sees "not yet", never the no-access reason.
  if (!shared) return level === 'edit_financials' ? { stale: null, reports: { hasCurrentFeasibility: false } } : { stale: null }
  const { data: caseData } = await user.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at').eq('project_id', projectId)
  const rows = (caseData ?? []) as CaseRow[]
  const sel = rows.find((r) => r.id === shared.study.selected_case_id) ?? null
  let selectedStatus: CaseStatus | null = null
  if (sel) {
    const { latest, ok } = await runsByCase(user, projectId)
    const c = await contextForCase(svc, shared, sel)
    selectedStatus = statusOf(latest.get(sel.id), ok.get(sel.id), c.ok ? c.ctx.currentHash : null).status
  }
  let financials: FinancialsReadinessInput | null = null
  if (sel && level === 'edit_financials') {
    const { data } = await user.schema('solar').from('case_financials').select('config').eq('case_id', sel.id)
    const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined
    const fin = row ? parseFinanceConfig(row.config) : null
    const cfg = parseCaseConfig(sel.config)
    // No saved row: the Financials tab opens on the org defaults (spec 01 §2.3 amber, not grey).
    if (!row) financials = { capexZar: 0, hasModel: true, usingOrgDefaults: true, saved: false }
    else if (fin?.ok && cfg.ok) {
      const m = fin.fin.models
      financials = {
        capexZar: capexTotals(fin.fin.capex, cfg.config.pv.dcKwp).exclVatZar,
        hasModel: m.cash.enabled || m.debt.enabled || m.ppa.enabled || m.lease.enabled,
        usingOrgDefaults: fin.fin.capex.length > 0 && fin.fin.capex.every((l) => l.source === 'rate_card'),
      }
    }
  }
  // Reports (Phase 6): green when a feasibility report exists for the selected case's CURRENT run
  // (its source_id); a superseded version for that same run still counts. Null below Edit + financials.
  let reports: { hasCurrentFeasibility: boolean } | null = level === 'edit_financials' ? { hasCurrentFeasibility: false } : null
  if (sel && level === 'edit_financials') {
    const { ok } = await runsByCase(user, projectId)
    const lastOk = ok.get(sel.id)
    if (lastOk) {
      const { data } = await user.schema('projects').from('reports').select('id')
        .eq('project_id', projectId).eq('kind', 'solar_feasibility').eq('source_id', lastOk.id as string).in('status', ['issued', 'superseded']).limit(1)
      reports = { hasCurrentFeasibility: Array.isArray(data) && data.length > 0 }
    }
  }
  // Operations (Phase 7): technical, so every level carries it; null until an installation exists.
  const operations = await loadOperationsReadiness(user, projectId)
  return {
    yield: { caseCount: rows.length, selectedCaseId: sel?.id ?? null, selectedStatus },
    financials,
    reports,
    operations,
    layoutManual: sel?.pv_source === 'manual',
    stale: sel && selectedStatus === 'stale' ? { caseId: sel.id, caseName: sel.name } : null,
  }
}

export interface HeadlineKpis {
  caseId: string; caseName: string
  energy: Pick<RunKpis, 'dcKwp' | 'acKw' | 'batteryKwh' | 'batteryKw' | 'annualAcKwh' | 'specificYieldKwhPerKwp' | 'selfConsumption' | 'solarFraction' | 'exportKwh'>
  money: { billBeforeZar: number; billAfterZar: number; savingZar: number; simplePaybackYears: number | null; irr: number | null; npvZar: number; lcoeZarPerKwh: number | null } | null
}

/** Overview §2.4 — from the selected case's latest succeeded run (and its latest financial result on THAT run). */
export async function loadHeadlineKpis(user: AnyClient, projectId: string, level: SolarAccessLevel, selectedCaseId: string | null): Promise<HeadlineKpis | null> {
  if (!selectedCaseId) return null
  const { data: c } = await user.schema('solar').from('cases').select('id, name').eq('id', selectedCaseId).eq('project_id', projectId).maybeSingle()
  if (!c) return null
  const { ok } = await runsByCase(user, projectId)
  const lastOk = ok.get(selectedCaseId)
  if (!lastOk) return null
  const out = await outputsOf(user, lastOk.id)
  if (!out) return null
  const k = out.kpis
  let money: HeadlineKpis['money'] = null
  if (level === 'edit_financials') {
    const fin = (await latestMoney(user, [selectedCaseId])).get(selectedCaseId)
    const v = headlineView(fin?.results?.finance?.models)
    const b = fin?.results?.year1Bills
    if (fin && v && b && fin.case_run_id === lastOk.id) {
      money = { billBeforeZar: b.beforeZar, billAfterZar: b.afterZar, savingZar: b.beforeZar - b.afterZar, simplePaybackYears: v.simplePaybackYears ?? null, irr: v.irr ?? null, npvZar: v.npvZar, lcoeZarPerKwh: fin.results.finance.lcoeZarPerKwh ?? null }
    }
  }
  return {
    caseId: (c as Row).id, caseName: (c as Row).name,
    energy: { dcKwp: k.dcKwp, acKw: k.acKw, batteryKwh: k.batteryKwh ?? null, batteryKw: k.batteryKw ?? null, annualAcKwh: k.annualAcKwh, specificYieldKwhPerKwp: k.specificYieldKwhPerKwp, selfConsumption: k.selfConsumption, solarFraction: k.solarFraction, exportKwh: k.exportKwh },
    money,
  }
}
