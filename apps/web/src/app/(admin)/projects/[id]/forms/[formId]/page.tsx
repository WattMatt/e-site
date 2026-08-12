import { notFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  projectService,
  FORMS_FIELD_ROLES,
  ORG_WRITE_ROLES,
  type Template,
} from '@esite/shared'
import {
  SITE_FORM_PHOTO_BUCKET,
  SITE_FORM_SIGNATURE_BUCKET,
} from '@/lib/site-forms/upload'
import CaptureForm from './CaptureForm'
import type { FormPhotoRow } from './FormPhotoStrip'
import type { FormSignatureRow } from './SignaturePad'

interface Props {
  params: Promise<{ id: string; formId: string }>
}

interface SiteFormRow {
  id: string
  form_no: string | null
  board_ref: string | null
  board_label: string | null
  status: string
  as_left_status: string | null
  void_reason: string | null
  created_by: string | null
  submitted_by: string | null
  submitted_at: string | null
  distributed_by: string | null
  distributed_at: string | null
  template_row_id: string
}

interface ReportRow {
  version: number
}

interface TemplateRow {
  id: string
  name: string
  version: string
  schema_json: unknown
}

interface ResponseRow {
  section_id: string
  field_id: string
  value_bool: boolean | null
  value_number: number | null
  value_text: string | null
  value_array: string[] | null
  pass_state: 'pass' | 'fail' | 'na' | 'not_checked' | null
  fail_reason: string | null
}

// The `field` schema is not in the generated DB types (same as `inspections`),
// so the client is narrowed to exactly the surface used here rather than cast
// to `any` — this file must not add lint warnings.
type PgError = { message: string } | null

interface SelectChain<T> extends PromiseLike<{ data: T[] | null; error: PgError }> {
  eq(column: string, value: string): SelectChain<T>
  order(column: string, opts: { ascending: boolean }): SelectChain<T>
  limit(count: number): SelectChain<T>
  maybeSingle(): PromiseLike<{ data: T | null; error: PgError }>
}

interface FieldSchemaClient {
  schema(name: string): {
    from(table: string): { select<T>(columns: string): SelectChain<T> }
  }
}

export default async function SiteFormCapturePage({ params }: Props) {
  const { id: projectId, formId } = await params

  const supabase = await createClient()
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const fdb = supabase as unknown as FieldSchemaClient

  // RLS is the read gate: site_forms_select already scopes this to the
  // caller's projects, and shows client_viewer only distributed records.
  const { data: form } = await fdb
    .schema('field')
    .from('site_forms')
    .select<SiteFormRow>(
      'id, form_no, board_ref, board_label, status, as_left_status, void_reason, created_by, submitted_by, submitted_at, distributed_by, distributed_at, template_row_id',
    )
    .eq('id', formId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!form) notFound()

  const { data: templateRow } = await fdb
    .schema('field')
    .from('form_templates')
    .select<TemplateRow>('id, name, version, schema_json')
    .eq('id', form.template_row_id)
    .maybeSingle()
  if (!templateRow) notFound()

  const template = templateRow.schema_json as Template
  if (!template || !Array.isArray(template.sections)) notFound()

  const [{ data: responseRows }, { data: photoRows }, { data: signatureRows }] = await Promise.all([
    fdb
      .schema('field')
      .from('form_responses')
      .select<ResponseRow>(
        'section_id, field_id, value_bool, value_number, value_text, value_array, pass_state, fail_reason',
      )
      .eq('form_id', formId),
    fdb
      .schema('field')
      .from('form_photos')
      .select<Omit<FormPhotoRow, 'signed_url'>>(
        'id, section_id, field_id, storage_path, caption, sort_order',
      )
      .eq('form_id', formId)
      .order('sort_order', { ascending: true }),
    fdb
      .schema('field')
      .from('form_signatures')
      .select<Omit<FormSignatureRow, 'signed_url' | 'signed_by_name'>>(
        'id, block_id, signatory_name, signatory_role, registration_category, registration_number, storage_path, signed_at, signed_by',
      )
      .eq('form_id', formId),
  ])

  const responses = responseRows ?? []
  const rawPhotos = photoRows ?? []
  const rawSignatures = signatureRows ?? []

  // Highest issued report version filed for this form. Read on the CALLER's
  // client (projects.reports RLS scopes it to their projects) — the panel only
  // uses it to name the version a re-distribution would issue, so a null here
  // degrades to "v1" rather than blocking anything.
  const { data: latestReport } = await fdb
    .schema('projects')
    .from('reports')
    .select<ReportRow>('version')
    .eq('source_table', 'site_forms')
    .eq('source_id', formId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  // One-hour signed URLs, batched per bucket. A failure to sign is not fatal:
  // the strip renders a placeholder and the record still shows the photo count.
  const photoUrls = new Map<string, string>()
  if (rawPhotos.length > 0) {
    const { data: signed } = await supabase.storage
      .from(SITE_FORM_PHOTO_BUCKET)
      .createSignedUrls(
        rawPhotos.map((p) => p.storage_path),
        3600,
      )
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) photoUrls.set(s.path, s.signedUrl)
    }
  }

  const signatureUrls = new Map<string, string>()
  if (rawSignatures.length > 0) {
    const { data: signed } = await supabase.storage
      .from(SITE_FORM_SIGNATURE_BUCKET)
      .createSignedUrls(
        rawSignatures.map((s) => s.storage_path),
        3600,
      )
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signatureUrls.set(s.path, s.signedUrl)
    }
  }

  // Names come from the SERVICE client: public.profiles RLS returns only the
  // caller's own row, so a cookie-client lookup leaves every name blank.
  const personIds = [
    ...new Set(
      [
        form.created_by,
        form.submitted_by,
        form.distributed_by,
        ...rawSignatures.map((s) => s.signed_by),
      ].filter(
        (x): x is string => !!x,
      ),
    ),
  ]
  const names = new Map<string, string>()
  if (personIds.length > 0) {
    const service = createServiceClient()
    const { data: profiles } = await service
      .from('profiles')
      .select('id, full_name')
      .in('id', personIds)
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name)
    }
  }

  // Capture is a field action (site electricians are usually `contractor`), and
  // only a draft is writable — the same window RLS and the actions enforce.
  const gate = await requireEffectiveRole(supabase as never, projectId, FORMS_FIELD_ROLES)
  const canEdit = gate.ok && form.status === 'draft'

  // Distribution and voiding are MANAGEMENT acts — putting the record in front
  // of the whole project team, or withdrawing one that already went out. The
  // gate is resolved once here and passed down; the actions re-check it.
  const writeGate = await requireEffectiveRole(supabase as never, projectId, ORG_WRITE_ROLES)
  const canDistribute = writeGate.ok

  const photos: FormPhotoRow[] = rawPhotos.map((p) => ({
    ...p,
    signed_url: photoUrls.get(p.storage_path) ?? null,
  }))

  const signatures: FormSignatureRow[] = rawSignatures.map((s) => ({
    ...s,
    signed_by_name: s.signed_by ? (names.get(s.signed_by) ?? null) : null,
    signed_url: signatureUrls.get(s.storage_path) ?? null,
  }))

  return (
    <CaptureForm
      projectId={projectId}
      projectName={project.name}
      formId={formId}
      formNo={form.form_no}
      boardLabel={form.board_label ?? form.board_ref ?? 'Board not identified'}
      status={form.status}
      voidReason={form.void_reason}
      template={template}
      templateName={templateRow.name}
      templateVersion={templateRow.version}
      initialResponses={responses.map((r) => ({
        section_id: r.section_id,
        field_id: r.field_id,
        value_bool: r.value_bool,
        value_number: r.value_number,
        value_text: r.value_text,
        value_array: r.value_array,
        pass_state: r.pass_state ?? undefined,
        fail_reason: r.fail_reason,
      }))}
      initialPhotos={photos}
      initialSignatures={signatures}
      currentUserId={user?.id ?? null}
      createdByName={form.created_by ? (names.get(form.created_by) ?? null) : null}
      submittedByName={form.submitted_by ? (names.get(form.submitted_by) ?? null) : null}
      submittedAt={form.submitted_at}
      canEdit={canEdit}
      canDistribute={canDistribute}
      asLeftStatus={form.as_left_status}
      currentReportVersion={latestReport?.version ?? null}
      distributedAt={form.distributed_at}
      distributedByName={form.distributed_by ? (names.get(form.distributed_by) ?? null) : null}
      todayISO={new Date().toISOString().slice(0, 10)}
    />
  )
}
