// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { levelMock } = vi.hoisted(() => ({ levelMock: vi.fn() }))
vi.mock('./access', () => ({ getSolarAccessLevel: (...a: unknown[]) => levelMock(...a) }))

import { requireSolarLevelAPI } from './api-gate'

const client = (user: { id: string } | null) => ({ auth: { getUser: async () => ({ data: { user } }) } }) as never
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'

beforeEach(() => levelMock.mockReset())

describe('requireSolarLevelAPI', () => {
  it('401 without a user (and never asks for the level)', async () => {
    const g = await requireSolarLevelAPI(client(null), P, 'edit')
    expect(g.ok).toBe(false)
    if (!g.ok) expect(g.response.status).toBe(401)
    expect(levelMock).not.toHaveBeenCalled()
  })
  it('403 when the level is below the need', async () => {
    levelMock.mockResolvedValue('view')
    const g = await requireSolarLevelAPI(client({ id: 'u1' }), P, 'edit')
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.response.status).toBe(403)
      expect(await g.response.json()).toEqual({ error: 'Solar access required', need: 'edit' })
    }
  })
  it('403 when there is no access at all', async () => {
    levelMock.mockResolvedValue(null)
    expect((await requireSolarLevelAPI(client({ id: 'u1' }), P, 'view')).ok).toBe(false)
  })
  it('passes edit and edit_financials for an edit need', async () => {
    levelMock.mockResolvedValue('edit')
    expect(await requireSolarLevelAPI(client({ id: 'u1' }), P, 'edit')).toEqual({ ok: true, level: 'edit', userId: 'u1' })
    levelMock.mockResolvedValue('edit_financials')
    expect((await requireSolarLevelAPI(client({ id: 'u1' }), P, 'edit')).ok).toBe(true)
  })
})
