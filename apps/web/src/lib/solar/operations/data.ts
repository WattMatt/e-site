import 'server-only'
/**
 * The Operations tab's view model (spec §10), read through the CALLER'S session so RLS decides every
 * row. The service client is used only for the accepted-proposal lookup (a status and a version, no
 * money) and the tariff check, after the page's gate. The result is JSON: it crosses into client
 * components.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OperationsReadinessInput, SolarAccessLevel } from '@esite/shared'
import {
  dateMonthKey, detectDowntimeCandidates, equipmentComplete, expectedForMonth, guaranteeFromRow, handoverCompletion,
  isMonthKey, lostKwh, lostSteps, monthEndMs, monthLabel, monthParts, monthRange, monthStartMs, NOTE_SECTIONS, parseAsBuilt,
  performanceRows, plantSeries, readBaseline, shareTotalNote, templateFromRow, totalsByMonth,
  type AsBuilt, type DowntimeCandidate, type DowntimeRecord, type Guarantee, type HandoverCompletion,
  type IrradiationRecord, type MonthKey, type NoteSection, type OpsBaseline, type PerformanceRow,
} from '@esite/shared/solar-operations'
import { resolveStudyTariff } from '@/lib/solar/cases/tariff'
import { acceptedProposal, INSTALL_REASONS } from './baseline-loader'
import { loadMeterMonths, loadMonthSeries, monthsWithData } from './series'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface OpsMeterView { meterId: string; label: string; kind: string; role: 'generation' | 'consumption'; sharePct: number | null }
export interface OpsAvailableMeter { meterId: string; label: string; kind: string }
export interface OpsDowntimeView extends DowntimeRecord { updatedAt: string; lostKwh: number | null }
export interface OpsHandoverItemView {
  id: string; key: string; label: string; required: boolean; sortOrder: number
  documentId: string | null; documentName: string | null; notApplicable: boolean; note: string | null
  completedAt: string | null; updatedAt: string
}
export interface OpsInstallationView {
  id: string; commissioningDate: string | null; asBuilt: AsBuilt; notes: string | null; updatedAt: string; baseline: OpsBaseline
  /** Σ of the baseline's 12 monthly P50 kWh, computed here so the browser formats but never adds. */
  annualP50Kwh: number
}
export interface OpsMonthlyView {
  notes: Record<NoteSection, string>
  notesUpdatedAt: Record<NoteSection, string | null>
  generateReason: string | null
  tariffName: string | null
}
export interface OperationsView {
  level: SolarAccessLevel
  canEdit: boolean
  canSeeMoney: boolean
  studyId: string | null
  organisationId: string | null
  setupReason: string | null
  /** Where the setup reason can be resolved (a link on the card), or null. */
  setupAction: { href: string; label: string } | null
  acceptedProposal: { id: string; version: number } | null
  installation: OpsInstallationView | null
  meters: OpsMeterView[]
  availableMeters: OpsAvailableMeter[]
  guarantee: (Guarantee & { updatedAt: string }) | null
  irradiation: IrradiationRecord[]
  downtime: OpsDowntimeView[]
  months: MonthKey[]
  selectedMonth: MonthKey | null
  performance: PerformanceRow[]
  /** Why the performance table is empty when the generic hint would mislead, or null. */
  performanceNote: string | null
  /** A sentence when the generation meters' expected shares do not add to 100 %, or null. */
  shareNote: string | null
  candidates: DowntimeCandidate[]
  handover: { items: OpsHandoverItemView[]; completion: HandoverCompletion; documents: Array<{ id: string; name: string }>; templateName: string }
  monthly: OpsMonthlyView | null
  readiness: OperationsReadinessInput | null
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const OPS_METER_KINDS = ['solar', 'council', 'bulk']

function setupActionFor(projectId: string, reason: string | null): OperationsView['setupAction'] {
  // Plan decision 3: "no accepted proposal" points at the tab where a proposal is accepted (review B7).
  if (reason === INSTALL_REASONS.noAccepted) return { href: `/projects/${projectId}/solar/reports`, label: 'Open Reports & Proposal' }
  if (reason === INSTALL_REASONS.noStudy) return { href: `/projects/${projectId}/solar/site`, label: 'Open Site & Supply' }
  return null
}

function emptyView(level: SolarAccessLevel, projectId: string, studyId: string | null, orgId: string | null, setupReason: string | null,
  accepted: { id: string; version: number } | null): OperationsView {
  return {
    level, canEdit: level !== 'view', canSeeMoney: level === 'edit_financials',
    studyId, organisationId: orgId, setupReason, setupAction: setupActionFor(projectId, setupReason), acceptedProposal: accepted, installation: null,
    meters: [], availableMeters: [], guarantee: null, irradiation: [], downtime: [], months: [], selectedMonth: null,
    performance: [], performanceNote: null, shareNote: null, candidates: [],
    handover: { items: [], completion: handoverCompletion([]), documents: [], templateName: '' },
    monthly: null, readiness: null,
  }
}

export async function loadOperationsView(a: {
  user: AnyClient; svc: AnyClient; projectId: string; level: SolarAccessLevel; month: string | null
}): Promise<OperationsView> {
  const canEdit = a.level !== 'view'
  const canSeeMoney = a.level === 'edit_financials'
  const solar = () => a.user.schema('solar')

  const { data: study } = await solar().from('studies').select('id, organisation_id, latitude, longitude, elevation_m')
    .eq('project_id', a.projectId).maybeSingle()
  if (!study) return emptyView(a.level, a.projectId, null, null, INSTALL_REASONS.noStudy, null)
  const s = study as Row
  const studyId = String(s.id)
  const orgId = String(s.organisation_id)

  const { data: inst } = await solar().from('installations').select('id, commissioning_date, baseline, as_built, notes, updated_at')
    .eq('study_id', studyId).maybeSingle()
  if (!inst) {
    const accepted = await acceptedProposal(a.svc, studyId)
    return emptyView(a.level, a.projectId, studyId, orgId, accepted ? null : INSTALL_REASONS.noAccepted, accepted ? { id: accepted.id, version: accepted.version } : null)
  }
  const i = inst as Row
  const installationId = String(i.id)
  const baseline = readBaseline(i.baseline)
  // A stored baseline the reader cannot use is shown as a sentence, never thrown (review A1).
  if (!baseline) return emptyView(a.level, a.projectId, studyId, orgId, INSTALL_REASONS.baselineUnreadable, null)
  const parsed = parseAsBuilt(i.as_built)
  const asBuilt: AsBuilt = parsed.ok ? parsed.value
    : { dcKwp: baseline.dcKwp, acKw: baseline.acKw, batteryKwh: null, batteryKw: null, tiltDeg: null, azimuthDeg: null, equipment: [] }
  const commissioningDate = (i.commissioning_date as string | null) ?? null

  const [links, studyMeters, gRes, irrRes, dtRes, itemRes, tplRes, docRes, genMonths] = await Promise.all([
    solar().from('installation_meters').select('meter_id, role, expected_share_pct').eq('installation_id', installationId),
    solar().from('study_meters').select('meter_id').eq('study_id', studyId),
    solar().from('guarantees').select('basis, pct, manual_monthly_kwh, degradation_pct_per_year, updated_at').eq('installation_id', installationId).maybeSingle(),
    solar().from('ops_irradiation').select('month, plane, kwh_per_m2, source_note').eq('installation_id', installationId),
    solar().from('downtime').select('id, starts_at, ends_at, cause, description, excluded_from_guarantee, source, updated_at')
      .eq('installation_id', installationId).order('starts_at', { ascending: true }),
    solar().from('handover_items').select('id, item_key, label, required, sort_order, document_id, not_applicable, note, completed_at, updated_at')
      .eq('installation_id', installationId).order('sort_order', { ascending: true }),
    solar().from('handover_templates').select('name, items').eq('organisation_id', orgId).maybeSingle(),
    a.user.schema('tenants').from('documents').select('id, name').eq('project_id', a.projectId).order('name', { ascending: true }),
    loadMeterMonths(a.user, installationId, 'generation'),
  ])

  const linkRows = (links.data ?? []) as Row[]
  const meterIds = [...new Set([...linkRows.map((r) => String(r.meter_id)), ...((studyMeters.data ?? []) as Row[]).map((r) => String(r.meter_id))])]
  const { data: meterRows } = meterIds.length > 0
    ? await solar().from('meters').select('id, label, kind').in('id', meterIds)
    : { data: [] as Row[] }
  const meterById = new Map(((meterRows ?? []) as Row[]).map((m) => [String(m.id), m]))
  const meters: OpsMeterView[] = linkRows.map((r) => {
    const m = meterById.get(String(r.meter_id))
    return { meterId: String(r.meter_id), label: String(m?.label ?? 'Meter'), kind: String(m?.kind ?? 'unknown'),
      role: r.role as OpsMeterView['role'], sharePct: num(r.expected_share_pct) }
  })
  const linked = new Set(meters.map((m) => m.meterId))
  const availableMeters: OpsAvailableMeter[] = [...meterById.values()]
    .filter((m) => !linked.has(String(m.id)) && OPS_METER_KINDS.includes(String(m.kind)))
    .map((m) => ({ meterId: String(m.id), label: String(m.label), kind: String(m.kind) }))
    .sort((x, y) => x.label.localeCompare(y.label))

  const guarantee = gRes.data ? { ...guaranteeFromRow(gRes.data as Row), updatedAt: String((gRes.data as Row).updated_at) } : null
  const irradiation: IrradiationRecord[] = ((irrRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month).slice(0, 7), plane: r.plane as 'ghi' | 'poa', kwhPerM2: Number(r.kwh_per_m2), sourceNote: String(r.source_note),
  }))
  const dtRows = (dtRes.data ?? []) as Row[]
  const downtimeBase: DowntimeRecord[] = dtRows.map((r) => ({
    id: String(r.id), startsAt: String(r.starts_at), endsAt: String(r.ends_at), cause: String(r.cause),
    description: (r.description as string | null) ?? null, excludedFromGuarantee: Boolean(r.excluded_from_guarantee),
    source: r.source as DowntimeRecord['source'],
  }))

  const months = monthsWithData(genMonths)
  const selectedMonth = a.month && isMonthKey(a.month) && months.includes(a.month) ? a.month : (months[months.length - 1] ?? null)
  const genCount = meters.filter((m) => m.role === 'generation').length
  const performance = guarantee && commissioningDate
    ? performanceRows({
        months: monthRange(dateMonthKey(commissioningDate), months[months.length - 1] ?? dateMonthKey(commissioningDate)),
        baseline, guarantee, commissioningDate, dcKwp: asBuilt.dcKwp, actual: totalsByMonth(genMonths),
        generationMeterCount: genCount, downtime: downtimeBase, irradiation,
      })
    : []
  const lastDataMonth = months[months.length - 1] ?? null
  // Review B7: data that all predates commissioning is not "no data"; say which date is the problem.
  // Review round 2: with a date and data, an empty table means the guarantee is missing; say that,
  // not the generic "set the commissioning date and import generation data".
  const performanceNote = commissioningDate && lastDataMonth && dateMonthKey(commissioningDate) > lastDataMonth
    ? `The commissioning date (${commissioningDate}) is after the last month with generation data (${monthLabel(lastDataMonth)}), so there is nothing to compare yet.`
    : commissioningDate && lastDataMonth && !guarantee
      ? 'No guarantee basis has been saved yet — set it on the Guarantee card to see monthly performance.'
      : null
  const shareNote = shareTotalNote(meters.filter((m) => m.role === 'generation'))

  let candidates: DowntimeCandidate[] = []
  const lostById = new Map<string, number>()
  if (selectedMonth) {
    const points = await loadMonthSeries(a.user, installationId, 'generation', selectedMonth)
    const lat = num(s.latitude)
    const lng = num(s.longitude)
    if (canEdit && lat !== null && lng !== null) {
      // One plant series: meters on different intervals arrive as separate spans (review B1).
      candidates = detectDowntimeCandidates(plantSeries(points), { latitude: lat, longitude: lng, elevationM: num(s.elevation_m) ?? 0 }, asBuilt.acKw,
        downtimeBase.map((d) => ({ startMs: Date.parse(d.startsAt), endMs: Date.parse(d.endsAt) })))
    }
    if (guarantee && commissioningDate) {
      const fullFor = (k: MonthKey) => expectedForMonth({ month: k, guarantee, baseline, commissioningDate })?.fullKwh ?? 0
      const m0 = monthStartMs(selectedMonth)
      const m1 = monthEndMs(selectedMonth)
      for (const d of downtimeBase) {
        const w0 = Math.max(Date.parse(d.startsAt), m0)
        const w1 = Math.min(Date.parse(d.endsAt), m1)
        if (w1 > w0) lostById.set(d.id, Math.round(lostKwh(lostSteps({ startMs: w0, endMs: w1 }, points, baseline, fullFor)) * 1000) / 1000)
      }
    }
  }
  const downtime: OpsDowntimeView[] = downtimeBase.map((d, k) => ({ ...d, updatedAt: String(dtRows[k]!.updated_at), lostKwh: lostById.get(d.id) ?? null }))

  const documents = ((docRes.data ?? []) as Row[]).map((d) => ({ id: String(d.id), name: String(d.name) }))
  const docName = new Map(documents.map((d) => [d.id, d.name]))
  const items: OpsHandoverItemView[] = ((itemRes.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), key: String(r.item_key), label: String(r.label), required: Boolean(r.required), sortOrder: Number(r.sort_order),
    documentId: (r.document_id as string | null) ?? null,
    documentName: r.document_id ? (docName.get(String(r.document_id)) ?? 'Document not visible to you') : null,
    notApplicable: Boolean(r.not_applicable), note: (r.note as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null, updatedAt: String(r.updated_at),
  }))
  const template = templateFromRow((tplRes.data as { name: unknown; items: unknown } | null) ?? null)

  let monthly: OpsMonthlyView | null = null
  if (canSeeMoney) {
    const notes = Object.fromEntries(NOTE_SECTIONS.map((k) => [k, ''])) as Record<NoteSection, string>
    const notesUpdatedAt = Object.fromEntries(NOTE_SECTIONS.map((k) => [k, null])) as Record<NoteSection, string | null>
    if (selectedMonth) {
      const { data: noteRows } = await solar().from('monthly_report_notes').select('section, body, updated_at')
        .eq('installation_id', installationId).eq('period_month', `${selectedMonth}-01`)
      for (const r of (noteRows ?? []) as Row[]) {
        const k = r.section as NoteSection
        if ((NOTE_SECTIONS as readonly string[]).includes(k)) { notes[k] = String(r.body); notesUpdatedAt[k] = String(r.updated_at) }
      }
    }
    let generateReason: string | null = null
    let tariffName: string | null = null
    if (!selectedMonth) generateReason = 'Import generation data first.'
    else if (!commissioningDate) generateReason = 'Set the commissioning date first.'
    else if (!guarantee) generateReason = 'Save a guarantee basis first.'
    else {
      const eq = equipmentComplete(asBuilt)
      if (!eq.ok) generateReason = eq.reason
    }
    if (!generateReason && selectedMonth) {
      const mp = monthParts(selectedMonth)
      // The report month's financial year, as valueLostEnergy prices it (TARIFF-12).
      const t = await resolveStudyTariff(a.svc, a.projectId, { year: mp.year, todayIso: `${mp.year}-${String(mp.month).padStart(2, '0')}-01` })
      if (!t.ok) generateReason = t.reason
      else tariffName = `${t.tariffRef.tariffName} (${t.tariffRef.licenseeName}, ${t.tariffRef.financialYear})`
    }
    monthly = { notes, notesUpdatedAt, generateReason, tariffName }
  }

  return {
    level: a.level, canEdit, canSeeMoney, studyId, organisationId: orgId, setupReason: null, setupAction: null, acceptedProposal: null,
    installation: {
      id: installationId, commissioningDate, asBuilt, notes: (i.notes as string | null) ?? null, updatedAt: String(i.updated_at), baseline,
      annualP50Kwh: Math.round(baseline.monthlyKwh.reduce((t, v) => t + v, 0)),
    },
    meters, availableMeters, guarantee, irradiation, downtime, months, selectedMonth, performance, performanceNote, shareNote, candidates,
    handover: { items, completion: handoverCompletion(items), documents, templateName: template.name },
    monthly,
    readiness: { installed: true, commissioningDate, monthsWithData: months.length },
  }
}

/** The light read the tab dots use (loadSolarReadinessExtra). */
export async function loadOperationsReadiness(user: AnyClient, projectId: string): Promise<OperationsReadinessInput | null> {
  const { data: study } = await user.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle()
  if (!study) return null
  const { data: inst } = await user.schema('solar').from('installations').select('id, commissioning_date').eq('study_id', String((study as Row).id)).maybeSingle()
  if (!inst) return null
  const i = inst as Row
  // A failed read counts as no months (the dots are advisory; the tab itself surfaces the error).
  let months: number
  try {
    months = monthsWithData(await loadMeterMonths(user, String(i.id), 'generation')).length
  } catch {
    months = 0
  }
  return { installed: true, commissioningDate: (i.commissioning_date as string | null) ?? null, monthsWithData: months }
}
