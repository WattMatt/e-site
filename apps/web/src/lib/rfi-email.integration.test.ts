// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { projectSettingsService } from '@esite/shared'
import { dispatchRfiEmail } from './rfi-email'

/**
 * Live-DB integration test for the RFI email channel. Proves that
 * dispatchRfiEmail, fed real profiles + project settings, resolves the right
 * recipients and invokes send-email per recipient with the link + description.
 * The external Resend HTTP call (send-email → Resend) is the only mocked seam.
 *
 * Requires local Supabase + env:
 *   RUN_INTEGRATION_TESTS=true, NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 *
 * Run: RUN_INTEGRATION_TESTS=true NEXT_PUBLIC_SUPABASE_URL=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
 *   pnpm --filter web exec vitest run src/lib/rfi-email.integration.test.ts
 */

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true'
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

describe.skipIf(!runIntegration)('dispatchRfiEmail — INTEGRATION (live DB)', () => {
  let admin: SupabaseClient
  let orgId: string
  let projectId: string
  let assigneeId: string
  let raiserId: string
  let member3Id: string
  let inactiveId: string
  const ts = Date.now()
  const assigneeEmail = `it-assignee-${ts}@example.com`
  const raiserEmail = `it-raiser-${ts}@example.com`
  const member3Email = `it-member3-${ts}@example.com`
  const inactiveEmail = `it-inactive-${ts}@example.com`

  beforeAll(async () => {
    if (!URL || !SERVICE) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    // dispatchRfiEmail reads these from the env at call time.
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.e-site.live'

    admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: org, error: orgErr } = await (admin as any)
      .from('organisations').insert({ name: `IT Org ${ts}`, slug: `it-email-org-${ts}` }).select('id').single()
    if (orgErr) throw orgErr
    orgId = org.id

    const mkUser = async (email: string, name: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: 'Test-Passw0rd!', email_confirm: true, user_metadata: { full_name: name },
      })
      if (error || !data.user) throw error ?? new Error('createUser failed')
      return data.user.id
    }
    assigneeId = await mkUser(assigneeEmail, 'Bob Assignee')
    raiserId = await mkUser(raiserEmail, 'Jane Raiser')
    member3Id = await mkUser(member3Email, 'Carol Member')
    inactiveId = await mkUser(inactiveEmail, 'Dave Inactive')

    await (admin as any).from('user_organisations').insert(
      [assigneeId, raiserId, member3Id, inactiveId].map((user_id) => ({
        user_id, organisation_id: orgId, role: 'project_manager', is_active: true,
      })),
    )

    const { data: proj, error: projErr } = await (admin as any)
      .schema('projects').from('projects')
      .insert({ name: `Centurion ${ts}`, organisation_id: orgId, created_by: raiserId })
      .select('id').single()
    if (projErr) throw projErr
    projectId = proj.id

    // Roster: assignee + raiser + member3 are active; inactive is is_active=false.
    await (admin as any).schema('projects').from('project_members').insert([
      { project_id: projectId, organisation_id: orgId, user_id: assigneeId, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: raiserId, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: member3Id, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: inactiveId, is_active: false },
    ])
  }, 60_000)

  afterAll(async () => {
    try { if (projectId) await (admin as any).schema('projects').from('projects').delete().eq('id', projectId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('user_organisations').delete().eq('organisation_id', orgId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('organisations').delete().eq('id', orgId) } catch { /* ignore */ }
    for (const uid of [assigneeId, raiserId, member3Id, inactiveId]) { try { if (uid) await admin.auth.admin.deleteUser(uid) } catch { /* ignore */ } }
    vi.restoreAllMocks()
  }, 60_000)

  function mockFetch() {
    const calls: Array<{ url: string; body: any }> = []
    const realFetch = globalThis.fetch.bind(globalThis)
    // Intercept ONLY the send-email call; pass Supabase REST/DB reads through
    // to the real fetch (dispatchRfiEmail reads profiles/settings via the client).
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const u = String(url)
      if (u.includes('/functions/v1/send-email')) {
        calls.push({ url: u, body: JSON.parse(init.body) })
        return new Response(JSON.stringify({ sent: true }), { status: 200 })
      }
      return realFetch(url, init)
    })
    return { calls, spy }
  }

  it('sends nothing when notifyRfiEmail is OFF', async () => {
    await projectSettingsService.update(admin as any, projectId, { notifyRfiEmail: false })
    const { calls, spy } = mockFetch()
    await dispatchRfiEmail({
      projectId, rfiId: 'rfi-xyz', rfiSubject: 'Busbar query',
      priority: 'high', dueDate: '2026-07-01', assigneeId, raiserId,
    })
    expect(calls).toHaveLength(0)
    spy.mockRestore()
  }, 30_000)

  it('emails every ACTIVE project member (not inactive, not non-members) when ON', async () => {
    await projectSettingsService.update(admin as any, projectId, { notifyRfiEmail: true })
    const { calls, spy } = mockFetch()
    await dispatchRfiEmail({
      projectId, rfiId: 'rfi-xyz', rfiSubject: 'Busbar query',
      priority: 'high', dueDate: '2026-07-01', assigneeId, raiserId,
    })

    // One send-email call per recipient.
    expect(calls.every((c) => c.url.endsWith('/functions/v1/send-email'))).toBe(true)
    const recipients = calls.map((c) => c.body.payload.to.toLowerCase()).sort()
    // assignee + raiser + member3 (active) — NOT inactive member.
    expect(recipients).toEqual([assigneeEmail, raiserEmail, member3Email].sort())
    expect(recipients).not.toContain(inactiveEmail)

    // Each carries the deep link + description.
    for (const c of calls) {
      expect(c.body.type).toBe('rfi-created')
      expect(c.body.payload.subject).toBe('New RFI: Busbar query')
      expect(c.body.payload.html).toContain('/rfis/rfi-xyz')
      expect(c.body.payload.html).toContain('Busbar query')
      expect(c.body.payload.html).toContain('Bob Assignee') // resolved assignee name
    }
    spy.mockRestore()
  }, 30_000)
})
