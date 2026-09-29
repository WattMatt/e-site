/**
 * The whole wire, not a mock of it: project_settings row → shared mapper → getNotificationConfig →
 * solarEmailEnabled. email-toggle.test.ts mocks the service, so it cannot see the service dropping
 * `solarEmail`; this one can (Task 34 teeth check).
 */
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fakeSupabase({ tables: { 'projects.project_settings': h.rows } }).client }))
import { solarEmailEnabled } from './email-toggle'

describe('solarEmailEnabled reads notify_solar_email through the real settings service', () => {
  it('ON in the row → true; OFF → false; another project’s row is not read', async () => {
    h.rows = [{ project_id: 'p1', notify_solar_email: true }, { project_id: 'p2', notify_solar_email: false }]
    await expect(solarEmailEnabled('p1')).resolves.toBe(true)
    await expect(solarEmailEnabled('p2')).resolves.toBe(false)
  })
  it('no row → the default (ON)', async () => {
    h.rows = []
    await expect(solarEmailEnabled('p3')).resolves.toBe(true)
  })
})
