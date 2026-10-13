import { describe, it, expect, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))

import StatusPlansMoved from './page'
import StatusPlanMoved from './[planId]/page'

describe('old status plan routes', () => {
  it('the list redirects to the tenant schedule', async () => {
    await expect(StatusPlansMoved({ params: Promise.resolve({ id: 'p1' }) })).rejects.toThrow('NEXT_REDIRECT /projects/p1/tenant-schedule')
  })
  it('a plan redirects to the tenant schedule', async () => {
    await expect(StatusPlanMoved({ params: Promise.resolve({ id: 'p1', planId: 'pl1' }) })).rejects.toThrow('NEXT_REDIRECT /projects/p1/tenant-schedule')
  })
})
