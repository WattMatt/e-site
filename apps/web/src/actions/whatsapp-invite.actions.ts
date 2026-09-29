// apps/web/src/actions/whatsapp-invite.actions.ts
'use server'
/**
 * A PM adds a site foreman who has no E-Site login, by WhatsApp number.
 * They become a REAL passwordless account (so the work-item spine, RLS and the
 * audit trail treat them exactly like any contractor), scoped to THIS project,
 * with a placeholder email on a no-MX domain that is never mailed
 * (auth-email-hook refuses it). Nothing reaches them until THEY tap "Yes, I
 * agree" on WhatsApp — that tap proves the number and records POPIA consent.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, logAuthEvent, normalisePhone, placeholderEmailFor } from '@esite/shared'
import { kickWhatsAppWorker } from '@/lib/whatsapp/kick-worker'

const schema = z.object({
  projectId: z.string().uuid(),
  fullName: z.string().trim().min(2, 'Enter their name').max(120),
  phone: z.string().min(6),
  company: z.string().trim().max(120).optional(),
})

type Result =
  | { ok: true; userId: string }
  | { existing: { userId: string; name: string | null } }
  | { error: string }

export async function inviteWhatsAppExternalAction(input: z.infer<typeof schema>): Promise<Result> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { projectId, fullName, company } = parsed.data
  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return { error: 'Enter a valid mobile number, e.g. 082 123 4567.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data: live } = await svc.schema('whatsapp').from('phone_links').select('user_id, status')
    .eq('phone_e164', phone).in('status', ['active', 'pending_optin']).maybeSingle()
  if (live) {
    const { data: p } = await svc.from('profiles').select('full_name').eq('id', live.user_id).maybeSingle()
    return { existing: { userId: live.user_id, name: p?.full_name ?? null } }
  }

  const { data: project } = await svc.schema('projects').from('projects').select('id, name, organisation_id').eq('id', projectId).maybeSingle()
  if (!project) return { error: 'Project not found' }
  const { data: inviter } = await svc.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: placeholderEmailFor(randomUUID()),
    email_confirm: true,
    user_metadata: { full_name: fullName, ...(company ? { company } : {}) },
    app_metadata: { provisioned_via: 'whatsapp', invited_by: user.id, invited_project_id: projectId },
  })
  if (createErr || !created?.user) return { error: createErr?.message ?? 'Could not create the account.' }
  const newUserId: string = created.user.id

  const fail = async (msg: string): Promise<Result> => {
    await svc.auth.admin.deleteUser(newUserId).catch(() => {})
    return { error: msg }
  }

  await svc.from('profiles').update({ phone, full_name: fullName }).eq('id', newUserId)
  const { error: orgErr } = await svc.from('user_organisations').insert({
    user_id: newUserId, organisation_id: project.organisation_id, role: 'contractor', is_active: true,
    invited_by: user.id, accepted_at: new Date().toISOString(),
  })
  if (orgErr) return fail(`Could not add them to the organisation: ${orgErr.message}`)
  const { error: pmErr } = await svc.schema('projects').from('project_members').insert({
    project_id: projectId, user_id: newUserId, organisation_id: project.organisation_id, role: 'contractor',
  })
  if (pmErr) return fail(`Could not add them to the project: ${pmErr.message}`)
  const { data: link, error: linkErr } = await svc.schema('whatsapp').from('phone_links').insert({
    user_id: newUserId, phone_e164: phone, status: 'pending_optin', invited_by: user.id, invited_project_id: projectId,
  }).select('id').single()
  if (linkErr || !link) return fail(`Could not record the number: ${linkErr?.message ?? 'unknown'}`)

  await svc.schema('whatsapp').from('outbox').insert({
    user_id: newUserId, link_id: link.id, trigger: 'optin', idempotency_key: `${link.id}:optin:1`,
    payload: { inviter: inviter?.full_name ?? 'Your project manager', project: project.name },
  })
  await logAuthEvent(svc, { userId: newUserId, eventType: 'user_created',
    metadata: { created_by: user.id, organisation_id: project.organisation_id, role: 'contractor', via: 'whatsapp_invite', project_id: projectId } })
  await kickWhatsAppWorker('optin')
  revalidatePath(`/projects/${projectId}/settings/members`)
  return { ok: true, userId: newUserId }
}

export async function resendWhatsAppOptInAction(input: { projectId: string; userId: string }): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const gate = await requireEffectiveRole(supabase, input.projectId, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data: link } = await svc.schema('whatsapp').from('phone_links').select('id, invited_project_id')
    .eq('user_id', input.userId).eq('status', 'pending_optin').maybeSingle()
  if (!link || link.invited_project_id !== input.projectId) return { error: 'No pending WhatsApp invitation for this person on this project.' }
  const { data: project } = await svc.schema('projects').from('projects').select('name').eq('id', input.projectId).maybeSingle()
  await svc.schema('whatsapp').from('outbox').insert({
    user_id: input.userId, link_id: link.id, trigger: 'optin', idempotency_key: `${link.id}:optin:${Date.now()}`,
    payload: { inviter: 'Your project manager', project: project?.name ?? 'your project' },
  })
  await kickWhatsAppWorker('optin')
  return { ok: true }
}
