'use server'

import { readFileSync } from 'node:fs'
import { join }         from 'node:path'
import { randomUUID }   from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRoleAPI } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { requireFeature } from '@/lib/features'
import {
  createParty, updateParty, deleteParty, partyInputSchema,
  getNotice,
  createLetter, computeDeadline, fillTemplate,
  generateLetterSchema,
} from '@esite/shared'

export type ActionResult<T = void> =
  | { ok: true;  data: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Internal guard — resolves org from the project, checks role + feature unlock
// ---------------------------------------------------------------------------

async function getOrgIdForProject(projectId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  return (data as { organisation_id: string } | null)?.organisation_id ?? null
}

// ---------------------------------------------------------------------------
// createPartyAction
// ---------------------------------------------------------------------------

export async function createPartyAction(
  projectId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const orgId = await getOrgIdForProject(projectId)
  if (!orgId) return { ok: false, error: 'Project not found' }

  const role = await requireRoleAPI(ORG_WRITE_ROLES, orgId)
  if (!role.ok) return { ok: false, error: 'forbidden' }
  await requireFeature(role.ctx.organisationId, 'jbcc', undefined, `/projects/${projectId}/jbcc/unlock`)

  const parsed = partyInputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  try {
    const party = await createParty(supabase as any, {
      project_id:      projectId,
      organisation_id: orgId,
      created_by:      user.id,
      ...parsed.data,
    })
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: { id: party.id } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Create failed' }
  }
}

// ---------------------------------------------------------------------------
// updatePartyAction
// ---------------------------------------------------------------------------

export async function updatePartyAction(
  projectId: string,
  partyId: string,
  raw: unknown,
): Promise<ActionResult> {
  const orgId = await getOrgIdForProject(projectId)
  if (!orgId) return { ok: false, error: 'Project not found' }

  const role = await requireRoleAPI(ORG_WRITE_ROLES, orgId)
  if (!role.ok) return { ok: false, error: 'forbidden' }
  await requireFeature(role.ctx.organisationId, 'jbcc', undefined, `/projects/${projectId}/jbcc/unlock`)

  const parsed = partyInputSchema.partial().safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  try {
    await updateParty(supabase as any, partyId, parsed.data)
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' }
  }
}

// ---------------------------------------------------------------------------
// deletePartyAction
// ---------------------------------------------------------------------------

export async function deletePartyAction(
  projectId: string,
  partyId: string,
): Promise<ActionResult> {
  const orgId = await getOrgIdForProject(projectId)
  if (!orgId) return { ok: false, error: 'Project not found' }

  const role = await requireRoleAPI(ORG_WRITE_ROLES, orgId)
  if (!role.ok) return { ok: false, error: 'forbidden' }
  await requireFeature(role.ctx.organisationId, 'jbcc', undefined, `/projects/${projectId}/jbcc/unlock`)

  const supabase = await createClient()
  try {
    await deleteParty(supabase as any, partyId)
    revalidatePath(`/projects/${projectId}/jbcc/parties`)
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Delete failed' }
  }
}

// ---------------------------------------------------------------------------
// generateLetterAction
// ---------------------------------------------------------------------------

export async function generateLetterAction(
  projectId: string,
  raw: unknown,
): Promise<ActionResult<{ letterId: string; documentPath: string }>> {
  const orgId = await getOrgIdForProject(projectId)
  if (!orgId) return { ok: false, error: 'Project not found' }

  const role = await requireRoleAPI(ORG_WRITE_ROLES, orgId)
  if (!role.ok) return { ok: false, error: 'forbidden' }
  await requireFeature(role.ctx.organisationId, 'jbcc', undefined, `/projects/${projectId}/jbcc/unlock`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const parsed = generateLetterSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { notice_code, recipient_party_id, trigger_date, manual_values } = parsed.data

  // Resolve the notice.
  const notice = await getNotice(supabase as any, notice_code)
  if (!notice) return { ok: false, error: 'Notice not found' }

  // Resolve the recipient party (must belong to this project).
  const { data: recipient, error: recErr } = await (supabase as any)
    .schema('projects')
    .from('jbcc_parties')
    .select('*')
    .eq('id', recipient_party_id)
    .eq('project_id', projectId)
    .maybeSingle()
  if (recErr || !recipient) return { ok: false, error: 'Recipient not found' }

  // Resolve sender context: project, org, user profile.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('name, organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project data missing' }

  const { data: org } = await supabase
    .from('organisations')
    .select('name')
    .eq('id', project.organisation_id)
    .maybeSingle()

  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('full_name, title')
    .eq('id', user.id)
    .maybeSingle() as { data: { full_name?: string; title?: string } | null }

  // Build the full placeholder values map.
  // Both generic and role-suffixed keys are populated so templates work before
  // and after the Task-6.1 normalisation pass (see caveat in Phase 6 spec).
  const today = new Date().toISOString().slice(0, 10)
  const values: Record<string, string> = {
    // standard
    'Insert Date':               today,
    'Date':                      today,

    // recipient — generic + role-suffixed
    'Name of Recipient':         recipient.name,
    'Recipient Name':            recipient.name,
    'Company Name':              recipient.company ?? '',
    'Recipient Company Name':    recipient.company ?? '',
    'Principal Agent':           recipient.party_role === 'principal_agent' ? recipient.name : '',
    'Recipient Address':         recipient.address ?? '',
    'Street Address':            recipient.address ?? '',
    'City, Postal Code':         '',
    'Attention':                 recipient.name,

    // sender — generic + role-suffixed
    'Name of Signatory':         profile?.full_name ?? '',
    'Sender Name':               profile?.full_name ?? '',
    'Project Manager':           profile?.title ?? 'Project Manager',
    'Sender Company Name':       org?.name ?? '',
    'Sender Address':            '',

    // project
    'Project Name':              (project as { name: string }).name,
    'Project Number':            '',

    // manual values overlay — wins on key collision
    ...manual_values,
  }

  // Load the .docx template from the committed asset directory.
  // process.cwd() resolves to apps/web in Next.js server context.
  const templatePath = join(process.cwd(), 'src', 'lib', 'jbcc', 'templates', notice.template_file)
  let templateBytes: Buffer
  try {
    templateBytes = readFileSync(templatePath)
  } catch {
    return { ok: false, error: `Template file missing on disk: ${notice.template_file}` }
  }

  // Fill the .docx template with placeholder values.
  let docBuffer: Buffer
  try {
    docBuffer = fillTemplate(templateBytes, values)
  } catch (e) {
    return { ok: false, error: `Template fill failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  // Compute deadline (null if notice has no numeric time-bar).
  const triggerDateObj = trigger_date ? new Date(`${trigger_date}T00:00:00.000Z`) : null
  const deadlineObj    = triggerDateObj ? computeDeadline(notice, triggerDateObj) : null
  const deadlineISO    = deadlineObj ? deadlineObj.toISOString().slice(0, 10) : null

  // Upload. Path: {orgId}/projects/{projectId}/letters/{letterId}.docx
  // The first segment is orgId so the RLS policy's foldername(name)[1] check passes.
  const letterId     = randomUUID()
  const documentPath = `${orgId}/projects/${projectId}/letters/${letterId}.docx`

  const { error: uploadErr } = await supabase.storage
    .from('jbcc-letters')
    .upload(documentPath, docBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert:      false,
    })
  if (uploadErr) {
    return { ok: false, error: `Upload failed: ${uploadErr.message}` }
  }

  // Insert the letter row. On failure, remove the uploaded file (atomic).
  try {
    const letter = await createLetter(supabase as any, {
      id:                 letterId,
      project_id:         projectId,
      organisation_id:    orgId,
      notice_id:          notice.id,
      recipient_party_id: recipient.id,
      field_values:       values,
      trigger_date:       trigger_date ?? null,
      deadline_date:      deadlineISO,
      document_path:      documentPath,
      created_by:         user.id,
    })
    revalidatePath(`/projects/${projectId}/jbcc/tracking`)
    return { ok: true, data: { letterId: letter.id, documentPath } }
  } catch (e) {
    await supabase.storage.from('jbcc-letters').remove([documentPath])
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Letter insert failed',
    }
  }
}
