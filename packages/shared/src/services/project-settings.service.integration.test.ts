import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { projectSettingsService } from './project-settings.service'

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

describe.skipIf(!runIntegration)('projectSettingsService — INTEGRATION (live DB)', () => {
  let admin: SupabaseClient
  let orgId: string
  let userId: string
  let projectId: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      throw new Error(
        'Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run integration tests',
      )
    }
    admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Pick any active org + profile from the live DB for the test fixture.
    const { data: org } = await (admin as any)
      .from('organisations')
      .select('id')
      .limit(1)
      .single()
    if (!org) throw new Error('No organisation in DB to use as test fixture')
    orgId = org.id

    const { data: profile } = await (admin as any)
      .from('profiles')
      .select('id')
      .limit(1)
      .single()
    if (!profile) throw new Error('No profile in DB to use as test fixture')
    userId = profile.id

    // Create a test project. The 00103 trigger fires AFTER INSERT, so a
    // project_settings row appears automatically.
    const { data: created, error } = await (admin as any)
      .schema('projects')
      .from('projects')
      .insert({
        name: `IT-SETTINGS-${Date.now()}`,
        organisation_id: orgId,
        created_by: userId,
      })
      .select('id')
      .single()
    if (error || !created) throw error ?? new Error('failed to create test project')
    projectId = created.id
  }, 30_000)

  afterAll(async () => {
    if (projectId) {
      // Cascade removes project_settings + history via FK ON DELETE CASCADE.
      await (admin as any).schema('projects').from('projects').delete().eq('id', projectId)
    }
  }, 30_000)

  it('auto-create trigger gives the new project a settings row with DEFAULTS', async () => {
    const s = await projectSettingsService.get(admin, projectId)
    expect(s).not.toBeNull()
    expect(s!.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(s!.units).toBe('metric')
    expect(s!.retentionPct).toBe(5.0)
    expect(s!.contractType).toBe('jbcc_pba')
    expect(s!.notifyRfiTo).toEqual([])
  })

  it('update() persists changes and the audit trigger writes a history row with diff', async () => {
    const updated = await projectSettingsService.update(admin, projectId, { retentionPct: 7.5 })
    expect(updated.retentionPct).toBe(7.5)

    const history = await projectSettingsService.getHistory(admin, projectId, { limit: 5 })
    // Backfill INSERT + our UPDATE = at least 2 history rows.
    expect(history.length).toBeGreaterThanOrEqual(2)
    const latest = history[0]
    expect(latest.operation).toBe('UPDATE')
    expect(latest.diff).not.toBeNull()
    expect(latest.diff!.retention_pct).toBeDefined()
  })

  it('getAsOf returns the snapshot state at a past timestamp', async () => {
    const now = new Date()
    const snapshot = await projectSettingsService.getAsOf(admin, projectId, now)
    expect(snapshot).not.toBeNull()
    // The snapshot at "now" includes the 7.5 retention from the previous test.
    expect(snapshot!.retentionPct).toBe(7.5)
  })

  it('reset reverts the named field and writes another history row', async () => {
    const reset = await projectSettingsService.reset(admin, projectId, ['retentionPct'])
    expect(reset.retentionPct).toBe(5.0)

    const history = await projectSettingsService.getHistory(admin, projectId, { limit: 5 })
    expect(history.length).toBeGreaterThanOrEqual(3)
    expect(history[0].operation).toBe('UPDATE')
  })

  it('restore re-applies a past snapshot and writes a new history row', async () => {
    // Find the history row from the first UPDATE (retentionPct: 5 → 7.5).
    const history = await projectSettingsService.getHistory(admin, projectId, { limit: 10 })
    const targetRow = history.find(h =>
      h.operation === 'UPDATE'
        && h.diff?.retention_pct
        && h.diff.retention_pct[1] === '7.50',
    )
    if (!targetRow) throw new Error('expected to find the 5.00→7.50 history row')

    const restored = await projectSettingsService.restore(admin, projectId, targetRow.id)
    expect(restored.retentionPct).toBe(7.5)
  })

  it('getWorkingDayConfig returns the bundle from the live row', async () => {
    const cfg = await projectSettingsService.getWorkingDayConfig(admin, projectId)
    expect(cfg.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(cfg.holidayCalendar).toBe('ZA')
  })
})
