'use server'

/**
 * Seat-pool management for the generator_cost_recovery per-seat add-on.
 *
 * All actions are owner/admin gated on the caller's primary org.
 * Writes go through a service client because billing.org_feature_seats
 * has no authenticated write policy.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { OWNER_ADMIN } from '@esite/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgMember {
  id:         string   // user_organisations.id
  user_id:    string
  role:       string
  full_name:  string | null
  email:      string | null
}

export interface SeatRow {
  id:               string
  organisation_id:  string
  feature_key:      string
  assigned_user_id: string | null
  purchased_at:     string
  assigned_at:      string | null
}

export interface SeatMember extends OrgMember {
  seat: SeatRow | null  // null = no seat
}

export type SeatsResult =
  | { ok: true; members: SeatMember[]; totalSeats: number; assignedSeats: number }
  | { ok: false; error: string }

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid()

async function resolveOrgAndGate(): Promise<
  { ok: true; organisationId: string; userId: string } | { ok: false; error: string }
> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()
  const guard = await requireRole(supabase, ctx.organisationId, OWNER_ADMIN)
  if (!guard.ok) return { ok: false, error: guard.error }

  return { ok: true, organisationId: ctx.organisationId, userId: ctx.userId }
}

// ─── listSeatsAction ──────────────────────────────────────────────────────────

/**
 * Returns all active org members joined with their seat state for the
 * generator_cost_recovery feature.
 */
export async function listSeatsAction(): Promise<SeatsResult> {
  const gated = await resolveOrgAndGate()
  if (!gated.ok) return gated

  const { organisationId } = gated
  const service = createServiceClient()

  const [membersResult, seatsResult] = await Promise.all([
    (service as any)
      .from('user_organisations')
      .select('id, user_id, role, profiles!user_organisations_user_id_fkey(full_name, email)')
      .eq('organisation_id', organisationId)
      .eq('is_active', true)
      .order('created_at'),
    (service as any)
      .schema('billing')
      .from('org_feature_seats')
      .select('id, organisation_id, feature_key, assigned_user_id, purchased_at, assigned_at')
      .eq('organisation_id', organisationId)
      .eq('feature_key', 'generator_cost_recovery'),
  ])

  if (membersResult.error) return { ok: false, error: membersResult.error.message }
  if (seatsResult.error)   return { ok: false, error: seatsResult.error.message }

  const rawMembers = (membersResult.data ?? []) as Array<{
    id: string
    user_id: string
    role: string
    profiles: { full_name: string | null; email: string | null } | null
  }>

  const seats = (seatsResult.data ?? []) as SeatRow[]

  const seatByUser = new Map<string, SeatRow>()
  for (const s of seats) {
    if (s.assigned_user_id) seatByUser.set(s.assigned_user_id, s)
  }

  const members: SeatMember[] = rawMembers.map((m) => ({
    id:        m.id,
    user_id:   m.user_id,
    role:      m.role,
    full_name: m.profiles?.full_name ?? null,
    email:     m.profiles?.email ?? null,
    seat:      seatByUser.get(m.user_id) ?? null,
  }))

  const totalSeats    = seats.length
  const assignedSeats = seats.filter((s) => s.assigned_user_id !== null).length

  return { ok: true, members, totalSeats, assignedSeats }
}

// ─── reassignSeatAction ───────────────────────────────────────────────────────

/**
 * Move or free a seat.
 * - newUserId = string → assign to that org member (must not already hold a seat)
 * - newUserId = null   → free the seat back to the pool
 */
export async function reassignSeatAction(
  seatId: string,
  newUserId: string | null,
): Promise<ActionResult> {
  if (!uuidSchema.safeParse(seatId).success) {
    return { ok: false, error: 'Invalid seat id.' }
  }
  if (newUserId !== null && !uuidSchema.safeParse(newUserId).success) {
    return { ok: false, error: 'Invalid user id.' }
  }

  const gated = await resolveOrgAndGate()
  if (!gated.ok) return gated

  const { organisationId } = gated
  const service = createServiceClient()

  // Verify the seat belongs to the caller's org.
  const { data: seat, error: seatErr } = await (service as any)
    .schema('billing')
    .from('org_feature_seats')
    .select('id, organisation_id, assigned_user_id')
    .eq('id', seatId)
    .eq('feature_key', 'generator_cost_recovery')
    .maybeSingle()

  if (seatErr)  return { ok: false, error: seatErr.message }
  if (!seat)    return { ok: false, error: 'Seat not found.' }
  if ((seat as { organisation_id: string }).organisation_id !== organisationId) {
    return { ok: false, error: 'Seat does not belong to your organisation.' }
  }

  if (newUserId !== null) {
    // Verify newUserId is an active member of the org.
    const { data: member } = await (service as any)
      .from('user_organisations')
      .select('user_id')
      .eq('user_id', newUserId)
      .eq('organisation_id', organisationId)
      .eq('is_active', true)
      .maybeSingle()

    if (!member) {
      return { ok: false, error: 'That user is not an active member of your organisation.' }
    }

    // Check the user doesn't already hold a seat for this feature (unique index guard).
    const { data: existing } = await (service as any)
      .schema('billing')
      .from('org_feature_seats')
      .select('id')
      .eq('organisation_id', organisationId)
      .eq('feature_key', 'generator_cost_recovery')
      .eq('assigned_user_id', newUserId)
      .maybeSingle()

    if (existing) {
      return { ok: false, error: 'That user already holds a Generator seat.' }
    }
  }

  const patch: { assigned_user_id: string | null; assigned_at: string | null } = {
    assigned_user_id: newUserId,
    assigned_at:      newUserId ? new Date().toISOString() : null,
  }

  const { error: updateErr } = await (service as any)
    .schema('billing')
    .from('org_feature_seats')
    .update(patch)
    .eq('id', seatId)

  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath('/settings/billing/seats')
  return { ok: true }
}
