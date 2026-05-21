'use server'

/**
 * Invitee-side invitation actions — list, accept, decline, complete.
 *
 * These are the counterpart to the admin-side inviteUserAction in users.actions.ts.
 * Each privileged write verifies the caller owns the row before mutating it.
 */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@esite/shared'
import { createHash } from 'crypto'

type ActionResult = { ok: true; warning?: string } | { ok: false; error: string }

/** Minimum zxcvbn score we accept (0–4 scale; 2 = "Fair"). */
const MIN_ACCEPTABLE_SCORE = 2

// ---------------------------------------------------------------------------
// Server-side password helpers
// ---------------------------------------------------------------------------

/** SHA-1 hex of a string using Node's built-in crypto module. */
function sha1Hex(s: string): string {
  return createHash('sha1').update(s).digest('hex').toUpperCase()
}

/**
 * HIBP k-anonymity breach check.
 * Returns the breach count, or null on network failure (treat as unknown, not safe).
 */
async function checkPwnedServer(password: string): Promise<number | null> {
  try {
    const hash   = sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    })
    if (!res.ok) return null
    const text = await res.text()
    for (const line of text.split('\n')) {
      const [s, c] = line.trim().split(':')
      if (s === suffix) return parseInt(c ?? '0', 10) || 1
    }
    return 0
  } catch {
    return null
  }
}

/**
 * Server-side password strength check using zxcvbn-ts.
 * Returns the score (0–4). Throws if the library cannot be loaded.
 */
async function scorePassword(password: string): Promise<number> {
  const [core, common, en] = await Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en'),
  ])
  core.zxcvbnOptions.setOptions({
    translations: en.translations,
    graphs:       common.adjacencyGraphs,
    dictionary:   { ...common.dictionary, ...en.dictionary },
  })
  return core.zxcvbn(password).score
}

// ---------------------------------------------------------------------------
// Exported server actions
// ---------------------------------------------------------------------------

/**
 * List all pending invitations for the currently authenticated user.
 * Returns an empty array when the user is not authenticated.
 */
export async function listPendingInvitationsForCurrentUser(): Promise<
  Array<{
    membershipId:   string
    organisationId: string
    orgName:        string
    role:           string
    invitedByName:  string | null
  }>
> {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return []

  const service = createServiceClient()

  const { data, error } = await service
    .from('user_organisations')
    .select('id, organisation_id, role, organisations(name), profiles!invited_by(full_name)')
    .eq('user_id', user.id)
    .is('accepted_at', null)

  if (error || !data) return []

  return data.map((row) => {
    const org = Array.isArray(row.organisations)
      ? row.organisations[0]
      : row.organisations
    const inviter = Array.isArray(row.profiles)
      ? row.profiles[0]
      : row.profiles

    return {
      membershipId:   row.id as string,
      organisationId: row.organisation_id as string,
      orgName:        (org as { name?: string } | null)?.name ?? 'Unknown organisation',
      role:           row.role as string,
      invitedByName:  (inviter as { full_name?: string } | null)?.full_name ?? null,
    }
  })
}

/**
 * Accept an organisation invitation.
 * The caller must own the membership row and it must still be pending.
 */
export async function acceptOrgInvitationAction(
  input: { membershipId: string },
): Promise<ActionResult> {
  const h  = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const service = createServiceClient()

  // Ownership check: fetch the row and verify it belongs to this user and is pending.
  const { data: row, error: fetchErr } = await service
    .from('user_organisations')
    .select('id, user_id, organisation_id, accepted_at')
    .eq('id', input.membershipId)
    .maybeSingle()

  if (fetchErr || !row) {
    return { ok: false, error: 'This invitation is no longer available.' }
  }
  if (row.user_id !== user.id || row.accepted_at !== null) {
    return { ok: false, error: 'This invitation is no longer available.' }
  }

  const { error: updErr } = await service
    .from('user_organisations')
    .update({ is_active: true, accepted_at: new Date().toISOString() })
    .eq('id', row.id)

  if (updErr) return { ok: false, error: updErr.message }

  await logAuthEvent(service, {
    userId:    user.id,
    eventType: 'user_updated',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { action: 'invitation_accepted', organisation_id: row.organisation_id },
  })

  revalidatePath('/dashboard')
  return { ok: true }
}

/**
 * Decline an organisation invitation.
 * The caller must own the membership row and it must still be pending.
 */
export async function declineOrgInvitationAction(
  input: { membershipId: string },
): Promise<ActionResult> {
  const h  = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const service = createServiceClient()

  // Ownership check: fetch the row and verify it belongs to this user and is pending.
  const { data: row, error: fetchErr } = await service
    .from('user_organisations')
    .select('id, user_id, organisation_id, accepted_at')
    .eq('id', input.membershipId)
    .maybeSingle()

  if (fetchErr || !row) {
    return { ok: false, error: 'This invitation is no longer available.' }
  }
  if (row.user_id !== user.id || row.accepted_at !== null) {
    return { ok: false, error: 'This invitation is no longer available.' }
  }

  const { error: delErr } = await service
    .from('user_organisations')
    .delete()
    .eq('id', row.id)

  if (delErr) return { ok: false, error: delErr.message }

  await logAuthEvent(service, {
    userId:    user.id,
    eventType: 'user_updated',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { action: 'invitation_declined', organisation_id: row.organisation_id },
  })

  revalidatePath('/dashboard')
  return { ok: true }
}

/**
 * Complete an invite — called from the /invite page after a new user has been
 * redirected here via the Supabase invite link (session already established).
 *
 * Sets the password, stamps accepted_at on all pending memberships for this user,
 * and records audit events.
 */
export async function completeInviteAction(
  input: { password: string },
): Promise<ActionResult> {
  const h  = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = h.get('user-agent') ?? null

  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Your session has expired. Please use the invite link again.' }
  }

  const { password } = input

  // Server-side password strength gate.
  let score: number
  try {
    score = await scorePassword(password)
  } catch {
    // If zxcvbn fails to load, reject rather than silently bypass the check.
    return { ok: false, error: 'Password validation is temporarily unavailable. Please try again.' }
  }

  if (score < MIN_ACCEPTABLE_SCORE) {
    return { ok: false, error: 'This password is too weak. Aim for a longer phrase or mix of words.' }
  }

  // HIBP breach check — best-effort; null means the check failed (treat as unknown, not safe).
  // We do NOT block on null (network failure) to avoid locking out users during HIBP downtime,
  // but we DO block on confirmed breaches.
  const pwnCount = await checkPwnedServer(password)
  if (pwnCount !== null && pwnCount > 0) {
    return { ok: false, error: 'This password has appeared in known data breaches — choose a different one.' }
  }

  const service = createServiceClient()

  // Set the password via admin API.
  const { error: pwErr } = await service.auth.admin.updateUserById(user.id, { password })
  if (pwErr) return { ok: false, error: pwErr.message }

  // Stamp accepted_at on all pending memberships for this user.
  await service
    .from('user_organisations')
    .update({ accepted_at: new Date().toISOString(), is_active: true })
    .eq('user_id', user.id)
    .is('accepted_at', null)
  // Non-fatal if no rows matched — the membership may have been cancelled.

  // Audit events.
  await logAuthEvent(service, {
    userId:    user.id,
    eventType: 'password_changed',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { via: 'invite' },
  })
  await logAuthEvent(service, {
    userId:    user.id,
    eventType: 'user_updated',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { action: 'invite_completed' },
  })

  return { ok: true }
}
