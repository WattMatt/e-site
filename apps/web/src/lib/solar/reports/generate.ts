import 'server-only'
/**
 * Generate a feasibility (money) or technical (no money) report from the SELECTED case's stored run
 * (spec §9.2). Never recomputes: the model is built from case_runs.outputs and, for feasibility,
 * the latest case_run_financials row FOR THAT RUN. Stored as the next version in projects.reports
 * (supersede chain), source = the run, so "a feasibility report exists for the current run" is a
 * lookup. The caller has already gated the Solar level; `svc` is used only after that gate.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { buildSolarReportModel, type SolarReportMoney } from '@esite/shared/solar-reports'
import { latestMoney } from '@/lib/solar/cases/page-data'
import { loadSelectedCase } from './selected-case'
import { loadSolarBrandingData } from './branding-loader'
import { solarBranding } from './branding'
import { renderSolarReport } from './render-report'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface GenerateReportInput {
  projectId: string
  kind: 'feasibility' | 'technical'
  note: string | null
  options: { includeLayoutSheet: boolean; include8760: boolean }
  userId: string
  user: AnyClient
  svc: AnyClient
}
export type GenerateReportResult = { ok: true; reportId: string; version: number; warning: string | null } | { ok: false; error: string }

export const REPORT_ERRORS = {
  noFinancials: 'Run financials for the selected case first (Financials tab).',
  manualCase: 'This case uses a manual system size, so there is no layout sheet to attach.',
  noSheet: 'Export a layout sheet on the Layout tab first.',
  sheetUnreadable: 'The layout sheet could not be read — export it again.',
  store: 'Could not store the report — try again.',
  save: 'Could not save the report — try again.',
} as const

async function appendPdf(base: Uint8Array, extra: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base)
  const src = await PDFDocument.load(extra)
  for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p)
  return doc.save()
}

export async function generateSolarReport(i: GenerateReportInput): Promise<GenerateReportResult> {
  const sel = await loadSelectedCase(i.user, i.svc, i.projectId)
  if (!sel.ok) return { ok: false, error: sel.reason }
  const { caseRow, run, shared } = sel

  let money: SolarReportMoney | null = null
  if (i.kind === 'feasibility') {
    const fin = (await latestMoney(i.user, [caseRow.id])).get(caseRow.id) as Row | undefined
    if (!fin || fin.case_run_id !== run.id) return { ok: false, error: REPORT_ERRORS.noFinancials }
    const r = fin.results as Omit<SolarReportMoney, 'tariffName'>
    const t = run.outputs.provenance.tariffRef
    money = { ...r, tariffName: t ? `${t.tariffName} (${t.licenseeName}, ${t.financialYear})` : null }
  }

  let sheet: Uint8Array | null = null
  if (i.options.includeLayoutSheet) {
    if (caseRow.pv_source !== 'layout' || !caseRow.layout_id) return { ok: false, error: REPORT_ERRORS.manualCase }
    // Through the caller's session: the kind gate (View) decides whether they may use the sheet.
    const { data: s } = await i.user.schema('projects').from('reports').select('id, storage_path')
      .eq('project_id', i.projectId).eq('kind', 'solar_layout_sheet').eq('source_id', caseRow.layout_id).eq('status', 'issued')
      .order('version', { ascending: false }).limit(1).maybeSingle()
    if (!s) return { ok: false, error: REPORT_ERRORS.noSheet }
    const { data: blob } = await i.svc.storage.from('reports').download(String((s as Row).storage_path))
    if (!blob) return { ok: false, error: REPORT_ERRORS.sheetUnreadable }
    sheet = new Uint8Array(await blob.arrayBuffer())
  }

  const [{ data: proj }, { data: studyExtra }, { data: tpl }] = await Promise.all([
    i.svc.schema('projects').from('projects').select('name, address, city, province').eq('id', i.projectId).maybeSingle(),
    i.svc.schema('solar').from('studies').select('licensee_name').eq('project_id', i.projectId).maybeSingle(),
    i.svc.schema('solar').from('proposal_templates').select('disclaimer_text').eq('organisation_id', shared.study.organisation_id).maybeSingle(),
  ])
  const p = (proj ?? {}) as { name?: string; address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const st = shared.study as unknown as Row
  const generatedAt = new Date().toISOString()

  const model = buildSolarReportModel({
    kind: i.kind, projectName: p.name ?? '', address, caseName: caseRow.name,
    site: {
      latitude: st.latitude === null || st.latitude === undefined ? null : Number(st.latitude),
      longitude: st.longitude === null || st.longitude === undefined ? null : Number(st.longitude),
      licenseeName: ((studyExtra as Row | null)?.licensee_name as string | null) ?? null,
      nmdKva: st.nmd_kva === null || st.nmd_kva === undefined ? null : Number(st.nmd_kva),
      exportMode: (st.export_mode as string | null) ?? null,
      exportLimitKw: st.export_limit_kw === null || st.export_limit_kw === undefined ? null : Number(st.export_limit_kw),
    },
    run: { id: run.id, finishedAt: run.finishedAt, outputs: run.outputs },
    money,
    options: { layoutSheetAttached: sheet !== null, include8760: i.options.include8760 },
    disclaimer: ((tpl as Row | null)?.disclaimer_text as string | undefined) ?? '',
    generatedAt,
  })
  const { branding, warning } = solarBranding(await loadSolarBrandingData(i.svc, i.projectId), { title: model.title, kicker: model.kicker, date: generatedAt.slice(0, 10) })

  let pdf: Uint8Array = new Uint8Array(await renderSolarReport(model, branding))
  if (sheet) {
    try { pdf = await appendPdf(pdf, sheet) } catch { return { ok: false, error: REPORT_ERRORS.sheetUnreadable } }
  }

  // The kind is written as a LITERAL at each .from('reports') call on purpose:
  // report-kind-access.contract.test.ts finds writers by scanning for them.
  const priorQuery = i.kind === 'feasibility'
    ? i.svc.schema('projects').from('reports').select('id, version').eq('project_id', i.projectId).eq('kind', 'solar_feasibility').eq('status', 'issued')
    : i.svc.schema('projects').from('reports').select('id, version').eq('project_id', i.projectId).eq('kind', 'solar_technical').eq('status', 'issued')
  const { data: prior } = await priorQuery.order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as Row).version) + 1 : 1
  const kind = i.kind === 'feasibility' ? 'solar_feasibility' : 'solar_technical'

  const storagePath = `${shared.study.organisation_id}/${i.projectId}/solar-reports/${kind}-v${version}-${run.id}.pdf`
  const { error: upErr } = await i.svc.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { ok: false, error: REPORT_ERRORS.store }
  const { data: rep, error: insErr } = await i.svc.schema('projects').from('reports').insert({
    organisation_id: shared.study.organisation_id,
    project_id: i.projectId,
    kind,
    source_table: 'solar.case_runs',
    source_id: run.id,
    title: `${model.title} — ${caseRow.name}`,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version,
    summary: model.summary,
    note: i.note,
    generated_by: i.userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await i.svc.storage.from('reports').remove([storagePath])
    return { ok: false, error: REPORT_ERRORS.save }
  }
  if (prior) await i.svc.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', (prior as Row).id as string)
  return { ok: true, reportId, version, warning }
}
