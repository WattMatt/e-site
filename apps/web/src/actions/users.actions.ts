'use server'

/**
 * Admin user management — create / update / remove organisation members.
 * Replaces the deleted team-invite subsystem (spec sections 5.3, 11 steps 2-3).
 *
 * All actions are gated to owner/admin of the caller's organisation.
 * createUserAction provisions an auth.users row with NO password, then sends a
 * "set your password" email through the standard recovery flow — admin-created
 * and existing users share one password flow (spec section 5.4).
 */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { getOrgContext, isOrgAdmin } from '@/lib/auth-org'
import { sendInviteEmail, resolveInviteContext } from '@/lib/invite-email'
import { logAuthEvent, orgRoleSchema } from '@esite/shared'

type ActionResult = { ok: true; warning?: string } | { ok: false; error: string }

const createUserSchema = z.object({
  email:    z.string().email('Enter a valid email address.'),
  fullName: z.string().trim().min(2, "Enter the person's full name.").max(120),
  role:     orgRoleSchema,
})

const updateUserSchema = z.object({
  userId:   z.string().uuid(),
  role:     orgRoleSchema.optional(),
  isActive: z.boolean().optional(),
})

const removeUserSchema = z.object({ userId: z.string().uuid() })

const resendInviteSchema = z.object({ userId: z.string().uuid() })

/** Create an organisation member directly and email them a set-password link. */
export async function createUserAction(input: {
  email: string
  fullName: string
  role: string
}): Promise<ActionResult> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!isOrgAdmin(ctx.role)) return { ok: false, error: 'Only an admin or owner can add users.' }

  if (!rateLimit(`create-user:${ctx.userId}`, 20, 60 * 60_000)) {
    return { ok: false, error: 'Too many users created recently. Please wait before adding more.' }
  }

  const parsed = createUserSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { fullName, role } = parsed.data
  const email = parsed.data.email.trim().toLowerCase()

  if (role === 'owner') {
    return { ok: false, error: 'The owner role cannot be assigned at creation. Add the user, then transfer ownership.' }
  }

  const service = createServiceClient()

  // 1. Create the auth user with no password. email_confirm:true marks the
  //    address admin-verified so they skip the verify-email gate.
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? 'Could not create the user.'
    return {
      ok: false,
      error: /already|exist|registered/i.test(msg)
        ? 'A user with that email already exists.'
        : msg,
    }
  }
  const newUserId = created.user.id

  // The handle_new_user trigger has created public.profiles. Add the membership.
  const { error: memberErr } = await service.from('user_organisations').insert({
    user_id:         newUserId,
    organisation_id: ctx.organisationId,
    role,
    is_active:       true,
    invited_by:      ctx.userId,
    accepted_at:     new Date().toISOString(),
  })
  if (memberErr) {
    // Roll back the orphaned auth user so a retry starts clean.
    await service.auth.admin.deleteUser(newUserId).catch(() => {})
    return { ok: false, error: `Could not add the user to your organisation: ${memberErr.message}` }
  }

  // 2. Send the branded invite email. It names the inviter, the company and the
  //    role so the recipient doesn't read it as spam, and carries the
  //    set-password link. Falls back to the plain recovery email on failure so
  //    the user always has a way in (see sendInviteEmail).
  const { inviterName, orgName } = await resolveInviteContext(service, {
    inviterId: ctx.userId,
    orgId: ctx.organisationId,
  })
  const invite = await sendInviteEmail({ service, email, inviterName, orgName, role })
  const warning = invite.warning

  // 3. Audit.
  await logAuthEvent(service, {
    userId:    newUserId,
    eventType: 'user_created',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { created_by: ctx.userId, organisation_id: ctx.organisationId, role },
  })

  revalidatePath('/settings/users')
  return warning ? { ok: true, warning } : { ok: true }
}

/**
 * Re-send the set-password invite to a member who has never signed in.
 * Recovery links are single-use and expire (mailer_otp_exp = 24 h) — email
 * scanners can burn them before the invitee ever clicks, so admins need a
 * self-service resend instead of a support round-trip.
 */
export async function resendInviteAction(input: { userId: string }): Promise<ActionResult> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!isOrgAdmin(ctx.role)) return { ok: false, error: 'Only an admin or owner can resend invites.' }

  if (!rateLimit(`resend-invite:${ctx.userId}`, 20, 60 * 60_000)) {
    return { ok: false, error: 'Too many invites resent recently. Please wait before trying again.' }
  }

  const parsed = resendInviteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { userId } = parsed.data

  const service = createServiceClient()

  const { data: target, error: targetErr } = await service
    .from('user_organisations')
    .select('role, is_active')
    .eq('user_id', userId)
    .eq('organisation_id', ctx.organisationId)
    .maybeSingle()
  if (targetErr) return { ok: false, error: targetErr.message }
  if (!target || !target.is_active) {
    return { ok: false, error: 'That user is not an active member of your organisation.' }
  }

  const { data: authUser, error: authErr } = await service.auth.admin.getUserById(userId)
  if (authErr || !authUser?.user) {
    return { ok: false, error: 'Could not look up that user’s account.' }
  }
  if (authUser.user.last_sign_in_at) {
    return {
      ok: false,
      error: 'That user is already active — they’ve signed in before. If they’re locked out, they can use “Forgot password” on the sign-in page.',
    }
  }
  const email = authUser.user.email
  if (!email) return { ok: false, error: 'That user has no email address on record.' }

  // Assigned site names for context in the email — best-effort read.
  const { data: siteRows } = await (service as any)
    .schema('projects')
    .from('project_members')
    .select('projects!inner(name, organisation_id)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('projects.organisation_id', ctx.organisationId)
  const siteNames = ((siteRows ?? []) as Array<{ projects: { name: string | null } | null }>)
    .map((r) => r.projects?.name?.trim())
    .filter((n): n is string => Boolean(n))

  const { inviterName, orgName } = await resolveInviteContext(service, {
    inviterId: ctx.userId,
    orgId: ctx.organisationId,
  })
  const invite = await sendInviteEmail({
    service,
    email,
    inviterName,
    orgName,
    role: target.role,
    siteNames: siteNames.length ? siteNames : undefined,
  })
  if (!invite.ok) {
    return { ok: false, error: 'The invite email could not be sent. Please try again shortly.' }
  }

  await logAuthEvent(service, {
    userId,
    eventType: 'password_reset_requested',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { via: 'invite_resend', resent_by: ctx.userId, organisation_id: ctx.organisationId },
  })

  revalidatePath('/settings/users')
  return invite.warning ? { ok: true, warning: invite.warning } : { ok: true }
}

/** Change a member's role and/or active status. */
export async function updateUserAction(input: {
  userId: string
  role?: string
  isActive?: boolean
}): Promise<ActionResult> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!isOrgAdmin(ctx.role)) return { ok: false, error: 'Only an admin or owner can edit users.' }

  const parsed = updateUserSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { userId, role, isActive } = parsed.data
  if (role === undefined && isActive === undefined) {
    return { ok: false, error: 'Nothing to update.' }
  }
  if (userId === ctx.userId) {
    return { ok: false, error: 'You cannot change your own role or status.' }
  }

  const service = createServiceClient()

  const { data: target, error: targetErr } = await service
    .from('user_organisations')
    .select('id, role, is_active')
    .eq('user_id', userId)
    .eq('organisation_id', ctx.organisationId)
    .maybeSingle()
  if (targetErr) return { ok: false, error: targetErr.message }
  if (!target) return { ok: false, error: 'That user is not a member of your organisation.' }

  // The owner role is assignable / removable by an owner only — both directions.
  if ((target.role === 'owner' || role === 'owner') && ctx.role !== 'owner') {
    return { ok: false, error: 'Only an owner can assign or change the owner role.' }
  }

  // Never strip the last active owner.
  if (target.role === 'owner' && ((role !== undefined && role !== 'owner') || isActive === false)) {
    const { count } = await service
      .from('user_organisations')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', ctx.organisationId)
      .eq('role', 'owner')
      .eq('is_active', true)
    if ((count ?? 0) <= 1) {
      return { ok: false, error: 'Your organisation must keep at least one active owner.' }
    }
  }

  const patch: { role?: string; is_active?: boolean } = {}
  if (role !== undefined) patch.role = role
  if (isActive !== undefined) patch.is_active = isActive

  const { error: updErr } = await service
    .from('user_organisations')
    .update(patch)
    .eq('id', target.id)
  if (updErr) return { ok: false, error: updErr.message }

  await logAuthEvent(service, {
    userId,
    eventType: 'user_updated',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { updated_by: ctx.userId, organisation_id: ctx.organisationId, ...patch },
  })

  revalidatePath('/settings/users')
  return { ok: true }
}

/** Remove a member; delete their auth account if they belong to no other org. */
export async function removeUserAction(input: { userId: string }): Promise<ActionResult> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!isOrgAdmin(ctx.role)) return { ok: false, error: 'Only an admin or owner can remove users.' }

  const parsed = removeUserSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { userId } = parsed.data
  if (userId === ctx.userId) {
    return { ok: false, error: 'You cannot remove yourself.' }
  }

  const service = createServiceClient()

  const { data: target, error: targetErr } = await service
    .from('user_organisations')
    .select('id, role')
    .eq('user_id', userId)
    .eq('organisation_id', ctx.organisationId)
    .maybeSingle()
  if (targetErr) return { ok: false, error: targetErr.message }
  if (!target) return { ok: false, error: 'That user is not a member of your organisation.' }

  if (target.role === 'owner') {
    if (ctx.role !== 'owner') {
      return { ok: false, error: 'Only an owner can remove an owner.' }
    }
    const { count } = await service
      .from('user_organisations')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', ctx.organisationId)
      .eq('role', 'owner')
      .eq('is_active', true)
    if ((count ?? 0) <= 1) {
      return { ok: false, error: 'Your organisation must keep at least one active owner.' }
    }
  }

  const { error: delErr } = await service
    .from('user_organisations')
    .delete()
    .eq('id', target.id)
  if (delErr) return { ok: false, error: delErr.message }

  await logAuthEvent(service, {
    userId,
    eventType: 'user_removed',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { removed_by: ctx.userId, organisation_id: ctx.organisationId, removed_role: target.role },
  })

  // If the user now belongs to no organisation, delete the auth account too.
  const { count: remaining } = await service
    .from('user_organisations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if ((remaining ?? 0) === 0) {
    const { error: authDelErr } = await service.auth.admin.deleteUser(userId)
    if (authDelErr) {
      console.error('removeUserAction: auth account not deleted (non-fatal)', { userId, error: authDelErr })
    }
  }

  revalidatePath('/settings/users')
  return { ok: true }
}
