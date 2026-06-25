// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { projectSettingsService } from '@esite/shared'
import { notifySnagCreated, dispatchSnagStatusEmail } from './snag-email'
import { notifyDiaryEntryCreated } from './diary-email'

/**
 * Live-DB integration test for the Snag + Site-Diary email channels.
 *
 * Proves that notifySnagCreated / dispatchSnagStatusEmail / notifyDiaryEntryCreated,
 * fed real profiles + project settings, resolve the full active roster and send
 * ONE batched send-email request with the right subject + deep link, and that
 * the per-module toggle (notifySnagEmail / notifyDiaryEmail) gates the whole
 * thing. The external Resend HTTP call and the bell (send-notification) are the
 * only mocked seams; all Supabase reads hit the real local DB.
 *
 * Run: RUN_INTEGRATION_TESTS=true NEXT_PUBLIC_SUPABASE_URL=… \
 *   SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
 *   pnpm --filter web exec vitest run src/lib/notify-modules.integration.test.ts
 */

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true'
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

describe.skipIf(!runIntegration)('snag + diary email — INTEGRATION (live DB)', () => {
  let admin: SupabaseClient
  let orgId: string
  let projectId: string
  let diaryEntryId: string
  let authorId: string
  let member2Id: string
  let member3Id: string
  let inactiveId: string
  const ts = Date.now()
  const authorEmail = `nm-author-${ts}@example.com`
  const member2Email = `nm-member2-${ts}@example.com`
  const member3Email = `nm-member3-${ts}@example.com`
  const inactiveEmail = `nm-inactive-${ts}@example.com`

  beforeAll(async () => {
    if (!URL || !SERVICE) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.e-site.live'

    admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: org, error: orgErr } = await (admin as any)
      .from('organisations').insert({ name: `NM Org ${ts}`, slug: `nm-notify-org-${ts}` }).select('id').single()
    if (orgErr) throw orgErr
    orgId = org.id

    const mkUser = async (email: string, name: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: 'Test-Passw0rd!', email_confirm: true, user_metadata: { full_name: name },
      })
      if (error || !data.user) throw error ?? new Error('createUser failed')
      return data.user.id
    }
    authorId = await mkUser(authorEmail, 'Jane Author')
    member2Id = await mkUser(member2Email, 'Bob Member')
    member3Id = await mkUser(member3Email, 'Carol Member')
    inactiveId = await mkUser(inactiveEmail, 'Dave Inactive')

    // Contractors so project-membership governs recipients (org PMs/admins would
    // otherwise be pulled in via the implicit-access clause).
    await (admin as any).from('user_organisations').insert(
      [authorId, member2Id, member3Id, inactiveId].map((user_id) => ({
        user_id, organisation_id: orgId, role: 'contractor', is_active: true,
      })),
    )

    const { data: proj, error: projErr } = await (admin as any)
      .schema('projects').from('projects')
      .insert({ name: `Sandton ${ts}`, organisation_id: orgId, created_by: authorId })
      .select('id').single()
    if (projErr) throw projErr
    projectId = proj.id

    await (admin as any).schema('projects').from('project_members').insert([
      { project_id: projectId, organisation_id: orgId, user_id: authorId, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: member2Id, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: member3Id, is_active: true },
      { project_id: projectId, organisation_id: orgId, user_id: inactiveId, is_active: false },
    ])

    // A real diary entry — notifyDiaryEntryCreated loads it by id to build the email.
    const { data: diary, error: diaryErr } = await (admin as any)
      .schema('projects').from('site_diary_entries')
      .insert({
        project_id: projectId, organisation_id: orgId, created_by: authorId,
        entry_date: '2026-06-24', entry_type: 'progress',
        progress_notes: 'Poured slab on level 2.',
      })
      .select('id').single()
    if (diaryErr) throw diaryErr
    diaryEntryId = diary.id
  }, 60_000)

  afterAll(async () => {
    try { if (projectId) await (admin as any).schema('projects').from('projects').delete().eq('id', projectId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('user_organisations').delete().eq('organisation_id', orgId) } catch { /* ignore */ }
    try { if (orgId) await (admin as any).from('organisations').delete().eq('id', orgId) } catch { /* ignore */ }
    for (const uid of [authorId, member2Id, member3Id, inactiveId]) { try { if (uid) await admin.auth.admin.deleteUser(uid) } catch { /* ignore */ } }
    vi.restoreAllMocks()
  }, 60_000)

  // Intercept send-email (assert) + send-notification (bell, swallow); pass all
  // Supabase REST/DB reads through to the real local DB.
  function mockFetch() {
    const calls: Array<{ url: string; body: any }> = []
    const realFetch = globalThis.fetch.bind(globalThis)
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      const u = String(url)
      if (u.includes('/functions/v1/send-email')) {
        calls.push({ url: u, body: JSON.parse(init.body) })
        return new Response(JSON.stringify({ sent: true }), { status: 200 })
      }
      if (u.includes('/functions/v1/send-notification')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return realFetch(url, init)
    })
    return { calls, spy }
  }

  const activeRoster = () => [authorEmail, member2Email, member3Email].sort()

  it('notifySnagCreated emails the full active roster when notifySnagEmail is ON', async () => {
    await projectSettingsService.update(admin as any, projectId, { notifySnagEmail: true })
    const { calls, spy } = mockFetch()
    await notifySnagCreated({
      snagId: 'snag-abc', projectId, title: 'Cracked tile', priority: 'high',
      assigneeId: member2Id, raiserId: authorId,
    })

    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.url.endsWith('/functions/v1/send-email')).toBe(true)
    expect(Array.isArray(call.body.payload.to)).toBe(true)
    const recipients = (call.body.payload.to as string[]).map((e) => e.toLowerCase()).sort()
    expect(recipients).toEqual(activeRoster())
    expect(recipients).not.toContain(inactiveEmail)
    expect(call.body.payload.subject).toBe('New snag: Cracked tile')
    expect(call.body.payload.html).toContain('/snags/snag-abc')
    expect(call.body.payload.html).toContain('Bob Member') // resolved assignee name
    spy.mockRestore()
  }, 30_000)

  it('notifySnagCreated sends nothing when notifySnagEmail is OFF', async () => {
    await projectSettingsService.update(admin as any, projectId, { notifySnagEmail: false })
    const { calls, spy } = mockFetch()
    await notifySnagCreated({
      snagId: 'snag-off', projectId, title: 'Cracked tile', priority: 'high',
      assigneeId: member2Id, raiserId: authorId,
    })
    expect(calls).toHaveLength(0)
    spy.mockRestore()
  }, 30_000)

  it('dispatchSnagStatusEmail emails the roster with the status when ON', async () => {
    await projectSettingsService.update(admin as any, projectId, { notifySnagEmail: true })
    const { calls, spy } = mockFetch()
    await dispatchSnagStatusEmail({
      snagId: 'snag-abc', projectId, title: 'Cracked tile',
      statusLabel: 'Signed Off', changedById: member2Id,
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect((call.body.payload.to as string[]).map((e) => e.toLowerCase()).sort()).toEqual(activeRoster())
    expect(call.body.payload.subject).toBe('Snag Signed Off: Cracked tile')
    expect(call.body.payload.html).toContain('/snags/snag-abc')
    expect(call.body.payload.html).toContain('Signed Off')
    spy.mockRestore()
  }, 30_000)

  it('notifyDiaryEntryCreated emails the full active roster when notifyDiaryEmail is ON', async () => {
    await projectSettingsService.update(admin as any, projectId, { notifyDiaryEmail: true })
    const { calls, spy } = mockFetch()
    await notifyDiaryEntryCreated({ entryId: diaryEntryId, projectId, authorId })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    const recipients = (call.body.payload.to as string[]).map((e) => e.toLowerCase()).sort()
    expect(recipients).toEqual(activeRoster())
    expect(call.body.payload.subject).toContain('Site diary')
    expect(call.body.payload.subject).toContain('2026-06-24')
    expect(call.body.payload.html).toContain(`/projects/${projectId}/diary#entry-${diaryEntryId}`)
    expect(call.body.payload.html).toContain('Poured slab on level 2')
    spy.mockRestore()
  }, 30_000)

  it('notifyDiaryEntryCreated sends nothing when notifyDiaryEmail is OFF', async () => {
    await projectSettingsService.update(admin as any, projectId, { notifyDiaryEmail: false })
    const { calls, spy } = mockFetch()
    await notifyDiaryEntryCreated({ entryId: diaryEntryId, projectId, authorId })
    expect(calls).toHaveLength(0)
    spy.mockRestore()
  }, 30_000)
})
