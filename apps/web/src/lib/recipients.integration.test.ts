// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveProjectRecipients } from './recipients'

/**
 * Live-DB test for the canonical recipient resolver (00146 SQL function).
 * Proves: explicit active members + IMPLICIT org admins (no project_members
 * row) are included; inactive members + the actor are excluded.
 *
 * RUN_INTEGRATION_TESTS=true NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   pnpm --filter web exec vitest run src/lib/recipients.integration.test.ts
 */
const run = process.env.RUN_INTEGRATION_TESTS === 'true'
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

describe.skipIf(!run)('resolveProjectRecipients — INTEGRATION (live DB, fn 00146)', () => {
  let admin: SupabaseClient
  let orgId: string
  let projectId: string
  const ts = Date.now()
  const ids: Record<string, string> = {}
  const emails = {
    actor: `it-actor-${ts}@example.com`,        // PM, explicit member — excluded (actor)
    contractor: `it-con-${ts}@example.com`,     // explicit active member — included
    admin: `it-admin-${ts}@example.com`,        // org admin, NOT a project member — included (implicit)
    inactive: `it-inactive-${ts}@example.com`,  // explicit INACTIVE member — excluded
  }

  beforeAll(async () => {
    if (!URL || !SERVICE) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: org } = await (admin as any).from('organisations')
      .insert({ name: `Recip Org ${ts}`, slug: `recip-${ts}` }).select('id').single()
    orgId = org.id

    const mk = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test-Passw0rd!', email_confirm: true, user_metadata: { full_name: email } })
      if (error || !data.user) throw error ?? new Error('createUser')
      return data.user.id
    }
    for (const [k, e] of Object.entries(emails)) ids[k] = await mk(e)

    await (admin as any).from('user_organisations').insert([
      { user_id: ids.actor, organisation_id: orgId, role: 'project_manager', is_active: true },
      { user_id: ids.contractor, organisation_id: orgId, role: 'contractor', is_active: true },
      { user_id: ids.admin, organisation_id: orgId, role: 'admin', is_active: true },
      { user_id: ids.inactive, organisation_id: orgId, role: 'contractor', is_active: true },
    ])

    const { data: proj } = await (admin as any).schema('projects').from('projects')
      .insert({ name: `Recip Project ${ts}`, organisation_id: orgId, created_by: ids.actor }).select('id').single()
    projectId = proj.id

    await (admin as any).schema('projects').from('project_members').insert([
      { project_id: projectId, organisation_id: orgId, user_id: ids.actor, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: ids.contractor, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: ids.inactive, is_active: false },
      // NB: admin is intentionally NOT a project_members row — implicit access only.
    ])
  }, 60_000)

  afterAll(async () => {
    try { if (projectId) await (admin as any).schema('projects').from('projects').delete().eq('id', projectId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('user_organisations').delete().eq('organisation_id', orgId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('organisations').delete().eq('id', orgId) } catch { /* ignore */ }
    for (const id of Object.values(ids)) { try { await admin.auth.admin.deleteUser(id) } catch { /* ignore */ } }
  }, 60_000)

  it('includes explicit members + implicit org admins, excludes inactive + actor', async () => {
    const { emails: got } = await resolveProjectRecipients(projectId, { excludeUserId: ids.actor })
    const lower = got.map((e) => e.toLowerCase()).sort()
    expect(lower).toEqual([emails.admin, emails.contractor].sort())
    expect(lower).not.toContain(emails.actor)     // actor excluded
    expect(lower).not.toContain(emails.inactive)  // inactive member excluded
  }, 30_000)

  it('without excludeUserId, the actor (an explicit member) is included', async () => {
    const { emails: got } = await resolveProjectRecipients(projectId)
    expect(got.map((e) => e.toLowerCase())).toContain(emails.actor)
  }, 30_000)
})
