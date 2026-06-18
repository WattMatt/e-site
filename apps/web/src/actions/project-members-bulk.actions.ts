'use server'

/**
 * Bulk add-or-invite project members.
 *
 * Takes a list of emails and a project role. For each email:
 *   - If a user with that email already exists in this org → add them to
 *     project_members with the chosen role.
 *   - Else → invite an org user via auth.admin.inviteUserByEmail (provisions
 *     auth.users with no password AND fires the branded role/site-aware invite
 *     hook) + user_organisations, then add to project_members.
 *
 * The bulk role determines BOTH the project_members.role AND the new user's
 * org role — EXCEPT when the bulk role is 'project_manager'. In that case
 * we set the new user's org role to 'contractor' so the PM promotion stays
 * scoped to THIS project only (it would otherwise auto-pass them onto every
 * project in the org via user_has_project_access clause 2).
 *
 * Gated to ORG_WRITE_ROLES on the project's org. Rate-limited per caller.
 *
 * Returns a per-email outcome list so the UI can render a summary modal.
 */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { requireRole } from '@/lib/auth/require-role'
import { getOrgContext } from '@/lib/auth-org'
import { ORG_WRITE_ROLES, logAuthEvent } from '@esite/shared'

const PROJECT_MEMBER_ROLES = [
  'project_manager',
  'contractor',
  'inspector',
  'supplier',
  'client_viewer',
] as const

const inputSchema = z.object({
  projectId: z.string().uuid(),
  emails: z
    .array(z.string().trim().toLowerCase().email())
    .min(1, 'Enter at least one email address.')
    .max(50, 'Up to 50 emails per bulk operation.'),
  projectRole: z.enum(PROJECT_MEMBER_ROLES),
})

export type BulkAddStatus =
  | 'added'                       // existing org user added to project
  | 'invited-and-added'           // new user provisioned + added to project
  | 'skipped-already-on-project'  // existing user already a member
  | 'failed'

export interface BulkAddResult {
  ok: true
  summary: { invited: number; added: number; skipped: number; failed: number }
  details: Array<{ email: string; status: BulkAddStatus; reason?: string }>
}

export interface BulkAddInput {
  projectId: string
  emails: string[]
  projectRole: string
}

export async function bulkAddOrInviteProjectMembers(
  input: BulkAddInput,
): Promise<BulkAddResult | { ok: false; error: string }> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not authenticated.' }

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const supabase = await createClient()

  // Resolve project's org (+ name for the invite email's site_name).
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id, name')
    .eq('id', parsed.data.projectId)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found.' }
  const orgId = (project as { organisation_id: string; name: string | null }).organisation_id
  const projectName = (project as { organisation_id: string; name: string | null }).name

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  // One bulk call per 12-min window per user — prevents accidental floods.
  if (!rateLimit(`bulk-invite:${ctx.userId}`, 5, 60 * 60_000)) {
    return { ok: false, error: 'Too many bulk operations recently. Please wait.' }
  }

  // Dedupe & lowercase emails (zod already lowercased; defensive de-dupe).
  const emails = Array.from(new Set(parsed.data.emails))

  // Existing project members — used to detect "already on this project".
  const { data: existingRows } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', parsed.data.projectId)
  const onProjectUserIds = new Set(
    ((existingRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  )

  // All active org users by email — used to detect "user exists in org".
  const { data: orgUsersData } = await (supabase as any)
    .from('user_organisations')
    .select('user_id, role, profiles!user_organisations_user_id_fkey(email)')
    .eq('organisation_id', orgId)
    .eq('is_active', true)
  const orgUserByEmail = new Map<string, { user_id: string; org_role: string }>()
  for (const row of ((orgUsersData ?? []) as Array<{
    user_id: string
    role: string
    profiles: { email: string | null } | null
  }>)) {
    const e = row.profiles?.email?.trim().toLowerCase()
    if (e) orgUserByEmail.set(e, { user_id: row.user_id, org_role: row.role })
  }

  // Per-row processing — service client for createUser etc. New users get
  // org role = projectRole, except 'project_manager' is downgraded to
  // 'contractor' to keep the PM promotion project-scoped (see header).
  const service = createServiceClient()
  const projectRole = parsed.data.projectRole
  const orgRoleForNewUsers = projectRole === 'project_manager' ? 'contractor' : projectRole

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = h.get('user-agent') ?? null

  let invited = 0
  let added = 0
  let skipped = 0
  let failed = 0
  const details: BulkAddResult['details'] = []

  for (const email of emails) {
    try {
      const existing = orgUserByEmail.get(email)

      if (existing) {
        if (onProjectUserIds.has(existing.user_id)) {
          skipped++
          details.push({ email, status: 'skipped-already-on-project' })
          continue
        }
        const { error: insErr } = await (supabase as any)
          .schema('projects')
          .from('project_members')
          .insert({
            project_id: parsed.data.projectId,
            user_id: existing.user_id,
            organisation_id: orgId,
            role: projectRole,
          })
        if (insErr) {
          failed++
          details.push({ email, status: 'failed', reason: insErr.message })
          continue
        }
        added++
        details.push({ email, status: 'added' })
        continue
      }

      // Invite new user — provisions the auth row (no password) AND fires the
      // branded role/site-aware invite hook. Role/org/site context rides in
      // `data` (user_metadata); org_name + inviter_name are null and backfilled
      // by the hook. An existing-but-not-in-org email is reported, not added.
      let newUserId: string
      let createdHere = false

      const { data: inviteRes, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
        data: {
          full_name:    email.split('@')[0], // placeholder; user can update on signup
          invited_role: orgRoleForNewUsers,
          org_id:       orgId,
          org_name:     null,
          inviter_name: null,
          ...(projectName ? { site_name: projectName } : {}),
        },
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`,
      })
      if (inviteErr || !inviteRes?.user) {
        failed++
        details.push({
          email,
          status: 'failed',
          reason: /already|exist|registered/i.test(inviteErr?.message ?? '')
            ? 'A user with that email already exists but isn’t in your org.'
            : (inviteErr?.message ?? 'Could not invite user.'),
        })
        continue
      }
      newUserId = inviteRes.user.id
      createdHere = true

      const { error: memErr } = await service.from('user_organisations').insert({
        user_id: newUserId,
        organisation_id: orgId,
        role: orgRoleForNewUsers,
        is_active: true,
        invited_by: ctx.userId,
        accepted_at: new Date().toISOString(),
      })
      if (memErr) {
        // Roll back the orphaned auth user only if we just created them.
        if (createdHere) {
          await service.auth.admin.deleteUser(newUserId).catch(() => {})
        }
        failed++
        details.push({ email, status: 'failed', reason: memErr.message })
        continue
      }

      await logAuthEvent(service, {
        userId: newUserId,
        eventType: 'user_created',
        ipAddress: ip,
        userAgent: ua,
        metadata: {
          created_by: ctx.userId,
          organisation_id: orgId,
          role: orgRoleForNewUsers,
          via: 'bulk_invite',
          project_id: parsed.data.projectId,
        },
      })

      const { error: pmErr } = await (service as any)
        .schema('projects')
        .from('project_members')
        .insert({
          project_id: parsed.data.projectId,
          user_id: newUserId,
          organisation_id: orgId,
          role: projectRole,
        })
      if (pmErr) {
        // User invited but not added to project. Log + report so the admin
        // can finish manually rather than rolling back the auth user.
        console.error('bulk-invite: created user but failed to add to project', {
          email,
          newUserId,
          error: pmErr.message,
        })
        failed++
        details.push({
          email,
          status: 'failed',
          reason: `User invited but could not be added to the project: ${pmErr.message}`,
        })
        continue
      }
      invited++
      details.push({ email, status: 'invited-and-added' })
    } catch (e) {
      failed++
      details.push({
        email,
        status: 'failed',
        reason: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  revalidatePath(`/projects/${parsed.data.projectId}/settings/members`)
  return { ok: true, summary: { invited, added, skipped, failed }, details }
}
