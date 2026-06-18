/**
 * Render an inspection's branded report (Node renderer — no glyph bug),
 * save it versioned to projects.reports, supersede prior issued rows, then
 * auto-file the cert + the inspection's own file-uploads into handover with
 * origin provenance. RLS-bypassing service client — callers authorize.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { gatherInspectionReportData } from './inspection-report-data'
import { renderInspectionReport } from './render-inspection'
import { resolveBranding, type BrandingInput } from './branding'
import { fileIntoHandover } from '@/lib/handover/handover-filing'
import { buildHandoverDrawingName } from '@esite/shared'

const REPORTS_BUCKET = 'reports'
const ATTACHMENT_BUCKET = 'inspection-attachments'

export async function generateAndFileInspectionReport(params: {
  inspectionId: string
  projectId: string
  orgId: string
  userId: string
}): Promise<{ reportId: string; storagePath: string } | { error: string }> {
  const { inspectionId, projectId, orgId, userId } = params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // ── 1. Gather + render the PDF ─────────────────────────────────────────────
  let pdfBuffer: Buffer
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
    const issuerWordmark = (branding.issuer as { wordmark?: string }).wordmark
    brandingSnapshot = {
      accent: branding.accent,
      issuer: issuerWordmark ? { wordmark: issuerWordmark } : { hasLogo: true },
      kicker: branding.kicker,
      projectLine: branding.projectLine,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  // ── 2. Title (COC number) + template (for file-field detection) ────────────
  const { data: insp } = await service
    .schema('inspections')
    .from('inspections')
    .select('coc_number, template_id')
    .eq('id', inspectionId)
    .maybeSingle()
  const coc = (insp?.coc_number as string | null) ?? null
  const templateId = insp?.template_id as string | undefined

  // ── 3. Version vs prior issued ─────────────────────────────────────────────
  const { data: priorRow } = await service
    .schema('projects')
    .from('reports')
    .select('id, version')
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // ── 4. Upload PDF to the reports bucket ────────────────────────────────────
  const storagePath = `${orgId}/${projectId}/inspection-${inspectionId}-v${newVersion}.pdf`
  const { error: upErr } = await service.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  // ── 5. Insert projects.reports row ─────────────────────────────────────────
  const { data: newReport, error: insErr } = await service
    .schema('projects')
    .from('reports')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      kind: 'inspection',
      source_table: 'inspections',
      source_id: inspectionId,
      title: coc ? `Certificate ${coc}` : 'Inspection & Test Report',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdfBuffer.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      generated_by: userId,
    })
    .select('id')
    .single()
  if (insErr || !newReport) {
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return { error: `Failed to save report record: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  const reportId = (newReport as { id: string }).id

  // ── 6. Supersede all prior issued rows for this inspection ─────────────────
  await service
    .schema('projects')
    .from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('source_table', 'inspections')
    .eq('source_id', inspectionId)
    .eq('status', 'issued')
    .neq('id', reportId)

  // ── 7. Dedup prior auto-filed handover docs for THIS inspection ────────────
  const { data: priorDocs } = await service
    .schema('tenants')
    .from('documents')
    .select('id, storage_path')
    .eq('origin_kind', 'inspection')
    .eq('origin_id', inspectionId)
  const priorList = (priorDocs ?? []) as Array<{ id: string; storage_path: string }>
  if (priorList.length > 0) {
    await service.storage
      .from('project-documents')
      .remove(priorList.map((d) => d.storage_path))
      .catch(() => undefined)
    await service
      .schema('tenants')
      .from('documents')
      .delete()
      .eq('origin_kind', 'inspection')
      .eq('origin_id', inspectionId)
  }

  // ── 8. File the cert PDF → compliance_certs (best-effort) ──────────────────
  const certName = coc ? `${coc}.pdf` : `inspection-${inspectionId}.pdf`
  const certFiled = await fileIntoHandover(service, {
    orgId,
    projectId,
    category: 'compliance_certs',
    name: certName,
    bytes: pdfBuffer,
    mimeType: 'application/pdf',
    originKind: 'inspection',
    originId: inspectionId,
    userId,
  })
  if ('error' in certFiled) console.warn('[file-inspection-report] cert handover filing failed:', certFiled.error)

  // ── 9. File the inspection's own file-uploads → test_certificates ──────────
  //     Top-level + subsection `file` fields only (group-nested excluded in v1):
  //     their photos rows carry a synthetic field_id that won't match these ids.
  const { data: template } = await service
    .schema('inspections')
    .from('templates')
    .select('schema_json')
    .eq('id', templateId)
    .maybeSingle()
  const fileFieldLabels = new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = (template?.schema_json as any) ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const section of (schema.sections ?? []) as Array<Record<string, any>>) {
    const fields = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((section.fields ?? []) as Array<Record<string, any>>),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((section.subsections ?? []).flatMap((ss: any) => ss.fields ?? []) as Array<Record<string, any>>),
    ]
    for (const f of fields) {
      if (f.type === 'file') fileFieldLabels.set(String(f.field_id), String(f.label ?? f.field_id))
    }
  }
  if (fileFieldLabels.size > 0) {
    const { data: photos } = await service
      .schema('inspections')
      .from('photos')
      .select('field_id, storage_path, caption')
      .eq('inspection_id', inspectionId)
    for (const ph of (photos ?? []) as Array<{ field_id: string; storage_path: string; caption: string | null }>) {
      const label = fileFieldLabels.get(ph.field_id)
      if (!label) continue // photo field, orphan, or group-nested file — skip
      const { data: blob } = await service.storage.from(ATTACHMENT_BUCKET).download(ph.storage_path)
      if (!blob) continue
      const bytes = Buffer.from(await (blob as Blob).arrayBuffer())
      const fileName = ph.caption ?? 'attachment'
      const filed = await fileIntoHandover(service, {
        orgId,
        projectId,
        category: 'test_certificates',
        name: buildHandoverDrawingName(label, fileName),
        bytes,
        mimeType: (blob as Blob).type || null,
        originKind: 'inspection',
        originId: inspectionId,
        userId,
      })
      if ('error' in filed) console.warn('[file-inspection-report] upload handover filing failed:', filed.error)
    }
  }

  return { reportId, storagePath }
}
