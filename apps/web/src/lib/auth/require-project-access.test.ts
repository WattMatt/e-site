// apps/web/src/lib/auth/require-project-access.test.ts
import { describe, it, expect, vi } from 'vitest'
import { requireProjectAccess } from './require-project-access'

const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) as never
const rpcOf = (c: unknown) => (c as { rpc: ReturnType<typeof vi.fn> }).rpc

describe('requireProjectAccess', () => {
  it('passes when user_has_project_access is true', async () => {
    const c = client(true)
    const access = await requireProjectAccess(c, 'p1')
    expect(access.ok).toBe(true)
    expect(rpcOf(c)).toHaveBeenCalledWith('user_has_project_access', { _project_id: 'p1' })
  })

  it('refuses as not-found when false, so another client site is not confirmed to exist', async () => {
    const access = await requireProjectAccess(client(false), 'p1')
    expect(access.ok).toBe(false)
    expect(access).toEqual({ ok: false, status: 404, error: 'Project not found' })
  })

  it('fails closed on an RPC error or a non-boolean', async () => {
    const onError = await requireProjectAccess(client(null, { message: 'boom' }), 'p1')
    expect(onError.ok).toBe(false)
    const onString = await requireProjectAccess(client('true'), 'p1')
    expect(onString.ok).toBe(false)
  })

  it('refuses an empty project id without calling the database', async () => {
    const c = client(true)
    const access = await requireProjectAccess(c, '')
    expect(access.ok).toBe(false)
    expect(rpcOf(c)).not.toHaveBeenCalled()
  })
})
