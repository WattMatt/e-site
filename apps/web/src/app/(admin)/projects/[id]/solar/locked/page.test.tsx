import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  redirect: vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`) }),
  loadSolarEntry: vi.fn(),
  listSolarGrantors: vi.fn(async () => [{ userId: 'a', fullName: 'Ann', email: null }]),
  createClient: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: (p: string) => h.redirect(p),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/solar/entry-loader', () => ({ loadSolarEntry: h.loadSolarEntry }))
vi.mock('@/lib/solar/grantors', async (orig) => ({
  ...(await orig<typeof import('@/lib/solar/grantors')>()),
  listSolarGrantors: h.listSolarGrantors,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: vi.fn() }))
vi.mock('@/actions/solar-requests.actions', () => ({
  askAdminToSubscribeAction: vi.fn(), requestSolarAccessAction: vi.fn(), withdrawSolarRequestAction: vi.fn(),
  getSolarSubscriptionStateAction: vi.fn(async () => ({ active: false })),
}))

import SolarLockedPage from './page'
import { fakeSupabase } from '@/test/fake-supabase'

const ctx = (state: unknown) => ({ projectId: 'p1', projectName: 'Kings Mall', organisationId: 'org-1', userId: 'u1', state })
const args = (payment?: string) => ({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve(payment ? { payment } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'public.organisations': [{ id: 'org-1', name: 'WM Org' }] } }).client)
})

describe('/solar/locked page', () => {
  it('row 5 (granted) never sees the locked screen — straight to the Overview', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'granted', level: 'view' }))
    await expect(SolarLockedPage(args())).rejects.toThrow('REDIRECT:/projects/p1/solar/overview')
  })

  it('suppliers and client viewers go back to the project', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'hidden' }))
    await expect(SolarLockedPage(args())).rejects.toThrow('REDIRECT:/projects/p1')
  })

  it('a pending requester sees the admins’ names', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' }))
    render(await SolarLockedPage(args()))
    expect(screen.getByText('Request sent to Ann on 28 Sep 2026')).toBeDefined()
  })

  it('an owner back from Paystack sees the activation poller', async () => {
    h.loadSolarEntry.mockResolvedValue(ctx({ kind: 'subscribe' }))
    render(await SolarLockedPage(args('received')))
    expect(screen.getByText('Solar is not active for WM Org')).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('Payment received — activating Solar…')
  })
})
