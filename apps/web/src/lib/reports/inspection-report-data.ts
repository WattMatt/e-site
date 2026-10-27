/**
 * gatherInspectionReportData — the pure-ish I/O seam between the inspection
 * data model and the react-pdf report document (Task 4).
 *
 * It performs Supabase reads + storage downloads, but returns a *plain,
 * serializable* object: no react-pdf, no Supabase row/client types leak out.
 * All mapping logic (response→row, photo-vs-file routing, tally, failed-list,
 * group-entry expansion, caption assembly) lives here and is unit-tested.
 *
 * Parity target (historical): the render-inspection-pdf edge function —
 * REMOVED in the 2026-08 PDF standardization pass (superseded by this Node
 * pipeline; recover payload-loader.ts + render.ts from git history if
 * needed). Field formatting, the caption band, the failed-field logic and
 * collectGroupEntryIndices were ported from its render.ts.
 *
 * RBAC: the caller is gated with requireEffectiveRole over the full
 * project-roles set (mirrors app/api/projects/[id]/branding-preview/route.ts).
 * After the gate, reads that touch public.profiles / storage go through the
 * service client (the cookie client only returns the viewer's own profile row
 * — migration 00009).
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { toReportJpeg } from './report-image'
import { toWinAnsiSafe } from './winansi-text'
import { assessedResult, evaluateField, evaluateInspection, type Field as EngineField, type Template as EngineTemplate } from '@esite/shared'

// ─── Public, serializable payload shape ──────────────────────────────────────
// (These EXACTLY match the local prop interfaces in interior.tsx; Task 4
// switches that file to import these.)

/** A single rendered field row inside a section (already mapped from a Response). */
export interface ReportFieldRow {
  fieldId: string
  label: string
  kind: 'result' | 'value' | 'paragraph' | 'list' | 'subheading'
  pass?: 'pass' | 'fail' | 'na' | null
  failReason?: string | null
  sansRef?: string | null
  value?: string
  /** Photos taken against this entry (inline capture), printed under it. */
  photos?: ReportPhotoField
}
export interface ReportGroup {
  fieldId: string
  label: string
  entries: Array<{ index: number; rows: ReportFieldRow[] }>
}
export interface ReportPhoto {
  dataUri: string | null   // data:image/...;base64,...  — null if download failed
  caption: string          // pre-joined "date · gps · by name" band, may be ''
}
export interface ReportPhotoField {
  sectionId: string
  fieldId: string
  label: string
  photos: ReportPhoto[]
  omittedCount: number     // count beyond the rendered cap
}
export interface ReportSection {
  sectionId: string
  title: string
  rows: ReportFieldRow[]          // non-group, non-photo fields in template order
  groups: ReportGroup[]           // repeating_group fields
  photoFields: ReportPhotoField[] // photo fields in this section
}
export interface ReportAnnexure {
  name: string
  source: 'attachment'
  href: string | null             // short-lived signed URL printed as a reference link
  thumbnailDataUri?: string | null // image attachments only
  meta?: string | null            // e.g. "PDF · 142 KB"
}
export interface ReportSignature {
  role: string
  name: string
  title: string | null
  registrationNumber: string | null
  signedAt: string | null          // ISO
  imageDataUri: string | null      // data:image/png;base64,... — null if download failed
}
export interface ReportAuditEntry {
  at: string | null                // ISO
  sectionId: string | null
  fieldId: string | null
  /** The entry's label from the template (a group entry reads "Group #n · Sub"); null if unknown. */
  fieldLabel?: string | null
  by: string                       // resolved name, or short-uuid fallback
}
export interface ReportSummary {
  documentNumber: string           // coc_number ?? '— pending —'
  projectName: string
  projectCode: string | null
  targetLabel: string
  templateName: string
  templateVersion: string | null
  inspectors: string               // joined names
  verifier: string | null
  startedAt: string | null
  certifiedAt: string | null
  overallResult: string | null     // 'pass' | 'fail' (legacy rows may hold 'conditional_pass') | null
  sansReference: string | null
  tally: { pass: number; fail: number; na: number }   // across ALL pass_fail responses incl. group entries
  /** What fails the inspection (engine failedFields): a Poor rating, a fail_values answer. */
  failed: Array<{ label: string; reason: string; sansRef?: string | null }>
  /** Recorded, not failing (engine flaggedFields): Fail ticks, readings outside their limit. */
  observations: Array<{ label: string; reason: string; sansRef?: string | null }>
  /** Required photos not taken, with the inspector's reason when given. Never failing. */
  missingPhotos: Array<{ label: string; reason: string | null }>
}
export interface InspectionReportData {
  inspectionId: string
  summary: ReportSummary
  sections: ReportSection[]
  annexures: ReportAnnexure[]
  signatures: ReportSignature[]
  audit: ReportAuditEntry[]
  brandingInput: {
    orgName: string
    orgLogoDataUri: string | null
    orgAccent: string | null
    projectAccent: string | null
    clientLogoDataUri: string | null
    projectMarkDataUri: string | null
    projectSubtitle: string        // "<Project> — <target/subject> · <date>" source
  }
}

// ─── Internal helper types (NOT exported) ────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyService = ReturnType<typeof createServiceClient>

// All seven project roles — mirrors the identical inline constant in
// apps/web/src/app/api/projects/[id]/branding-preview/route.ts.
// @esite/shared does not yet export a full-set constant (only OWNER_ADMIN,
// ORG_WRITE_ROLES, COST_VIEW_ROLES). If a role is added to the system,
// update BOTH this constant and the branding-preview gate, then promote
// the shared constant to @esite/shared.
const ALL_PROJECT_ROLES = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
] as const

const PHOTO_BUCKET = 'inspection-photos'
const ATTACHMENT_BUCKET = 'inspection-attachments'
const SIGNATURE_BUCKET = 'inspection-signatures'
const LOGO_BUCKET = 'report-logos'

const MAX_PHOTOS_PER_FIELD = 24
const SIGNED_URL_TTL = 3600

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i

// ─── data: URI / signed-URL helpers ──────────────────────────────────────────

/** Download from a bucket and return a `data:<mime>;base64,…` URI, or null. */
async function downloadToDataUri(
  service: AnyService,
  bucket: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(storagePath)
    if (error || !data) return null
    const arrayBuf = await data.arrayBuffer()
    const bytes = Buffer.from(arrayBuf)
    const mime = data.type || 'image/png'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * A stored photo as a small JPEG data URI for the PDF (toReportJpeg: rotation applied, long edge
 * capped, transparency white), or null when it cannot be downloaded or read.
 */
async function downloadPhotoForReport(
  service: AnyService,
  bucket: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(storagePath)
    if (error || !data) return null
    const jpeg = await toReportJpeg(new Uint8Array(await data.arrayBuffer()))
    return jpeg ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null
  } catch {
    return null
  }
}

/** Runs at most `n` of the given tasks at once. */
function concurrencyLimit(n: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active >= n || queue.length === 0) return
    active++
    queue.shift()!()
  }
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => task().then(resolve, reject).finally(() => { active--; next() }))
      next()
    })
}

/** Issue a short-lived signed URL, or null on any failure. */
async function signedUrl(
  service: AnyService,
  bucket: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage
      .from(bucket)
      .createSignedUrl(storagePath, SIGNED_URL_TTL)
    if (error || !data?.signedUrl) return null
    return data.signedUrl as string
  } catch {
    return null
  }
}

// ─── Field flattening ─────────────────────────────────────────────────────────

interface FlatField {
  field_id: string
  label?: string
  type?: string
  unit?: string
  pass_when?: string
  sans_ref?: string
  fields?: FlatField[]
}

/**
 * Section fields + every subsection's fields, in document order.
 *
 * INTENTIONALLY does NOT recurse into `repeating_group.fields`. Group sub-fields
 * are expanded separately by `collectGroupEntryIndices` + the group-entry loop
 * under synthetic ids (e.g. `grp[0].desc`). Recursing here would emit the raw
 * group field_ids as regular rows — wrong both structurally and for the tally.
 */
function flattenSectionFields(section: any): FlatField[] {
  const out: FlatField[] = [...((section.fields ?? []) as FlatField[])]
  for (const sub of (section.subsections ?? []) as Array<{ fields?: FlatField[] }>) {
    out.push(...((sub.fields ?? []) as FlatField[]))
  }
  return out
}

// Collect distinct entry indices for a repeating_group from the response set
// scoped to one section. Synthetic field_id shape: `<group>[<i>].<sub>`.
// Ported verbatim from render.ts ~lines 513–527.
function collectGroupEntryIndices(
  groupFieldId: string,
  responses: any[],
  sectionId: string,
): number[] {
  const re = new RegExp(`^${groupFieldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]\\.`)
  const set = new Set<number>()
  for (const r of responses) {
    if (r.section_id !== sectionId) continue
    const m = String(r.field_id ?? '').match(re)
    if (m) set.add(parseInt(m[1], 10))
  }
  return [...set].sort((a, b) => a - b)
}

// ─── §6 response → row mapping ────────────────────────────────────────────────

function passStateToPill(
  resp: any,
): 'pass' | 'fail' | 'na' | null {
  // pass_state carries N/A (value_bool cannot). Prefer it; fall back to value_bool.
  const ps = resp?.pass_state as string | null | undefined
  if (ps === 'pass' || ps === 'fail' || ps === 'na') return ps
  if (resp?.value_bool === true) return 'pass'
  if (resp?.value_bool === false) return 'fail'
  return null
}

function formatNumberValue(field: FlatField, resp: any): string {
  if (resp?.value_number == null) return ''
  const unit = field.unit ? ` ${field.unit}` : ''
  // A reading's pass/fail is not stored (the number field saves only its value; the screen
  // evaluates it live), so the report evaluates it the same way. Printing the stored state showed
  // every reading as "not_checked", a failed one included (walkthrough, 2026-10-13).
  const state = field.pass_when ? evaluateField(field as unknown as EngineField, resp).passState : null
  const threshold = field.pass_when ? `  (threshold ${field.pass_when} · ${state ?? 'not_checked'})` : ''
  return `${resp.value_number}${unit}${threshold}`
}

/** Map a single (flattened) field + its response to a ReportFieldRow, or null
 *  when the field renders elsewhere (photo / file / signature / repeating_group). */
function mapFieldToRow(
  field: FlatField,
  resp: any,
  lookupId: string,
): ReportFieldRow | null {
  const base = {
    fieldId: lookupId,
    label: String(field.label ?? field.field_id ?? ''),
    sansRef: field.sans_ref ?? null,
  }

  switch (field.type) {
    case 'pass_fail':
      return {
        ...base,
        kind: 'result',
        pass: passStateToPill(resp),
        failReason: (resp?.fail_reason as string | null) ?? null,
      }
    case 'number':
      return { ...base, kind: 'value', value: formatNumberValue(field, resp) }
    case 'text':
    case 'date':
    case 'dropdown':
    case 'computed':
      return { ...base, kind: 'value', value: (resp?.value_text as string | null) ?? '' }
    case 'textarea':
      return { ...base, kind: 'paragraph', value: (resp?.value_text as string | null) ?? '' }
    case 'multi_select':
      return { ...base, kind: 'list', value: ((resp?.value_array ?? []) as string[]).join(', ') }
    case 'header':
      return { ...base, kind: 'subheading' }
    // Rendered outside `rows`:
    case 'photo':
    case 'file':
    case 'signature':
    case 'repeating_group':
      return null
    default:
      // Unknown type → render its text value defensively rather than dropping it.
      return { ...base, kind: 'value', value: (resp?.value_text as string | null) ?? '' }
  }
}

// ─── Caption band ──────────────────────────────────────────────────────────────

/**
 * "date · gps · by name" — mirrors render.ts ~lines 396–424 (joined, untruncated).
 *
 * NOTE on column choice: `uploaded_by` is the REAL `inspections.photos` capturer
 * column (schema-verified against all migrations). The edge-function cert's
 * payload-loader.ts selects `captured_by_profile_id`, which is a PHANTOM column
 * that does NOT exist — PostgREST returns null for it, which is why the cert's
 * "by name" band is always blank. Using `uploaded_by` here is the CORRECT,
 * intentional improvement. Do NOT "align" this to `captured_by_profile_id`.
 */
function buildCaption(photo: any, capturedByLookup: Map<string, string>): string {
  const parts: string[] = []
  if (photo.taken_at) {
    // new Date(iso).toLocaleString('en-ZA') never throws — it returns "Invalid Date"
    // for bad input. Guard with isNaN instead of a try/catch.
    const d = new Date(photo.taken_at)
    if (!isNaN(d.getTime())) parts.push(d.toLocaleString('en-ZA'))
  }
  if (photo.gps_lat != null && photo.gps_lng != null) {
    parts.push(`${Number(photo.gps_lat).toFixed(5)}, ${Number(photo.gps_lng).toFixed(5)}`)
  }
  // uploaded_by — see NOTE above. Do NOT change to captured_by_profile_id.
  const name = capturedByLookup.get((photo.uploaded_by as string | null | undefined) ?? '')
  if (name) parts.push(`by ${name}`)
  return parts.join(' · ')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const INSPECTION_COLUMNS =
  'id, project_id, organisation_id, template_id, target_label, status, overall_result, coc_number, started_at, certified_at, assigned_to_id, verifier_id'

/**
 * `asUserId` is for callers with no browser session (the WhatsApp form service, E4): the row is
 * read with the service client and the SAME gate is applied to the named user through
 * public.user_effective_project_role (non-null for every one of ALL_PROJECT_ROLES).
 */
export async function gatherInspectionReportData(
  inspectionId: string,
  opts?: { asUserId: string },
): Promise<InspectionReportData> {
  let inspection: any
  let service: AnyService
  if (opts?.asUserId) {
    service = createServiceClient()
    ;({ data: inspection } = await (service as any)
      .schema('inspections').from('inspections').select(INSPECTION_COLUMNS).eq('id', inspectionId).maybeSingle())
    if (!inspection) throw new Error(`Inspection ${inspectionId} not found`)
    const { data: role, error } = await (service as any).rpc('user_effective_project_role', {
      p_project_id: inspection.project_id, p_user_id: opts.asUserId,
    })
    if (error || !role || !(ALL_PROJECT_ROLES as readonly string[]).includes(role)) throw new Error('No access to this project')
  } else {
    // 1. Read the inspection row with the cookie client.
    const supabase = await createClient()
    ;({ data: inspection } = await (supabase as any)
      .schema('inspections').from('inspections').select(INSPECTION_COLUMNS).eq('id', inspectionId).maybeSingle())
    if (!inspection) throw new Error(`Inspection ${inspectionId} not found`)

    // 2. Gate BEFORE any service-role fetch.
    const gate = await requireEffectiveRole(supabase, inspection.project_id, ALL_PROJECT_ROLES)
    if (!gate.ok) throw new Error(gate.error)

    // 3. Service client — RLS cleared by the gate; profiles/storage need service.
    service = createServiceClient()
  }

  const [
    { data: template },
    { data: project },
    { data: responses },
    { data: history },
    { data: photoRows },
    { data: sigRows },
  ] = await Promise.all([
    (service as any)
      .schema('inspections')
      .from('templates')
      .select('name, version, deliverable_type, sans_reference, schema_json')
      .eq('id', inspection.template_id)
      .maybeSingle(),
    (service as any)
      .schema('projects')
      .from('projects')
      .select('name, code, organisation_id, client_logo_url, project_logo_url, report_accent_color, status')
      .eq('id', inspection.project_id)
      .maybeSingle(),
    (service as any).schema('inspections').from('responses').select('*').eq('inspection_id', inspectionId),
    (service as any)
      .schema('inspections')
      .from('response_history')
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('responded_at'),
    (service as any).schema('inspections').from('photos').select('*').eq('inspection_id', inspectionId),
    (service as any)
      .schema('inspections')
      .from('signatures')
      .select('id, role, signatory_name, signatory_title, registration_number, storage_path, signed_at')
      .eq('inspection_id', inspectionId),
  ])

  const { data: org } = await (service as any)
    .from('organisations')
    .select('name, logo_url, report_accent_color')
    .eq('id', inspection.organisation_id)
    .maybeSingle()

  const responseList = (responses ?? []) as any[]
  const historyList = (history ?? []) as any[]
  const photoList = (photoRows ?? []) as any[]
  const sigList = (sigRows ?? []) as any[]
  const sections = (template?.schema_json?.sections ?? []) as any[]

  // 4. Resolve names via the SERVICE client (cookie client only returns the
  //    viewer's own profile — migration 00009). One batched lookup covers
  //    inspectors, verifier, photo-capturers and audit actors.
  const nameIds = new Set<string>()
  if (inspection.assigned_to_id) nameIds.add(inspection.assigned_to_id)
  if (inspection.verifier_id) nameIds.add(inspection.verifier_id)
  for (const h of historyList) if (h.responded_by) nameIds.add(h.responded_by)
  for (const ph of photoList) if (ph.uploaded_by) nameIds.add(ph.uploaded_by)

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
  const resolveName = (uid: string | null | undefined): string =>
    uid ? nameLookup.get(uid) ?? uid.slice(0, 8) : '—'

  // 5. Field-type index for photo-vs-file routing: "sectionId|fieldId" → type.
  //    Includes repeating_group sub-fields under their synthetic ids so a
  //    photo/file captured inside a group entry still routes correctly.
  const fieldTypeByKey = new Map<string, string>()
  const fieldLabelByKey = new Map<string, string>()
  const key = (sectionId: string, fieldId: string) => `${sectionId}|${fieldId}`
  for (const section of sections) {
    for (const f of flattenSectionFields(section)) {
      fieldTypeByKey.set(key(section.section_id, f.field_id), f.type ?? '')
      fieldLabelByKey.set(key(section.section_id, f.field_id), String(f.label ?? f.field_id))
      if (f.type === 'repeating_group') {
        const indices = collectGroupEntryIndices(f.field_id, responseList, section.section_id)
        for (const i of indices) {
          for (const sub of (f.fields ?? []) as FlatField[]) {
            const synthetic = `${f.field_id}[${i}].${sub.field_id}`
            fieldTypeByKey.set(key(section.section_id, synthetic), sub.type ?? '')
            fieldLabelByKey.set(key(section.section_id, synthetic), String(sub.label ?? sub.field_id))
          }
        }
      }
    }
  }

  // 6. Route photo rows. A `file` field's upload lives in the attachments bucket and is annexed.
  //    Everything else is a photo in the photos bucket: a photo field's, one taken against an
  //    entry (inline capture on a pass/fail check, a reading, a text answer), or one whose field
  //    is no longer in the template. Entry photos used to be sent to the annexure list and
  //    looked up in the ATTACHMENTS bucket, so they came out blank: 83 of the 132 photos on ZZ
  //    status-guard test (2026-10-12).
  const photoFieldBuckets = new Map<string, any[]>() // "sectionId|fieldId" → photo rows
  const fileAnnexureRows: any[] = []
  for (const ph of photoList) {
    const type = fieldTypeByKey.get(key(ph.section_id, ph.field_id))
    if (type === 'file') {
      fileAnnexureRows.push(ph)
    } else {
      const k = key(ph.section_id, ph.field_id)
      if (!photoFieldBuckets.has(k)) photoFieldBuckets.set(k, [])
      photoFieldBuckets.get(k)!.push(ph)
    }
  }
  const consumedPhotoKeys = new Set<string>()
  // Downloads + re-encodes run 8 at a time across the whole report: one at a time, a 30-photo
  // inspection took ~40 s to render (measured on ZZ status-guard test, 2026-10-12).
  const limit = concurrencyLimit(8)
  const renderPhotoField = async (sectionId: string, fieldId: string, label: string): Promise<ReportPhotoField | null> => {
    const k = key(sectionId, fieldId)
    const rowsForField = photoFieldBuckets.get(k) ?? []
    consumedPhotoKeys.add(k)
    if (rowsForField.length === 0) return null
    const rendered = rowsForField.slice(0, MAX_PHOTOS_PER_FIELD)
    const photos: ReportPhoto[] = await Promise.all(
      rendered.map((ph) =>
        limit(async () => ({
          dataUri: await downloadPhotoForReport(service, PHOTO_BUCKET, ph.original_path ?? ph.storage_path),
          caption: buildCaption(ph, nameLookup),
        })),
      ),
    )
    return { sectionId, fieldId, label, photos, omittedCount: Math.max(0, rowsForField.length - MAX_PHOTOS_PER_FIELD) }
  }

  // 7. Build the section model.
  const reportSections: ReportSection[] = []
  for (const section of sections) {
    const rows: ReportFieldRow[] = []
    const groups: ReportGroup[] = []
    const photoFields: ReportPhotoField[] = []

    const handleField = (field: FlatField, lookupId: string): void => {
      if (field.type === 'photo') {
        // emitted in the photoFields pass below
        return
      }
      if (field.type === 'repeating_group') return // handled separately
      if (field.type === 'file' || field.type === 'signature') return // top-level
      const resp = responseList.find(
        (r) => r.section_id === section.section_id && r.field_id === lookupId,
      )
      const row = mapFieldToRow(field, resp, lookupId)
      if (row) rows.push(row)
    }

    for (const field of flattenSectionFields(section)) {
      if (field.type === 'repeating_group') {
        const indices = collectGroupEntryIndices(field.field_id, responseList, section.section_id)
        const entries = indices.map((i) => {
          const entryRows: ReportFieldRow[] = []
          for (const sub of (field.fields ?? []) as FlatField[]) {
            const synthetic = `${field.field_id}[${i}].${sub.field_id}`
            if (sub.type === 'photo' || sub.type === 'file' || sub.type === 'signature') continue
            const resp = responseList.find(
              (r) => r.section_id === section.section_id && r.field_id === synthetic,
            )
            const row = mapFieldToRow(sub, resp, synthetic)
            if (row) entryRows.push(row)
          }
          return { index: i, rows: entryRows }
        })
        groups.push({
          fieldId: field.field_id,
          label: String(field.label ?? field.field_id),
          entries,
        })
        continue
      }
      handleField(field, field.field_id)
    }

    // Photos taken against an entry print under that entry's row.
    await Promise.all(
      [...rows, ...groups.flatMap((g) => g.entries.flatMap((e) => e.rows))].map(async (row) => {
        const pf = await renderPhotoField(section.section_id, row.fieldId, `Photos: ${row.label}`)
        if (pf) row.photos = pf
      }),
    )

    // Photo fields: top-level ones, then repeating-group photo sub-fields (flattenSectionFields
    // does not recurse into a group), one grid per (group, entry, photo sub-field).
    for (const field of flattenSectionFields(section)) {
      if (field.type === 'photo' && (field as { assess?: boolean }).assess) {
        // An assessed item (LV Line Shop): its Pass / Fail / N/A and comment as a result row, with
        // its photos (markups included) under it, so the finding and the evidence sit together.
        const resp = responseList.find((r) => r.section_id === section.section_id && r.field_id === field.field_id)
        const pf = await renderPhotoField(section.section_id, field.field_id, String(field.label ?? field.field_id))
        rows.push({
          fieldId: field.field_id,
          label: String(field.label ?? field.field_id),
          kind: 'result',
          pass: assessedResult(resp),
          failReason: (resp?.value_text as string | null) ?? null,
          sansRef: field.sans_ref ?? null,
          ...(pf ? { photos: pf } : {}),
        })
        continue
      }
      if (field.type === 'photo') {
        const pf = await renderPhotoField(section.section_id, field.field_id, String(field.label ?? field.field_id))
        // A photo field with nothing in it (an optional one left empty) prints nothing: a bare label
        // with no photo under it reads as a missing page.
        if (pf) photoFields.push(pf)
        continue
      }
      if (field.type !== 'repeating_group') continue
      const groupLabel = String(field.label ?? field.field_id)
      const indices = collectGroupEntryIndices(field.field_id, responseList, section.section_id)
      for (const sub of (field.fields ?? []) as FlatField[]) {
        if (sub.type !== 'photo') continue
        for (const i of indices) {
          const synthetic = `${field.field_id}[${i}].${sub.field_id}`
          const pf = await renderPhotoField(section.section_id, synthetic, `${groupLabel} — Entry ${i + 1}: ${String(sub.label ?? sub.field_id)}`)
          if (pf) photoFields.push(pf)
        }
      }
    }

    // Anything left in this section (a photo whose field the template no longer has, or one on a
    // signature/header): printed, never dropped.
    for (const k of [...photoFieldBuckets.keys()]) {
      if (consumedPhotoKeys.has(k) || !k.startsWith(`${section.section_id}|`)) continue
      const fieldId = k.slice(section.section_id.length + 1)
      const label = fieldLabelByKey.get(k)
      const pf = await renderPhotoField(section.section_id, fieldId, label ? `Photos: ${label}` : 'Other photos')
      if (pf) photoFields.push(pf)
    }

    reportSections.push({
      sectionId: section.section_id,
      title: String(section.title ?? '(untitled section)'),
      rows,
      groups,
      photoFields,
    })
  }

  // Photos under a section the template no longer has: their own closing section, never dropped.
  const strayPhotoFields: ReportPhotoField[] = []
  for (const k of [...photoFieldBuckets.keys()]) {
    if (consumedPhotoKeys.has(k)) continue
    const [sectionId, ...rest] = k.split('|')
    const pf = await renderPhotoField(sectionId, rest.join('|'), 'Other photos')
    if (pf) strayPhotoFields.push(pf)
  }
  if (strayPhotoFields.length > 0) {
    reportSections.push({ sectionId: '_other_photos', title: 'Other photos', rows: [], groups: [], photoFields: strayPhotoFields })
  }

  // 8. File-field annexures (source:'attachment') — signed URL + image thumbnail.
  const attachmentAnnexures: ReportAnnexure[] = await Promise.all(
    fileAnnexureRows.map(async (ph) => {
      const name = (ph.caption as string | null) ?? 'attachment'
      const href = await signedUrl(service, ATTACHMENT_BUCKET, ph.storage_path)
      const isImage = IMAGE_EXT_RE.test(name) || IMAGE_EXT_RE.test(String(ph.storage_path ?? ''))
      const thumbnailDataUri = isImage
        ? await downloadPhotoForReport(service, ATTACHMENT_BUCKET, ph.storage_path)
        : null
      return { name, source: 'attachment' as const, href, thumbnailDataUri }
    }),
  )

  // The report annexes only the inspection's OWN uploads; the cert + uploads are
  // pushed INTO handover (see lib/reports/file-inspection-report.ts), not pulled
  // back out of it.
  const annexures = attachmentAnnexures

  // 9. Signatures (by ROW role, not the template field).
  const signatures: ReportSignature[] = await Promise.all(
    sigList.map(async (s) => ({
      role: String(s.role ?? ''),
      name: (s.signatory_name as string | null) ?? '—',
      title: (s.signatory_title as string | null) ?? null,
      registrationNumber: (s.registration_number as string | null) ?? null,
      signedAt: (s.signed_at as string | null) ?? null,
      imageDataUri: await downloadToDataUri(service, SIGNATURE_BUCKET, s.storage_path),
    })),
  )

  // 10. Audit appendix (response_history, already ordered). Entries are named as on the form, not
  //     by their internal field ids.
  function auditLabel(sectionId: string | null, fieldId: string | null): string | null {
    if (!sectionId || !fieldId) return null
    const direct = fieldLabelByKey.get(key(sectionId, fieldId))
    if (direct) return direct
    const m = fieldId.match(/^(.+)\[(\d+)\]\.(.+)$/)
    if (!m) return null
    const group = fieldLabelByKey.get(key(sectionId, m[1])) ?? m[1]
    const sub = fieldLabelByKey.get(key(sectionId, fieldId)) ?? m[3]
    return `${group} #${Number(m[2]) + 1} · ${sub}`
  }
  const audit: ReportAuditEntry[] = historyList.map((h) => ({
    at: (h.responded_at as string | null) ?? null,
    sectionId: (h.section_id as string | null) ?? null,
    fieldId: (h.field_id as string | null) ?? null,
    fieldLabel: auditLabel(h.section_id as string | null, h.field_id as string | null),
    by: resolveName(h.responded_by),
  }))

  // 11. Summary — the pass/fail tally across ALL pass_fail responses (group entries included),
  //     and the verdict lists from the SAME engine evaluation the capture page and certify use, so
  //     the report can never disagree with the stored result: hidden fields are excluded, a Fail
  //     tick or an out-of-limit reading is an observation, and only a Poor rating or a fail_values
  //     answer fails.
  const tally = { pass: 0, fail: 0, na: 0 }
  for (const section of sections) {
    for (const field of flattenSectionFields(section)) {
      if (field.type === 'repeating_group') {
        const indices = collectGroupEntryIndices(field.field_id, responseList, section.section_id)
        for (const i of indices) {
          for (const sub of (field.fields ?? []) as FlatField[]) {
            if (sub.type !== 'pass_fail') continue
            const synthetic = `${field.field_id}[${i}].${sub.field_id}`
            const pill = passStateToPill(responseList.find((r) => r.section_id === section.section_id && r.field_id === synthetic))
            if (pill === 'pass') tally.pass++
            else if (pill === 'fail') tally.fail++
            else if (pill === 'na') tally.na++
          }
        }
        continue
      }
      // An assessed photo item (LV Line Shop) is a Pass / Fail / N/A result too: it counts in the
      // tally, else a report whose only Fail is an assessed item shows "0 FAIL" over the failure.
      const assessed = field.type === 'photo' && (field as { assess?: boolean }).assess
      if (field.type !== 'pass_fail' && !assessed) continue
      const resp = responseList.find((r) => r.section_id === section.section_id && r.field_id === field.field_id)
      const pill = assessed ? assessedResult(resp) : passStateToPill(resp)
      if (pill === 'pass') tally.pass++
      else if (pill === 'fail') tally.fail++
      else if (pill === 'na') tally.na++
    }
  }

  const evaluation = evaluateInspection(
    { ...(template?.schema_json ?? {}), sections } as EngineTemplate,
    responseList,
    {
      photos: photoList.map((p) => ({ section_id: p.section_id, field_id: p.field_id })),
      signatures: sigList.map((g) => ({ section_id: g.section_id ?? undefined, field_id: g.field_id ?? undefined })),
    },
  )
  const labelOf = (sectionId: string, fieldId: string): { label: string; sansRef: string | null } => {
    const section = sections.find((x) => x.section_id === sectionId)
    const title = section?.title ?? sectionId
    const m = /^([a-z0-9_]+)\[(\d+)\]\.([a-z0-9_]+)$/.exec(fieldId)
    const all = section ? (flattenSectionFields(section) as FlatField[]) : []
    if (m) {
      const group = all.find((f) => f.field_id === m[1])
      const sub = ((group?.fields ?? []) as FlatField[]).find((f) => f.field_id === m[3])
      return {
        label: `${title} · ${group?.label ?? m[1]} [entry ${Number(m[2]) + 1}] · ${sub?.label ?? m[3]}`,
        sansRef: sub?.sans_ref ?? null,
      }
    }
    const f = all.find((x) => x.field_id === fieldId)
    return { label: `${title} · ${f?.label ?? fieldId}`, sansRef: f?.sans_ref ?? null }
  }
  const failed = evaluation.failedFields.map((f) => ({ ...labelOf(f.sectionId, f.fieldId), reason: f.reason }))
  const observations = evaluation.flaggedFields.map((f) => ({ ...labelOf(f.sectionId, f.fieldId), reason: f.reason }))
  const missingPhotos = evaluation.missingPhotos.map((m) => ({ label: labelOf(m.sectionId, m.fieldId).label, reason: m.reason }))

  // Inspectors = distinct history contributors ∪ assigned inspector.
  const inspectorIds = new Set<string>()
  if (inspection.assigned_to_id) inspectorIds.add(inspection.assigned_to_id)
  for (const h of historyList) if (h.responded_by) inspectorIds.add(h.responded_by)
  const inspectors = [...inspectorIds].map((id) => resolveName(id)).filter(Boolean).join(', ')

  const summary: ReportSummary = {
    documentNumber: (inspection.coc_number as string | null) ?? '— pending —',
    projectName: (project?.name as string | null) ?? '—',
    projectCode: (project?.code as string | null) ?? null,
    targetLabel: (inspection.target_label as string | null) ?? '—',
    templateName: (template?.name as string | null) ?? '—',
    templateVersion: (template?.version as string | null) ?? null,
    inspectors: inspectors || '—',
    verifier: inspection.verifier_id ? resolveName(inspection.verifier_id) : null,
    startedAt: (inspection.started_at as string | null) ?? null,
    certifiedAt: (inspection.certified_at as string | null) ?? null,
    overallResult: (inspection.overall_result as string | null) ?? null,
    sansReference: (template?.sans_reference as string | null) ?? null,
    tally,
    failed,
    observations,
    missingPhotos,
  }

  // 12. brandingInput — org/project accents + the three logo data URIs from the
  //     report-logos bucket. projectSubtitle source = the inspection target.
  const [orgLogoDataUri, clientLogoDataUri, projectMarkDataUri] = await Promise.all([
    org?.logo_url ? downloadToDataUri(service, LOGO_BUCKET, org.logo_url) : Promise.resolve(null),
    project?.client_logo_url
      ? downloadToDataUri(service, LOGO_BUCKET, project.client_logo_url)
      : Promise.resolve(null),
    project?.project_logo_url
      ? downloadToDataUri(service, LOGO_BUCKET, project.project_logo_url)
      : Promise.resolve(null),
  ])

  return pdfSafeStrings({
    inspectionId,
    summary,
    sections: reportSections,
    annexures,
    signatures,
    audit,
    brandingInput: {
      orgName: (org?.name as string | null) ?? 'Organisation',
      orgLogoDataUri,
      orgAccent: (org?.report_accent_color as string | null) ?? null,
      projectAccent: (project?.report_accent_color as string | null) ?? null,
      clientLogoDataUri,
      projectMarkDataUri,
      projectSubtitle: (inspection.target_label as string | null) ?? '',
    },
  })
}

/**
 * Every string the report draws goes through toWinAnsiSafe: react-pdf's standard fonts are
 * WinAnsi-only and silently draw the WRONG glyph for anything else (Ω as ©, ≤ as "d", → as ’).
 * 42 active production templates carry → ≤ ≥ Ω in labels and thresholds (2026-10-13), and answers
 * are free text. Images and links (data URIs, signed URLs) are left exactly as they are.
 */
function pdfSafeStrings<T>(value: T, key = ''): T {
  if (typeof value === 'string') {
    return (/DataUri$|^dataUri$|^href$/.test(key) ? value : toWinAnsiSafe(value)) as T
  }
  if (Array.isArray(value)) return value.map((v) => pdfSafeStrings(v, key)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = pdfSafeStrings(v, k)
    return out as T
  }
  return value
}
