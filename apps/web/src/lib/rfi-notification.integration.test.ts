// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { rfiService, projectSettingsService } from '@esite/shared'

/**
 * Live-DB integration test for the team-wide RFI notification fan-out.
 *
 * Proves that a MOBILE-STYLE create — `rfiService.create` called with a normal
 * user-scoped client (no service key, exactly what apps/mobile does) — notifies
 * the whole active project audience via the bell channel. The shared service
 * invokes the `notify-rfi-created` Edge Function, which resolves recipients live
 * (00146 project_notification_recipients) and calls `send-notification`, which
 * persists `public.notifications` rows — the observable signal asserted here.
 *
 * Email is gated OFF in this test to keep the bell assertion deterministic and
 * free of an external Resend dependency; the email recipient logic is covered by
 * the pure unit test of `buildRfiEmailRecipients`.
 *
 * Requires local Supabase + the Edge Functions SERVED (the fan-out is now
 * out-of-process):
 *   supabase functions serve   # serves notify-rfi-created + send-notification
 *
 * And env:
 *   RUN_INTEGRATION_TESTS=true, NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *
 * Run: RUN_INTEGRATION_TESTS=true NEXT_PUBLIC_SUPABASE_URL=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
 *   pnpm --filter web exec vitest run src/lib/rfi-notification.integration.test.ts
 */

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true'
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const PASSWORD = 'Test-Passw0rd!'

describe.skipIf(!runIntegration)('notify-rfi-created — INTEGRATION (live DB + served functions)', () => {
  let admin: SupabaseClient
  let orgId: string
  let projectId: string
  let assigneeId: string
  let raiserId: string
  let member3Id: string
  let inactiveId: string
  let createdRfiId: string | undefined
  const ts = Date.now()
  const raiserEmail = `it-n-raiser-${ts}@example.com`

  beforeAll(async () => {
    if (!URL || !SERVICE || !ANON) {
      throw new Error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY')
    }
    admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: org, error: orgErr } = await (admin as any)
      .from('organisations').insert({ name: `IT NOrg ${ts}`, slug: `it-notify-org-${ts}` }).select('id').single()
    if (orgErr) throw orgErr
    orgId = org.id

    const mkUser = async (email: string, name: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name },
      })
      if (error || !data.user) throw error ?? new Error('createUser failed')
      return data.user.id
    }
    assigneeId = await mkUser(`it-n-assignee-${ts}@example.com`, 'Bob Assignee')
    raiserId = await mkUser(raiserEmail, 'Jane Raiser')
    member3Id = await mkUser(`it-n-member3-${ts}@example.com`, 'Carol Member')
    inactiveId = await mkUser(`it-n-inactive-${ts}@example.com`, 'Dave Inactive')

    // Contractors so the audience is governed purely by project membership — org
    // owners/admins/PMs get implicit access (00146) which would broaden it.
    await (admin as any).from('user_organisations').insert(
      [assigneeId, raiserId, member3Id, inactiveId].map((user_id) => ({
        user_id, organisation_id: orgId, role: 'contractor', is_active: true,
      })),
    )

    const { data: proj, error: projErr } = await (admin as any)
      .schema('projects').from('projects')
      .insert({ name: `Notify ${ts}`, organisation_id: orgId, created_by: raiserId })
      .select('id').single()
    if (projErr) throw projErr
    projectId = proj.id

    // Roster: assignee + raiser + member3 active; inactive is is_active=false.
    await (admin as any).schema('projects').from('project_members').insert([
      { project_id: projectId, organisation_id: orgId, user_id: assigneeId, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: raiserId, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: member3Id, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: inactiveId, is_active: false },
    ])

    // Isolate the bell channel — no external Resend dependency.
    await projectSettingsService.update(admin as any, projectId, { notifyRfiEmail: false })
  }, 60_000)

  afterAll(async () => {
    try { if (createdRfiId) await admin.from('notifications').delete().eq('entity_id', createdRfiId) } catch { /* ignore */ }
    try { if (projectId) await (admin as any).schema('projects').from('projects').delete().eq('id', projectId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('user_organisations').delete().eq('organisation_id', orgId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('organisations').delete().eq('id', orgId) } catch { /* ignore */ }
    for (const uid of [assigneeId, raiserId, member3Id, inactiveId]) {
      try { if (uid) await admin.auth.admin.deleteUser(uid) } catch { /* ignore */ }
    }
  }, 60_000)

  it('bell-notifies every ACTIVE audience member except the raiser (mobile-style create)', async () => {
    // Mobile path: a plain user-scoped client (no service key) creates the RFI;
    // rfiService.create invokes notify-rfi-created with the raiser's own JWT.
    const userClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: signInErr } = await userClient.auth.signInWithPassword({ email: raiserEmail, password: PASSWORD })
    if (signInErr) throw signInErr

    const rfi = await rfiService.create(userClient as any, orgId, raiserId, {
      projectId,
      subject: 'Busbar clearance query',
      description: 'Please confirm the busbar clearance against the spec.',
      priority: 'high',
      category: '',
      dueDate: '',
    })
    createdRfiId = rfi.id

    const { data: notifs, error } = await admin
      .from('notifications')
      .select('user_id, type, action_url, entity_type, entity_id')
      .eq('entity_id', rfi.id)
    if (error) throw error

    const userIds = (notifs ?? []).map((n: any) => n.user_id).sort()
    // assignee + member3 (active) — NOT the raiser, NOT inactive, NOT non-members.
    expect(userIds).toEqual([assigneeId, member3Id].sort())
    expect(userIds).not.toContain(raiserId)
    expect(userIds).not.toContain(inactiveId)

    for (const n of notifs ?? []) {
      expect((n as any).type).toBe('rfi_created')
      expect((n as any).entity_type).toBe('rfi')
      expect((n as any).action_url).toBe(`/rfis/${rfi.id}`)
    }
  }, 60_000)
})
