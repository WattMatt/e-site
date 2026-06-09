/**
 * gatherInspectionReportData — the pure-ish I/O seam between the inspection
 * data model and the react-pdf report document (Task 4).
 *
 * It performs Supabase reads + storage downloads, but returns a *plain,
 * serializable* object: no react-pdf, no Supabase row/client types leak out.
 * All mapping logic (response→row, photo-vs-file routing, tally, failed-list,
 * group-entry expansion, caption assembly) lives here and is unit-tested.
 *
 * Parity target: apps/edge-functions/supabase/functions/render-inspection-pdf
 * (payload-loader.ts + render.ts). Field formatting, the caption band, the
 * failed-field logic and collectGroupEntryIndices are ported from render.ts.
 *
 * RBAC: the caller is gated with requireEffectiveRole over the full
 * project-roles set (mirrors app/api/projects/[id]/branding-preview/route.ts).
 * After the gate, reads that touch public.profiles / storage go through the
 * service client (the cookie client only returns the viewer's own profile row
 * — migration 00009).
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'

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
  meta?: string | null            // e.g. "PDF · 142 KB" — reserved for future file metadata
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
  overallResult: string | null     // 'pass' | 'fail' | 'conditional_pass' | null
  sansReference: string | null
  tally: { pass: number; fail: number; na: number }   // across ALL pass_fail responses incl. group entries
  failed: Array<{ label: string; sansRef?: string | null }>
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
  const threshold = field.pass_when
    ? `  (threshold ${field.pass_when} · ${resp.pass_state ?? 'not_checked'})`
    : ''
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

export async function gatherInspectionReportData(
  inspectionId: string,
): Promise<InspectionReportData> {
  // 1. Read the inspection row with the cookie client.
  const supabase = await createClient()
  const { data: inspection } = await (supabase as any)
    .schema('inspections')
    .from('inspections')
    .select(
      'id, project_id, organisation_id, template_id, target_label, status, overall_result, coc_number, started_at, certified_at, assigned_to_id, verifier_id',
    )
    .eq('id', inspectionId)
    .maybeSingle()
  if (!inspection) throw new Error(`Inspection ${inspectionId} not found`)

  // 2. Gate BEFORE any service-role fetch.
  const gate = await requireEffectiveRole(supabase, inspection.project_id, ALL_PROJECT_ROLES)
  if (!gate.ok) throw new Error(gate.error)

  // 3. Service client — RLS cleared by the gate; profiles/storage need service.
  const service = createServiceClient()

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

  // 6. Route photo rows → photoFields vs annexures (no MIME column; the field
  //    type is the only discriminator. An orphan row → annexure, safer than
  //    embedding an arbitrary blob as an image).
  const photoFieldBuckets = new Map<string, any[]>() // "sectionId|fieldId" → photo rows
  const fileAnnexureRows: any[] = []
  for (const ph of photoList) {
    const type = fieldTypeByKey.get(key(ph.section_id, ph.field_id))
    if (type === 'photo') {
      const k = key(ph.section_id, ph.field_id)
      if (!photoFieldBuckets.has(k)) photoFieldBuckets.set(k, [])
      photoFieldBuckets.get(k)!.push(ph)
    } else {
      // 'file' OR orphan → annexure
      fileAnnexureRows.push(ph)
    }
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

    // Photo fields for this section — download + caption each photo.
    // Pass A: top-level photo fields (flattenSectionFields intentionally does NOT
    // recurse into repeating_group sub-fields, so those are handled in Pass B).
    for (const field of flattenSectionFields(section)) {
      if (field.type !== 'photo') continue
      const k = key(section.section_id, field.field_id)
      const rowsForField = photoFieldBuckets.get(k) ?? []
      const rendered = rowsForField.slice(0, MAX_PHOTOS_PER_FIELD)
      const photos: ReportPhoto[] = await Promise.all(
        rendered.map(async (ph) => {
          const pathForSigning = ph.original_path ?? ph.storage_path
          const dataUri = await downloadToDataUri(service, PHOTO_BUCKET, pathForSigning)
          return { dataUri, caption: buildCaption(ph, nameLookup) }
        }),
      )
      photoFields.push({
        sectionId: section.section_id,
        fieldId: field.field_id,
        label: String(field.label ?? field.field_id),
        photos,
        omittedCount: Math.max(0, rowsForField.length - MAX_PHOTOS_PER_FIELD),
      })
    }

    // Pass B: repeating_group photo sub-fields.
    // The photo-routing step (step 6) correctly placed these rows into
    // photoFieldBuckets under their synthetic keys (e.g. "sec-1|grp[0].ph").
    // But Pass A never visits those keys because flattenSectionFields skips
    // group sub-fields. Drain them here, one ReportPhotoField per (group, entry,
    // photo-sub-field) triple, with an entry-aware label.
    for (const field of flattenSectionFields(section)) {
      if (field.type !== 'repeating_group') continue
      const groupLabel = String(field.label ?? field.field_id)
      const indices = collectGroupEntryIndices(field.field_id, responseList, section.section_id)
      for (const sub of (field.fields ?? []) as FlatField[]) {
        if (sub.type !== 'photo') continue
        const subLabel = String(sub.label ?? sub.field_id)
        for (const i of indices) {
          const synthetic = `${field.field_id}[${i}].${sub.field_id}`
          const k = key(section.section_id, synthetic)
          const rowsForField = photoFieldBuckets.get(k) ?? []
          if (rowsForField.length === 0) continue
          const rendered = rowsForField.slice(0, MAX_PHOTOS_PER_FIELD)
          const photos: ReportPhoto[] = await Promise.all(
            rendered.map(async (ph) => {
              const pathForSigning = ph.original_path ?? ph.storage_path
              const dataUri = await downloadToDataUri(service, PHOTO_BUCKET, pathForSigning)
              return { dataUri, caption: buildCaption(ph, nameLookup) }
            }),
          )
          photoFields.push({
            sectionId: section.section_id,
            fieldId: synthetic,
            label: `${groupLabel} — Entry ${i + 1}: ${subLabel}`,
            photos,
            omittedCount: Math.max(0, rowsForField.length - MAX_PHOTOS_PER_FIELD),
          })
        }
      }
    }

    reportSections.push({
      sectionId: section.section_id,
      title: String(section.title ?? '(untitled section)'),
      rows,
      groups,
      photoFields,
    })
  }

  // 8. Annexures are ONLY this inspection's own file-field uploads (source:'attachment').
  //    Project-wide handover docs are NOT pulled here (D5); the report is instead
  //    pushed INTO handover by the certify/regenerate flow (see fileIntoHandover).
  const annexures: ReportAnnexure[] = await Promise.all(
    fileAnnexureRows.map(async (ph) => {
      const name = (ph.caption as string | null) ?? 'attachment'
      const href = await signedUrl(service, ATTACHMENT_BUCKET, ph.storage_path)
      const isImage = IMAGE_EXT_RE.test(name) || IMAGE_EXT_RE.test(String(ph.storage_path ?? ''))
      const thumbnailDataUri = isImage
        ? await downloadToDataUri(service, ATTACHMENT_BUCKET, ph.storage_path)
        : null
      return { name, source: 'attachment' as const, href, thumbnailDataUri }
    }),
  )

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

  // 10. Audit appendix (response_history, already ordered).
  const audit: ReportAuditEntry[] = historyList.map((h) => ({
    at: (h.responded_at as string | null) ?? null,
    sectionId: (h.section_id as string | null) ?? null,
    fieldId: (h.field_id as string | null) ?? null,
    by: resolveName(h.responded_by),
  }))

  // 11. Summary — tally + failed list across ALL pass_fail responses, incl.
  //     group entries (failed-field labels mirror render.ts ~lines 553–600).
  //
  //     The outer flattenSectionFields loop hits group fields (type='repeating_group')
  //     as opaque entries. The inner block then RE-ENTERS the group's sub-fields via
  //     collectGroupEntryIndices + synthetic ids so group entries are tallied
  //     individually. This mirrors the split in the section-model builder (step 7)
  //     where flattenSectionFields intentionally skips group recursion.
  const tally = { pass: 0, fail: 0, na: 0 }
  const failed: Array<{ label: string; sansRef?: string | null }> = []
  for (const section of sections) {
    for (const field of flattenSectionFields(section)) {
      if (field.type === 'repeating_group') {
        const indices = collectGroupEntryIndices(field.field_id, responseList, section.section_id)
        for (const i of indices) {
          for (const sub of (field.fields ?? []) as FlatField[]) {
            const synthetic = `${field.field_id}[${i}].${sub.field_id}`
            const resp = responseList.find(
              (r) => r.section_id === section.section_id && r.field_id === synthetic,
            )
            if (sub.type === 'pass_fail') {
              const pill = passStateToPill(resp)
              if (pill === 'pass') tally.pass++
              else if (pill === 'fail') tally.fail++
              else if (pill === 'na') tally.na++
            }
            const isFail =
              (sub.type === 'pass_fail' && passStateToPill(resp) === 'fail') ||
              (sub.type === 'number' && resp?.pass_state === 'fail')
            if (isFail) {
              failed.push({
                label: `${section.title} → ${field.label ?? field.field_id} [entry ${i + 1}] → ${sub.label ?? sub.field_id}`,
                sansRef: sub.sans_ref ?? null,
              })
            }
          }
        }
        continue
      }

      const resp = responseList.find(
        (r) => r.section_id === section.section_id && r.field_id === field.field_id,
      )
      if (field.type === 'pass_fail') {
        const pill = passStateToPill(resp)
        if (pill === 'pass') tally.pass++
        else if (pill === 'fail') tally.fail++
        else if (pill === 'na') tally.na++
      }
      const isFail =
        (field.type === 'pass_fail' && passStateToPill(resp) === 'fail') ||
        (field.type === 'number' && resp?.pass_state === 'fail')
      if (isFail) {
        failed.push({
          label: `${section.title} → ${field.label ?? field.field_id}`,
          sansRef: field.sans_ref ?? null,
        })
      }
    }
  }

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

  return {
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
  }
}
