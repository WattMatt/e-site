'use server'

/**
 * Admin user management — create / update / remove organisation members.
 * Replaces the deleted team-invite subsystem (spec sections 5.3, 11 steps 2-3).
 *
 * All actions are gated to owner/admin of the caller's organisation.
 * createUserAction invites the user via auth.admin.inviteUserByEmail — this
 * provisions an auth.users row with NO password AND fires the Supabase Send
 * Email hook, which renders the branded, role-aware invite. Role/org context
 * rides in user_metadata (`data`) so the hook can co-brand the email.
 */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { getOrgContext, isOrgAdmin } from '@/lib/auth-org'
import { logAuthEvent, orgRoleSchema, isPerSiteOnlyRole, PER_SITE_INVITE_REJECTION } from '@esite/shared'

type ActionResult = { ok: true } | { ok: false; error: string }

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

/** Invite an organisation member; the branded invite email is sent by the hook. */
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

  // Per-site (client) roles must never become an org membership — an org row
  // exposes every project in the org via org RLS. Reject before any write.
  if (isPerSiteOnlyRole(role)) {
    return { ok: false, error: PER_SITE_INVITE_REJECTION }
  }

  const service = createServiceClient()
  const inviteData = {
    full_name:    fullName,
    invited_role: role,
    org_id:       ctx.organisationId,
    org_name:     null,
    inviter_name: null,
  }
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`

  // 1. Invite the user — provisions the auth row (no password) AND triggers the
  //    Supabase Send Email hook, which renders the branded role-aware invite.
  //    Role/org context rides in `data` (user_metadata) for the hook; org_name
  //    is left null and backfilled by the hook from the organisation row.
  const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
    data: inviteData,
    redirectTo,
  })

  // Collision path: the email already exists in auth.users (the person was
  // removed from THIS org but still exists in another org, or is deactivated
  // here, or was previously invited). Re-creation must round-trip cleanly:
  // look up the existing user, then reactivate / re-add their membership and
  // re-send the branded invite. Mirrors sub-org / bulk collision handling.
  if (inviteErr || !invited?.user) {
    const msg = inviteErr?.message ?? ''
    if (!/already|exist|registered/i.test(msg)) {
      return { ok: false, error: msg || 'Could not invite the user.' }
    }

    // Resolve the existing user id by email via profiles (handle_new_user keeps
    // profiles.email in sync with auth.users).
    const { data: existing } = await service
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()
    const existingId = (existing as { id: string } | null)?.id
    if (!existingId) {
      return { ok: false, error: 'A user with that email already exists but could not be found.' }
    }

    // Is there already a membership row for this org (active or inactive)?
    const { data: membership } = await service
      .from('user_organisations')
      .select('id, is_active')
      .eq('user_id', existingId)
      .eq('organisation_id', ctx.organisationId)
      .maybeSingle()
    const existingMembership = membership as { id: string; is_active: boolean } | null

    if (existingMembership?.is_active) {
      // They are already an active member of this org — nothing to re-create.
      return { ok: false, error: 'That user is already an active member of your organisation.' }
    }

    if (existingMembership) {
      // Reactivate the dormant membership and set the chosen role.
      const { error: reErr } = await service
        .from('user_organisations')
        .update({ role, is_active: true, invited_by: ctx.userId })
        .eq('id', existingMembership.id)
      if (reErr) {
        return { ok: false, error: `Could not reactivate the membership: ${reErr.message}` }
      }
    } else {
      // No row for this org — insert a fresh membership for the existing user.
      const { error: insErr } = await service.from('user_organisations').insert({
        user_id:         existingId,
        organisation_id: ctx.organisationId,
        role,
        is_active:       true,
        invited_by:      ctx.userId,
        accepted_at:     null,
      })
      if (insErr) {
        return { ok: false, error: `Could not add the user to your organisation: ${insErr.message}` }
      }
    }

    // Re-send the branded invite so they can get in — generateLink({type:'invite'})
    // fires the same Send Email hook as inviteUserByEmail but does NOT error on an
    // existing user (it just regenerates the invite link + token).
    await service.auth.admin.generateLink({ type: 'invite', email, options: { data: inviteData, redirectTo } }).catch(() => {})

    await logAuthEvent(service, {
      userId:    existingId,
      eventType: 'user_created',
      ipAddress: ip === 'unknown' ? null : ip,
      userAgent: ua,
      metadata:  {
        created_by: ctx.userId, organisation_id: ctx.organisationId, role,
        via: existingMembership ? 'reactivate' : 're_add',
      },
    })

    revalidatePath('/settings/users')
    return { ok: true }
  }

  const newUserId = invited.user.id

  // 2. Add the org membership (handle_new_user already created public.profiles).
  const { error: memberErr } = await service.from('user_organisations').insert({
    user_id:         newUserId,
    organisation_id: ctx.organisationId,
    role,
    is_active:       true,            // access is gated on is_active, not accepted_at
    invited_by:      ctx.userId,
    accepted_at:     null,            // stamped when the invitee actually accepts
  })
  if (memberErr) {
    // Roll back the orphaned auth user so a retry starts clean.
    await service.auth.admin.deleteUser(newUserId).catch(() => {})
    return { ok: false, error: `Could not add the user to your organisation: ${memberErr.message}` }
  }

  // 3. Audit.
  await logAuthEvent(service, {
    userId:    newUserId,
    eventType: 'user_created',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { created_by: ctx.userId, organisation_id: ctx.organisationId, role, via: 'invite' },
  })

  revalidatePath('/settings/users')
  return { ok: true }
}

/**
 * Re-send the branded invite/set-password email to a member who hasn't accepted
 * yet (accepted_at IS NULL). Uses generateLink({type:'invite'}) — the same Send
 * Email hook as the original invite, so the email is branded + role-aware — and
 * unlike inviteUserByEmail it does not error on an already-provisioned auth user.
 */
export async function resendInviteAction(input: { userId: string }): Promise<ActionResult> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }
  if (!isOrgAdmin(ctx.role)) return { ok: false, error: 'Only an admin or owner can resend invites.' }

  if (!rateLimit(`resend-invite:${ctx.userId}`, 30, 60 * 60_000)) {
    return { ok: false, error: 'Too many invites resent recently. Please wait before resending more.' }
  }

  const parsed = resendInviteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { userId } = parsed.data

  const service = createServiceClient()

  // The target must be a member of THIS org and still pending (accepted_at NULL).
  const { data: target, error: targetErr } = await service
    .from('user_organisations')
    .select('id, role, accepted_at, profile:profiles!user_organisations_user_id_fkey(email)')
    .eq('user_id', userId)
    .eq('organisation_id', ctx.organisationId)
    .maybeSingle()
  if (targetErr) return { ok: false, error: targetErr.message }
  const row = target as { id: string; role: string; accepted_at: string | null; profile: { email: string | null } | null } | null
  if (!row) return { ok: false, error: 'That user is not a member of your organisation.' }
  if (row.accepted_at) {
    return { ok: false, error: 'That user has already accepted their invitation.' }
  }
  const email = row.profile?.email?.trim().toLowerCase()
  if (!email) return { ok: false, error: 'That user has no email on record.' }

  const { error: linkErr } = await service.auth.admin.generateLink({
    type:    'invite',
    email,
    options: {
      data: {
        invited_role: row.role,
        org_id:       ctx.organisationId,
        org_name:     null,
        inviter_name: null,
      },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`,
    },
  })
  if (linkErr) return { ok: false, error: `Could not resend the invite: ${linkErr.message}` }

  await logAuthEvent(service, {
    userId,
    eventType: 'invite_resent',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { resent_by: ctx.userId, organisation_id: ctx.organisationId, role: row.role },
  })

  revalidatePath('/settings/users')
  return { ok: true }
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
  // A per-site (client) role must never be an org membership — block promoting an
  // existing member to it via update, the same way invites reject it (the leak
  // vector is identical: an org row exposes every project via org RLS).
  if (role !== undefined && isPerSiteOnlyRole(role)) {
    return { ok: false, error: PER_SITE_INVITE_REJECTION }
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
