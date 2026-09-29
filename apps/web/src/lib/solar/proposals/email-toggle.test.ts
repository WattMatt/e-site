import { describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ cfg: vi.fn() }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<typeof import('@esite/shared')>()), projectSettingsService: { getNotificationConfig: h.cfg } }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
import { solarEmailEnabled } from './email-toggle'

describe('solarEmailEnabled', () => {
  it('reads cfg.solarEmail', async () => {
    h.cfg.mockResolvedValueOnce({ solarEmail: true })
    await expect(solarEmailEnabled('p1')).resolves.toBe(true)
    h.cfg.mockResolvedValueOnce({ solarEmail: false })
    await expect(solarEmailEnabled('p1')).resolves.toBe(false)
  })
  it('fails CLOSED (no email) on a read error', async () => {
    h.cfg.mockRejectedValueOnce(new Error('boom'))
    await expect(solarEmailEnabled('p1')).resolves.toBe(false)
  })
})
