/**
 * generateAndFileInspectionReport — render the branded inspection certificate,
 * save it versioned to projects.reports, and auto-file it (+ the in-inspection
 * file uploads) into the handover pack.
 *
 * NOT a 'use server' module: it performs NO auth gate. Callers authorize first:
 *   - certifyInspectionAction (the assigned verifier is already authorized)
 *   - regenerateInspectionReportAction (gates to ORG_WRITE_ROLES)
 * gatherInspectionReportData still self-gates the READ over all project roles
 * using the caller's cookie session; the privileged WRITES use the service
 * client passed through createServiceClient (RLS-bypassing) — same pattern as
 * exportSnagVisitReportAction.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { gatherInspectionReportData } from './inspection-report-data'
import { renderInspectionReport } from './render-inspection'
import { resolveBranding, type BrandingInput } from './branding'
import { fileIntoHandover } from '@/lib/handover/handover-filing'
import { buildHandoverDrawingName } from '@esite/shared'

/* eslint-disable @typescript-eslint/no-explicit-any */
const REPORTS_BUCKET = 'reports'
const ATTACHMENTS_BUCKET = 'inspection-attachments'
const HANDOVER_BUCKET = 'project-documents'

export interface GenerateInspectionReportArgs {
  inspectionId: string
  projectId: string
  orgId: string
  userId: string
}
export type GenerateInspectionReportResult =
  | { error: string }
  | { reportId: string; storagePath: string }

/** Top-level `file`-type uploads (section + subsection fields). Group-nested
 *  file fields are NOT separately filed in v1 (they still render as report
 *  annexures); revisit if a template needs them. */
async function listInspectionFileUploads(
  service: any,
  inspectionId: string,
): Promise<Array<{ storagePath: string; filename: string; label: string }>> {
  const { data: insp } = await service.schema('inspections').from('inspections')
    .select('template_id').eq('id', inspectionId).maybeSingle()
  if (!insp) return []
  const { data: tmpl } = await service.schema('inspections').from('templates')
    .select('schema_json').eq('id', insp.template_id).maybeSingle()
  const schema = (tmpl?.schema_json ?? {}) as any
  const fileFields = new Map<string, string>() // field_id → label
  for (const section of (schema.sections ?? []) as any[]) {
    const fields = [
      ...((section.fields ?? []) as any[]),
      ...(((section.subsections ?? []) as any[]).flatMap((ss: any) => ss.fields ?? [])),
    ]
    for (const f of fields) {
      if (f.type === 'file') fileFields.set(String(f.field_id), String(f.label ?? f.field_id))
    }
  }
  if (fileFields.size === 0) return []
  const { data: photos } = await service.schema('inspections').from('photos')
    .select('field_id, storage_path, caption')
    .eq('inspection_id', inspectionId)
    .in('field_id', [...fileFields.keys()])
  return ((photos ?? []) as any[]).map((p) => ({
    storagePath: String(p.storage_path),
    filename: (p.caption as string | null) ?? 'attachment',
    label: fileFields.get(String(p.field_id)) ?? '',
  }))
}

/** Delete prior auto-filed handover docs for this inspection (storage + rows). */
async function deletePriorHandoverDocs(service: any, inspectionId: string): Promise<void> {
  const { data: priors } = await service.schema('tenants').from('documents')
    .select('id, storage_path').eq('origin_kind', 'inspection').eq('origin_id', inspectionId)
  const rows = (priors ?? []) as Array<{ id: string; storage_path: string }>
  if (rows.length === 0) return
  const paths = rows.map((r) => r.storage_path).filter(Boolean)
  if (paths.length) await service.storage.from(HANDOVER_BUCKET).remove(paths).catch(() => undefined)
  await service.schema('tenants').from('documents').delete()
    .eq('origin_kind', 'inspection').eq('origin_id', inspectionId)
}

export async function generateAndFileInspectionReport(
  args: GenerateInspectionReportArgs,
): Promise<GenerateInspectionReportResult> {
  const { inspectionId, projectId, orgId, userId } = args

  // 1. Gather + render (gather self-gates the READ via the caller's session).
  let pdfBuffer: Buffer
  let documentNumber: string
  let title: string
  let brandingSnapshot: unknown
  try {
    const data = await gatherInspectionReportData(inspectionId)
    const today = new Date().toISOString().slice(0, 10)
    const bi = data.brandingInput
    const input: BrandingInput = {
      org: { name: bi.orgName, logoSrc: bi.orgLogoDataUri ?? undefined, accent: bi.orgAccent },
      project: {
        name: data.summary.projectName,
        clientLogoSrc: bi.clientLogoDataUri ?? undefined,
        projectMarkSrc: bi.projectMarkDataUri ?? undefined,
        accent: bi.projectAccent,
        subtitle: bi.projectSubtitle || undefined,
      },
      contractor: null,
      title: 'Inspection & Test Report',
      kicker: 'ELECTRICAL INSPECTION',
      date: today,
    }
    const branding = resolveBranding(input)
    pdfBuffer = await renderInspectionReport(data, branding)
    documentNumber = data.summary.documentNumber
    title = `${data.summary.templateName} — ${documentNumber}`
    brandingSnapshot = {
      accent: branding.accent,
      issuer: branding.issuer.wordmark ? { wordmark: branding.issuer.wordmark } : { hasLogo: true },
      kicker: branding.kicker,
      projectLine: branding.projectLine,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generateAndFileInspectionReport] gather/render error', err)
    return { error: msg }
  }

  const service = createServiceClient() as any

  // 2. Version.
  const { data: priorRow } = await service.schema('projects').from('reports')
    .select('id, version')
    .eq('source_table', 'inspections').eq('source_id', inspectionId).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // 3. Upload to the reports bucket.
  const storagePath = `${orgId}/${projectId}/inspection-${inspectionId}-v${newVersion}.pdf`
  const { error: upErr } = await service.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, new Uint8Array(pdfBuffer), { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  // 4. Insert projects.reports.
  const { data: newReport, error: insErr } = await service.schema('projects').from('reports').insert({
    organisation_id: orgId,
    project_id: projectId,
    kind: 'inspection',
    source_table: 'inspections',
    source_id: inspectionId,
    title,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdfBuffer.length,
    status: 'issued',
    version: newVersion,
    branding_snapshot: brandingSnapshot,
    generated_by: userId,
  }).select('id').single()
  if (insErr || !newReport) {
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return { error: `Failed to save report record: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  const reportId = (newReport as { id: string }).id

  // 5. Supersede all prior issued rows.
  const { error: supErr } = await service.schema('projects').from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('source_table', 'inspections').eq('source_id', inspectionId).eq('status', 'issued').neq('id', reportId)
  if (supErr) console.error('[generateAndFileInspectionReport] supersede error', supErr)

  // 6. Dedup prior auto-filed handover docs for this inspection.
  try {
    await deletePriorHandoverDocs(service, inspectionId)
  } catch (e) {
    console.error('[generateAndFileInspectionReport] dedup error', e)
  }

  // 7. File the report PDF → compliance_certs (best-effort: cert row already saved).
  const reportFiled = await fileIntoHandover(service, {
    orgId, projectId, category: 'compliance_certs',
    name: `Inspection Report ${documentNumber}.pdf`,
    bytes: new Uint8Array(pdfBuffer), mimeType: 'application/pdf',
    originKind: 'inspection', originId: inspectionId, userId,
  })
  if ('error' in reportFiled) console.error('[generateAndFileInspectionReport] file report failed', reportFiled.error)

  // 8. File each file-field upload → test_certificates (best-effort).
  const uploads = await listInspectionFileUploads(service, inspectionId)
  for (const u of uploads) {
    const dl = await service.storage.from(ATTACHMENTS_BUCKET).download(u.storagePath)
    if (dl.error || !dl.data) {
      console.error('[generateAndFileInspectionReport] upload download failed', u.storagePath, dl.error)
      continue
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const filed = await fileIntoHandover(service, {
      orgId, projectId, category: 'test_certificates',
      name: buildHandoverDrawingName(u.label, u.filename),
      bytes, mimeType: (dl.data as Blob).type || null,
      originKind: 'inspection', originId: inspectionId, userId,
    })
    if ('error' in filed) console.error('[generateAndFileInspectionReport] file upload failed', u.filename, filed.error)
  }

  return { reportId, storagePath }
}
