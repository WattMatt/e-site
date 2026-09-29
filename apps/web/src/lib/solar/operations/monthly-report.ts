import 'server-only'
/**
 * Generate one monthly report VERSION (spec §10): the numbers come from the Operations view model
 * (the same code the tab shows), lost revenue from the bill engine, commentary from the notes table.
 * Everything the PDF prints is first frozen into a snapshot; the PDF is rendered from the snapshot;
 * both are stored (projects.reports + solar.monthly_reports). v(n+1) supersedes v(n)'s report row and
 * never edits v(n) — 00217 makes the snapshot table immutable. The caller has already gated Edit +
 * financials; `svc` writes the report tables and the PDF after that gate.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildMonthlySnapshot, dateMonthKey, expectedForMonth, lostHourlyKwh, lostKwh, lostSteps, monthEndMs, monthFirstDay, monthLabel,
  monthlyReportModel, monthStartMs, sourceRows, totalsByMonth, yearToDate, type MonthKey,
} from '@esite/shared/solar-operations'
import { solarBranding } from '@/lib/solar/reports/branding'
import { loadSolarBrandingData } from '@/lib/solar/reports/branding-loader'
import { loadOperationsView } from './data'
import { valueLostEnergy } from './lost-revenue'
import { renderMonthlyReport } from './render-monthly'
import { loadMeterMonths, loadMonthSeries } from './series'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const MONTHLY_ERRORS = {
  noInstallation: 'Record the installation first.',
  store: 'Could not store the report — try again.',
  save: 'Could not save the report — try again.',
  race: 'Someone generated this month at the same time — reload and try again.',
} as const

export interface GenerateMonthlyInput { projectId: string; month: MonthKey; note: string | null; userId: string; user: AnyClient; svc: AnyClient }
export type GenerateMonthlyResult = { ok: true; reportId: string; version: number; warning: string | null } | { ok: false; error: string }

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

export async function generateMonthlyReport(i: GenerateMonthlyInput): Promise<GenerateMonthlyResult> {
  const v = await loadOperationsView({ user: i.user, svc: i.svc, projectId: i.projectId, level: 'edit_financials', month: i.month })
  if (!v.installation || !v.organisationId) return { ok: false, error: MONTHLY_ERRORS.noInstallation }
  // Review B7: a month before commissioning may well have data; "no generation data" would be wrong.
  const commMonth = v.installation.commissioningDate ? dateMonthKey(v.installation.commissioningDate) : null
  if (commMonth && i.month < commMonth) {
    return { ok: false, error: `${monthLabel(i.month)} is before the commissioning month (${monthLabel(commMonth)}).` }
  }
  if (v.selectedMonth !== i.month) return { ok: false, error: `There is no generation data for ${monthLabel(i.month)}.` }
  if (v.monthly?.generateReason) return { ok: false, error: v.monthly.generateReason }
  const row = v.performance.find((r) => r.month === i.month)
  if (!row || !v.guarantee || !v.installation.commissioningDate) return { ok: false, error: `There is no generation data for ${monthLabel(i.month)}.` }
  const inst = v.installation
  const guarantee = v.guarantee
  const commissioningDate = inst.commissioningDate!

  // Lost energy per downtime event inside the month, on the bill engine's hours.
  const points = await loadMonthSeries(i.user, inst.id, 'generation', i.month)
  const fullFor = (k: MonthKey) => expectedForMonth({ month: k, guarantee, baseline: inst.baseline, commissioningDate })?.fullKwh ?? 0
  const m0 = monthStartMs(i.month)
  const m1 = monthEndMs(i.month)
  const events = v.downtime
    .map((d) => ({ d, w0: Math.max(Date.parse(d.startsAt), m0), w1: Math.min(Date.parse(d.endsAt), m1) }))
    .filter((x) => x.w1 > x.w0)
    .map((x) => ({ ...x, steps: lostSteps({ startMs: x.w0, endMs: x.w1 }, points, inst.baseline, fullFor) }))
  const valuation = await valueLostEnergy(i.svc, i.projectId, i.month, events.map((e) => lostHourlyKwh(e.steps)))
  if (!valuation.ok) return { ok: false, error: valuation.reason }

  const [genMonths, consMonths, { data: proj }] = await Promise.all([
    loadMeterMonths(i.user, inst.id, 'generation'),
    loadMeterMonths(i.user, inst.id, 'consumption'),
    i.svc.schema('projects').from('projects').select('name').eq('id', i.projectId).maybeSingle(),
  ])
  const consumptionMeters = v.meters.filter((m) => m.role === 'consumption')
  const generatedAt = new Date().toISOString()
  const snapshot = buildMonthlySnapshot({
    period: i.month, generatedAt, projectName: String((proj as Row | null)?.name ?? ''), commissioningDate,
    asBuilt: inst.asBuilt, baseline: inst.baseline, guarantee, performance: row,
    sources: sourceRows(v.meters.filter((m) => m.role === 'generation'), genMonths, i.month, row.guaranteeKwh),
    downtime: events.map((e, k) => ({
      startsAt: new Date(e.w0).toISOString(), endsAt: new Date(e.w1).toISOString(), cause: e.d.cause, description: e.d.description,
      excludedFromGuarantee: e.d.excludedFromGuarantee, source: e.d.source, lostKwh: lostKwh(e.steps), lostZar: valuation.perEventZar[k] ?? null,
    })),
    lostZarTotal: valuation.totalZar,
    tariff: { name: valuation.tariffName },
    ytd: yearToDate(v.performance, i.month),
    consumption: {
      gridKwh: consumptionMeters.length > 0 ? (totalsByMonth(consMonths)[i.month]?.kwh ?? null) : null,
      meterLabels: consumptionMeters.map((m) => m.label),
    },
    notes: v.monthly?.notes ?? {},
  })
  const model = monthlyReportModel(snapshot)
  const { branding, warning } = solarBranding(await loadSolarBrandingData(i.svc, i.projectId), { title: model.title, kicker: model.kicker, date: generatedAt.slice(0, 10) })
  const pdf = new Uint8Array(await renderMonthlyReport(model, branding))
  const pdfSha = sha256(pdf)
  const snapSha = sha256(JSON.stringify(snapshot))

  const { data: prior } = await i.svc.schema('solar').from('monthly_reports').select('version, report_id')
    .eq('installation_id', inst.id).eq('period_month', monthFirstDay(i.month)).order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as Row).version) + 1 : 1
  // Under solar-reports/ (as Phase 6's `<kind>-v…` files): 00216's RESTRICTIVE storage and projects.reports
  // policies make that directory service-only, and the URL action maps the `solar_monthly-` file name back
  // to its kind before it signs. A new directory would sit outside both guards.
  const storagePath = `${v.organisationId}/${i.projectId}/solar-reports/solar_monthly-${i.month}-v${version}-${snapSha.slice(0, 12)}.pdf`
  const { error: upErr } = await i.svc.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { ok: false, error: MONTHLY_ERRORS.store }

  // The kind is written as a LITERAL: report-kind-access.contract.test.ts finds writers by scanning for it.
  const { data: rep, error: insErr } = await i.svc.schema('projects').from('reports').insert({
    organisation_id: v.organisationId, project_id: i.projectId, kind: 'solar_monthly',
    source_table: 'solar.installations', source_id: inst.id, title: model.title,
    storage_path: storagePath, mime_type: 'application/pdf', size_bytes: pdf.length,
    status: 'issued', version, summary: model.summary, note: i.note, generated_by: i.userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await i.svc.storage.from('reports').remove([storagePath])
    return { ok: false, error: MONTHLY_ERRORS.save }
  }
  const { error: snapErr } = await i.svc.schema('solar').from('monthly_reports').insert({
    installation_id: inst.id, period_month: monthFirstDay(i.month), version, report_id: reportId,
    snapshot, snapshot_sha256: snapSha, pdf_sha256: pdfSha, generated_by: i.userId,
  })
  if (snapErr) {
    await i.svc.schema('projects').from('reports').delete().eq('id', reportId)
    await i.svc.storage.from('reports').remove([storagePath])
    return { ok: false, error: snapErr.code === '23505' ? MONTHLY_ERRORS.race : MONTHLY_ERRORS.save }
  }
  const priorReportId = (prior as Row | null)?.report_id as string | undefined
  if (priorReportId) await i.svc.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', priorReportId)
  return { ok: true, reportId, version, warning }
}
