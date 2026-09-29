import 'server-only'
/**
 * Build the frozen proposal snapshot (spec §9.3) from the SELECTED case's stored run. Finance options
 * are the engine's (D-15), computed on the STORED hourly series at the offer price — the 4b
 * runStoredFinancials path, not a re-simulation. Used by Preview (watermarked) and Issue (frozen).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildFinanceInput, financeCaseConfig, financeInputReasons, capexTotals, decodeHourlyCsv, parseCaseConfig, parseFinanceConfig, runStoredFinancials,
} from '@esite/shared/solar-cases'
import { inputsHash } from '@esite/shared/solar-engine'
import {
  FINANCE_OPTION_LABELS, buildProposalSnapshot, offerBaseZar, offerPrice, parseProposalDraft, proposalFinanceInput,
  summariseFinanceOptions, type ProposalSnapshot,
} from '@esite/shared/solar-reports'
import { loadSelectedCase } from '@/lib/solar/reports/selected-case'
import { resolveStudyTariff } from '@/lib/solar/cases/tariff'
import { getGzipText, RUNS_BUCKET } from '@/lib/solar/cases/storage'
import { pdfText } from '@/lib/solar/reports/pdf-text'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const PREPARE_ERRORS = {
  incomplete: 'The proposal is incomplete — check the highlighted fields.',
  caseChanged: 'The selected case changed since this draft was saved — save the draft again to use it.',
  noFinancials: 'Save the Financials tab for the selected case first.',
  badFinancials: 'The saved financials are invalid — review them on the Financials tab.',
  badRun: 'The run’s stored configuration could not be read — re-run the case.',
  badCase: 'The selected case’s saved settings could not be read — open it on Yield & Scenarios, check each section and save it again.',
  noCapex: 'Add capex on the Financials tab first.',
  compute: 'The finance options could not be computed — try again.',
} as const

export interface PrepareInput {
  user: AnyClient
  svc: AnyClient
  projectId: string
  proposal: { id: string; family_id: string; version: number; case_id: string | null; draft: unknown }
  actor: { id: string; name: string; email: string | null }
  issuedAt: Date
}
export type PrepareResult =
  | { ok: true; snapshot: ProposalSnapshot; runId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export async function prepareProposalSnapshot(a: PrepareInput): Promise<PrepareResult> {
  const sel = await loadSelectedCase(a.user, a.svc, a.projectId)
  if (!sel.ok) return { ok: false, error: sel.reason }
  if (a.proposal.case_id !== sel.caseRow.id) return { ok: false, error: PREPARE_ERRORS.caseChanged }
  const d = parseProposalDraft(a.proposal.draft)
  if (!d.ok) return { ok: false, error: PREPARE_ERRORS.incomplete, fieldErrors: d.errors }
  const draft = d.draft

  const { data: finRows } = await a.user.schema('solar').from('case_financials').select('config').eq('case_id', sel.caseRow.id)
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  if (!finRow) return { ok: false, error: PREPARE_ERRORS.noFinancials }
  const fin = parseFinanceConfig(finRow.config)
  if (!fin.ok) return { ok: false, error: PREPARE_ERRORS.badFinancials }
  const cfg = parseCaseConfig(sel.run.configSnapshot)
  if (!cfg.ok) return { ok: false, error: PREPARE_ERRORS.badRun }
  // YF-01: degradation / load shedding are the case's current values, as Run financials prices them.
  const current = parseCaseConfig(sel.caseRow.config)
  if (!current.ok) return { ok: false, error: PREPARE_ERRORS.badCase }
  const k = sel.run.outputs.kpis

  const base = offerBaseZar(capexTotals(fin.fin.capex, k.dcKwp))
  if (!(base > 0)) return { ok: false, error: PREPARE_ERRORS.noCapex }
  const price = offerPrice(base, draft.marginPct)

  const early = financeInputReasons(fin.fin, { dcKwp: k.dcKwp })
  if (early.length > 0) return { ok: false, error: early.join(' ') }
  // The same tariff year and study pricing the Financials run used (executeFinancialsRun): tariff
  // escalation (Tariff tab) and load growth (Load tab) are the study's, never the case config's.
  const year = Number(sel.run.outputs.provenance?.loadReferenceYear)
  const tariff = await resolveStudyTariff(a.svc, a.projectId, { year: Number.isInteger(year) && year > 0 ? year : undefined })
  if (!tariff.ok) return { ok: false, error: tariff.reason }
  const built = buildFinanceInput(fin.fin, financeCaseConfig(cfg.config, current.config), { dcKwp: k.dcKwp, acKw: k.acKw }, tariff.pricing)
  if (!built.ok) return { ok: false, error: built.reasons.join(' ') }
  const priced = proposalFinanceInput(built.input, price.offerExclVatZar, draft.financeOptions)
  if (!priced.ok) {
    return { ok: false, error: `Enable ${priced.missing.map((m) => FINANCE_OPTION_LABELS[m]).join(', ')} on the Financials tab first — its inputs live there.` }
  }
  const exportCredited = (sel.run.exportSettings as { credited?: unknown } | null | undefined)?.credited !== false && tariff.pricing.exportCredited

  let options: ReturnType<typeof summariseFinanceOptions>
  let bills: { beforeZar: number; afterZar: number }
  try {
    const hourly = decodeHourlyCsv(await getGzipText(a.svc, RUNS_BUCKET, sel.run.hourlyPath))
    const result = runStoredFinancials({ hourly, year1PvKwh: k.annualAcKwh, year1DeliveredKwh: k.deliveredKwh, exportCredited }, priced.input, tariff.calc)
    options = summariseFinanceOptions(result.finance, priced.input.models)
    bills = { beforeZar: result.year1Bills.beforeZar, afterZar: result.year1Bills.afterZar }
  } catch (e) {
    console.error('[solar-proposal] finance failed', { projectId: a.projectId, err: String(e) })
    return { ok: false, error: PREPARE_ERRORS.compute }
  }

  const [{ data: proj }, { data: org }, { data: tpl }] = await Promise.all([
    a.svc.schema('projects').from('projects').select('name, address, city, province').eq('id', a.projectId).maybeSingle(),
    a.svc.from('organisations').select('name').eq('id', sel.shared.study.organisation_id).maybeSingle(),
    a.svc.schema('solar').from('proposal_templates').select('disclaimer_text').eq('organisation_id', sel.shared.study.organisation_id).maybeSingle(),
  ])
  const p = (proj ?? {}) as { name?: string; address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const validUntil = new Date(a.issuedAt.getTime() + draft.validityDays * 86_400_000).toISOString()

  const snapshot = buildProposalSnapshot({
    proposal: { id: a.proposal.id, familyId: a.proposal.family_id, version: a.proposal.version, title: `Solar PV proposal for ${draft.clientName}`, issuedAt: a.issuedAt.toISOString(), validUntil },
    issuer: { orgName: ((org as Row | null)?.name as string | undefined) ?? 'Organisation', proposerName: a.actor.name, proposerEmail: a.actor.email },
    project: { name: p.name ?? '', address },
    case: { id: sel.caseRow.id, name: sel.caseRow.name, runId: sel.run.id, inputsHash: sel.run.inputsHash, engineVersion: sel.run.outputs.provenance.engineVersion, runFinishedAt: sel.run.finishedAt },
    kpis: k, price, bills, financeOptions: options, draft,
    disclaimer: ((tpl as Row | null)?.disclaimer_text as string | undefined) ?? '',
    provenance: { financeInputsHash: inputsHash({ input: priced.input, tariffRef: tariff.tariffRef, runId: sel.run.id }), tariff: tariff.tariffRef },
  }, pdfText)
  return { ok: true, snapshot, runId: sel.run.id }
}
