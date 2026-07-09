'use server'

/**
 * RFI annotation server actions.
 *
 * Save flow per migration 00033:
 *   1. Upload composited PNG to `rfi_attachments` storage bucket.
 *   2. Insert public.attachments row (entity_type='rfi', entity_id=rfiId).
 *   3. Insert public.rfi_annotations row referencing the attachment plus
 *      the source floor plan and the editable scene-graph JSON.
 *
 * On failure of step 2 or 3 we best-effort roll back the prior step so we
 * don't leave orphan files or rows. Storage/DB writes can't share a tx,
 * so this is the closest we can get without an Edge Function.
 *
 * Authorization (defense-in-depth): both writes gate on the caller's EFFECTIVE
 * project role via requireEffectiveRole(MARKUP_WRITE_ROLES) — the same write
 * set as the /rfis and /floor-plans rows in docs/rbac-matrix.md — BEFORE any
 * storage upload or DB insert. The database RLS backstop (migrations
 * 00161/00162) independently blocks the read-only client_viewer; this app-layer
 * gate additionally excludes inspector/supplier and fails fast with a clear
 * message instead of a raw RLS violation. Never rely on RLS alone here.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { MARKUP_WRITE_ROLES } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'

const PNG_MAX_BYTES = 20 * 1024 * 1024 // 20MB — bucket cap per migration 00033

const CreateSchema = z.object({
  rfiId: z.string().uuid(),
  sourceFloorPlanId: z.string().uuid(),
  sceneJson: z.unknown(), // arbitrary scene graph; rendered client-side
  pngBase64: z.string().min(64), // raw base64 (no `data:` prefix)
})

const UpdateSchema = z.object({
  annotationId: z.string().uuid(),
  sceneJson: z.unknown(),
  pngBase64: z.string().min(64),
})

export async function createRfiAnnotationAction(
  input: z.infer<typeof CreateSchema>,
): Promise<{ annotationId?: string; attachmentId?: string; error?: string }> {
  const parsed = CreateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: rfi, error: rfiErr } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .select('id, organisation_id, project_id')
    .eq('id', parsed.data.rfiId)
    .single()
  if (rfiErr || !rfi) return { error: 'RFI not found' }

  // Authorize BEFORE touching storage/DB so a rejected caller leaves no trace.
  const gate = await requireEffectiveRole(supabase, rfi.project_id, MARKUP_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  const png = Buffer.from(parsed.data.pngBase64, 'base64')
  if (png.length > PNG_MAX_BYTES) return { error: 'Markup PNG exceeds 20 MB' }

  const fileName = `markup-${Date.now()}.png`
  const filePath = `${rfi.organisation_id}/${parsed.data.rfiId}/${fileName}`

  const { error: upErr } = await supabase.storage
    .from('rfi-attachments')
    .upload(filePath, png, { contentType: 'image/png', upsert: false })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  const { data: att, error: attErr } = await (supabase as any)
    .from('attachments')
    .insert({
      organisation_id: rfi.organisation_id,
      entity_type: 'rfi',
      entity_id: parsed.data.rfiId,
      file_path: filePath,
      file_name: fileName,
      file_size_bytes: png.length,
      mime_type: 'image/png',
      uploaded_by: user.id,
    })
    .select('id')
    .single()
  if (attErr || !att) {
    try { await supabase.storage.from('rfi-attachments').remove([filePath]) } catch { /* ignore */ }
    return { error: `Attachment insert failed: ${attErr?.message ?? '?'}` }
  }

  const { data: ann, error: annErr } = await (supabase as any)
    .from('rfi_annotations')
    .insert({
      rfi_id: parsed.data.rfiId,
      organisation_id: rfi.organisation_id,
      attachment_id: att.id,
      source_floor_plan_id: parsed.data.sourceFloorPlanId,
      annotation_data: parsed.data.sceneJson,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (annErr || !ann) {
    try { await supabase.from('attachments').delete().eq('id', att.id) } catch { /* ignore */ }
    try { await supabase.storage.from('rfi-attachments').remove([filePath]) } catch { /* ignore */ }
    return { error: `Annotation insert failed: ${annErr?.message ?? '?'}` }
  }

  revalidatePath(`/rfis/${parsed.data.rfiId}`)
  revalidatePath(
    `/projects/${rfi.project_id}/floor-plans/${parsed.data.sourceFloorPlanId}`,
  )
  return { annotationId: ann.id, attachmentId: att.id }
}

export async function updateRfiAnnotationAction(
  input: z.infer<typeof UpdateSchema>,
): Promise<{ annotationId?: string; rfiId?: string; error?: string }> {
  const parsed = UpdateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: ann, error: annErr } = await (supabase as any)
    .from('rfi_annotations')
    .select('id, rfi_id, attachment_id, source_floor_plan_id, organisation_id')
    .eq('id', parsed.data.annotationId)
    .single()
  if (annErr || !ann) return { error: 'Annotation not found' }

  // Resolve the owning project, then authorize on the caller's effective
  // project role BEFORE re-uploading the composited PNG or mutating the row.
  const { data: rfi, error: rfiErr } = await (supabase as any)
    .schema('projects')
    .from('rfis')
    .select('project_id')
    .eq('id', ann.rfi_id)
    .single()
  if (rfiErr || !rfi) return { error: 'RFI not found' }
  const gate = await requireEffectiveRole(supabase, rfi.project_id, MARKUP_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  const { data: att, error: attErr } = await (supabase as any)
    .from('attachments')
    .select('id, file_path')
    .eq('id', ann.attachment_id)
    .single()
  if (attErr || !att) return { error: 'Attachment not found' }

  const png = Buffer.from(parsed.data.pngBase64, 'base64')
  if (png.length > PNG_MAX_BYTES) return { error: 'Markup PNG exceeds 20 MB' }

  const { error: upErr } = await supabase.storage
    .from('rfi-attachments')
    .upload(att.file_path, png, { contentType: 'image/png', upsert: true })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  const { error: updErr } = await (supabase as any)
    .from('rfi_annotations')
    .update({ annotation_data: parsed.data.sceneJson })
    .eq('id', parsed.data.annotationId)
  if (updErr) return { error: `Annotation update failed: ${updErr.message}` }

  await (supabase as any)
    .from('attachments')
    .update({ file_size_bytes: png.length })
    .eq('id', att.id)

  revalidatePath(`/rfis/${ann.rfi_id}`)
  if (ann.source_floor_plan_id) {
    revalidatePath(
      `/projects/(.*)/floor-plans/${ann.source_floor_plan_id}`,
      'page',
    )
  }
  return { annotationId: ann.id, rfiId: ann.rfi_id }
}
