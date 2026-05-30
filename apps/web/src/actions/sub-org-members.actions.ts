'use server'

/**
 * Sub-org roster management (PR-B).
 *
 * All actions are gated to ORG_WRITE_ROLES on the SUB-ORG's PARENT organisation.
 * WM admins manage Bob's Building's roster; Bob's Building members cannot
 * admin themselves.
 *
 * See docs/superpowers/specs/2026-05-29-membership-system-design.md sections
 * 2, 4.3, 5.2, 6.3, 6.5.
 */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, logAuthEvent } from '@esite/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionOk<T> = { ok: true } & T
type ActionErr = { ok: false; error: string }

export interface SubOrgMember {
  id: string              // user_organisations.id
  user_id: string
  organisation_id: string // = subOrgId
  role: string
  is_active: boolean
  created_at: string
  full_name: string | null
  email: string | null
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid()

const addMemberSchema = z.object({
  email:    z.string().email('Enter a valid email address.'),
  fullName: z.string().trim().min(2, "Enter the person's full name.").max(120),
  role:     z.string().min(1).default('contractor'),
})

const bulkInviteSchema = z.object({
  subOrgId: z.string().uuid(),
  emails:   z.array(z.string().trim().toLowerCase().email()).min(1).max(200),
  role:     z.string().min(1).default('contractor'),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve the sub-org row and return it; error string if not found/invalid. */
async function resolveSubOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  subOrgId: string,
): Promise<{ id: string; parent_organisation_id: string | null; is_shadow: boolean } | null> {
  const { data } = await (supabase as any)
    .from('organisations')
    .select('id, parent_organisation_id, is_shadow')
    .eq('id', subOrgId)
    .maybeSingle()
  return data ?? null
}

function bustSubOrg(subOrgId: string): void {
  revalidatePath(`/settings/sub-organizations/${subOrgId}`)
}

// ─── Task 1: listSubOrgMembers ────────────────────────────────────────────────

/**
 * Returns active user_organisations rows on the sub-org, joined with profile
 * (full_name + email).
 */
export async function listSubOrgMembers(
  subOrgId: string,
): Promise<ActionOk<{ members: SubOrgMember[] }> | ActionErr> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  if (!uuidSchema.safeParse(subOrgId).success) {
    return { ok: false, error: 'Invalid sub-org id.' }
  }

  const supabase = await createClient()

  // Resolve sub-org to get parent org id for the role gate.
  const subOrg = await resolveSubOrg(supabase, subOrgId)
  if (!subOrg) return { ok: false, error: 'Sub-organisation not found.' }
  if (!subOrg.parent_organisation_id) {
    return { ok: false, error: 'Sub-organisation has been claimed and is no longer managed by you.' }
  }

  // Gate: caller must be ORG_WRITE_ROLES on the PARENT org.
  const guard = await requireRole(supabase, subOrg.parent_organisation_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  const { data, error } = await (supabase as any)
    .from('user_organisations')
    .select('id, user_id, organisation_id, role, is_active, created_at, profiles!user_organisations_user_id_fkey(full_name, email)')
    .eq('organisation_id', subOrgId)
    .eq('is_active', true)
  if (error) return { ok: false, error: error.message }

  const members: SubOrgMember[] = ((data ?? []) as Array<{
    id: string
    user_id: string
    organisation_id: string
    role: string
    is_active: boolean
    created_at: string
    profiles: { full_name: string | null; email: string | null } | null
  }>).map((r) => ({
    id:              r.id,
    user_id:         r.user_id,
    organisation_id: r.organisation_id,
    role:            r.role,
    is_active:       r.is_active,
    created_at:      r.created_at,
    full_name:       r.profiles?.full_name ?? null,
    email:           r.profiles?.email ?? null,
  }))

  return { ok: true, members }
}

// ─── Task 2: addSubOrgMember ──────────────────────────────────────────────────

/**
 * Invite a single person to a sub-org's roster.
 *
 * Flow mirrors createUserAction:
 * 1. Resolve sub-org → confirm shadow + parent matches caller's org.
 * 2. Rate-limit.
 * 3. auth.admin.createUser — handle "already exists" by looking up existing user.
 * 4. Insert user_organisations row targeting the sub-org.
 * 5. resetPasswordForEmail (non-fatal).
 * 6. logAuthEvent.
 * 7. revalidatePath.
 * 8. Return the new SubOrgMember row.
 */
export async function addSubOrgMember(
  subOrgId: string,
  input: { email: string; fullName: string; role?: string },
): Promise<ActionOk<{ member: SubOrgMember }> | ActionErr> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  if (!uuidSchema.safeParse(subOrgId).success) {
    return { ok: false, error: 'Invalid sub-org id.' }
  }

  const supabase = await createClient()

  // 1. Resolve sub-org.
  const subOrg = await resolveSubOrg(supabase, subOrgId)
  if (!subOrg) return { ok: false, error: 'Sub-organisation not found.' }
  if (!subOrg.parent_organisation_id) {
    return { ok: false, error: 'Sub-organisation has been claimed and is no longer managed by you.' }
  }

  // Gate: caller must be ORG_WRITE_ROLES on the PARENT org.
  const guard = await requireRole(supabase, subOrg.parent_organisation_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  // 2. Rate-limit.
  if (!rateLimit(`add-suborg-member:${ctx.userId}`, 20, 60 * 60_000)) {
    return { ok: false, error: 'Too many invitations sent recently. Please wait.' }
  }

  // Validate input.
  const parsed = addMemberSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { fullName, role } = parsed.data
  const email = parsed.data.email.trim().toLowerCase()

  const service = createServiceClient()

  // 3. Provision auth user.
  let newUserId: string

  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? ''
    if (/already|exist|registered/i.test(msg)) {
      // Email collision (spec 6.5): look up existing user id via profiles table.
      const { data: existing } = await (service as any)
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle()
      if (!existing?.id) {
        return { ok: false, error: 'A user with that email already exists but could not be found.' }
      }
      newUserId = existing.id
    } else {
      return { ok: false, error: msg || 'Could not create the user.' }
    }
  } else {
    newUserId = created.user.id
  }

  // 4. Insert user_organisations row targeting the sub-org.
  const { data: memberData, error: memberErr } = await (service as any)
    .from('user_organisations')
    .insert({
      user_id:         newUserId,
      organisation_id: subOrgId,
      role,
      is_active:       true,
      invited_by:      ctx.userId,
      accepted_at:     new Date().toISOString(),
    })
    .select('id, user_id, organisation_id, role, is_active, created_at, profiles!user_organisations_user_id_fkey(full_name, email)')
    .single()

  if (memberErr) {
    // Roll back orphaned auth user only if we just created them.
    if (created?.user) {
      await service.auth.admin.deleteUser(newUserId).catch(() => {})
    }
    return { ok: false, error: `Could not add the member: ${memberErr.message}` }
  }

  // 5. resetPasswordForEmail — non-fatal.
  await service.auth
    .resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password/confirm`,
    })
    .catch(() => {})

  // 6. Audit.
  await logAuthEvent(service, {
    userId:    newUserId,
    eventType: 'user_created',
    ipAddress: ip,
    userAgent: ua,
    metadata:  {
      created_by:          ctx.userId,
      organisation_id:     subOrg.parent_organisation_id,
      role,
      via:                 'sub_org_invite',
      sub_organisation_id: subOrgId,
    },
  })

  // 7. Cache bust.
  bustSubOrg(subOrgId)

  // 8. Return the new member row.
  const raw = memberData as {
    id: string
    user_id: string
    organisation_id: string
    role: string
    is_active: boolean
    created_at: string
    profiles: { full_name: string | null; email: string | null } | null
  }
  const member: SubOrgMember = {
    id:              raw.id,
    user_id:         raw.user_id,
    organisation_id: raw.organisation_id,
    role:            raw.role,
    is_active:       raw.is_active,
    created_at:      raw.created_at,
    full_name:       raw.profiles?.full_name ?? null,
    email:           raw.profiles?.email ?? null,
  }
  return { ok: true, member }
}

// ─── Task 3: removeSubOrgMember ───────────────────────────────────────────────

/**
 * Soft-deactivate a sub-org membership by setting is_active=false.
 *
 * Per spec 6.3: does NOT cascade to project_members (PR-D handles revocation).
 * Gate: caller must be ORG_WRITE_ROLES on the SUB-ORG's parent org.
 */
export async function removeSubOrgMember(
  memberId: string,
): Promise<{ ok: true } | ActionErr> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  if (!uuidSchema.safeParse(memberId).success) {
    return { ok: false, error: 'Invalid member id.' }
  }

  const supabase = await createClient()

  // Fetch the member row to get its organisation_id.
  const { data: memberRow, error: memberErr } = await (supabase as any)
    .from('user_organisations')
    .select('id, user_id, organisation_id, role, is_active')
    .eq('id', memberId)
    .maybeSingle()
  if (memberErr) return { ok: false, error: memberErr.message }
  if (!memberRow) return { ok: false, error: 'Member not found.' }

  const subOrgId = (memberRow as { organisation_id: string }).organisation_id

  // Confirm the org is a sub-org of the caller's org.
  const subOrg = await resolveSubOrg(supabase, subOrgId)
  if (!subOrg) return { ok: false, error: 'This membership does not belong to a sub-organisation.' }
  if (!subOrg.parent_organisation_id) {
    return { ok: false, error: 'Sub-organisation has been claimed and is no longer managed by you.' }
  }

  // Gate: caller must be ORG_WRITE_ROLES on the parent org.
  const guard = await requireRole(supabase, subOrg.parent_organisation_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  // Soft-deactivate.
  const { error: updateErr } = await (supabase as any)
    .from('user_organisations')
    .update({ is_active: false })
    .eq('id', memberId)
  if (updateErr) return { ok: false, error: updateErr.message }

  bustSubOrg(subOrgId)
  return { ok: true }
}

// ─── Task 4: bulkInviteSubOrgMembers ─────────────────────────────────────────

export type BulkSubOrgStatus =
  | 'invited'                       // new user provisioned + added to sub-org
  | 'added'                         // existing user added to sub-org
  | 'skipped-already-in-sub-org'    // user already an active member
  | 'failed'

export interface BulkSubOrgResult {
  ok: true
  summary: { invited: number; added: number; skipped: number; failed: number }
  details: Array<{ email: string; status: BulkSubOrgStatus; reason?: string }>
}

export interface BulkSubOrgInput {
  subOrgId: string
  emails:   string[]
  role?:    string
}

/**
 * Bulk invite a list of emails to a sub-org's roster.
 *
 * For each email:
 *   - Already active in sub-org → skipped-already-in-sub-org.
 *   - Exists as auth user but not in sub-org → added.
 *   - New user → provisioned (auth + user_organisations) → invited.
 *
 * Rate-limit: 5 per hour per caller.
 * Default role: 'contractor'.
 */
export async function bulkInviteSubOrgMembers(
  input: BulkSubOrgInput,
): Promise<BulkSubOrgResult | { ok: false; error: string }> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = h.get('user-agent') ?? null

  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const parsed = bulkInviteSchema.safeParse({
    subOrgId: input.subOrgId,
    emails:   input.emails,
    role:     input.role ?? 'contractor',
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const supabase = await createClient()

  // Resolve sub-org → confirm parent.
  const subOrg = await resolveSubOrg(supabase, parsed.data.subOrgId)
  if (!subOrg) return { ok: false, error: 'Sub-organisation not found.' }
  if (!subOrg.parent_organisation_id) {
    return { ok: false, error: 'Sub-organisation has been claimed and is no longer managed by you.' }
  }

  // Gate: caller must be ORG_WRITE_ROLES on the parent org.
  const guard = await requireRole(supabase, subOrg.parent_organisation_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  // Rate-limit: 5 bulk ops per hour per caller.
  if (!rateLimit(`bulk-suborg-invite:${ctx.userId}`, 5, 60 * 60_000)) {
    return { ok: false, error: 'Too many bulk operations recently. Please wait.' }
  }

  const emails = Array.from(new Set(parsed.data.emails))
  const role   = parsed.data.role

  // Fetch existing active sub-org members by user_id + profile email, to detect
  // "already in sub-org" and "existing user not yet in sub-org".
  const { data: existingMembersData } = await (supabase as any)
    .from('user_organisations')
    .select('user_id, profiles!user_organisations_user_id_fkey(email)')
    .eq('organisation_id', parsed.data.subOrgId)
    .eq('is_active', true)

  const inSubOrgByEmail = new Set<string>()
  for (const row of ((existingMembersData ?? []) as Array<{
    user_id: string
    profiles: { email: string | null } | null
  }>)) {
    const e = row.profiles?.email?.trim().toLowerCase()
    if (e) inSubOrgByEmail.add(e)
  }

  const service = createServiceClient()

  let invited = 0
  let added   = 0
  let skipped = 0
  let failed  = 0
  const details: BulkSubOrgResult['details'] = []

  for (const email of emails) {
    try {
      // Already active in sub-org.
      if (inSubOrgByEmail.has(email)) {
        skipped++
        details.push({ email, status: 'skipped-already-in-sub-org' })
        continue
      }

      // Try to provision new user.
      let newUserId: string
      let isExisting = false

      const { data: created, error: createErr } = await service.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: email.split('@')[0] },
      })

      if (createErr || !created?.user) {
        const msg = createErr?.message ?? ''
        if (/already|exist|registered/i.test(msg)) {
          // Email collision: look up via profiles.
          const { data: existing } = await (service as any)
            .from('profiles')
            .select('id')
            .eq('email', email)
            .maybeSingle()
          if (!existing?.id) {
            failed++
            details.push({ email, status: 'failed', reason: 'User exists but could not be resolved.' })
            continue
          }
          newUserId  = existing.id
          isExisting = true
        } else {
          failed++
          details.push({ email, status: 'failed', reason: msg || 'Could not create user.' })
          continue
        }
      } else {
        newUserId = created.user.id
      }

      // Insert user_organisations row for the sub-org.
      const { error: memErr } = await (service as any)
        .from('user_organisations')
        .insert({
          user_id:         newUserId,
          organisation_id: parsed.data.subOrgId,
          role,
          is_active:       true,
          invited_by:      ctx.userId,
          accepted_at:     new Date().toISOString(),
        })

      if (memErr) {
        if (!isExisting && created?.user) {
          await service.auth.admin.deleteUser(newUserId).catch(() => {})
        }
        failed++
        details.push({ email, status: 'failed', reason: memErr.message })
        continue
      }

      // Set-password email — non-fatal.
      await service.auth
        .resetPasswordForEmail(email, {
          redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password/confirm`,
        })
        .catch(() => {})

      if (!isExisting) {
        await logAuthEvent(service, {
          userId:    newUserId,
          eventType: 'user_created',
          ipAddress: ip,
          userAgent: ua,
          metadata:  {
            created_by:          ctx.userId,
            organisation_id:     subOrg.parent_organisation_id,
            role,
            via:                 'bulk_suborg_invite',
            sub_organisation_id: parsed.data.subOrgId,
          },
        })
        invited++
        details.push({ email, status: 'invited' })
      } else {
        added++
        details.push({ email, status: 'added' })
      }
    } catch (e) {
      failed++
      details.push({
        email,
        status: 'failed',
        reason: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  revalidatePath(`/settings/sub-organizations/${parsed.data.subOrgId}`)
  return { ok: true, summary: { invited, added, skipped, failed }, details }
}

// ─── PR-D Task 2: getProjectMembershipsForUser ────────────────────────────────

/**
 * Return the count and names of projects (within the caller's org) that the
 * given user is actively on via project_members. Used to populate the cascade
 * warning before removing a sub-org roster member (spec §6.3).
 *
 * Gate: caller must be ORG_WRITE_ROLES on their primary org.
 */
export async function getProjectMembershipsForUser(
  userId: string,
  parentOrgId: string,
): Promise<ActionOk<{ count: number; projectNames: string[] }> | ActionErr> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const supabase = await createClient()

  const guard = await requireRole(supabase, parentOrgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  // project_members joined with projects (scoped to caller's org).
  const { data, error } = await (supabase as any)
    .from('project_members')
    .select('projects!inner(id, name, organisation_id)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('projects.organisation_id', parentOrgId)

  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []) as Array<{ projects: { name: string } }>
  const projectNames = rows.map((r) => r.projects.name).filter(Boolean)
  return { ok: true, count: projectNames.length, projectNames }
}
