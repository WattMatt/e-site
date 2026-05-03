'use server'

/**
 * Self-service account deletion (POPIA §24 right-to-erasure).
 *
 * Flow:
 *   1. Rate-limit by IP — deletion is high-impact + brute-force vector for password.
 *   2. Verify session (cookie-bound anon client).
 *   3. Confirm typed email matches the account email.
 *   4. Block sole-owner-of-an-org — must transfer ownership first.
 *   5. Block active paid subscription — must cancel in /settings/billing first.
 *   6. Re-verify password (defence against session hijack + accidental delete).
 *   7. logAuthEvent('account_deleted') BEFORE the delete (auth_events has no FK
 *      to auth.users so the row persists either way; audit-before is the
 *      explicit requirement so the request-to-erase is captured even if the
 *      delete fails downstream).
 *   8. supabase.auth.admin.deleteUser — service-role.
 *   9. Sign out to clear the session cookies.
 *
 * Cascade: public.profiles.id REFERENCES auth.users(id) ON DELETE CASCADE,
 * which transitively removes user_organisations + notifications. NOT NULL
 * profile-FK columns elsewhere (snags.raised_by, attachments.uploaded_by,
 * etc.) will reject the delete with FK-violation 23503; if that happens we
 * surface a contact path for manual completion within POPIA's 30-day window.
 */

import { headers } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { verifyPasswordIsolated } from '@/lib/auth-reauth'
import { logAuthEvent } from '@esite/shared'
import { z } from 'zod'

const INFO_OFFICER_EMAIL = 'arno@watsonmattheus.com'

const schema = z.object({
  confirmEmail: z.string().email('Please enter a valid email address.'),
  password:     z.string().min(1, 'Please enter your password.'),
})

const changeEmailSchema = z.object({
  newEmail: z.string().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
})

export async function deleteAccountAction(formData: FormData): Promise<{
  ok:    boolean
  error?: string
}> {
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = headersList.get('user-agent') ?? null

  if (!rateLimit(`account-delete:${ip}`, 3, 300_000)) {
    return { ok: false, error: 'Too many deletion attempts. Please try again in a few minutes.' }
  }

  const parsed = schema.safeParse({
    confirmEmail: formData.get('confirmEmail'),
    password:     formData.get('password'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return { ok: false, error: 'Not authenticated.' }

  if (parsed.data.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, error: "Confirmation email doesn't match your account email." }
  }

  // Password re-auth FIRST (without mutating the current session). Running
  // ownership/billing checks before this would expose enumeration oracles
  // ("you own X orgs") to anyone who knows your email.
  if (!await verifyPasswordIsolated(user.email, parsed.data.password)) {
    return { ok: false, error: 'Incorrect password.' }
  }

  const { data: ownerships } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .eq('is_active', true)

  const ownedOrgIds = (ownerships ?? []).map((m) => m.organisation_id)
  if (ownedOrgIds.length > 0) {
    const { data: otherOwners } = await supabase
      .from('user_organisations')
      .select('organisation_id')
      .in('organisation_id', ownedOrgIds)
      .eq('role', 'owner')
      .eq('is_active', true)
      .neq('user_id', user.id)

    const orgsWithOtherOwner = new Set((otherOwners ?? []).map((m) => m.organisation_id))
    const orgsLeftOrphaned = ownedOrgIds.filter((id) => !orgsWithOtherOwner.has(id))
    if (orgsLeftOrphaned.length > 0) {
      return {
        ok: false,
        error: 'You are the sole owner of an organisation. Transfer ownership in Settings → Team before deleting your account.',
      }
    }

    const { data: subs } = await (supabase as any)
      .schema('billing')
      .from('subscriptions')
      .select('tier, status')
      .in('organisation_id', ownedOrgIds)

    const hasPaidActive = (subs as Array<{ tier: string; status: string }> | null ?? []).some(
      (s) => s.tier !== 'free' && s.status === 'active',
    )
    if (hasPaidActive) {
      return {
        ok: false,
        error: 'You have an active paid subscription. Cancel it in Settings → Billing before deleting your account.',
      }
    }
  }

  const service = createServiceClient()
  await logAuthEvent(service, {
    userId:    user.id,
    eventType: 'account_deleted',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { initiated_by: 'self', email: user.email },
  })

  const { error: delErr } = await service.auth.admin.deleteUser(user.id)
  if (delErr) {
    console.error('deleteAccountAction: deleteUser failed', { userId: user.id, error: delErr })
    return {
      ok: false,
      error: `We could not complete the deletion automatically. Please email ${INFO_OFFICER_EMAIL} — we will complete the erasure manually within 30 days as required by POPIA §24.`,
    }
  }

  await supabase.auth.signOut()
  return { ok: true }
}

/**
 * Change the user's email address. Supabase sends a confirmation link to
 * the NEW email — the change doesn't take effect until that link is
 * clicked. Returns ok=true once the confirmation email is dispatched.
 */
export async function changeEmailAction(formData: FormData): Promise<{
  ok:    boolean
  error?: string
}> {
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = headersList.get('user-agent') ?? null

  if (!rateLimit(`email-change:${ip}`, 5, 600_000)) {
    return { ok: false, error: 'Too many email-change attempts. Please try again later.' }
  }

  const parsed = changeEmailSchema.safeParse({
    newEmail: formData.get('newEmail'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return { ok: false, error: 'Not authenticated.' }

  const newEmail = parsed.data.newEmail.trim().toLowerCase()
  if (newEmail === user.email.toLowerCase()) {
    return { ok: false, error: 'New email matches your current email.' }
  }

  if (!await verifyPasswordIsolated(user.email, parsed.data.password)) {
    return { ok: false, error: 'Incorrect password.' }
  }

  const { error: updErr } = await supabase.auth.updateUser({ email: newEmail })
  if (updErr) {
    return { ok: false, error: updErr.message }
  }

  const service = createServiceClient()
  await logAuthEvent(service, {
    userId:    user.id,
    eventType: 'account_email_changed',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { from_email: user.email, to_email: newEmail },
  })

  return { ok: true }
}
