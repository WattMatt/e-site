// packages/db/src/__tests__/rls-benchmark.test.ts
//
// Sprint 0 exit gate — RLS performance benchmark.
// AC: Single-org RLS queries (compliance.sites) < 50ms on 10K rows.
// AC: Dual-org marketplace.orders RLS query < 100ms.
// AC: Cross-org leakage: User A cannot see Org B data.
//
// Requires env vars (skip gracefully if absent):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   TEST_BENCHMARK_USER_EMAIL, TEST_BENCHMARK_USER_PASSWORD
//
// Run: pnpm test:ci
// Or:  SUPABASE_URL=... pnpm vitest run src/__tests__/rls-benchmark.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const TEST_EMAIL = process.env.TEST_BENCHMARK_USER_EMAIL ?? ''
const TEST_PASSWORD = process.env.TEST_BENCHMARK_USER_PASSWORD ?? ''

const credentialsPresent =
  SUPABASE_URL !== '' &&
  SUPABASE_ANON_KEY !== '' &&
  SUPABASE_SERVICE_KEY !== '' &&
  TEST_EMAIL !== '' &&
  TEST_PASSWORD !== ''

const MAX_SINGLE_ORG_MS = 50
const MAX_DUAL_ORG_MS = 100
const SITES_COUNT = 10_000
const SNAG_COUNT = 1_000
const ORDER_COUNT = 500

async function measureMs(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now()
  await fn()
  return performance.now() - t
}

describe.skipIf(!credentialsPresent)('RLS performance benchmark (Sprint 0 exit gate)', () => {
  let svc: SupabaseClient   // service-role: bypasses RLS for seeding
  let usr: SupabaseClient   // anon: subject to RLS — used for benchmarks
  let testUserId: string
  let contractorOrgId: string
  let supplierOrgId: string
  let testProjectId: string
  let testSupplierId: string
  const createdOrgIds: string[] = []

  // ---------------------------------------------------------------------------
  // Setup: create orgs, project, supplier, seed rows
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    usr = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    const { data: auth, error: authErr } = await usr.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    if (authErr) throw new Error(`Auth failed: ${authErr.message}`)
    testUserId = auth.user!.id

    // Create 2 benchmark orgs
    for (let i = 0; i < 2; i++) {
      const slug = `bench-${Date.now()}-${i}`
      const { data: org, error } = await svc
        .from('organisations')
        .insert({ name: `Bench Org ${i}`, slug, subscription_tier: 'starter' })
        .select('id')
        .single()
      if (error) throw new Error(`Create org ${i}: ${error.message}`)
      createdOrgIds.push(org!.id)
    }
    contractorOrgId = createdOrgIds[0]
    supplierOrgId = createdOrgIds[1]

    // Add test user to contractor org only
    await svc.from('user_organisations').insert({
      user_id: testUserId,
      organisation_id: contractorOrgId,
      role: 'contractor',
    })

    // Create a project in contractor org (required FK for snags)
    const { data: proj, error: projErr } = await (svc as any)
      .schema('projects')
      .from('projects')
      .insert({
        organisation_id: contractorOrgId,
        name: 'Bench Project',
        status: 'active',
        created_by: testUserId,
      })
      .select('id')
      .single()
    if (projErr) throw new Error(`Create project: ${projErr.message}`)
    testProjectId = proj!.id

    // Create a supplier (required FK for marketplace.orders)
    const { data: sup, error: supErr } = await (svc as any)
      .schema('suppliers')
      .from('suppliers')
      .insert({ name: 'Bench Supplier', categories: ['electrical'], is_active: true })
      .select('id')
      .single()
    if (supErr) throw new Error(`Create supplier: ${supErr.message}`)
    testSupplierId = sup!.id

    // --- Seed 10K compliance.sites (5K contractor, 5K supplier) ---
    const siteRows = Array.from({ length: SITES_COUNT }, (_, i) => ({
      organisation_id: i < 5000 ? contractorOrgId : supplierOrgId,
      name: `Bench site ${i}`,
      address: '1 Test Street',
      created_by: testUserId,
    }))
    for (let offset = 0; offset < siteRows.length; offset += 500) {
      const { error } = await (svc as any)
        .schema('compliance')
        .from('sites')
        .insert(siteRows.slice(offset, offset + 500))
      if (error) throw new Error(`Seed sites @${offset}: ${error.message}`)
    }

    // --- Seed 1K field.snags in contractor org ---
    const snagRows = Array.from({ length: SNAG_COUNT }, (_, i) => ({
      project_id: testProjectId,
      organisation_id: contractorOrgId,
      title: `Bench snag ${i}`,
      status: 'open',
      priority: 'low',
      raised_by: testUserId,
    }))
    for (let offset = 0; offset < snagRows.length; offset += 250) {
      const { error } = await (svc as any)
        .schema('field')
        .from('snags')
        .insert(snagRows.slice(offset, offset + 250))
      if (error) throw new Error(`Seed snags @${offset}: ${error.message}`)
    }

    // --- Seed 500 marketplace.orders (dual-org) ---
    const orderRows = Array.from({ length: ORDER_COUNT }, (_, i) => ({
      contractor_org_id: contractorOrgId,
      supplier_org_id: supplierOrgId,
      supplier_id: testSupplierId,
      status: 'submitted',
      total_amount: (i + 1) * 100,
      created_by: testUserId,
    }))
    for (let offset = 0; offset < orderRows.length; offset += 250) {
      const { error } = await (svc as any)
        .schema('marketplace')
        .from('orders')
        .insert(orderRows.slice(offset, offset + 250))
      if (error) throw new Error(`Seed orders @${offset}: ${error.message}`)
    }
  }, 180_000)

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await (svc as any).schema('marketplace').from('orders').delete().eq('contractor_org_id', orgId)
      await (svc as any).schema('field').from('snags').delete().eq('organisation_id', orgId)
      await (svc as any).schema('compliance').from('sites').delete().eq('organisation_id', orgId)
      await (svc as any).schema('projects').from('projects').delete().eq('organisation_id', orgId)
      await svc.from('user_organisations').delete().eq('organisation_id', orgId)
      await svc.from('organisations').delete().eq('id', orgId)
    }
    if (testSupplierId) {
      await (svc as any).schema('suppliers').from('suppliers').delete().eq('id', testSupplierId)
    }
    await usr.auth.signOut()
  }, 60_000)

  // ---------------------------------------------------------------------------
  // Benchmarks
  // ---------------------------------------------------------------------------
  it(`compliance.sites SELECT with RLS completes in <${MAX_SINGLE_ORG_MS}ms (10K rows)`, async () => {
    let rowCount = 0
    const ms = await measureMs(async () => {
      const { data, error } = await (usr as any)
        .schema('compliance')
        .from('sites')
        .select('id, name', { count: 'exact', head: false })
        .limit(5000)
      expect(error).toBeNull()
      rowCount = data?.length ?? 0
    })
    console.log(`compliance.sites: ${ms.toFixed(1)}ms, ${rowCount} rows visible`)
    expect(ms).toBeLessThan(MAX_SINGLE_ORG_MS)
  })

  it(`field.snags SELECT with RLS completes in <${MAX_SINGLE_ORG_MS}ms`, async () => {
    let rowCount = 0
    const ms = await measureMs(async () => {
      const { data, error } = await (usr as any)
        .schema('field')
        .from('snags')
        .select('id, title, status')
        .limit(500)
      expect(error).toBeNull()
      rowCount = data?.length ?? 0
    })
    console.log(`field.snags: ${ms.toFixed(1)}ms, ${rowCount} rows visible`)
    expect(ms).toBeLessThan(MAX_SINGLE_ORG_MS)
  })

  it(`marketplace.orders dual-org RLS completes in <${MAX_DUAL_ORG_MS}ms`, async () => {
    let rowCount = 0
    const ms = await measureMs(async () => {
      const { data, error } = await (usr as any)
        .schema('marketplace')
        .from('orders')
        .select('id, status, total_amount')
        .limit(500)
      expect(error).toBeNull()
      rowCount = data?.length ?? 0
    })
    console.log(`marketplace.orders: ${ms.toFixed(1)}ms, ${rowCount} rows visible`)
    expect(ms).toBeLessThan(MAX_DUAL_ORG_MS)
  })

  it('cross-org leakage: user cannot see supplierOrgId sites', async () => {
    const { data, error } = await (usr as any)
      .schema('compliance')
      .from('sites')
      .select('id')
      .eq('organisation_id', supplierOrgId)

    expect(error).toBeNull()
    // RLS must return zero rows — user is not a member of supplierOrgId
    expect(data).toHaveLength(0)
  })

  it('user only sees rows from their own org', async () => {
    const { data, error } = await (usr as any)
      .schema('compliance')
      .from('sites')
      .select('organisation_id')
      .limit(100)

    expect(error).toBeNull()
    const uniqueOrgs = [...new Set((data ?? []).map((r: { organisation_id: string }) => r.organisation_id))]
    expect(uniqueOrgs).toEqual([contractorOrgId])
  })
})
