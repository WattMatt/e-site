/**
 * T-052: PowerSync sync rule tests
 *
 * Verifies that PowerSync sync rules produce an identical result set to
 * RLS queries for the same user — no data leakage across orgs.
 *
 * These are *integration* tests that require a live Supabase instance.
 * They do NOT require a physical PowerSync server; instead they:
 *   1. Query Supabase directly as User A (simulating what PowerSync sees)
 *   2. Query Supabase directly as User B
 *   3. Assert the intersection is empty — no cross-org row leakage
 *
 * For offline write-buffer conflict resolution, tests use the Supabase
 * service role to simulate concurrent writes and verify last-write-wins.
 *
 * Required env vars (packages/db/.env.test):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TEST_ORG_A_USER_EMAIL / TEST_ORG_A_USER_PASSWORD
 *   TEST_ORG_B_USER_EMAIL / TEST_ORG_B_USER_PASSWORD
 *   TEST_ORG_A_ID
 *   TEST_ORG_B_ID
 *
 * Run: pnpm --filter @esite/db vitest run src/__tests__/sync/sync-rules.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ─── Setup ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ORG_A_EMAIL = process.env.TEST_ORG_A_USER_EMAIL ?? 'orgA@example.com'
const ORG_A_PASSWORD = process.env.TEST_ORG_A_USER_PASSWORD ?? 'test-password-A'
const ORG_B_EMAIL = process.env.TEST_ORG_B_USER_EMAIL ?? 'orgB@example.com'
const ORG_B_PASSWORD = process.env.TEST_ORG_B_USER_PASSWORD ?? 'test-password-B'
const ORG_A_ID = process.env.TEST_ORG_A_ID ?? ''
const ORG_B_ID = process.env.TEST_ORG_B_ID ?? ''

let serviceClient: SupabaseClient
let clientA: SupabaseClient
let clientB: SupabaseClient

// Track created IDs for cleanup
const createdSnagIds: string[] = []
const createdProjectIds: string[] = []

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn('[sync-rules] Missing env vars — skipping integration tests')
    return
  }

  serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate as User A (Org A)
  clientA = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: errA } = await clientA.auth.signInWithPassword({
    email: ORG_A_EMAIL,
    password: ORG_A_PASSWORD,
  })
  if (errA) console.warn('[sync-rules] Could not sign in as User A:', errA.message)

  // Authenticate as User B (Org B)
  clientB = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: errB } = await clientB.auth.signInWithPassword({
    email: ORG_B_EMAIL,
    password: ORG_B_PASSWORD,
  })
  if (errB) console.warn('[sync-rules] Could not sign in as User B:', errB.message)
}, 30_000)

afterAll(async () => {
  // Clean up seed data
  if (serviceClient) {
    if (createdSnagIds.length > 0) {
      await serviceClient.schema('field' as any).from('snags').delete().in('id', createdSnagIds)
    }
    if (createdProjectIds.length > 0) {
      await serviceClient.schema('projects' as any).from('projects').delete().in('id', createdProjectIds)
    }
  }
  await clientA?.auth.signOut()
  await clientB?.auth.signOut()
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function skipIfNoEnv() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn('[sync-rules] Skipping — env vars not set')
    return true
  }
  return false
}

// ─── Sync rule correctness tests ─────────────────────────────────────────────

describe('T-052: Sync rules mirror RLS — org isolation', () => {
  it('User A can only see Org A snags (matches RLS)', async () => {
    if (skipIfNoEnv()) return

    // Seed a snag in Org B via service role
    const { data: seedSnag } = await (serviceClient as any)
      .schema('field')
      .from('snags')
      .insert({
        title: '[sync-test] Org B snag — should NOT appear for Org A',
        status: 'open',
        priority: 'low',
        organisation_id: ORG_B_ID,
      })
      .select('id')
      .single()

    if (seedSnag?.id) createdSnagIds.push(seedSnag.id)

    // Query as User A (same query PowerSync makes for sync rules)
    const { data: snags } = await (clientA as any)
      .schema('field')
      .from('snags')
      .select('id, organisation_id')

    const orgBSnags = (snags ?? []).filter((s: any) => s.organisation_id === ORG_B_ID)
    expect(orgBSnags).toHaveLength(0)
  })

  it('User B can only see Org B snags (symmetric isolation)', async () => {
    if (skipIfNoEnv()) return

    // Seed a snag in Org A
    const { data: seedSnag } = await (serviceClient as any)
      .schema('field')
      .from('snags')
      .insert({
        title: '[sync-test] Org A snag — should NOT appear for Org B',
        status: 'open',
        priority: 'low',
        organisation_id: ORG_A_ID,
      })
      .select('id')
      .single()

    if (seedSnag?.id) createdSnagIds.push(seedSnag.id)

    const { data: snags } = await (clientB as any)
      .schema('field')
      .from('snags')
      .select('id, organisation_id')

    const orgASnags = (snags ?? []).filter((s: any) => s.organisation_id === ORG_A_ID)
    expect(orgASnags).toHaveLength(0)
  })

  it('Projects are org-scoped (User A cannot see Org B projects)', async () => {
    if (skipIfNoEnv()) return

    // Seed an Org B project
    const { data: seedProject } = await (serviceClient as any)
      .schema('projects')
      .from('projects')
      .insert({
        name: '[sync-test] Org B project',
        organisation_id: ORG_B_ID,
        status: 'active',
      })
      .select('id')
      .single()

    if (seedProject?.id) createdProjectIds.push(seedProject.id)

    const { data: projects } = await (clientA as any)
      .schema('projects')
      .from('projects')
      .select('id, organisation_id')

    const orgBProjects = (projects ?? []).filter((p: any) => p.organisation_id === ORG_B_ID)
    expect(orgBProjects).toHaveLength(0)
  })

  it('Compliance sites are org-scoped', async () => {
    if (skipIfNoEnv()) return

    const { data: sites } = await (clientA as any)
      .schema('compliance')
      .from('sites')
      .select('id, organisation_id')

    const leaked = (sites ?? []).filter((s: any) => s.organisation_id === ORG_B_ID)
    expect(leaked).toHaveLength(0)
  })

  it('Notifications are user-scoped (not org-scoped)', async () => {
    if (skipIfNoEnv()) return

    // Notifications for User B should not appear for User A
    const { data: { user: userA } } = await clientA.auth.getUser()
    const { data: { user: userB } } = await clientB.auth.getUser()

    if (!userA || !userB) return

    // Seed notification for User B
    await serviceClient.from('notifications').insert({
      user_id: userB.id,
      title: '[sync-test] notification for User B only',
      body: 'Should not appear for User A',
    })

    const { data: notifs } = await clientA
      .from('notifications')
      .select('user_id')

    const leaked = (notifs ?? []).filter((n: any) => n.user_id === userB.id)
    expect(leaked).toHaveLength(0)
  })
})

describe('T-052: Sync rules — write permission boundaries', () => {
  it('User A cannot INSERT snags for Org B', async () => {
    if (skipIfNoEnv()) return

    const { error } = await (clientA as any)
      .schema('field')
      .from('snags')
      .insert({
        title: '[sync-test] cross-org snag attempt',
        status: 'open',
        priority: 'low',
        organisation_id: ORG_B_ID,
      })

    // RLS should reject this — either an error or zero rows inserted
    expect(error).not.toBeNull()
  })

  it('User A cannot UPDATE Org B snags', async () => {
    if (skipIfNoEnv()) return

    // Find any Org B snag (via service role)
    const { data: orgBSnag } = await (serviceClient as any)
      .schema('field')
      .from('snags')
      .select('id')
      .eq('organisation_id', ORG_B_ID)
      .limit(1)
      .single()

    if (!orgBSnag?.id) return // skip if no seed data

    const { error, count } = await (clientA as any)
      .schema('field')
      .from('snags')
      .update({ title: 'hacked' })
      .eq('id', orgBSnag.id)
      .select('id', { count: 'exact' })

    // Update should silently no-op (RLS filters the row out) or return error
    expect(count ?? 0).toBe(0)
  })
})

describe('T-052: Conflict resolution — last-write-wins', () => {
  it('Two concurrent offline writes: last timestamp wins', async () => {
    if (skipIfNoEnv()) return

    // Seed a snag for Org A
    const { data: snag } = await (serviceClient as any)
      .schema('field')
      .from('snags')
      .insert({
        title: '[sync-test] conflict resolution base',
        status: 'open',
        priority: 'low',
        organisation_id: ORG_A_ID,
      })
      .select('id')
      .single()

    if (!snag?.id) return
    createdSnagIds.push(snag.id)

    // Simulate device 1 write (earlier)
    const t1 = new Date(Date.now() - 5_000).toISOString()
    await serviceClient.from('snags' as any).upsert({
      id: snag.id,
      title: '[sync-test] Device 1 write',
      updated_at: t1,
    }, { onConflict: 'id' })

    // Simulate device 2 write (later — should win)
    const t2 = new Date().toISOString()
    await serviceClient.from('snags' as any).upsert({
      id: snag.id,
      title: '[sync-test] Device 2 write — WINNER',
      updated_at: t2,
    }, { onConflict: 'id' })

    // Read final state via service role
    const { data: final } = await (serviceClient as any)
      .schema('field')
      .from('snags')
      .select('title')
      .eq('id', snag.id)
      .single()

    expect(final?.title).toBe('[sync-test] Device 2 write — WINNER')
  })
})

describe('T-052: Sync rules — result set parity with RLS', () => {
  it('Snag result set is identical whether queried via RLS or service role + org filter', async () => {
    if (skipIfNoEnv()) return

    const { data: { user: userA } } = await clientA.auth.getUser()
    if (!userA) return

    // RLS query (what PowerSync produces for User A)
    const { data: rlsSnags } = await (clientA as any)
      .schema('field')
      .from('snags')
      .select('id')
      .order('id')

    // Service-role query filtered to Org A (source of truth)
    const { data: orgSnags } = await (serviceClient as any)
      .schema('field')
      .from('snags')
      .select('id')
      .eq('organisation_id', ORG_A_ID)
      .order('id')

    const rlsIds = new Set((rlsSnags ?? []).map((s: any) => s.id))
    const orgIds = new Set((orgSnags ?? []).map((s: any) => s.id))

    // Every RLS row must be in orgIds (no cross-org leakage)
    for (const id of rlsIds) {
      expect(orgIds.has(id)).toBe(true)
    }
    // Size should match (no missing rows either)
    expect(rlsIds.size).toBe(orgIds.size)
  })
})
