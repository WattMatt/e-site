/**
 * site-form-report-data.ts
 *
 * Pure data-gathering layer for the Site Form (termination & making-safe)
 * branded PDF. Mirrors snag-visit-report-data.ts + inspection-report-data.ts:
 *
 *   - RBAC gate via requireEffectiveRole on the CALLER's cookie client, BEFORE
 *     any service-role read (inspection-report-data.ts step 2).
 *   - All DB reads afterwards go through createServiceClient, because
 *     public.profiles RLS (migration 00009) returns only the viewer's own row,
 *     so names of other people would otherwise render blank.
 *   - EVERY image — photo, signature, logo — is embedded as a `data:` URI.
 *     react-pdf's <Image> fetches a URL server-side with no timeout and fails
 *     SILENTLY, so a signed URL here would produce a report with invisible
 *     holes and no error. This is the inverse of the email rule, where `data:`
 *     URIs are stripped by webmail and signed URLs are mandatory.
 *
 * Returns a plain, serialisable object: no react-pdf and no Supabase row types
 * leak out, so the document component can be unit-tested from a fixture.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { resolveBranding, type ResolvedBranding } from './branding'
import {
  asLeftStatusLabel,
  parseRepeatingGroupKey,
  listRepeatingGroupEntryIndices,
} from '@esite/shared'

// ---------------------------------------------------------------------------
// Public, serialisable payload shape
// ---------------------------------------------------------------------------

export interface SiteFormReportPhoto {
  id: string
  /** data:image/...;base64,… — never a signed URL (see file header). */
  dataUri: string
  /** Pre-joined "caption · date · gps · by name" band; may be ''. */
  caption: string
}

export interface SiteFormPhotoField {
  sectionId: string
  fieldId: string
  /** "<Section title> — <Field label>", entry-aware for repeating groups. */
  label: string
  photos: SiteFormReportPhoto[]
  /** Photos beyond MAX_PHOTOS_PER_FIELD, summarised rather than rendered. */
  omittedCount: number
  /**
   * Photos that exist in the database but whose download failed (moved object,
   * transient storage error, bad path). Counted SEPARATELY from omittedCount and
   * surfaced in the document: silently dropping them would turn missing evidence
   * into an unqualified "no photographs captured".
   *
   * Optional purely so hand-written fixtures predating it stay valid; the
   * gatherer always sets it, and every reader must treat `undefined` as 0.
   */
  unavailableCount?: number
}

export interface SiteFormFieldRow {
  fieldId: string
  label: string
  kind: 'result' | 'value' | 'paragraph' | 'list' | 'subheading'
  pass?: 'pass' | 'fail' | 'na' | null
  failReason?: string | null
  sansRef?: string | null
  value?: string
  /**
   * `field.form_responses.prefilled_from` (migration 00182) — the source name of
   * a value that was pre-populated from the project record and never edited:
   * project | organisation | user | structure_node | cable_schedule | system.
   *
   * NULL/absent means the answer was entered on site. Set ONLY when the row
   * actually prints something, so the marker can never land on an em dash.
   *
   * Optional purely so hand-written fixtures predating it stay valid; every
   * reader must treat `undefined` as "entered on site".
   */
  prefilledFrom?: string | null
}

/** A repeating group flattened into a table: one row per entry. */
export interface SiteFormGroupTable {
  fieldId: string
  label: string
  /** Columns with at least one non-empty cell (empty columns are pruned). */
  columns: Array<{ fieldId: string; label: string }>
  /**
   * rows[i] aligns with columns[]; rows[i].entryNo is the 1-based entry index.
   * `prefilled[j]` aligns with `cells[j]`: true when that cell was inherited
   * from the project record and never edited (see SiteFormFieldRow.prefilledFrom).
   * A whole circuit row imported from the cable schedule is therefore visibly
   * distinguishable from one an electrician typed.
   */
  rows: Array<{ entryNo: number; cells: string[]; prefilled?: boolean[] }>
}

export interface SiteFormReportSection {
  sectionId: string
  title: string
  rows: SiteFormFieldRow[]
  groups: SiteFormGroupTable[]
}

export interface SiteFormDefectRow {
  entryNo: number
  description: string
  location: string
  /** C1 | C2 | C3 | FI, or '' when unanswered. */
  classification: string
  /** C1 = immediate danger present. Rendered unmissably. */
  isC1: boolean
  regulationReference: string
  actionTaken: string
  actionBy: string
  targetDate: string
}

export interface SiteFormSignatureBlock {
  blockId: string
  blockLabel: string
  signatoryName: string
  signatoryRole: string | null
  registrationCategory: string | null
  registrationNumber: string | null
  signedAt: string | null
  /** data: URI, or null when the download failed. */
  imageDataUri: string | null
}

export interface SiteFormAuditEntry {
  at: string | null
  sectionTitle: string
  fieldLabel: string
  value: string
  by: string
  /**
   * `field.form_response_history.prefilled_from` (00182). The history is the
   * part an enquiry actually reads, so an entry that was pre-populated when the
   * form was created must not read as one a person stated. Absent = stated.
   */
  prefilledFrom?: string | null
}

export interface SiteFormReportSummary {
  formNo: string
  status: string
  projectName: string
  projectCode: string | null
  templateName: string
  templateVersion: string | null
  boardLabel: string
  boardRef: string | null
  /** Raw machine token, e.g. 'made_safe_de_energised'. */
  asLeftStatus: string | null
  /** Human label via the shared asLeftStatusLabel — never a raw token. */
  asLeftStatusText: string
  dateOfWork: string | null
  electricianName: string | null
  registeredPersonName: string | null
  /** Circuits recorded as left isolated / capped / made safe pending others. */
  circuitsLeftTemporary: number
  circuitCount: number
  defectCount: number
  c1Count: number
  createdByName: string | null
  submittedByName: string | null
  submittedAt: string | null
  distributedByName: string | null
  distributedAt: string | null
}

export interface SiteFormReportData {
  formId: string
  projectId: string
  organisationId: string
  branding: ResolvedBranding
  summary: SiteFormReportSummary
  sections: SiteFormReportSection[]
  photoFields: SiteFormPhotoField[]
  defects: SiteFormDefectRow[]
  signatures: SiteFormSignatureBlock[]
  audit: SiteFormAuditEntry[]
  /** History rows beyond AUDIT_ROW_CAP, summarised rather than rendered. */
  auditOmittedCount: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHOTO_BUCKET = 'site-form-photos'
const SIGNATURE_BUCKET = 'site-form-signatures'
const LOGO_BUCKET = 'report-logos'

/** Same cap as the inspections gatherer — a 200-photo field would be unusable. */
const MAX_PHOTOS_PER_FIELD = 24

/** A safety record must not silently drop its audit trail; the overflow is counted. */
const AUDIT_ROW_CAP = 1000

/** Column chunk size for wide repeating groups (circuits has 22 sub-fields). */
const MAX_TABLE_COLUMNS = 8

const ALL_PROJECT_ROLES = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
] as const

/** Repeating-group field id of the defect register (rendered as its own table). */
const DEFECT_GROUP_ID = 'defect_register'

/** Circuits group + the action_taken values that mean "not a permanent state". */
const CIRCUITS_GROUP_ID = 'circuits'
const TEMPORARY_ACTIONS = new Set([
  'left_isolated_locked_off',
  'made_safe_pending_removal_by_others',
  'disconnected_at_db_only_far_end_open',
])

const SIGNATURE_BLOCK_LABELS: Record<string, string> = {
  safe_isolation_confirmed: 'Safe isolation confirmed — work may proceed (§6)',
  hazard_sweep_technician: 'Pre-work hazard sweep — technician (§11A)',
  hazard_sweep_supervisor: 'Pre-work hazard sweep — supervisor (§11A)',
  electrician: 'Electrician',
  registered_person: 'Registered person (general control)',
  supervisor: 'Supervisor / engineer',
  client_witness: 'Client / witness',
}

/**
 * Stable render order, independent of insert order, following the order the
 * signatures are given on site: the isolation is owned first (§6), then the
 * hazard sweep (§11A), then the §13 declarations.
 *
 * Must cover every value in the `block_id` CHECK — an unlisted block sorts to
 * `indexOf` −1 and would silently jump ahead of the electrician's declaration.
 */
const SIGNATURE_BLOCK_ORDER = [
  'safe_isolation_confirmed',
  'hazard_sweep_technician',
  'hazard_sweep_supervisor',
  'electrician',
  'registered_person',
  'supervisor',
  'client_witness',
]

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

type AnyService = ReturnType<typeof createServiceClient>

/**
 * Download a storage object and return it as `data:<mime>;base64,…`.
 * Returns null on any failure so the render degrades to a missing slot rather
 * than throwing mid-report.
 */
async function fileToDataUri(
  service: AnyService,
  bucket: string,
  path: string,
): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(path)
    if (error || !data) return null
    const buf = Buffer.from(await data.arrayBuffer())
    const mime = data.type || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

const logoToDataUri = (service: AnyService, path: string) =>
  fileToDataUri(service, LOGO_BUCKET, path)

const photoToDataUri = (service: AnyService, path: string) =>
  fileToDataUri(service, PHOTO_BUCKET, path)

const signatureToDataUri = (service: AnyService, path: string) =>
  fileToDataUri(service, SIGNATURE_BUCKET, path)

// ---------------------------------------------------------------------------
// Template / value helpers
// ---------------------------------------------------------------------------

interface FlatField {
  field_id: string
  label?: string
  type?: string
  unit?: string
  sans_ref?: string
  /** Present on `computed` fields — see computedRowValue in the gatherer. */
  formula?: string
  fields?: FlatField[]
}

/**
 * A section's own fields plus every subsection's fields, in document order.
 * Deliberately does NOT recurse into repeating_group sub-fields — those are
 * expanded separately under their synthetic `<group>[<i>].<sub>` ids.
 */
function flattenSectionFields(section: any): FlatField[] {
  const out: FlatField[] = [...((section?.fields ?? []) as FlatField[])]
  for (const sub of (section?.subsections ?? []) as Array<{ fields?: FlatField[] }>) {
    out.push(...((sub.fields ?? []) as FlatField[]))
  }
  return out
}

/** `made_safe_de_energised` → `Made safe de energised`. Cosmetic only. */
function humaniseToken(raw: string): string {
  if (!/^[a-z0-9]+(_[a-z0-9]+)+$/.test(raw)) return raw
  const spaced = raw.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function passStateOf(resp: any): 'pass' | 'fail' | 'na' | null {
  const ps = resp?.pass_state as string | null | undefined
  if (ps === 'pass' || ps === 'fail' || ps === 'na') return ps
  if (resp?.value_bool === true) return 'pass'
  if (resp?.value_bool === false) return 'fail'
  return null
}

/** Type-aware scalar formatting shared by section rows, group cells and audit. */
function formatValue(field: FlatField | undefined, resp: any): string {
  if (!resp) return ''
  switch (field?.type) {
    case 'pass_fail': {
      const ps = passStateOf(resp)
      return ps ? ps.toUpperCase() : ''
    }
    case 'number':
      return resp.value_number == null
        ? ''
        : `${resp.value_number}${field?.unit ? ` ${field.unit}` : ''}`
    case 'multi_select':
      return ((resp.value_array ?? []) as string[]).map(humaniseToken).join(', ')
    case 'dropdown':
      return resp.value_text ? humaniseToken(String(resp.value_text)) : ''
    default:
      break
  }
  // Untyped (audit rows, unknown field types): first non-null value wins.
  if (resp.value_text != null && resp.value_text !== '') return String(resp.value_text)
  if (resp.value_number != null) return String(resp.value_number)
  if (Array.isArray(resp.value_array) && resp.value_array.length > 0) {
    return (resp.value_array as string[]).join(', ')
  }
  if (resp.value_bool != null) return resp.value_bool ? 'Yes' : 'No'
  const ps = passStateOf(resp)
  return ps ? ps.toUpperCase() : ''
}

/**
 * The provenance of a stored answer, or null when a person entered it.
 *
 * `prefilled_from` is cleared to NULL on every user edit (00182 +
 * upsertFormResponseAction), so a non-empty value here means the answer is
 * still exactly what the project record said — nobody verified it at the board.
 */
function prefilledSourceOf(resp: any): string | null {
  const src = resp?.prefilled_from
  if (typeof src !== 'string') return null
  const trimmed = src.trim()
  return trimmed === '' ? null : trimmed
}

/** Field types that never render as a row or a table column. */
const NON_ROW_TYPES = new Set(['photo', 'file', 'signature', 'repeating_group'])

function mapFieldToRow(field: FlatField, resp: any): SiteFormFieldRow | null {
  if (NON_ROW_TYPES.has(field.type ?? '')) return null

  const base = {
    fieldId: field.field_id,
    label: String(field.label ?? field.field_id),
    sansRef: field.sans_ref ?? null,
  }

  // Provenance travels with the PRINTED value: a source recorded against a row
  // that prints nothing would hang a marker on an em dash.
  const source = prefilledSourceOf(resp)

  if (field.type === 'header') return { ...base, kind: 'subheading' }
  if (field.type === 'pass_fail') {
    const pass = passStateOf(resp)
    return {
      ...base,
      kind: 'result',
      pass,
      failReason: (resp?.fail_reason as string | null) ?? null,
      prefilledFrom: pass ? source : null,
    }
  }
  const value = formatValue(field, resp)
  const prefilledFrom = value ? source : null
  if (field.type === 'textarea') return { ...base, kind: 'paragraph', value, prefilledFrom }
  if (field.type === 'multi_select') return { ...base, kind: 'list', value, prefilledFrom }
  return { ...base, kind: 'value', value, prefilledFrom }
}

// ---------------------------------------------------------------------------
// Caption band
// ---------------------------------------------------------------------------

function buildPhotoCaption(photo: any, nameLookup: Map<string, string>): string {
  const parts: string[] = []
  if (photo.caption) parts.push(String(photo.caption))
  if (photo.taken_at) {
    const d = new Date(photo.taken_at)
    if (!isNaN(d.getTime())) parts.push(d.toLocaleString('en-ZA'))
  }
  if (photo.gps_lat != null && photo.gps_lng != null) {
    parts.push(`${Number(photo.gps_lat).toFixed(5)}, ${Number(photo.gps_lng).toFixed(5)}`)
  }
  const name = nameLookup.get((photo.uploaded_by as string | null | undefined) ?? '')
  if (name) parts.push(`by ${name}`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Main gatherer
// ---------------------------------------------------------------------------

/**
 * Gather everything the SiteFormReportDocument needs.
 *
 * Throws a plain Error on auth / not-found; the route handler maps the message
 * onto an HTTP status.
 */
export async function gatherSiteFormReportData(
  supabase: SupabaseClient,
  projectId: string,
  formId: string,
): Promise<SiteFormReportData> {
  // ── 1. Gate FIRST, on the caller's own client, before any service read. ────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const gate = await requireEffectiveRole(supabase, projectId, ALL_PROJECT_ROLES)
  if (!gate.ok) throw new Error(gate.error)

  // ── 2. Service reads (profiles + storage need it; RLS already cleared). ────
  const service = createServiceClient()

  // Scoped by project_id as well as id — a form id from another project must
  // not be readable through a project the caller happens to belong to.
  const { data: form } = await (service as any)
    .schema('field')
    .from('site_forms')
    .select('*')
    .eq('id', formId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!form) throw new Error('Form not found')

  // ── 2a. Client viewers see DISTRIBUTED records only. ──────────────────────
  //
  //     This is not redundant with the gate above. Every read from here down is
  //     on the service client, which bypasses the `field.site_forms` RLS that
  //     restricts client viewers to `status = 'distributed'` — and this route
  //     lives under app/api/…, not under (admin)/layout.tsx, so the "client
  //     viewers are bounced to /portal" protection does not apply either.
  //
  //     Without this, the endpoint is a live read-oracle. The distribution
  //     email hands every client viewer the projectId and formId, so a record
  //     later VOIDED (the documented withdrawal path) would keep rendering
  //     indefinitely, and any leaked draft id would be a rolling window into an
  //     in-progress record — audit trail, photos and signatures included.
  //
  //     Mirrors migration 00172's rule for `qc_reports` at the database level.
  //     The wording is deliberately the same not-found message used above: a
  //     distinguishable "forbidden" would still confirm the form exists.
  if (gate.role === 'client_viewer' && form.status !== 'distributed') {
    throw new Error('Form not found')
  }

  const [
    { data: project },
    { data: template },
    { data: responseRows },
    { data: historyRows },
    { data: photoRows },
    { data: signatureRows },
  ] = await Promise.all([
    (service as any)
      .schema('projects')
      .from('projects')
      .select('id, name, code, organisation_id, client_logo_url, project_logo_url, report_accent_color')
      .eq('id', projectId)
      .maybeSingle(),
    (service as any)
      .schema('field')
      .from('form_templates')
      .select('name, version, schema_json')
      .eq('id', form.template_row_id)
      .maybeSingle(),
    // `*` on both response tables — which is what carries `prefilled_from`
    // (migration 00182) through to the rendered rows and the audit trail.
    (service as any).schema('field').from('form_responses').select('*').eq('form_id', formId),
    (service as any)
      .schema('field')
      .from('form_response_history')
      .select('*')
      .eq('form_id', formId)
      .order('responded_at', { ascending: true }),
    (service as any)
      .schema('field')
      .from('form_photos')
      .select('*')
      .eq('form_id', formId)
      .order('sort_order', { ascending: true }),
    (service as any)
      .schema('field')
      .from('form_signatures')
      .select('*')
      .eq('form_id', formId),
  ])
  if (!project) throw new Error('Project not found')

  const { data: org } = await (service as any)
    .from('organisations')
    .select('id, name, logo_url, report_accent_color')
    .eq('id', form.organisation_id)
    .maybeSingle()

  const responses: any[] = responseRows ?? []
  const history: any[] = historyRows ?? []
  const photos: any[] = photoRows ?? []
  const signatureList: any[] = signatureRows ?? []
  const sections: any[] = (template?.schema_json?.sections ?? []) as any[]

  // ── 3. Batched profile lookup via the SERVICE client. ─────────────────────
  //     public.profiles RLS returns only the caller's own row (00009), so a
  //     cookie-client lookup would leave every other name blank.
  const nameIds = new Set<string>()
  for (const id of [form.created_by, form.submitted_by, form.distributed_by]) {
    if (id) nameIds.add(id)
  }
  for (const r of responses) if (r.latest_responded_by) nameIds.add(r.latest_responded_by)
  for (const h of history) if (h.responded_by) nameIds.add(h.responded_by)
  for (const p of photos) if (p.uploaded_by) nameIds.add(p.uploaded_by)
  for (const sg of signatureList) if (sg.signed_by) nameIds.add(sg.signed_by)

  const nameLookup = new Map<string, string>()
  if (nameIds.size > 0) {
    const { data: profiles } = await (service as any)
      .from('profiles')
      .select('id, full_name, email')
      .in('id', [...nameIds])
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      const name = p.full_name ?? p.email
      if (name) nameLookup.set(p.id, name)
    }
  }
  const nameOf = (id: string | null | undefined): string | null =>
    id ? (nameLookup.get(id) ?? null) : null

  // ── 4. Template indexes. ──────────────────────────────────────────────────
  const key = (sectionId: string, fieldId: string) => `${sectionId}|${fieldId}`

  const sectionTitleById = new Map<string, string>()
  /** "sectionId|fieldId" → field definition (top-level + subsection fields). */
  const fieldByKey = new Map<string, FlatField>()
  /** "sectionId|groupId|subId" → sub-field definition. */
  const subFieldByKey = new Map<string, FlatField>()

  for (const section of sections) {
    sectionTitleById.set(String(section.section_id), String(section.title ?? section.section_id))
    for (const f of flattenSectionFields(section)) {
      fieldByKey.set(key(section.section_id, f.field_id), f)
      if (f.type === 'repeating_group') {
        for (const sub of (f.fields ?? []) as FlatField[]) {
          subFieldByKey.set(`${section.section_id}|${f.field_id}|${sub.field_id}`, sub)
        }
      }
    }
  }

  /** Resolve a (possibly synthetic) field id to a definition. */
  function fieldDefFor(sectionId: string, fieldId: string): FlatField | undefined {
    const direct = fieldByKey.get(key(sectionId, fieldId))
    if (direct) return direct
    const parsed = parseRepeatingGroupKey(fieldId)
    if (!parsed) return undefined
    return subFieldByKey.get(`${sectionId}|${parsed.group}|${parsed.sub}`)
  }

  /** Human label for a (possibly synthetic) field id, entry-aware. */
  function fieldLabelFor(sectionId: string, fieldId: string): string {
    const direct = fieldByKey.get(key(sectionId, fieldId))
    if (direct) return String(direct.label ?? direct.field_id)
    const parsed = parseRepeatingGroupKey(fieldId)
    if (!parsed) return fieldId
    const group = fieldByKey.get(key(sectionId, parsed.group))
    const sub = subFieldByKey.get(`${sectionId}|${parsed.group}|${parsed.sub}`)
    const groupLabel = group ? String(group.label ?? group.field_id) : parsed.group
    const subLabel = sub ? String(sub.label ?? sub.field_id) : parsed.sub
    return `${groupLabel} [${entryDisplayNo(sectionId, parsed.group, parsed.index)}] · ${subLabel}`
  }

  const responseAt = (sectionId: string, fieldId: string): any =>
    responses.find((r) => r.section_id === sectionId && r.field_id === fieldId)

  /** Entry indices present for a group, scoped to its own section. */
  function entryIndices(sectionId: string, groupId: string): number[] {
    const scoped = responses.filter((r) => r.section_id === sectionId)
    return listRepeatingGroupEntryIndices(groupId, scoped as any)
  }

  /**
   * 1-based, gap-free number for a repeating-group entry, as printed.
   *
   * Synthetic indices are NOT stable: deleting entry 0 of 3 leaves indices 1
   * and 2, which used to print as rows "2, 3". People cite these records by row
   * number, so every part of the document (tables, defect register, photo
   * captions, audit labels) numbers what it actually prints.
   *
   * Falls back to index+1 for an index that is no longer present — an audit row
   * for a since-deleted entry has no printed row to agree with.
   */
  const entryOrderCache = new Map<string, Map<number, number>>()
  function entryDisplayNo(sectionId: string, groupId: string, index: number): number {
    const cacheKey = `${sectionId}|${groupId}`
    let order = entryOrderCache.get(cacheKey)
    if (!order) {
      order = new Map(entryIndices(sectionId, groupId).map((idx, pos) => [idx, pos + 1]))
      entryOrderCache.set(cacheKey, order)
    }
    return order.get(index) ?? index + 1
  }

  // ── 4a. Derivations the document states in more than one place. ───────────
  //     Computed BEFORE the sections are built so the §12 rows and the summary
  //     hero block are rendered from the SAME values — a legal record must not
  //     contain two contradictory answers to the same question.

  // Circuits left in a temporary state — derived from the circuit entries
  // themselves (the source of truth), matching the template's
  // `circuits_left_temporary` formula. The stored computed response is used
  // only when no circuit entries were captured at all.
  let circuitCount = 0
  let circuitsLeftTemporary = 0
  for (const section of sections) {
    const sectionId = String(section.section_id)
    const hasCircuits = flattenSectionFields(section).some(
      (f) => f.type === 'repeating_group' && f.field_id === CIRCUITS_GROUP_ID,
    )
    if (!hasCircuits) continue
    for (const i of entryIndices(sectionId, CIRCUITS_GROUP_ID)) {
      circuitCount++
      const action = responseAt(sectionId, `${CIRCUITS_GROUP_ID}[${i}].action_taken`)
      const token = String(action?.value_text ?? '').trim()
      if (TEMPORARY_ACTIONS.has(token)) circuitsLeftTemporary++
    }
  }
  if (circuitCount === 0) {
    const stored =
      responseAt('handover_status', 'circuits_left_temporary_count') ??
      responseAt('circuits_affected', 'circuits_left_temporary')
    const n = Number(stored?.value_number ?? stored?.value_text ?? NaN)
    if (Number.isFinite(n) && n > 0) circuitsLeftTemporary = n
  }

  /**
   * The as-left status, resolved ONCE from the §12 response.
   *
   * `field.site_forms.as_left_status` is a denormalised copy written at submit
   * so the list page can filter without loading responses; the response row is
   * the source of truth (design spec, `field.site_forms`). The column is a
   * fallback only — if the two ever diverge, the real answer must still be the
   * one printed, in the field row AND in the summary.
   */
  const asLeftResponse =
    responseAt('handover_status', 'as_left_status') ??
    responses.find((r) => r.field_id === 'as_left_status')
  const asLeftStatus =
    (String(asLeftResponse?.value_text ?? '').trim() ||
      String((form.as_left_status as string | null) ?? '').trim()) ||
    null
  const asLeftStatusText = asLeftStatus ? asLeftStatusLabel(asLeftStatus) : 'Not recorded'

  /**
   * Evaluate a `computed` field. These carry no response row of their own, so
   * without this they printed "—" beside a summary block asserting the opposite.
   *
   * Returns null when the formula is one this renderer cannot evaluate; the
   * caller then keeps any stored value and otherwise suppresses the row. A
   * fabricated answer is worse than no row, and a blank in a legal record
   * invites the question of whether it was overlooked.
   */
  function computedRowValue(field: FlatField, sectionId: string): string | null {
    const formula = String(field.formula ?? '').trim()

    // `circuits_left_temporary` (§5) and the §12 field that mirrors it — the
    // same derivation the summary uses, deliberately not a second copy of it.
    if (formula === 'circuits_left_temporary' || /^count\(\s*circuits\b/i.test(formula)) {
      return String(circuitsLeftTemporary)
    }

    // `all(<field ids>) <= 0` — the proving-dead gate.
    const all = /^all\(([^)]*)\)\s*<=\s*0$/i.exec(formula)
    if (all) {
      const readings = all[1]
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => responseAt(sectionId, id))
        .map((r) => (r?.value_number == null ? NaN : Number(r.value_number)))
        .filter((n) => Number.isFinite(n))
      // A single-phase board never answers the three-phase readings, so the
      // gate is evaluated over the readings actually captured.
      if (readings.length === 0) return 'Not recorded'
      return readings.every((v) => v <= 0) ? 'Yes' : 'No'
    }

    return null
  }

  // ── 5. Sections: scalar rows + repeating groups as tables. ────────────────
  //     The defect register is deliberately excluded here — it gets its own
  //     C1-flagged table later in the document.
  const reportSections: SiteFormReportSection[] = []
  for (const section of sections) {
    const sectionId = String(section.section_id)
    const rows: SiteFormFieldRow[] = []
    const groups: SiteFormGroupTable[] = []

    for (const field of flattenSectionFields(section)) {
      if (field.type === 'repeating_group') {
        if (field.field_id === DEFECT_GROUP_ID) continue
        const table = buildGroupTable(field, sectionId)
        if (table) groups.push(table)
        continue
      }
      const row = mapFieldToRow(field, responseAt(sectionId, field.field_id))
      if (!row) continue
      if (field.type === 'computed') {
        const computed = computedRowValue(field, sectionId)
        if (computed !== null) {
          row.value = computed
          // Derived here and now from the circuit entries — whatever provenance
          // the stored response carried does not describe THIS number.
          row.prefilledFrom = null
        }
        // No formula we can evaluate and nothing stored: suppress rather than
        // print a bare "—" that reads as an overlooked answer.
        else if (!row.value) continue
      }
      // The one field whose wording is legally load-bearing: rendered from the
      // response (never a raw token, never the denormalised column), and from
      // the SAME resolution the summary hero block uses.
      if (field.field_id === 'as_left_status') {
        row.value = asLeftStatusText
      }
      rows.push(row)
    }

    if (rows.length > 0 || groups.length > 0) {
      reportSections.push({
        sectionId,
        title: String(section.title ?? sectionId),
        rows,
        groups,
      })
    }
  }

  /** Flatten a repeating group into a table, pruning all-empty columns. */
  function buildGroupTable(field: FlatField, sectionId: string): SiteFormGroupTable | null {
    const indices = entryIndices(sectionId, field.field_id)
    if (indices.length === 0) return null

    const subs = ((field.fields ?? []) as FlatField[]).filter(
      (sub) => !NON_ROW_TYPES.has(sub.type ?? '') && sub.type !== 'header',
    )

    // The response rows are kept alongside the formatted cells: a circuit row
    // imported wholesale from the cable schedule has to stay distinguishable
    // from one an electrician typed, and only the row carries that.
    const respsByEntry = indices.map((i) =>
      subs.map((sub) => responseAt(sectionId, `${field.field_id}[${i}].${sub.field_id}`)),
    )
    const cellsByEntry = respsByEntry.map((resps) =>
      resps.map((resp, col) => formatValue(subs[col], resp)),
    )

    // Prune columns that are empty for every entry — `circuits` has 22
    // sub-fields and a real capture fills a handful of them.
    const keep = subs
      .map((_, col) => col)
      .filter((col) => cellsByEntry.some((cells) => cells[col].trim() !== ''))
    if (keep.length === 0) return null

    return {
      fieldId: field.field_id,
      label: String(field.label ?? field.field_id),
      columns: keep.map((col) => ({
        fieldId: subs[col].field_id,
        label: String(subs[col].label ?? subs[col].field_id),
      })),
      // Numbered by printed position, not by the synthetic index — see
      // entryDisplayNo. Delete entry 0 of 3 and these stay "1, 2".
      rows: indices.map((entryIdx, rowIdx) => ({
        entryNo: entryDisplayNo(sectionId, field.field_id, entryIdx),
        cells: keep.map((col) => cellsByEntry[rowIdx][col]),
        // Only a cell that actually prints something can be marked.
        prefilled: keep.map(
          (col) =>
            cellsByEntry[rowIdx][col].trim() !== '' &&
            prefilledSourceOf(respsByEntry[rowIdx][col]) !== null,
        ),
      })),
    }
  }

  // ── 6. Photographic evidence — every photo, embedded, capped per field. ───
  const photosByKey = new Map<string, any[]>()
  for (const ph of photos) {
    const k = key(ph.section_id, ph.field_id)
    if (!photosByKey.has(k)) photosByKey.set(k, [])
    photosByKey.get(k)!.push(ph)
  }

  const photoFields: SiteFormPhotoField[] = []
  const consumedKeys = new Set<string>()

  async function pushPhotoField(
    sectionId: string,
    fieldId: string,
    label: string,
  ): Promise<void> {
    const k = key(sectionId, fieldId)
    const rowsForField = photosByKey.get(k) ?? []
    if (rowsForField.length === 0) return
    consumedKeys.add(k)
    const rendered = rowsForField.slice(0, MAX_PHOTOS_PER_FIELD)
    const resolved = await Promise.all(
      rendered.map(async (ph): Promise<SiteFormReportPhoto | null> => {
        const dataUri = await photoToDataUri(service, ph.storage_path)
        if (!dataUri) return null
        return { id: String(ph.id), dataUri, caption: buildPhotoCaption(ph, nameLookup) }
      }),
    )
    const photosOk = resolved.filter(Boolean) as SiteFormReportPhoto[]
    photoFields.push({
      sectionId,
      fieldId,
      label,
      photos: photosOk,
      omittedCount: Math.max(0, rowsForField.length - MAX_PHOTOS_PER_FIELD),
      // Downloads that failed are COUNTED, never dropped: the field still
      // renders, saying how much evidence could not be retrieved.
      unavailableCount: resolved.length - photosOk.length,
    })
  }

  for (const section of sections) {
    const sectionId = String(section.section_id)
    const sectionTitle = String(section.title ?? sectionId)
    for (const field of flattenSectionFields(section)) {
      if (field.type === 'photo') {
        await pushPhotoField(
          sectionId,
          field.field_id,
          `${sectionTitle} — ${String(field.label ?? field.field_id)}`,
        )
        continue
      }
      if (field.type !== 'repeating_group') continue
      const groupLabel = String(field.label ?? field.field_id)
      const indices = entryIndices(sectionId, field.field_id)
      for (const sub of (field.fields ?? []) as FlatField[]) {
        if (sub.type !== 'photo') continue
        const subLabel = String(sub.label ?? sub.field_id)
        for (const i of indices) {
          await pushPhotoField(
            sectionId,
            `${field.field_id}[${i}].${sub.field_id}`,
            `${sectionTitle} — ${groupLabel} [${entryDisplayNo(sectionId, field.field_id, i)}] · ${subLabel}`,
          )
        }
      }
    }
  }

  // Orphans: photo rows whose field no longer exists in the template version
  // (schema drift). Dropping them silently would lose evidence.
  for (const [k, rowsForField] of photosByKey) {
    if (consumedKeys.has(k) || rowsForField.length === 0) continue
    const [sectionId, fieldId] = k.split('|')
    await pushPhotoField(
      sectionId,
      fieldId,
      `${sectionTitleById.get(sectionId) ?? sectionId} — ${fieldLabelFor(sectionId, fieldId)}`,
    )
  }

  // ── 7. Defect register (C1 = immediate danger). ───────────────────────────
  const defects: SiteFormDefectRow[] = []
  for (const section of sections) {
    const sectionId = String(section.section_id)
    const group = flattenSectionFields(section).find(
      (f) => f.type === 'repeating_group' && f.field_id === DEFECT_GROUP_ID,
    )
    if (!group) continue
    const subs = new Map(((group.fields ?? []) as FlatField[]).map((f) => [f.field_id, f]))
    const cell = (i: number, subId: string): string =>
      formatValue(subs.get(subId), responseAt(sectionId, `${DEFECT_GROUP_ID}[${i}].${subId}`))

    for (const i of entryIndices(sectionId, DEFECT_GROUP_ID)) {
      const classification = cell(i, 'classification').trim()
      defects.push({
        // Printed position, not the synthetic index — same rule as the tables.
        entryNo: entryDisplayNo(sectionId, DEFECT_GROUP_ID, i),
        description: cell(i, 'description'),
        location: cell(i, 'location'),
        classification,
        isC1: classification.toUpperCase() === 'C1',
        regulationReference: cell(i, 'regulation_reference'),
        actionTaken: cell(i, 'defect_action_taken'),
        actionBy: cell(i, 'defect_action_by'),
        targetDate: cell(i, 'target_date'),
      })
    }
  }

  // ── 8. Signature blocks. ──────────────────────────────────────────────────
  const signatures: SiteFormSignatureBlock[] = await Promise.all(
    [...signatureList]
      .sort(
        (a, b) =>
          SIGNATURE_BLOCK_ORDER.indexOf(String(a.block_id)) -
          SIGNATURE_BLOCK_ORDER.indexOf(String(b.block_id)),
      )
      .map(async (sg): Promise<SiteFormSignatureBlock> => ({
        blockId: String(sg.block_id),
        blockLabel: SIGNATURE_BLOCK_LABELS[String(sg.block_id)] ?? String(sg.block_id),
        signatoryName: (sg.signatory_name as string | null) ?? '—',
        signatoryRole: (sg.signatory_role as string | null) ?? null,
        registrationCategory: (sg.registration_category as string | null) ?? null,
        registrationNumber: (sg.registration_number as string | null) ?? null,
        signedAt: (sg.signed_at as string | null) ?? null,
        imageDataUri: sg.storage_path
          ? await signatureToDataUri(service, sg.storage_path)
          : null,
      })),
  )

  // ── 9. Response audit history. ────────────────────────────────────────────
  const auditOmittedCount = Math.max(0, history.length - AUDIT_ROW_CAP)
  const audit: SiteFormAuditEntry[] = history.slice(0, AUDIT_ROW_CAP).map((h) => {
    const value = formatValue(fieldDefFor(String(h.section_id), String(h.field_id)), h)
    return {
      at: (h.responded_at as string | null) ?? null,
      sectionTitle: sectionTitleById.get(String(h.section_id)) ?? String(h.section_id),
      fieldLabel: fieldLabelFor(String(h.section_id), String(h.field_id)),
      value,
      by: nameOf(h.responded_by) ?? '—',
      // Same rule as the field rows: provenance describes a printed value.
      prefilledFrom: value ? prefilledSourceOf(h) : null,
    }
  })

  // ── 10. Summary. ──────────────────────────────────────────────────────────
  const textOf = (sectionId: string, fieldId: string): string | null => {
    const r = responseAt(sectionId, fieldId)
    const v = formatValue(fieldByKey.get(key(sectionId, fieldId)), r)
    return v === '' ? null : v
  }

  const boardLabel =
    (form.board_label as string | null) ??
    textOf('db_identification', 'db_description') ??
    (form.board_ref as string | null) ??
    'Unidentified board'
  const boardRef =
    (form.board_ref as string | null) ?? textOf('db_identification', 'db_reference')
  const dateOfWork = textOf('personnel', 'date_of_work')
  const electricianName =
    textOf('personnel', 'electrician_name') ??
    textOf('declarations', 'electrician_declaration_name')
  const registeredPersonName =
    textOf('personnel', 'registered_person_name') ??
    textOf('declarations', 'registered_person_declaration_name')

  const formNo = (form.form_no as string | null) ?? '— unnumbered draft —'

  const summary: SiteFormReportSummary = {
    formNo,
    status: String(form.status),
    projectName: (project.name as string | null) ?? 'Project',
    projectCode: (project.code as string | null) ?? null,
    templateName: (template?.name as string | null) ?? 'Site form',
    templateVersion: (template?.version as string | null) ?? null,
    boardLabel,
    boardRef,
    // Both resolved from the §12 response (§4a) — the same values the field row
    // carries, so the summary and the record can never state different answers.
    asLeftStatus,
    asLeftStatusText,
    dateOfWork,
    electricianName,
    registeredPersonName,
    circuitsLeftTemporary,
    circuitCount,
    defectCount: defects.length,
    c1Count: defects.filter((d) => d.isC1).length,
    createdByName: nameOf(form.created_by),
    submittedByName: nameOf(form.submitted_by),
    submittedAt: (form.submitted_at as string | null) ?? null,
    distributedByName: nameOf(form.distributed_by),
    distributedAt: (form.distributed_at as string | null) ?? null,
  }

  // ── 11. Branding — every logo embedded as a data: URI. ────────────────────
  const [orgLogoSrc, clientLogoSrc, projectMarkSrc] = await Promise.all([
    org?.logo_url ? logoToDataUri(service, org.logo_url) : Promise.resolve(null),
    project.client_logo_url ? logoToDataUri(service, project.client_logo_url) : Promise.resolve(null),
    project.project_logo_url ? logoToDataUri(service, project.project_logo_url) : Promise.resolve(null),
  ])

  const branding = resolveBranding({
    org: {
      name: (org?.name as string | null) ?? 'Organisation',
      logoSrc: orgLogoSrc ?? undefined,
      accent: (org?.report_accent_color as string | null) ?? null,
    },
    project: {
      name: summary.projectName,
      clientLogoSrc: clientLogoSrc ?? undefined,
      projectMarkSrc: projectMarkSrc ?? undefined,
      accent: (project.report_accent_color as string | null) ?? null,
      subtitle: `${formNo} · ${boardLabel}`,
    },
    contractor: null,
    kicker: 'TERMINATION & MAKING-SAFE RECORD',
    title: summary.templateName,
    date: dateOfWork ?? new Date().toISOString().slice(0, 10),
  })

  return {
    formId: String(form.id),
    projectId,
    organisationId: String(form.organisation_id),
    branding,
    summary,
    sections: reportSections,
    photoFields,
    defects,
    signatures,
    audit,
    auditOmittedCount,
  }
}

// Re-exported so the table renderer and the gatherer cannot disagree about
// how wide a table may get before it is chunked.
export { MAX_TABLE_COLUMNS }
