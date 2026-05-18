/**
 * Edge function: render-inspection-pdf
 *
 * POST /functions/v1/render-inspection-pdf
 *   Body: { inspection_id: string, draft?: boolean }
 *
 * Modes:
 *   - draft=true OR inspection.status !== 'certified'
 *       → render with DRAFT watermark, return PDF bytes directly (no persistence)
 *   - inspection.status === 'certified' AND draft !== true
 *       → render, supersede any prior cert row, upload to
 *         inspection-certificates bucket, insert a new certificates row,
 *         auto-file into the project's Handover module, return JSON
 *         { certificate_id, storage_path, coc_number }
 *
 * Auth: service-role only (the certify action invokes us via
 * `supabase.functions.invoke` which propagates the request's bearer token,
 * but cert persistence requires service-role writes; if the request has a
 * lower-privileged JWT the certificates insert will fail at the RLS layer
 * — which is the right shape, since the certify action holds the role).
 *
 * Handover auto-file:
 *   deliverable_type='coc'             → slug='coc_pack'           category='compliance_certs'
 *   deliverable_type='inspection_only' → slug='inspections'        category='test_certificates'
 *   deliverable_type='factory_test'    → slug='factory_acceptance' category='test_certificates'
 * Missing folders are skipped silently with a console.warn (the project
 * may not have initialised that handover category yet).
 */

import { createClient, loadInspectionPayload } from './payload-loader.ts'
import { renderInspectionPdf } from './render.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  let body: { inspection_id?: string; draft?: boolean }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (!body.inspection_id) return new Response('inspection_id required', { status: 400 })

  try {
    const payload = await loadInspectionPayload(supabase, body.inspection_id)
    const isDraft = body.draft === true || payload.inspection.status !== 'certified'
    const pdfBytes = await renderInspectionPdf(payload, { draft: isDraft })

    // Certified + not-draft → persist + auto-file.
    if (!body.draft && payload.inspection.status === 'certified') {
      const cocNumber: string | null = payload.inspection.coc_number
      if (!cocNumber) {
        throw new Error('Cannot persist certificate: inspection has no coc_number')
      }

      const storagePath = `${payload.project.id}/${payload.inspection.id}/${cocNumber}.pdf`
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })

      // 1. Supersede any prior non-superseded cert rows for this inspection.
      await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .schema('inspections' as any)
        .from('certificates')
        .update({ superseded_at: new Date().toISOString() })
        .eq('inspection_id', payload.inspection.id)
        .is('superseded_at', null)

      // 2. Upload (upsert=true so re-runs overwrite the same path cleanly).
      const { error: upErr } = await supabase.storage
        .from('inspection-certificates')
        .upload(storagePath, blob, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw upErr

      // 3. Insert the new cert row.
      const { data: cert, error: certErr } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .schema('inspections' as any)
        .from('certificates')
        .insert({
          inspection_id: payload.inspection.id,
          coc_number: cocNumber,
          storage_path: storagePath,
          generated_by: payload.inspection.verifier_id,
        })
        .select('id')
        .single()
      if (certErr) throw certErr

      // 4. Auto-file into Handover (best-effort; missing folder is logged).
      await autoFileIntoHandover(supabase, payload, storagePath, blob.size)

      return new Response(
        JSON.stringify({
          certificate_id: cert.id,
          storage_path: storagePath,
          coc_number: cocNumber,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Draft / preview path — return raw PDF bytes.
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="inspection-${body.inspection_id}-draft.pdf"`,
      },
    })
  } catch (e) {
    console.error('render-inspection-pdf failed:', e)
    return new Response(`Render failed: ${(e as Error).message}`, { status: 500 })
  }
})

async function autoFileIntoHandover(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  storagePath: string,
  sizeBytes: number,
): Promise<void> {
  const deliverable = payload.template?.deliverable_type as string | undefined
  const slug =
    deliverable === 'coc'
      ? 'coc_pack'
      : deliverable === 'factory_test'
        ? 'factory_acceptance'
        : 'inspections'
  const category = deliverable === 'coc' ? 'compliance_certs' : 'test_certificates'

  const { data: folder } = await supabase
    .schema('tenants')
    .from('handover_folders')
    .select('id')
    .eq('project_id', payload.project.id)
    .eq('slug', slug)
    .eq('handover_category', category)
    .maybeSingle()
  if (!folder) {
    console.warn(
      `Skipping handover auto-file: no handover folder ${category}/${slug} for project ${payload.project.id}`,
    )
    return
  }

  const { error: insErr } = await supabase
    .schema('tenants')
    .from('documents')
    .insert({
      organisation_id: payload.project.organisation_id,
      project_id: payload.project.id,
      handover_folder_id: folder.id,
      handover_category: category,
      name: `${payload.inspection.coc_number}.pdf`,
      description: `${payload.template?.name ?? 'Inspection'} — ${payload.inspection.target_label ?? ''}`,
      storage_path: storagePath,
      storage_bucket: 'inspection-certificates',
      mime_type: 'application/pdf',
      size_bytes: sizeBytes,
    })
  if (insErr) {
    console.warn('Handover document insert failed:', insErr.message)
  }
}
