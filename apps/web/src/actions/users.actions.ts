'use server'

/**
 * Admin user management — invite / update / remove organisation members.
 * Replaces the deleted team-invite subsystem (spec sections 5.3, 11 steps 2-3).
 *
 * All actions are gated to owner/admin of the caller's organisation.
 * inviteUserAction detects whether the email belongs to an existing E-Site
 * account (Path B — pending membership + notification email) or is brand-new
 * (Path A — Supabase inviteUserByEmail, which sends the onboarding email
 * automatically).
 */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { getOrgContext, isOrgAdmin } from '@/lib/auth-org'
import { logAuthEvent, orgRoleSchema } from '@esite/shared'
import { sendOrgInviteEmail, sendInviteLinkEmail } from '@/lib/emails/org-invite-email'

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

/** Invite a user to the organisation — new accounts receive a Supabase invite
 *  email (Path A); existing E-Site accounts receive an org-invite nudge (Path B). */
export async function inviteUserAction(input: {
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

  // Step 1 — detect an existing account.
  const { data: existingProfile } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  let invitedUserId: string

  if (!existingProfile) {
    // -- Path A: brand-new email --------------------------------------------------
    const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name:      fullName,
        invited_to_org: ctx.organisationId,
        invited_role:   role,
      },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/invite`,
    })

    // If Supabase reports the email is already registered, fall through to Path B.
    if (inviteErr) {
      if (/already|registered|exists/i.test(inviteErr.message)) {
        // Re-query profiles — race condition: profile row may now exist.
        const { data: raceProfile } = await service
          .from('profiles')
          .select('id')
          .eq('email', email)
          .maybeSingle()
        if (!raceProfile) {
          // Still cannot find the profile — surface the original error.
          return { ok: false, error: inviteErr.message }
        }
        return handlePathB({ service, userId: raceProfile.id, email, role, ctx, ip, ua })
      }
      return { ok: false, error: inviteErr.message }
    }

    if (!invited?.user) {
      return { ok: false, error: 'Could not send the invitation.' }
    }

    invitedUserId = invited.user.id

    // Insert the membership row (accepted_at=null — pending until they accept in-app).
    const { error: memberErr } = await service.from('user_organisations').insert({
      user_id:         invitedUserId,
      organisation_id: ctx.organisationId,
      role,
      is_active:       true,
      accepted_at:     null,
      invited_by:      ctx.userId,
    })
    if (memberErr) {
      // Roll back the orphaned auth user so a retry starts clean.
      await service.auth.admin.deleteUser(invitedUserId).catch(() => {})
      return { ok: false, error: `Could not add the user to your organisation: ${memberErr.message}` }
    }
  } else {
    // -- Path B: existing E-Site account -----------------------------------------
    return handlePathB({ service, userId: existingProfile.id, email, role, ctx, ip, ua })
  }

  // Audit (Path A only — Path B audits inside handlePathB).
  await logAuthEvent(service, {
    userId:    invitedUserId,
    eventType: 'user_created',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { created_by: ctx.userId, organisation_id: ctx.organisationId, role },
  })

  revalidatePath('/settings/users')
  return { ok: true }
}

// -- Path B helper ---------------------------------------------------------------

type PathBParams = {
  service:   ReturnType<typeof createServiceClient>
  userId:    string
  email:     string
  role:      string
  ctx:       NonNullable<Awaited<ReturnType<typeof getOrgContext>>>
  ip:        string
  ua:        string | null
}

async function handlePathB({
  service,
  userId,
  email,
  role,
  ctx,
  ip,
  ua,
}: PathBParams): Promise<ActionResult> {
  // Check for any existing membership row.
  const { data: existing } = await service
    .from('user_organisations')
    .select('id, accepted_at, is_active')
    .eq('user_id', userId)
    .eq('organisation_id', ctx.organisationId)
    .maybeSingle()

  if (existing) {
    if (existing.accepted_at !== null && existing.is_active) {
      return { ok: false, error: 'That person is already a member of your organisation.' }
    }
    if (existing.accepted_at === null) {
      return { ok: false, error: 'That person already has a pending invitation — use Resend.' }
    }
    if (existing.accepted_at !== null && !existing.is_active) {
      return { ok: false, error: 'That person was deactivated — reactivate them from the members list instead.' }
    }
  }

  // Insert a pending membership row.
  const { error: memberErr } = await service.from('user_organisations').insert({
    user_id:         userId,
    organisation_id: ctx.organisationId,
    role,
    is_active:       false,
    accepted_at:     null,
    invited_by:      ctx.userId,
  })
  if (memberErr) {
    return { ok: false, error: `Could not add the user to your organisation: ${memberErr.message}` }
  }

  // Look up org name and inviter name for the email.
  const [{ data: orgRow }, { data: inviterRow }] = await Promise.all([
    service.from('organisations').select('name').eq('id', ctx.organisationId).maybeSingle(),
    service.from('profiles').select('full_name').eq('id', ctx.userId).maybeSingle(),
  ])
  const orgName     = orgRow?.name         ?? 'your organisation'
  const inviterName = inviterRow?.full_name ?? 'A team member'

  let warning: string | undefined
  const mailResult = await sendOrgInviteEmail({ to: email, orgName, inviterName })
  if (!mailResult.ok) {
    warning = 'Invited, but the notification email could not be sent.'
  }

  await logAuthEvent(service, {
    userId,
    eventType: 'user_created',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { created_by: ctx.userId, organisation_id: ctx.organisationId, role, path: 'B' },
  })

  revalidatePath('/settings/users')
  return warning ? { ok: true, warning } : { ok: true }
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

/** Resend an invitation to a pending member.
 *  - Existing-user invite (is_active=false): resend the in-app nudge email.
 *  - New-user invite (is_active=true): regenerate the Supabase invite link and email it. */
export async function resendInviteAction(input: { userId: string }): Promise<ActionResult> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!isOrgAdmin(ctx.role)) return { ok: false, error: 'Only an admin or owner can resend invitations.' }

  if (!rateLimit(`resend-invite:${ctx.userId}`, 20, 60 * 60_000)) {
    return { ok: false, error: 'Too many invitations resent recently. Please wait before trying again.' }
  }

  const parsed = removeUserSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { userId } = parsed.data

  const service = createServiceClient()

  // Look up the membership row.
  const { data: member, error: memberErr } = await service
    .from('user_organisations')
    .select('id, is_active, accepted_at')
    .eq('user_id', userId)
    .eq('organisation_id', ctx.organisationId)
    .maybeSingle()
  if (memberErr) return { ok: false, error: memberErr.message }
  if (!member) return { ok: false, error: 'That user is not a member of your organisation.' }

  if (member.accepted_at !== null) {
    return { ok: false, error: 'That member has already accepted their invitation.' }
  }

  // Look up org name and inviter name (needed by both email paths).
  const [{ data: orgRow }, { data: inviterRow }] = await Promise.all([
    service.from('organisations').select('name').eq('id', ctx.organisationId).maybeSingle(),
    service.from('profiles').select('full_name').eq('id', ctx.userId).maybeSingle(),
  ])
  const orgName     = orgRow?.name         ?? 'your organisation'
  const inviterName = inviterRow?.full_name ?? 'A team member'

  if (!member.is_active) {
    // Existing-user invite — resend the in-app nudge email.
    const { data: profileRow } = await service
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle()
    const email = profileRow?.email
    if (!email) return { ok: false, error: 'Could not find the email address for this user.' }

    const mailResult = await sendOrgInviteEmail({ to: email, orgName, inviterName })
    if (!mailResult.ok) return { ok: false, error: mailResult.error ?? 'Failed to send invitation email.' }
  } else {
    // New-user invite — regenerate the Supabase invite link.
    const { data: authUser } = await service.auth.admin.getUserById(userId)
    const email = authUser?.user?.email
    if (!email) return { ok: false, error: 'Could not find the email address for this user.' }

    const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/invite`,
      },
    })
    if (linkErr) return { ok: false, error: linkErr.message }

    const actionLink = linkData?.properties?.action_link
    if (!actionLink) return { ok: false, error: 'Could not generate the invitation link.' }

    const mailResult = await sendInviteLinkEmail({ to: email, orgName, inviterName, actionLink })
    if (!mailResult.ok) return { ok: false, error: mailResult.error ?? 'Failed to send invitation email.' }
  }

  await logAuthEvent(service, {
    userId,
    eventType: 'user_created',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { resent_by: ctx.userId, organisation_id: ctx.organisationId },
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
