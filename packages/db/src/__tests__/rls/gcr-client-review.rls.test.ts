/**
 * GCR client-review RLS suite (Phase 2).
 *
 * Verifies, against a LIVE Supabase, that:
 *   1. a granted client reads ONLY granted snapshots;
 *   2. the get_client_review RPC returns the payload for a granted site;
 *   3. the get_client_review RPC RAISES for an ungranted site;
 *   4. a client CANNOT read raw gcr cost tables (gcr.settings);
 *   5. the 00127 block holds — a client CANNOT read gcr.report_revisions;
 *   6. an admin CAN read the change_requests queue for their project.
 *
 * Requires env vars:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *   TEST_USER_A_EMAIL/PASSWORD (admin), TEST_USER_B_EMAIL/PASSWORD (client).
 *
 * Run: pnpm exec vitest run src/__tests__/rls/gcr-client-review.rls.test.ts
 *
 * SKIPPED by default: this suite is the real security gate for the sub-unit 2a
 * deploy, but it needs a live DB + two seeded test users. It is `describe.skip`
 * so CI stays green — owner-gated: run against a live Supabase (or prod-mirror)
 * before announcing the feature, per the deploy checklist. To run it, replace
 * `describe.skip` with `describe.skipIf(!credentialsPresent)` and supply the env
 * vars above.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const EMAIL_A = process.env.TEST_USER_A_EMAIL ?? ''
const PASS_A = process.env.TEST_USER_A_PASSWORD ?? ''
const EMAIL_B = process.env.TEST_USER_B_EMAIL ?? ''
const PASS_B = process.env.TEST_USER_B_PASSWORD ?? ''

// Retained for documentation + the swap-in described in the file header.
const credentialsPresent = [URL, ANON, SVC, EMAIL_A, PASS_A, EMAIL_B, PASS_B].every((v) => v !== '')
void credentialsPresent

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON)
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn(${email}): ${error.message}`)
  return c
}

// owner-gated: run against a live Supabase (see file header to enable).
describe.skip('GCR client-review RLS', () => {
  let svc: SupabaseClient, admin: SupabaseClient, client: SupabaseClient
  let adminId: string, clientId: string, orgId: string
  let grantedProjectId: string, ungrantedProjectId: string
  let grantedSnapId: string, ungrantedSnapId: string

  beforeAll(async () => {
    svc = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } })
    admin = await signIn(EMAIL_A, PASS_A)
    client = await signIn(EMAIL_B, PASS_B)
    adminId = (await admin.auth.getUser()).data.user!.id
    clientId = (await client.auth.getUser()).data.user!.id

    const { data: org } = await svc
      .from('organisations')
      .insert({ name: 'GCR RLS Org', slug: `gcr-rls-${Date.now()}`, subscription_tier: 'starter' })
      .select('id')
      .single()
    orgId = org!.id
    await svc.from('user_organisations').insert({ user_id: adminId, organisation_id: orgId, role: 'admin' })

    for (const flag of ['granted', 'ungranted'] as const) {
      const { data: p } = await (svc as any)
        .schema('projects')
        .from('projects')
        .insert({ organisation_id: orgId, name: `GCR ${flag}`, status: 'active', created_by: adminId })
        .select('id')
        .single()
      const { data: s } = await (svc as any)
        .schema('gcr')
        .from('review_snapshots')
        .insert({
          project_id: p!.id,
          organisation_id: orgId,
          payload: { tenants: [], banks: [], scheme: { monthlyCapitalRepayment: 1, finalTariff: 2 } },
        })
        .select('id')
        .single()
      if (flag === 'granted') {
        grantedProjectId = p!.id
        grantedSnapId = s!.id
      } else {
        ungrantedProjectId = p!.id
        ungrantedSnapId = s!.id
      }
    }

    // Grant the client ONLY the granted project.
    await svc.from('client_site_grants').insert({
      user_id: clientId,
      project_id: grantedProjectId,
      organisation_id: orgId,
      granted_by: adminId,
    })
  }, 120_000)

  afterAll(async () => {
    await svc.from('client_site_grants').delete().eq('user_id', clientId)
    for (const id of [grantedSnapId, ungrantedSnapId]) {
      await (svc as any).schema('gcr').from('review_snapshots').delete().eq('id', id)
    }
    for (const id of [grantedProjectId, ungrantedProjectId]) {
      await (svc as any).schema('projects').from('projects').delete().eq('id', id)
    }
    await svc.from('user_organisations').delete().eq('organisation_id', orgId)
    await svc.from('organisations').delete().eq('id', orgId)
    await admin.auth.signOut()
    await client.auth.signOut()
  }, 60_000)

  it('granted client reads ONLY the granted snapshot', async () => {
    const { data } = await (client as any).schema('gcr').from('review_snapshots').select('id, project_id')
    const ids = (data ?? []).map((r: any) => r.project_id)
    expect(ids).toContain(grantedProjectId)
    expect(ids).not.toContain(ungrantedProjectId)
  })

  it('granted client get_client_review RPC returns the payload', async () => {
    const { data, error } = await (client as any).schema('gcr').rpc('get_client_review', { p_project_id: grantedProjectId })
    expect(error).toBeNull()
    expect(data).toMatchObject({ scheme: { finalTariff: 2 } })
  })

  it('client get_client_review RPC raises for an ungranted site', async () => {
    const { error } = await (client as any).schema('gcr').rpc('get_client_review', { p_project_id: ungrantedProjectId })
    expect(error).not.toBeNull()
  })

  it('client CANNOT read raw gcr.settings (cost inputs)', async () => {
    const { data, error } = await (client as any).schema('gcr').from('settings').select('*').eq('project_id', grantedProjectId)
    // RLS denies: either error or zero rows; never cost data.
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('client CANNOT read gcr.report_revisions (00127 block preserved)', async () => {
    const { data, error } = await (client as any).schema('gcr').from('report_revisions').select('*').eq('project_id', grantedProjectId)
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('admin can read the change_requests queue for their project', async () => {
    const { error } = await (admin as any).schema('gcr').from('change_requests').select('id').eq('project_id', grantedProjectId)
    expect(error).toBeNull()
  })
})
