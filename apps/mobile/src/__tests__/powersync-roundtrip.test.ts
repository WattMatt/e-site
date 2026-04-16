// apps/mobile/src/__tests__/powersync-roundtrip.test.ts
//
// Sprint 0 exit gate — MUST PASS before merging PowerSync PR.
// Requires real env vars: see apps/mobile/.env.test
//
// Run: DOTENV_CONFIG_PATH=.env.test pnpm vitest run src/__tests__/powersync-roundtrip.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { PowerSyncDatabase } from '@powersync/react-native'
import { AppSchema } from '../lib/powersync/schema'
import { SupabaseConnector } from '../lib/powersync/connector'

const SYNC_WAIT_MS = 15_000

describe('PowerSync round-trip (Sprint 0 exit gate)', () => {
  let supabase: ReturnType<typeof createClient>
  let db: PowerSyncDatabase
  let createdSnagId: string

  beforeAll(async () => {
    supabase = createClient(
      process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Sign in as test user
    const { error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!,
    })
    if (error) throw new Error(`Auth failed: ${error.message}`)

    // Init and connect PowerSync
    db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: 'esite-test.db' },
    })
    await db.connect(new SupabaseConnector(supabase))

    // Wait for initial sync
    await new Promise(r => setTimeout(r, SYNC_WAIT_MS))
  }, 60_000)

  afterAll(async () => {
    // Clean up test snag
    if (createdSnagId) {
      await supabase.from('snags').delete().eq('id', createdSnagId)
    }
    await db.disconnect()
    await db.close()
    await supabase.auth.signOut()
  })

  it('creates a snag in Supabase and syncs it to local SQLite', async () => {
    // 1. Write to Supabase (write path — bypasses PowerSync)
    const { data: created, error } = await (supabase as any)
      .schema('field')
      .from('snags')
      .insert({
        title: 'PowerSync roundtrip test',
        description: 'Sprint 0 exit gate — delete me',
        status: 'open',
        priority: 'low',
        project_id: process.env.TEST_PROJECT_ID!,
        organisation_id: process.env.TEST_ORG_ID!,
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(created).not.toBeNull()
    createdSnagId = created!.id

    // 2. Wait for PowerSync to sync the row down
    await new Promise(r => setTimeout(r, SYNC_WAIT_MS))

    // 3. Assert the row is in local SQLite
    const rows = await db.getAll<{ id: string; title: string }>(
      'SELECT id, title FROM snags WHERE id = ?',
      [createdSnagId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('PowerSync roundtrip test')
  }, 60_000)

  it('updates a snag in Supabase and the update syncs to SQLite', async () => {
    expect(createdSnagId).toBeDefined()

    // 1. Update via Supabase
    await (supabase as any)
      .schema('field')
      .from('snags')
      .update({ status: 'in_progress' })
      .eq('id', createdSnagId)

    // 2. Wait for sync
    await new Promise(r => setTimeout(r, SYNC_WAIT_MS))

    // 3. Assert update in SQLite
    const row = await db.get<{ status: string }>(
      'SELECT status FROM snags WHERE id = ?',
      [createdSnagId]
    )
    expect(row?.status).toBe('in_progress')
  }, 60_000)
})
