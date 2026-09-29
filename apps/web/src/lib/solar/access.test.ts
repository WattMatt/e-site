import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) })
vi.mock('next/navigation', () => ({ redirect: (p: string) => redirect(p) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { getSolarAccessLevel, requireSolarLevel, orgHasSolar } from './access'

const PROJECT = '00000000-0000-0000-0000-0000000000aa'
const ORG = '00000000-0000-0000-0000-0000000000bb'

function client(result: { data: unknown; error: null | { message: string } }) {
  return { rpc: vi.fn().mockResolvedValue(result) }
}

// Block body (not an implicit return): mockClear() returns the mock itself,
// and Vitest treats a value returned from beforeEach as an auto-cleanup
// callback — returning the mock would make Vitest call redirect() again
// after every test, which throws.
beforeEach(() => { redirect.mockClear() })

describe('getSolarAccessLevel', () => {
  it('returns the level from public.solar_access_level', async () => {
    const c = client({ data: 'edit', error: null })
    await expect(getSolarAccessLevel(PROJECT, c as never)).resolves.toBe('edit')
    expect(c.rpc).toHaveBeenCalledWith('solar_access_level', { p_project_id: PROJECT })
  })

  it('returns null for NULL, unknown strings and RPC errors (fail closed)', async () => {
    await expect(getSolarAccessLevel(PROJECT, client({ data: null, error: null }) as never)).resolves.toBeNull()
    await expect(getSolarAccessLevel(PROJECT, client({ data: 'owner', error: null }) as never)).resolves.toBeNull()
    await expect(getSolarAccessLevel(PROJECT, client({ data: 'edit', error: { message: 'x' } }) as never)).resolves.toBeNull()
  })
})

describe('requireSolarLevel', () => {
  it('returns the level when it satisfies the requirement', async () => {
    const c = client({ data: 'edit_financials', error: null })
    await expect(requireSolarLevel(PROJECT, 'edit', c as never)).resolves.toBe('edit_financials')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects to the project locked screen when the level is too low', async () => {
    const c = client({ data: 'view', error: null })
    await expect(requireSolarLevel(PROJECT, 'edit', c as never)).rejects.toThrow(`REDIRECT:/projects/${PROJECT}/solar/locked`)
  })

  it('redirects when there is no access at all', async () => {
    const c = client({ data: null, error: null })
    await expect(requireSolarLevel(PROJECT, 'view', c as never)).rejects.toThrow(`REDIRECT:/projects/${PROJECT}/solar/locked`)
  })
})

describe('orgHasSolar', () => {
  it('is true only for data === true, false on error', async () => {
    await expect(orgHasSolar(ORG, client({ data: true, error: null }) as never)).resolves.toBe(true)
    await expect(orgHasSolar(ORG, client({ data: false, error: null }) as never)).resolves.toBe(false)
    await expect(orgHasSolar(ORG, client({ data: true, error: { message: 'x' } }) as never)).resolves.toBe(false)
  })
})
