'use server'

import { readFileSync } from 'node:fs'
import { join }         from 'node:path'
import { randomUUID }   from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { hasFeature } from '@/lib/features'
import { JBCC_WRITE_ROLES } from '@esite/shared'
import {
  createParty, updateParty, deleteParty, partyInputSchema,
  getNotice, getNoticeFields, listParties,
  createLetter, updateLetterContent, transitionLetter, logLetterEvent,
  addLetterRecipient, canTransitionLetter, computeDeadline,
  generateLetterSchema, previewLetterSchema, letterLifecycleSchema,
  getLetter, deleteLetter,
  createLetterAttachment, deleteLetterAttachment, listLetterAttachments,
  buildLetterValues,
  type JbccParty, type LetterStatus,
} from '@esite/shared'
// fillTemplate / injectLetterhead / docxToHtml import docxtemplater + pizzip +
// mammoth — kept out of the @esite/shared barrel and behind sub-path entries so
// the admin layout's barrel load chain doesn't pull those modules in.
import { fillTemplate } from '@esite/shared/placeholder-fill'
import { injectLetterhead } from '@esite/shared/docx-letterhead'
import { docxToHtml, renderLetterheadHtml } from '@esite/shared/docx-preview'
import { resolveOrgLetterhead, toDocxBranding, toHtmlBranding } from '@/lib/jbcc/letterhead'

export type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string }

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// ---------------------------------------------------------------------------
// Guard — resolves org from the project, enforces per-project JBCC write role
// (honours project_members promotions) AND the paid feature unlock. Returns a
// ready-to-use client + context, or a typed failure.
// ---------------------------------------------------------------------------

type Guard =
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; orgId: string; userId: string }
  | { ok: false; error: string }

async function guardJbcc(projectId: string): Promise<Guard> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { data: proj } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  const orgId = (proj as { organisation_id: string } | null)?.organisation_id
  if (!orgId) return { ok: false, error: 'Project not found' }

  const roleGate = await requireEffectiveRole(supabase, projectId, JBCC_WRITE_ROLES)
  if (!roleGate.ok) return { ok: false, error: 'You do not have permission to manage JBCC notices on this project.' }

  const unlocked = await hasFeature(orgId, 'jbcc', supabase as any)
  if (!unlocked) return { ok: false, error: 'The JBCC module is not unlocked for this organisation.' }

  return { ok: true, supabase, orgId, userId: user.id }
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

export async function createPartyAction(projectId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const parsed = partyInputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  try {
    const party = await createParty(g.supabase as any, {
      project_id: projectId, organisation_id: g.orgId, created_by: g.userId, ...parsed.data,
    })
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    revalidatePath(`/projects/${projectId}/settings/jbcc-parties`)
    return { ok: true, data: { id: party.id } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Create failed' }
  }
}

export async function updatePartyAction(projectId: string, partyId: string, raw: unknown): Promise<ActionResult> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const parties = await listParties(g.supabase as any, projectId)
  if (!parties.some((p: JbccParty) => p.id === partyId)) return { ok: false, error: 'Party not found' }

  const parsed = partyInputSchema.partial().safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  try {
    await updateParty(g.supabase as any, partyId, parsed.data)
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' }
  }
}

export async function deletePartyAction(projectId: string, partyId: string): Promise<ActionResult> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const parties = await listParties(g.supabase as any, projectId)
  if (!parties.some((p: JbccParty) => p.id === partyId)) return { ok: false, error: 'Party not found' }

  try {
    await deleteParty(g.supabase as any, partyId)
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' }
  }
}

// ---------------------------------------------------------------------------
// Shared: assemble the value map + branding for a letter (real or specimen)
// ---------------------------------------------------------------------------

async function loadLetterContext(
  supabase: any, projectId: string, orgId: string, userId: string,
) {
  const [{ data: project }, { data: profile }, letterhead] = await Promise.all([
    supabase.schema('projects').from('projects').select('name, code').eq('id', projectId).maybeSingle(),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    resolveOrgLetterhead(orgId),
  ])
  return {
    projectName: (project as { name: string } | null)?.name ?? null,
    signatoryName: (profile as { full_name: string } | null)?.full_name ?? null,
    letterhead,
  }
}

function templateBytesFor(templateFile: string): Buffer {
  // process.cwd() resolves to apps/web in the Next.js server context.
  return readFileSync(join(process.cwd(), 'src', 'lib', 'jbcc', 'templates', templateFile))
}

// ---------------------------------------------------------------------------
// previewLetterAction — renders an EXAMPLE letter from the onset (no recipient
// or fields required). Blanks show as [Label] specimen markers.
// ---------------------------------------------------------------------------

export async function previewLetterAction(
  projectId: string, raw: unknown,
): Promise<ActionResult<{ headerHtml: string; bodyHtml: string; noticeTitle: string; noticeCode: string }>> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const parsed = previewLetterSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { notice_code, recipient_party_id, trigger_date, manual_values } = parsed.data

  const notice = await getNotice(g.supabase as any, notice_code)
  if (!notice) return { ok: false, error: 'Notice not found' }
  const fields = await getNoticeFields(g.supabase as any, notice.id)

  let recipient: { name: string; company: string | null; address: string | null; party_role: string } | null = null
  if (recipient_party_id) {
    const { data } = await (g.supabase as any)
      .schema('projects').from('jbcc_parties').select('name, company, address, party_role')
      .eq('id', recipient_party_id).eq('project_id', projectId).maybeSingle()
    recipient = data ?? null
  }

  const ctx = await loadLetterContext(g.supabase, projectId, g.orgId, g.userId)
  const today = new Date().toISOString().slice(0, 10)

  const values = buildLetterValues({
    today,
    documentRef: null,
    recipient: recipient
      ? { name: recipient.name, company: recipient.company, address: recipient.address, partyRole: recipient.party_role }
      : null,
    sender: {
      signatoryName: ctx.signatoryName,
      signatoryTitle: ctx.letterhead?.signatoryTitle ?? null,
      companyName: ctx.letterhead?.companyName ?? null,
      addressLines: ctx.letterhead?.addressLines ?? [],
    },
    projectName: ctx.projectName,
    triggerDate: trigger_date ?? null,
    manualValues: manual_values,
    manualFields: fields.filter((f) => f.source === 'manual').map((f) => ({ placeholder: f.placeholder, label: f.label })),
    specimen: true,
  })

  let bodyHtml: string
  try {
    const filled = fillTemplate(templateBytesFor(notice.template_file), values)
    bodyHtml = await docxToHtml(filled)
  } catch (e) {
    return { ok: false, error: `Preview failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  const headerHtml = renderLetterheadHtml(
    ctx.letterhead
      ? toHtmlBranding(ctx.letterhead, 'JBCC-…-#### (assigned on generation)')
      : { companyName: ctx.projectName ?? 'Your organisation', documentRef: 'JBCC-…-#### (assigned on generation)' },
  )

  return { ok: true, data: { headerHtml, bodyHtml, noticeTitle: notice.title, noticeCode: notice.code } }
}

// ---------------------------------------------------------------------------
// downloadExampleAction — a branded SPECIMEN .docx (no persistence, no number
// consumed). Lets a user download an example even before parties exist.
// ---------------------------------------------------------------------------

export async function downloadExampleAction(
  projectId: string, raw: unknown,
): Promise<ActionResult<{ filename: string; base64: string }>> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const parsed = previewLetterSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { notice_code, trigger_date, manual_values } = parsed.data

  const notice = await getNotice(g.supabase as any, notice_code)
  if (!notice) return { ok: false, error: 'Notice not found' }
  const fields = await getNoticeFields(g.supabase as any, notice.id)
  const ctx = await loadLetterContext(g.supabase, projectId, g.orgId, g.userId)
  const today = new Date().toISOString().slice(0, 10)

  const values = buildLetterValues({
    today,
    documentRef: 'SPECIMEN — NOT FOR ISSUE',
    sender: {
      signatoryName: ctx.signatoryName,
      signatoryTitle: ctx.letterhead?.signatoryTitle ?? null,
      companyName: ctx.letterhead?.companyName ?? null,
      addressLines: ctx.letterhead?.addressLines ?? [],
    },
    projectName: ctx.projectName,
    triggerDate: trigger_date ?? null,
    manualValues: manual_values,
    manualFields: fields.filter((f) => f.source === 'manual').map((f) => ({ placeholder: f.placeholder, label: f.label })),
    specimen: true,
  })

  try {
    const filled = fillTemplate(templateBytesFor(notice.template_file), values)
    const doc = ctx.letterhead
      ? injectLetterhead(filled, toDocxBranding(ctx.letterhead, 'SPECIMEN — NOT FOR ISSUE'))
      : filled
    return { ok: true, data: { filename: `${notice.code}-EXAMPLE.docx`, base64: doc.toString('base64') } }
  } catch (e) {
    return { ok: false, error: `Example failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// generateLetterAction — creates a CONTROLLED draft letter (ISO reference
// allocated by the DB trigger), fills + brands the .docx, uploads it, records
// the distribution list and the 'created' audit event.
// ---------------------------------------------------------------------------

export async function generateLetterAction(
  projectId: string, raw: unknown,
): Promise<ActionResult<{ letterId: string; documentPath: string; letterReference: string | null }>> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { supabase, orgId, userId } = g

  const parsed = generateLetterSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { notice_code, recipient_party_id, trigger_date, manual_values, subject, cc_party_ids } = parsed.data

  const notice = await getNotice(supabase as any, notice_code)
  if (!notice) return { ok: false, error: 'Notice not found' }

  // Recipient must belong to this project.
  const { data: recipient } = await (supabase as any)
    .schema('projects').from('jbcc_parties').select('*')
    .eq('id', recipient_party_id).eq('project_id', projectId).maybeSingle()
  if (!recipient) return { ok: false, error: 'Recipient not found' }

  const ctx = await loadLetterContext(supabase, projectId, orgId, userId)

  const today = new Date().toISOString().slice(0, 10)
  const triggerDateObj = trigger_date ? new Date(`${trigger_date}T00:00:00.000Z`) : null
  const deadlineObj    = triggerDateObj ? computeDeadline(notice, triggerDateObj) : null
  const deadlineISO    = deadlineObj ? deadlineObj.toISOString().slice(0, 10) : null

  const letterId     = randomUUID()
  const documentPath = `${orgId}/projects/${projectId}/letters/${letterId}.docx`

  // 1. Insert the draft first so the DB trigger allocates the controlled ref.
  let reference: string | null
  try {
    const draft = await createLetter(supabase as any, {
      id: letterId, project_id: projectId, organisation_id: orgId, notice_id: notice.id,
      recipient_party_id: recipient.id, field_values: {}, trigger_date: trigger_date ?? null,
      deadline_date: deadlineISO, document_path: documentPath, created_by: userId,
      subject: subject ?? notice.title,
    })
    reference = draft.letter_reference
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Letter creation failed' }
  }

  // 2. Build the value map + branded .docx (with the reference stamped in).
  const values = buildLetterValues({
    today, documentRef: reference,
    recipient: { name: recipient.name, company: recipient.company, address: recipient.address, partyRole: recipient.party_role },
    sender: {
      signatoryName: ctx.signatoryName,
      signatoryTitle: ctx.letterhead?.signatoryTitle ?? null,
      companyName: ctx.letterhead?.companyName ?? null,
      addressLines: ctx.letterhead?.addressLines ?? [],
    },
    projectName: ctx.projectName,
    triggerDate: trigger_date ?? null,
    manualValues: manual_values,
  })

  let docBuffer: Buffer
  try {
    const filled = fillTemplate(templateBytesFor(notice.template_file), values)
    docBuffer = ctx.letterhead ? injectLetterhead(filled, toDocxBranding(ctx.letterhead, reference)) : filled
  } catch (e) {
    await deleteLetter(supabase as any, letterId).catch(() => {})
    return { ok: false, error: `Template fill failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 3. Upload the rendered document.
  const { error: uploadErr } = await supabase.storage
    .from('jbcc-letters')
    .upload(documentPath, docBuffer, { contentType: DOCX_MIME, upsert: false })
  if (uploadErr) {
    await deleteLetter(supabase as any, letterId).catch(() => {})
    return { ok: false, error: `Upload failed: ${uploadErr.message}` }
  }

  // 4. Persist the final value snapshot onto the (still draft) letter.
  try {
    await updateLetterContent(supabase as any, letterId, { field_values: values })
  } catch { /* non-fatal: the docx + row already exist */ }

  // 5. Record the distribution list (primary recipient + any CC parties).
  await addLetterRecipient(supabase as any, {
    letter_id: letterId, organisation_id: orgId, party_id: recipient.id,
    party_name_snapshot: recipient.name, disposition: 'to',
  }).catch(() => {})
  if (cc_party_ids?.length) {
    const ccParties = await listParties(supabase as any, projectId)
    for (const ccId of cc_party_ids) {
      const p = ccParties.find((x: JbccParty) => x.id === ccId)
      if (p) {
        await addLetterRecipient(supabase as any, {
          letter_id: letterId, organisation_id: orgId, party_id: p.id,
          party_name_snapshot: p.name, disposition: 'cc',
        }).catch(() => {})
      }
    }
  }

  // 6. Audit event.
  await logLetterEvent(supabase as any, {
    letter_id: letterId, organisation_id: orgId, event_type: 'created',
    to_status: 'draft', actor_id: userId,
    metadata: { notice_code, letter_reference: reference },
  }).catch(() => {})

  revalidatePath(`/projects/${projectId}/jbcc/tracking`)
  return { ok: true, data: { letterId, documentPath, letterReference: reference } }
}

// ---------------------------------------------------------------------------
// letterLifecycleAction — controlled ISO transitions with actor stamping + audit
// ---------------------------------------------------------------------------

export async function letterLifecycleAction(
  projectId: string, letterId: string, raw: unknown,
): Promise<ActionResult> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { supabase, orgId, userId } = g

  const parsed = letterLifecycleSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const input = parsed.data

  const letter = await getLetter(supabase as any, letterId)
  if (!letter || letter.project_id !== projectId) return { ok: false, error: 'Letter not found' }

  const from = letter.status as LetterStatus
  const nowISO = new Date().toISOString()
  const today = nowISO.slice(0, 10)

  const patch: Record<string, unknown> = {}
  let to: LetterStatus | null = null
  let eventType:
    | 'submitted_for_review' | 'approved' | 'issued' | 'served'
    | 'reverted_to_draft' | 'withdrawn' | 'soft_deleted'
    | 'legal_hold_set' | 'legal_hold_cleared'
  const meta: Record<string, unknown> = {}

  switch (input.action) {
    case 'submit_for_review':
      to = 'in_review'; patch.status = to; eventType = 'submitted_for_review'; break
    case 'approve':
      to = 'approved'; patch.status = to; patch.approved_by = userId; patch.approved_at = nowISO
      eventType = 'approved'; meta.self_approved = userId === letter.created_by; break
    case 'issue':
      to = 'issued'; patch.status = to; patch.issued_by = userId; patch.issued_at = nowISO
      patch.issued_date = input.issued_date ?? today; eventType = 'issued'
      meta.self_issued = userId === letter.created_by; break
    case 'mark_served': {
      to = 'served'; patch.status = to; patch.served_by = userId; patch.served_at = nowISO
      patch.served_date = input.served_date ?? today
      patch.service_method = input.service_method ?? null
      patch.service_reference = input.service_reference ?? null
      patch.deemed_service_date = input.served_date ?? today
      eventType = 'served'; break
    }
    case 'revert_to_draft':
      to = 'draft'; patch.status = to; eventType = 'reverted_to_draft'; break
    case 'withdraw':
      to = 'withdrawn'; patch.status = to; eventType = 'withdrawn'; break
    case 'soft_delete':
      if (from !== 'draft' && from !== 'withdrawn') {
        return { ok: false, error: 'Only draft or withdrawn letters can be archived; issued notices are retained.' }
      }
      patch.deleted_at = nowISO; eventType = 'soft_deleted'; break
    case 'set_legal_hold':
      patch.legal_hold = true; eventType = 'legal_hold_set'; break
    case 'clear_legal_hold':
      patch.legal_hold = false; eventType = 'legal_hold_cleared'; break
    default:
      return { ok: false, error: 'Unknown action' }
  }

  // Validate status transitions client-side too (the DB trigger is the backstop).
  if (to && to !== from && !canTransitionLetter(from, to)) {
    return { ok: false, error: `Cannot move a ${from} letter to ${to}.` }
  }
  if (input.notes != null) patch.notes = input.notes

  try {
    await transitionLetter(supabase as any, letterId, patch)
    await logLetterEvent(supabase as any, {
      letter_id: letterId, organisation_id: orgId, event_type: eventType,
      from_status: from, to_status: to, actor_id: userId, metadata: meta,
    }).catch(() => {})
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Transition failed' }
  }

  revalidatePath(`/projects/${projectId}/jbcc/tracking`)
  revalidatePath(`/projects/${projectId}/jbcc/tracking/${letterId}`)
  return { ok: true, data: undefined }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function addAttachmentAction(
  projectId: string, letterId: string, formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { supabase, orgId, userId } = g

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'No file provided' }
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: 'File exceeds 25 MB limit' }

  const letter = await getLetter(supabase as any, letterId)
  if (!letter || letter.project_id !== projectId) return { ok: false, error: 'Letter not found' }

  const ext      = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
  const safeName = `${randomUUID()}${ext}`
  const filePath = `${orgId}/projects/${projectId}/letters/${letterId}/attachments/${safeName}`
  const bytes    = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await supabase.storage
    .from('jbcc-letters')
    .upload(filePath, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadErr) return { ok: false, error: `Upload failed: ${uploadErr.message}` }

  try {
    const att = await createLetterAttachment(supabase as any, {
      letter_id: letterId, organisation_id: orgId, file_path: filePath, file_name: file.name,
      mime_type: file.type || null, size_bytes: file.size, created_by: userId,
    })
    await logLetterEvent(supabase as any, {
      letter_id: letterId, organisation_id: orgId, event_type: 'attachment_added',
      actor_id: userId, metadata: { file_name: file.name },
    }).catch(() => {})
    revalidatePath(`/projects/${projectId}/jbcc/tracking/${letterId}`)
    return { ok: true, data: { id: att.id } }
  } catch (e) {
    await supabase.storage.from('jbcc-letters').remove([filePath])
    return { ok: false, error: e instanceof Error ? e.message : 'Insert failed' }
  }
}

export async function deleteAttachmentAction(
  projectId: string, letterId: string, attachmentId: string,
): Promise<ActionResult> {
  const g = await guardJbcc(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { supabase, orgId, userId } = g

  const letter = await getLetter(supabase as any, letterId)
  if (!letter || letter.project_id !== projectId) return { ok: false, error: 'Letter not found' }

  const attachments = await listLetterAttachments(supabase as any, letterId)
  const target = attachments.find(a => a.id === attachmentId)
  if (!target) return { ok: false, error: 'Attachment not found' }

  try {
    await deleteLetterAttachment(supabase as any, attachmentId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' }
  }

  try {
    await supabase.storage.from('jbcc-letters').remove([target.file_path])
  } catch (e) {
    console.error(`[jbcc] orphaned storage object after row delete: ${target.file_path}`, e instanceof Error ? e.message : e)
  }

  await logLetterEvent(supabase as any, {
    letter_id: letterId, organisation_id: orgId, event_type: 'attachment_removed',
    actor_id: userId, metadata: { file_name: target.file_name },
  }).catch(() => {})

  revalidatePath(`/projects/${projectId}/jbcc/tracking/${letterId}`)
  return { ok: true, data: undefined }
}
